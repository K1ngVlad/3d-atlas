import { Box3, Camera, Mesh, Object3D, Raycaster, Vector3 } from 'three';
import type { LabelAnchor } from './label-anchors';

export interface LabelPosition {
  partId: string;
  instance?: string;
  /** CSS-пиксели относительно холста. */
  x: number;
  y: number;
  /** false, если якорь вне кадра или за камерой. */
  visible: boolean;
  /** Якорь закрыт непрозрачной геометрией (сноска приглушается). */
  occluded: boolean;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface LabelTrackerOptions {
  /** Корень модели: модельные координаты якорей → мировые, окклюдеры. */
  root: Object3D;
  /**
   * «Прозрачен насквозь» для окклюзии — из baseline манифеста (override
   * `material.opacity` / исходный материал), а не из текущего материала:
   * приглушение изоляцией не должно делать часть «невидимой» для луча.
   */
  isSeeThrough: (mesh: Mesh) => boolean;
  /** Сколько мс новый кандидат должен оставаться лучше текущего. */
  hysteresisMs?: number;
  /** Во сколько раз новый кандидат должен быть ближе к центру, чтобы считаться «заметно лучше». */
  betterFactor?: number;
}

interface KeyState {
  points: Vector3[]; // якорные точки в координатах модели
  world: Vector3[]; // те же точки в мировых координатах (scratch)
  meshes: Mesh[]; // меши части (исключение из окклюзии)
  candidateOccluded: boolean[]; // троттлится вызывающей стороной
  current: number;
  currentScore: number;
  challenger: number;
  challengerSince: number;
  occludedRaw: boolean;
  occludedStreak: number;
  occluded: boolean; // подтверждённое значение (без мигания)
}

const DEFAULT_HYSTERESIS_MS = 300;
const DEFAULT_BETTER_FACTOR = 0.7;
// Смена состояния окклюзии — только после двух одинаковых проверок подряд:
// короткое перекрытие при вращении не мигает.
const OCCLUSION_CONFIRM_STREAK = 2;
const OCCLUSION_EPS = 1e-3;

const raycaster = new Raycaster();
const box = new Box3();
const meshBox = new Box3();
const center = new Vector3();
const camPos = new Vector3();
const camDir = new Vector3();
const ndc = new Vector3();
const toPoint = new Vector3();

/**
 * Состояние выбора якорей для одного манифеста. Каждый отрисованный кадр
 * viewer вызывает update(): проекция точек дешёвая; окклюзия кандидатов
 * пересчитывается только при refreshOcclusion (троттлинг ~150 мс в viewer).
 */
export class LabelTracker {
  private readonly states = new Map<string, KeyState>();
  private readonly hysteresisMs: number;
  private readonly betterFactor: number;

  constructor(
    private anchors: readonly LabelAnchor[],
    private opts: LabelTrackerOptions,
  ) {
    this.hysteresisMs = opts.hysteresisMs ?? DEFAULT_HYSTERESIS_MS;
    this.betterFactor = opts.betterFactor ?? DEFAULT_BETTER_FACTOR;
  }

  setAnchors(anchors: readonly LabelAnchor[]): void {
    this.anchors = anchors;
    this.states.clear();
  }

  update(
    camera: Camera,
    viewport: ViewportSize,
    now: number,
    refreshOcclusion: boolean,
  ): LabelPosition[] {
    this.opts.root.updateMatrixWorld(true);
    camera.getWorldPosition(camPos);
    camera.getWorldDirection(camDir);
    const result: LabelPosition[] = [];
    for (const anchor of this.anchors) {
      let st = this.states.get(anchor.key);
      if (!st) {
        st = this.createState(anchor);
        this.states.set(anchor.key, st);
      }
      this.toWorld(st);
      if (refreshOcclusion) this.refreshOcclusion(st);
      result.push(this.place(anchor, st, camera, viewport, now));
    }
    return result;
  }

  /** Модельные координаты точек → мировые (scratch, переиспользуется везде ниже). */
  private toWorld(st: KeyState): void {
    for (let i = 0; i < st.points.length; i++) {
      st.world[i].copy(st.points[i]).applyMatrix4(this.opts.root.matrixWorld);
    }
  }

  private createState(anchor: LabelAnchor): KeyState {
    const points =
      anchor.point !== null
        ? [anchor.point]
        : anchor.candidates !== null && anchor.candidates.length > 0
          ? anchor.candidates
          : [new Vector3()];
    return {
      points,
      world: points.map(() => new Vector3()),
      meshes: anchor.meshes,
      candidateOccluded: points.map(() => false),
      current: 0,
      currentScore: Infinity,
      challenger: -1,
      challengerSince: 0,
      occludedRaw: false,
      occludedStreak: 0,
      occluded: false,
    };
  }

