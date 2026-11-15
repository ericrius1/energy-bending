# 18 · Flow: room to move, and movement that carries

The owner played the phase 5 build and said: "feels a little stifling.. want it to feel more like possibilities are
open to move and flow." Later they set a wider aim: one flowing world, where you dance through mirrors into the other
worlds without a break. This pass measures what made it stifling, then fixes it in three places: the movement, the
arenas' layout, and the space's edge. Contact play stays where it was: catches about the same, falls near 0, and fusion
about as rare.

Branch `p5-flow`, merged with master after p5-wayfinding, p5-you and p5-steam.

## What made it stifling (measured)

`scripts/flow-measure.mjs` (src/duel/flow.ts) is new. It measures each arena as a body sees it, then plays seeded sets
through the real bodies, contact and rules (sim.ts) and records how the bodies move. Before is master as it was (with
only the two read-only counters added). After is this branch. Both use 16 sets per world, skill 0.85, at each world's
own tempo.

**The room** (the same arenas, read statically):

| | temple | redwoods | geode | Pool |
|---|---|---|---|---|
| runnable floor, m² (share of the space) | 254 (67 %) → **269 (71 %)** | 293 → 294 | 282 → 282 | 287 (64 %) → **318 (70 %)** |
| a straight run from open floor carries, m (median) | 3.4 (2.2) → **5.4 (4.0)** | 4.3 (3.2) → 4.3 (3.2) | 4.5 (3.6) → 4.6 (3.6) | 1.4 (1.0) → **2.1 (1.4)** |
| clear lanes out of 32 (3 m out to the edge) | 1 → **7** | 8 → 8 | 4 → 5 | 0 → 1 (+ 3 open-water channels) |

**The play** (per body, per minute of play):

| | temple | redwoods | geode | Pool |
|---|---|---|---|---|
| runs stopped by a solid or the edge, a minute | 9.7 → **3.6** | 6.7 → **4.7** | 7.4 → **4.3** | 14.8 → **9.3** |
| mean speed, m/s | 2.96 → **3.18** | 3.11 → **3.51** | 2.97 → **3.53** | 2.72 → **3.40** |
| time over 4 m/s | 36 % → 38 % | 38 % → 42 % | 36 % → 42 % | 33 % → 42 % |
| time against something (a face, a wall, the edge) | 3 % → 2 % | 3 % → 2 % | 3 % → 2 % | 4 % → 4 % |
| speed the space's edge took, m/s a minute | 52 → **10** | 51 → **7** | 11 → 8 | 75 → **13** |
| a fling carries, m | 1.4 → **2.1** | 1.5 → **2.3** | 1.7 → **2.6** | 1.5 → **2.4** |
| cells of the space crossed in a set | 31 % → 36 % | 30 % → 35 % | 23 % → 30 % | 22 % → 27 % |
| air time | 28 % → 23 % | 27 % → 30 % | 43 % → 40 % | 39 % → 41 % |
| distinct surface-to-surface routes a set | 6.7 → 4.7 | 3.2 → 3.3 | 4.2 → 5.8 | 7.0 → 6.1 |

What it showed:

