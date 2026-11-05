import * as THREE from 'three';
import { CUSHIONS, POCKETS } from '../config/table';

/** Cushion polylines (yellow) and pocket capture circles (red), drawn just above the cloth. */
export function createPhysicsDebug(): THREE.Group {
  const y = 0.002;
  const group = new THREE.Group();
  const cushionPts = CUSHIONS.flatMap((pl) =>
    pl
      .slice(1)
      .flatMap(([x, z], i) => [
        new THREE.Vector3(pl[i]![0], y, pl[i]![1]),
        new THREE.Vector3(x, y, z),
      ]),
  );
  group.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(cushionPts),
      new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false }),
    ),
  );
  for (const p of POCKETS) {
    const circle = new THREE.EllipseCurve(p.x, p.z, p.r, p.r).getPoints(32);
    group.add(
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(circle.map((c) => new THREE.Vector3(c.x, y, c.y))),
        new THREE.LineBasicMaterial({ color: 0xff3333, depthTest: false }),
      ),
    );
  }
  group.renderOrder = 1;
  return group;
}
