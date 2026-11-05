import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createRenderer } from './render/Renderer';
import { createDebug } from './debug/DebugPanel';
import { addLighting, loadTable } from './render/SceneBuilder';
import { createBallMesh } from './render/BallMeshes';
import { setupCameraRig } from './render/CameraRig';
import { triangleRack } from './game/Rack';
import { BALL_RADIUS } from './config/table';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
const renderer = createRenderer(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.05; // stay above the cloth
setupCameraRig(camera, controls);

const { lamp } = addLighting(scene, renderer);
loadTable(scene).catch((err) => console.error('Failed to load table model', err));

for (const b of triangleRack()) {
  const mesh = createBallMesh(b.number);
  mesh.position.set(b.x, BALL_RADIUS, b.z);
  mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); // cosmetic only
  scene.add(mesh);
}

const { stats, gui } = createDebug();
gui.add(renderer, 'toneMappingExposure', 0, 3, 0.01).name('exposure');
gui.add(scene, 'environmentIntensity', 0, 2, 0.01).name('env light');
gui.add(lamp, 'intensity', 0, 150, 1).name('lamp');

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  stats.update();
});
