# 🎱 8-Ball Pool — Three.js Project Plan

> **Note on naming:** "8-ball" is a *pool* game (16 balls, 6 pockets, solids vs. stripes). *Snooker* is a different game (22 balls, larger table, red/colour scoring). This plan targets **8-ball pool** first, with the architecture kept generic so a **snooker mode** can be added later (see Phase 8).

---

## 1. Goals & Scope

### MVP (v0.1)
- 3D pool table rendered in the browser with Three.js
- Realistic ball physics: rolling, sliding, spin (top/back/side), cushion bounces, pocketing
- Aim → set power → shoot interaction (mouse + touch)
- Full 8-ball rules for 2 local players (hot-seat)
- Basic HUD: whose turn, group (solids/stripes), fouls, ball-in-hand
- Sound effects
- Runs at 60 FPS on a mid-range laptop and modern phones

### Post-MVP
- AI opponent (easy / medium / hard)
- Online multiplayer (authoritative server)
- Shot replays, trick-shot editor
- Snooker / 9-ball modes
- Cosmetics (cues, cloth colours, tables)

### Non-goals (for now)
- VR, native mobile builds, accounts/monetisation

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict) | Physics + rules code benefits enormously from types |
| Bundler / dev server | **Vite** | Fast HMR, first-class TS, simple asset pipeline |
| 3D rendering | **Three.js** | Requirement; mature, huge ecosystem |
| Physics | **Custom deterministic billiards engine** (in TS) | General engines (Rapier, cannon-es) handle rigid bodies but not cloth friction, spin transfer, squirt/throw or cushion physics accurately. Pool is effectively a 2D problem on a plane — a custom solver is smaller, faster, deterministic (needed for replays/AI/netcode) |
| Physics fallback (optional) | `@dimforge/rapier3d-compat` | Only if balls need to leave the table (jump shots/flying off) |
| Camera controls | `three/examples/jsm/controls/OrbitControls` (customised) | Free-look between shots |
| Models | **glTF / GLB** via `GLTFLoader` + `DRACOLoader` | Standard, compressed |
| Textures | **KTX2 / Basis** via `KTX2Loader` (WebP fallback) | GPU-compressed, small downloads |
| Lighting | HDRI via `RGBELoader` + `PMREMGenerator` | Realistic reflections on balls |
| Post-processing | `pmndrs/postprocessing` (or three's `EffectComposer`) | SMAA, subtle bloom, vignette |
| Audio | **Howler.js** (or raw Web Audio API) | Pooled one-shots, volume by impact velocity |
| UI / HUD | Plain DOM + CSS (or **Preact** if UI grows) | Keep the canvas for 3D only |
| State | Small custom store / **zustand** (vanilla) | Game state machine + UI sync |
| Debug UI | **lil-gui** + **stats.js** / `r3f-perf`-style panel | Tweak friction, restitution, camera live |
| Testing | **Vitest** | Unit tests for physics & rules (pure TS, no DOM) |
| Lint / format | ESLint + Prettier | — |
| Multiplayer (later) | **Node.js + WebSocket (ws / Colyseus)** | Server runs the same physics package |
| Hosting | Vercel / Netlify / Cloudflare Pages (static) | Zero-config for Vite |

> Pin exact versions in `package.json` at bootstrap time (`npm install three@latest` etc.) and commit the lockfile. Three.js ships breaking changes between releases, so upgrade deliberately.

---

## 3. Bootstrap Commands

```bash
# 1. Scaffold
npm create vite@latest pool-8ball -- --template vanilla-ts
cd pool-8ball

# 2. Runtime deps
npm install three howler lil-gui zustand postprocessing

# 3. Dev deps
npm install -D @types/three @types/howler vitest eslint prettier \
  @typescript-eslint/parser @typescript-eslint/eslint-plugin

# 4. Asset tooling (optional, for optimisation)
npm install -D @gltf-transform/cli
# KTX2 encoding: install `toktx` from KhronosGroup/KTX-Software releases

# 5. Run
npm run dev
```

**tsconfig essentials:** `"strict": true`, `"noUncheckedIndexedAccess": true`, `"moduleResolution": "bundler"`.

**package.json scripts:**
```json
{
  "dev": "vite",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview",
  "test": "vitest",
  "lint": "eslint src --ext .ts",
  "assets:optimize": "gltf-transform optimize public/models/table.glb public/models/table.opt.glb --compress draco --texture-compress webp"
}
```

---

## 4. Project Structure

```
pool-8ball/
├─ public/
│  ├─ models/        table.glb, cue.glb, room.glb (optional)
│  ├─ textures/      cloth_*, wood_*, ball_numbers atlas
│  ├─ hdri/          studio_small.hdr
│  ├─ audio/         *.ogg / *.mp3
│  └─ draco/, basis/ decoder files (copied from three/examples/jsm/libs)
├─ src/
│  ├─ main.ts                    entry: boot, asset preload, start loop
│  ├─ config/
│  │  ├─ table.ts                dimensions, pocket geometry
│  │  └─ physics.ts              friction / restitution constants
│  ├─ physics/                   ⚠ pure TS, no Three.js imports
│  │  ├─ vec2.ts / vec3.ts
│  │  ├─ Ball.ts                 position, velocity, angular velocity, state
│  │  ├─ World.ts                step(dt), substeps, event emission
│  │  ├─ collisions/
│  │  │  ├─ ballBall.ts
│  │  │  ├─ ballCushion.ts
│  │  │  └─ ballPocket.ts
│  │  ├─ motion.ts               sliding → rolling → spinning → stationary
│  │  └─ cueStrike.ts            cue tip impulse → linear + angular velocity
│  ├─ rules/
│  │  ├─ EightBallRules.ts       fouls, groups, win/loss
│  │  ├─ ShotResult.ts           first contact, pocketed, cushions hit
│  │  └─ Rules.ts                interface (so Snooker can plug in)
│  ├─ game/
│  │  ├─ GameStateMachine.ts     Break → Aiming → Shooting → Simulating → Resolving
│  │  ├─ Player.ts
│  │  └─ Rack.ts                 triangle rack generation
│  ├─ render/
│  │  ├─ Renderer.ts             WebGLRenderer, tone mapping, resize
│  │  ├─ SceneBuilder.ts         table, lights, environment
│  │  ├─ BallMeshes.ts           sync physics → meshes (pos + quaternion)
│  │  ├─ CueMesh.ts
│  │  ├─ AimGuide.ts             trajectory line + ghost ball
│  │  └─ CameraRig.ts            overhead / behind-cue / free modes
│  ├─ input/
│  │  ├─ AimController.ts        mouse/touch rotate aim
│  │  ├─ PowerController.ts      pull-back / slider
│  │  ├─ SpinSelector.ts         cue-ball tip offset UI
│  │  └─ BallInHand.ts           drag cue ball placement
│  ├─ audio/AudioManager.ts
│  ├─ ui/                        HUD, menus, power bar, spin widget
│  ├─ ai/                        (later) shot search
│  ├─ net/                       (later) client sync
│  └─ debug/DebugPanel.ts        lil-gui bindings
├─ tests/
│  ├─ physics/*.test.ts
│  └─ rules/*.test.ts
├─ index.html
├─ vite.config.ts
└─ plan.md
```

**Key architectural rule:** `physics/` and `rules/` must never import Three.js or touch the DOM. That keeps them unit-testable, reusable on a Node server, and deterministic.

---

## 5. Necessary Assets

### 5.1 3D models

| Asset | Notes | Source options |
|---|---|---|
| **Pool table** (9 ft) | Separate meshes/materials for: cloth bed, cushions (rails), wooden frame, pockets/nets, diamonds (sights). Real-world scale in **metres**. Low-poly collision is NOT needed — physics uses analytic geometry | Model in **Blender** (recommended, gives exact dimensions); or Sketchfab / Poly Pizza (check licence: CC0 or CC-BY) |
| **Cue stick** | ~1.47 m long, tip ~13 mm; origin at the tip for easy aiming | Blender (a lathe/screw of a profile curve — 15 min job) |
| **Balls** | **Do not model** — use `SphereGeometry(r, 48, 32)` + textures | Procedural |
| **Room / environment** (optional) | Floor, walls, hanging lamp over table | Kenney, Poly Haven models, or simple Blender scene |
| **Ball rack triangle** (optional, cosmetic) | Animation during racking | Blender |

### 5.2 Textures

| Texture | Details | Source |
|---|---|---|
| Cloth | Base colour (green/blue), normal map for felt fibres, roughness ≈ 0.9 | Poly Haven / ambientCG (CC0) fabric sets, tinted |
| Wood (frame) | Albedo, normal, roughness | Poly Haven / ambientCG (CC0) |
| Ball textures (×16) | Cue (white), 1–7 solids, 8 black, 9–15 stripes; number in a white circle. **Generate procedurally** with an offscreen `<canvas>` (equirectangular 1024×512) → `CanvasTexture`. Zero download, any resolution | Code (see §7.3) |
| Pocket leather / net | Small tiling textures | ambientCG |
| Cue wood + wrap | Albedo + roughness | ambientCG |
| UI icons | Spin widget, power bar, ball icons | Hand-made SVG / Kenney UI pack (CC0) |

### 5.3 Lighting / environment
- **HDRI:** an indoor/studio HDR at 1k–2k resolution (Poly Haven, CC0). Used for reflections only; main light is a rectangular overhead lamp.
- **Lights:** 1–3 `RectAreaLight`s or `SpotLight`s above the table (with `shadow` on one spotlight), low `HemisphereLight` fill.

### 5.4 Audio

| Sound | Variants | Notes |
|---|---|---|
| Cue strike | 3 (soft / medium / hard) | Volume & pick by shot power |
| Ball–ball click | 4–6 | Volume ∝ relative impact speed; slight pitch randomisation |
| Ball–cushion thud | 3 | Volume ∝ normal velocity |
| Pocket drop | 2–3 | + rolling in return channel (optional) |
| Ball rolling loop | 1 | Low volume, scaled by total kinetic energy |
| Rack / break | 1 | Big cluster collision on break |
| UI | click, foul buzz, win jingle | — |
| Ambient (optional) | bar/room tone | Loop |

Sources: **Freesound.org** (check each file's licence — prefer CC0), **Kenney audio packs** (CC0), or record your own with a phone + real table. Export as **.ogg + .mp3** fallback, mono, 44.1 kHz, normalised.

### 5.5 Fonts
- One display font for HUD/menus (Google Fonts, OFL licence), loaded via CSS.

### 5.6 Asset licence tracking
Keep a `CREDITS.md` listing every third-party asset, author, URL and licence from day one.

---

## 6. Real-World Reference Data (WPA / standard 9 ft table)

| Parameter | Value |
|---|---|
| Playing surface | 2.54 m × 1.27 m (100" × 50") |
| Ball diameter | 57.15 mm (radius 0.028575 m) |
| Ball mass | ≈ 0.17 kg |
| Cushion nose height | ≈ 63.5% of ball diameter (~36 mm above cloth) |
| Corner pocket mouth | ≈ 114–117 mm (4.5"–4.625") |
| Side pocket mouth | ≈ 127–133 mm (5"–5.25") |
| Head string | ¼ table length from head rail |
| Foot spot | ¼ table length from foot rail (apex ball of rack) |

### Starting physics constants (tune by feel)

| Constant | Typical value |
|---|---|
| Sliding friction (ball–cloth) μs | 0.2 |
| Rolling resistance μr | 0.01 |
| Spin (z-axis) deceleration μsp | ~0.044 (scaled by radius) |
| Ball–ball restitution | 0.92–0.98 |
| Ball–ball friction (throw) | 0.03–0.08 |
| Ball–cushion restitution | 0.7–0.85 |
| Cushion friction | 0.14–0.2 |
| Max cue speed | ~ 8–10 m/s (break) |
| Physics timestep | fixed **1/240 s** (or 1/480) with substeps; render interpolates |

All constants live in `src/config/physics.ts` and are exposed in the lil-gui debug panel.

---

## 7. Core Systems Design

### 7.1 Physics engine
1. **State per ball:** `pos (x,z)`, `vel (x,z)`, `angVel (x,y,z)`, `state ∈ {stationary, sliding, rolling, spinning, pocketed}`.
2. **Motion model (per substep):**
   - *Sliding:* contact-point velocity `u = v + ω × r` ≠ 0 → friction μs·g opposes `u`, converts to rolling over time (this is what makes draw/follow work).
   - *Rolling:* `v = ω × r` → decelerate by μr·g.
   - *Spinning:* z-axis spin decays independently (english).
3. **Collisions:**
   - Ball–ball: sphere overlap test with **swept / time-of-impact** check for fast balls (prevents tunnelling on break). Impulse along the line of centres + tangential friction for *throw*.
   - Ball–cushion: cushions as line segments with rounded jaw ends near pockets. Apply restitution, friction, and spin-dependent rebound angle.
   - Pocket: circle/capsule capture zones; when ball centre crosses the pocket's fall line → `pocketed`, emit event, animate drop.
4. **Determinism:** fixed timestep, no `Math.random` inside the solver, stable ball-iteration order. Same input ⇒ same output (replays, AI, multiplayer).
5. **Events emitted:** `cueHit`, `ballBall(a,b,speed)`, `ballCushion(ball,speed)`, `pocketed(ball,pocketId)`, `allStopped`. Rules, audio and FX subscribe to these.
6. **Simulation end:** all balls below velocity/spin epsilon for N steps → `allStopped`.

### 7.2 Cue strike model
- Inputs: aim angle, power (0–1), tip offset `(a, b)` on cue-ball face (clamped to ~0.5 R for miscue limit), cue elevation (optional, for massé later).
- Output: initial linear velocity + angular velocity of the cue ball (standard cue–ball impulse formulas; side offset adds small *squirt* deflection).

### 7.3 Rendering
- `renderer.toneMapping = ACESFilmicToneMapping`, `outputColorSpace = SRGBColorSpace`, physically correct lights.
- **Balls:** `MeshPhysicalMaterial` with `clearcoat: 1`, low roughness; textures from canvas generator; rotation from integrated angular velocity (quaternion update each frame) so numbers visibly roll.
- **Shadows:** one shadow-casting spotlight, `PCFSoftShadowMap`, tight shadow camera frustum around the table. Optionally contact-shadow blobs under balls (cheap and nice).
- **Render loop:** `accumulator` pattern — step physics at fixed dt, render with interpolation `alpha`.
- **Aim guide:** raycast the cue-ball path to first collision (reuse physics geometry), draw line + ghost ball + predicted object-ball direction (toggleable by difficulty).

### 7.4 Camera
- Modes: **Overhead** (2D-like), **Behind cue** (follows aim, default while aiming), **Free orbit** (between shots), **Follow cue ball** (during simulation, optional).
- Smooth transitions with damped lerp/slerp.

### 7.5 Input
- **Desktop:** move mouse to aim (rotate around cue ball), hold & drag back for power (or scroll / power bar), right-panel widget for spin, `Space` to shoot, `C` to change camera.
- **Mobile:** one-finger drag to aim, vertical power slider, spin widget tap, pinch to zoom.
- Fine-aim modifier (Shift / two-finger) for precision.

### 7.6 Game state machine
```
Menu → Racking → Break(Aiming) → Shooting → Simulating → Resolving
                     ↑                                     │
                     └──────────── next turn / same turn ←─┘
                                   BallInHand ─────────────┘
                                   GameOver
```

### 7.7 8-Ball rules (WPA-based) — `EightBallRules.ts`
- **Break:** legal if a ball is pocketed or ≥4 object balls hit cushions; 8 on break = win (or re-spot, configurable); scratch on break = ball in hand behind head string (or anywhere — configurable).
- **Open table** after break; first legally pocketed ball assigns groups (solids 1–7 / stripes 9–15).
- **Legal shot:** cue ball must first contact a ball of the shooter's group (or the 8 when group is cleared), then a ball must be pocketed or any ball must hit a cushion.
- **Fouls → ball in hand anywhere:** scratch, wrong first contact, no rail after contact, cue ball off table, no contact.
- **Turn continues** if the shooter legally pockets one of their balls.
- **Loss:** pocketing the 8 early, scratching while pocketing the 8, 8 off table. **Win:** legally pocket the 8 after clearing group (call-pocket optional setting).
- `ShotResult` is built from physics events: `firstContact`, `pocketed[]`, `cushionsAfterContact`, `cueBallPocketed`.

---

## 8. Execution Plan (Phases & Milestones)

Estimates assume one developer, part-time-ish. Each phase ends with something playable/visible.

### Phase 0 — Setup (½ day)
- [ ] Vite + TS scaffold, ESLint/Prettier, Vitest, folder structure
- [ ] Empty Three.js scene with renderer, resize handling, stats, lil-gui
- [ ] Deploy preview pipeline (Vercel/Netlify) from `main`
- **Done when:** blank scene deploys to a URL.

### Phase 1 — Static table scene (1–2 days)
- [ ] `config/table.ts` with real dimensions
- [ ] Placeholder table from primitives (BoxGeometry rails, plane cloth, cylinder pockets) at real scale
- [ ] HDRI + overhead light + shadows
- [ ] Procedural ball textures (canvas) and 16 ball meshes racked in a triangle
- [ ] Camera rig: overhead + orbit
- **Done when:** a convincing static racked table renders at 60 FPS.

### Phase 2 — Physics core (4–6 days) ⭐ most important
- [ ] vec math, `Ball`, `World.step()` with fixed timestep + accumulator
- [ ] Sliding/rolling/spinning motion model
- [ ] Ball–ball collisions (with swept test)
- [ ] Ball–cushion collisions (segments + jaw arcs)
- [ ] Pocket capture
- [ ] Event bus
- [ ] Unit tests: straight-on stop shot (cue stops dead), 90° cut rule (balls separate at ~90° when rolling), energy never increases, no tunnelling at max speed, determinism (same input twice → identical state)
- [ ] Debug: draw cushions/pockets as lines, velocity vectors, slow-mo toggle
- **Done when:** a scripted break looks believable and all physics tests pass.

### Phase 3 — Shooting & interaction (2–3 days)
- [ ] Cue mesh that follows aim around cue ball
- [ ] Aim controller (mouse + touch), power bar, shot animation (cue pull-back & strike)
- [ ] Cue strike → impulse incl. spin from tip offset
- [ ] Spin selector widget
- [ ] Aim guide line + ghost ball
- [ ] Behind-cue camera with smooth transitions
- **Done when:** you can freely play shots with draw/follow/side spin.

### Phase 4 — Rules & game loop (2–3 days)
- [ ] Game state machine
- [ ] Rack generation (8 in centre, one solid + one stripe in back corners, rest random)
- [ ] `ShotResult` collection from events
- [ ] `EightBallRules` + exhaustive unit tests (each foul case, break cases, win/loss)
- [ ] Ball-in-hand placement (with overlap validation, behind-head-string mode)
- [ ] Ball re-spotting (8 on break option)
- **Done when:** a complete 2-player local game can be played to a win.

### Phase 5 — UI/UX & audio (2–3 days)
- [ ] HUD: player names, group indicators, remaining balls, turn banner, foul messages
- [ ] Main menu, pause, settings (sound, aim guide, camera sensitivity, quality)
- [ ] AudioManager with velocity-scaled one-shots and rolling loop
- [ ] Pocket drop animation, subtle camera shake on break
- **Done when:** the game feels "complete" for local play.

### Phase 6 — Art pass & polish (3–5 days)
- [ ] Replace primitive table with Blender GLB (Draco-compressed), cloth/wood PBR textures (KTX2)
- [ ] Cue model, optional room environment
- [ ] Post-processing: SMAA, light bloom on lamp, vignette
- [ ] Loading screen with progress (`LoadingManager`)
- [ ] Graphics quality presets (shadows, pixel ratio cap, post FX on/off)
- **Done when:** it looks good in screenshots and loads in < 3 s on broadband.

### Phase 7 — Performance & QA (1–2 days)
- [ ] Profile: draw calls (< 50), triangles, texture memory; instancing not needed for 16 balls
- [ ] Cap `devicePixelRatio` at 2 (1.5 on mobile)
- [ ] Physics in a **Web Worker** if main-thread time is tight (optional; physics is cheap)
- [ ] Cross-browser test: Chrome, Firefox, Safari (iOS!), Android Chrome
- [ ] Handle WebGL context loss
- **Done when:** stable 60 FPS on target devices, no console errors.

### Phase 8 — Extensions (post-MVP)
- [ ] **AI opponent:** enumerate candidate shots (ball × pocket × spin × power), simulate each with the deterministic engine headlessly, score outcome (pocketed, cue-ball position, safety). Difficulty = noise added to aim/power + search depth.
- [ ] **Online multiplayer:** Node server imports `physics/` + `rules/`; clients send only shot parameters; server simulates & broadcasts result (or lockstep with both simulating since engine is deterministic) + rooms/matchmaking.
- [ ] **Replays:** store initial state + shot params; re-simulate.
- [ ] **Snooker mode:** new table config (12 ft: 3.569 × 1.778 m, 52.5 mm balls), `SnookerRules` implementing `Rules`, 22-ball rack, scoring/break tracking.
- [ ] **9-ball mode** (cheap win: different rack + rules class).
- [ ] PWA (offline install).

**Rough total to MVP (Phases 0–7): ~3–4 weeks part-time.**

---

## 9. Testing Strategy
- **Physics unit tests** (Vitest, headless): known-answer shots, conservation checks, determinism, edge cases (balls frozen against each other, ball on pocket jaw, max-power break).
- **Rules unit tests:** construct `ShotResult` objects directly, assert outcome — no physics needed.
- **Golden replays:** save a few full-game shot sequences; CI re-simulates and compares final positions (catches accidental physics changes).
- **Manual playtest checklist:** stop shot, draw back, follow through, side spin off cushion, bank shot, kick shot, break scatter, scratch, 8 early.

---

## 10. Performance Budget

| Metric | Target |
|---|---|
| FPS | 60 desktop / 60 (min 45) mobile |
| Draw calls | < 50 |
| Initial download | < 8 MB (models + textures + audio) |
| Physics step cost | < 1 ms per frame at 240 Hz |
| Time to interactive | < 3 s on broadband |

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Physics feels "floaty" or wrong | Start from real constants, expose everything in lil-gui, compare against real-table videos; write known-answer tests early |
| Tunnelling at break speed | Swept collision / time-of-impact + small fixed timestep |
| Balls jittering when touching | Resting-contact handling + velocity epsilon snapping to stationary |
| Pocket jaws behaving oddly | Model jaws as arcs, not just segment ends; debug-draw geometry |
| iOS Safari quirks (audio unlock, memory) | Unlock audio on first tap; KTX2 textures; cap DPR |
| Scope creep (AI, online) | Strict MVP; physics/rules isolation makes later features additive |
| Asset licensing | `CREDITS.md`, prefer CC0, model the table yourself |

---

## 12. Definition of Done (MVP)
- [ ] Two players can complete a full 8-ball game in the browser following WPA rules
- [ ] Draw, follow and side spin behave convincingly
- [ ] All physics & rules tests green in CI
- [ ] 60 FPS on a mid-range laptop and a recent phone
- [ ] Deployed to a public URL, `CREDITS.md` complete

---

## 13. Useful References
- Three.js docs & examples: threejs.org/docs, threejs.org/examples
- Billiards physics: Dr. Dave Alciatore's billiards physics resources (Colorado State University) — the standard reference for squirt, throw, cushion and spin behaviour
- *"Pool and Billiards Physics Principles by Coriolis and others"* — Leckie & Greenspan, and Mathavan et al. papers on cushion impact models
- WPA World Standardized Rules (8-ball) — wpapool.com
- Free assets: polyhaven.com, ambientcg.com, kenney.nl, freesound.org
