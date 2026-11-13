# Wave 7: the locked camera, the temple and the forge, the stage dim

Branch `worktree-agent-a13a8c7ae2a1674e7`, items 7, 11 and 12 of 8-integration.md's "What is left", and the geode and
forge orbits Report 8 did not re-shoot. Master (684ae8e: the near fade, the gates' depth of field, the fusion's hold)
was merged in before the final captures; every sheet named below was shot on the merged build unless it says otherwise.

**Measured:** `npm run typecheck` and `npm test` after the merge (exit 0: limits, bindings, 9 TS test files, audio,
10,037 gate checks, the net tests; before the merge the net's real-time smoothness test failed once under the shared
machine's load, rms 0.079, and passed alone). Captures on the RTX 5090 through headless Chrome against this worktree's
dev server on `[::1]:5461`, one take at a time under the shared render lock (`scripts/critic-cap.mjs` with
`scripts/steps/stage-9.json`, written by `stage-9-gen.mjs`; the dim sheets by `scripts/steps/stage-9-dim.mjs`). Each
take logs what it measures into the capture's problem list (the lock's widest lens, nearest eye, largest turn; the
walk's lowest feet and nearest disc; the orbit's frames inside a solid). Diagnostic runs that log every 0.2 s (not
committed: `shots/diag/`) found the causes below. I looked at every sheet and still cited. **Not measured:** a person
playing, a gamepad, a phone, timings (all the changes are CPU-side and a handful of tests a frame), sound.

## 1. The temple's lock

### The dark, low swing: the lock's clearance measured from among the stage's own ledges

`CameraRig.lockPose` stood the eye as far back as the framing wants, but no further than `clearance(c, far)` allowed,
**measured from the look point `c`**, which is on the stage plane among the stage's own solids (the altar, the broken
pillars, the lintel's columns). With the pair beside the altar's end, a dodge turn of +0.3 rad put the altar's 40 cm
margin across that segment at its very start: clear 0, so the eye stood at the 2 m floor and the lens widened to 90°
(a reading of the temple's real solids for a pair at x = -2: every turn 9.1 to 10 m at 19° except +0.3 and +0.4: 2.0 m
at 90°). The dodge's score counted only sight lines, so it could choose that turn, and the eye's distance and lens eased
at 6/s: one or two frames of a wide, low, dark shot at 5 fps. That is the integration's row 3.

Changed in `src/engine/camera.ts` (the lock only):
- the clearance is measured from 1.6 m in front of the stage along the boom (`LOCK_STAGE_DEPTH`): the stage's own ledges
  never pull the lock in; something further out still does;
- the dodge's score adds 3 × how much shorter than the framing wants a turn would have to stand, so a turn that needs a
  wider lens loses to a crossed sight line;
- bounded speeds: the lock's distance comes in no faster than 5 m/s (the free boom's own limit), its lens widens no
  faster than 30°/s, its dodge turns no faster than 0.35 rad/s (the plain ease moved the eye 4 to 6 m sideways in half a
  second).

A check in `scripts/check-portals.mjs`: a pair walking the whole court (x -5.2 to 5.2) for 25 s against the temple's own
solids. On the old code: widest lens 45.4°, nearest eye 5.2 m, in at 37.6 m/s, turning at 0.41 rad/s (all four fail).
Now: 19.0° (the stage's 19), 8.4 m, 0.30 m/s, 0.350 rad/s.

In the 30 s take (`9-stage-partner-temple-lock-sheet.jpg`, the integration's script exactly, the lock logged every
frame): nearest eye 9.08 m, largest turn 0.10 rad, 7 of 149 frames with a solid still across a sight line (hips, knees,
chest or head) after the turn, no frame wide, low or dark. The log's widest lens (31.3°) and lowest eye (0.63 m) are
frame 0, where the take's own log runs before the lock has eased in from the free camera (a separate run logging every
0.2 s: 25° at 0 s, 20° at 0.2 s, 19° from 0.4 s on).

### The stubs and the drift: the seats started on the pillars, and the pillars stood in the pair's floor

- **The seat-0 dancer on the stub:** nothing in the script or the ledges made it jump. The temple's stage **spawned
  both seats on the broken pillars' tops** (`spawns: [[-4.2, 1.9], [4.3, 1.9]]`), the only world that did. A scripted
  dancer who only dances stays there; the partner came down and across to it. Now the seats start on the flagstones just
  off the altar's ends, `[-2.0, 0]` and `[2.05, 0]`.
