import type { PhysicsEvent } from '../physics/World';

/** What happened during one shot, as far as the rules care. */
export interface ShotResult {
  /** First object ball the cue ball touched, or null if it hit nothing. */
  firstContact: number | null;
  /** Balls pocketed, in order (0 = cue ball, i.e. a scratch). */
  pocketed: number[];
  /** Any ball reached a cushion after the first contact. */
  cushionAfterContact: boolean;
  /** Distinct object balls that hit a cushion (break legality). */
  objectBallsToCushion: number;
}

/** Builds a ShotResult from the physics event stream. */
export class ShotRecorder {
  result!: ShotResult;
  private railBalls = new Set<number>();

  constructor() {
    this.reset();
  }

  reset(): void {
    this.result = {
      firstContact: null,
      pocketed: [],
      cushionAfterContact: false,
      objectBallsToCushion: 0,
    };
    this.railBalls.clear();
  }

  record(e: PhysicsEvent): void {
    const r = this.result;
    if (e.type === 'ballBall') {
      if (r.firstContact === null && (e.a === 0 || e.b === 0))
        r.firstContact = e.a === 0 ? e.b : e.a;
    } else if (e.type === 'ballCushion') {
      if (r.firstContact !== null) r.cushionAfterContact = true;
      if (e.ball !== 0) {
        this.railBalls.add(e.ball);
        r.objectBallsToCushion = this.railBalls.size;
      }
    } else if (e.type === 'pocketed') {
      r.pocketed.push(e.ball);
    }
  }
}
