import { Box3, MathUtils, Mesh, Object3D, PerspectiveCamera, Sphere, Vector3 } from 'three';
import type CameraControls from 'camera-controls';

export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_INSETS: ViewportInsets = { top: 0, right: 0, bottom: 0, left: 0 };

// Направление камеры по умолчанию: ¾-ракурс, чтобы не было строгих боковых/верхних осей.
const TILT_DIR = new Vector3(0.55, 0.45, 0.9).normalize();

/** Вписывает объект целиком. Используется для первичного фита. */
export function fitToObject(
  controls: CameraControls,
  camera: PerspectiveCamera,
  obj: Object3D,
  instant = false,
): void {
  const box = new Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new Sphere());
  const dist = (sphere.radius / Math.sin(MathUtils.degToRad(camera.fov) / 2)) * 1.1;
  const pos = sphere.center.clone().addScaledVector(TILT_DIR, dist);
  controls.setLookAt(
    pos.x,
    pos.y,
    pos.z,
    sphere.center.x,
    sphere.center.y,
    sphere.center.z,
    !instant,
  );
  camera.near = Math.max(sphere.radius / 1000, 0.001);
  camera.far = sphere.radius * 100;
  camera.updateProjectionMatrix();
}

/**
 * Подлетает к набору мешей так, чтобы они оказались в центре видимой области
 * (viewport минус insets). Направление камеры сохраняется (вписывает по текущему углу).
 */
export function flyToMeshes(
  controls: CameraControls,
  camera: PerspectiveCamera,
  meshes: Mesh[],
  insets: ViewportInsets,
  canvas: HTMLCanvasElement,
  instant = false,
): void {
  if (meshes.length === 0) return;
  const box = new Box3();
  for (const mesh of meshes) {
    const b = new Box3().setFromObject(mesh);
    if (!b.isEmpty()) box.union(b);
  }
  if (box.isEmpty()) return;

  const sphere = box.getBoundingSphere(new Sphere());
  const dist = sphere.radius / Math.sin(MathUtils.degToRad(camera.fov) / 2);

  (controls as unknown as { fitToSphere: (sphere: Sphere, enableTransition: boolean) => void })
    .fitToSphere(sphere, !instant);

  // Чтобы часть оказалась в центре видимой области (viewport − insets),
  // нужно сместить саму камеру в противоположную сторону от «пустого» края:
  // при insets.left > 0 (панель слева) камера едет влево, объект уезжает вправо.
  const canvasH = Math.max(canvas.clientHeight, 1);
  const worldPerPx = (2 * dist * Math.tan(MathUtils.degToRad(camera.fov) / 2)) / canvasH;
  const shiftXpx = (insets.right - insets.left) / 2;
  const shiftYpx = (insets.top - insets.bottom) / 2;
  if (shiftXpx !== 0 || shiftYpx !== 0) {
    controls.truck(shiftXpx * worldPerPx, shiftYpx * worldPerPx, !instant);
  }
}