- **The drift left:** measured in the logged roots: seat 0 (scripted, never moving on purpose) stays where it starts
  and the partner circles to the far side of it, about 1.5 m beyond. From the stub at -4.2 that put the pair at -5.5 to
  -3; the frame's middle averaged -2.65 m. With the seats at ±2.85 (my first try, `shots/stage9/partner-temple-lock-run1`)
  the partner still went to -4.35 next to the pillar. From -2.0: seat 0 between -2.8 and -1.3, the partner between -3.5
  and +2.1, the frame's middle about -1.8. The pair is still left of the court's middle in this take because the scripted
  dancer starts there and never walks; the stage itself no longer pulls them there. (The altar is the court's middle, so
  a still pair can't stand centred without one on it.)
- **The stubs large in the foreground:** they are the stage's own two broken pillars, at the dancers' depth (half of
  each stands in front of the plane), lit by the fire beside them. The pillars moved out to the stage's ends, x -5.0 and
  5.05 (from -4.2 and 4.3): 3.3 m of open floor between each and the altar (`temple/layout.ts`; ledges, tops, shadows and
  solids follow from the one description). In the take they stand at the frame's edge, a sixth of its width, when the
  partner circles to the far side (`9-stage-partner-temple-lock-24.jpg`), and are out of frame otherwise. The near fade
  (merged) leaves them, rightly: they are beside the pair, not across it.

Before: `8-partner-temple-lock-sheet.jpg`. After: `9-stage-partner-temple-lock-sheet.jpg` and `-8`, `-16`, `-24.jpg`.

## 2. The stage dim per world

`9-stage-dim-sheet.jpg`: each world's jogo against the partner, locked, at 9 s, the play frozen and the same frame shot
at `stageDim` 0, 0.35, 0.55 and 0.75 (rows: geode, redwoods, Pool, temple, forge). `9-stage-dim-chosen-sheet.jpg`: 0,
the old default 0.55, and each world's choice. The dim is subtle at any value (it darkens only what is several metres
beyond the stage, by at most 45 % × the value, and softens it): it is a separation, not a look.

| world | was | now | why |
|---|---|---|---|
| geode | 0.55 | 0.65 | the gem dome's stars and bokeh are busy right behind the pair; a little more quiets them, the blades and shelves at the stage's depth untouched |
| redwoods | 0.55 | 0.75 | the bright fog is what the water dancer's pale head and shoulders fade into (8-integration's open item 4); darkening it is the one change here that helps that contrast. The trunks behind go a little darker, still warm |
| Pool | 0.55 | 0.3 | the backdrop is already near black; what there is, the moon and its path on the water, is the point. At 0.55 the horizon band and the glitter lose most of what they have |
| temple | 0.35 | 0.5 | the moonlit cloud round the moon is the brightest thing behind a water dancer; at 0.5 it sits back. The moon stays white even at 0.75 (it is far past white), so the temple agent's reason for 0.35 holds at 0.5 |
| forge | 0.55 | 0.3 | the frame is mostly dark; the red-lit rock hanging behind the stage is all that gives it depth |

The values live in each world's `stageDim` (one field and its comment each in `geode.ts`, `redwoods.ts`, `pool.ts`,
`forge.ts`, `temple.ts`). `bend.post` (one word in main.ts) lets a take set the post chain's eased value so a row is
one frame.

## 3. The forge: through its gate, on over the lobe, and back

The take (`9-stage-gate-forge-sheet.jpg`, stills `-3`, `-6p6`, `-9`, `-11`, `-14.jpg`): a played fire dancer placed 4 m
before the hub's forge gate walks in with the steady stick, on **4.5 m past the disc** over the lobe toward the anvil,
stops, the camera turns to look back from beyond them, and they walk back through to the hub. Feet never below the
floor (lowest 0.00), the camera behind the player on both sides, the eye within 0.35 m of a disc only for the two
frames it passes through it. Three faults found on the way, all fixed:

