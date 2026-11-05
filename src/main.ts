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
import { setupBallInHand } from './input/BallInHand';
import { createGameHud } from './ui/GameHud';
import { Game } from './game/GameStateMachine';
import { predictAim } from './physics/aim';
import { DT, PHYSICS } from './config/physics';
import { BALL_RADIUS as R } from './config/table';

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
for (let n = 0; n <= 15; n++) {
  const mesh = createBallMesh(n);
  mesh.rotation.set(n, n * 2, n * 3); // vary which number faces up
  meshes.set(n, mesh);
  scene.add(mesh);
}

const game = new Game();
const syncAll = () => {
  for (const b of game.world.balls) syncBallMesh(meshes.get(b.id)!, b, 0);
};
game.onNewWorld = () => {
  syncAll();
  input.angle = 0;
};
syncAll();

const input = new ShotInput(
  renderer.domElement,
  camera,
  () => game.cueBall,
  () => rig.mode,
);
setupBallInHand(renderer.domElement, camera, game);
const hud = createShotHud(input);
const gameHud = createGameHud(game);

// ring under the cue ball while it's in hand: green = legal spot, red = not
const handRing = new THREE.Mesh(
  new THREE.RingGeometry(R * 1.15, R * 1.45, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false }),
);
scene.add(handRing);

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

const settings = { timeScale: 1, aimGuide: true, newGame: () => game.newGame() };
const { stats, gui } = createDebug();
gui.add(settings, 'newGame').name('new game');
const rulesFolder = gui.addFolder('Rules').close();
rulesFolder.add(game.options, 'eightOnBreak', ['win', 'respot']).name('8 on the break');
rulesFolder.add(game.options, 'scratchOnBreak', ['kitchen', 'anywhere']).name('break scratch');
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
  const world = game.world;
  while (acc >= DT) {
    world.step();
    for (const b of world.balls) syncBallMesh(meshes.get(b.id)!, b, DT);
    acc -= DT;
  }
  game.update();

  const cb = game.cueBall;
  const inHand = game.phase === 'ballInHand';
  if (inHand) syncBallMesh(meshes.get(0)!, cb, 0);
  handRing.visible = inHand;
  handRing.position.set(cb.x, 0.002, cb.z);
  (handRing.material as THREE.MeshBasicMaterial).color.set(
    game.canPlace(cb.x, cb.z) ? 0x4caf50 : 0xe53935,
  );

  const aiming = game.phase === 'aiming';
  input.enabled = aiming && input.phase !== 'striking';
  input.update(frameDt);

  let gap = pullGap();
  if (input.phase === 'striking') {
    strikeT += frameDt / STRIKE_TIME;
    gap = strikeFrom * (1 - Math.min(strikeT, 1));
    if (strikeT >= 1) {
      // power^1.5 gives finer control over soft shots
      game.shoot({
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
  gameHud.update();
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
      game,
      get world() {
        return game.world;
      },
    },
  });
