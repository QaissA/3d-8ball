import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createRenderer } from './render/Renderer';
import { createDebug } from './debug/DebugPanel';
import { createPhysicsDebug } from './debug/PhysicsDebug';
import { addLighting, loadTable } from './render/SceneBuilder';
import { createBallMesh, syncBallMesh } from './render/BallMeshes';
import { CameraRig } from './render/CameraRig';
import { CueStick } from './render/CueMesh';
import { AimGuide } from './render/AimGuide';
import { ShotInput } from './input/ShotInput';
import { createShotHud } from './ui/ShotHud';
import { triangleRack } from './game/Rack';
import { Ball } from './physics/Ball';
import { World } from './physics/World';
import { predictAim } from './physics/aim';
import { DT, PHYSICS } from './config/physics';
import { BALL_RADIUS as R, HEAD_SPOT_X } from './config/table';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
const renderer = createRenderer(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.05; // stay above the cloth
// left button and one finger are for aiming/shooting
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
const rig = new CameraRig(camera, controls);

const { lamp } = addLighting(scene, renderer);
let cue: CueStick | null = null;
loadTable(scene)
  .then((model) => {
    const mesh = model
      .getObjectsByProperty('type', 'Mesh')
      .find((o) => ((o as THREE.Mesh).material as THREE.Material).name === 'PoolCue_MTL') as
      THREE.Mesh | undefined;
    if (!mesh) throw new Error('cue mesh not found in table.glb');
    cue = new CueStick(mesh);
    scene.add(cue.root);
  })
  .catch((err) => console.error('Failed to load table model', err));

const meshes = new Map<number, THREE.Mesh>();
for (const p of triangleRack()) {
  const mesh = createBallMesh(p.number);
  mesh.rotation.set(p.number, p.number * 2, p.number * 3); // vary which number faces up
  meshes.set(p.number, mesh);
  scene.add(mesh);
}

let world: World;
const cueBall = () => world.balls.find((b) => b.id === 0)!;
function rack() {
  world = new World(triangleRack().map((p) => new Ball(p.number, p.x, p.z)));
  for (const b of world.balls) syncBallMesh(meshes.get(b.id)!, b, 0);
  input.angle = 0;
}

/** shortcut: scratches respot on the head spot until Phase 4 adds ball-in-hand. */
function respotCueBall(b: Ball) {
  b.state = 'stationary';
  b.x = HEAD_SPOT_X;
  b.z = 0;
  while (
    world.balls.some(
      (o) => o !== b && o.state !== 'pocketed' && Math.hypot(o.x - b.x, o.z - b.z) < 2 * R,
    )
  )
    b.x -= 2 * R;
  syncBallMesh(meshes.get(0)!, b, 0);
}

const input = new ShotInput(
  renderer.domElement,
  camera,
  () => cueBall(),
  () => rig.mode,
);
const hud = createShotHud(input);
rack();

const STRIKE_TIME = 0.12; // s for the cue to travel forward
const pullGap = () => 0.01 + input.power * 0.25;
let strikeT = 0;
let strikeFrom = 0;
input.onRelease = () => {
  strikeT = 0;
  strikeFrom = pullGap();
};

const aimGuide = new AimGuide();
scene.add(aimGuide.group);
const physicsDebug = createPhysicsDebug();
physicsDebug.visible = false;
scene.add(physicsDebug);

const settings = { timeScale: 1, aimGuide: true, rack };
const { stats, gui } = createDebug();
gui.add(settings, 'rack');
gui.add(settings, 'aimGuide').name('aim guide');
gui.add(settings, 'timeScale', 0.05, 1, 0.01).name('slow-mo');
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
  const frameDt = Math.min((now - last) / 1000, 0.1);
  last = now;
  acc += frameDt * settings.timeScale;
  while (acc >= DT) {
    world.step();
    for (const b of world.balls) syncBallMesh(meshes.get(b.id)!, b, DT);
    acc -= DT;
  }

  const cb = cueBall();
  if (!world.isMoving() && cb.state === 'pocketed') respotCueBall(cb);
  const aiming = !world.isMoving();
  input.enabled = aiming && input.phase !== 'striking';
  input.update(frameDt);

  let gap = pullGap();
  if (input.phase === 'striking') {
    strikeT += frameDt / STRIKE_TIME;
    gap = strikeFrom * (1 - Math.min(strikeT, 1));
    if (strikeT >= 1) {
      // power^1.5 gives finer control over soft shots
      world.strike(0, {
        angle: input.angle,
        speed: PHYSICS.maxCueSpeed * input.power ** 1.5,
        side: input.side,
        top: input.top,
      });
      input.phase = 'aiming';
      input.power = 0;
    }
  }

  const showCue = aiming || input.phase === 'striking';
  if (cue) {
    cue.root.visible = showCue;
    cue.update(cb.x, cb.z, input.angle, input.side, input.top, gap);
  }
  aimGuide.group.visible = settings.aimGuide && showCue && input.phase !== 'striking';
  if (aimGuide.group.visible) aimGuide.update(cb.x, cb.z, predictAim(world.balls, 0, input.angle));

  hud.update();
  rig.update(frameDt, cb.x, cb.z, input.angle, aiming);
  renderer.render(scene, camera);
  stats.update();
});

// Dev-only handle for poking at the game from the browser console.
if (import.meta.env.DEV)
  Object.assign(window, {
    pool: {
      scene,
      camera,
      input,
      aimGuide,
      rig,
      get world() {
        return world;
      },
    },
  });
