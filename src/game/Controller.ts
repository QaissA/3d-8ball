/** Who plays a seat. Local seats are driven by mouse/touch/keyboard; others drive the shot input. */
export interface Controller {
  readonly kind: 'local' | 'computer' | 'remote';
  /** Called every unpaused frame while it is this seat's turn. */
  update(dt: number): void;
  /** Drop any shot in progress (after a shot is taken). */
  reset(): void;
}

export const localController: Controller = { kind: 'local', update() {}, reset() {} };
/** The opponent online: their moves arrive through OnlineGame. */
export const remoteController: Controller = { kind: 'remote', update() {}, reset() {} };
