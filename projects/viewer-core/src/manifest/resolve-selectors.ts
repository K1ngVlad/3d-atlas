import { Mesh, Object3D } from 'three';
import { ManifestError } from './errors';
import type { NodeSelector, SceneManifest, PickMode } from './schema';

export interface MeshBinding {
  partId: string;
  instance?: string;
  depth: number;
}

export interface ResolvedManifest {
  partRoots: Map<string, Object3D[]>;
  meshBindings: Map<Mesh, MeshBinding>;
  partMeshes: Map<string, Mesh[]>;
  /** Все ключи `partMeshes` в порядке объявления частей в манифесте. */
  orderedKeys: string[];
  defaults: { pick: PickMode; hoverable: boolean };
}

/** Снимает влияние предыдущего манифеста на видимость узлов кэшированной модели. */
export function resetModelVisibility(root: Object3D): void {
  root.traverse((o) => {
    o.visible = true;
  });
}

function depthOf(obj: Object3D, root: Object3D): number {
  let d = 0;
  let cur: Object3D | null = obj;
  while (cur && cur !== root) {
    d++;
    cur = cur.parent;
  }
  return d;
}

function matchesSelector(selector: NodeSelector, name: string): boolean {
  if (typeof selector === 'string') return name === selector;
  if (Array.isArray(selector)) return selector.includes(name);
  return new RegExp(selector.match).test(name);
}

function similarNames(target: string, pool: Iterable<string>): string[] {
  const t = target.toLowerCase();
  const scored: { n: string; s: number }[] = [];
  for (const n of pool) {
    const lower = n.toLowerCase();
    let s: number;
    if (lower.includes(t) || t.includes(lower)) s = 10;
    else {
      const min = Math.min(lower.length, t.length);
      let pref = 0;
      while (pref < min && lower[pref] === t[pref]) pref++;
      s = pref;
    }
    if (s > 0) scored.push({ n, s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, 3).map((e) => e.n);
}

export function findNodesBySelector(
  root: Object3D,
  originalNames: Map<Object3D, string>,
  selector: NodeSelector,
): Object3D[] {
  const result: Object3D[] = [];
  root.traverse((obj) => {
    const name = originalNames.get(obj) ?? obj.name;
    if (name && matchesSelector(selector, name)) result.push(obj);
  });
  return result;
}

export function resolveManifest(
  manifest: SceneManifest,
  root: Object3D,
  originalNames: Map<Object3D, string>,
): ResolvedManifest {
  const allNames = new Set<string>(originalNames.values());

  const includeSet: Set<Object3D> | null = manifest.include
    ? (() => {
        const roots = findNodesBySelector(root, originalNames, manifest.include!);
        if (roots.length === 0) {
          throw new ManifestError(
            `include: nothing matched; similar: ${similarNames(JSON.stringify(manifest.include), allNames).join(', ') || '—'}`,
          );
        }
        const set = new Set<Object3D>();
        for (const r of roots) r.traverse((o) => set.add(o));
        return set;
      })()
    : null;

  const ignoreSet = new Set<Object3D>();
  if (manifest.ignore) {
    for (const sel of manifest.ignore) {
      const found = findNodesBySelector(root, originalNames, sel);
      for (const r of found) r.traverse((o) => ignoreSet.add(o));
    }
  }

  const isAllowed = (obj: Object3D): boolean => {
    if (ignoreSet.has(obj)) return false;
    if (includeSet && !includeSet.has(obj)) return false;
    return true;
  };

  const partRoots = new Map<string, Object3D[]>();
  const meshBindings = new Map<Mesh, MeshBinding>();

  for (const part of manifest.parts) {
    const roots = findNodesBySelector(root, originalNames, part.nodes).filter(isAllowed);
    if (roots.length === 0) {
      throw new ManifestError(
        `part "${part.id}": selector ${JSON.stringify(part.nodes)} matched no nodes; similar: ${similarNames(
          typeof part.nodes === 'string' ? part.nodes : JSON.stringify(part.nodes),
          allNames,
        ).join(', ') || '—'}`,
      );
    }
    partRoots.set(part.id, roots);

    const selectMode = part.select ?? manifest.defaults?.select ?? 'whole';

    for (const partRoot of roots) {
      const rootDepth = depthOf(partRoot, root);

      if (selectMode === 'each') {
        for (const child of partRoot.children) {
          if (!isAllowed(child)) continue;
          const instance = originalNames.get(child) ?? child.name;
          child.traverse((obj) => {
            if (!isAllowed(obj)) return;
            if ((obj as Mesh).isMesh) {
              bindMesh(meshBindings, obj as Mesh, { partId: part.id, instance, depth: rootDepth });
            }
          });
        }
      } else {
        partRoot.traverse((obj) => {
          if (!isAllowed(obj)) return;
          if ((obj as Mesh).isMesh) {
            bindMesh(meshBindings, obj as Mesh, { partId: part.id, depth: rootDepth });
          }
        });
      }
    }
  }

  const partMeshes = new Map<string, Mesh[]>();
  const orderedKeys: string[] = [];
  const seenKey = new Set<string>();
  for (const part of manifest.parts) {
    // Соберём ключи в порядке объявления частей (но только те, у которых есть меши).
    for (const [mesh, binding] of meshBindings) {
      if (binding.partId !== part.id) continue;
      const key = binding.instance ? `${binding.partId}::${binding.instance}` : binding.partId;
      if (!seenKey.has(key)) {
        seenKey.add(key);
        orderedKeys.push(key);
      }
      const arr = partMeshes.get(key);
      if (arr) {
        if (!arr.includes(mesh)) arr.push(mesh);
      } else {
        partMeshes.set(key, [mesh]);
      }
    }
  }

  // Применяем видимость: вне include или в ignore — скрыто. На кэшированной модели
  // предыдущую видимость сбрасывает вызов resetModelVisibility.
  root.traverse((obj) => {
    if (!isAllowed(obj)) obj.visible = false;
  });

  const defaults = {
    pick: manifest.defaults?.pick ?? 'block',
    hoverable: manifest.defaults?.hoverable ?? true,
  };

  return { partRoots, meshBindings, partMeshes, orderedKeys, defaults };
}

function bindMesh(bindings: Map<Mesh, MeshBinding>, mesh: Mesh, binding: MeshBinding): void {
  const prev = bindings.get(mesh);
  if (prev && prev.depth >= binding.depth) {
    if (prev.depth === binding.depth && prev.partId !== binding.partId) {
      console.warn(
        `[viewer-core] mesh captured by two parts at same depth: "${prev.partId}" and "${binding.partId}"`,
      );
    }
    return;
  }
  bindings.set(mesh, binding);
}

export function partKey(partId: string, instance?: string): string {
  return instance ? `${partId}::${instance}` : partId;
}
