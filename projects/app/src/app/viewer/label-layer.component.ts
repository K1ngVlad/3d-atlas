import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
} from '@angular/core';
import { detailId as readDetailId, type Selection } from '@atlas/viewer-core';
import { AtlasStore } from '../data-access/atlas.store';
import { ViewerService } from './viewer.service';

interface LabelView {
  key: string;
  sel: Selection;
  text: string;
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  boxW: number;
  side: 'left' | 'right';
  /** В пределах ~8 px-запаса от края: элемент смонтирован, плавно появляется/гаснет. */
  shown: boolean;
  /** Приглушить: якорь скрыт за геометрией или ушёл за край. */
  dimmed: boolean;
  selected: boolean;
  hovered: boolean;
  hasDetail: boolean;
  /** Точки выносной линии с изломом: якорь → локоть → край подписи. */
  linePoints: string;
}

const BOX_H = 26;
const BOX_GAP = 6;
/** Диагональный сегмент выноски (до излома), px. */
const ELBOW = 14;
/** Запас смены стороны от центра модели, px. */
const SIDE_MARGIN = 40;
/** Запас монтирования у края экрана, px. */
const EDGE_MARGIN = 8;
/** Постоянная сглаживания движения подписей, мс. */
const MOTION_TAU_MS = 120;

/** Оценка ширины подписи: ~7px на символ + отступы и значок лупы. */
function estimateWidth(text: string, hasDetail: boolean): number {
  return Math.ceil(text.length * 7.2) + 22 + (hasDetail ? 14 : 0);
}

/** Сглаживание положения: подпись догоняет цель экспоненциально (~τ мс). */
function smooth(prev: number, target: number, dtMs: number, tau = MOTION_TAU_MS): number {
  const alpha = 1 - Math.exp(-dtMs / tau);
  return prev + (target - prev) * alpha;
}

interface MotionState {
  side: 'left' | 'right';
  x: number;
  y: number;
  /** Сглаженная ордината якоря — стабильный ключ порядка в колонке. */
  anchorY: number;
  at: number;
}

