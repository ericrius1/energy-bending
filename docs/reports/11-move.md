# 11: Move, the duel's movement kit

Phase 1 of the duel (docs/design/duel.md), the body's part: how a body moves. Built first to the brief's side view,
then, after the owner's correction (13 Nov: the duel is 3D native, the 2D lock an option anywhere, a dance whose moves
flow), carried into free 3D against the world's own solids. The jogo's feel is untouched: everything here is a physics
profile a body opts into.

## Built

**The contracts' movement side.**
- `Wall` and `StagePlane.walls?` in `src/engine/camera.ts`, exactly as duel.md has them (s, side, y0/y1 in world y,
  climb). The plane's ends count as walls (ids `_left`, `_right`).
- `Intent.dash` (an edge, in `EDGES`, so scripts and merged devices treat it like jump). Its bindings are a **scheme**
  per source, `'jogo' | 'duel'` (`IntentSource.scheme`, `InputHub.scheme` hands it to every device it seats), because
  the brief's keys are the jogo's dodge and kick:

  | device | jogo (as before) | duel |
  |---|---|---|
  | keyboard solo/left | Shift dodge, K kick, L spin | **Shift or K dash**, L kick, I spin, O dodge/block; W (still jump) also holds the stick up, for the dash's way |
  | keyboard right | right Shift dodge, . kick, / spin | **right Shift or . dash**, / kick, ; spin, ' dodge/block; Up also holds up |
  | gamepad | RT dodge, B kick, Y spin, LB/RB aú | **RT or B dash**, Y kick, LB spin (an aú with the stick pushed), RB dodge/block; merge only on both stick clicks |
  | touch | (no dash) | **a swipe of the stick's thumb** (past the rim within 0.12 s of leaving the centre) and a **dash** button shown only in the duel |

**The profile.** `Character.phys` is `PHYS` (the jogo's, unchanged) or `DUEL_PHYS` (`defineParams('duel.move')`, in
the panel), set by `new Character({ phys: 'duel' })` or `setProfile('duel')`. New kit fields default off in `PHYS`
(`wallSlide`, `dash`, `airTurn`, `solidsCollide`, `snappy`, `flow`, `groundOver`/`airOver` 0 = as before), so every
existing test and the brains' seeded numbers come out byte-identical (checked by diffing the full `test-ts` output
before and after: the only changes are the new tests and one input test's button list, below).

**The duel's feel** (`DUEL_PHYS`): a 6.5 m/s run with separate rates to start (65 m/s²), stop (82), turn (140) and
bleed over top speed (30: momentum carries), air control 34 with drag 10 and 6 over top speed; a heavier jump (gravity
40, 13.3 m/s, falling 1.45× after the apex, released early cut 3.2×), air jump 11.5, fast fall 2.4× to 24 m/s, coyote
0.1 s, buffer 0.12 s; facing follows the stick at once, in the air too; landing lag only past 26 m/s (in practice
never). Air moves fall at the profile's gravity and ground moves slide on at its `slideK` (3; the jogo's 8): both ride
in the move's start event (`g`, `k`, only when they differ), so `Character.shapesAt` still replays them exactly.

