import * as THREE from 'three';

export function createRenderer(camera: THREE.PerspectiveCamera): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
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
  const cap = quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1;
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
