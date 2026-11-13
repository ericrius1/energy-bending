# Wave 6: cameras that never enter the world

Branch `worktree-agent-aa9cfcc1d2e90189c` (task 4 of `docs/reports/6-critique.md`). Owned: `src/engine/camera.ts`,
`src/engine/shots.ts`, `src/portals/` (new: `solids.ts`), `scripts/check-portals.mjs`, the step file
`scripts/steps/cameras7-gen.mjs` (writes `cameras7.json`), `docs/extending/camera.md` (new), `docs/extending/portal.md`,
this report. One line outside: `src/dancer/play.ts` (below).

Measured: `npm run typecheck`, a Vite build (`npx vite build` into a scratch folder: `npm run build`'s prebuild
re-fetches weft into the shared `node_modules`, which other agents use, so I left it alone), `npm test` clean (exit 0;
check-portals now 10,039 checks, nine of them new camera checks, below). One earlier `npm test` failed the real-time
net smoothness test (`B: tracks the source`, rms 0.057) with the CPU 83 % busy from other agents' renders; the rerun
passed. Captures: `scripts/critic-cap.mjs` on the RTX 5090 through headless Chrome against my dev server on
`[::1]:5458` (5454 was taken from under me by another agent's server bound to `[::1]:5454`; see "Weak points"), one
take per lock hold, each 4 to 14 s of rendering. I looked at every sheet named here. Not measured: a person playing,
a gamepad, a phone, timings (the camera is CPU work: a few hundred bounding-sphere tests and a handful of exact sweeps
a frame; not profiled).

## The verdict

The free camera no longer goes inside the world. The critic's five 8 m orbits re-shot show no frame inside a blade,
a shelf, a column, the altar, a trunk, the log, a bough or a slab (`7-w-*-sheet.jpg` against `6-w-*-sheet.jpg`). The
boom comes in for what is in the way before it gets there, tilts up over something low (the redwoods' log, the
temple's altar and lintel), and the eye stays above the ground and the water. In the temple's partner take the column
no longer stands across the dancers (`7-partner-temple-sheet.jpg` row 3 against `6-partner-temple-sheet.jpg` row 3).
A scripted player holding the stick one way walks a dead straight line through each hub gate and back (at most 5 mm
off the line over every run), with the follow camera behind them on both sides. Camera paths exist: keyframes in the
rig's own terms, in a world, dancer, pair or stage space, blended in and out of whatever the rig is doing.

## 1. The camera never shows the inside of a solid

**What was wrong.** The rig avoided only gates' discs and (through `World.clear`) the redwoods' trunks. Every other
solid thing was invisible to it.

**What changed.**
- `Solid` (camera.ts): a capsule (segment and radius) or a box (middle, three unit axes, half extents), `boxOn(foot,
  size, yaw, pitch)`, and `Solids`, a list with a bounding sphere each. `Solids.sweep(a, b, r)` moves a sphere along
  a → b and says how far it gets (exact against capsules; against boxes, a slab test then stepping by the true distance,
  so a box's edges and corners are round, not square). A start that is already near a solid (a dancer standing on a
  slab of columns, against a column) shrinks the sphere to start clear of all of them, so only moving into one counts.
- The free boom (`settleEye`, for the orbit, follow and the director's idle shots): swept at `clearSoft` 0.5 m where
  it is and where it will be along its turn (0.12 to 0.8 s ahead); it must be in to what is clear there by the time
  it gets there, and comes in no faster than 5 m/s, so it starts early and is a dolly, not a jump; out again at 1.6/s.
  A hard stop at `clearHard` 0.22 m if the ease is ever behind; and if the eye is still inside something (the look
  point itself inside one: a dancer falling through a slab), it goes to the first clear point on its boom.
- `liftOver`: before coming in, the boom tries tilting up (to 0.6 rad) or down (0.24 rad, never into the ground nor
  down past the edge of the slab what it looks at stands on) and takes the tilt that leaves it longest, each step
  having to win half a metre; eased there (2.5/s) and back (0.8/s). It counts the gates' discs too.
- Above the ground and the water: every free camera (it was the follow camera only), 25 cm above `groundAt` and
  `World.waterY`.
- A camera following its player through a gate: while its eye is still behind the disc it came after them through,
  the disc rules (the old behaviour); once the eye is on the player's side (or was turned there) the solids do again.
- `src/portals/solids.ts`: each frame the portals give the rig its world's solids (`rig.solids`) and water
  (`rig.waterY`). A world that has an optional `solids()` is taken at its word; until then they are read from what
  the worlds already lay out, read only: the temple's stones (blocks as boxes, drums standing or lying as capsules,
  squat ones as boxes, the platform left out), the geode's blades (boxes, as shelves.wgsl builds them) and crystal
  points longer than 45 cm (capsules), the redwoods' trunks (three capsules each for the flare), limbs (four sagging
  capsules each), lanterns (spheres where they hang) and stage pieces (the log, plate, roots and boughs: capsules
  already), the forge's stage columns (a box each, as high as its slab bobs). The Pool has nothing.

**The near fade** (a fallback I could not build: it is in the worlds' and the post chain's shaders). The rig publishes
`rig.sight = { eye, at, near: 0.6, blocking }` every frame; see "Asks" below.

## 2. The lock never has a solid between the camera and the dancers

`dodgeFor` (camera.ts): the locked eye's sight lines to the two seats (hips, knees, chest, head: 10 lines) are swept
against the solids. When any is crossed, at most twice a second it scores turns within `camera.lockDodge` (0.4 rad)
of the stage's own angle (lines crossed, the eye inside a solid, the size of the turn) and eases (2.2/s) to the best;
when the stage's angle is clear again it eases back. `rig.dodge` is the turn now; `rig.sight.blocking` lists what
still crosses after that, for a fade. In the temple partner take the lock turned 0.05 to 0.1 rad at times and no
sampled frame had a solid across the sight lines (`lock` lines in the capture: `blocking: 0` at 8, 16, 23, 29 s).

## 3. Gate crossings by a played dancer are stageable

**Why the critic's staging failed.** Two reasons. `moveY` is up (a jump; below -0.5 a crouch), not a walk: walking is
`moveX`/`moveZ` (`+moveZ` into the screen). And even with `moveZ`, a free stick was read in the camera's live yaw
(`inputYaw = rig.yaw` every frame, `src/dancer/play.ts`), so the follow camera swinging behind a runner, lining up
with a gate or drifting steered the player: in the new check, a stick held into the screen with the camera starting
0.9 rad off to the side curves the walk 3.55 m off its line over 5 s.

**The fix.** `CameraRig.stickYaw(p, moveX, moveZ)`: the turn a player's stick is read in is the camera's yaw when the
push began, kept while the stick is held (any direction past 0.2); the player's own look input (`lookBy`) and a
gate's carry turn it with the camera; let go, and it is the camera's again. The one line outside my folders,
`src/dancer/play.ts`: `c.inputYaw = rig.stickYaw(i, c.intent.moveX, c.intent.moveZ)` instead of `rig.yaw`. The check
walks the same stick straight (0.000 m off) with the camera ending behind (cos 1.00). For scripts:
`bend.intent(0, { moveZ: 1, walk: true })`.

**In the game** (`gate-*` takes: placed 4 m in front of each hub gate facing it, the stick held, then stop, the camera
turned to look back from beyond the player, the stick held again). From the capture's own measurement of every run
(each world and each way): the most any run strays from the straight line between its ends is 0 to 5 mm, and the
camera is straight behind the player at the end of every run (cos 1.00):

| gate | in (hub, then far world) | back (far world, then hub) | nearest eye to player |
|---|---|---|---|
| redwoods | 1 mm, 0 mm | 1 mm, 1 mm | 1.02 m (just after the eye came through) |
| pool | 0, 1 mm | 1 mm, 1 mm | 2.06 m |
| temple | 1 mm, 0 | 0, 1 mm | 2.02 m |
| forge | 1 mm (the forge leg, 0.9 m, too short to log) | 36 mm over 9.6 m (the forge leg and the hub as one run) | 2.18 m |

The forge: 1.75 to 2.75 m in from its gate along the gate's normal there is no floor (the anvil's lobe and the anvil
don't meet there; read from `layoutForge`), so a player who walks on from the forge's gate falls into the pit and
re-forms (an earlier take did, and the eye then went inside a column as the look point fell through the anvil: the
"inside" fallback in item 1 is for that). The forge take therefore stops 0.9 m past the disc
(`7-gate-forge-sheet.jpg`: in, look back, out through the same disc, behind the player in the hub).

## 4. A camera path API (for the film agent)

`bend.rig.play(path)`, `bend.rig.release(seconds?)`, `bend.rig.path` (`{ t, w, done, path }`), and `samplePath(path,
t)` in shots.ts. The full reference is `docs/extending/camera.md`.

```ts
interface CameraPath {
  keys: PathKey[];      // { t, eye? | orbit?: [yaw, pitch, dist], at?, fov?, roll?, focus?, stop? }
  space?: 'world' | { dancer: number; turn?: boolean } | { pair: true } | { stage: true | StagePlane };
  blendIn?: number; blendOut?: number;   // s (default 1; 0 cuts)
  avoid?: boolean;                        // keep the eye out of solids, above ground and water
  end?: 'hold' | 'release' | 'loop';      // default hold
  lag?: number;                           // s the space lags what it follows (default 0.25)
}
```

Every channel runs on a cubic through the keys (Catmull-Rom tangents over the keys' own times; a `stop` key, and the
first and last, are arrived at and left at rest); all-orbit paths interpolate the orbit (they circle), others the
eye's position. Spaces are resolved every frame (a dancer's is the ground under their hips, so a jump doesn't lift
the shot); a world-space path is carried with the rig through a gate. The rig's own pose (free, follow, locked) goes
on underneath, so blending in and out of follow or lock is a weighted ease between the two; lens, roll and focus
(`rig.focus`) blend with it. Example:

