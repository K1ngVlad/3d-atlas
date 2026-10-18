import { Vector3 } from 'three';
import type CameraControls from 'camera-controls';
import { ViewerError } from './manifest/errors';
import type { Vec3 } from './manifest/schema';

export interface ViewerOptions {
  labels: boolean;
  exploded: boolean;
  hover: boolean;
  isolate: boolean;
}

export const DEFAULT_OPTIONS: ViewerOptions = {
  labels: true,
  exploded: false,
  hover: true,
  isolate: false,
};

export interface Selection {
  partId: string;
  instance?: string;
}

export interface ViewState {
  manifestId: string;
  camera: { position: Vec3; target: Vec3 };
  options: ViewerOptions;
  selection: Selection | null;
}

/** Все внутренние ручки состояния, которые нужны для чтения/записи ViewState. */
export interface ViewStateContext {
  readonly manifestId: string | null;
  readonly controls: CameraControls;
  readonly options: ViewerOptions;
  readonly selection: Selection | null;
  setOptions(o: Partial<ViewerOptions>): void;
  setSelection(sel: Selection | null, opts: { fly: boolean }): void;
}

export function captureViewState(ctx: ViewStateContext): ViewState {
  if (!ctx.manifestId) {
    throw new ViewerError('view-state-manifest-mismatch', 'captureViewState: манифест не загружен');
  }
  const pos = new Vector3();
  const target = new Vector3();
  ctx.controls.getPosition(pos);
  ctx.controls.getTarget(target);
  return {
    manifestId: ctx.manifestId,
    camera: {
      position: [pos.x, pos.y, pos.z],
      target: [target.x, target.y, target.z],
    },
    options: { ...ctx.options },
    selection: ctx.selection ? { ...ctx.selection } : null,
  };
}

export function applyViewState(ctx: ViewStateContext, s: ViewState): void {
  if (ctx.manifestId !== s.manifestId) {
    throw new ViewerError(
      'view-state-manifest-mismatch',
      `restoreViewState: ожидается манифест "${s.manifestId}", загружен "${ctx.manifestId ?? '—'}"`,
    );
  }
  const [px, py, pz] = s.camera.position;
  const [tx, ty, tz] = s.camera.target;
  ctx.controls.setLookAt(px, py, pz, tx, ty, tz, false);
  ctx.setOptions(s.options);
  ctx.setSelection(s.selection, { fly: false });
}
