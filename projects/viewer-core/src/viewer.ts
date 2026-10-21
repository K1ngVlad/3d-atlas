import {
  Box3,
  Clock,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import CameraControls from 'camera-controls';
import { parseGltf, type LoadedModel } from './scene/load-gltf';
import { defaultFetchModel, type FetchModel } from './scene/fetch-model';
import { createModelCache, type ModelCache } from './scene/model-cache';
import { pickPart } from './picking/raycast';
import { attachClickDetector } from './picking/click-detector';
import { VisualState } from './highlight/visual-state';
import { fitToObject, flyToMeshes, ZERO_INSETS, type ViewportInsets } from './camera/fit';
import {
  resolveManifest,
  resetModelVisibility,
  partKey,
  type ResolvedManifest,
} from './manifest/resolve-selectors';
import type { SceneManifest, PickMode, MaterialOverride, Vec3 } from './manifest/schema';
import { detailId as readDetailId } from './manifest/schema';
import {
  applyViewState,
  captureViewState,
  DEFAULT_OPTIONS,
  type Selection,
  type ViewerOptions,
  type ViewState,
  type ViewStateContext,
} from './view-state';
import { ViewerError } from './manifest/errors';
import { resolveLabelAnchors, type LabelAnchor } from './labels/label-anchors';
import { LabelTracker, type LabelPosition } from './labels/project';
import { pickSurfacePoint } from './picking/surface';

export type { Selection, ViewerOptions, ViewState } from './view-state';
export type { LabelPosition } from './labels/project';

export type ViewerEvent =
  | { type: 'hover'; selection: Selection | null }
  | { type: 'select'; selection: Selection | null }
  | { type: 'open-detail'; partId: string; detailId: string }
  | { type: 'load-progress'; loaded: number; total: number }
  | { type: 'loaded' }
  | { type: 'error'; error: ViewerError };

export interface ViewerConfig {
  fetchModel?: FetchModel;
}

export interface Viewer {
  load(
    manifest: SceneManifest,
    opts?: { signal?: AbortSignal; restore?: ViewState },
  ): Promise<void>;
  preload(manifest: SceneManifest, opts?: { signal?: AbortSignal }): Promise<void>;
  select(selection: Selection | null, opts?: { fly?: boolean }): void;
  hover(selection: Selection | null): void;
  listInstances(partId: string): string[];
  setOptions(o: Partial<ViewerOptions>): void;
  setViewportInsets(i: Partial<ViewportInsets>): void;
  resetCamera(): void;
  getViewState(): ViewState;
  restoreViewState(s: ViewState): void;
  getLabelPositions(): LabelPosition[];
  /**
   * Точка поверхности модели под экранными координатами, в координатах
   * модели — для `label.anchor` в ?debug=manifest (Shift+клик).
   */
  pickSurface(clientX: number, clientY: number): Vec3 | null;
  on(listener: (e: ViewerEvent) => void): () => void;
  onFrame(listener: (labels: LabelPosition[]) => void): () => void;
  resize(width: number, height: number, dpr: number): void;
  dispose(): void;
}

let controlsInstalled = false;
function installCameraControls(): void {
  if (controlsInstalled) return;
  CameraControls.install({
    THREE: {
      Vector2,
      Vector3,
      Vector4,
      Quaternion,
      Matrix4,
      Spherical,
      Box3,
      Sphere,
      Raycaster,
    },
  });
  controlsInstalled = true;
}

export function createViewer(canvas: HTMLCanvasElement, config: ViewerConfig = {}): Viewer {
  installCameraControls();

  // alpha + прозрачный clear: фон рисует CSS хоста (viewer-host / sandbox),
  // а не сцена — иначе scene.background перекрывает --atlas-color-canvas
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);

  const scene = new Scene();

  const camera = new PerspectiveCamera(45, 1, 0.01, 1000);
  camera.position.set(0, 0, 5);

  scene.add(new HemisphereLight(0xffffff, 0x222233, 0.9));
  const dir = new DirectionalLight(0xffffff, 1.1);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  const controls = new CameraControls(camera, canvas);
  controls.dollySpeed = 0.6;

  const clock = new Clock();
  const cache: ModelCache = createModelCache({
    fetchModel: config.fetchModel ?? defaultFetchModel,
    parse: parseGltf,
  });

  const listeners = new Set<(e: ViewerEvent) => void>();
  const frameListeners = new Set<(labels: LabelPosition[]) => void>();
  const emit = (e: ViewerEvent) => {
    for (const l of listeners) l(e);
  };

  let activeManifest: SceneManifest | null = null;
  let activeModel: LoadedModel | null = null;
  let resolved: ResolvedManifest | null = null;
  let visual: VisualState | null = null;
  let partPickMode = new Map<string, PickMode>();
  let partDetail = new Map<string, string>();
  let partHoverable = new Map<string, boolean>();

  let options: ViewerOptions = { ...DEFAULT_OPTIONS };
  let insets: ViewportInsets = { ...ZERO_INSETS };
  let selection: Selection | null = null;
  let hoverSel: Selection | null = null;

  // Сноски: якоря текущего манифеста, трекер выбора кандидатов и
  // троттлинг пересчёта окклюзии (raycast к кандидатам).
  let anchors: LabelAnchor[] = [];
  let tracker: LabelTracker | null = null;
  let lastOcclusionAt = 0;
  // Снапшот «последнее уведомление было пустым»: пустой массив шлём один раз
  // на переход (сноски выключены / якорей нет / смена манифеста), а не каждый кадр.
  let notifiedEmpty = true;

  let needsRender = true;
  let running = true;
  let rafId = 0;
  // Токен активации: load увеличивает; устаревшая активация бросает load-aborted
  // до мутации сцены. Сетевой fetch при этом не абортируется — inflight-промис
  // в model-cache общий для всех ожидающих (см. roadmap, «Долг после шага 3»).
  let loadSeq = 0;

  const requestRender = () => {
    needsRender = true;
  };
  controls.addEventListener('update', requestRender);

  const applyVisualTargets = () => {
    if (!visual) return;
    const canHover =
      options.hover && hoverSel !== null && (partHoverable.get(hoverSel.partId) ?? true);
    visual.setTargets({
      hover: canHover && hoverSel ? partKey(hoverSel.partId, hoverSel.instance) : null,
      selected: selection ? partKey(selection.partId, selection.instance) : null,
      dimOthers: selection !== null && options.isolate,
    });
    requestRender();
  };

  // Проекция сносок: дёшево — каждый отрисованный кадр; окклюзия (raycast) —
  // не чаще, чем раз в OCCLUSION_THROTTLE_MS, иначе из кэша.
  const OCCLUSION_THROTTLE_MS = 150;
  const computeLabels = (forceOcclusion = false) => {
    const now = performance.now();
    const refresh = forceOcclusion || now - lastOcclusionAt > OCCLUSION_THROTTLE_MS;
    if (refresh) lastOcclusionAt = now;
    return tracker!.update(
      camera,
      { width: canvas.clientWidth || 1, height: canvas.clientHeight || 1 },
      now,
      refresh,
    );
  };
  const emitLabels = (labels: LabelPosition[]) => {
    for (const l of frameListeners) l(labels);
  };
  // Слушатели вызываются только на отрисованных кадрах. Пустой массив шлём
  // один раз на переход (сноски выключены / якорей нет / смена манифеста),
  // а не каждый кадр (roadmap, «Долг после шага 3»).
  const notifyFrameListeners = () => {
    if (!options.labels || anchors.length === 0 || !activeModel) {
      if (!notifiedEmpty) {
        notifiedEmpty = true;
        emitLabels([]);
      }
      return;
    }
    notifiedEmpty = false;
    emitLabels(computeLabels());
  };

  const render = () => {
    if (!running) return;
    rafId = requestAnimationFrame(render);
    const dt = clock.getDelta();
    const controlsUpdated = controls.update(dt);
    const visualAnimating = visual ? visual.update(dt) : false;
    if (controlsUpdated || visualAnimating || needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
      // Слушатели кадра — только когда кадр реально отрисован
      if (frameListeners.size > 0) notifyFrameListeners();
    }
    if (visualAnimating) needsRender = true;
  };
  render();

  // Hover
  const onPointerMove = (ev: PointerEvent) => {
    if (!resolved || !activeModel) return;
    if (!options.hover) {
      if (hoverSel) {
        hoverSel = null;
        applyVisualTargets();
        emit({ type: 'hover', selection: null });
      }
      return;
    }
    const sel = raycastSelection(ev);
    if (sameSelection(sel, hoverSel)) return;
    hoverSel = sel;
    applyVisualTargets();
    emit({ type: 'hover', selection: sel });
  };
  const onPointerLeave = () => {
    if (hoverSel) {
      hoverSel = null;
      applyVisualTargets();
      emit({ type: 'hover', selection: null });
    }
  };
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);

  // Правый клик — сброс выделения и камеры. Перетаскивание правой кнопкой
  // (пан/вращение) кликом не считается. contextmenu всегда preventDefault,
  // чтобы при любой правой кнопке в холсте не вылезало системное меню.
  const onContextMenu = (ev: MouseEvent) => ev.preventDefault();
  canvas.addEventListener('contextmenu', onContextMenu);
  let rightDown: { x: number; y: number; maxMove: number } | null = null;
  const RIGHT_DRAG_THRESHOLD = 4;
  const onRightDown = (ev: PointerEvent) => {
    if (ev.button !== 2) return;
    rightDown = { x: ev.clientX, y: ev.clientY, maxMove: 0 };
  };
  const onRightMove = (ev: PointerEvent) => {
    if (!rightDown) return;
    const d = Math.hypot(ev.clientX - rightDown.x, ev.clientY - rightDown.y);
    if (d > rightDown.maxMove) rightDown.maxMove = d;
  };
  const onRightUp = (ev: PointerEvent) => {
    if (ev.button !== 2 || !rightDown) return;
    const wasClick = rightDown.maxMove <= RIGHT_DRAG_THRESHOLD;
    rightDown = null;
    if (wasClick) setSelection(null, { fly: true });
  };
  canvas.addEventListener('pointerdown', onRightDown);
  canvas.addEventListener('pointermove', onRightMove);
  canvas.addEventListener('pointerup', onRightUp);

  // Click / double-click
  const detachClicks = attachClickDetector(canvas, {
    onSingle: (ev) => {
      if (!resolved) return;
      const sel = raycastSelection(ev);
      if (sel && selection && sameSelection(sel, selection)) {
        tryOpenDetail(sel);
        return;
      }
      setSelection(sel, { fly: true });
    },
    onDouble: (ev) => {
      if (!resolved) return;
      const sel = raycastSelection(ev);
      if (!sel) return;
      // Если у части есть detail, двойной клик — переход; тратить время
      // на подлёт камеры к органоиду не нужно (приложение сохранит текущее
      // стабильное состояние уровня в стек и уйдёт на новый манифест).
      const hasDetail = partDetail.has(sel.partId);
      if (!sameSelection(sel, selection)) setSelection(sel, { fly: !hasDetail });
      tryOpenDetail(sel);
    },
  });

  const raycastSelection = (ev: PointerEvent): Selection | null => {
    if (!resolved || !activeModel) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    const hit = pickPart(
      activeModel.root,
      camera,
      x,
      y,
      resolved.meshBindings,
      resolved.defaults.pick,
      (id) => partPickMode.get(id) ?? resolved!.defaults.pick,
    );
    return hit ? { partId: hit.partId, instance: hit.instance } : null;
  };

  const flyToSelection = (sel: Selection) => {
    if (!resolved) return;
    const meshes = resolved.partMeshes.get(partKey(sel.partId, sel.instance));
    if (!meshes || meshes.length === 0) return;
    flyToMeshes(controls, camera, meshes, insets, canvas);
  };

  const setSelection = (sel: Selection | null, opts: { fly: boolean }) => {
    const changed = !sameSelection(sel, selection);
    selection = sel;
    applyVisualTargets();
    if (opts.fly) {
      if (sel) flyToSelection(sel);
      else if (activeModel) fitToObject(controls, camera, activeModel.root);
    }
    if (changed) emit({ type: 'select', selection });
  };

  const tryOpenDetail = (sel: Selection) => {
    const did = partDetail.get(sel.partId);
    if (!did) {
      console.warn(`[viewer-core] у части "${sel.partId}" нет detail`);
      return;
    }
    emit({ type: 'open-detail', partId: sel.partId, detailId: did });
  };

  const buildPartMaps = (manifest: SceneManifest) => {
    const defHoverable = manifest.defaults?.hoverable ?? true;
    partPickMode = new Map(
      manifest.parts.map((p) => [p.id, (p.pick ?? manifest.defaults?.pick ?? 'block') as PickMode]),
    );
    partDetail = new Map();
    partHoverable = new Map();
    for (const p of manifest.parts) {
      const d = readDetailId(p.detail);
      if (d) partDetail.set(p.id, d);
      partHoverable.set(p.id, p.hoverable ?? defHoverable);
    }
  };

  const collectOverrides = (manifest: SceneManifest): Map<string, MaterialOverride> => {
    const map = new Map<string, MaterialOverride>();
    for (const p of manifest.parts) {
      if (p.material) map.set(p.id, p.material);
    }
    return map;
  };

  const applyCamera = (manifest: SceneManifest, root: LoadedModel['root']) => {
    const cam = manifest.camera;
    if (cam?.position && cam?.target) {
      controls.setLookAt(...cam.position, ...cam.target, false);
    } else {
      fitToObject(controls, camera, root, true);
    }
    if (cam?.minDistance != null) controls.minDistance = cam.minDistance;
    if (cam?.maxDistance != null) controls.maxDistance = cam.maxDistance;
  };

  const releaseActive = (goingToSameModel: boolean) => {
    if (visual) {
      visual.dispose();
      visual = null;
    }
    if (activeModel) {
      if (!goingToSameModel) {
        scene.remove(activeModel.root);
      }
      resetModelVisibility(activeModel.root);
    }
    resolved = null;
    selection = null;
    hoverSel = null;
  };

  const activateManifest = async (
    manifest: SceneManifest,
    isCurrent: () => boolean,
    signal?: AbortSignal,
    restore?: ViewState,
  ) => {
    const url = manifest.model.url;
    const cachedBefore = cache.has(url);
    const loaded = await cache.getOrLoad(url, {
      signal,
      onProgress: (l, t) => emit({ type: 'load-progress', loaded: l, total: t }),
    });
    // Пока грузилась модель, пришёл новый load — эту активацию отменяем
    if (!isCurrent()) {
      throw new ViewerError('load-aborted', `load superseded: ${manifest.id}`);
    }
    const sameModel = activeModel === loaded;
    releaseActive(sameModel);
    if (!sameModel) {
      scene.add(loaded.root);
      activeModel = loaded;
    }
    resolved = resolveManifest(manifest, loaded.root, loaded.originalNames);
    anchors = resolveLabelAnchors(manifest, resolved, loaded.root);
    // «Прозрачность насквозь» для окклюзии берётся из baseline: override
    // манифеста или исходный материал. VisualState ещё не создан — после
    // releaseActive mesh.material — оригинал glTF, а не клон с анимацией dim.
    const overrides = collectOverrides(manifest);
    const seeThrough = new Set<Mesh>();
    loaded.root.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const binding = resolved!.meshBindings.get(mesh);
      const ov = binding ? overrides.get(binding.partId) : undefined;
      const mat = mesh.material as { opacity?: number; transparent?: boolean };
      const opacity = ov?.opacity ?? mat.opacity ?? 1;
      const transparent = ov ? opacity < 1 : mat.transparent === true;
      if (transparent && opacity < 0.95) seeThrough.add(mesh);
    });
    tracker = new LabelTracker(anchors, {
      root: loaded.root,
      isSeeThrough: (m) => seeThrough.has(m),
    });
    // переход в новое состояние сносок: если якорей нет, приложение получит [] один раз
    notifiedEmpty = false;
    const unbound: Mesh[] = [];
    loaded.root.traverse((obj) => {
      const m = obj as Mesh;
      if (!m.isMesh || !m.visible) return;
      if (!resolved!.meshBindings.has(m)) unbound.push(m);
    });
    visual = new VisualState(resolved.partMeshes, overrides, unbound);
    buildPartMaps(manifest);
    activeManifest = manifest;
    // Если передано restored состояние, применяем его СРАЗУ (ещё до первого кадра
    // после scene.add) — иначе RAF успеет отрисовать камеру из манифеста и мелькнёт.
    if (restore && restore.manifestId === manifest.id) {
      const [px, py, pz] = restore.camera.position;
      const [tx, ty, tz] = restore.camera.target;
      controls.setLookAt(px, py, pz, tx, ty, tz, false);
      options = { ...options, ...restore.options };
      selection = restore.selection ? { ...restore.selection } : null;
    } else {
      applyCamera(manifest, loaded.root);
    }
    applyVisualTargets();
    requestRender();
    // Если модель только что подгружена в этом вызове, прогресса ещё раз не шлём —
    // достаточно того, что уже вылетело из onProgress; теперь — финальный loaded.
    void cachedBefore;
    emit({ type: 'loaded' });
  };

  const ctx: ViewStateContext = {
    get manifestId() {
      return activeManifest?.id ?? null;
    },
    controls,
    get options() {
      return options;
    },
    get selection() {
      return selection;
    },
    setOptions(o) {
      options = { ...options, ...o };
      applyVisualTargets();
    },
    setSelection(sel, o) {
      setSelection(sel, { fly: o.fly });
    },
  };

  return {
    async load(manifest, opts) {
      const seq = ++loadSeq;
      try {
        await activateManifest(manifest, () => seq === loadSeq, opts?.signal, opts?.restore);
      } catch (err) {
        // Устаревшая активация, отменённая более новым load — не ошибка
        if (err instanceof ViewerError && err.code === 'load-aborted' && seq !== loadSeq) return;
        const e =
          err instanceof ViewerError ? err : new ViewerError('model-fetch-failed', (err as Error).message, err);
        emit({ type: 'error', error: e });
        throw e;
      }
    },
    async preload(manifest, opts) {
      try {
        await cache.getOrLoad(manifest.model.url, {
          signal: opts?.signal,
          onProgress: (l, t) => emit({ type: 'load-progress', loaded: l, total: t }),
        });
      } catch (err) {
        const e =
          err instanceof ViewerError ? err : new ViewerError('model-fetch-failed', (err as Error).message, err);
        emit({ type: 'error', error: e });
        throw e;
      }
    },
    select(sel, o) {
      setSelection(sel, { fly: o?.fly ?? false });
    },
    hover(sel) {
      hoverSel = sel;
      applyVisualTargets();
      emit({ type: 'hover', selection: sel });
    },
    listInstances(partId) {
      if (!resolved) return [];
      const result: string[] = [];
      for (const key of resolved.orderedKeys) {
        if (key === partId) result.push('');
        else if (key.startsWith(partId + '::')) result.push(key.slice(partId.length + 2));
      }
      return result;
    },
    setOptions(o) {
      ctx.setOptions(o);
    },
    setViewportInsets(i) {
      insets = { ...insets, ...i };
    },
    resetCamera() {
      if (activeModel) fitToObject(controls, camera, activeModel.root);
    },
    getViewState() {
      return captureViewState(ctx);
    },
    restoreViewState(s) {
      try {
        applyViewState(ctx, s);
      } catch (err) {
        if (err instanceof ViewerError) {
          emit({ type: 'error', error: err });
          return;
        }
        throw err;
      }
    },
    getLabelPositions() {
      if (!options.labels || anchors.length === 0 || !activeModel) return [];
      return computeLabels(true);
    },
    pickSurface(clientX, clientY) {
      if (!activeModel) return null;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const x = ((clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
      return pickSurfacePoint(activeModel.root, camera, x, y);
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onFrame(listener) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    resize(width, height, dpr) {
      renderer.setPixelRatio(Math.min(dpr, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      requestRender();
    },
    dispose() {
      loadSeq++;
      running = false;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('pointerdown', onRightDown);
      canvas.removeEventListener('pointermove', onRightMove);
      canvas.removeEventListener('pointerup', onRightUp);
      detachClicks();
      controls.removeEventListener('update', requestRender);
      controls.dispose();
      if (visual) visual.dispose();
      cache.dispose();
      renderer.dispose();
      listeners.clear();
      frameListeners.clear();
    },
  };
}

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.partId === b.partId && a.instance === b.instance;
}
