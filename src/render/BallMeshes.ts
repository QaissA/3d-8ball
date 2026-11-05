import * as THREE from 'three';
import { BALL_RADIUS } from '../config/table';
import type { Ball } from '../physics/Ball';
import { ballColor, IVORY } from '../config/balls';

/** Equirectangular 2:1 texture: at the equator both axes have the same angular scale, so circles stay round. */
function ballTexture(n: number): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const color = ballColor(n);
  g.fillStyle = n > 8 ? IVORY : color;
  g.fillRect(0, 0, w, h);
  if (n > 8) {
    g.fillStyle = color;
    g.fillRect(0, h * 0.3, w, h * 0.4);
  }
  if (n > 0) {
    g.font = `bold ${h * 0.13}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const u of [0.25, 0.75]) {
      g.fillStyle = IVORY;
      g.beginPath();
      g.arc(u * w, h / 2, h * 0.11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.fillText(String(n), u * w, h / 2 + h * 0.008);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();

/** Copy physics state to the mesh and roll it by ω·dt, so the numbers visibly turn. */
export function syncBallMesh(mesh: THREE.Mesh, b: Ball, dt: number): void {
  if (b.state === 'pocketed') return; // PocketDrop animates it out
  mesh.visible = true;
  mesh.position.set(b.x, BALL_RADIUS, b.z);
  const w = Math.hypot(b.wx, b.wy, b.wz);
  if (w > 0) {
    _axis.set(b.wx / w, b.wy / w, b.wz / w);
    mesh.quaternion.premultiply(_q.setFromAxisAngle(_axis, w * dt));
  }
}

export function createBallMesh(n: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 48, 32),
    new THREE.MeshPhysicalMaterial({
      map: ballTexture(n),
      roughness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    }),
  );
  mesh.castShadow = true;
  mesh.name = `ball-${n}`;
  return mesh;
}
