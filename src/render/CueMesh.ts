import * as THREE from 'three';
import { BALL_RADIUS as R } from '../config/table';

const ELEVATION = 0.08; // rad: butt raised slightly, as when clearing the rail
const MAX_OFFSET = 0.5 * R; // matches the cue strike's miscue limit

/**
 * Cue stick built from the model's cue mesh, re-pivoted so its tip sits at the origin pointing +x.
 * Each frame: placed at the cue ball, rotated to the aim, tip offset for spin, pulled back by `gap`.
 */
export class CueStick {
  readonly root = new THREE.Group();
  private tip = new THREE.Group();

  constructor(source: THREE.Mesh) {
    source.updateWorldMatrix(true, false);
    const { tip, butt } = findEnds(source);
    const inner = new THREE.Group(); // at identity, so attach keeps the mesh's world transform as local
    inner.attach(source);
    const axis = butt.clone().sub(tip).normalize();
    inner.quaternion.setFromUnitVectors(axis, new THREE.Vector3(-1, 0, 0));
    inner.position.copy(tip).applyQuaternion(inner.quaternion).negate();
    source.visible = true;
    source.castShadow = true;

    const tilt = new THREE.Group();
    tilt.rotation.z = -ELEVATION;
    tilt.add(inner);
    this.tip.add(tilt);
    this.root.add(this.tip);
  }

  update(x: number, z: number, angle: number, side: number, top: number, gap: number): void {
    this.root.position.set(x, R, z);
    this.root.rotation.y = -angle;
    const a = side * MAX_OFFSET;
    const h = top * MAX_OFFSET;
    // local +z is the shooter's right when aiming along +x
    this.tip.position.set(-(Math.sqrt(R * R - a * a - h * h) + gap), h, a);
  }
}

/** World-space tip and butt centres: the thinner end is the tip. */
function findEnds(mesh: THREE.Mesh) {
  const pos = mesh.geometry.getAttribute('position');
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++)
    pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  const box = new THREE.Box3().setFromPoints(pts);
  const size = box.getSize(new THREE.Vector3());
  const k = size.x >= size.z ? 'x' : 'z'; // the cue lies along its longest horizontal extent
  const end = (near: number) => {
    const sel = pts.filter((p) => Math.abs(p[k] - near) < 0.03);
    const c = sel.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(sel.length);
    const radius = Math.max(...sel.map((p) => p.distanceTo(c)));
    return { c, radius };
  };
  const a = end(box.min[k]);
  const b = end(box.max[k]);
  return a.radius < b.radius ? { tip: a.c, butt: b.c } : { tip: b.c, butt: a.c };
}
