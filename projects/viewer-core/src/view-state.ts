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

/** Опции уровня — сбрасываются при `load` без `restore`; общие переносятся между уровнями. */
export const LEVEL_OPTION_KEYS = ['exploded', 'isolate'] as const;

/**
 * Опции вида — единый источник состояния (решение 36): хранит ядро, любое
 * изменение (setOptions, restoreViewState, load, сброс уровня) уходит наружу
 * через onChange, приложение лишь отражает его в сигналах.
 */
export class ViewOptions {
  private current: ViewerOptions;

  constructor(
    private readonly onChange: (o: ViewerOptions) => void,
    initial: ViewerOptions = { ...DEFAULT_OPTIONS },
  ) {
    this.current = { ...initial };
  }

  get value(): ViewerOptions {
    return this.current;
  }

  set(partial: Partial<ViewerOptions>): void {
    this.current = { ...this.current, ...partial };
    this.onChange({ ...this.current });
  }

  /** `load` без restore: сброс опций уровня, общие (`labels`, `hover`) прежние. */
  resetLevel(): void {
    this.set({ exploded: false, isolate: false });
  }

  /** `restoreViewState`: применяются ТОЛЬКО опции уровня, общие остаются текущими. */
  applyLevel(s: ViewState): void {
    this.set({
      exploded: s.options.exploded,
      isolate: s.options.isolate,
    });
  }
}

export interface Selection {
  partId: string;
  instance?: string;
}

/** Позиция камеры (для `cameraBeforeExplode`). */
export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export interface ViewState {
  manifestId: string;
  camera: { position: Vec3; target: Vec3 };
  options: ViewerOptions;
  selection: Selection | null;
  /** Позиция камеры до включения расслоения (возврат при выключении, решение 35). */
  cameraBeforeExplode?: CameraPose | null;
}

/** Все внутренние ручки состояния, которые нужны для чтения/записи ViewState. */
export interface ViewStateContext {
  readonly manifestId: string | null;
  readonly controls: CameraControls;
  readonly options: ViewerOptions;
  readonly selection: Selection | null;
  readonly cameraBeforeExplode: CameraPose | null;
  setOptions(o: Partial<ViewerOptions>): void;
  setSelection(sel: Selection | null, opts: { fly: boolean }): void;
  setCameraBeforeExplode(pose: CameraPose | null): void;
  /** Расслоение без анимации — при восстановлении состояния до установки камеры. */
  setExplodedInstant(on: boolean): void;
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
    cameraBeforeExplode: ctx.cameraBeforeExplode
      ? {
          position: [...ctx.cameraBeforeExplode.position],
          target: [...ctx.cameraBeforeExplode.target],
        }
      : null,
  };
}

export function applyViewState(ctx: ViewStateContext, s: ViewState): void {
  if (ctx.manifestId !== s.manifestId) {
    throw new ViewerError(
      'view-state-manifest-mismatch',
      `restoreViewState: ожидается манифест "${s.manifestId}", загружен "${ctx.manifestId ?? '—'}"`,
    );
  }
  // Порядок важен: расслоение применяется МГНОВЕННО до установки камеры,
  // позиция «камеры до расслоения» — из состояния (04-viewer-core.md).
  // Опции: восстанавливаются ТОЛЬКО опции уровня (`exploded`, `isolate`),
  // общие (`labels`, `hover`) остаются текущими (решение 36).
  ctx.setOptions({ exploded: s.options.exploded, isolate: s.options.isolate });
  ctx.setExplodedInstant(s.options.exploded);
  ctx.setCameraBeforeExplode(s.cameraBeforeExplode ?? null);
  const [px, py, pz] = s.camera.position;
  const [tx, ty, tz] = s.camera.target;
  ctx.controls.setLookAt(px, py, pz, tx, ty, tz, false);
  ctx.setSelection(s.selection, { fly: false });
}
