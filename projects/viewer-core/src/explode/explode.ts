import { Box3, Matrix3, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import type { PartDef, Vec3 } from '../manifest/schema';

/**
 * Расслоение (explode): целевые смещения частей вычисляются из манифеста
 * каждый раз заново — от исходных позиций, без накопления (решение 7).
 * Раскладка — решение 34 (`04-viewer-core.md`, «Расслоение»; макет
 * `03-desktop-exploded.png`):
 *
 * - **Столбец** (части без `direction`): ось столбца — «вверх» модели (Y),
 *   столбец стоит сбоку от габаритов модели (по +X; `explodeLayout.side`
 *   переопределяет). Части идут сверху вниз по `explode.order` (по умолчанию —
 *   порядок в `parts`); место части = её габарит по оси столбца + зазор.
 * - **Стопка по направлению** (части с `direction`): части с одним направлением
 *   выкладываются друг за другом от габаритов неподвижных частей (`stay` и без
 *   `explode`) наружу: ближняя грань следующей — за дальней гранью предыдущей
 *   плюс зазор. Зазор — доля габарита неподвижных частей по оси стопки, поэтому
 *   расстояния равномерные и у вытянутых моделей.
 * - `explode.offset` — явное расстояние от исходного положения вдоль
 *   направления; `stay` — на месте; `explode.with: "<partId>"` — едет вместе
 *   с указанной частью, своего места не получает
 *   (05-manifest.md, «Расслоение вместе с другой частью»).
 */

const GAP_RATIO = 0.25;
const STACK_GAP_RATIO = 0.15;
const EPS = 1e-6;
const FALLBACK_SIDE = new Vector3(1, 0, 0);
const COLUMN_AXIS = 1; // Y — «вверх» модели

/** Смещения частей (по partId) в координатах модели. */
export type ExplodeTargets = Map<string, Vector3>;

const box = new Box3();
const box2 = new Box3();
const invRoot = new Matrix4();

/** Габариты модели в её локальных координатах. */
function modelBounds(root: Object3D): Box3 {
  root.updateMatrixWorld(true);
  invRoot.copy(root.matrixWorld).invert();
  box.setFromObject(root).applyMatrix4(invRoot);
  return box;
}

/** Габариты набора узлов в координатах модели. */
function partBounds(roots: Object3D[], root: Object3D): Box3 {
  const out = new Box3().makeEmpty();
  invRoot.copy(root.matrixWorld).invert();
  for (const r of roots) {
    box2.setFromObject(r).applyMatrix4(invRoot);
    out.union(box2);
  }
  return out;
}

/** Диапазон проекции габаритов на направление (t = dot(point, dir)). */
function projectBox(b: Box3, dir: Vector3): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 8; i++) {
    const t =
      (i & 1 ? b.max.x : b.min.x) * dir.x +
      (i & 2 ? b.max.y : b.min.y) * dir.y +
      (i & 4 ? b.max.z : b.min.z) * dir.z;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return { min, max };
}

interface MovingPart {
  part: PartDef;
  index: number;
  explode: NonNullable<PartDef['explode']>;
  bounds: Box3;
}

function byOrder(a: MovingPart, b: MovingPart): number {
  return (a.explode.order ?? a.index) - (b.explode.order ?? b.index);
}

/**
 * Целевые смещения частей с `explode` (кроме `stay`), в координатах модели.
 * Части без `explode` в результат не попадают — они остаются на месте.
 */
