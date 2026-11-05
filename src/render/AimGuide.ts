import * as THREE from 'three';
import { ballColor } from '../config/balls';
import { BALL_RADIUS as R, POCKETS } from '../config/table';
import type { ShotPreview, Vec2 } from '../physics/aim';

const Y = 0.003; // just above the cloth
const WIDTH = 0.005; // m; WebGL lines are always 1 px, too faint on the cloth, so use flat ribbons
const OUTLINE = 0.009; // light border under the object ball's path, so dark balls read on green
const MAX_SEGMENTS = 256; // per path; a 3 s preview sampled every 4 steps stays well below
const MAX_DOTS = 8;

const LEGAL = 0x4caf50;
const FOUL = 0xe53935;
const MISS = 0x9e9e9e;
const TARGET_POCKET = 0x69f0ae;
const REBOUND = 0xffe082;

/**
 * Predicted shot: cue ball path to contact (white), cue ball after contact (faint white), object
 * ball path in its own colour, cushion rebound dots, a ghost ball tinted by legality, and rings on
 * the pocket the object ball drops into (green) or the cue ball scratches into (red).
 */
export class AimGuide {
  readonly group = new THREE.Group();
  private cuePath = ribbon(0xffffff, 0.85, WIDTH, 3);
  private cueAfter = ribbon(0xffffff, 0.45, WIDTH, 3);
  private objOutline = ribbon(0xffffff, 0.6, OUTLINE, 2);
  private objPath = ribbon(0xffffff, 0.95, WIDTH, 3);
  private ghostMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  private ghost = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), this.ghostMat);
  private ghostRing = flat(new THREE.RingGeometry(R * 0.9, R * 1.1, 32), 0.9);
  private targetPocket = flat(new THREE.RingGeometry(1, 1.25, 40), 0.9);
  private scratchPocket = flat(new THREE.RingGeometry(1, 1.25, 40), 0.9);
  private dots = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.008, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: REBOUND, transparent: true, depthWrite: false }),
    MAX_DOTS,
  );
  private m = new THREE.Matrix4();

  constructor() {
    (this.targetPocket.material as THREE.MeshBasicMaterial).color.set(TARGET_POCKET);
    (this.scratchPocket.material as THREE.MeshBasicMaterial).color.set(FOUL);
    this.dots.renderOrder = 4;
    this.dots.frustumCulled = false; // instances move; the bounds would stay at the origin
    this.group.add(
      this.cuePath,
      this.cueAfter,
      this.objOutline,
      this.objPath,
      this.ghost,
      this.ghostRing,
      this.targetPocket,
      this.scratchPocket,
      this.dots,
    );
  }

  /** legal: whether the first ball hit is a legal target (ignored when nothing is hit). */
  update(p: ShotPreview, legal: boolean): void {
    setRibbon(this.cuePath, p.cuePath);
    setRibbon(this.cueAfter, p.cueAfter);
    setRibbon(this.objPath, p.objectPath);
    setRibbon(this.objOutline, p.objectPath);
    if (p.objectId !== undefined)
      (this.objPath.material as THREE.MeshBasicMaterial).color.set(ballColor(p.objectId));

    const end = p.ghost ?? p.cuePath[p.cuePath.length - 1]!;
    const tint = p.objectId === undefined ? MISS : legal ? LEGAL : FOUL;
    this.ghost.visible = p.ghost !== undefined;
    this.ghost.position.set(end[0], R, end[1]);
    this.ghostMat.color.set(tint);
    this.ghostRing.position.set(end[0], Y, end[1]);
    (this.ghostRing.material as THREE.MeshBasicMaterial).color.set(tint);

    placePocket(this.targetPocket, p.objectPocket);
    placePocket(this.scratchPocket, p.scratchPocket);

    const n = Math.min(p.rebounds.length, MAX_DOTS);
    for (let i = 0; i < n; i++) {
      const [x, z] = p.rebounds[i]!;
      this.dots.setMatrixAt(i, this.m.makeTranslation(x, Y + 0.0005, z));
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
  }
}

function flat(geo: THREE.BufferGeometry, opacity: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geo.rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false }),
  );
  mesh.renderOrder = 3;
  return mesh;
}

function placePocket(ring: THREE.Mesh, pocket: number | undefined): void {
  ring.visible = pocket !== undefined;
  if (pocket === undefined) return;
  const p = POCKETS[pocket]!;
  ring.position.set(p.x, Y, p.z);
  ring.scale.setScalar(p.r);
}

/** A flat strip along a polyline, one quad per segment, in a preallocated buffer. */
function ribbon(color: number, opacity: number, width: number, order: number): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(MAX_SEGMENTS * 6 * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.frustumCulled = false; // bounds change every frame
  mesh.renderOrder = order;
  mesh.userData.width = width;
  return mesh;
}

function setRibbon(mesh: THREE.Mesh, pts: Vec2[]): void {
  const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const a = attr.array as Float32Array;
  const hw = (mesh.userData.width as number) / 2;
  let v = 0;
  for (let i = 1; i < pts.length && v < MAX_SEGMENTS * 6; i++) {
    const [x1, z1] = pts[i - 1]!;
    const [x2, z2] = pts[i]!;
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-6) continue;
    const nx = (-(z2 - z1) / len) * hw;
    const nz = ((x2 - x1) / len) * hw;
    for (const [x, z] of [
      [x1 - nx, z1 - nz],
      [x1 + nx, z1 + nz],
      [x2 + nx, z2 + nz],
      [x1 - nx, z1 - nz],
      [x2 + nx, z2 + nz],
      [x2 - nx, z2 - nz],
    ] as const) {
      a[v * 3] = x;
      a[v * 3 + 1] = Y;
      a[v * 3 + 2] = z;
      v++;
    }
  }
  mesh.geometry.setDrawRange(0, v);
  attr.needsUpdate = true;
  mesh.visible = v > 0;
}
