import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import type CameraControls from 'camera-controls';
import {
  applyViewState,
  captureViewState,
  ViewOptions,
  type ViewStateContext,
  type ViewerOptions,
} from './view-state';
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
  setCameraBeforeExplode: ReturnType<typeof vi.fn>;
  setExplodedInstant: ReturnType<typeof vi.fn>;
} {
  const opts: ViewerOptions = { labels: true, exploded: false, hover: true, isolate: false };
  const ctx = {
    manifestId: 'animal-cell',
    controls: makeControls([1, 2, 3], [4, 5, 6]).controls,
    options: opts,
    selection: null,
    cameraBeforeExplode: null,
    setOptions: vi.fn(),
    setSelection: vi.fn(),
    setCameraBeforeExplode: vi.fn(),
    setExplodedInstant: vi.fn(),
    ...overrides,
  } as ViewStateContext & {
    setOptions: ReturnType<typeof vi.fn>;
    setSelection: ReturnType<typeof vi.fn>;
    setCameraBeforeExplode: ReturnType<typeof vi.fn>;
    setExplodedInstant: ReturnType<typeof vi.fn>;
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

  it('apply вызывает setLookAt, setOptions (только опции уровня) и setSelection с восстановленными значениями', () => {
    const { controls, setLookAt } = makeControls([0, 0, 0], [0, 0, 0]);
    const ctx = makeCtx({ controls });
    applyViewState(ctx, {
      manifestId: 'animal-cell',
      camera: { position: [7, 8, 9], target: [10, 11, 12] },
      options: { labels: false, exploded: true, hover: false, isolate: true },
      selection: { partId: 'mito', instance: 'Mitochondrion.2' },
    });
    expect(setLookAt).toHaveBeenCalledWith(7, 8, 9, 10, 11, 12, false);
    // общие опции (labels, hover) из состояния НЕ применяются — только уровня
    expect(ctx.setOptions).toHaveBeenCalledWith({ exploded: true, isolate: true });
    expect(ctx.setSelection).toHaveBeenCalledWith(
      { partId: 'mito', instance: 'Mitochondrion.2' },
      { fly: false },
    );
    // расслоение при восстановлении — мгновенно и ДО установки камеры
    expect(ctx.setExplodedInstant).toHaveBeenCalledWith(true);
    expect(ctx.setExplodedInstant.mock.invocationCallOrder[0]).toBeLessThan(
      setLookAt.mock.invocationCallOrder[0],
    );
    expect(ctx.setCameraBeforeExplode).toHaveBeenCalledWith(null);
  });

  it('apply переносит cameraBeforeExplode из состояния', () => {
    const { controls } = makeControls([0, 0, 0], [0, 0, 0]);
    const ctx = makeCtx({ controls });
    applyViewState(ctx, {
      manifestId: 'animal-cell',
      camera: { position: [1, 1, 1], target: [0, 0, 0] },
      options: { labels: true, exploded: true, hover: true, isolate: false },
      selection: null,
      cameraBeforeExplode: { position: [2, 2, 2], target: [0, 1, 0] },
    });
    expect(ctx.setCameraBeforeExplode).toHaveBeenCalledWith({
      position: [2, 2, 2],
      target: [0, 1, 0],
    });
  });

  it('capture включает cameraBeforeExplode из контекста', () => {
    const ctx = makeCtx({
      cameraBeforeExplode: { position: [2, 2, 2], target: [0, 1, 0] },
    });
    const s = captureViewState(ctx);
    expect(s.cameraBeforeExplode).toEqual({ position: [2, 2, 2], target: [0, 1, 0] });
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

describe('ViewOptions (решение 36)', () => {
  const base: ViewerOptions = { labels: true, exploded: false, hover: true, isolate: false };

  it('set меняет опции и шлёт полный снимок наружу', () => {
    const seen: ViewerOptions[] = [];
    const vo = new ViewOptions((o) => seen.push(o), { ...base });
    vo.set({ exploded: true });
    expect(vo.value.exploded).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ labels: true, exploded: true, hover: true, isolate: false });
  });

  it('resetLevel (load без restore): exploded/isolate сброшены, labels/hover прежние', () => {
    // Тест roadmap: exploded: true → load(другой манифест) → exploded === false, labels прежний
    const seen: ViewerOptions[] = [];
    const vo = new ViewOptions((o) => seen.push(o), { ...base });
    vo.set({ exploded: true, isolate: true, labels: false });
    vo.resetLevel();
    expect(vo.value).toEqual({ labels: false, exploded: false, hover: true, isolate: false });
    expect(seen.at(-1)).toEqual(vo.value);
  });

  it('applyLevel (restoreViewState): применяются только опции уровня', () => {
    const seen: ViewerOptions[] = [];
    const vo = new ViewOptions((o) => seen.push(o), { ...base, labels: false });
    vo.applyLevel({
      manifestId: 'x',
      camera: { position: [0, 0, 0], target: [0, 0, 0] },
      options: { labels: true, exploded: true, hover: false, isolate: true },
      selection: null,
    });
    // labels/hover из состояния проигнорированы — общие остаются текущими
    expect(vo.value).toEqual({ labels: false, exploded: true, hover: true, isolate: true });
    expect(seen.at(-1)).toEqual(vo.value);
  });
});
