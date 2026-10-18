import { Group, Mesh, Object3D, BufferGeometry } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';

type BoundsTreeGeometry = BufferGeometry & {
  computeBoundsTree: () => void;
  disposeBoundsTree: () => void;
};

let bvhInstalled = false;
function installBvh(): void {
  if (bvhInstalled) return;
  (BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree =
    computeBoundsTree;
  (BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree =
    disposeBoundsTree;
  (Mesh.prototype as unknown as { raycast: typeof acceleratedRaycast }).raycast = acceleratedRaycast;
  bvhInstalled = true;
}

export interface LoadedModel {
  root: Group;
  originalNames: Map<Object3D, string>;
  getNodePath(obj: Object3D): string[];
}

export async function parseGltf(buffer: ArrayBuffer): Promise<LoadedModel> {
  installBvh();

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  const gltf = await loader.parseAsync(buffer, '');

  const originalNames = new Map<Object3D, string>();
  const parser = gltf.parser;
  const nodeDefs = parser.json?.nodes ?? [];
  for (const [key, entry] of parser.associations.entries()) {
    if (!(key as Object3D).isObject3D) continue;
    const obj = key as Object3D;
    const e = entry as { type?: string; nodes?: number; index?: number };
    const index = typeof e.nodes === 'number' ? e.nodes : e.type === 'nodes' ? e.index : undefined;
    if (index == null) continue;
    const def = nodeDefs[index];
    if (def && typeof def.name === 'string') {
      originalNames.set(obj, def.name);
    }
  }

  const root = gltf.scene;

  root.traverse((obj) => {
    if ((obj as Mesh).isMesh) {
      const mesh = obj as Mesh;
      const geom = mesh.geometry as BoundsTreeGeometry;
      if (geom && typeof geom.computeBoundsTree === 'function') {
        geom.computeBoundsTree();
      }
    }
  });

  const getNodePath = (obj: Object3D): string[] => {
    const path: string[] = [];
    let cur: Object3D | null = obj;
    while (cur && cur !== root) {
      const name = originalNames.get(cur) ?? cur.name;
      if (name) path.unshift(name);
      cur = cur.parent;
    }
    return path;
  };

  return { root, originalNames, getNodePath };
}

export async function loadGltf(url: string): Promise<LoadedModel> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch model ${url}: ${response.status}`);
  }
  return parseGltf(await response.arrayBuffer());
}

export function disposeModel(model: LoadedModel): void {
  model.root.traverse((obj) => {
    if ((obj as Mesh).isMesh) {
      const mesh = obj as Mesh;
      const geom = mesh.geometry as BoundsTreeGeometry;
      if (geom && typeof geom.disposeBoundsTree === 'function') {
        geom.disposeBoundsTree();
      }
      geom?.dispose?.();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose?.();
    }
  });
}
