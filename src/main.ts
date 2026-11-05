import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createRenderer } from './render/Renderer';
import { createDebug } from './debug/DebugPanel';
import { createPhysicsDebug } from './debug/PhysicsDebug';
import { addLighting, loadTable } from './render/SceneBuilder';
import { createBallMesh, syncBallMesh } from './render/BallMeshes';
import { setupCameraRig } from './render/CameraRig';
import { triangleRack } from './game/Rack';
import { Ball } from './physics/Ball';
import { World } from './physics/World';
import { DT, PHYSICS } from './config/physics';

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

const meshes = new Map<number, THREE.Mesh>();
for (const p of triangleRack()) {
  const mesh = createBallMesh(p.number);
  mesh.rotation.set(p.number, p.number * 2, p.number * 3); // vary which number faces up
  meshes.set(p.number, mesh);
  scene.add(mesh);
}

let world: World;
function rack() {
  world = new World(triangleRack().map((p) => new Ball(p.number, p.x, p.z)));
  for (const b of world.balls) syncBallMesh(meshes.get(b.id)!, b, 0);
}
rack();

const physicsDebug = createPhysicsDebug();
physicsDebug.visible = false;
scene.add(physicsDebug);

// Temporary until Phase 3 controls: scripted break.
const actions = {
  timeScale: 1,
  break() {
    rack();
    world.strike(0, { angle: 0.003, speed: 9 });
  },
  rack,
};
window.addEventListener('keydown', (e) => {
  if (e.key === 'b' || e.key === 'B') actions.break();
});

const { stats, gui } = createDebug();
gui.add(actions, 'break').name('break (B)');
gui.add(actions, 'rack');
gui.add(actions, 'timeScale', 0.05, 1, 0.01).name('slow-mo');
gui.add(physicsDebug, 'visible').name('show cushions/pockets');
const physicsFolder = gui.addFolder('Physics').close();
for (const key of Object.keys(PHYSICS) as (keyof typeof PHYSICS)[]) physicsFolder.add(PHYSICS, key);
const look = gui.addFolder('Look').close();
look.add(renderer, 'toneMappingExposure', 0, 3, 0.01).name('exposure');
look.add(scene, 'environmentIntensity', 0, 2, 0.01).name('env light');
look.add(lamp, 'intensity', 0, 150, 1).name('lamp');

// Fixed-step accumulator. shortcut: no render interpolation (240 Hz steps vs 60 Hz frames is
// already smooth); add it if high-refresh displays show judder.
let acc = 0;
let last = performance.now();
renderer.setAnimationLoop((now) => {
  acc += Math.min((now - last) / 1000, 0.1) * actions.timeScale;
  last = now;
  while (acc >= DT) {
    world.step();
    for (const b of world.balls) syncBallMesh(meshes.get(b.id)!, b, DT);
    acc -= DT;
  }
  controls.update();
  renderer.render(scene, camera);
  stats.update();
});
