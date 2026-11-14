# Phase 1 (Move): the duel itself and its virtual players

Branch `worktree-agent-a76fd4610dcbd98bf`, from master `df03f4a`, with master merged twice since: the owner's
correction of the design (`b91e987`: still a dance, 3D native, the lock an option anywhere) and the duel's HUD
(`81b71bb`). Built first as a 2D arena duel to the first brief, then rebuilt in 3D to the correction; everything below
is the 3D build unless it says "locked".

## What was built

| file | what |
|---|---|
| `shared/duel.ts` | the duel's rules, pure (no clock, no I/O, no physics), so a server can run them later: the count-in (3, 2, 1, BEND, a beat each), hits (a strike's hit capsule meets the other's hurt capsules, each attack lands once, knockback per move along the ground away from the attacker and up, doubled on an 8th-note line within ±60 ms), blocks (a push, no hit), i-frame dodges, clashes, three hits a KO, a fall below the space's `yKill` a KO (credited to the last hitter within 4 s), the scatter (0.6 s), the re-forming at the spawn farthest from the other (by 1.5 s), 1 s untouchable, five KOs a round, 4 s of the winner, the next round. **Flow**: each move started builds the jogo's flow for that move (`RULES.moves`), ×1.5 on the beat, ×0.25 for the third same move running, × a perfect streak (1 + 0.1 per perfect move in a row, up to 3); a wall jump +5, a flip in the air +4; a hit landed +6 (×1.5 perfect), a hit taken −10 and the streak gone, a KO halves it. Events: count, go, hit (perfect flag), block, dodge, clash, ko, reform, ready, won, round. |
| `src/duel/match.ts` | the rules joined to two `Character`s, pure: reads each body (capsules in the world, **flattened onto the stage plane when locked**, so a locked duel is exactly 2D), tracks the beat each move started on, feeds moves and travel to flow (a jump in the air against a wall counts as a wall jump until the movement work names its own event: `walljump`, `wallJump` or `jump` with `wall` are read too), the space's **soft wall** (past its radius a body is eased back and its outward speed taken away), and applies what the rules decide (`applyKnock` in 3D; re-forming sets both `Character.home`, free, and the duel plane's `spawns[seat]`, locked, then `spawn()`). |
| `src/duel/arena.ts` | the contract's bare `Arena` registry (3D `space`, 3D `spawns`, `pieces`, `plane`), so the mode compiles before the arena work lands: **take theirs**. |
| `src/duel/fallback.ts` | an arena from what a world already has, until its own lands: the space a circle round its stage's middle (0.6 × its room, 4 to 7.5 m), `yKill` 2.2 m under the lowest standing place (above the world's own `fallY`: the forge −2.5), spawns at the stage's two and round the space where the floor stands clear of `World.solids`, the stage plane with walls on its solid ledges' sides for the lock. |
| `src/duel/index.ts` | `?duel` (dispatched from `registerPlay`): two seats, free 3D by default with the follow camera behind seat 1 framing both, `&lock` (or `l`, or a player's lock button) for the 2D lock onto the arena's plane anywhere; `&p1` / `&p2` human or bot, `&skill`, `&style`, `&seed` (each one value or "a,b"), `&dress`, `&world`, `&go`. Humans join by device (keyboard, split keyboard, gamepad: the first device plays the first human seat); the duel starts when every human seat has one. A seat's source is gated: nothing gets through in the count-in or while its matter is scattered. `bend.duel`: state, events, history, hud(), start, restart, setBrain(seat, spec \| Brain \| null), ghost(seat, spec), wish(seat), stats(). |
| `src/duel/fx.ts` | what is seen and heard, phase 1: the jogo's `Feel` reused for hits and clashes (its wind, ring of stars, puff, sparks and sounds; the knock left to the duel), plus the KO's scatter (the hand's one-frame blast at the chest throws the matter off, the field's wind, a double ring and sparks, both pads rumbling), the re-forming (motes streaming to the spawn, a ring rising up the body), a shimmer while untouchable, a flash on a perfect hit, count-in pulses, the winner's rings. |
| `src/duel/hud-state.ts` | the `HudState` each frame (src/hud's types) to `hud.set`: hits of 3, KOs of 5, flow as `superMeter`, the dash's readiness when the body has one (read as `dashReady` or `dashCharge`), reforming 0…1, each head through `screenOf` after the camera moved, the round's clock and phase, the beat and its ±60 ms window, pops (BEND, PERFECT, KO, FELL, BLOCK, CLASH, P1 WINS). |
| `src/ai/duel-brain.ts` | the virtual player (below). |
| `src/duel/sim.ts`, `probe.ts`, `scripts/duel-sim.mjs` | the Node harness: two brains through the real bodies and the rules, free or locked, many seeded rounds. |
| `src/duel/stages.ts` | the temple's, forge's and pool's stage, floor, solids, room and fall-out in Node, from the same pure layouts the worlds use. |
| `scripts/playtest.mjs` | the real page with real key presses in real time. |
| `films/duel-1.json`, `film.mjs` / `film-shot.ts` | a timeline `mode: "duel"`. |
| `src/duel/test/duel.test.ts` | 18 tests (in `npm test`). |

Outside `src/duel`: `src/play/index.ts` (the `?duel` dispatch, `PlayApp.hand`), `src/main.ts` (passes `hand`),
`src/dancer/play.ts` (`PlayCtx.stage`: the plane locking uses, so the duel's arena plane survives play.ts's own
"the world's stage" lock), `src/engine/film-shot.ts` (the mode's name), `scripts/film.mjs` (the duel's page query).

### The virtual player (`src/ai/duel-brain.ts`)

A `Brain` that plays through Intents only, free or locked, whichever its body is in.
- **Seeing**: the other body as it was a reaction time ago (log-normal about 0.33 − 0.15·skill s, lapses), carried
  forward by its velocity (0.2 + 0.7·skill of the lag), with an aim error (0.5 − 0.38·skill m) that drifts between reads.
- **Deciding** every 0.15 to 0.3 s: a place by style (aggressive in its face, evasive poking from the edge of its reach
  and backing off when crowded, showy close by way of wall kicks, flips and aús; everyone in at once on an opening, an
  attack's recovery). Free, the pair **circles** as the jogo's does (both the same way, the sense turning every four
  bars); the goal is kept inside the space and a step back from any edge; now and then a high place to jump onto or a
  solid to kick off.
- **Fighting**: each attack's reach is measured once from the move library's own capsules (`Character.shapesAt`, a free
  body facing +z: forward, sideways and up ranges while live); a strike when the other's predicted body is in one,
  waiting for the next 8th-note line when it is near (beat accuracy σ 95 → 20 ms with skill). Free, it stands a moment
  to turn to the other first and throws only once it faces it. **Answers**: an attack seen starting (after its own
  reaction time; answered 0.18 + 0.62·skill of the time) is jumped, or met with esquiva, **negativa** (through the
  flourish hint), **aú**, a roll away, a block, or a strike back.
- **Dancing between exchanges**: the ginga (the idle), and on the beat a flourish (aú, macaco, spin, the pirouette
  where registered).
- **Moving, free**: toward the place in eight directions held like a thumb (0.13 s and more between changes), round a
  pillar (anything its body can't stand on above 2.1 m), onto a stump, the altar or a slab (the jump held for its
  height, the air jump at the top for a tall one), a gap jumped running, never off into a pit it can't come back from;
  in the air back toward floor over the void, the air jump, a kick off a solid it falls against. **Locked**: along the
  plane's floor and ledges (run-ups onto solid ledges, drops through one-way ones, gaps jumped, the edge kept) and off
  its walls. The dash (`Intent.dash`) behind `'dash' in makeIntent()`, to close a long gap.

## Measured

PLAYTEST_AND_FILM

### Node (`node scripts/duel-sim.mjs --rounds 10`, skill 0.7 both, seeds 1 + 101k, 160 rounds in 4 s)

| world | view | styles | round s (p10–p90) | KO every s | hits/KO | falls/KOs | hits/min | perfect | jumps/min | wall/min | flips/min | air | flow end | top moves/min |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| temple | free | aggressive v aggressive | 84 (67–103) | 16.3 | 3.00 | 0/85 | 9.4 | 61% | 9.8 | 4.6 | 0.1 | 20% | 66 | martelo 8.9, bencao 6.1, armada 5.7, meia-lua 3.8 |
| temple | free | aggressive v evasive | 110 (92–144) | 22.8 | 3.00 | 0/84 | 6.9 | 60% | 12.0 | 4.2 | 0.1 | 21% | 69 | martelo 6.9, bencao 5.6, armada 5.1, meia-lua 2.8 |
| temple | free | showy v aggressive | 117 (96–145) | 24.1 | 3.00 | 0/82 | 6.6 | 60% | 11.9 | 4.5 | 1.9 | 22% | 68 | martelo 8.2, armada 5.4, bencao 5, spin 4.8 |
| temple | free | evasive v showy | 163 (120–228) | 34.7 | 3.00 | 0/83 | 4.7 | 61% | 13.3 | 4.0 | 2.6 | 22% | 69 | spin 6, martelo 5.4, armada 3.9, bencao 3.9 |
| temple | locked | aggressive v aggressive | 53 (46–58) | 10.5 | 3.00 | 0/83 | 14.3 | 69% | 19.4 | 2.0 | 0.1 | 28% | 68 | bencao 14.3, martelo 13.8, rasteira 7.2, armada 5.8 |
| temple | locked | aggressive v evasive | 66 (57–79) | 13.0 | 3.00 | 0/84 | 11.9 | 68% | 19.6 | 2.3 | 0.2 | 28% | 71 | martelo 12.4, bencao 11.8, rasteira 6.5, armada 6 |
| temple | locked | showy v aggressive | 57 (49–73) | 11.0 | 3.00 | 0/84 | 13.5 | 67% | 19.5 | 1.7 | 1.3 | 28% | 67 | martelo 15.1, bencao 11.1, armada 5.6, rasteira 5.6 |
| temple | locked | evasive v showy | 90 (79–116) | 19.5 | 3.00 | 0/80 | 8.1 | 72% | 22.5 | 2.4 | 1.1 | 30% | 71 | martelo 14.2, bencao 10.4, armada 5.7, rasteira 5.6 |
| forge | free | aggressive v aggressive | 76 (71–100) | 15.7 | 2.51 | 27/81 | 8.1 | 54% | 10.7 | 7.4 | 0.2 | 26% | 68 | martelo 7.4, bencao 5.5, armada 4.4, meia-lua 4.2 |
| forge | free | aggressive v evasive | 102 (88–133) | 22.0 | 2.42 | 28/79 | 5.9 | 57% | 11.7 | 8.4 | 0.1 | 28% | 67 | martelo 5.7, bencao 5, armada 4, meia-lua 2.8 |
| forge | free | showy v aggressive | 95 (75–130) | 20.3 | 2.39 | 31/80 | 6.2 | 56% | 13.3 | 7.6 | 2.1 | 29% | 66 | martelo 7.1, armada 4.2, spin 4, bencao 4 |
| forge | free | evasive v showy | 149 (120–211) | 31.3 | 2.27 | 37/81 | 3.9 | 59% | 12.7 | 9.2 | 2.1 | 29% | 70 | martelo 4.7, spin 4.6, bencao 3.7, armada 3.4 |
| forge | locked | aggressive v aggressive | 49 (43–57) | 9.3 | 2.87 | 6/85 | 15.3 | 70% | 6.6 | 0.2 | 0.1 | 13% | 66 | bencao 19.7, martelo 8.3, rasteira 7.2, armada 6.5 |
| forge | locked | aggressive v evasive | 55 (48–65) | 10.9 | 2.68 | 16/79 | 12.1 | 74% | 7.1 | 0.3 | 0.0 | 14% | 69 | bencao 15.9, martelo 7.9, armada 6.2, rasteira 5.7 |
| forge | locked | showy v aggressive | 42 (34–51) | 9.2 | 2.72 | 11/75 | 14.4 | 67% | 7.4 | 0.3 | 1.0 | 15% | 62 | bencao 13.8, martelo 8.6, armada 7.3, rasteira 5.5 |
| forge | locked | evasive v showy | 62 (54–80) | 12.5 | 2.44 | 27/82 | 9.9 | 67% | 8.3 | 0.2 | 1.2 | 15% | 67 | bencao 11.7, martelo 7.8, armada 6.5, spin 5.5 |

## Weak points

WEAK

## Not done

NOTDONE
