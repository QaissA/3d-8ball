import * as THREE from 'three';
import type { CameraMode } from '../render/CameraRig';
import { isFormTarget, pointerOnTable } from './pointer';

export type ShotPhase = 'aiming' | 'pulling' | 'striking';

const BEHIND_SENS = 0.003; // rad per pixel of horizontal drag/move
const FINE = 0.1; // Shift multiplier
const PULL_PX = 250; // drag distance for full power
const CHARGE_TIME = 1.5; // seconds of holding Space for full power

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Aim, power and spin from mouse, touch and keyboard.
 * - Mouse: move to aim (behind-cue view: horizontal motion rotates; other views: aim at the pointer),
 *   hold left button and drag down to pull back, release to shoot. Shift = fine aim.
 * - Touch: drag to aim; use the power bar to shoot.
 * - Keyboard: ←/→ aim, W/S follow/draw, A/D side, X centre spin, hold Space to charge, Esc cancels.
 */
export class ShotInput {
  angle = 0;
  power = 0;
  side = 0;
  top = 0;
  phase: ShotPhase = 'aiming';
  /** False while balls are moving. */
  enabled = true;
  /** Multiplier for behind-cue aim speed (settings). */
  sensitivity = 1;
  onRelease = () => {};

  private lastX = 0;
  private pullStartY = 0;
  private charging = false;
  private lastPointerAngle: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private camera: THREE.Camera,
    private cueBall: () => { x: number; z: number },
    private cameraMode: () => CameraMode,
  ) {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      this.lastX = e.clientX;
      if (!this.enabled || e.pointerType !== 'mouse' || e.button !== 0) return;
      this.aimAtPointer(e);
      this.beginPull();
      this.pullStartY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', () => {
      if (!this.charging) this.release();
    });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  beginPull(): void {
    if (!this.enabled || this.phase !== 'aiming') return;
    this.phase = 'pulling';
    this.power = 0;
  }

  release(): void {
    if (this.phase !== 'pulling') return;
    this.charging = false;
    if (this.power < 0.02) return this.cancel();
    this.phase = 'striking';
    this.onRelease();
  }

  cancel(): void {
    this.charging = false;
    if (this.phase === 'pulling') this.phase = 'aiming';
    this.power = 0;
  }

  setSpin(side: number, top: number): void {
    const m = Math.hypot(side, top);
    this.side = m > 1 ? side / m : side;
    this.top = m > 1 ? top / m : top;
  }

  update(dt: number): void {
    if (this.charging) this.power = Math.min(1, this.power + dt / CHARGE_TIME);
  }

  private onMove(e: PointerEvent): void {
    const dx = e.clientX - this.lastX;
    this.lastX = e.clientX;
    if (!this.enabled) return;
    if (this.phase === 'pulling') {
      if (!this.charging && e.pointerType === 'mouse')
        this.power = THREE.MathUtils.clamp((e.clientY - this.pullStartY) / PULL_PX, 0, 1);
      return;
    }
    if (this.phase !== 'aiming') return;
    if (e.pointerType === 'mouse' ? e.buttons !== 0 : e.buttons === 0) return; // orbiting / hovering touch
    if (this.cameraMode() === 'behind') {
      this.angle = wrap(this.angle + dx * BEHIND_SENS * this.sensitivity * (e.shiftKey ? FINE : 1));
    } else {
      this.aimAtPointer(e);
    }
  }

  /** Aim at the table point under the pointer; with Shift, follow it at a tenth of the rate. */
  private aimAtPointer(e: PointerEvent): void {
    if (this.cameraMode() === 'behind') return;
    const hit = pointerOnTable(e, this.camera);
    if (!hit) return;
    const c = this.cueBall();
    const target = Math.atan2(hit.z - c.z, hit.x - c.x);
    const prev = this.lastPointerAngle;
    this.lastPointerAngle = target;
    this.angle =
      e.shiftKey && prev !== null ? wrap(this.angle + wrap(target - prev) * FINE) : target;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (isFormTarget(e)) return;
    const k = e.key.toLowerCase();
    if (k === ' ') {
      e.preventDefault();
      if (down && !e.repeat && this.enabled && this.phase === 'aiming') {
        this.beginPull();
        this.charging = true;
      } else if (!down && this.charging) {
        this.release();
      }
      return;
    }
    if (!down) return;
    if (k === 'escape' && this.phase === 'pulling') {
      e.preventDefault(); // so the pause menu doesn't also open
      return this.cancel();
    }
    if (!this.enabled || this.phase !== 'aiming') return;
    const step = e.shiftKey ? 0.001 : 0.01;
    if (k === 'arrowleft') this.angle = wrap(this.angle - step);
    else if (k === 'arrowright') this.angle = wrap(this.angle + step);
    else if (k === 'w') this.setSpin(this.side, this.top + 0.1);
    else if (k === 's') this.setSpin(this.side, this.top - 0.1);
    else if (k === 'a') this.setSpin(this.side - 0.1, this.top);
    else if (k === 'd') this.setSpin(this.side + 0.1, this.top);
    else if (k === 'x') this.setSpin(0, 0);
    else return;
    e.preventDefault();
  }
}