export function computeExplodeTargets(
  parts: PartDef[],
  partRoots: Map<string, Object3D[]>,
  root: Object3D,
  layout?: { side?: Vec3 },
): ExplodeTargets {
  const targets: ExplodeTargets = new Map();
  const moving = parts.filter(
    (p): p is PartDef & { explode: NonNullable<PartDef['explode']> } =>
      !!p.explode && !p.explode.stay && !p.explode.with,
  );
  if (moving.length === 0) return targets;

  const model = modelBounds(root);
  if (model.isEmpty()) return targets;

  // Габариты неподвижных частей (stay и без explode) — база, от которой
  // откладываются стопки. Пусто (не считая фона) — берём габариты модели.
  const stationary = new Box3().makeEmpty();
  for (const p of parts) {
    if (p.explode && !p.explode.stay) continue;
    const b = partBounds(partRoots.get(p.id) ?? [], root);
    if (!b.isEmpty()) stationary.union(b);
  }
  const base = stationary.isEmpty() ? model : stationary;

  const toMoving = (p: PartDef): MovingPart => ({
    part: p,
    index: parts.indexOf(p),
    explode: p.explode!,
    bounds: partBounds(partRoots.get(p.id) ?? [], root),
  });
  const columnParts = moving.filter((p) => !p.explode.direction).map(toMoving).sort(byOrder);
  const stackParts = moving.filter((p) => p.explode.direction).map(toMoving);

  // --- Столбец сбоку от модели, части сверху вниз ---
  if (columnParts.length > 0) {
    const side = layout?.side ? new Vector3(...layout.side) : FALLBACK_SIDE.clone();
    if (side.lengthSq() < EPS) side.copy(FALLBACK_SIDE);
    side.normalize();
    // Доминантная ось направления «в сторону» и оставшаяся поперечная ось.
    const sideAxis = [Math.abs(side.x), Math.abs(side.y), Math.abs(side.z)].indexOf(
      Math.max(Math.abs(side.x), Math.abs(side.y), Math.abs(side.z)),
    );
    const remAxis = 3 - sideAxis - COLUMN_AXIS;
    const sideSign = side.getComponent(sideAxis) >= 0 ? 1 : -1;
    const gap = Math.max(
      (model.max.getComponent(COLUMN_AXIS) - model.min.getComponent(COLUMN_AXIS)) * GAP_RATIO,
      1e-3,
    );
    // Линия столбца: за гранью модели по side + зазор + половина ширины
    // самой широкой части — чтобы части гарантированно не пересекали модель.
    let maxHalfWidth = 0;
    for (const { bounds } of columnParts) {
      if (bounds.isEmpty()) continue;
      maxHalfWidth = Math.max(
        maxHalfWidth,
        (bounds.max.getComponent(sideAxis) - bounds.min.getComponent(sideAxis)) / 2,
      );
    }
    const face =
      (sideSign > 0 ? model.max.getComponent(sideAxis) : model.min.getComponent(sideAxis)) +
      sideSign * (gap + maxHalfWidth);
    const line = new Vector3();
    line.setComponent(sideAxis, face);
    line.setComponent(remAxis, (model.max.getComponent(remAxis) + model.min.getComponent(remAxis)) / 2);

    // Общая высота столбца — сумма габаритов частей по оси + зазоры между.
    const heights = columnParts.map(({ bounds }) =>
      bounds.isEmpty() ? 0 : bounds.max.getComponent(COLUMN_AXIS) - bounds.min.getComponent(COLUMN_AXIS),
    );
    const total = heights.reduce((a, h) => a + h, 0) + gap * columnParts.length;
    let top = (model.max.getComponent(COLUMN_AXIS) + model.min.getComponent(COLUMN_AXIS)) / 2 + total / 2;
    const c = new Vector3();
    columnParts.forEach(({ part, bounds }, i) => {
      const h = heights[i];
      const centerY = top - h / 2;
      top -= h + gap;
      c.copy(line).setComponent(COLUMN_AXIS, centerY);
      const partCenter = bounds.isEmpty() ? c : bounds.getCenter(new Vector3());
      targets.set(part.id, c.clone().sub(partCenter));
    });
  }

  // --- Стопки по direction: друг за другом от габаритов базы наружу ---
  const groups = new Map<string, { dir: Vector3; parts: MovingPart[] }>();
  for (const mp of stackParts) {
    const dir = new Vector3(...(mp.explode.direction as Vec3));
    if (dir.lengthSq() < EPS) continue;
    dir.normalize();
    const key = `${dir.x.toFixed(4)},${dir.y.toFixed(4)},${dir.z.toFixed(4)}`;
    let g = groups.get(key);
    if (!g) {
      g = { dir, parts: [] };
      groups.set(key, g);
    }
    g.parts.push(mp);
  }
  for (const { dir, parts: groupParts } of groups.values()) {
    groupParts.sort(byOrder);
    const baseProj = projectBox(base, dir);
    const gap = Math.max((baseProj.max - baseProj.min) * STACK_GAP_RATIO, 1e-3);
    let cursor = baseProj.max;
    for (const { part, explode, bounds } of groupParts) {
      if (explode.offset != null) {
        targets.set(part.id, dir.clone().multiplyScalar(explode.offset));
        continue;
      }
      const proj = bounds.isEmpty() ? { min: 0, max: 0 } : projectBox(bounds, dir);
      const extent = proj.max - proj.min;
      const near = cursor + gap;
      const centerT = near + extent / 2;
      const partCenter = bounds.isEmpty() ? new Vector3() : bounds.getCenter(new Vector3());
      const tC = partCenter.dot(dir);
      targets.set(part.id, dir.clone().multiplyScalar(centerT - tC));
      cursor = near + extent;
    }
  }

  // with: "<partId>" — едет вместе с указанной частью (транзитивно).
  const withParts = parts.filter(
    (p) => p.explode?.with && !p.explode.stay,
  ) as (PartDef & { explode: NonNullable<PartDef['explode']> })[];
  const resolveWith = (part: PartDef, seen: Set<string>): Vector3 | null => {
    const ref = part.explode!.with!;
    if (seen.has(ref)) {
      console.warn(`[viewer-core] explode.with: циклическая ссылка у части "${part.id}"`);
      return null;
    }
    seen.add(ref);
    const target = targets.get(ref);
    if (target) return target;
    const refPart = parts.find((p) => p.id === ref);
    if (refPart?.explode?.with) return resolveWith(refPart, seen);
    return null; // ссылка на stay/неподвижную часть — своя часть тоже остаётся
  };
  for (const part of withParts) {
    const target = resolveWith(part, new Set());
    if (target) targets.set(part.id, target.clone());
    else console.warn(`[viewer-core] explode.with: часть "${part.id}" ссылается на "${part.explode.with}" без позиции расслоения`);
  }

  return targets;
}