1. **The flash on the way back was the player falling through the hub.** Each played dancer's ground was the *main
   view's* world (`dancer/play.ts`: `ctx.world().groundAt`), and the main view changes world only when the camera's eye
   has come through the gate, about a second after its player. Walking back, the player stood in the hub for that second
   on the **forge's** floor read at hub coordinates: no column there, so they fell (the log: feet -0.8, -2.6 m, then
   re-formed at the spawn), the camera behind them pressed down on the disc's rim as the look point sank: the ring large
   in frame, the flash, the integration's row 3. Every other world's floor is flat there, which is why only the forge
   showed it. Now `PlayCtx.worldOf(dancer)` (main.ts passes the portals' `worldOf`): each dancer walks on its own
   world's ground and falls out at its own world's `fallY`.
2. **Holes in the forge's floor.** `Forge.groundAt` counted a point as on a column within 0.9 of its corner radius: a
   circle inside each hexagon, so the corners between cells were holes (10 points on the gate's line, every 2 cm, read
   as holes). It is now the hexagon itself (`forge/layout.ts floorAt`, flat sides ±x as the cells are laid), with a
   centimetre of margin. A test walks the way in and a body's width either side of it, every 2 cm: floor at all 693
   points (`floor.test.ts`).
3. **The way in ran under the left float's hanging edge.** The gate faced 0.17 rad left of the stage's middle; its
   straight way in passed 0.9 m from the left float's lowest column (0.63 m off the floor), and the follow camera behind
   the walker, and in front of them on the way back, came in to its 0.9 m floor for it (a whole frame of flame). The gate
   now faces the stage's middle exactly (`normal [0.852, 0, 0.523]`, same place); the way in is clear of every column
   at the camera's 0.5 m sweep, and the lobe's floor covers it (both floor tests run on the new line).

Weak point left: when the camera turns to look back (6.8 s) from beyond the player toward the crown, the crown's lowest
cells hold the boom at about 1.6 m for half a second as the player starts back, so two frames are a big body
(`-sheet` row 4, frames 9 and 10). The rig is right not to stand inside the crown; the near fade does not fade it
(not within 0.6 m of the eye, not in front of the framed dancer). A take that turns the camera less would not see it.

## 4. The geode and forge orbits (the critic's 8 m orbits, re-shot)

`9-stage-w-geode-sheet.jpg`, `9-stage-w-forge-sheet.jpg`, stills `-0`, `-3`, `-6`, `-9.jpg`; each frame's eye tested
against the world's solids by the take itself.

- **Geode:** 47 frames, none inside a solid, none within 0.2 m of one; shortest boom 3.1 m (row 1, frame 7: the boom
  comes in between a gate's disc and the shelves, a big water body; the cameras agent saw the same frame).
- **Forge:** 47 frames, none inside or within 0.2 m. **Before a fix here, the shortest boom was 0.9 m** for 1.5 s of
  the orbit (the camera inside the pair: a full frame of water, then of fire). Cause: the pair stand on the crown (the
  take's `place` puts them on its top, 3.1 m), and `World.clear` (`clearOf`, a 40 cm margin round every solid, added
  for the forge at the integration) ignored only the solid its start is inside; the crown's next columns, whose margin
  the look point also stood in a hand's breadth over the top, read as 0 clear for any boom not rising steeply. Now
  `clearOf` shrinks its margin for a start nearer a solid than the margin, as the camera's own sweep already did (a test
  in `temple/solids.test.ts`). Shortest boom now 8.76 m; the orbit is the clean wide circle it was meant to be.

## Files outside my area (each a line or two at a seam)

- `src/main.ts`: `bend.post` beside `gates, device, fade`; `worldOf: (d) => worldOf(gates.worldOf(d))` into playDemo's
  context (the merge's one conflict was this `Object.assign` line: both kept).
- `src/dancer/play.ts`: `PlayCtx.worldOf`, and each seat's terrain reads its dancer's world (8 lines).
- `src/worlds/solids.ts` (`clearOf`'s margin) and `geode.ts`, `redwoods.ts`, `pool.ts` (one `stageDim` field each).
- Mine: `src/engine/camera.ts` (the lock), `src/worlds/temple/` (layout, spawns, dim, tests), `src/worlds/forge/`
  (floor, gate, dim, tests), `scripts/check-portals.mjs` (the temple lock check), `docs/extending/camera.md` (the lock),
  `scripts/steps/stage-9-gen.mjs`, `stage-9.json`, `stage-9-dim.mjs`, this report, `docs/reports/media/9-stage-*.jpg`.

## For the integrator and the films agent

- **Film 2's places:** the temple's seats no longer start on the pillars (seat 0 started on the left one: the
  integration's film 2 fault "the fire dancer stands on a column stub"), and the pillars stand at x -5.0 and 5.05, not
  -4.2 and 4.3. A timeline that walks seat 0 to -1.2 now walks it from -2.0 on the floor. Nothing in `films/*.json` names
  the pillars' x; the lead shot's moon and gate are untouched.
- **The forge's gate faces 0.17 rad further right.** Anything framed on the forge's disc from a fixed yaw (none in the
  films now) would see it turned.
- **Every played dancer now stands on its own world's ground.** If something else drives a dancer through a gate
  without the portals knowing (`gates.worldOf` falls back to the main view's world), it behaves as before.

## Proposed for AGENTS.md (not edited)

- In "The contracts", after `CameraRig.framePad`: "the lock's clearance is measured from 1.6 m in front of the stage (a
  stage's own ledges never pull it in); its distance, lens and dodge are rate-bounded (5 m/s, 30°/s, 0.35 rad/s)".
- In the map's `dancer/` line: "a played dancer walks on its own world's ground (`PlayCtx.worldOf`, the portals')".
- `World.stageDim` per world: geode 0.65, redwoods 0.75, Pool 0.3, temple 0.5, forge 0.3 (9-stage.md).

## Not done

- The scripted temple take still has the pair left of the court's middle, because the scripted dancer starts left and
  never walks; a played or directed seat 0 would not. Not changed in the partner (src/ai is not mine).
- The forge's look-back frame (above). The geode's one close frame by the gate (unchanged since the cameras agent).
- The stage dim judged on one frame per world at 9 s, at 1280×800, by eye; not on a phone, not in motion.
- The temple's other stages' worth of geometry (the lintel, the altar) was left where it is: the altar in the middle is
  why a pair standing still can't be centred.