**Walls, in both views.**
- Locked: `plane.walls` (one-sided faces, their world-y span) and the ends. Free 3D: the world's solids
  (`Terrain.solids`, which `?play` fills from `World.solids`): the body is a cylinder (`bodyR` 0.25) sampled at three
  heights against every capsule and box near it, pushed out of their faces; a face is a wall where its normal is mostly
  horizontal. Solid tops are floors (upright boxes, standing columns' crowns, lying logs' backs; a top at most `stepUp`
  0.35 m up is stepped onto), and undersides stop the head (the temple's lintel).
- **Wall slide**: airborne, touching a climbable wall, the stick pushing into it, falling (or rising slower than 1.5
  m/s): the fall is braked (110 m/s²) to 2.6 m/s and held against it. Let go or pushed away, it stays 0.14 s (so
  jump-away is reliable); down lets go at once. Starting a slide refreshes the air jump and the dash.
- **Wall jump**: a jump with a wall in reach (0.14 m) or left less than 0.1 s ago kicks up (12 m/s) and out along the
  face's normal (7.5 m/s), keeping 0.7 of the speed along the face (free 3D), refreshing the air jump and the dash. For
  0.16 s the stick can't pull back toward that wall, and that wall can't be kicked again.
- **Wall run** (free 3D): meeting a face at 3.5 m/s or more along it while pushing in runs along it for 0.45 s, rising
  at least 3.5 m/s with a third of gravity, then slides; a kick out of it carries on along the face.
- **The pose**: `src/dancer/kit-poses.ts`, `wallPose`: facing the wall a body's width ahead, crouched, one sole and
  one hand on it (the hand toward the camera in the lock), the other arm out; open hand, flexed feet.

**The dash** (`dash` 20 m/s for 0.15 s = 3 m, out at 0.45 of its speed, 0.18 s cooldown, a press buffered 0.1 s):
- Locked: 8-way, the stick snapped to 45°, none = the facing. Free 3D: along the camera-relative stick (none = the
  facing), up with jump held, down with the stick down (crouch), 45° with both, straight up or down alone. On the ground
  down is along it; up leaves it.
- One per airtime, refreshed on landing and on a wall. A dash into a wall loses its way into it; a dash down ends on
  landing. A jump during it (ground, coyote or the air jump) keeps 0.75 of its speed across the ground: the dash-jump.
- The first 0.08 s are i-frames: `Character.invulnerable` is true then (on top of reforming, blink, moves' i-frames).
- The pose: `dashPose`, a lunge low and stretched along the dash (hips at 0.5 m, pitched 0.95 rad, lead hand reaching,
  back leg trailing), blended toward a stretch overhead for an up-dash and a tuck for a down-dash.

**Moves flow** (`DUEL_PHYS.flow`): any move cancels another's recovery whatever its list says; a jump or a dash cuts
a move once its active window opens (an attack thrown is committed until it lands); kick or spin with a wall in reach
kicks off it into a martelo or an aú (an aú may start in the air for this: `startMove(…, { air: true })`); air moves
keep the body's momentum; ground moves carry the run (`slideK` 3); the move buffer is 0.2 s. Transitions are the
Character's crossfades (0.08 s into a move, 0.1 s out), so nothing snaps.

**Events** (`Character.events`), for matter and sound:
`{ type: 'dash', x, y, z, dir: [x, y, z] (world, unit), air, s? (locked: the way along the plane) }`,
`{ type: 'wall', x, y, z, n: [x, z] (the face's normal, out of it), wall (id: a plane wall's, '_left'/'_right',
'solid.<i>' for World.solids[i]), run, side? (locked: ±1) }`,
`{ type: 'wallJump', x, y, z, n, wall, dir? (locked: ±1, the way it kicks) }`, and `'jump'` gains `dash: true` for a
dash-jump.

**`?play` setups.** `?play&duel` plays any world with the duel's movement (bodies on `DUEL_PHYS`, devices on the duel
scheme): free 3D by default, its solids for walls, `l` locks as always. `?play&arena=test` adds a locked test arena on
the world's first stage (`testArena`, src/dancer/play.ts; the pool's is clean): a 4.5 m block and a 1.2 m step, each a
solid ledge with a wall on each face, a 2.7 m shaft between the block and the left end, one-way platforms at 1.7 and
3.3 m, a perch at 6 m, drawn by a 2D overlay (`#arena-overlay`) since no world draws it.

## Measured

`src/dancer/test/feel.test.ts` (22 tests, in `npm test`) drives bodies with Intents at 240 Hz (the latency test at
60 Hz), on a flat plane, shafts, the temple's real solids (`layoutTemple` → `solidsOf`) and a few synthetic ones, and
prints this table:

