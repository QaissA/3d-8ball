import type * as THREE from 'three';
import type { Game } from '../game/GameStateMachine';
import { isFormTarget, pointerOnTable } from './pointer';

/**
 * Ball in hand: the cue ball follows the mouse (or a dragging finger); click / lift to place.
 * Keyboard: arrows move it (Shift = fine), Enter places.
 */
export function setupBallInHand(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  game: Game,
  enabled: () => boolean, // false while a menu is open or the computer is playing
) {
  const active = () => game.phase === 'ballInHand' && enabled();
  const follow = (e: PointerEvent) => {
    if (!active() || (e.pointerType !== 'mouse' && e.buttons === 0)) return;
    const hit = pointerOnTable(e, camera);
    if (hit) game.moveCueBall(hit.x, hit.z);
  };
  canvas.addEventListener('pointermove', follow);
  canvas.addEventListener('pointerdown', follow);
  canvas.addEventListener('pointerup', (e) => {
    if (active() && (e.pointerType !== 'mouse' || e.button === 0)) game.placeCueBall();
  });
  window.addEventListener('keydown', (e) => {
    if (!active() || isFormTarget(e)) return;
    const step = e.shiftKey ? 0.001 : 0.005;
    const b = game.cueBall;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const m = moves[e.key];
    if (m) game.moveCueBall(b.x + m[0], b.z + m[1]);
    else if (e.key === 'Enter') game.placeCueBall();
    else return;
    e.preventDefault();
  });
}