```js
bend.rig.play({
  space: { pair: true }, avoid: true, blendIn: 1.5, end: 'release', blendOut: 2,
  keys: [
    { t: 0, orbit: [0.3, 0.12, 6.5], at: [0, 1.1, 0], fov: 38 },
    { t: 4, orbit: [1.4, 0.25, 4.2], at: [0, 1.2, 0] },
    { t: 8, orbit: [2.6, 0.4, 3.6], at: [0, 1.3, 0], fov: 32, roll: 0.04, focus: 3.4 },
  ],
});
```

Checked (check-portals): at its second key the eye is where the key says (within 2 cm); held at the last key (lens
30.0, focus 5.50 exactly); released, the rig is its own again; blended in, along and out with no step over 0.21 m a
frame (the blend from a follow camera 8 m away over 1 s); a stop key is passed at rest. Not yet driven in a capture:
the film agent's shots will be the first.

## 5. Kept from before

Carried with the player through gates in the same frame, drawn from where the eye is until it comes through (the
check-portals gate walk: 1.65 s, its line through the disc on every frame, largest drawn step 0.131 m, never nearer
the player than 2.99 m after); the slot choice and the stills (unchanged, seen live in every gate take); the locked
framing (both dancers whole through a leap and a cartwheel: 0.86 of the frame, smallest 0.21 of its height).

