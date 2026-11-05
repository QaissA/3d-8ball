/** Tunable constants (mutable so the debug panel can edit them live). */
export const PHYSICS = {
  gravity: 9.81,
  muSlide: 0.2, // ball-cloth sliding friction
  muRoll: 0.01, // rolling resistance
  spinDecel: 10.9, // rad/s² decay of vertical-axis spin (5·μsp·g/2R with μsp ≈ 0.444·R)
  ballRestitution: 0.95,
  ballFriction: 0.06, // ball-ball, produces throw
  cushionRestitution: 0.8,
  cushionFriction: 0.15,
  maxCueSpeed: 10,
  squirt: 0.05, // rad of cue-ball deflection at full side spin (~3°, a standard shaft)
};

/** Fixed physics timestep (s). Collisions inside a step are solved by time of impact. */
export const DT = 1 / 240;
