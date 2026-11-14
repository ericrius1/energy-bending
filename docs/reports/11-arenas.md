# Duel phase 1 ("Move"): the arenas

Branch `worktree-agent-a516f31550f951f5d`, from master `df03f4a`, with the owner's corrected design (`b91e987`,
docs/design/duel.md: the duel is 3D native, the 2D lock an option anywhere) merged in mid-way. One of four agents on
phase 1; mine is the arenas. The movement, the duel's rules and virtual players, and the HUD are the others'.

**Measured:** `npm run typecheck`; the full `npm test` (limits, the binding budget: 153 entry points, the new shaders
within the baseline; 11 TS test files including the new `src/duel/arena.test.ts`; audio; 10,037 gate checks; the net
tests); `?baseline` on every world with its arena shown; stills of every arena on the RTX 5090 at 1920×1080 (headless
Chrome, a production build served by `vite preview` on 127.0.0.1:5506, under the shared render lock), locked and free,
with and without the debug lines, all looked at; GPU timings per world with the arena's matter on and off.
**Not measured:** a body moving in any of it (the movement kit, merged since, stands on solids' tops and slides on
their faces in free 3D: my pieces are in `World.solids` for it, but I took no take of a body climbing), a person
playing, a phone.

**Results.** `npm test` exits 0 (155 entry points within the baseline; `src/duel/arena.test.ts`: 20 checks, every
arena passes `checkArena`). `?baseline` renders the five arenas and the five worlds' jogo locks with no failed pipeline
and nothing on the console but Chrome's powerPreference notice. The jogo's worlds draw exactly as before while no arena
is shown (the jogo stills under `?baseline` show none of the pieces, the drops or the rim).

**Cost** (RTX 5090, 1920×1080, the arena view locked and wide, 150 frames stepped, the main view's scene and glow passes
with the arena's matter on less off; the whole frame's difference also moves with which gate's view happens to be live):

| world | scene pass | glow pass (the rim) | added |
|---|---|---|---|
| geode | 0.195 → 0.265 | 0.033 → 0.048 | +0.085 ms |
| redwoods | 0.859 → 0.942 | 0.037 → 0.034 | +0.080 ms |
| pool | 0.022 → 0.127 | 0.030 → 0.036 | +0.111 ms |
| temple | 0.424 / 0.439 → 0.561 / 0.567 (two takes) | 0.033 → 0.033 | +0.13 ms |
| forge | 0.184 → 0.237 | 0.022 → 0.034 | +0.065 ms |

All within the 0.15 ms asked. The temple cost 0.23 ms with its drums at the court's detail (120 sides, flutes in the
mesh); its duel drums now draw at 48 sides with the flutes in the light only (what a phone draws for the court), which
brought it to 0.13. The rim light is 0.01 to 0.015 ms where it is measurable. Stills: `docs/reports/media/11-arena-sheet.jpg`
(every arena: locked, locked with the debug lines, free from three angles, one with the debug lines) and
`11-arena-<world>-{lock,lock-debug,free-a,free-a-debug}.jpg`; `scripts/steps/arena-gen.mjs` writes the steps
(`arena-shots.json`), `arena-timings.json` and `arena-baseline.json` the rest.

## What an arena is now

`src/duel/arena.ts`, the contract in docs/design/duel.md, filled per world by `src/worlds/<world>/arena.ts` and
registered from each world's `index.ts` (`arenas.register`, `arenaFor(worldId)`):

- `space` `{ center, radius, yKill, yTop }`: the 3D play space, a radius of 10.5 to 12 m (21 to 24 m across); below `yKill` is a KO.
- `spawns`: 3D points, 6 or 7 per arena, at least 3 m apart, each standing on something (the test checks).
- `pieces`: the solids the duel adds (`src/worlds/solids.ts` boxes and capsules), built from the same description the
  world draws them from, and in `World.solids` while the duel shows the arena.
- `plane`: the stage plane through the space for the 2D lock, its `ledges` and `walls` (the `Wall` type and
  `StagePlane.walls` added to `src/engine/camera.ts` exactly as duel.md writes them) cut from the solids it crosses
  (`slicePlane`) or written from the same numbers, its floor with two drops in it.
- `camera` `{ minDist, maxDist, lens }` (+ `low`, the lowest height the lock is worth framing).
- beyond the contract: `drops` (the holes in the floor, in the plane's coordinates) and `rim` (the rim light's colour).