@Component({
  selector: 'app-label-layer',
  template: `
    <svg class="lines" aria-hidden="true">
      @for (v of views(); track v.key) {
        @if (v.shown) {
          <polyline [attr.points]="v.linePoints" [class.dimmed]="v.dimmed" />
          <circle
            [attr.cx]="v.anchorX"
            [attr.cy]="v.anchorY"
            [attr.r]="2.5"
            [class.dimmed]="v.dimmed"
          />
        }
      }
    </svg>

    @for (v of views(); track v.key) {
      @if (v.shown) {
        <button
          type="button"
          class="label"
          [class.dimmed]="v.dimmed"
          [class.selected]="v.selected"
          [class.hovered]="v.hovered"
          [style.left.px]="v.x"
          [style.top.px]="v.y"
          [style.width.px]="v.boxW"
          (click)="pick(v)"
          (dblclick)="openDetail(v)"
          (mouseenter)="hover(v, true)"
          (mouseleave)="hover(v, false)"
        >
          <span class="text">{{ v.text }}</span>
          @if (v.hasDetail) {
            <span class="lens" aria-hidden="true">⌕</span>
          }
        </button>
      }
    }

    @if (debug()) {
      @for (v of views(); track 'debug-' + v.key) {
        @if (v.shown) {
          <span
            class="debug-dot"
            [style.left.px]="v.anchorX"
            [style.top.px]="v.anchorY"
            [title]="'anchor ' + v.key + ' · ' + v.anchorX.toFixed(0) + ',' + v.anchorY.toFixed(0)"
          ></span>
        }
      }
    }
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
    }
    .lines {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    .lines polyline {
      fill: none;
      stroke: var(--atlas-color-text-muted);
      stroke-width: 1;
      transition: opacity 200ms ease;
    }
    .lines circle {
      fill: var(--atlas-color-text-muted);
      transition: opacity 200ms ease;
    }
    .lines polyline.dimmed,
    .lines circle.dimmed {
      opacity: 0.3;
    }

    .label {
      position: absolute;
      height: ${BOX_H}px;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 10px;
      pointer-events: auto;
      background: var(--atlas-color-surface);
      border: 1px solid var(--atlas-color-border);
      border-radius: var(--atlas-radius-sm);
      box-shadow: 0 2px 6px rgba(23, 33, 43, 0.12);
      font: 12px/1 var(--atlas-font-family);
      color: var(--atlas-color-text);
      cursor: pointer;
      white-space: nowrap;
      transition:
        opacity 200ms ease,
        border-color 120ms ease,
        background-color 120ms ease;
    }
    .label .text {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .label.dimmed {
      opacity: 0.45;
    }
    .label.hovered {
      border-color: var(--atlas-color-accent);
      background: var(--atlas-color-accent-bg);
    }
    .label.selected {
      border-color: var(--atlas-color-accent);
      background: var(--atlas-color-accent);
      color: #fff;
    }
    .label.selected .lens {
      color: #fff;
    }
    .lens {
      color: var(--atlas-color-accent);
      font-size: 14px;
    }

    .debug-dot {
      position: absolute;
      width: 7px;
      height: 7px;
      margin: -3.5px 0 0 -3.5px;
      border-radius: 50%;
      background: #e91e63;
      box-shadow: 0 0 0 2px rgba(233, 30, 99, 0.35);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LabelLayerComponent {
  private readonly store = inject(AtlasStore);
  private readonly viewer = inject(ViewerService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Длина выноски: расстояние от точки привязки до подписи, px. */
  readonly leaderLength = input(256);

  readonly debug = this.store.debug;

  // Состояние стабилизации (сторона, сглаженные координаты). Живёт вне сигналов:
  // сноски прилетают с каждым отрисованным кадром, обновление и так каждый кадр.
  private readonly motion = new Map<string, MotionState>();
  private motionManifestId: string | null = null;

  readonly views = computed<LabelView[]>(() => {
    const positions = this.viewer.labels();
    const cur = this.store.current();
    if (!this.store.options().labels || !cur || positions.length === 0) {
      this.motion.clear();
      return [];
    }
    if (this.motionManifestId !== cur.manifestId) {
      this.motion.clear();
      this.motionManifestId = cur.manifestId;
    }
    const width = this.host.nativeElement.clientWidth || 1024;
    const height = this.host.nativeElement.clientHeight || 768;
    const leader = Math.max(24, this.leaderLength());
    const now = performance.now();

    const parts = cur.manifest.parts;
    const selection = this.store.selection();
    const hoverSel = this.store.hover();
    const titles = this.store.partTitles();
    const existingDetails = this.store.existingDetails();

    const raw = positions.map((p) => {
      const part = parts.find((x) => x.id === p.partId);
      const sel: Selection = { partId: p.partId, instance: p.instance };
      const detail = part ? readDetailId(part.detail) : null;
      const text = titles.get(`${cur.manifestId}/${p.partId}`) ?? part?.entity ?? p.partId;
      const hasDetail = detail !== null && existingDetails.has(detail);
      const sameSel = (s: Selection | null) =>
        s !== null &&
        s.partId === p.partId &&
        (s.instance ?? undefined) === (p.instance ?? undefined);
      const inFrame =
        p.x >= -EDGE_MARGIN &&
        p.x <= width + EDGE_MARGIN &&
        p.y >= -EDGE_MARGIN &&
        p.y <= height + EDGE_MARGIN;
      return {
        key: p.instance ? `${p.partId}::${p.instance}` : p.partId,
        sel,
        text,
        anchorX: p.x,
        anchorY: p.y,
        coreVisible: p.visible,
        shown: p.visible || inFrame,
        occluded: p.occluded,
        boxW: estimateWidth(text, hasDetail),
        side: 'right' as 'left' | 'right',
        selected: sameSel(selection),
        hovered: sameSel(hoverSel),
        hasDetail,
      };
    });

    // Центр модели на экране — середина видимых якорей (не холста):
    // сторона подписи не перебрасывается при пересечении середины окна.
    const shownAnchors = raw.filter((r) => r.shown);
    const centerX =
      shownAnchors.length > 0
        ? shownAnchors.reduce((sum, r) => sum + r.anchorX, 0) / shownAnchors.length
        : width / 2;

    // Сторона с запасом SIDE_MARGIN; в мёртвой зоне — прежняя сторона
    for (const r of raw) {
      const prev = this.motion.get(r.key);
      if (r.anchorX < centerX - SIDE_MARGIN) r.side = 'right';
      else if (r.anchorX > centerX + SIDE_MARGIN) r.side = 'left';
      else r.side = prev?.side ?? (r.anchorX < centerX ? 'right' : 'left');
    }

    // Раскладка колонками по сторонам: порядок — по сглаженной ординате якоря
    // (перестановка только при реальном пересечении, а не от дрожания)
    const views: LabelView[] = [];
    for (const side of ['right', 'left'] as const) {
      const column = raw
        .filter((r) => r.side === side)
        .sort(
          (a, b) =>
            (this.motion.get(a.key)?.anchorY ?? a.anchorY) -
            (this.motion.get(b.key)?.anchorY ?? b.anchorY),
        );
      let prevBottom = 4;
      for (const r of column) {
        const targetX = side === 'right' ? r.anchorX + leader : r.anchorX - leader - r.boxW;
        const targetY = Math.max(r.anchorY - BOX_H / 2, prevBottom);
        prevBottom = targetY + BOX_H + BOX_GAP;

        const st = this.motion.get(r.key);
        let x: number;
        let y: number;
        let anchorY: number;
        if (!st) {
          x = targetX;
          y = targetY;
          anchorY = r.anchorY;
        } else {
          const dt = Math.min(Math.max(now - st.at, 0), 500);
          x = smooth(st.x, targetX, dt);
          y = smooth(st.y, targetY, dt);
          anchorY = smooth(st.anchorY, r.anchorY, dt);
        }
        this.motion.set(r.key, { side, x, y, anchorY, at: now });

        const midY = y + BOX_H / 2;
        const elbowX = r.anchorX + (side === 'right' ? ELBOW : -ELBOW);
        const boxEdgeX = side === 'right' ? x - 2 : x + r.boxW + 2;
        views.push({
          key: r.key,
          sel: r.sel,
          text: r.text,
          anchorX: r.anchorX,
          anchorY: r.anchorY,
          x,
          y,
          boxW: r.boxW,
          side,
          shown: r.shown,
          dimmed: r.occluded || !r.coreVisible,
          selected: r.selected,
          hovered: r.hovered,
          hasDetail: r.hasDetail,
          linePoints: `${r.anchorX},${r.anchorY} ${elbowX},${midY} ${boxEdgeX},${midY}`,
        });
      }
    }
    return views;
  });

  pick(v: LabelView): void {
    this.store.select(v.sel);
  }

  openDetail(v: LabelView): void {
    const cur = this.store.current();
    const part = cur?.manifest.parts.find((p) => p.id === v.sel.partId);
    const detailId = part ? readDetailId(part.detail) : null;
    if (!detailId || !this.store.existingDetails().has(detailId)) return;
    void this.store.openDetail(v.sel.partId, detailId);
  }

  hover(v: LabelView, on: boolean): void {
    this.viewer.setHover(on ? v.sel : null);
  }
}