/**
 * Привязка смещений к узлам: смещаются только «верхние» корни частей.
 * Корень, вложенный в смещаемый корень другой части, пропускается — он едет
 * вместе с предком (иначе смещение применилось бы дважды; позиции всё равно
 * считаются от исходных, но конфликт родитель/потомок неприемлем).
 * Значения — смещения в локальных координатах родителя узла.
 */
export function buildExplodeBindings(
  targets: ExplodeTargets,
  partRoots: Map<string, Object3D[]>,
  root: Object3D,
): Map<Object3D, Vector3> {
  const bindings = new Map<Object3D, Vector3>();
  const movingRoots = new Set<Object3D>();
  for (const partId of targets.keys()) {
    for (const r of partRoots.get(partId) ?? []) movingRoots.add(r);
  }

  const linear = new Matrix3();
  const rel = new Matrix4();
  invRoot.copy(root.matrixWorld).invert();
  for (const [partId, target] of targets) {
    for (const node of partRoots.get(partId) ?? []) {
      // Вложен ли узел в другой смещаемый корень?
      let ancestor: Object3D | null = node.parent;
      let nested = false;
      while (ancestor) {
        if (movingRoots.has(ancestor)) {
          nested = true;
          break;
        }
        ancestor = ancestor.parent;
      }
      if (nested) continue;
      if (bindings.has(node)) {
        console.warn(`[viewer-core] explode: узел части "${partId}" уже смещён другой частью`);
        continue;
      }
      // Модельные координаты → локальные координаты родителя узла. Обратная
      // матрица ЛИНЕЙНОЙ части (не нормальная — она транспонирована и разворачи-
      // вает направление у повёрнутого родителя, например Sketchfab_model
      // с −90° по X): смещение — вектор, поворот применяем как есть.
      const parent = node.parent ?? root;
      rel.multiplyMatrices(invRoot, parent.matrixWorld);
      linear.setFromMatrix4(rel).invert();
      const local = target.clone().applyMatrix3(linear);
      bindings.set(node, local);
    }
  }
  return bindings;
}

const TAU_SEC = 0.18;
const FACTOR_EPS = 1e-4;