The switch: **`showArena(worldId)`** (and `showArena(null)`), with `arenaShown(id)`, `shownArena()`, `onArena(fn)`. While
it is on for a world, that world draws its pieces, lists them in `World.solids` (a getter now: the camera, the near fade
and the movement see them), opens its drops (its `groundAt` falls away there; the temple's, the geode's and the
redwoods' backdrops draw the pits; the redwoods' grass and flowers keep off them), and the arena's light shows. Off,
every world draws exactly what it drew before (the jogo, the films).

For the movement, `src/duel/arena.ts` also has `topAt(solid, x, z)` (the top of a box standing square, an upright drum,
a lying log; nothing for a leaning crystal or a sloping bough), `groundUnder(solids, x, z, y, floor)` (the highest top
within a step of the feet, else the floor: standing on solids in free 3D), `crossing`/`slicePlane` (a solid's extent on
a plane), `inDrop`, and `checkArena` (the test's checks).

## The five arenas

Each is in its world's folder, `arena.ts`; the numbers are `describeArena`'s (the test prints them). Heights are over
the floor: a jump is 2.18 m, a jump and the air jump 3.81 m (the movement kit's numbers).

- **Forge** (`forge/arena.ts`): a space 24 m across round the anvil, no ground (the sky, the fire below; KO under
  −3.6 m). 22 floating stones of the stage's basalt (hexagonal columns with one flat top, drawn by `slabs.wgsl` from
  a buffer of their own, 195 column solids): low ones in front and past the anvil's ends to catch a fall (−1.2 to 1.9
  m), a climb of stones behind it (1.2, 2.3, 2.7, 3.3, 4.0, 4.7, 5.5, 6.4 m), and on the plane a set whose run of
  columns lies exactly on it. Plane: 18 m, 22 walls (every slab's and stone's ends, as deep as their end columns
  hang), platforms 1.8 (the floats, bobbing), 3.1 (the crown, bobbing), 3.4, 3.4, 5.6, 5.6, 7.2; drops: the sky between
  the anvil and the low stones. 7 spawns. Rim: the fire's orange, round each stone's top (its columns' hull).
- **Temple** (`temple/arena.ts`): a space 22 m across over the court. The jogo's stage as it stands, plus in its own
  stone (`stones.wgsl`, a buffer of their own): a second lintel mirroring the first, a high lintel at 5.9 m on two
  taller columns further back, a tall snapped column at each end carrying a piece of its architrave out over a drop
  (4.6 / 5.1 m), and round the court off the plane drums fallen on their sides, a toppled lintel, a plinth, stubs of
  pillars, two more tall snapped columns, courses of a wall, a block and steps by the great gate (52 solids). Two drops
  in the court beside the broken pillars (2.2 × 2.85 m, down to the sea bed, flooded by the tide: the backdrop draws
  their ashlar sides). Plane: 18 m, 10 walls, platforms 1.1, 1.9, 1.9, 3.1, 3.1, 4.6, 4.6, 5.1, 5.1, 5.9. 7 spawns. Rim:
  the afterglow's warmth (the moon already silvers every top).
- **Geode** (`geode/arena.ts`): a space 21 m across inside the hollow. The jogo's three blades, plus selenite grown the
  same way (`shelves.wgsl`, `crystals.wgsl`, buffers of their own): a great crystal at each end of the plane, shelves
  from them in along it (3.6, 4.4 m), three shelves reaching across the plane from druses and a crystal trunk behind it
  (5.8, 5.8, 7.4 m), two beams of selenite stood upright at the drops' outer edges (3.0 m), ten more beams round the
  back and sides (1.0 to 3.6 m) and seven shelves grown in from the wall (1.8 to 5.9 m); the front, where the gates and
  their paths are, left open but for three low beams (116 solids). Two drops crack the agate either side of the middle
  (the backdrop draws the agate's bands down their sides and a druse's violet light far below). Plane: 17.4 m, 6 walls,
  platforms 1.1, 1.9, 3.0, 3.0, 3.1, 3.6, 4.4, 5.8, 5.8, 7.4. 6 spawns. Rim: the selenite's honey.
- **Redwoods** (`redwoods/arena.ts`): a space 22 m across inside the fairy ring (its nine trunks the space's walls). The
  fallen giant and the anchor tree's two boughs, plus with the stage's own bark (`trunks.wgsl vs_stage`, a buffer of
  their own): six low boughs grown in from the ring's trees, each with a level run whose top is the bough's (1.5 to
  4.0 m; the ones in front of the lock's camera low), a high bough along the plane over the log (4.7 m), one more from
  the anchor tree (3.7 m), four stumps cut flat (1.2 to 2.2 m) and a second log fallen behind (46 solids). Two drops in
  the meadow on the plane, one at the giant's broken end (the backdrop draws earth walls laced with roots; the grass,
  ferns and flowers keep off them). The lanterns over the space hang as high on their limbs as they go while the arena
  is shown. Plane: 16.8 m, 6 walls, platforms 1.1, 1.5, 1.9, 3.1, 3.7, 4.7. 7 spawns. Rim: the lanterns' warm light.
- **Pool** (`pool/arena.ts`, `pool/stones.wgsl`, the one new shader): a space 24 m across; in the duel the water is
  deep (KO under −1.4 m; `groundAt` is −3 off the stones). 53 pieces of dark wet stone and pale ice, each a rounded box:
  stepping stones and floes a stride apart (tops 0.18 to 0.35), blocks a jump high (0.8 to 2.0), seven standing stones
  (3.2 to 4.8) with a block beside each, and along the plane a big flat stone at each end with a standing stone on it
  (3.7), a floe either side of the middle and an arch on the middle stone (pillars, a lintel at 3.55, a capstone to
  5.4). Plane: 18 m, 14 walls, platforms 3.55 (the lintel), 3.7, 3.7, 5.4 over floors at 0.2 to 0.3 with four gaps of
  water. 7 spawns. Rim: the moon's cold light.

### Readable: the rim light

`src/duel/arena-layer.ts` + `arena-lines.wgsl`, a scene layer (`sceneLayers`) in the main view's glow pass, built from
the arena's data and the world's solids: a soft ribbon in the world's colour round the edge of every top a body can
stand on in the space (an edge shared with the next top at the same height, a hex column's beside the next, is left
out), round the drops' rims, and, as the lock comes in (`rig.locked`), along the plane's ledges and up its walls.
Depth-tested and additive, so what lies inside the matter is hidden and what shows is a line of light along the edge a
body uses; it breathes a little on the beat (`arena.breath`). One draw, a few hundred instances. Params `arena.rim`
(strength), `arena.breath`.

### The debug view

`?arena=<world>&arenaDebug` (or `bend.set('arena', { debug: true })`, or `\` in the arena view): in 3D the tops a body
can stand on (yellow), the spawns (magenta crosses and a body's height), the drops (orange), the space's circle at the
floor (white) and at the kill floor (red); as the lock comes in, the plane's ledges (green one-way, yellow solid, with
the solid ones' undersides), walls (cyan, a tick toward the side they face), its spawns, its ends and its kill floor.
Drawn over everything.

### The arena view

`?arena=<world>` (`src/duel/arena-view.ts`, one line in `main.ts`): nobody on the stage, the arena shown, the camera
locked to its plane framing it from `camera.low` to `yTop` at up to `camera.maxDist` (standing in for the world's room);
`&free` leaves the camera free. `window.arena`: `show(id | null)`, `lock(on)`, `debug(on)`, `geometry(on)` (the pieces
and drops on or off with the camera kept, for timings), `ids()`; keys `[` `]` the other arenas, `\` the debug lines.

## Weak points

- **Free 3D among this many pieces, the camera's boom.** The rig's free and follow camera sweeps its boom against
  `World.solids` and, past `clearHard`, cuts it to what is clear. In a dense arena with the look point at body height
  the boom often meets a piece and comes in to almost nothing (my free stills turned `clearSoft`, `clearHard` and the
  portals' clearance off to get an overview). The duel's camera should lean on the near fade (which dissolves what is
  in the way) more than on pulling in, or keep its look point above the pieces. Not mine to change; not measured with
  players in it.
- **Climbable gaps.** The movement kit asks for faces about 3.5 m apart for a shaft. The temple's shaft between a tall
  column and the broken pillar is 2.24 m (the pillar is the jogo's and stands where it stands), the forge's between a
  middle stone and the plane's end 0.86 m (only the lock has that end). Others are wider and irregular (pieces round a
  space, not shafts). Not tuned against a body climbing.
- **Low ceilings that remain.** I raised what I added so nothing of mine is less than 2 m over a top a body jumps from
  (the temple's high lintel, the geode's shelves, the forge's high stones). The jogo's own remain: the temple's lintel
  1.5 m over the altar's end, the geode's high blade 2.6 m over the floor, the redwoods' high bough. In free 3D a
  solid's underside stops the head.
- **The rim light** is drawn at the plane's depth for the lock's ledges and walls and round the tops in 3D. On a bobbing
  slab (the forge's floats and crown) its line sits at the slab's rest height, up to 28 cm off. Boxes standing in for
  something round (a stump as a box when it is squatter than it is wide, `drumSolid`) give a square rim on a round top.
- **The temple's drops are flooded** (the tide covers the court up to 0.45 m), so they read as dark water with a rim of
  light rather than as holes; at low tide they are holes. The geode's and the redwoods' read as holes.
- **Solids are stand-ins**: the forge's columns are boxes (the movement stands on and slides against those, a few
  centimetres off the hexagons), the Pool's rounded boxes are boxes, the crystals' points capsules.
- **The Pool's deep water** has nothing under it that looks deep: a body that falls in sinks into the black mirror and
  the air pass tints it as under water, but there is no splash or anything that says "deep" until the duel adds one.
- **The free stills** are overviews, not a player's view; nobody plays in any of them.

## Not done

- A body moving in any arena (the movement kit is merged; `?play&duel&world=<w>` now shows the world's arena under
  the players, but I did not capture a take of anyone climbing it).
- Hazards per arena (phase 3: the forge's lava, the temple's tide, falling things in the redwoods).
- The duel's own use of `space` (the soft wall at its edge) and of `spawns`: the duel agent's.
- A phone: the pieces and the rim scale with nothing (`coarse` lowers the temple's duel drums to 32 sides; the rest is
  the same on any device). Not measured there.

## What the integrator must know

- **The switch**: `showArena(worldId | null)` in `src/duel/arena.ts`. The duel turns it on for its world and off when it
  leaves; `?play&duel` (main.ts) turns it on for the main view's world each frame until the duel does it itself.
  While on, the world's `World.solids` includes `arena.pieces` (a getter now in the five worlds: the movement, the
  camera and the near fade read it each frame), its `groundAt` falls away in its drops (the Pool: everywhere off the
  stones), its backdrop opens them, and the rim light shows.
- **`src/portals/solids.ts`** (outside my area, two lines): `solidsOf` caches the camera's `Solids` per list, not per
  world, so a world whose list changes when the arena is shown gets a fresh one.
- **`main.ts`**: `installArenaLayer(...)` before the views' scenes are declared (the rim light and the debug lines, a
  scene layer), and `?arena=<world>` (not with `?play`) / `?play&duel` (the arena under the players). The merge of the
  HUD's `installHud` line and mine is in my merge commit.
- **The worlds' light uniform** grew: `Temple`, `Geode` and `Forest` each gain `drops: array<vec4f, 2>, dropFrame:
  vec4f` (WorldLight about 3.9 → 4.0 KiB). Every `.d.wgsl.ts` that includes `worlds/light.wgsl` changed with it
  (regenerated by weft's plugin); a branch that touches light.wgsl will conflict on those generated files only:
  regenerate them (`vite build`).
- **New shaders**: `src/duel/arena-lines.wgsl` (frame + one storage buffer + one uniform), `src/worlds/pool/stones.wgsl`
  (a world draw like the others), `src/worlds/drops.wgsl` (included by three backdrops; no bindings).
- **The `Arena` contract**: as duel.md's (`world`, `space`, `spawns`, `pieces`, `plane`, `camera`), with optional extras
  `camera.low`, `drops`, `rim`, `outlines`. `camera.maxDist` is meant to stand in for the world's `room` while the duel
  is on (the geode's 7.4 m and the redwoods' 9.6 m rooms can't frame a plane this wide; the arena view does this by
  defining `room` on the world while it is shown). The `Wall` type and `StagePlane.walls` are master's (the movement
  kit's), the same shape as mine.
- **For the movement and the brains**: `topAt`, `groundUnder`, `crossing`, `slicePlane`, `inDrop`, `drumSolid`,
  `checkArena` in `src/duel/arena.ts`. The movement kit's own `solidTop` reads a box's y axis as up: the geode's
  upright beams are therefore given as boxes with y up (not as the blade's own frame).

Proposed lines for AGENTS.md (I did not edit it):

- Debug flags: `?arena=<world>` (a duel arena alone, locked to its plane; `&free`, `&arenaDebug`; `window.arena`:
  `show`, `lock`, `debug`, `geometry`), `?play&duel` (the world's arena under the players).
- The map: `duel/ the duel: arena.ts (the Arena contract, the registry, showArena, the solids' tops and planes),
  arena-layer.ts + arena-lines.wgsl (the rim light and the debug lines), arena-view.ts (?arena)`; each world's
  `arena.ts` builds its arena.
- The contracts: `Arena` (docs/design/duel.md) registered from each world's index.ts; `showArena(id)` makes the world
  draw its pieces, list them in `World.solids` (a getter) and open its drops (`Temple`/`Geode`/`Forest` `drops`).
