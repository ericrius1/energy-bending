# Duel phase 1 ("Move"): the arenas

Branch `worktree-agent-a516f31550f951f5d`, from master `df03f4a`, with the owner's corrected design (`b91e987`,
docs/design/duel.md: the duel is 3D native, the 2D lock an option anywhere) merged in mid-way. One of four agents on
phase 1; mine is the arenas. The movement, the duel's rules and virtual players, and the HUD are the others'.

**Measured:** `npm run typecheck`; the full `npm test` (limits, the binding budget: 153 entry points, the new shaders
within the baseline; 11 TS test files including the new `src/duel/arena.test.ts`; audio; 10,037 gate checks; the net
tests); `?baseline` on every world with its arena shown; stills of every arena on the RTX 5090 at 1920×1080 (headless
Chrome, a production build served by `vite preview` on 127.0.0.1:5506, under the shared render lock), locked and free,
with and without the debug lines, all looked at; GPU timings per world with the arena's matter on and off.
**Not measured:** a body moving in any of it (the duel's movement is another agent's, and free 3D can't stand on a
solid's top yet: see "What the integrator must know"), a person playing, a phone.

TIMINGS_AND_RESULTS

## What an arena is now

`src/duel/arena.ts`, the contract in docs/design/duel.md, filled per world by `src/worlds/<world>/arena.ts` and
registered from each world's `index.ts` (`arenas.register`, `arenaFor(worldId)`):

- `space` `{ center, radius, yKill, yTop }`: the 3D play space, 10 to 12 m round; below `yKill` is a KO.
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

ARENA_LINES

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

WEAK

## Not done

NOTDONE

## What the integrator must know

INTEGRATOR
