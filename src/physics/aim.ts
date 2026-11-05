import { DT } from '../config/physics';
import { Ball } from './Ball';
import type { Shot } from './cueStrike';
import { World } from './World';

export type Vec2 = [x: number, z: number];

export interface ShotPreview {
  /** Cue ball centre from the strike to its first object-ball contact (or its last shown event). */
  cuePath: Vec2[];
  /** Cue ball after first contact, through one cushion rebound. Empty if no ball is hit. */
  cueAfter: Vec2[];
  /** First object ball hit, from contact through one cushion rebound or into a pocket. */
  objectPath: Vec2[];
  /** Cue ball centre at first contact (the ghost ball). */
  ghost?: Vec2;
  objectId?: number;
  /** Pocket index the object ball drops into within its shown path. */
  objectPocket?: number;
  /** Pocket index the cue ball drops into within its shown path. */
  scratchPocket?: number;
  /** Cushion contact points on the shown paths. */
  rebounds: Vec2[];
}

const MAX_TIME = 3; // s of simulated shot
// shortcut: 4x the game's step keeps soft shots (3 s of rolling) under ~2 ms. Collisions are still
// exact (time of impact); only friction is integrated coarser, which shifts paths by about a mm.
// Use DT if the guide ever needs to match the shot exactly.
const STEP = 4 * DT;
const PRE_CONTACT_CUSHIONS = 3; // kick shots: show this many cushions before the first contact

/**
 * Plays the shot in a throwaway copy of the table with the real engine, so the guide includes
 * spin, squirt and throw. Each shown path ends one event after its first cushion rebound.
 */
export function predictShot(balls: Ball[], cueId: number, shot: Shot): ShotPreview {
  const copies = balls.map((b) => Object.assign(new Ball(b.id, b.x, b.z), b));
  const world = new World(copies);
  const cue = copies.find((b) => b.id === cueId)!;
  const out: ShotPreview = {
    cuePath: [[cue.x, cue.z]],
    cueAfter: [],
    objectPath: [],
    rebounds: [],
  };
  let obj: Ball | null = null;
  // per path: open while recording; cushions seen
  let cueOpen = true;
  let cueCushions = 0;
  let objOpen = false;
  let objCushions = 0;
  const cueLine = () => (out.ghost ? out.cueAfter : out.cuePath);
  const at = (b: Ball): Vec2 => [b.x, b.z];
  const closeCue = () => {
    cueLine().push(at(cue));
    cueOpen = false;
  };
  const closeObj = () => {
    out.objectPath.push(at(obj!));
    objOpen = false;
  };

  world.on((e) => {
    if (e.type === 'ballBall') {
      const hitsCue = e.a === cueId || e.b === cueId;
      if (hitsCue && cueOpen && !out.ghost) {
        obj = copies.find((b) => b.id === (e.a === cueId ? e.b : e.a))!;
        out.ghost = at(cue);
        out.objectId = obj.id;
        out.cuePath.push(at(cue));
        out.cueAfter.push(at(cue));
        out.objectPath.push(at(obj));
        objOpen = true;
        cueCushions = 0; // the line after contact gets its own rebound
        return;
      }
      if (hitsCue && cueOpen) closeCue();
      if (objOpen && (e.a === obj!.id || e.b === obj!.id)) closeObj();
    } else if (e.type === 'ballCushion') {
      if (e.ball === cueId && cueOpen) {
        cueLine().push(at(cue));
        out.rebounds.push(at(cue));
        cueCushions++;
        if (out.ghost ? cueCushions > 1 : cueCushions >= PRE_CONTACT_CUSHIONS) cueOpen = false;
      } else if (objOpen && e.ball === obj!.id) {
        out.objectPath.push(at(obj!));
        out.rebounds.push(at(obj!));
        if (++objCushions > 1) objOpen = false;
      }
    } else if (e.type === 'pocketed') {
      if (e.ball === cueId && cueOpen) {
        out.scratchPocket = e.pocket;
        closeCue();
      } else if (objOpen && e.ball === obj!.id) {
        out.objectPocket = e.pocket;
        closeObj();
      }
    }
  });

  world.strike(cueId, shot);
  for (let n = 1; n * STEP <= MAX_TIME && (cueOpen || objOpen) && world.isMoving(); n++) {
    world.step(STEP);
    if (cueOpen && cue.state === 'stationary') closeCue();
    if (objOpen && obj!.state === 'stationary') closeObj();
    if (cueOpen) cueLine().push(at(cue));
    if (objOpen) out.objectPath.push(at(obj!));
  }
  if (cueOpen) cueLine().push(at(cue));
  if (objOpen) out.objectPath.push(at(obj!));
  return out;
}
