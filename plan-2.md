# 🎱 Plan 2: Game modes, online play, mini-map, better aim indicator

This plan follows `plan.md` (MVP phases 0–7 done, plus the AI opponent). It adds three features:

1. **Game modes:** Solo (vs computer, or practice), Local 2P (hot-seat), and Online (room code over a socket).
2. **Mini-map:** a live top-down camera view in the top-left corner.
3. **Aim indicator v2:** clearer colours, plus the predicted paths: where the object ball goes, where the cue ball goes after contact, and the rebounds off cushions.

Order: **A → B → C → D → E**. A and B are self-contained UI work you can ship right away. C is the refactor that online play needs. D and E add online play.

---

## Decisions (change them here before starting)

| Topic | Decision | Why |
|---|---|---|
| "Alone" mode | Solo = **vs computer** (easy/medium/hard, already built) **+ Practice** (one player, no opponent, no fouls end the game) | The AI exists; practice is a small extra on top of the same rules |
| Indicator source | Run the **real physics engine** headlessly on the current shot (angle, power, spin), not a geometric guess | The engine is deterministic, so the guide matches the shot, including spin and squirt. The AI already simulates thousands of shots in a worker |
| How far the guide shows | Cue ball: up to its first ball contact, then its path **until its next collision** (1 rebound). Object ball: to its first cushion rebound or the pocket | Shows "where it hits and where it rebounds" without solving the whole shot for the player |
| Mini-map rendering | A second render of the same scene through an **orthographic camera** into a scissored viewport in the top-left | It is a real camera view, as asked, and needs no new assets |
| Online architecture | **Socket.IO relay server + shooter-authoritative state.** Clients send only shot inputs. After the balls stop, the shooter sends a state snapshot and the other client snaps to it | Physics is deterministic, but `Math.sin/cos/exp` can differ across JS engines (V8 vs Safari), so we reconcile instead of trusting lockstep. Cheating isn't a concern between friends with a room code |
| Upgrade path | The server can later run `physics/` + `rules/` itself (no DOM dependencies; the AI worker already proves this) for an authoritative server | Needed only for public matchmaking or ranked play |
| Hosting | Static client as today; the Node server on Fly.io, Railway or Render; URL set by `VITE_SERVER_URL` | Websockets need a long-running process, which static hosting doesn't provide |

---

## Phase A: Aim indicator v2 (2–3 days)

**Today:** `physics/aim.ts::predictAim` casts one straight ray to the first event. `render/AimGuide.ts` draws a white line, a ghost ball and a short yellow object-ball line. Spin, power and rebounds are ignored.

### Tasks
- [x] `physics/aim.ts`: add `predictShot(balls, cueId, shot, opts) → ShotPreview`.
  - Clone the stationary balls into a new `World`, `strike(0, shot)`, and step it with `DT` while recording polyline points for the cue ball and the **first object ball hit**. Add a point at each `ballBall`, `ballCushion` or `pocketed` event, and every N steps while a spin-curved path is bending.
  - Stop the cue ball's line at its 2nd collision after first contact. Stop the object ball's line at its 1st cushion or pocket. Cap total simulated time (e.g. 3 s) and the step count.
  - Return `{ cuePath: Vec2[], objectPath?: Vec2[], ghost: Vec2, objectId?, pocketed?: { id, pocket }[], scratch: boolean }`.
  - Keep `predictAim` for the AI and tests, or delete it if nothing uses it once this lands.