/**
 * Анимация расслоения: плавный множитель 0…1, применяемый к смещениям
 * от исходных позиций. Прерывание на середине — обратный ход от текущего
 * множителя, т. е. от текущей позиции. При prefers-reduced-motion переходы
 * мгновенные. Смещения для сносок — `currentOffset` (цель × текущий множитель).
 */
export class ExplodeAnimator {
  private currentFactor = 0;
  private targetFactor = 0;
  private appliedFactor = -1;
  private readonly originals = new Map<Object3D, Vector3>();
  private reducedMotion = false;

  constructor(
    private readonly targets: ExplodeTargets,
    private readonly bindings: Map<Object3D, Vector3>,
  ) {
    for (const node of bindings.keys()) {
      this.originals.set(node, node.position.clone());
    }
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
    if (enabled) {
      this.currentFactor = this.targetFactor;
      this.apply();
    }
  }

  /** Включить/выключить расслоение. Обратный вызов до завершения — от текущей позиции. */
  setExploded(on: boolean, opts?: { instant?: boolean }): void {
    this.targetFactor = on ? 1 : 0;
    if (this.reducedMotion || opts?.instant) {
      this.currentFactor = this.targetFactor;
      this.apply();
    }
  }

  /** Текущий множитель расслоения (0…1) — для пикинга и прочих порогов. */
  get factor(): number {
    return this.currentFactor;
  }

  /** Смещается ли часть при расслоении (свой слой или with). */
  isDisplaced(partId: string): boolean {
    return this.targets.has(partId);
  }

  /**
   * Габариты всей сцены после ПОЛНОГО раскрытия (мировые координаты) —
   * для вписывания камеры при включении. Временно применяет множитель 1
   * и возвращает прежнее состояние.
   */
  previewBox(root: Object3D): Box3 {
    const prev = this.currentFactor;
    this.currentFactor = 1;
    this.appliedFactor = -1;
    this.apply();
    root.updateMatrixWorld(true);
    const b = new Box3().setFromObject(root);
    this.currentFactor = prev;
    this.appliedFactor = -1;
    this.apply();
    return b;
  }

  /** Габариты набора мешей после полного раскрытия — подлёт к части на новом месте. */
  previewMeshesBox(meshes: Mesh[]): Box3 {
    const prev = this.currentFactor;
    this.currentFactor = 1;
    this.appliedFactor = -1;
    this.apply();
    const out = new Box3().makeEmpty();
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      out.union(new Box3().setFromObject(m));
    }
    this.currentFactor = prev;
    this.appliedFactor = -1;
    this.apply();
    return out;
  }

  /** true, пока позиции ещё сближаются с целью — нужен следующий кадр. */
  update(dt: number): boolean {
    if (this.reducedMotion) return false;
    if (Math.abs(this.targetFactor - this.currentFactor) < FACTOR_EPS) {
      if (this.appliedFactor !== this.currentFactor) this.apply();
      return false;
    }
    const alpha = 1 - Math.exp(-dt / TAU_SEC);
    this.currentFactor += (this.targetFactor - this.currentFactor) * alpha;
    if (Math.abs(this.targetFactor - this.currentFactor) < FACTOR_EPS) this.currentFactor = this.targetFactor;
    this.apply();
    return true;
  }

  /** Текущее смещение части (для сносок/пикинга) — цель × текущий множитель. */
  currentOffset(partId: string): Vector3 | null {
    const target = this.targets.get(partId);
    if (!target) return null;
    return target.clone().multiplyScalar(this.currentFactor);
  }

  /** Позиции узлов на текущем кадре анимации — всегда исходные + смещение × множитель. */
  private apply(): void {
    if (this.appliedFactor === this.currentFactor) return;
    this.appliedFactor = this.currentFactor;
    for (const [node, local] of this.bindings) {
      const original = this.originals.get(node);
      if (!original) continue;
      node.position.copy(original).addScaledVector(local, this.currentFactor);
    }
  }

  /** Вернуть узлы в исходные позиции (при смене манифеста / dispose). */
  restore(): void {
    this.currentFactor = 0;
    this.targetFactor = 0;
    this.appliedFactor = -1;
    for (const [node, original] of this.originals) {
      node.position.copy(original);
    }
  }
}
