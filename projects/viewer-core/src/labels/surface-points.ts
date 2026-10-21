import { Matrix4, Mesh, Object3D, Vector3 } from 'three';

export const CANDIDATE_COUNT = 10;
// Вершин на часть больше не собираем: для выборки 10 кандидатов
// равномерная прореженная выборки не хуже полной.
const MAX_VERTICES = 20000;

const toModel = new Matrix4();
const baseInverse = new Matrix4();
const vertex = new Vector3();

/**
 * 8–12 точек на поверхности части (выборка вершин методом дальнейшей точки),
 * в координатах модели — следуют за расслоением вместе с частью.
 */
export function sampleSurfaceCandidates(
  meshes: Mesh[],
  root: Object3D,
  count = CANDIDATE_COUNT,
): Vector3[] {
  const points: number[] = [];
  root.updateMatrixWorld(true);
  baseInverse.copy(root.matrixWorld).invert();
  for (const mesh of meshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const position = mesh.geometry.getAttribute('position');
    if (!position) continue;
    mesh.updateWorldMatrix(true, false);
    toModel.multiplyMatrices(baseInverse, mesh.matrixWorld);
    const total = position.count;
    const stride = Math.max(1, Math.floor(total / MAX_VERTICES));
    for (let i = 0; i < total; i += stride) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(toModel);
      points.push(vertex.x, vertex.y, vertex.z);
    }
  }
  const total = points.length / 3;
  if (total === 0) return [];

  const chosen: Vector3[] = [];
  // Первая точка — самая верхняя (по Y модели): детерминированно и обычно видима.
  let first = 0;
  for (let i = 1; i < total; i++) {
    if (points[i * 3 + 1] > points[first * 3 + 1]) first = i;
  }
  chosen.push(new Vector3(points[first * 3], points[first * 3 + 1], points[first * 3 + 2]));
  const minDist = new Float64Array(total).fill(Infinity);

  const target = Math.min(count, total);
  while (chosen.length < target) {
    const last = chosen[chosen.length - 1];
    let best = -1;
    let bestDist = -1;
    for (let i = 0; i < total; i++) {
      const dx = points[i * 3] - last.x;
      const dy = points[i * 3 + 1] - last.y;
      const dz = points[i * 3 + 2] - last.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < minDist[i]) minDist[i] = d;
      if (minDist[i] > bestDist) {
        bestDist = minDist[i];
        best = i;
      }
    }
    if (best < 0 || bestDist <= 1e-12) break;
    chosen.push(new Vector3(points[best * 3], points[best * 3 + 1], points[best * 3 + 2]));
  }
  return chosen;
}