- [x] Power for the preview (hint text skipped): use `input.power` while pulling back. While power is 0 (just aiming), use a **reference power** (e.g. 0.5) so the lines are always visible. Show a hint that the lines firm up as power is set.
- [x] (preview steps at 4× DT: < 2 ms on normal shots, ~4 ms on a soft break) Recompute only when angle, power, spin or ball positions change (memoize on the inputs). Measure it: target **< 2 ms** per recompute on a mid-range laptop. If too slow, move it into the existing AI worker pattern (async, show the previous frame's preview meanwhile).
- [x] `render/AimGuide.ts`: draw polylines instead of single strips (one strip per segment, reusing `setLine`).
  - **Cue ball path:** white, solid up to contact. After contact, white dashed or lower opacity.
  - **Object ball path:** in that ball's own colour (`ballColor(id)`), with a light outline so dark balls (8, 7, 15) still read on the cloth.
  - **Ghost ball:** a ring, not a filled sphere. Ring colour comes from the rules:
    - green: legal first contact (own group, or the 8 when it's legal);
    - red: a foul (wrong group, or the 8 too early);
    - grey: no contact (miss).
  - **Pocket highlight:** a glowing ring on the pocket when the preview pockets the object ball. A red ring on the pocket if the cue ball would scratch.
  - **Rebound points:** a small dot at each cushion contact.
- [x] Legality colour: reuses the existing `legalTargets(rules)` (already tested), no new helper.
- [ ] Settings (not done, optional): keep the `aimGuide` checkbox. Optionally add an "Aim assist: full / basic / off" select, where basic = today's line + ghost and full = rebounds. Hard AI games could force basic.
- [x] Tests (`tests/physics/aim.test.ts`):
  - a straight-on shot gives an object path along the line of centres;
  - a centre-ball rolling cut shows the cue ball leaving at about 90° (stun) or bending forward (follow);
  - a shot into a cushion shows a rebound point with reflected direction;
  - the preview doesn't mutate the real `World`.

**Done when:** aiming shows coloured cue and object paths with rebounds that match what actually happens on a stun, draw and follow shot.

---

## Phase B: Mini-map top view (1 day)

### Tasks
- [x] `render/MiniMap.ts`: an `OrthographicCamera` looking straight down at the table, sized to fit the outer frame (≈ 2.45 × 1.45 m, the same numbers as the `overhead` mode in `CameraRig`).
- [x] Render pass in the `main.ts` animation loop after the main render:
  - `renderer.setScissorTest(true)`, then `setViewport`/`setScissor` to a top-left rect (e.g. 22% of width, aspect from the table, 12 px margin, smaller on phones);
  - `renderer.render(scene, miniCam)`, then restore the viewport and scissor.
  - Watch for the WebGL y-origin being bottom-left: top-left means `y = height - h - margin`.
- [x] (the cue's shadow still shows on the map: lights ignore camera layers) Use a three.js **layer** so the mini-map shows the balls, the table and the aim guide but **not** the cue stick or the hand ring. Thicker guide strips for the mini-map are optional.
- [x] Frame: a CSS-positioned border/rounded box `div` over the same rect (pointer-events none). Re-layout on resize.
- [x] (map sits below the pause button; nothing moved) Avoid overlapping the existing HUD (`GameHud`, the pause button). Move them if they sit top-left today.
- [x] Settings: "Mini-map" on/off checkbox (default on for desktop, off on phones; not tied to quality). Persist it with the existing `settings.ts` load/save and validation.
- [x] (measured: map pass 21 calls / ~1.8 ms, ~61 calls total; every-2nd-frame dropped: the main pass clears the canvas, so skipping a frame would flicker) Performance: the mini-map doubles draw calls. Skip shadows for that pass (the lamp's shadow map is already rendered this frame), and on `low` quality render it every 2nd frame. Re-check the < 50 draw-call budget.
- [x] Hide it when the main camera is already in `overhead` mode.

**Done when:** a crisp top view in the top-left corner tracks every ball live, at 60 FPS on the laptop.

---

## Phase C: Game modes + controller refactor (2 days)

**Today:** `settings.opponent: 'human' | 'easy' | 'medium' | 'hard'`. The AI is driven by `computerTurn()` in `main.ts`, which writes to `input.angle/power/side/top` and calls `input.onRelease()`.

### Tasks
- [x] Generalize that into **player controllers**, with one per seat:
  ```ts
  interface Controller { kind: 'local' | 'computer' | 'remote'; update(now: number): void; dispose(): void }
  ```
  - (done as `src/game/Controller.ts` + `src/ai/ComputerController.ts`; `reset()` instead of `dispose()`; kind is `local | computer` until Phase E adds `remote`)
  - `LocalController`: today's mouse/touch input, enabled only on its own turn.
  - `ComputerController`: move `computerTurn()` out of `main.ts` as is (keep its stale-plan guards).
  - `RemoteController` (Phase E): applies placement, aim and shot messages from the socket the same way the AI does.
  - The `canInteract` predicate for `setupBallInHand` and `ShotInput` becomes `controllers[game.rules.current].kind === 'local'`.
- [x] `settings.ts`: replace `opponent` with `mode: 'solo' | 'practice' | 'local'` (`online` comes in Phase E) plus `difficulty`. Migrate old saved settings: `opponent: 'human'` → `local`, otherwise `solo` + that difficulty. Validate it like the other fields. Update `tests/settings.test.ts`.
- [x] **Practice mode:** one seat. The turn never passes, and fouls only give ball in hand. Add a "Re-rack" button. Implemented as `Game.practice` (not in `options`, which the AI worker also receives) that the existing `judge` flow respects, so `EightBallRules` stays pure. Add a test.
- [x] Menu (`ui/Menu.ts`): a mode picker on the main screen showing only that mode's fields (Online entry deferred to Phase E):
  - **Solo:** difficulty select, Player name.
  - **Practice:** name.
  - **Local 2P:** two names (today's form).
  - **Online:** goes to the Online screen (Phase E): Create room or Join with code.
- [x] HUD (practice hides player 2 and shows Re-rack; no "You" label yet): show "You" or "Computer" or the opponent's name. Keep `esc()` for every name, since online names come from another user.

**Done when:** all three offline modes start from the menu, and the AI runs through `ComputerController` with no behaviour change (tests green).

---

## Phase D: Room server (2–3 days)

### Layout
```
server/
  package.json        # socket.io, tsx; no shared build step: imports ../src/rules types only
  src/index.ts        # http + socket.io, CORS allowlist from env
  src/rooms.ts        # room store (in-memory Map), code generation, seat logic
  src/protocol.ts     # message types + validators (shared with the client: import from here)
  tests/rooms.test.ts
```

### Protocol (all messages validated server-side; reject anything else)
| Client → server | Payload | Notes |
|---|---|---|
| `room:create` | `{ name }` | Returns `{ code, seat: 0, token }` |
| `room:join` | `{ code, name }` | Returns `{ seat: 1, token, opponentName }`, or an error: not found / full |
| `room:resume` | `{ code, token }` | Reconnect after a drop, within a grace period (e.g. 60 s) |
| `game:place` | `{ x, z }` | Ball-in-hand preview, throttled to about 10 Hz; the final spot is sent on placement |
| `game:aim` | `{ angle, power, side, top }` | Throttled to about 10 Hz, so the opponent watches you line up |
| `game:shoot` | `{ shot, place? }` | Exactly the inputs `Game.shoot` takes |
| `game:settled` | `{ snapshot, hash }` | Shooter only, after `resolve()`: ball positions/states + `RulesState` + phase |
| `game:rematch` / `room:leave` | — | |

Server → client: `room:ready` (both seated, with the rack **seed** and who breaks), every relayed `game:*` event, `room:opponentLeft`, `room:opponentBack`, `error`.

### Tasks
- [ ] Room codes: 5 characters from an unambiguous alphabet (no 0/O/1/I/L), checked for collisions, case-insensitive on join.
- [ ] Two seats per room. Rooms expire after 10 minutes empty or 2 hours total.
- [ ] Turn enforcement: the server tracks whose turn it is from the last `game:settled` and drops `game:shoot`, `place` or `aim` from the wrong seat.
- [ ] Validation at this trust boundary: types, finite numbers, ranges (angle, power 0..1, spin within the tip circle, positions on the table), name length (20) and characters. Message size limit and per-socket rate limit. Join attempts rate-limited per IP to stop code guessing.
- [ ] Reconnect tokens: random 128-bit per seat, only ever sent to that seat.
- [ ] Health endpoint `/healthz`. Log room counts only, not names.
- [ ] Tests: create/join/full/expired, wrong-seat shot dropped, invalid payloads rejected, resume with a bad token rejected.
- [ ] Deploy the server (Fly/Railway/Render), and set `VITE_SERVER_URL` for the client build.

**Done when:** two `socket.io-client` scripts can create and join a room and pass a full shot cycle against the deployed server.

---

## Phase E: Online client (3–4 days)

### Tasks
- [ ] `src/net/OnlineSession.ts`: connects with `socket.io-client`, exposes `create/join/resume`, typed events from `server/src/protocol.ts`, and connection status.
- [ ] Menu **Online** screen: name, **Create room** (shows a big code + a copy button + "Waiting for opponent…"), **Join** (code input, uppercase, 5 characters). Show errors inline. Cancel leaves the room.
- [ ] Start: both clients build the rack from the server's **seed** (`Game` already takes `makeSeed`; `newRack` must accept a given seed). The seat that breaks comes from the server.
- [ ] Local seat → `LocalController` plus outgoing `aim`/`place` (throttled) and `shoot`. Remote seat → `RemoteController`, which animates the opponent's aim and cue from `game:aim` and plays `game:shoot` through the same `input.onRelease()` path the AI uses.
- [ ] **Reconciliation:** after `resolve()`, the shooter sends `game:settled` with the snapshot. The receiver compares hashes. If they differ, it snaps balls and rules to the snapshot and logs the divergence (dev console + a counter). Add `Game.snapshot()` / `Game.restore(s)`, which also fix reconnects. Round-trip test.
- [ ] Input lock: block shooting while waiting for the opponent's `settled`, so the next turn always starts from the agreed state.
- [ ] Disconnects: banner "Opponent disconnected — waiting 60 s". On `resume`, the server sends the last snapshot. After the timeout, offer "Back to menu" (no AI takeover in v1).
- [ ] Rematch button on game over (alternating breaks, as `newGame()` does).
- [ ] Pause menu in online play: there is no real pause; it's just a settings overlay while the game keeps running.
- [ ] Manual test matrix: Chrome ↔ Safari iOS, Chrome ↔ Firefox. A full game, a scratch, ball in hand, 8 on the break, a reconnect mid-game, closing a tab.

**Done when:** two people on different networks and browsers finish a full game from a room code, with no divergence left after reconciliation.

---

## Shared risks

| Risk | Mitigation |
|---|---|
| Cross-browser float drift in physics | Shooter-authoritative `settled` snapshot; log the divergence rate. If it's frequent, move to server simulation (the upgrade path) |
| Aim preview too slow on phones | Memoize, cap the sim time, move it to a worker if > 2 ms; the reference-power preview needs only 1 sim per aim change |
| Preview makes the game too easy | "Aim assist" setting; basic mode = today's guide |
| Mini-map halves the FPS on low-end devices | Off on `low`, every 2nd frame, no shadow pass |
| Socket server costs / sleeping free tiers | Free tiers that sleep make the first join slow; show "Connecting…"; it's acceptable for v1 |
| Room code guessing / abuse | 5-character code from a 31-character alphabet (≈ 28 M combinations), rate limits, short expiry |
| `main.ts` keeps growing (318 lines) | Phase C moves turn control into controllers; mini-map and preview live in their own modules |

## Prerequisites carried over from plan.md
- A git remote, CI (`npm test`, `npm run build`, `npm run lint`) and a static deploy. Online play can't be tested across networks without them, so do this before Phase E.