  private refreshOcclusion(st: KeyState): void {
    for (let i = 0; i < st.points.length; i++) {
      st.candidateOccluded[i] = this.isOccluded(st, st.world[i]);
    }
  }

  private isOccluded(st: KeyState, world: Vector3): boolean {
    toPoint.copy(world).sub(camPos);
    const dist = toPoint.length();
    if (dist <= OCCLUSION_EPS) return false;
    camDir.copy(toPoint).normalize();
    raycaster.set(camPos, camDir);
    raycaster.near = 0;
    raycaster.far = dist - OCCLUSION_EPS;
    for (const hit of raycaster.intersectObject(this.opts.root, true)) {
      const mesh = hit.object as Mesh;
      if (!mesh.isMesh || !mesh.visible || this.opts.isSeeThrough(mesh)) continue;
      if (st.meshes.includes(mesh)) continue; // собственная поверхность не окклюдит
      return true;
    }
    return false;
  }

  private place(
    anchor: LabelAnchor,
    st: KeyState,
    camera: Camera,
    viewport: ViewportSize,
    now: number,
  ): LabelPosition {
    // Экранный центр части — проекция центра габаритов
    box.makeEmpty();
    for (const mesh of anchor.meshes) {
      mesh.updateWorldMatrix(true, false);
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      if (bb) {
        meshBox.copy(bb).applyMatrix4(mesh.matrixWorld);
        box.union(meshBox);
      }
    }
    if (box.isEmpty()) center.set(0, 0, 0);
    else box.getCenter(center);
    ndc.copy(center).project(camera);
    const cx = ((ndc.x + 1) / 2) * viewport.width;
    const cy = ((1 - ndc.y) / 2) * viewport.height;

    // Проекция и оценка кандидатов
    let best = -1;
    let bestScore = Infinity;
    const px = new Array<number>(st.points.length);
    const py = new Array<number>(st.points.length);
    const inFrame = new Array<boolean>(st.points.length);
    for (let i = 0; i < st.points.length; i++) {
      const p = st.world[i];
      toPoint.copy(p).sub(camPos);
      const behind = toPoint.dot(camDir) <= 0;
      ndc.copy(p).project(camera);
      px[i] = ((ndc.x + 1) / 2) * viewport.width;
      py[i] = ((1 - ndc.y) / 2) * viewport.height;
      inFrame[i] =
        !behind &&
        ndc.z > -1 &&
        ndc.z < 1 &&
        px[i] >= 0 &&
        px[i] <= viewport.width &&
        py[i] >= 0 &&
        py[i] <= viewport.height;
      const visibleNow = inFrame[i] && !st.candidateOccluded[i];
      if (!visibleNow) continue;
      const score = Math.hypot(px[i] - cx, py[i] - cy);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }

    // Выбор текущего кандидата (с гистерезисом)
    if (best >= 0) {
      const currentVisible = inFrame[st.current] && !st.candidateOccluded[st.current];
      if (st.points.length === 1 || best === st.current) {
        st.current = best;
        st.currentScore = bestScore;
        st.challenger = -1;
      } else if (!currentVisible) {
        // текущий пропал из кадра / закрыт — меняем сразу
        st.current = best;
        st.currentScore = bestScore;
        st.challenger = -1;
      } else if (bestScore < st.currentScore * this.betterFactor) {
        if (st.challenger === best && now - st.challengerSince >= this.hysteresisMs) {
          st.current = best;
          st.currentScore = bestScore;
          st.challenger = -1;
        } else {
          if (st.challenger !== best) {
            st.challenger = best;
            st.challengerSince = now;
          }
        }
      } else {
        st.challenger = -1;
      }
    }

    const i = st.current;
    // Подтверждение окклюзии: смена только после двух одинаковых проверок подряд
    const raw = st.candidateOccluded[i];
    if (raw === st.occludedRaw) {
      st.occludedStreak++;
    } else {
      st.occludedRaw = raw;
      st.occludedStreak = 1;
    }
    if (st.occludedStreak >= OCCLUSION_CONFIRM_STREAK) st.occluded = raw;

    return {
      partId: anchor.partId,
      instance: anchor.instance,
      x: px[i],
      y: py[i],
      visible: inFrame[i],
      occluded: st.occluded,
    };
  }
}
