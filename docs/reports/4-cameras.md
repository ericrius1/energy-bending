# Wave 4: cameras through gates, and the game screen

Branch `worktree-agent-a47b75529ea10340f` (task 4 of `docs/reports/3-critique.md`). Owned: `src/portals/`,
`src/engine/camera.ts`, `src/engine/shots.ts` (unchanged in the end), `scripts/check-portals.mjs`, the step files
`scripts/steps/cameras-*.json` (written by `scripts/steps/cameras-gen.mjs`), this report.

Measured: `npm run typecheck`, `npm run build`, `npm test` clean (check-portals now 10,023 checks, eleven of them the
camera through a gate and the locked framing, below); the critic's takes re-staged as short takes and captured with
`scripts/critic-cap.mjs` on the RTX 5090 through headless Chrome (dev server on port 5424, one take per lock hold);
the brightness across a crossing frame by frame (mean luma of every frame, ffmpeg `signalstats`); the follow camera
through both doors read back frame by frame (eye, player, which world). Not measured: a real gamepad or a person
playing, a phone, a long soak, timings (the lock queue was long; the stills slot costs one gate view on the frames it
takes a still, at most four a second, not timed).

## The verdict

The camera now goes through a gate with its player, both ways: it is carried in the same frame by the same move, is
drawn from where it really is until its own eye comes through the disc a second or so later on a line through the
disc, and ends behind the player in the far world (`4-cam-g2r-sheet.jpg`, `4-cam-r2g-sheet.jpg`; the critic's
`3-gate-*-sheet.jpg` drove into the crystal wall and a trunk). A gate with the other dancer behind it is live (it
was the second slot going to a gate mostly off the screen edge), and every gate without a live view shows a dim, soft
still of its far world instead of a shimmer (`4-cam-hub-sheet.jpg` against `3-hub-sheet.jpg`). A gate seen through a
gate was never live (the slot order check was the wrong way round): it is now. The brightness step at the face is
down from 7 to 13 % to 2 to 4 %. The locked view keeps both dancers whole in all five worlds and through a leap and a
cartwheel; its default angle is a little off square-on and from a little above.

## 1. The camera travels with its player

