import * as THREE from 'three';

function notice(text: string): HTMLElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.setAttribute('role', 'alert');
  el.style.cssText =
    'position:fixed;inset:auto 16px 50% 16px;text-align:center;font:16px system-ui,sans-serif;color:#eee;text-shadow:0 1px 3px #000;z-index:20';
  document.body.appendChild(el);
  return el;
}

export function createRenderer(camera: THREE.PerspectiveCamera): THREE.WebGLRenderer {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (err) {
    notice(
      'This game needs WebGL, which this browser or device has turned off or does not support.',
    );
    throw err;
  }
  // three.js keeps running and re-creates GPU resources when the context comes back
  const lost = notice('Graphics were interrupted. Restoring…');
  lost.hidden = true;
  renderer.domElement.addEventListener('webglcontextlost', () => (lost.hidden = false));
  renderer.domElement.addEventListener('webglcontextrestored', () => (lost.hidden = true));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.appendChild(renderer.domElement);

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  return renderer;
}

/** Graphics presets: pixel-ratio cap and shadow quality. */
export function applyQuality(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  lamp: THREE.SpotLight,
  quality: 'low' | 'medium' | 'high',
): void {
  // phones and tablets (coarse pointer) are capped at 1.5x: small screens, limited GPUs
  const mobile = window.matchMedia('(pointer: coarse)').matches;
  const cap = Math.min(quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1, mobile ? 1.5 : 2);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
  const shadows = quality !== 'low';
  if (renderer.shadowMap.enabled !== shadows) {
    renderer.shadowMap.enabled = shadows;
    // materials compile shadow support in, so they must recompile when it changes
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) [o.material].flat().forEach((m) => (m.needsUpdate = true));
    });
  }
  const size = quality === 'high' ? 2048 : 1024;
  if (lamp.shadow.mapSize.x !== size) {
    lamp.shadow.mapSize.set(size, size);
    lamp.shadow.map?.dispose();
    lamp.shadow.map = null;
  }
}
