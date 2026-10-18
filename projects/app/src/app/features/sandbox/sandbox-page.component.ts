import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  NgZone,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import {
  createViewer,
  parseManifest,
  type SceneManifest,
  type Viewer,
  type ViewerEvent,
  type ViewState,
} from '@atlas/viewer-core';

interface LevelFrame {
  manifest: SceneManifest;
  state: ViewState;
}

const LOG_LIMIT = 50;

@Component({
  selector: 'app-sandbox-page',
  template: `
    <canvas #canvas></canvas>
    <div class="hud">
      <div class="row">
        <button type="button" (click)="goBack()" [disabled]="!canGoBack()">← Назад</button>
        <span class="title">{{ currentId() ?? '…' }}</span>
      </div>
      <div class="log">
        @for (line of eventLog(); track $index) {
          <div>{{ line }}</div>
        }
      </div>
    </div>
  `,
  styles: `
    :host { position: fixed; inset: 0; display: block; background: #111418; }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    .hud {
      position: absolute; top: 12px; left: 12px;
      padding: 8px 12px; border-radius: 6px;
      background: rgba(0, 0, 0, 0.55); color: #e8ebef;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      max-width: 420px; max-height: calc(100% - 24px);
      display: flex; flex-direction: column; gap: 6px; overflow: hidden;
    }
    .row { display: flex; align-items: center; gap: 8px; }
    .row button {
      background: #1f242b; color: #e8ebef; border: 1px solid #2d343c;
      padding: 2px 8px; border-radius: 4px; cursor: pointer; font: inherit;
    }
    .row button:disabled { opacity: 0.4; cursor: default; }
    .title { opacity: 0.9; }
    .log { overflow-y: auto; white-space: pre-wrap; opacity: 0.85; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SandboxPageComponent implements AfterViewInit, OnDestroy {
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  readonly levels = signal<LevelFrame[]>([]);
  readonly currentId = signal<string | null>(null);
  readonly eventLog = signal<string[]>([]);
  readonly canGoBack = computed(() => this.levels().length > 0);

  private viewer: Viewer | null = null;
  private currentManifest: SceneManifest | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private unsub: (() => void) | null = null;
  private readonly manifestCache = new Map<string, SceneManifest>();

  private readonly ngZone = inject(NgZone);

  ngAfterViewInit(): void {
    const canvas = this.canvasRef().nativeElement;
    this.ngZone.runOutsideAngular(() => {
      const viewer = createViewer(canvas);
      this.viewer = viewer;
      viewer.setViewportInsets({ left: 460 }); // имитация будущей панели деталей — чтобы увидеть смещение подлёта

      this.unsub = viewer.on((e) => this.handleEvent(e));

      void this.loadById('animal-cell');

      const host = canvas.parentElement!;
      const applyResize = () => {
        viewer.resize(host.clientWidth, host.clientHeight, window.devicePixelRatio);
      };
      applyResize();
      this.resizeObserver = new ResizeObserver(applyResize);
      this.resizeObserver.observe(host);
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.unsub?.();
    this.unsub = null;
    this.viewer?.dispose();
    this.viewer = null;
  }

  goBack(): void {
    const stack = this.levels();
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    this.levels.set(stack.slice(0, -1));
    void this.restoreLevel(prev);
  }

  private async fetchManifest(id: string): Promise<SceneManifest> {
    const cached = this.manifestCache.get(id);
    if (cached) return cached;
    const res = await fetch(`/manifests/${id}.json`);
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    const manifest = parseManifest(await res.json());
    this.manifestCache.set(id, manifest);
    return manifest;
  }

  private async loadById(id: string): Promise<void> {
    if (!this.viewer) return;
    try {
      const manifest = await this.fetchManifest(id);
      await this.viewer.load(manifest);
      this.currentManifest = manifest;
      this.currentId.set(manifest.id);
    } catch (err) {
      this.pushLog(`load error: ${(err as Error).message}`);
    }
  }

  private async restoreLevel(frame: LevelFrame): Promise<void> {
    if (!this.viewer) return;
    try {
      await this.viewer.load(frame.manifest);
      this.currentManifest = frame.manifest;
      this.currentId.set(frame.manifest.id);
      this.viewer.restoreViewState(frame.state);
    } catch (err) {
      this.pushLog(`back error: ${(err as Error).message}`);
    }
  }

  private handleEvent(e: ViewerEvent): void {
    switch (e.type) {
      case 'hover':
        this.pushLog(e.selection ? `hover ${fmtSel(e.selection)}` : 'hover —');
        return;
      case 'select':
        this.pushLog(e.selection ? `select ${fmtSel(e.selection)}` : 'select —');
        return;
      case 'open-detail':
        this.pushLog(`open-detail ${e.partId} → ${e.detailId}`);
        void this.openDetail(e.partId, e.detailId);
        return;
      case 'load-progress':
        this.pushLog(`load ${e.loaded}${e.total ? '/' + e.total : ''}`);
        return;
      case 'loaded':
        this.pushLog('loaded');
        return;
      case 'error':
        this.pushLog(`error[${e.error.code}] ${e.error.message}`);
        return;
    }
  }

  private async openDetail(_partId: string, detailId: string): Promise<void> {
    if (!this.viewer || !this.currentManifest) return;
    const parent = this.currentManifest;
    const parentState = this.viewer.getViewState();
    try {
      const manifest = await this.fetchManifest(detailId);
      await this.viewer.load(manifest);
      // Пушим в стек только после успешной загрузки — иначе «Назад» становится
      // активной при провалившемся переходе.
      this.levels.update((s) => [...s, { manifest: parent, state: parentState }]);
      this.currentManifest = manifest;
      this.currentId.set(manifest.id);
    } catch (err) {
      this.pushLog(`open-detail error: ${(err as Error).message}`);
    }
  }

  private pushLog(line: string): void {
    this.eventLog.update((log) => {
      const next = log.length >= LOG_LIMIT ? log.slice(log.length - LOG_LIMIT + 1) : log.slice();
      next.push(line);
      return next;
    });
  }
}

function fmtSel(sel: { partId: string; instance?: string }): string {
  return sel.instance ? `${sel.partId}/${sel.instance}` : sel.partId;
}
