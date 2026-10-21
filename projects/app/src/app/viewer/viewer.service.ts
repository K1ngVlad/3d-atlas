import { Injectable, NgZone, inject, signal } from '@angular/core';
import {
  createViewer,
  type LabelPosition,
  type SceneManifest,
  type Selection,
  type Vec3,
  type Viewer,
  type ViewerError,
  type ViewerEvent,
  type ViewerOptions,
  type ViewState,
} from '@atlas/viewer-core';

export interface LoadProgress {
  loaded: number;
  total: number;
}

export interface ViewportInsets {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

export interface OpenDetailRequest {
  partId: string;
  detailId: string;
  seq: number;
}

@Injectable({ providedIn: 'root' })
export class ViewerService {
  readonly loading = signal<LoadProgress | null>(null);
  readonly loaded = signal<boolean>(false);
  readonly error = signal<ViewerError | null>(null);
  readonly hover = signal<Selection | null>(null);
  readonly selection = signal<Selection | null>(null);
  readonly openDetailRequest = signal<OpenDetailRequest | null>(null);
  readonly labels = signal<LabelPosition[]>([]);

  private viewer: Viewer | null = null;
  private unsub: (() => void) | null = null;
  private frameUnsub: (() => void) | null = null;
  private loadToken = 0;
  private detailSeq = 0;

  private readonly zone = inject(NgZone);

  get isAttached(): boolean {
    return this.viewer !== null;
  }

  attach(canvas: HTMLCanvasElement): void {
    if (this.viewer) return;
    this.zone.runOutsideAngular(() => {
      const v = createViewer(canvas);
      this.unsub = v.on((e) => this.onEvent(e));
      this.frameUnsub = v.onFrame((labels) => {
        this.zone.run(() => this.labels.set(labels));
      });
      this.viewer = v;
    });
  }

  detach(): void {
    this.unsub?.();
    this.unsub = null;
    this.frameUnsub?.();
    this.frameUnsub = null;
    this.viewer?.dispose();
    this.viewer = null;
    this.resetState();
  }

  async load(manifest: SceneManifest, opts?: { restore?: ViewState }): Promise<void> {
    if (!this.viewer) throw new Error('viewer not attached');
    const token = ++this.loadToken;
    this.zone.run(() => {
      this.loading.set({ loaded: 0, total: 0 });
      this.loaded.set(false);
      this.error.set(null);
      this.selection.set(null);
      this.hover.set(null);
      this.labels.set([]);
    });
    try {
      await this.viewer.load(manifest, { restore: opts?.restore });
      if (token !== this.loadToken) return;
    } catch (err) {
      if (token !== this.loadToken) return;
      // ошибка уже эмитнута ядром через событие 'error' → поле this.error заполнено
      throw err;
    }
  }

  async preload(manifest: SceneManifest): Promise<void> {
    if (!this.viewer) return;
    try {
      await this.viewer.preload(manifest);
    } catch {
      // предзагрузка молча падает — не блокирует UX
    }
  }

  select(sel: Selection | null, opts?: { fly?: boolean }): void {
    this.viewer?.select(sel, opts);
  }

  /** Программное наведение (сноска подсвечивает меш и наоборот). */
  setHover(sel: Selection | null): void {
    this.viewer?.hover(sel);
  }

  setOptions(o: Partial<ViewerOptions>): void {
    this.viewer?.setOptions(o);
  }

  setViewportInsets(ins: ViewportInsets): void {
    this.viewer?.setViewportInsets(ins);
  }

  resetCamera(): void {
    this.viewer?.resetCamera();
  }

  /** Точка поверхности под курсором в координатах модели (для ?debug=manifest). */
  pickSurface(clientX: number, clientY: number): Vec3 | null {
    return this.viewer?.pickSurface(clientX, clientY) ?? null;
  }

  getViewState(): ViewState | null {
    return this.viewer ? this.viewer.getViewState() : null;
  }

  restoreViewState(s: ViewState): void {
    this.viewer?.restoreViewState(s);
  }

  resize(width: number, height: number, dpr: number): void {
    this.viewer?.resize(width, height, dpr);
  }

  private onEvent(e: ViewerEvent): void {
    this.zone.run(() => {
      switch (e.type) {
        case 'hover':
          this.hover.set(e.selection);
          return;
        case 'select':
          this.selection.set(e.selection);
          return;
        case 'open-detail':
          this.openDetailRequest.set({
            partId: e.partId,
            detailId: e.detailId,
            seq: ++this.detailSeq,
          });
          return;
        case 'load-progress':
          this.loading.set({ loaded: e.loaded, total: e.total });
          return;
        case 'loaded':
          this.loading.set(null);
          this.loaded.set(true);
          return;
        case 'error':
          this.loading.set(null);
          this.error.set(e.error);
          return;
      }
    });
  }

  private resetState(): void {
    this.loading.set(null);
    this.loaded.set(false);
    this.error.set(null);
    this.hover.set(null);
    this.selection.set(null);
    this.openDetailRequest.set(null);
    this.labels.set([]);
  }
}
