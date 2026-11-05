import type { Game } from '../game/GameStateMachine';
import type { Difficulty, Plan, PlanRequest } from './ShotPlanner';

/** Asks the worker for a plan for the current position. Only the latest request's answer is used. */
export class AiPlayer {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private nextId = 0;
  private waiting = new Map<number, (p: Plan) => void>();

  constructor() {
    this.worker.addEventListener('message', (e: MessageEvent<{ id: number; plan: Plan }>) => {
      this.waiting.get(e.data.id)?.(e.data.plan);
      this.waiting.delete(e.data.id);
    });
  }

  think(game: Game, difficulty: Difficulty): Promise<Plan> {
    const id = ++this.nextId;
    const req: PlanRequest = {
      balls: game.world.balls.map((b) => ({
        id: b.id,
        x: b.x,
        z: b.z,
        pocketed: b.state === 'pocketed',
      })),
      rules: game.rules,
      options: game.options,
      inHand: game.phase === 'ballInHand' ? game.inHand : 'none',
      difficulty,
      seed: (Math.random() * 2 ** 32) >>> 0,
    };
    return new Promise((resolve) => {
      this.waiting.clear(); // drop answers to older questions
      this.waiting.set(id, resolve);
      this.worker.postMessage({ id, req });
    });
  }
}
