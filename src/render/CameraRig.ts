import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** 'C' toggles between a framed overhead view and the free-orbit view. */
export function setupCameraRig(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  let overhead = false;
  const orbitPos = new THREE.Vector3(-2.1, 1.2, 1.3);
  camera.position.copy(orbitPos);

  const toggle = () => {
    overhead = !overhead;
    controls.target.set(0, 0, 0);
    if (overhead) {
      orbitPos.copy(camera.position);
      // fit the ~2.45 x 1.45 m outer frame in view
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const h = (0.5 * Math.max(1.45, 2.45 / camera.aspect)) / Math.tan(halfFov);
      camera.position.set(0, h, 0.0001); // tiny z offset avoids the straight-down singularity
    } else {
      camera.position.copy(orbitPos);
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'c' || e.key === 'C') toggle();
  });
}