## The checks (scripts/check-portals.mjs, new)

- the critic's orbit (8 m, 0.52 rad/s, 12 s) through a court of columns, a log, a tipped shelf and a lantern over water:
  never inside a solid (nearest surface 0.22 m), largest step 0.134 m a frame, 25 cm over the water;
- standing on a slab: a boom rising away is clear (1.00), one down through it is not (0.10);
- the lock past a column on the line to the dancers (10 of 10 sight lines crossed → 0 after 3 s, a turn of 0.30 rad,
  within `lockDodge`), and back to the stage's angle (0.000) when it is gone;
- the straight walk with the steady stick (0.000 m off vs 3.55 m read in the live yaw) and the camera behind;
- the path (above).

## Before and after (docs/reports/media)

| critic (before) | after | what to look at |
|---|---|---|
| `6-w-geode-sheet.jpg` | `7-w-geode-sheet.jpg` (+ `7-w-geode-0/3/6/9.jpg`) | no frame inside blades or shelves (before: a third of the orbit) |
| `6-w-temple-sheet.jpg` | `7-w-temple-sheet.jpg` | row 2 rises over the altar and lintel instead of driving through columns |
| `6-w-redwoods-sheet.jpg` | `7-w-redwoods-sheet.jpg` | row 3 tilts up over the log; no frame inside log or bough |
| `6-w-forge-sheet.jpg` | `7-w-forge-sheet.jpg` | unchanged in look (it was clear), the dancers on the crown never pin the boom |
| `6-w-pool-sheet.jpg` | `7-w-pool-sheet.jpg` | unchanged (nothing solid) |
| `6-partner-temple-sheet.jpg` | `7-partner-temple-sheet.jpg` | row 3: no column across the dancers |
| (`film1-gate`: no walk) | `7-gate-redwoods/pool/temple/forge-sheet.jpg` | straight in and back, camera behind both sides |

The videos are in `docs/reports/media/7-film/` (git-ignored).

## The critique's "Done when", item by item

