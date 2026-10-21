import { Color, Material, Mesh, MeshPhysicalMaterial, MeshStandardMaterial } from 'three';
import type { MaterialOverride } from '../manifest/schema';

const UNBOUND_KEY = '__unbound__';
const ACCENT_COLOR = 0x3b82f6;
const SELECT_INTENSITY = 0.9;
const HOVER_INTENSITY = 0.45;
const DIM_OPACITY = 0.18;
const SMOOTHING_TAU_SEC = 0.12;
const EPS = 1e-3;

interface MatRecord {
  mesh: Mesh;
  slot: number; // индекс в массиве материалов, -1 если материал скаляр
  original: Material;
  clone: Material;
  origOpacity: number;
  origTransparent: boolean;
  origEmissive: Color | null;
  origEmissiveIntensity: number;
  origDepthWrite: boolean;
}

interface PartState {
  key: string;
  records: MatRecord[];
  targetHighlight: number;
  targetSelected: number;
  targetDim: number;
  currentHighlight: number;
  currentSelected: number;
  currentDim: number;
}

export interface VisualTargets {
  hover: string | null;
  selected: string | null;
  dimOthers: boolean;
}

/**
 * Клонирует материалы по одному набору на часть (экземпляр) и плавно сводит
 * текущие визуальные параметры к целям, задаваемым hover/selected/dim.
 */
export class VisualState {
  private readonly parts = new Map<string, PartState>();
  private readonly accent = new Color(ACCENT_COLOR);
  private reducedMotion = false;

  constructor(
    partMeshes: Map<string, Mesh[]>,
    overridesByPartId: Map<string, MaterialOverride> = new Map<string, MaterialOverride>(),
    unboundMeshes: Mesh[] = [],
  ) {
    const groups: [string, Mesh[]][] = [...partMeshes];
    if (unboundMeshes.length > 0) groups.push([UNBOUND_KEY, unboundMeshes]);
    for (const [key, meshes] of groups) {
      // Переопределения из манифеста задают baseline клона; их надо впечатать до
      // снятия orig*, иначе каждый кадр мы будем возвращать opacity к исходному.
      const partId = key === UNBOUND_KEY ? null : key.split('::', 1)[0];
      const override = partId ? overridesByPartId.get(partId) : undefined;
      const records: MatRecord[] = [];
      const cloneByOriginal = new Map<Material, Material>();
      const cloneMat = (m: Material): Material => {
        const existing = cloneByOriginal.get(m);
        if (existing) return existing;
        const c = m.clone();
        if (override) applyOverride(c, override);
        cloneByOriginal.set(m, c);
        return c;
      };
      for (const mesh of meshes) {
        const mat = mesh.material;
        if (Array.isArray(mat)) {
          const applied = mat.map((m, i) => {
            const c = cloneMat(m);
            records.push(makeRecord(mesh, i, m, c));
            return c;
          });
          mesh.material = applied;
        } else {
          const c = cloneMat(mat);
          records.push(makeRecord(mesh, -1, mat, c));
          mesh.material = c;
        }
      }
      this.parts.set(key, {
        key,
        records,
        targetHighlight: 0,
        targetSelected: 0,
        targetDim: 0,
        currentHighlight: 0,
        currentSelected: 0,
        currentDim: 0,
      });
    }
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  setTargets(targets: VisualTargets): void {
    for (const [key, part] of this.parts) {
      part.targetHighlight = targets.hover === key ? 1 : 0;
      part.targetSelected = targets.selected === key ? 1 : 0;
      const dim = targets.dimOthers && targets.selected && targets.selected !== key ? 1 : 0;
      part.targetDim = dim;
    }
  }

  /** @returns true, если какая-то часть ещё не достигла целей — нужен следующий кадр. */
  update(dt: number): boolean {
    const alpha = this.reducedMotion ? 1 : 1 - Math.exp(-dt / SMOOTHING_TAU_SEC);
    let animating = false;
    for (const part of this.parts.values()) {
      part.currentHighlight = lerp(part.currentHighlight, part.targetHighlight, alpha);
      part.currentSelected = lerp(part.currentSelected, part.targetSelected, alpha);
      part.currentDim = lerp(part.currentDim, part.targetDim, alpha);
      const settled =
        near(part.currentHighlight, part.targetHighlight) &&
        near(part.currentSelected, part.targetSelected) &&
        near(part.currentDim, part.targetDim);
      if (!settled) animating = true;
      this.applyPart(part);
    }
    return animating;
  }

  dispose(): void {
    for (const part of this.parts.values()) {
      for (const rec of part.records) {
        if (rec.slot === -1) {
          rec.mesh.material = rec.original;
        } else {
          const arr = rec.mesh.material as Material[];
          if (Array.isArray(arr)) arr[rec.slot] = rec.original;
        }
        rec.clone.dispose();
      }
    }
    this.parts.clear();
  }

  private applyPart(part: PartState): void {
    const emissiveMix = Math.max(part.currentHighlight * HOVER_INTENSITY, part.currentSelected * SELECT_INTENSITY);
    const opacity = 1 - part.currentDim * (1 - DIM_OPACITY);
    const transparent = opacity < 1 - EPS;
    for (const rec of part.records) {
      const mat = rec.clone;
      // emissive
      const std = mat as MeshStandardMaterial;
      if (std.emissive) {
        std.emissive.copy(rec.origEmissive ?? new Color(0, 0, 0)).lerp(this.accent, Math.min(1, emissiveMix));
        std.emissiveIntensity = Math.max(rec.origEmissiveIntensity, emissiveMix);
      }
      // opacity + transparent
      const targetOpacity = rec.origOpacity * opacity;
      mat.opacity = targetOpacity;
      const wantTransparent = transparent || rec.origTransparent;
      if (mat.transparent !== wantTransparent) {
        mat.transparent = wantTransparent;
        mat.needsUpdate = true;
      }
      // depthWrite выключается на время затухания у полупрозрачных частей
      if (rec.origTransparent) {
        mat.depthWrite = part.currentDim < EPS ? rec.origDepthWrite : false;
      }
    }
  }
}

function makeRecord(mesh: Mesh, slot: number, original: Material, clone: Material): MatRecord {
  // orig* снимается с КЛОНА — после того как на него нанесены overrides, чтобы
  // плавное восстановление возвращало к baseline из манифеста, а не к исходнику glTF.
  const std = clone as MeshStandardMaterial;
  return {
    mesh,
    slot,
    original,
    clone,
    origOpacity: clone.opacity ?? 1,
    origTransparent: clone.transparent ?? false,
    origEmissive: std.emissive ? std.emissive.clone() : null,
    origEmissiveIntensity: std.emissiveIntensity ?? 0,
    origDepthWrite: clone.depthWrite ?? true,
  };
}

function applyOverride(mat: Material, ov: MaterialOverride): void {
  const std = mat as MeshStandardMaterial;
  if (ov.opacity != null) {
    mat.opacity = ov.opacity;
    if (ov.opacity < 1 - EPS) mat.transparent = true;
  }
  if (ov.color && std.color) std.color.set(ov.color);
  if (ov.emissive && std.emissive) std.emissive.set(ov.emissive);
  if (ov.transmission != null) {
    (mat as MeshPhysicalMaterial).transmission = ov.transmission;
  }
  if (ov.alphaMode === 'OPAQUE') {
    mat.transparent = false;
    mat.depthWrite = true;
    mat.opacity = 1;
  } else if (ov.alphaMode === 'BLEND') {
    mat.transparent = true;
  }
}

function lerp(cur: number, target: number, alpha: number): number {
  return cur + (target - cur) * alpha;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS;
}
