import { Box3, Matrix3, Matrix4, Object3D, Sphere, Vector3 } from 'three';
import type { PartDef, Vec3 } from '../manifest/schema';

/**
 * Расслоение (explode): целевые смещения частей вычисляются из манифеста
 * каждый раз заново — от исходных позиций, без накопления (решение 7).
 *
 * - направление по умолчанию — от центра модели к центру части;
 *   `explode.direction` переопределяет;
 * - расстояние слоя — от поверхности модели: `R + зазор + idx·шаг`, где idx —
 *   порядок части (по `explode.order`, по умолчанию — порядок в массиве
 *   `parts`), зазор и шаг — доли радиуса модели `R`; вся расслоённая сцена
 *   остаётся компактной (~2,2R). `explode.offset` задаёт расстояние явно;
 * - `explode.stay` — часть остаётся на месте; `explode.with: "<partId>"` —
 *   часть едет вместе с указанной, своего слоя не получает
 *   (05-manifest.md, «Расслоение вместе с другой частью»).
 */

const GAP_RATIO = 0.25;
const STEP_RATIO = 0.2;
const EPS = 1e-6;
const FALLBACK_DIR = new Vector3(0, 1, 0);

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

interface MovingPart {
  part: PartDef;
  index: number;
  explode: NonNullable<PartDef['explode']>;
  bounds: Box3;
}

/**
 * Целевые смещения частей с `explode` (кроме `stay`), в координатах модели.
 * Части без `explode` в результат не попадают — они остаются на месте.
 */
export function computeExplodeTargets(
  parts: PartDef[],
  partRoots: Map<string, Object3D[]>,
  root: Object3D,
): ExplodeTargets {
  const targets: ExplodeTargets = new Map();
  const moving = parts.filter((p) => p.explode && !p.explode.stay && !p.explode.with);
  if (moving.length === 0) return targets;

  const model = modelBounds(root);
  if (model.isEmpty()) return targets;
  const modelSphere = model.getBoundingSphere(new Sphere());
  const gap = Math.max(modelSphere.radius * GAP_RATIO, 1e-3);
  const step = Math.max(modelSphere.radius * STEP_RATIO, 1e-3);

  const withParts = parts.filter(
    (p) => p.explode?.with && !p.explode.stay,
  ) as (PartDef & { explode: NonNullable<PartDef['explode']> })[];

  // Порядок в столбце: order из манифеста, по умолчанию — индекс в parts.
  const ordered: MovingPart[] = moving
    .map((part) => {
      const bounds = partBounds(partRoots.get(part.id) ?? [], root);
      return { part, index: parts.indexOf(part), explode: part.explode!, bounds };
    })
    .sort((a, b) => (a.explode.order ?? a.index) - (b.explode.order ?? b.index));

  // Слои от поверхности модели: расстояние растёт с порядком части (шаг — доля
  // радиуса модели), чтобы расслоённая сцена оставалась компактной. Расстояние
  // — от центра модели вдоль направления части.
  for (let idx = 0; idx < ordered.length; idx++) {
    const { part, explode, bounds } = ordered[idx];
    const partCenter = bounds.isEmpty() ? modelSphere.center.clone() : bounds.getCenter(new Vector3());
    let dir: Vector3;
    if (explode.direction) {
      dir = new Vector3(...(explode.direction as Vec3));
      if (dir.lengthSq() < EPS) dir.copy(FALLBACK_DIR);
      else dir.normalize();
    } else {
      dir = partCenter.clone().sub(modelSphere.center);
      if (dir.lengthSq() < EPS) dir.copy(FALLBACK_DIR);
      else dir.normalize();
    }
    const dist = explode.offset ?? modelSphere.radius + gap + idx * step;
    // Смещение от ИСХОДНОГО положения: центр части → точка на расстоянии dist
    // от центра модели вдоль направления.
    const displacement = modelSphere.center.clone().addScaledVector(dir, dist).sub(partCenter);
    targets.set(part.id, displacement);
  }

  // with: "<partId>" — едет вместе с указанной частью (транзитивно).
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

  const normal = new Matrix3();
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
      // Модельные координаты → локальные координаты родителя узла.
      const parent = node.parent ?? root;
      rel.multiplyMatrices(invRoot, parent.matrixWorld);
      normal.getNormalMatrix(rel);
      const local = target.clone().applyMatrix3(normal);
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
  private factor = 0;
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
      this.factor = this.targetFactor;
      this.apply();
    }
  }

  /** Включить/выключить расслоение. Обратный вызов до завершения — от текущей позиции. */
  setExploded(on: boolean): void {
    this.targetFactor = on ? 1 : 0;
    if (this.reducedMotion) {
      this.factor = this.targetFactor;
      this.apply();
    }
  }

  /** true, пока позиции ещё сближаются с целью — нужен следующий кадр. */
  update(dt: number): boolean {
    if (this.reducedMotion) return false;
    if (Math.abs(this.targetFactor - this.factor) < FACTOR_EPS) {
      if (this.appliedFactor !== this.factor) this.apply();
      return false;
    }
    const alpha = 1 - Math.exp(-dt / TAU_SEC);
    this.factor += (this.targetFactor - this.factor) * alpha;
    if (Math.abs(this.targetFactor - this.factor) < FACTOR_EPS) this.factor = this.targetFactor;
    this.apply();
    return true;
  }

  /** Текущее смещение части (для сносок/пикинга) — цель × текущий множитель. */
  currentOffset(partId: string): Vector3 | null {
    const target = this.targets.get(partId);
    if (!target) return null;
    return target.clone().multiplyScalar(this.factor);
  }

  /** Позиции узлов на текущем кадре анимации — всегда исходные + смещение × множитель. */
  private apply(): void {
    if (this.appliedFactor === this.factor) return;
    this.appliedFactor = this.factor;
    for (const [node, local] of this.bindings) {
      const original = this.originals.get(node);
      if (!original) continue;
      node.position.copy(original).addScaledVector(local, this.factor);
    }
  }

  /** Вернуть узлы в исходные позиции (при смене манифеста / dispose). */
  restore(): void {
    this.factor = 0;
    this.targetFactor = 0;
    this.appliedFactor = -1;
    for (const [node, original] of this.originals) {
      node.position.copy(original);
    }
  }
}
