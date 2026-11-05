import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { isFormTarget } from '../input/pointer';

export type CameraMode = 'behind' | 'overhead' | 'free';
const MODES: CameraMode[] = ['behind', 'overhead', 'free'];
const DAMPING = 6; // 1/s, higher = snappier
const SHAKE_DECAY = 8; // 1/s

/**
 * 'C' cycles: behind the cue (follows aim, default) → overhead → free orbit (right-drag, wheel).
 * Rig modes ease the camera toward their target pose; free mode hands over to OrbitControls.
 */
export class CameraRig {
  mode: CameraMode = 'behind';
  private wantPos = new THREE.Vector3(-2.1, 1.2, 1.3);
  private wantTarget = new THREE.Vector3();
  private pos = new THREE.Vector3().copy(this.wantPos);
  private target = new THREE.Vector3();
  private shakeAmp = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
  ) {
    camera.position.copy(this.pos);
    controls.enabled = false;
    window.addEventListener('keydown', (e) => {
      if ((e.key !== 'c' && e.key !== 'C') || isFormTarget(e)) return;
      this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]!;
      controls.enabled = this.mode === 'free';
      if (this.mode === 'free') controls.target.copy(this.target);
      else this.pos.copy(camera.position);
    });
  }

  /** Brief camera shake, e.g. on a hard break (amplitude in metres). */
  shake(amount: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  update(dt: number, cueX: number, cueZ: number, angle: number, aiming: boolean): void {
    if (this.mode === 'free') {
      this.controls.update();
      this.target.copy(this.controls.target);
      return;
    }
    if (this.mode === 'overhead') {
      // fit the ~2.45 x 1.45 m outer frame in view
      const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
      const h = (0.5 * Math.max(1.45, 2.45 / this.camera.aspect)) / Math.tan(halfFov);
      this.wantPos.set(0, h, 0.0001); // tiny z offset avoids the straight-down singularity
      this.wantTarget.set(0, 0, 0);
    } else if (aiming) {
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      this.wantPos.set(cueX - dx * 0.75, 0.28, cueZ - dz * 0.75);
      this.wantTarget.set(cueX + dx * 0.6, 0, cueZ + dz * 0.6);
    } // behind while balls roll: hold the last pose
    const k = 1 - Math.exp(-DAMPING * dt);
    this.pos.lerp(this.wantPos, k);
    this.target.lerp(this.wantTarget, k);
    this.camera.position.copy(this.pos);
    if (this.shakeAmp > 1e-4) {
      const a = this.shakeAmp;
      this.camera.position.add(
        new THREE.Vector3(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5,
        ).multiplyScalar(2 * a),
      );
      this.shakeAmp *= Math.exp(-SHAKE_DECAY * dt);
    }
    this.camera.lookAt(this.target);
  }
}
