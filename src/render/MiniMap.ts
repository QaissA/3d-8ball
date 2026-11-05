import * as THREE from 'three';

/** Objects on this layer show in the main view only (cue stick, ball-in-hand ring). */
export const MAIN_ONLY_LAYER = 1;

// outer frame of the table (same numbers as the rig's overhead view)
const HALF_W = 2.45 / 2;
const HALF_H = 1.45 / 2;
const TOP = 64; // px: below the pause button
const MARGIN = 12; // px

/**
 * Top-down view of the table in the top-left corner: the same scene drawn a second time through an
 * orthographic camera into a scissored viewport. Long axis horizontal, head rail on the left.
 */
export class MiniMap {
  readonly camera = new THREE.OrthographicCamera(-HALF_W, HALF_W, HALF_H, -HALF_H, 0.1, 10);
  enabled = true;
  private frame = document.createElement('div');
  private w = 0;
  private h = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.camera.position.set(0, 3, 0);
    this.camera.up.set(0, 0, -1); // screen right = +x, screen up = -z
    this.camera.lookAt(0, 0, 0);
    this.camera.layers.set(0);
    this.frame.className = 'minimap-frame';
    this.frame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.frame);
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  private layout(): void {
    // a quarter of the width, smaller cap on short (landscape phone) screens
    this.w = Math.round(Math.min(window.innerWidth * 0.25, window.innerHeight * 0.45, 300));
    this.h = Math.round((this.w * HALF_H) / HALF_W);
    Object.assign(this.frame.style, {
      top: `${TOP}px`,
      left: `${MARGIN}px`,
      width: `${this.w}px`,
      height: `${this.h}px`,
    });
  }

  /** Draw after the main render. visible=false hides it (e.g. the main camera is already overhead). */
  render(scene: THREE.Scene, visible: boolean): void {
    const show = this.enabled && visible;
    this.frame.hidden = !show;
    if (!show) return;
    const r = this.renderer;
    const fullW = window.innerWidth;
    const fullH = window.innerHeight;
    const y = fullH - TOP - this.h; // WebGL viewports start at the bottom left
    r.setScissorTest(true);
    r.setScissor(MARGIN, y, this.w, this.h);
    r.setViewport(MARGIN, y, this.w, this.h);
    // the lamp's shadow map was rendered for the main view this frame; reuse it
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.render(scene, this.camera);
    r.shadowMap.autoUpdate = auto;
    r.setScissorTest(false);
    r.setViewport(0, 0, fullW, fullH);
  }
}
