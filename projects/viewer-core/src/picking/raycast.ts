import { Camera, Mesh, Object3D, Raycaster, Vector2, Vector3 } from 'three';
import type { MeshBinding } from '../manifest/resolve-selectors';
import type { PickMode } from '../manifest/schema';

const raycaster = new Raycaster();
const ndc = new Vector2();

export interface PartHit {
  partId: string;
  instance?: string;
  mesh: Mesh;
  point: Vector3;
  distance: number;
}

export function pickPart(
  root: Object3D,
  camera: Camera,
  ndcX: number,
  ndcY: number,
  bindings: Map<Mesh, MeshBinding>,
  defaultPick: PickMode,
  getPickMode: (partId: string) => PickMode,
): PartHit | null {
  ndc.set(ndcX, ndcY);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(root, true);
  for (const hit of hits) {
    const mesh = hit.object as Mesh;
    if (!mesh.isMesh || !mesh.visible) continue;
    const binding = bindings.get(mesh);
    const pick: PickMode = binding ? getPickMode(binding.partId) : defaultPick;
    if (pick === 'select') {
      if (!binding) return null;
      return {
        partId: binding.partId,
        instance: binding.instance,
        mesh,
        point: hit.point,
        distance: hit.distance,
      };
    }
    if (pick === 'block') return null;
    // pass → continue
  }
  return null;
}