- **The five `6-w-*` orbits re-shot never show the inside of a solid: met** for the solids the camera knows (every
  frame of the five `7-w-*` sheets looked at). Not inside, but close: in the geode and the redwoods one frame each
  (row 1, frame 7) has the camera about 1.5 to 2 m from the nearer dancer, where the boom came in along the stage
  plane between a gate's disc and the shelves (geode) or under the low bough (redwoods): a big body, no solid.
- **`6-partner-temple` re-shot has no column across the dancers: met** (`7-partner-temple-sheet.jpg`; the lock's own
  log: nothing across the sight lines at the four sampled times). A column stands beside the pair in row 2, the fire
  dancer's arm passing behind its edge in one frame (only hips, knees, chest and head are sight-checked).
- **A camera path API the film agent can call: met** (built and checked in Node; not yet driven in a capture).

## Asks (for whoever merges; the worlds agents for the temple, the redwoods and the geode are working now)

1. **`World.solids(): Solid[]`** (optional; `Solid` and `boxOn` in `src/engine/camera.ts`; `WithSolids` in
   `src/portals/solids.ts`). Static, in the world's own coordinates; columns, trunks, boughs and crystal points as
   capsules `{ kind: 'capsule', a, b, r }`; blocks, slabs and blades as boxes `{ kind: 'box', c, x, y, z, h }` or
   `boxOn(foot, [w, h, d], yaw, pitch)`; nothing under about 30 cm; a moving thing as where it can be; a few
   centimetres fat rather than thin. Per world, what I read today and would like said by the world: **temple** every
   stone but the platform (as solids.ts does), so a change to the layout's fields can't silently drop them;
   **redwoods** the trunks (with their flare), the limbs (with their droop), the lanterns (where they can swing to),
   the stage's pieces; **geode** the blades and the bigger crystal points, and the gem dome's inner surface if it can
   be had as a few boxes (the room circle stands in for it now); **forge** its stage columns (and islands if a camera
   is ever meant to go out there). If a world's fields change name, `solidsOf` warns once in the console and that
   world's camera avoids only gates.
2. **The near fade** (worlds' opaque draws, or once in the post chain's merge, by depth): dither away a fragment
   within `rig.sight.near` (0.6 m) of the eye, and one inside the capsule from the eye to `rig.sight.at` (radius about
   0.8 m) that is nearer the eye than `at`. Two `vec4f` in the shared world light uniform (eye + near, at + radius)
   would carry it. With it, the camera could stay further out instead of coming in, and the lock would not need to
   turn.
3. **The forge's floor along its gate's way in**: 1.75 to 2.75 m from the gate along its normal there is no column
   (the lobe and the anvil don't meet), so a player walking in from the gate falls into the pit.
4. **Ports**: AGENTS.md says to pick a free port; another agent's server started on `[::1]:5454` while mine served
   `0.0.0.0:5454`, and requests to `[::1]` went to theirs (their page then hung: my takes waited 3 minutes for "ready"
   holding the render lock). Start dev servers with `--host ::1 --strictPort` (or `127.0.0.1`), so a taken port fails
   loudly.

## Weak points

- The boom still comes in a long way in tight places (the temple's court behind the stage, the geode near a gate):
  correct (outside every solid) but a big dolly; the near fade (ask 2) is the better answer there.
- The proxies are my reading of the worlds' layouts, not the worlds' word: a world agent changing a layout's fields
  breaks them (with one console warning), and anything not listed (the geode's gem dome, small crowns of crystals
  round the gates, ferns, steps under water) is not avoided.
- Just after the eye comes through a gate behind its player it can be close (1.02 m in the redwoods take, for about
  half a second): the pass-through's own boom, from before this work.
- The sweep shrinks for a start near a solid, so a dancer pressed against a column makes the whole sweep thin that
  frame (the hard stop and the inside test still hold).
- The lock checks hips, knees, chest and head; a hand or a foot behind a column edge is not seen as blocked.
- `npm run build` itself was not run (its prebuild touches the shared weft checkout); `vite build` was.
- The last commit (the eye moved out of a solid when the look point is inside one) came after the w-geode, redwoods,
  temple, pool, partner and the redwoods, pool and temple gate takes; those were not re-shot after it (it changes
  only frames where the eye would otherwise be inside a solid). The forge orbit and gate take were re-shot after it.
- Not measured: CPU cost of the camera per frame, a gamepad, a person, a phone.

## Every edit outside my folders

- `src/dancer/play.ts` line 212: `c.inputYaw = rig.stickYaw(i, c.intent.moveX, c.intent.moveZ)` (was `rig.yaw`).

Branch: `worktree-agent-aa9cfcc1d2e90189c`.
