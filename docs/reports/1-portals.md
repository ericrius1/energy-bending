# Wave 1: portals (live gates between worlds)

Branch `worktree-agent-a8f543db3128f5480`. `src/portals/` is built: a gate pairs two discs (position, full
orientation, radius) in two worlds. While a gate is on screen the far world is drawn **live, this frame**, from the
camera carried through the gate, and shown in the disc with ripples, colour fringes, a braided rim in the colour of
whoever last passed, a halo, light on the floor and motes drawn in. A dancer whose middle passes the disc is carried
to the other world (one rigid move, full rotation, its stones with it), and while part way through it is drawn in
both worlds, each half cut at the door. The camera passing the disc carries the camera rig and the main view goes to
the other world; the exposure leans as the gate fills the screen. Gates work both ways and in any orientation (a
floor gate opening in the other world's sky is in the debug set), several per world, and a gate seen through a gate is
live one level down.

Measured: `npm run typecheck`, `npm run build`, `npm test` clean; `node scripts/check-portals.mjs` (new: 10,012 checks
of the gate algebra, the crossing rule and the oblique projection) passes; stills, GPU timings, a 600-frame film and a
per-frame brightness trace of round trips, all headless on the RTX 5090 (adapter printed in every log). Not measured:
a phone; a real second player; a long soak.

## How a live gate is drawn

1. **Slots.** `Portals` owns up to `LIMITS.views` extra views (3, or 2 with `?pip`), each a full scene and air at
   `gates.scale` (0.5) of the render size, made with `engine/views.ts makeView` exactly as `?pip` did. They run in a new
   frame stage, `gates` (after `cull`, before `scene`), deepest first, so the main scene samples them the same frame.
2. **Which gates are live** (`gates` phase, after the camera): every open gate in the main view's world is projected
   (`screenOf`: its disc's bounds on screen, or, when the eye is so near that part of the disc is behind the near plane,
   the whole screen ranked by how much of it the disc really covers). Those bigger than `minPx` (6 px of radius) take up
   to `live` (2) slots, biggest first. Then gates seen *through* those take the slots left (`depth` 2). Gates without a
   slot show the last view they had, blurred, or a shimmer in the far world's hue.
3. **The camera behind the gate** (`portals/camera.ts GateCamera`): the parent view's camera carried through the gate
   (`gate.through`, a rigid move: position, forward and up, so roll and tilt carry), same field of view, so a pixel of
   the parent's screen is the same pixel of the slot. Its **near plane is laid on the far disc** (Lengyel's oblique
   projection, reworked for weft's reversed-Z infinite projection: the z row becomes `row_w − a·C`, `a` chosen so that
   z ≥ 0 still holds along every frustum edge out to infinity). Nothing between the far eye and the far disc is drawn,
   in any shader, without any shader knowing; only the z row changes, so `viewRay`, the culls' `proj[1][1]` and every
   x, y are as before. `check-portals.mjs` checks 200 random cameras × 50 points: kept exactly beyond the plane, cut on
   the eye's side, never past the far plane.
