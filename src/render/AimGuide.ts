import * as THREE from 'three';
import { BALL_RADIUS as R } from '../config/table';
import type { AimPrediction } from '../physics/aim';

const Y = 0.003; // just above the cloth
const OBJECT_LINE = 0.3; // m

/** Line to first contact, a ghost ball there, and the object ball's predicted direction. */
export class AimGuide {
  readonly group = new THREE.Group();
  private path = makeLine(0xffffff, 0.7);
  private objectDir = makeLine(0xffe082, 0.9);
  private ghost = new THREE.Mesh(
    new THREE.SphereGeometry(R, 24, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
  );

  constructor() {
    this.group.add(this.path, this.objectDir, this.ghost);
  }

  update(fromX: number, fromZ: number, p: AimPrediction | null): void {
    this.group.visible = p !== null;
    if (!p) return;
    setLine(this.path, fromX, fromZ, p.x, p.z);
    this.ghost.position.set(p.x, R, p.z);
    this.objectDir.visible = p.dirX !== undefined;
    if (p.dirX !== undefined && p.dirZ !== undefined) {
      const ox = p.x + p.dirX * 2 * R;
      const oz = p.z + p.dirZ * 2 * R;
      setLine(this.objectDir, ox, oz, ox + p.dirX * OBJECT_LINE, oz + p.dirZ * OBJECT_LINE);
    }
  }
}

const WIDTH = 0.004; // m; WebGL lines are always 1 px, too faint on the cloth, so use flat strips
const unitStrip = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

function makeLine(color: number, opacity: number): THREE.Mesh {
  return new THREE.Mesh(
    unitStrip,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
}

function setLine(strip: THREE.Mesh, x1: number, z1: number, x2: number, z2: number): void {
  strip.position.set((x1 + x2) / 2, Y, (z1 + z2) / 2);
  strip.scale.set(Math.hypot(x2 - x1, z2 - z1), 1, WIDTH);
  strip.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
}