| what | measured | the brief |
|---|---|---|
| run: top speed | 6.5 m/s | (fast; the jogo's 4) |
| run: rest to top speed | 100 ms | about 100 ms |
| run: top speed to a stop | 79 ms | about 80 ms |
| run: reversal (moving the other way / at full speed) | 50 ms / 142 ms | near-instant |
| air: rest to top speed (stick only) | 192 ms | a little looser |
| jump: full (held) | 2.18 m, apex at 329 ms, down in 279 ms | snappy, falls faster |
| jump: tap (one 60 Hz frame) | 0.81 m in 113 ms | a short hop |
| jump: held 0.12 s | 1.57 m | between |
| jump: + air jump at the apex | 3.81 m | one air jump |
| fast fall: apex to floor from 2.2 m | 179 ms (plain 279 ms) | down = fall fast |
| fast fall: top speed | 23.8 m/s (plain cap 15) |  |
| wall slide: speed down the wall | 2.60 m/s (free fall cap 15) | slowly |
| wall slide: stick let go, held on | 142 ms | jump-away is reliable |
| wall jump: the kick | +1.78 m at 296 ms, 1.91 m out by then | up and away |
| wall jump: stick held back at the wall | still 7.5 m/s away after the 160 ms lockout | no pull straight back |
| shaft 2.4 m wide (locked): kick on touch / once sliding | 6.83 / 6.17 m/s up (15 / 13 kicks in 4 s) | climbable by kicking |
| shaft 3.6 m wide (locked) | 2.93 / 2.14 m/s up (9 / 8 kicks in 4 s) | |
| dash: ground, along the facing | 2.95 m in 146 ms; 79 ms of i-frames | about 0.15 s, a few metres |
| dash: air, up-right | 2.12 m along, 2.11 m up | 8-way |
| dash: straight up from the floor | 3.25 m |  |
| dash-jump: a running full jump spans | 8.01 m (a plain running jump 3.95 m) | keeps the dash's speed |
| input to motion (60 Hz) | 0 frames: in the press's own frame the run moves 11 mm, the jump 215 mm, the dash 333 mm | nothing sticky |
| free 3D: wall jump off a temple column (r 0.6 m) | met at its face (normal 1.00, 0.00); kick +1.78 m at 296 ms, 1.91 m out | walls are the world's solids |
| free 3D: climb between two columns 1.8 m apart | 8.94 m/s up (26 kicks in 4 s) | climbable by kicking |
| free 3D: the temple's stage pillars (1.7 m apart) | the head meets the lintel (2.6 m) on the first jump; it stops it through 14 kicks |  |
| free 3D: wall run along a flat face | 450 ms running, 3.2 m along it, peak 2.68 m | a short wall run |
| free 3D: kick out of the run | 7.36 m/s out, 4.79 m/s still along the face, 11.8 up |  |
| free 3D: dash along the stick (45°) | 2.99 m, dir (0.71, 0, 0.71) | camera-relative |
| free 3D: dash with jump held | 2.12 m along, 2.11 m up | up by jump |
| flow: speed into a jump → air kick | 6.5 → 6.5 → 6.5 m/s | aerials keep momentum |
| flow: a dash cuts the air kick | 150 ms after asking (as its active window opens) | moves cancel into each other |
| flow: a kick on the run slides on | 1.12 m in its first 0.2 s | no stop-start |

Also checked there: walls are one-sided and in world y (a plane off the origin), a body walks under a high wall;
frame-rate independence of a wall climb with dashes at 30, 60 and 144 Hz (ends within 1.4 cm); the jogo's body has none
of the kit; a hand of the wall pose is within 8 cm of the face, and the lunge's head is 0.32 m over the hips (standing
about 0.75); kick or spin on a wall gives wallJump → martelo / wallJump → aú. The input tests cover each device's duel
scheme, the swipe (a slow push doesn't dash) and the hub handing its scheme on.

**Seen** (critic-cap, `node scripts/steps/move-gen.mjs` then `node scripts/critic-cap.mjs scripts/steps/move-11.json
--prefix 11 --url …`, RTX 5090, under the render lock; I looked at every sheet):
- Free 3D in the temple, the follow camera: `11-move-free-column-sheet.jpg` (run, jump into the back-row column, the
  slide with a hand on it, the kick back off it), `11-move-free-pillars-sheet.jpg` (kicked between the stage's two
  pillars under the lintel, then a dash out), `11-move-free-flow-sheet.jpg` (run → jump → martelo → dash → land → a
  bênção carried by the run → an aú), `11-move-free-wallau-sheet.jpg` (the slide, spin: an aú flung off the column,
  landing on a broken pillar's top: solid tops are floors).
- Locked in the pool's test arena: `11-move-wallslide-sheet.jpg` (jump into the block's face near the apex, the slide
  crouched against it), `11-move-climb-sheet.jpg` (the shaft kicked up wall to wall), `11-move-dash-sheet.jpg` (ground
  dash, jump, up-right dash, down-right dash into the end wall), `11-move-dashjump-sheet.jpg` (run, dash, jump: over the
  step into the far wall and down it), `11-move-fastfall-sheet.jpg` (player one fast-falls beside the bot's plain fall).
  Stills: `11-move-*-<s>.jpg`.

## Weak points

- **The matter smears at dash speed.** At 20 m/s the gems' springs (`play.gemStiffness` 280) leave a metre-long trail:
  the dash reads as a streak, the body less. Good juice, poorer legibility; the matter kinds may want a stiffer hold
  while `Character.dashing`.
- **Narrow gaps climb very fast**: 9 m/s between columns 1.8 m apart, 6.8 m/s in a 2.4 m shaft (each kick lands while
  still rising and tops the climb up). Arenas should keep climbable gaps around 3.5 m (about 3 m/s), or the kick wants a
  short cooldown (a knob not added).
- **Free solids are approximations**: three sampled heights, a cylinder body; tipped boxes (crystal blades) are walls
  but never floors; a lying capsule is a floor only within 0.85 of its radius of its top line; the head stops only when
  rising. The redwoods' trunks have a 2.6 m root-flare sphere round each base, so a wall slide or run there meets a
  bulge before the trunk: not captured.
- **The free dash's "up" is jump held**: a player holding jump for a full jump who dashes gets an up-diagonal. The
  duel keyboard's W holds the stick up in the lock for the same reason (Space jumps without it).
- **Moves slow the run more than a run would**: a bênção on the run still decays to about 1 m/s across its 0.7 s
  (slideK 3); kinematic air moves ignore air control (they keep momentum but can't be steered).
- **The locked camera** in the pool (its 18° lens) frames the arena wide: bodies are small on the sheets. The follow
  camera in the temple sometimes swings close to a solid (a blurred stone in the corner of frames).
- `?play` never empties `Character.events` (as before this work): the duel's rules must splice them each frame.
- The touch swipe and dash button are tested in Node only, not on a phone.

## Not done

- No network for the kit (`Character.flags` don't carry dashing or on-wall; a NetController peer won't show them).
- No ledge grabs or mantles; drop-through stays a locked-plane thing (free 3D has no one-way surfaces).
- No redwoods or forge captures; the wall run isn't on a sheet (measured in Node on a flat face only).
- The HUD's `dash` is `Character.dashReady` but nothing wires it (the HUD agent's).
- docs/extending/input.md and move.md not updated (outside my files); the lines are below.

## For AGENTS.md and the guides (proposed)

- Contracts: "`Character.phys` (PHYS, the jogo's; DUEL_PHYS, `setProfile('duel')`): the duel's kit (wall slide and
  kick, wall run, the dash with i-frames, solids as walls and floors in free 3D via `Terrain.solids`, moves that flow).
  Events `dash`, `wall`, `wallJump`; state `dashing`, `dashReady`, `onWall`, `wallNormal`, `wallKick`, `invulnerable`."
- Input: "`Intent.dash` (edge). Sources have a `scheme`, `'jogo' | 'duel'` (`InputHub.scheme`): the duel's moves dash
  onto Shift/K, RT/B, a stick swipe; kick, spin and dodge move to L, I, O (keyboard) and Y, LB, RB (gamepad)."
- Debug flags: "`?play&duel` (the duel's movement in any world), `?play&arena=test` (a locked test arena on the
  world's stage, drawn by an overlay)".
