import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { AtlasStore } from '../data-access/atlas.store';
import { ViewerService } from './viewer.service';

// Должно совпадать с --atlas-panel-width в projects/app/src/styles/_tokens.scss.
export const PANEL_WIDTH_PX = 360;

@Component({
  selector: 'app-viewer-host',
  template: `<canvas #c></canvas>`,
  styles: `
    :host { position: absolute; inset: 0; display: block; background: var(--atlas-color-canvas); }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewerHostComponent implements AfterViewInit, OnDestroy {
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private readonly viewer = inject(ViewerService);
  private readonly store = inject(AtlasStore);
  private ro: ResizeObserver | null = null;

  constructor() {
    effect(() => {
      const open = this.store.panelOpen();
      this.viewer.setViewportInsets({ right: open ? PANEL_WIDTH_PX : 0 });
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef().nativeElement;
    this.viewer.attach(canvas);
    const host = canvas.parentElement ?? canvas;
    const apply = () => this.viewer.resize(host.clientWidth, host.clientHeight, window.devicePixelRatio);
    apply();
    this.ro = new ResizeObserver(apply);
    this.ro.observe(host);
    // загрузку текущего уровня запускаем только после attach
    this.store.onViewerAttached();
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
    this.ro = null;
    this.viewer.detach();
  }
}
