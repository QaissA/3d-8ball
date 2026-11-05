import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { applyQuality, createRenderer } from './render/Renderer';
import { AudioManager } from './audio/AudioManager';
import { PocketDrop } from './render/PocketDrop';
import { createMenu } from './ui/Menu';
import { loadSettings, saveSettings } from './ui/settings';
import type { World } from './physics/World';
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
import { AiPlayer } from './ai/AiPlayer';
import type { Difficulty } from './ai/ShotPlanner';
import { predictShot, type ShotPreview } from './physics/aim';
import { legalTargets } from './rules/EightBallRules';
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

const userSettings = loadSettings();
const audio = new AudioManager();
const drops = new PocketDrop();
const game = new Game();

/** Hook a (new) physics world up to sound, pocket animations and the break camera shake. */
function attachWorld(w: World) {
  drops.clear();
  for (const b of w.balls) syncBallMesh(meshes.get(b.id)!, b, 0);
  w.on((e) => {
    if (e.type === 'cueHit') {
      audio.strike(e.speed);
      if (game.rules.isBreak && e.speed > 6) rig.shake(0.006 * (e.speed / 10));
    } else if (e.type === 'ballBall') audio.ballBall(e.speed);
    else if (e.type === 'ballCushion') audio.cushion(e.speed);
    else if (e.type === 'pocketed') {
      audio.pocket();
      drops.start(e.ball, meshes.get(e.ball)!, e.pocket);
    }
  });
}
game.onNewWorld = (w) => {
  attachWorld(w);
  input.angle = 0;
};
game.onResolve = (o) => {
  if (o.state.winner !== null) audio.win();
  else if (o.foul) audio.foul();
  gameHud.announce(o);
};
attachWorld(game.world);

const input = new ShotInput(
  renderer.domElement,
  camera,
  () => game.cueBall,
  () => rig.mode,
);
const hud = createShotHud(input);
const gameHud = createGameHud(game);

function applySettings() {
  audio.setVolume(userSettings.volume);
  input.sensitivity = userSettings.sensitivity;
  applyQuality(renderer, scene, lamp, userSettings.quality);
}
applySettings();
const menu = createMenu({
  settings: userSettings,
  onPlay(names) {
    userSettings.names = names;
    saveSettings(userSettings);
    game.names = [
      names[0],
      userSettings.opponent === 'human' ? names[1] : `Computer (${userSettings.opponent})`,
    ];
    game.newRack(0);
  },
  onNewGame: () => game.newGame(),
  onSettingsChange() {
    applySettings();
    saveSettings(userSettings);
  },
  canPause: () => input.phase !== 'striking',
});
setupBallInHand(
  renderer.domElement,
  camera,
  game,
  () => !menu.isOpen() && !isComputer(game.rules.current),
);

// Computer opponent (player 2): plans in a worker, lines up the cue, then strikes.
const ai = new AiPlayer();
const debugAi: unknown[] = []; // dev only: recent plans the computer chose, for replaying in the console
const isComputer = (p: number) => p === 1 && userSettings.opponent !== 'human';
const AI_AIM_MS = 700;
let aiState: 'idle' | 'thinking' | 'aiming' = 'idle';
let aiAimStart = 0;
let aiPower = 0;
let aiWorld: World | null = null; // a new rack abandons any plan in progress
function computerTurn(now: number) {
  if (!isComputer(game.rules.current) || (game.phase !== 'aiming' && game.phase !== 'ballInHand')) {
    aiState = 'idle';
    return;
  }
  // a plan belongs to one position: drop it on a new rack or once the turn has moved on
  if (aiWorld !== game.world || (aiState === 'aiming' && game.phase !== 'aiming')) aiState = 'idle';
  if (aiState === 'aiming' && input.phase === 'aiming') {
    const t = (now - aiAimStart) / AI_AIM_MS;
    input.power = aiPower * Math.min(1, t); // visible pull-back
    if (t >= 1.3) {
      input.phase = 'striking';
      input.onRelease();
    }
  }
  if (aiState !== 'idle') return;
  aiState = 'thinking';
  const world = (aiWorld = game.world);
  ai.think(game, userSettings.opponent as Difficulty).then((p) => {
    if (game.world !== world || !isComputer(game.rules.current)) return void (aiState = 'idle');
    if (import.meta.env.DEV && debugAi.length < 50)
      debugAi.push({
        plan: p,
        balls: world.balls.map((b) => ({ ...b })),
        rules: game.rules,
        inHand: game.phase === 'ballInHand' ? game.inHand : 'none',
      });
    if (game.phase === 'ballInHand') {
      if (p.place) game.moveCueBall(...p.place);
      if (!game.placeCueBall()) return void (aiState = 'idle'); // position changed: think again
    }
    input.angle = p.shot.angle;
    input.side = p.shot.side ?? 0;
    input.top = p.shot.top ?? 0;
    aiPower = Math.min(1, (p.shot.speed / PHYSICS.maxCueSpeed) ** (2 / 3)); // inverse of power^1.5
    aiAimStart = performance.now();
    aiState = 'aiming';
  });
}

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
const PREVIEW_POWER = 0.5;
// the preview re-simulates only when the shot or the table changes (a new rules state = a new turn)
let preview: ShotPreview;
let previewKey = '';
let previewWorld: World | null = null;
let previewRules: unknown = null;
/** power^1.5 gives finer control over soft shots. */
const currentShot = (power: number) => ({
  angle: input.angle,
  speed: PHYSICS.maxCueSpeed * power ** 1.5,
  side: input.side,
  top: input.top,
});
const physicsDebug = createPhysicsDebug();
physicsDebug.visible = false;
scene.add(physicsDebug);

