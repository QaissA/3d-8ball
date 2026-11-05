import * as THREE from 'three';
import { BALL_RADIUS } from '../config/table';

const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALL_RADIUS);
const ndc = new THREE.Vector2();

/** Point at ball-centre height on the table under the pointer, or null if it misses the plane. */
export function pointerOnTable(e: PointerEvent, camera: THREE.Camera): THREE.Vector3 | null {
  const r = (e.target as HTMLElement).getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}
