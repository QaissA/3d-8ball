// Runs the shot search off the main thread so the game keeps animating while the computer thinks.
import { plan, type PlanRequest } from './ShotPlanner';

addEventListener('message', (e: MessageEvent<{ id: number; req: PlanRequest }>) => {
  (self as unknown as Worker).postMessage({ id: e.data.id, plan: plan(e.data.req) });
});