1. **The air braked hard.** With the stick let go in the air, the body lost speed at 10 m/s² (`airDrag`). On top of
   that, a body rising without the jump button held fell at 3.2 times gravity (the short hop's `cutMul`), and that
   applied to a flung body too. A fling carried only 1.4 to 1.7 m.
2. **Slanted contact stopped the body.** A face took all the speed going into it. The stick was still pushing into the
   face, so the snappy steering kept pulling the run back into it, and the face took that again on every substep. A
   run along a wall at a slant crawled at 1.9 m/s (top speed is 6.5). A run at a knee-high stone stopped dead.
3. **The edge was a wall.** Past its radius, the space's soft wall removed all of a body's outward speed in one frame.
   That cost 50 to 75 m/s a minute in the temple, the redwoods and the Pool.
4. **The middle was full of stones.** The temple had a fallen drum, the plinth and a toppled lintel in the middle of
   its court. In the before sheet the pair dances among columns at the rim with the camera boxed in, because the play
   was born under the stage's lintels. The Pool had seven standing stones at mid radius and no lane anywhere: a straight
   run carried 1.4 m.

The camera (p5-camera's) was not the main cause. Where the eye was boxed in, pieces near the pair were boxing it.

## What changed

### Movement (src/dancer/character.ts, the duel's profile only; the jogo is untouched)

- **A glance** (`glance: 0.8`, `glanceCos: 0.85`). A face met at a slant turns 80 % of the speed it took along the
  face. A face met nearly square on still stops the body, so walls are still walls to slide down and kick off.
- **Along the face at full push.** While a face was touched in the last 60 ms and the stick pushes into it at a slant,
  the run goes along the face at the stick's full push. Measured: 1.9 → 6.4 m/s along a wall run at 35°.
- **A vault** (`vaultH: 1.1`). A low thing run at, with the stick pushing into it (a drum on its side, a planter, a
  stump, a low block, a log), is hopped onto with the run's speed kept. Things taller than 1.1 m still stop the body,
  or are climbed by jump or wall run. An air version (catching the lip) was tried and dropped, because it took over
  the wall slide on an ice step (powers test).
- **Carried flights** (`Character.carry(s)`, `flightSteer: 0.4`; contact.ts `CARRY_S: 1.1`). A fling keeps its speed
  through the air for 1.1 s, and a lift for 0.8 s. There is no air drag in that time, and the stick turns the flight at
  0.4 of air acceleration instead of braking it. The short hop's heavy gravity now applies only to a jump the player
  made, not to a flight given by someone else or to a vault.
- **The air keeps momentum**: `airDrag` 10 → 3.5 and `airOver` 6 → 4. On the ground, speed over a run bleeds off
  slower: `groundOver` 30 → 16, so a fling's landing, a wall kick or a dash rolls on. `groundDecel` is unchanged:
  letting go of the stick still stops you crisply. `dashEndMul` 0.6 was tried and dropped, because it pushed the
  camera test's eye near pieces over its limit.
- **Water glides** (hazards.ts `GLIDE_EASE`). A body enters the water with whatever speed it brought (a run, a dash, a
  fling). That speed is its top speed there at first, easing to the swim speed (`SWIM` 3.4 → 3.6) over about a
  second. Water carries you along instead of catching you.

### The space's edge (src/duel/match.ts `softWall`, `EDGE`)

From 1.6 m inside the radius, the outward part of a body's speed is turned along the edge, more strongly the further
out it is, and 85 % of it is kept. A run into the edge curves round it the way a skater's would. Past the radius the
body is eased back as before. Only a body far past it (1.4 m: a full-speed fling) is stopped outright, as before.

### The arenas (src/worlds/*/arena.ts): moved, not deleted

Before / after maps: `media/18-flow-map-<world>-before.jpg` and `-after.jpg`. Green is runnable floor, blue is drops,
stones are shaded by height (darker is taller), pink is spawns, and dashed rings are the ways out.

- **Temple.** Every scattered stone moved off the court's floor to its rim, so the court in front of the stage is open
  floor (the duel camera's side, too). The right rim is a stair to the mirror to the Pool: the stepped blocks, a
  fallen drum to vault, then a snapped stack. Past the mirror, the tall stack stands beside the broken column. The left
  rim works the same way, from the steps by the hub gate to the mirror to the redwoods, then a stub and the tall stack
  up to the column. The plinth, the cube, the low block and the stack stand behind, toward the high lintel. The set
  now starts in the open court, at (±2.6, 1.6), not under the lintels. Same stones, the same count of each kind, with
  their vines.
- **Pool.** Open-water channels run out from the middle to the hub gate and to each mirror, beside the one along the
  stage. Each mirror has open water 2.4 m round it. There are five standing stones instead of seven, and they stand
  toward the rim (7.5 to 10.8 m out, not 4.5 to 9.5), where they had walled in both the pair and the eye. With the
  water's glide, the channels are lanes to slide along.
- **Redwoods.** The flat-topped stump that stood in the hub gate's lane is now 1.0 m tall and stands beside a bough's
  tip, so it is the first step up that bough. Its spawn moved with it. The rest of the clearing was already the most
  open of the four.
- **Geode.** The low front beam that stood in the redwoods gate's path, at (0, 7.4), is now at the right side behind
  the plane's end. It was also near the camera's eye.

### Ways out, for p5-wayfinding (`Arena.exits`, `mirrorExits` in src/duel/arena.ts)

Each arena lists its ways out: its world's gate to the hub, and the mirrors from `portals/mirrors.ts MIRROR_SITES`,
read from that table so the two never drift apart. Each has `at`, the way out (`dir`) and `r`. A test
(src/duel/test/flow.test.ts) checks that no solid stands lower than 2.6 m in each disc. For the mirrors and the hub's
gates it also checks a lane 3 m deep and 1.2 m wide leading in toward the middle.

| world | ways out (r) |
|---|---|
| temple | the hub gate (-7.3, 5.0) r 1.0 (the world's own stones stand round it); the mirror to the Pool (8.5, -0.5) r 1.4, reached by the right stair; the mirror to the redwoods (-8.0, 0.2) r 1.4, reached by the left stair |
| Pool | the hub gate (-7.5, 4.5); the mirror to the temple (7.5, 4.5); the mirror to the redwoods (0, -8.5): each at the end of an open-water channel |
| redwoods | the hub gate (-10.03, 5.23); the mirror to the temple (7.7, 6.1); the mirror to the Pool (5.85, -7.8) |
| geode | its three gates (r 1.2: inside each one's crown of crystals), each with a clear lane to the middle |

The space's soft edge still turns a body back at the radius. Where a mirror stands at the edge, wayfinding may want to
open the edge there; `EDGE` in match.ts and `exits` are the hooks. I did not change it.

## Contact play, before and after

`scripts/duel-measure.mjs --sets 40 --bpm own`, Node, free view, skill 0.85:

| | temple | redwoods | geode | Pool |
|---|---|---|---|---|
| catches a minute | 24.4 → 23.5 | 24.0 → 22.6 | 23.2 → 22.5 | 27.0 → 24.7 |
| falls a set | 0.00 → 0.00 | 0.00 → 0.07 | 0.20 → 0.10 | 0.00 → 0.00 |
| sets fused (of 40) | 5 → 9 | 8 → 6 | 9 → 6 | 8 → 6 |
| apart, m (mean) | 1.6 → 1.8 | 1.6 → 1.8 | 1.6 → 1.8 | 1.4 → 1.7 |
| peak energy | 0.89 → 0.88 | 0.89 → 0.88 | 0.89 → 0.90 | 0.91 → 0.92 |

Fused across all four worlds: 30 of 160 before, 27 of 160 after.

- Before retuning, the flowing movement carried the two further apart after each fling, the energy ebbed, and fusion
  fell to 7 of 160.
- I retuned each arena's `energy` (DuelTune, the Pool's precedent): temple gain 1.06 / ebb 0.92, redwoods 1.04 / 0.94,
  geode 0.98 / 1.025 → 1.05 / 0.93, Pool 0.93 / 1.15 → 1.0 / 1.02. That brought fusion back to about the old rate. The
  page was tuned to about 1 in 8 from these same Node rates (report 16).
- Catches are 4 to 9 % lower: a fling now carries 2 to 2.6 m, not 1.5, so a re-catch is further away.
- In the lock (temple and Pool, 8 sets each, compared with master in the same run), catches and links are within
  noise in the temple and a little lower in the Pool (13.3 → 11.1 catches a minute; it was the weakest lock world
  before too).

## Stills

These are the duel's own camera at 1280×720: two virtual players, fire and water, seed 3. Each sheet is six frames, 4 s
apart from 8 s in. The after captures use `&mirrors=0`, so the bots don't dance through a mirror and the frames
compare. `scripts/flow-cap.mjs` makes them.

- `media/18-flow-<world>-sheet-before.jpg` / `-sheet-after.jpg`: the sheets.
- `media/18-flow-<world>-before.jpg` / `-after.jpg`: the third frame of each, the same moment of the same seeded set.

Honest look at them, at the player's size:

- **Temple: clearly better.** Before, five of six frames are among columns at the rim, with the eye pinned against
  stained-glass screens and drums. After, the pair dances in the open court: the stage and the colonnade are the
  backdrop, and the sea and the sky are open behind them. At the top of the tide the eye sits at the waterline and the
  canopy's underside shows at the top of the frame. That is the camera's and the tide's business, and I left it.
- **Redwoods: much as before.** It was already open. The pair ranges more widely across the meadow.
- **Geode: little change to the eye.** It was already open, apart from the moved beam.
- **Pool: mixed.** The numbers moved most here: stops 14.8 → 9.3 a minute, speed +25 %. But the frame is still often
  crowded by a planter or a standing stone near the eye (frames 1 and 4 of the after sheet). The Pool is a field of
  stones by design. Opening it further would mean fewer stones or a camera that rises over them, and I stopped short of
  both.

## Tests

- `npm run typecheck`: clean.
- `node scripts/test-ts.mjs`: 24 of 24 files pass, including the new `src/duel/test/flow.test.ts`:
  - a glance keeps 6.4 m/s along a wall
  - a 0.9 m block is vaulted at a run, and a 3 m block still stops the body
  - a carried flight goes 5.0 m in 0.5 s, against 4.0 m without carry
  - the soft edge keeps 6.9 m/s along it
  - every arena's ways out are clear

  The camera test's "eye stays clean" check (≤ 14 % near frame, ≤ 1.5 % eye near) passes after the changes. A 0.6 dash
  exit broke it, so I dropped that change.
- check-limits, check-bindings and test-audio were not touched (no shaders, no sound).

## Files

- src/dancer/character.ts: the duel profile's numbers; glance, slide along a face, vault, `carry`; `blocked`,
  `vaulted` and `flightT` for the measure.
- src/duel/contact.ts: `CARRY_S`; a fling or a lift carries.
- src/duel/match.ts: the soft edge (`EDGE`); `bounded` for the measure.
- src/duel/hazards.ts: the water's glide.
- src/duel/arena.ts: `Arena.exits`, `mirrorExits`.
- src/worlds/temple, pool, redwoods, geode `/arena.ts`: layouts, spawns, energy, exits.
- src/duel/flow.ts and scripts/flow-measure.mjs: the measure, and the top-down map SVGs.
- scripts/flow-cap.mjs: the camera sheets.
- scripts/svg-shot.mjs: SVG to JPEG.
- src/duel/test/flow.test.ts.

## Not done / unverified

- **Not checked in the page.** I did not run `duel-page.mjs` (with `&mirrors=0`) for the fusion rate in the page. The
  energy retune was made against Node only, and the page has run hotter or cooler than Node before (report 16). That
  is the first thing to check.
- **No GPU timings.** I added no drawing (pieces only moved), so I did not take `shot.mjs --timings`.
- **Not felt by hand.** No person has played it. The vault height (1.1 m), the glance (0.8) and the carry (1.1 s) are
  measured on bots and in tests. A human might want the vault lower, or the carry shorter.
- **No rails, vines or ramps.** I added no new route pieces such as rails or vines to swing on, or ramps. A ramp would
  need sloped tops, which `topAt` rejects past 10°. The routes are re-laid stairs of the stones already there.
- **Where the bots dance.** The bots still choose where the dance goes (src/ai/duel-brain.ts, unchanged). They seek
  pieces for flings and wall kicks, so the open floor is used mostly because the set now starts on it.
- **The soft edge at a mirror.** Steering a body past the edge into a mirror is wayfinding's to decide.
