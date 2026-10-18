import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import type CameraControls from 'camera-controls';
import { applyViewState, captureViewState, type ViewStateContext, type ViewerOptions } from './view-state';
import { ViewerError } from './manifest/errors';

function makeControls(pos: [number, number, number], target: [number, number, number]) {
  const setLookAt = vi.fn();
  const controls = {
    getPosition: (out: Vector3) => out.set(...pos),
    getTarget: (out: Vector3) => out.set(...target),
    setLookAt,
  } as unknown as CameraControls;
  return { controls, setLookAt };
}

function makeCtx(overrides: Partial<ViewStateContext> = {}): ViewStateContext & {
  setOptions: ReturnType<typeof vi.fn>;
  setSelection: ReturnType<typeof vi.fn>;
} {
  const opts: ViewerOptions = { labels: true, exploded: false, hover: true, isolate: false };
  const ctx = {
    manifestId: 'animal-cell',
    controls: makeControls([1, 2, 3], [4, 5, 6]).controls,
    options: opts,
    selection: null,
    setOptions: vi.fn(),
    setSelection: vi.fn(),
    ...overrides,
  } as ViewStateContext & {
    setOptions: ReturnType<typeof vi.fn>;
    setSelection: ReturnType<typeof vi.fn>;
  };
  return ctx;
}

describe('view-state', () => {
  it('capture возвращает текущие камеру, опции, выбор и manifestId', () => {
    const ctx = makeCtx({
      selection: { partId: 'nucleus' },
    });
    const s = captureViewState(ctx);
    expect(s.manifestId).toBe('animal-cell');
    expect(s.camera.position).toEqual([1, 2, 3]);
    expect(s.camera.target).toEqual([4, 5, 6]);
    expect(s.selection).toEqual({ partId: 'nucleus' });
    expect(s.options.hover).toBe(true);
  });

  it('apply вызывает setLookAt, setOptions и setSelection с восстановленными значениями', () => {
    const { controls, setLookAt } = makeControls([0, 0, 0], [0, 0, 0]);
    const ctx = makeCtx({ controls });
    applyViewState(ctx, {
      manifestId: 'animal-cell',
      camera: { position: [7, 8, 9], target: [10, 11, 12] },
      options: { labels: false, exploded: true, hover: false, isolate: true },
      selection: { partId: 'mito', instance: 'Mitochondrion.2' },
    });
    expect(setLookAt).toHaveBeenCalledWith(7, 8, 9, 10, 11, 12, false);
    expect(ctx.setOptions).toHaveBeenCalledWith({
      labels: false,
      exploded: true,
      hover: false,
      isolate: true,
    });
    expect(ctx.setSelection).toHaveBeenCalledWith(
      { partId: 'mito', instance: 'Mitochondrion.2' },
      { fly: false },
    );
  });

  it('apply бросает ViewerError с кодом view-state-manifest-mismatch, если id не совпадает', () => {
    const ctx = makeCtx({ manifestId: 'animal-cell' });
    expect(() =>
      applyViewState(ctx, {
        manifestId: 'nucleus',
        camera: { position: [0, 0, 0], target: [0, 0, 0] },
        options: { labels: true, exploded: false, hover: true, isolate: false },
        selection: null,
      }),
    ).toThrow(ViewerError);
  });

  it('capture бросает ViewerError, если манифест не загружен', () => {
    const ctx = makeCtx({ manifestId: null });
    expect(() => captureViewState(ctx)).toThrow(ViewerError);
  });
});
