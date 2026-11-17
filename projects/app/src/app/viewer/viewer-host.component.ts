import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { ViewerService, type ViewerOwner } from './viewer.service';

// Должно совпадать с --atlas-panel-width в projects/app/src/styles/_tokens.scss.
export const PANEL_WIDTH_PX = 360;

@Component({
  selector: 'app-viewer-host',
  template: `<canvas #c (click)="onCanvasClick($event)"></canvas>`,
  styles: `
    :host { position: absolute; inset: 0; display: block; background: var(--atlas-color-canvas); }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewerHostComponent implements AfterViewInit, OnDestroy {
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private readonly viewer = inject(ViewerService);
  private ro: ResizeObserver | null = null;

  /** Владелец просмотрщика, пока этот холст на экране (ViewerService.owner). */
  readonly owner = input.required<ViewerOwner>();
  /** Отступ справа под правую панель, px. */
  readonly rightInset = input(PANEL_WIDTH_PX);
  /** ?debug=manifest: Shift+клик копирует координаты точки поверхности. */
  readonly debug = input(false);
  /** Ядро создано и прикреплено к canvas — можно загружать модель. */
  readonly attached = output<void>();

  constructor() {
    effect(() => {
      const right = this.rightInset();
      if (this.viewer.isAttached) this.viewer.setViewportInsets({ right });
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef().nativeElement;
    this.viewer.attach(canvas);
    this.viewer.owner.set(this.owner());
    this.viewer.setViewportInsets({ right: this.rightInset() });
    const host = canvas.parentElement ?? canvas;
    const apply = () => this.viewer.resize(host.clientWidth, host.clientHeight, window.devicePixelRatio);
    apply();
    this.ro = new ResizeObserver(apply);
    this.ro.observe(host);
    // загрузку модели владелец запускает только после attach
    this.attached.emit();
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
    this.ro = null;
    if (this.viewer.owner() === this.owner()) this.viewer.owner.set(null);
    this.viewer.detach();
  }

  // ?debug=manifest: Shift+клик по модели копирует координаты точки
  // поверхности в формате label.anchor
  onCanvasClick(ev: MouseEvent): void {
    if (!ev.shiftKey || !this.debug()) return;
    const p = this.viewer.pickSurface(ev.clientX, ev.clientY);
    if (!p) return;
    const text = `[${p.map((n) => +n.toFixed(3)).join(', ')}]`;
    const done = () => console.info(`[atlas] label.anchor = ${text}`);
    try {
      void navigator.clipboard.writeText(text).then(done, () => console.info(`[atlas] label.anchor = ${text} (clipboard недоступен)`));
    } catch {
      console.info(`[atlas] label.anchor = ${text} (clipboard недоступен)`);
    }
  }
}
