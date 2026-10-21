import { Matrix4, Object3D, PerspectiveCamera, Raycaster, Vector2 } from 'three';
import type { Vec3 } from '../manifest/schema';

const raycaster = new Raycaster();
const ndc = new Vector2();
const toModel = new Matrix4();

/**
 * Точка поверхности модели под экранными координатами — для `label.anchor`
 * в ?debug=manifest (Shift+клик). Возвращает координаты модели (root-local).
 */
export function pickSurfacePoint(
  root: Object3D,
  camera: PerspectiveCamera,
  ndcX: number,
  ndcY: number,
): Vec3 | null {
  ndc.set(ndcX, ndcY);
  raycaster.setFromCamera(ndc, camera);
  root.updateMatrixWorld(true);
  const hit = raycaster
    .intersectObject(root, true)
    .find((h) => (h.object as { isMesh?: boolean }).isMesh && h.object.visible);
  if (!hit) return null;
  toModel.copy(root.matrixWorld).invert();
  const local = hit.point.clone().applyMatrix4(toModel);
  return [local.x, local.y, local.z];
}