// Debug panel + FPS meter: dev server, or add ?debug to the URL.
const debug = { timeScale: 1 };
let stats: { update(): void } | null = null;
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  const d = createDebug();
  stats = d.stats;
  const gui = d.gui.close();
  const rulesFolder = gui.addFolder('Rules').close();
  rulesFolder.add(game.options, 'eightOnBreak', ['win', 'respot']).name('8 on the break');
  rulesFolder.add(game.options, 'scratchOnBreak', ['kitchen', 'anywhere']).name('break scratch');
  gui.add(debug, 'timeScale', 0.05, 1, 0.01).name('slow-mo');
  gui.add(physicsDebug, 'visible').name('show cushions/pockets');
  const physicsFolder = gui.addFolder('Physics').close();
  for (const key of Object.keys(PHYSICS) as (keyof typeof PHYSICS)[])
    physicsFolder.add(PHYSICS, key);
  const look = gui.addFolder('Look').close();
  look.add(renderer, 'toneMappingExposure', 0, 3, 0.01).name('exposure');
  look.add(scene, 'environmentIntensity', 0, 2, 0.01).name('env light');
  look.add(lamp, 'intensity', 0, 150, 1).name('lamp');
}

// Fixed-step accumulator. shortcut: no render interpolation (240 Hz steps vs 60 Hz frames is
// already smooth); add it if high-refresh displays show judder.
let acc = 0;
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const frameDt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const paused = menu.isOpen();
  if (!paused) acc += frameDt * debug.timeScale;
  const world = game.world;
  while (acc >= DT) {
    world.step();
    for (const b of world.balls) syncBallMesh(meshes.get(b.id)!, b, DT);
    acc -= DT;
  }
  game.update();
  drops.update(
    paused ? 0 : frameDt,
    (id) => world.balls.find((b) => b.id === id)?.state === 'pocketed',
  );
  audio.setRolling(
    paused
      ? 0
      : world.balls.reduce((s, b) => s + (b.state === 'pocketed' ? 0 : Math.hypot(b.vx, b.vz)), 0),
  );

  const cb = game.cueBall;
  const inHand = game.phase === 'ballInHand';
  if (inHand) syncBallMesh(meshes.get(0)!, cb, 0);
  handRing.visible = inHand;
  handRing.position.set(cb.x, 0.002, cb.z);
  (handRing.material as THREE.MeshBasicMaterial).color.set(
    game.canPlace(cb.x, cb.z) ? 0x4caf50 : 0xe53935,
  );

  if (paused) aiAimStart += frameDt * 1000;
  else computerTurn(now);
  const computer = isComputer(game.rules.current);
  const aiming = game.phase === 'aiming';
  input.enabled = aiming && !paused && !computer && input.phase !== 'striking';
  input.update(frameDt);

  let gap = pullGap();
  if (input.phase === 'striking') {
    if (!paused) strikeT += frameDt / STRIKE_TIME;
    gap = strikeFrom * (1 - Math.min(strikeT, 1));
    if (strikeT >= 1) {
      game.shoot(currentShot(input.power));
      input.phase = 'aiming';
      input.power = 0;
      aiState = 'idle';
    }
  }

  const showCue = aiming || input.phase === 'striking';
  if (cue) {
    cue.root.visible = showCue;
    cue.update(cb.x, cb.z, input.angle, input.side, input.top, gap);
  }
  aimGuide.group.visible =
    userSettings.aimGuide && showCue && !computer && input.phase !== 'striking';
  if (aimGuide.group.visible) {
    // before pull-back the power is 0, so preview a medium shot to keep the lines visible
    const shot = currentShot(input.power > 0 ? input.power : PREVIEW_POWER);
    const key = `${shot.angle},${shot.speed},${shot.side},${shot.top},${cb.x},${cb.z}`;
    if (key !== previewKey || world !== previewWorld || game.rules !== previewRules) {
      previewKey = key;
      previewWorld = world;
      previewRules = game.rules;
      preview = predictShot(world.balls, 0, shot);
    }
    const legal =
      preview.objectId !== undefined && legalTargets(game.rules).includes(preview.objectId);
    aimGuide.update(preview, legal);
  }

  hud.update();
  gameHud.update();
  rig.update(frameDt, cb.x, cb.z, input.angle, aiming);
  renderer.render(scene, camera);
  stats?.update();
});

// Dev-only handle for poking at the game from the browser console.
if (import.meta.env.DEV)
  Object.assign(window, {
    pool: {
      scene,
      renderer,
      camera,
      input,
      aimGuide,
      rig,
      game,
      debugAi,
      get world() {
        return game.world;
      },
    },
  });
