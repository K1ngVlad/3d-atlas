import { Vector3, type Mesh, type Object3D } from 'three';
import type { LabelDef, SceneManifest } from '../manifest/schema';
import { partKey, type ResolvedManifest } from '../manifest/resolve-selectors';
import { sampleSurfaceCandidates } from './surface-points';

/**
 * Якорь сноски: какую точку какой части проецировать на экран.
 * Список строится один раз при загрузке манифеста. Явная точка (`point`)
 * или набор кандидатов на поверхности (`candidates`) — в координатах модели,
 * поэтому следуют за расслоением вместе с частью.
 */
export interface LabelAnchor {
  /** Ключ части: `partId` или `partId::instance`. */
  key: string;
  partId: string;
  /** Имя узла-экземпляра для частей с `select: "each"`. */
  instance?: string;
  /** `label.anchor: [x,y,z]` — явная точка в координатах модели. */
  point: Vector3 | null;
  /**
   * `anchor: "auto"` — 8–12 точек на поверхности части (выборка вершин
   * методом дальнейшей точки). На кадре трекер выбирает видимый кандидат,
   * ближайший к экранному центру части (с гистерезисом).
   */
  candidates: Vector3[] | null;
  /** Меши части/экземпляра: габариты, экранный центр, исключение из окклюзии. */
  meshes: Mesh[];
}

export function resolveLabelAnchors(
  manifest: SceneManifest,
  resolved: ResolvedManifest,
  root: Object3D,
): LabelAnchor[] {
  const out: LabelAnchor[] = [];
  for (const part of manifest.parts) {
    const label = part.label;
    if (!label || label.hidden) continue;
    const selectMode = part.select ?? manifest.defaults?.select ?? 'whole';
    if (selectMode === 'each') {
      const keys = resolved.orderedKeys.filter(
        (k) => k === part.id || k.startsWith(part.id + '::'),
      );
      if (keys.length === 0) continue;
      if (label.each) {
        for (const key of keys) out.push(makeAnchor(part.id, label, key, resolved, root));
      } else {
        const key = label.instance ? partKey(part.id, label.instance) : keys[0];
        if (resolved.partMeshes.has(key)) {
          out.push(makeAnchor(part.id, label, key, resolved, root));
        } else {
          console.warn(
            `[viewer-core] label.instance "${label.instance}" не найден у части "${part.id}"`,
          );
        }
      }
    } else if (resolved.partMeshes.has(part.id)) {
      out.push(makeAnchor(part.id, label, part.id, resolved, root));
    }
  }
  return out;
}

function makeAnchor(
  partId: string,
  label: LabelDef,
  key: string,
  resolved: ResolvedManifest,
  root: Object3D,
): LabelAnchor {
  const instance = key === partId ? undefined : key.slice(partId.length + 2);
  const meshes = resolved.partMeshes.get(key) ?? [];
  const point = Array.isArray(label.anchor) ? new Vector3(...label.anchor) : null;
  return {
    key,
    partId,
    instance,
    point,
    candidates: point ? null : sampleSurfaceCandidates(meshes, root),
    meshes,
  };
}
