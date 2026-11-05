import type * as THREE from 'three';
import { BALL_RADIUS as R, POCKETS } from '../config/table';

const DURATION = 0.35; // s
const DEPTH = 0.12; // m below the cloth when it disappears

interface Drop {
  mesh: THREE.Mesh;
  t: number;
  x0: number;
  z0: number;
  px: number;
  pz: number;
}

/** Pocketed balls slide to the hole centre and sink, instead of vanishing. */
export class PocketDrop {
  private drops = new Map<number, Drop>();

  start(id: number, mesh: THREE.Mesh, pocket: number): void {
    const p = POCKETS[pocket]!;
    this.drops.set(id, { mesh, t: 0, x0: mesh.position.x, z0: mesh.position.z, px: p.x, pz: p.z });
  }

  /** isPocketed: a re-spotted ball (8 on the break, cue ball in hand) cancels its drop. */
  update(dt: number, isPocketed: (id: number) => boolean): void {
    for (const [id, d] of this.drops) {
      if (!isPocketed(id)) {
        this.drops.delete(id);
        continue;
      }
      d.t = Math.min(1, d.t + dt / DURATION);
      const e = d.t * d.t; // ease in: accelerates as it falls
      d.mesh.position.set(d.x0 + (d.px - d.x0) * d.t, R - DEPTH * e, d.z0 + (d.pz - d.z0) * d.t);
      if (d.t >= 1) {
        d.mesh.visible = false;
        this.drops.delete(id);
      }
    }
  }

  clear(): void {
    this.drops.clear();
  }
}
