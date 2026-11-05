import { PHYSICS } from '../config/physics';
import type { Controller } from '../game/Controller';
import type { Game } from '../game/GameStateMachine';
import type { ShotInput } from '../input/ShotInput';
import type { World } from '../physics/World';
import { AiPlayer } from './AiPlayer';
import type { Difficulty } from './ShotPlanner';

const AIM_TIME = 0.7; // s of visible pull-back
const STRIKE_AT = 1.3; // × AIM_TIME: a short pause at full pull before striking

/** The computer: plans in a worker, places the cue ball if in hand, lines up the cue, then strikes. */
export class ComputerController implements Controller {
  readonly kind = 'computer';
  /** Dev only: recent plans, for replaying in the console. */
  readonly debugPlans: unknown[] = [];
  private ai = new AiPlayer();
  private state: 'idle' | 'thinking' | 'aiming' = 'idle';
  private aimT = 0;
  private power = 0;
  private world: World | null = null; // a new rack abandons any plan in progress

  constructor(
    private game: Game,
    private input: ShotInput,
    private seat: number,
    public difficulty: Difficulty,
  ) {}

  reset(): void {
    this.state = 'idle';
  }

  update(dt: number): void {
    const { game, input } = this;
    if (game.phase !== 'aiming' && game.phase !== 'ballInHand') return this.reset();
    // a plan belongs to one position: drop it on a new rack or once the turn has moved on
    if (this.world !== game.world || (this.state === 'aiming' && game.phase !== 'aiming'))
      this.reset();
    if (this.state === 'aiming' && input.phase === 'aiming') {
      this.aimT += dt / AIM_TIME;
      input.power = this.power * Math.min(1, this.aimT);
      if (this.aimT >= STRIKE_AT) {
        input.phase = 'striking';
        input.onRelease();
      }
    }
    if (this.state !== 'idle') return;
    this.state = 'thinking';
    const world = (this.world = game.world);
    void this.ai.think(game, this.difficulty).then((p) => {
      if (game.world !== world || game.rules.current !== this.seat) return this.reset();
      if (import.meta.env.DEV && this.debugPlans.length < 50)
        this.debugPlans.push({
          plan: p,
          balls: world.balls.map((b) => ({ ...b })),
          rules: game.rules,
          inHand: game.phase === 'ballInHand' ? game.inHand : 'none',
        });
      if (game.phase === 'ballInHand') {
        if (p.place) game.moveCueBall(...p.place);
        if (!game.placeCueBall()) return this.reset(); // position changed: think again
      }
      input.angle = p.shot.angle;
      input.side = p.shot.side ?? 0;
      input.top = p.shot.top ?? 0;
      this.power = Math.min(1, (p.shot.speed / PHYSICS.maxCueSpeed) ** (2 / 3)); // inverse of power^1.5
      this.aimT = 0;
      this.state = 'aiming';
    });
  }
}