**What was wrong.** The follow camera only crossed when its own eye happened to pass the disc. When the player
walked through, the rig kept working in the old world: it aimed at the player's image through the gate, so it
followed them toward the gate's wall, and the player's yaw and speed (in the new world's coordinates) swung it the
wrong way (the integration's open item 8), so the eye passed beside the disc into the wall. In the critic's
`3-film-sheet.jpg` the lock camera stood behind the disc and its eye passing through carried it back.

**What changed.**
- `Portals.rigAfter` / `carryRig` (portals.ts): when the dancer the camera follows crosses (player one while
  `rig.follow` is set, or `Portals.follow`; for the director's camera, the last dancer to leave its world), the rig
  is carried in the same frame by the same rigid move (`CameraRig.carry`: target, eye, look, the eased lock points,
  yaw, height, so its springs, swing and velocity go on). From then on the rig works in the player's world
  (`gates.rigWorld`), and main.ts measures the follow target, framing, room, ground and focus there.
- Nothing jumps on screen: until the eye itself comes through the partner disc, the main view is drawn from where the
  eye really is (`offset`, the rig's coordinates carried back through the gate, applied in the 'gates' phase). When
  the eye passes the disc the main view goes to the far world and the offset is gone: the same pose, seen from the
  other side.
- `CameraRig.through` (camera.ts `passThrough`): while the eye is still behind the disc, it is kept on lines from the
  look point that meet the disc inside 75 % of its radius (seen from the old world it never passes beside the gate),
  and the boom shortens so the eye comes through in about a second and a half, never nearer the look point than 1.5 m;
  then the boom grows back (in fast, out slowly: `settleEye`). One continuous push through the door behind the player.
- `CameraRig.approach` (portals.ts `lineUp`): a player heading for a gate (within 4.5 m, walking toward it, in reach
  of the disc) has the camera swing onto the line from the disc's middle through them and flatten a little
  (`camera.gateAlign`, 0.9 rad/s at the face; the player's own look input wins). It is gentle on purpose: the
  player's stick is read in the camera's turn (`inputYaw`), so a camera that swings fast steers the player
  (`4-cam-g2r-angle-sheet.jpg`, a fixed stick held at an angle: the player wanders past the door and grazes the
  forge's; the camera is not carried by the graze, but the take is not pretty; first shot at 2.4 rad/s it circled).
- After the crossing the follow camera is held inside the new world's `room`, above its `groundAt` (+0.25 m), and in
  front of any disc between it and the player (`rig.clearance`, from the portals); all eased (the boom comes in at
  16/s, goes back out at 1.6/s).
- The lock camera: never carried by a crossing it didn't lead (the eye passing a disc carries the camera only on its
  way after its player, on the ?fly path, or for the director's free camera, never while locked), and never stands
  behind a disc (the lock's distance is capped by the same clearance: the lens widens instead). A crossing made while
  locked is owed: the rig goes with the player when the lock lets go; a lock asked for while the eye is still on its
  way through takes the rig back to where it is drawn from (nothing moves on screen).
- Crossings must pass 10 cm inside the disc's rim for the camera (a graze carries nothing).

**Measured.** The follow camera through the geode's redwoods door (the critic's `gate-geode-to-redwoods` staging,
read back every 2 frames): the player crossed at 1.9 s, the rig was carried that frame, the eye came through at
3.2 s, 2.7 m behind the player, and it ends behind them in the meadow. `check-portals.mjs` (new cases, a walk
through a pair of wall doors at 1.8 m/s): the eye comes through 1.65 s after the player, its line passes through the
disc on every frame (0 beside), the drawn eye's largest step is 0.131 m a frame (no jump), it is never nearer the
player than 2.99 m after the crossing, and it ends behind the player; carry moves eye, look and target by the gate's
move and turns the orbit by the gate's turn; a follow camera with a disc behind it stays 0.3 m in front of it.

## 2. Live slots go where they matter

**What was wrong.** With the other dancer in the redwoods behind the hub's redwoods door
(`3-gate-other-inside-sheet.jpg`), the two live slots went to the forge and temple doors: a gate's size was its
bounds, not the part on screen, and a gate half off the edge outranked the one in the middle. A gate seen through a
gate was never live (`tables` looked for a slot with a *lower* index than its parent; the deeper slot always has a
higher one, it is rendered first), so it showed last frame's blur or a shimmer. Over eight gates warned. Non-live
discs were fbm shimmer textures.

**What changed.** (portals.ts `assign`, `dancerThrough`, `tables`, `refreshStill`; surface.wgsl `stillAt`.)
- Slot order on the main screen: the gate the followed player is heading for, then a gate with a dancer seen through
  it (a dancer of the partner world, carried back through the pair, beyond the disc on a line through it), then the
  biggest by the part of it on screen.
- A gate seen through a gate is live (the order check fixed).
- Each view draws the nearest `LIMITS.gates` gates (live first); more gates in a world drop the farthest, no warning
  (`4-cam-many-sheet.jpg`: sixteen gates open, eight of them in the hub, no console warning).
- Stills: a layer per gate in one `rgba16float` 2D array (256², 128² on a phone, `LIMITS.gates` layers, 4 MB). A slot
  nobody needs this frame (and, at most four times a second, the last slot before gates seen through gates) draws a
  gate's far world from square on in front of the disc, the disc filling the middle square, and the 'gates' stage
  copies that square into the gate's layer. Each gate's is taken once it is open (the main view's world first), then
  again every eight seconds. A disc with no live view shows its still, laid on by the disc's own coordinates, soft (5
  taps) and dim (0.55), swaying with the skin; the halo takes its light from it. The shimmer is left only for a gate
  whose first still isn't taken yet. `gates.stills` turns it off.

Also: a still that is due takes the last slot before a gate seen through a gate does (at most four times a second),
which otherwise starved them (`4-cam-many-sheet.jpg`: the four new doors show the temple within the take).

**Measured.** `4-cam-other-inside-sheet.jpg`: the redwoods door is live in every frame (it was a green shimmer in
every frame of `3-gate-other-inside-sheet.jpg`). The other dancer there wears water, which has no surface in a
gate's view (seam 10, task 2), so it shows only as drops; `4-cam-other-fire-sheet.jpg` is the same with the other
dancer on fire. `4-cam-hub-sheet.jpg`: every door shows its world (the critic's sheet: polka dots, kiwi slices,
dartboards).

## 3. The crossing's known flaws

**Brightness across a crossing.** Mean luma of each frame (0 to 255), the ?fly path through the hub's redwoods door
and back, two frames a step:

| | going in (last frame before, first after) | coming back (before, on the plane, after) |
|---|---|---|
| before (this branch before the fix, depth of field on) | 55.9 → 52.2 (−6.6 %) | 52.4 → 48.9 → 55.1 (+12.7 % over the face) |
| after (`cam-fly`, 30 fps, depth of field on, `4-cam-fly-sheet.jpg`; twice, the same) | 50.9 → 52.1 (+2.4 %) | 52.2 → 50.1 (−4.0 %) |

Elsewhere on the path the largest frame-to-frame change is 1.5 levels (the exposure leaning as the disc grows). How
it was found: with the depth of field off, with the bloom off, and with this world's air over the disc at 0 m instead
of 1 m (`gates.faceDist`) the step was the same, so it is the gate view itself: the redwoods drawn in a half-size
gate view read about 7 % brighter than drawn full size; the geode matched within 1 %. `SLOT_GAIN` (portals.ts) takes
the redwoods' gate view down by 7 %. The cause (somewhere in the redwoods' air or scene at half size) is not traced;
the world's or the air's owner should find it, and then the table goes. The frame with the eye exactly on the plane
still reads 6 % darker in the stepped test (a real camera almost never lands on the plane).

**The gate through the gate empty for a frame.** It was never live at all (above); now it is live, and when the
slots are reassigned at a crossing a gate falls back to last frame's view or its still, never to nothing. Not
re-filmed at the moment of a crossing (the portals' film was not re-shot).

**Focus at the crossing.** The disc reported the far view's depth only within 0.03 to 0.7 radii of the plane and at
most 1 m of it, so the depth of field blurred the whole frame while the eye came through behind its player (row 3 of
the first `cam-g2r` sheet). It now reports the far view's depth from two radii out, up to 2.5 m (`gates.faceDist`;
the brightness measured the same at 0 and 1 m). Re-shot: `4-cam-g2r-sheet.jpg` is sharp but for a frame or two. The real fix is the lens
agent's split of the scene alpha into an opaque distance and a focus distance; then the disc should write `here` as
the opaque distance and the far view's path as the focus distance.

**A dancer's shed stones travelling with it.** Not fixable in src/portals: `MatterPasses.carry` moves every particle
of the dancer (each kind's carry shader). The ask, below.

## 4. The locked view as a game screen

**What was wrong.** The framing used seven joints a dancer and no velocity, eased everything at one slow rate, and
stood square-on; in the redwoods the dancer on the high bough was cut at the right edge
(`3-w-redwoods-lock-sheet.jpg`), and the extent breathed with every kick.

**What changed** (camera.ts `updateLocked`).
- Framed: fifteen joints of each body (hips, knees, feet, toes, head and its top, elbows, hands, fingertips) and where
  each is heading in `camera.lockLead` (0.35 s) of its velocity (capped at a metre), plus the floor; a margin of
  0.3 m across and 0.25 / 0.3 m below and above; never less than 2.4 m of stage.
- The extent widens quickly (9/s) and settles slowly (0.9/s); a dancer put somewhere else in one go (a respawn) moves
  it at once.
- Safe area: everything inside 93 % across and 86 % up and down of the frame, measured on the four corners of the
  extent in the camera's own basis, so the angle's perspective is accounted for.
- The composed angle: turned `lockYaw` (0.1 rad) off square-on and looking `lockPitch` (0.07 rad) down by default;
  `StagePlane.yaw` / `pitch` (new, optional, beside `lens`) let a world set its own.
- Past the world's room or a gate's disc the lens widens instead of the camera backing off.
- Separation: the focus is now the distance to the plane's framed middle while locked (`rig.focus`, main.ts), so the
  depth of field keeps the plane sharp and softens what is behind it. No background dim: post exposes no per-depth
  dim (below).

**Measured.** `check-portals.mjs`: two dancers 9.2 m apart on ledges in a 9 m room, one leaping 2 m at 6 m/s, the
other turned upside down (a cartwheel): every joint stays inside the frame (furthest 0.86 of the half-frame), each
dancer is at least 0.21 of the frame's height. In the five worlds, `4-cam-<world>-lock-sheet.jpg` (the critic's
staging: two dancers put on the outermost ledges, then moves) and `4-cam-redwoods-leap-sheet.jpg`,
`4-cam-geode-leap-sheet.jpg` (a jump off the high bough and two cartwheels):
  every frame from 1 s on shows both dancers whole, each about a fifth (the geode's and the redwoods' outermost
  ledges, 9 to 10 m apart) to a third (the Pool, the temple) of the frame's height; the critic's redwoods crop is gone
  (`4-cam-redwoods-lock-sheet.jpg` against `3-w-redwoods-lock-sheet.jpg`). The first second shows the free camera
  easing into the lock and the dancers re-forming after the staging's `reset` (the critic's staging artifact). In
  the leap takes the water dancer's jump off the high bough stays in frame at the top (`4-cam-redwoods-leap-1p9.jpg`)
  and the cartwheels on the log and the shelf are never cut. In the forge the two dancers end up fighting in the
  middle (the forge's ledges all bob, so the staging puts them on the floor), framed whole.

## 5. Free view

Done: the follow camera leads where the player travels (`followLead`, 0.3 s of speed), keeps a near partner in frame
(the boom grows until both hips and heads fit, up to 4 m more; a partner more than 5 to 8 m away is let go and the
camera holds the player alone), lines up with a gate the player is heading for, stays inside the world's room and
above its ground, and stays in front of gates' discs. Handing over to the director's shots when idle is unchanged
(`updateFree`; `shots.ts` unchanged).

Not done: trunks and pillars. The worlds draw them from data they keep to themselves (the redwoods' `layoutWoods`
trunks, the temple's `pillars`), but `World` exposes no geometry. The rig is ready for it: `CameraRig.clearance(a, b)`
returns how much of the segment from the look point to the eye is clear, and a world's answer would be combined with
the gates' in portals.ts `clear`. What I need is below.

## The critique's "Done when", item by item

1. *`critic-gates.json` re-shot shows the camera in the far world behind the player in both directions*: **done.**
   `4-cam-g2r-sheet.jpg` (geode to redwoods), `4-cam-r2g-sheet.jpg` (redwoods to geode); the critic's staging, swing
   off as the critic had it. In the reverse take the water player is invisible through the disc for about a second
   (a water body has no surface in a gate's view yet) and the camera, once through, frames them behind.
2. *`critic-film.json` (both gate placements) keeps the camera with the players through the lock*: **done for both placements.** `4-cam-film-a-sheet.jpg` (the redwoods end in the meadow) and
   `4-cam-film-b-sheet.jpg` (at the world's own site, critic-film's): the walk through the Pool's gate, the lock, a
   jogo, the unlock, in short takes. In both the camera goes through with player one, stays with them through the lock
   (on the redwoods' stage) and the unlock, and is never carried back. In (b) the water dancer walks beside the disc
   and stays in the Pool, as in the critic's take: the camera goes with the fire player (player one) and the lock
   frames them alone (it used to frame a dancer it could not see, in another world: now another world's dancer counts
   only within 2 m of the gate between).
3. *`3-gate-other-inside` shows the other dancer through a live disc*: **the disc is live** in every frame
   (`4-cam-other-inside-sheet.jpg`); the dancer through it is water, drawn in a gate's view as drops only (task 2's);
   with the other dancer on fire, `4-cam-other-fire-sheet.jpg`.
4. *The five `w-*-lock` sheets re-shot show both dancers whole and readable in every frame*: **done** (above): `4-cam-<geode|redwoods|pool|temple|forge>-lock-sheet.jpg`, plus the
   leap sheets. Every frame after the first second has both dancers whole and inside the frame; the smallest is about
   a fifth of the frame's height.
5. *Adding a gate pair over eight drops the farthest instead of warning*: **done** (`4-cam-many-sheet.jpg`, sixteen
   gates open, eight in the hub, no warning; each view draws its nearest eight).

## What I need from other owners

- **Water (task 2):** a water body's surface in gate views. Today a player in water who walks through a door is
  invisible through it until the camera follows (`4-cam-r2g-sheet.jpg`), and the other dancer in water is drops only.
- **Lens (task 3):** in the depth contract, let the gate disc write two distances: the opaque one (`here`, the disc's
  own) and the focus one (the far view's path). Then `gates.faceDist` goes. And for the locked view, a separation the
  camera can ask for: a uniform `stage` (0 … 1) with a focus plane distance, under which the post dims what lies more
  than ~1 m beyond the focus by up to 15 % (exposure × (1 − 0.15·k·smoothstep(focus + 1, focus + 6, depth))) and
  narrows the in-focus band. The rig already gives `rig.locked` (0 … 1) and `rig.focus`.
- **Worlds (tasks 6 and 7):** (a) for occlusion, an optional `World.clear?(a: V3, b: V3): number` (how much of a
  segment is clear of trunks, pillars, lanterns, shelves; a cylinder list is enough), which portals.ts `clear` would
  combine with the gates'; (b) the redwoods' own gate stands behind the stage's log, so a locked dancer on the log is
  drawn half through it (`4-cam-redwoods-lock-sheet.jpg`), and a lantern hangs between the lock camera and the stage
  (`3-cam-redwoods-leap-1p9.jpg`); (c) `StageDef` and `stagePlane()` (worlds/stage.ts) should pass on the new
  `StagePlane.yaw` and `pitch` so each world can set its composed angle; (d) the redwoods' half-size gate view reads
  7 % brighter than full size (portals.ts `SLOT_GAIN` evens it out; find the cause).
- **Matter (every kind's `carry`):** leave a dancer's shed particles behind at a crossing. The ask: an optional
  `within: [x, y, z, r]` on each carried move (the disc, widened), a particle further than that from it stays.
- **Dancers / play (src/dancer/play.ts):** `c.inputYaw = rig.yaw` is now in the rig's (player one's) world: player
  two in another world gets player one's frame; and a lock while the rig is behind a door locks to the world the view
  is in, which is right, but `planeOf()` should say so.

## Weak points

- The eye takes 1.2 to 1.7 s to come through behind a walking player; a player who stops just past the face is seen
  through the door until they move on (by design: the eye never comes nearer than 1.5 m).
- A gate that tilts the world (a floor gate to a wall gate) with the rig carried by its player: the offset is the
  exact inverse of the gate's move, but the rig cannot hold a tilt, so the first frame after such a carry is not
  verified (all the worlds' gates are walls; the residual path for the camera's own crossing is unchanged).
- The redwoods `SLOT_GAIN` is a measured patch, not a cause found.
- The stills are a memory with no parallax; seen at a glance the still slides with the disc. They are taken square
  on from the front: from behind they are mirrored.
- The still slot costs one gate view on the frames it draws (at most four a second); not timed.
- The locked view in worlds where the dancers stand 9 to 10 m apart (the geode's outer shelves, the redwoods) is wide:
  each dancer about a fifth to a quarter of the frame's height, near the edges, a lot of empty sky in the geode.
  Closer framing would need the dancers closer or the frame allowed to crop.
- Lock takes staged with `reset` show the dancers re-forming for the first second (the critic's note).
- `src/engine/shots.ts` unchanged: the director's shots were not part of the faults.

- A player in water walking through a door is invisible through it for about a second (a water body has no surface
  in a gate's view), and the camera following through shows nothing of them until it is through
  (`4-cam-r2g-sheet.jpg`, rows 2 and 3). The water's task.
- In the geode the room is a circle, but the crystal wall's blades reach inside it: a follow camera pushed toward
  the wall by a wandering player stands among the crystals (`4-cam-g2r-angle-sheet.jpg`, row 3). Needs the world's
  `clear` (asked above).

## Edits outside my folders

- `src/main.ts` (where the rig is driven): the camera tick measures the rig's input in `gates.rigWorld` (seen joints
  within 2 m of a gate, room, maxDist, and the new `groundAt`), the dancers tick's centre and ?play's `seen` likewise,
  and the post's focus
  is `rig.focus` (it mixed the drawn camera's position with the rig's look point, which differ while the eye is on its
  way through a door).
- `AGENTS.md`: the binding table's row for `portals/surface.wgsl` (3 → 4 sampled textures a stage: the stills).
- `scripts/steps/cameras-*.json`, `scripts/steps/cameras-gen.mjs` (new step files).

## Media

Before (the critic's): `3-gate-geode-to-redwoods-sheet.jpg`, `3-gate-redwoods-to-geode-sheet.jpg`,
`3-gate-other-inside-sheet.jpg`, `3-hub-sheet.jpg`, `3-film-sheet.jpg`, `3-film2-sheet.jpg`,
`3-w-<world>-lock-sheet.jpg`. After (`docs/reports/media/4-cam-*.jpg`): `4-cam-g2r-sheet.jpg`, `4-cam-r2g-sheet.jpg`,
`4-cam-other-inside-sheet.jpg`, `4-cam-other-fire-sheet.jpg`, `4-cam-hub-sheet.jpg`, `4-cam-many-sheet.jpg`,
`4-cam-fly-sheet.jpg`, `4-cam-film-a-sheet.jpg`, `4-cam-film-b-sheet.jpg`, `4-cam-<world>-lock-sheet.jpg`,
`4-cam-redwoods-leap-sheet.jpg`, `4-cam-geode-leap-sheet.jpg`, and stills `4-cam-<take>-<s>.jpg`. Re-shoot with
`node scripts/critic-cap.mjs scripts/steps/cameras-<gates|film|lock>.json --only <take>` (one take a run).

## Commits

On `worktree-agent-a47b75529ea10340f`, not pushed or merged (`git log 57483b3..`).

Run with weft 0.2.9 (what `npm install` fetched for this worktree: `predev` takes weft's tip); `package-lock.json` and
the regenerated `*.d.wgsl.ts` files outside src/portals are left uncommitted. Probes and capture logs are in my
scratchpad (`cam4/`), not committed. The dev server on 5424 is stopped and the render lock released.