4. **The surface** (`portals/surface.wgsl`, five draws per view from a per-view table of gates, `portals/surface.ts`):
   - *disc* (opaque phase, after every solid thing): drawn as a screen rectangle round the disc, never as geometry; per
     pixel the eye's ray meets the gate's plane, and inside the open disc it shows the slot's texture at its own screen
     position, bent by the skin's slope (slow swells plus rings poked by bodies passing), with colour fringes toward the
     rim, a thin-film skin brighter at a glance, and the rim's light. It writes the plane's depth (`frag_depth`), so
     what stands in front hides it and glows behind it are hidden. Because it is not geometry, a camera at the face is
     never cut by its own near plane: half the screen shows each world. The skin calms as the eye comes up to it.
   - *ring* (glow): a filament and two threads braided round the rim (camera-facing ribbons, never under ~1.5 px),
     in the colour of whoever last passed (the suite's colour for a dancer, warm white for the camera), flashing after
     a crossing.
   - *halo*, *pool*: the far world's light (a wide blur of the live view round the gate) round the gate and on the floor
     under a standing gate: the "soft glow that lights the near world a little" (an additive light, not a real light in
     the worlds' shading; see weak points).
   - *motes*: analytic specks spiralling in to the disc from both sides (no simulation, deterministic).
   - *opening*: the gate weaves open over `openTime` (1.8 s): the threads run round the ring, then two families of
     spiral threads widen from the rim inward until the disc is whole. Closing runs it back.

## What it costs (GPU, RTX 5090, 1280×800, render scale 1, 15,000 stones; weft's profiler over 150 stepped frames)

| frame (the same fly camera 3.9 m in front of the geode door, salsa awake, except the first) | GPU frame | of which |
|---|---|---|
| no gates (no `?gates`: the director's own camera) | 0.505 ms | scene 0.209, air 0.139 |
| gates open, none live (`live` 0: the door shows the shimmer) | 0.613 ms | scene 0.353 (the disc, ring, halo, motes), air 0.135 |
| one live gate (the door: the redwoods at half size) | 1.499 ms | scene 0.397, **scene.gate0 0.663, air.gate0 0.135**, gems.cull.gate0 0.006 |
| two live (the door, and the arch seen through it: the geode one level down) | 1.738 ms | scene 0.457, scene.gate0 0.723, air.gate0 0.134, **scene.gate1 0.086, air.gate1 0.026** |

So a live gate into the redwoods costs about 0.85 ms here (its scene 0.66 + its air 0.13 + the disc), and a small gate
seen through it about 0.11 ms. Timings files: `shots`-style `timings-*.json` from `scripts/steps/portals-timings.json`
(not committed). Run-to-run noise on this GPU is several percent (the foundation's report).

The geode main scene grows with gates on screen (the disc's per-pixel ray test and fbm shimmer, the ring's 96
segments × 3 strands, 96 motes a gate). A live gate's own cost is its scene at a quarter of the pixels: the redwoods
scene behind the door at half size costs more than the geode's whole scene, because the meadow's instanced grass and
trunks cost per vertex, not per pixel. Its air is a fullscreen pass at a quarter of the pixels. Its gem cull is one
more dispatch (5 µs). The gate view draws `keep` (55 %) of each body's stones, grown to look as full, rising to all
of them as the gate fills the screen (no pop in density at the face).

## Crossing

- **One rigid move.** `gate.through = partner.frame · (half turn about up) · frame⁻¹`: in at a disc's front, out of its
  partner's front; in at the back, out of the back. Two wall gates keep up as up (a pure turn about y); a floor gate
  paired with a sky gate keeps down as down (checked).
- **The rule** (`Gate.crossing`): the segment from the last point *strictly* off the plane to now must go strictly from
  one side to the other (beyond `ON_PLANE`, 10 µm) through the open disc (`open` > 0.6). A point on the plane is on
  neither side; the caller keeps its last strict point, so stopping on the plane and stepping back is no crossing, and
  once carried a point stands strictly in front of the partner and can't be taken straight back. (Found by the film:
  without it a camera landing exactly on the plane was carried and then carried back, or a crossing was lost.)
- **A dancer** (`travel` phase, after the dancers are posed): its root (the hips) crossing the disc (with 15 cm of
  margin) carries it. Its controller is wrapped (`portals/carried.ts Carried`): the controller keeps posing where it
  thinks it is and every joint goes through the accumulated move (going back multiplies to identity and the wrapper
  comes off). This frame's joints are carried too and re-uploaded; `skeleton.reset()` restarts the velocities (see
  weak points). Each matter kind's `carry(moves)` moves that dancer's particles (gems: `matter/gems/carry.wgsl`, a
  compute before the step, enabled only on that frame): positions, velocities, orientations. The dancer's world
  becomes the partner's; the rim takes its suite's colour; both discs ripple where it passed.
- **Part way through** (`see()`): a dancer whose root is within 1.35 m of a disc's plane and near the disc is drawn in
  its own world cut at the plane (the half on the root's side), and in the partner world carried through the gate and
  cut at the partner's plane (the half that has gone through). Seen from either side, the body is whole: one half
  direct, the other through the disc. Seen side-on, the half beyond the plane is simply not there (still
  `halfway-cut`).
- **The camera** (`gates` phase, after the rig): the eye crossing a disc carries the camera. The rig is an orbit
  (target, yaw, pitch, height): its target is carried, its yaw turned by the gate's turn about up, its height raised by
  the gate's rise, its pitch set from the carried view; what an orbit can't hold (a tilt, a roll: a floor gate to a
  wall gate) is kept as a residual rigid move applied over the rig's pose and eased out over `settle` (0.9 s). The
  carried pose is set exactly on the crossing frame. The main view's world changes, `entered()` retunes the sound, and
  dancers who were "with the main view" stay in the world being left.
- **No pop.** The far world was already on screen, live. As the gate fills the screen (a 12×8 grid of rays) the main
  view's exposure leans toward the far world's with a weight symmetric about a half-filled screen (`k³/(k³+(1−k)³)`),
  so the far side of a crossing leans by the same amount the other way, then eased over 0.12 s. A small gate shows the
  far world partly matched to this world's exposure (`match` 0.65). At the face: the skin's bend, fringes, sheen,
  flash and the glows fade out (they would throw the view about from a few centimetres), and the disc writes a
  distance for the depth of field that reaches through (capped at a metre) so the screen isn't blurred as "3 cm away".
  Measured over a round trip, mean brightness per frame (0–255), 2 frames a step of 2.3 cm:
  `… 75.6 75.2 73.6 72.9 72.7 | 75.8 (eye on the plane) | 68.2 68.2 …` going in, and `… 67.1 67.3 67.4 67.4 |
  66.4 (on the plane) | 72.7 72.4 …` coming back: no dark, flat or washed frame; a step of about 7 % remains.

## The API (src/portals/portals.ts; `bend.gates` in the page)

```ts
gates.open(...defs: GateDef[])          // GateDef = PortalDef & { world; up? } — opens the pair (partner from the call or the partner world's list)
gates.close(id)                          // weaves the pair shut, then they go
gates.crossed(prev, next, world, margin?) // { gate, u, v, front } | null
gates.pt(id, p) / dir(id, v) / quat(id, q) / move(id)   // through a gate (its world → the partner's)
gates.on((e: TravelEvent) => …)         // { who: 'dancer'|'camera', dancer, id, gate, partner, from, to, u, v, front, t }
gates.worldOf(dancer) / place(dancer, world | null)
gates.seen(world, dancers)               // joints as `world` sees them (through a joining gate), and their middle
gates.travel(e, dancers, t)              // apply a crossing the network reported (idempotent with a local one)
gates.follow                             // reserved (see not done)
gates.exposure, gates.stats()
```

Every world's `portals` list is opened at start (paired by `to.portal`). Online play: send the `TravelEvent` of the
local player's crossing as the `travel` message (`dancer`, `gate`, `front`, `t` suffice: the move is the same on every
client); the receiver calls `travel(e, dancers, t)`. The guide is `docs/extending/portal.md`.

## The clip hook other matter kinds must honour

`engine/seen.wgsl`: each view's uniform `ViewSeen` holds, per dancer slot, a rigid move (3×4 rows and a quaternion) and
a clip plane; `keep`/`grow` cut matter counts in a gate's view. A dancer not in a view's world has the plane
(0, 0, 0, −1): never drawn. In a kind's cull and draw: `let sd = seen.d[dancerOf(home)]`, draw at `seenPos(sd, p)`
turned by `seenRot`, skip where `seenClip(sd, p) < -radius`, pass `seenClip` to the fragment shader and discard below 0,
skip `rnd(i) > seen.keep` and grow by `seen.grow`; bind `seen: s.view.seen`. And implement
`MatterPasses.carry(moves)` (move a dancer's particles by a column-major 4×4 before the step). The gems do both
(cull, stones, the floor's reflection, streaks; carry). Not honoured: the gems' sparkles (they belong to no dancer and
show in every world's view). Details and code: `docs/extending/portal.md`.

## What changed in the engine files (mine this wave)

- `engine/frame.ts`: a stage `gates` (after `cull`, before `scene`); phases `travel` (after `dancers`) and `gates`
  (after `camera`).
- `engine/views.ts`: `ViewCtx.seen` (the per-view dancer uniform, made with everyone drawn) and `cast` ('world' |
  'all'); `makeView` takes an optional `camera` (a slot's `GateCamera`) and `cast`; `seenEveryone()`.
- `engine/seen.wgsl` (new): `Seen`, `ViewSeen`, `seenPos`, `seenDir`, `seenRot`, `seenClip`.
- `engine/scene.ts`: `SceneLayer` and the `sceneLayers` registry: layers that belong to no one world (the gates) are
  declared per view and phase after the worlds.
- `engine/pip.ts`: unchanged (the pip view keeps every dancer by default: it never gets a `seen` from the portals).

## Every edit outside src/portals and those four files

| file | what |
|---|---|
| `src/main.ts` | make `Portals` after the main view; its views join `views` (worlds update, culls run) but are declared by it; `gates.declare(kinds, post)`; `gatesDebug(...)`; the camera's centre and framing come from `gates.seen(main.world, dancers)` (a dancer beyond a gate is followed through it); `bend.gates`. About 25 lines |
| `src/engine/limits.ts`, `limits.wgsl` | `gates: 8` / `MAX_GATES` |
| `src/engine/seen.wgsl` (+ its `.d.wgsl.ts`) | new (listed above) |
| `src/post/post.ts` | `declareAir(view, worlds, stage = 'air')` (a slot's air goes in `gates`); `exposureOf(world)`, which the portals set to their leaned exposure |
| `src/matter/core/kind.ts` | `MatterPasses.carry?(moves)` and `Carry` |
| `src/matter/gems/cull.wgsl`, `draw.wgsl`, `streaks.wgsl` (+ `.d.wgsl.ts`) | the `seen` hook (above) |
| `src/matter/gems/carry.wgsl` (new), `gems.ts` | the carry compute before the step; `carry()`; bind `seen` per view |
| `scripts/check-portals.mjs` | new Node check (not wired into `npm test`: package.json isn't mine; run it by hand) |
| `scripts/steps/portals*.json` | stills, timings, the film |
| `docs/extending/portal.md` | new guide |

## Stills (docs/reports/media/portals-*.jpg, 1280×800, read back with bend.grab)

| file | what it shows | anything wrong |
|---|---|---|
| `portals-gate-geode-front.jpg` | the geode door from the front: the redwoods live through it, with the dancer who is in the redwoods (Sky) dancing among the trunks; inside, the arch in the redwoods showing the geode one level down | a geode dancer, out of focus, at the bottom left (the depth of field focuses on the rig's target, not the fly camera's) |
| `portals-gate-geode-steep.jpg` | the same door at 62° from its normal: the far view in correct perspective, foreshortened, the rim braided | the far side's sky is bright through a dark geode (that is the exposure match, `match` 0.65) |
| `portals-gate-redwoods-front.jpg` | the redwoods door from the front: the geode live through it, with the geode's dancer (Violet) | |
| `portals-gate-redwoods-steep.jpg` | the redwoods door at 60° | |
| `portals-crossing.jpg` | five frames of the camera crossing the geode door at 18°: 1.4 m, 0.4 m and 3.5 cm before the face, then 3.5 cm and 1 m past it in the redwoods. Geometry continuous, no blur, no flash | mean brightness (0–255) 75.6, 76.6, 76.6, then 71.0, 72.4: a 7 % step at the face |
| `portals-floor-gate.jpg` | the gate in the geode's floor from above at 40°: through it, the redwoods' clearing seen from its sky gate 4.6 m up | dark and soft (the redwoods' ground from above under the canopy, the depth of field again); not much to see |
| `portals-sky-gate.jpg` | the redwoods' sky gate from below: the trunks converging overhead and, through the gate, the geode's dark vault and crystals, looking up | |
| `portals-halfway-geode.jpg` | the walker (`?gates&wander`, `halt`) stopped half way through the geode door, from the geode at 35°: its near half here, its far half (gone through) seen through the disc; the redwoods' dancer behind | reads as one body, as it should |
| `portals-halfway-side.jpg` | the same at 72° | |
| `portals-halfway-cut.jpg` | the same side-on (82°): the walker's geode half ends in a straight cut at the door's plane; beside it the thin disc shows the redwoods | **the clip at the plane, shown** |
| `portals-halfway-redwoods.jpg`, `-side.jpg` | the walker from the redwoods: its front half has come out of the redwoods door, its back half seen through it in the geode | |
| `portals-film-contact.jpg` | four frames round each of the film's four crossings (rows), both directions | see the film |

## The film

`docs/reports/media/portals-film.mp4` (git-ignored like the foundation's film; 20 s at 30 fps, 600 stills of two frames each from
`scripts/steps/portals-film.json`, no sound): the fly path through the geode door into the redwoods and back, twice
each way. `portals-film-contact.jpg` is a contact sheet; `portals-film-luma.txt` (also ignored) the mean brightness of each frame. Mean brightness per frame (`portals-film-luma.txt`): the median change from frame to frame is 0.3 levels; at the
four crossings the changes are 7.5, 8.6, 14 and 12.7 levels (about 10 to 25 %). Looking at the frames, the cause is
that the redwoods seen through the gate (its half-size view) show the light rays in the mist more strongly than the
redwoods seen directly; the geometry is continuous and no frame is dark, flat or blank. One frame at one crossing
shows the arch (a gate seen through the gate) empty for a frame. Larger changes elsewhere (frame 460) are the camera
passing through the redwoods dancer.

## Honest weak points

- **A brightness step at the face**: about 7 % in the stepped round trip, 10 to 25 % in the film (above). The redwoods'
  air (rays in the mist) reads stronger in the half-size gate view than at full size, and this world's air lies over
  the disc; the halo and glows are already faded out at the face. Not fixed: the next thing to do. Matching the gate
  view's air to the main view's (resolution-independent rays) or blending the last few centimetres would close it.
- **One-frame dropouts** of a gate seen through a gate at the moment of a crossing (the slots are reassigned).
- **The gate view is half resolution**, so at the face, when it fills the screen, the far world is softer than it is
  a frame later, and the gem stones in it are 55–100 % of the count. The ripples hide some of it; a view that grew its
  scale with coverage would fix it (weft's 'render'-scaled targets are made once; a second, full-size slot would cost
  memory).
- **Skeleton velocities restart at a crossing** (`skeleton.reset()`): the body's joint speeds read zero for a frame and
  half for the next (a dip in speed glow and shedding, not a spike). `Skeleton.prev` is private; an engine ask for the
  dancers' owner: `Skeleton.carry(m)` to move the last positions too.
- **A dancer's stones that lie far from the gate go with it** (they belong to the dancer): stones it shed on the floor
  of the world it left end up behind the partner gate. A per-particle owner world (or leaving shed stones behind and
  re-homing new ones) is the fix; both are matter-side changes.
- **Dancers arrive tilted through gates that tilt the world** (a wall gate paired with a floor gate): the move is
  rigid by design; righting them is the dancers' business.
- **The glow lighting the near world is additive light**, a halo and a pool on the floor, not a light in the worlds'
  shading (that is `worlds/light.wgsl`, the worlds' file). The worlds could read the gates as lights.
- **The gate on a floor** sits 1.5 cm above it and wins by depth; a world with a hole for it would look better.
- **The camera rig** is an orbit; the crossing works by carrying its target and turning its yaw. In free play the
  camera crosses only when the eye passes the disc; a following camera that swings round beside the gate stays behind
  and looks at the dancer through it (consistent, but not Drake's camera-goes-with-him).
- **The sparkles** ignore `seen` (they show in every world's view).
- **Cost of the shimmer path**: the main scene pass grows by ~0.15 ms with gates on screen even when none is live
  (per-pixel fbm and the ring's segments); fine on the 5090, worth measuring on a phone.

## Not done

- `follow` (a dancer the camera is dragged through the gate with) is a field only: the camera follows a dancer through a
  gate by aiming at its image through the gate (`seen`), and crosses when its own eye does.
- Sparkles and future kinds' `seen`; the matter field (`Field`) is per world in spirit but there's one.
- Locked camera (`?lock`) through a gate: untested.
- No phone timings; no film with sound; `check-portals.mjs` is not in `npm test`.

## Engine asks (camera, dancers)

- `CameraRig.carry(m: Rigid-like)`: move the rig's whole state (target, orbit, locked plane, springs) by a rigid move,
  and accept a roll, so the portals needn't reach into `target`, `yaw`, `pitch`, `height` from outside.
- `Skeleton.carry(m)`: move pos, rot and the private last positions, so a crossing keeps its velocities.
- `PortalDef.up?` in `worlds/world.ts`: the disc's own up (a floor or sky gate needs one); `GateDef` adds it now.
