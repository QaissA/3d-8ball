import { BALL_RADIUS as R } from '../config/table';
import { Ball } from './Ball';
import { World } from './World';

export interface AimPrediction {
  /** Where the cue ball's centre is at first contact (the ghost ball). */
  x: number;
  z: number;
  /** Id of the object ball hit, if any. */
  ball?: number;
  /** Object ball's departure direction (line of centres), when a ball is hit. */
  dirX?: number;
  dirZ?: number;
  pocket?: number;
}

/**
 * Straight-line path of the cue ball to its first contact, using the engine's own collision search
 * so the guide matches the simulation. Ignores spin curve and squirt.
 */
export function predictAim(balls: Ball[], cueId: number, angle: number): AimPrediction | null {
  const cue = balls.find((b) => b.id === cueId);
  if (!cue) return null;
  const probe = new Ball(cue.id, cue.x, cue.z);
  probe.vx = Math.cos(angle);
  probe.vz = Math.sin(angle);
  const others = balls.filter((b) => b !== cue && b.state !== 'pocketed');
  const ev = new World([probe, ...others]).nextEvent(Infinity);
  if (!ev) return null;
  const x = probe.x + probe.vx * ev.t;
  const z = probe.z + probe.vz * ev.t;
  if (ev.kind === 'pocket') return { x, z, pocket: ev.p };
  if (ev.kind === 'ball') {
    const obj = others[ev.j - 1]!;
    return { x, z, ball: obj.id, dirX: (obj.x - x) / (2 * R), dirZ: (obj.z - z) / (2 * R) };
  }
  return { x, z };
}
