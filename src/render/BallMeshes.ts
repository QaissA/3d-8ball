import * as THREE from 'three';
import { BALL_RADIUS } from '../config/table';

const COLORS = [
  '#f2c200',
  '#1a4fc4',
  '#d42020',
  '#5b2a86',
  '#f07a12',
  '#127a3a',
  '#7a1a1a',
  '#111111',
];
const IVORY = '#f4f1e8';

/** Equirectangular 2:1 texture: at the equator both axes have the same angular scale, so circles stay round. */
function ballTexture(n: number): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const color = n === 0 ? IVORY : COLORS[(n - 1) % 8]!;
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
