# Report 4: fire as a field (the critic's task 1)

Branch `worktree-agent-a6c4ca564a8118527`. Everything below was rendered on the RTX 5090 (headless Chrome, dev server
on port 5421, every capture under the shared render lock) and looked at. Not measured: a laptop, a phone, `?baseline`
in a browser (only the static binding check), anything by ear.

## What I built

**1. Fire as a temperature field in screen space (done).** The flames no longer draw themselves. Per view
(`src/matter/fire/field.ts`, `FlameField`), every living flame is splatted (`splat.wgsl`) as a soft camera-facing
sprite, stretched a little along its motion, into two half-resolution `rgba16float` targets:

| target | r | g | b | a |
|---|---|---|---|---|
| `fire.heat` | temperature | temperature × form | smoke | – |
| `fire.flow` | T × velocity along camera right (m/s) | T × velocity along camera up | T × view distance | – |

One fullscreen composite (`composite.wgsl`) then applies the look **to the sum**: the sum's cores compressed
(`2.2 (1 − e^(−T/2.2))`), the reference's display noise `T (1 − g + 2 g n) − cut` with `n` an fbm on the flame's plane
in metres that climbs and is **carried along the splatted velocity** (a flow map: two phases half a cycle apart,
crossfaded), then the ramp by form:

- form 0, fire: the reference ramp `pow(T, (1, 2, 3.6)) × (1.75, 0.95, 0.6)`, its blue term held under green past
  T ≈ 1.6 (a summed field gets hotter than the 2D fluid did, and the raw ramp turned cores blue-violet).
- form 0.5, **a blue torch** (`field.wgsl torchRamp`): deep blue skin, cyan-white inside, a white cone, sharper tongues
  with half-formed threads. Its own state, not a pink crossfade (`4-fire-morph-05.jpg`).
- form 1, plasma: the reference's ridged filaments (30 × 13 per screen height, as cells per metre), scrolling up fast,
  bent by the display noise, the ~40 Hz flicker, the violet → magenta → white ramp and the violet haze.
- smoke: a soft warm dark grey-brown laid over what is behind (premultiplied), a little lit by the flame, none from
  plasma. Wet flames make it, dry fire a little at the end of its life. **The stretched smoke sprites are gone**, and
  with them the black needles.

Opaque matter hides flames by hand: each splat reads the view's scene alpha (the opaque view distance) where it
lands, adds nothing behind it, and fades out within `soft` (10 cm) in front of it, so a gem heart inside a body of
flame shows through the thin flame in front of it (`4-fire-ember-heart.jpg`). The geode's mirror copy is a second
splat draw of the same flames, flipped about the floor, tested against where its ray meets the floor.

Embers and sparks stay points added into the scene at full resolution (`draw.wgsl`, now only them), shorter (no
needles). Arcs are unchanged in look (`plasma/arcs.*`), but now leave the scene's alpha alone.

**Where it runs.** The splat must come after the view's scene (it reads it), the composite before the air if it can.
Main view and `?pip`: the 'air' stage, declared with the view (kinds declare before the post chain, so these run
before the view's air pass), over `hdr`, so the fog, the Pool's reflection and the depth of field see the fire.
A gate's view: its scene and air run back to back in the 'gates' stage (declared together by the portals), so its
field is declared from the fire's `declarePost` hook at the end of 'gates', over the view's `air`, before the main
scene shows it. Cost of that: no fog on fire seen through a gate, and a gate seen through a gate shows the deeper
view without its fire. Every splat binds the view's `seen` (dancers only in their world, cut at the door, `keep` and
`grow` with the weight divided by `keep · grow²` so the sum doesn't change).

**The depth contract.** No fire, plasma or arc draw writes the scene's alpha any more. `MatterPasses.focus?(view)`
is added in `core/kind.ts` (one line); the fire returns `fire.focus`, an `r16float` the size of the view's field
holding the T-weighted view distance where the sum passes `focusT` (0.4), and **6e4** elsewhere: 1e5 does not fit a
half float (it would be stored as +∞, and a linear filter across ∞ and a distance gives NaN). The lens agent should
treat anything ≥ 1e4 as "nothing to focus on".

**2. The curl (done, modest).** `curl.ts` / `curl.wgsl`: a velocity grid per fire dancer (up to 4; 32 × 64 × 32 cells
of 5 cm, 16 × 32 × 16 of 10 cm on `coarse`), boxed round the hips. Four computes before the flames' step: scatter
(each flame's velocity into 8 cells, heat-weighted, fixed-point atomics), resolve (mean velocity; a cell with little
flame leans to the shared field's wind, the boundary), vorticity (central differences), confinement
(`f = ε h (N × ω)`, capped at `curlMax`). The flames add the push in `sim.wgsl` (plasma takes 20 % of it; past form
0.7 a dancer has no grid). The grid keeps no history: the flames carry the flow and the grid only reads it, so a box
that jumps with a fast limb or a gate crossing loses nothing. That is what makes it robust; the price is that the
curl is the flames' own eddies made tighter, not a fluid with memory. `4-fire-t-curl0.jpg` against
`4-fire-t-curl8.jpg`: with it, the edges throw more side licks; the difference is visible but not dramatic.

**3. Plasma (done).** The same field with its own ramp; thinner splats (×0.55), sparks no longer stretched into a
needle halo (`4-fire-plasma-kick.jpg`, against `3-el-plasma-close-1p2.jpg`), white cores where the threads cross the
dense body. Arcs sit in the composite unchanged.

**4. Kept:** the per-dancer form, `arcs.add`, the fire light uniform, `hear(ears)` (roar, crackle, flare; plasma's
buzz and zap), `carry`, loadout mixing, `handForm`, `flameForm`, `weightOf`, `resize(budget)`, the acts. Flames per
dancer fell from 150,000 to 60,000 (the field is smooth; each splat is weighted by 60,000 over the count, so the look
doesn't change with the count; coarse 24,000).

## Stills (docs/reports/media)

| before (the critic's) | after | what to look at |
|---|---|---|
| `3-el-fire-close-0p3.jpg` | `4-fire-el-fire-close-0p3.jpg`, `-1p2`, `-3p4`, `-sheet` | the same step file (`critic-elements.json`, el-fire-close) at 10 fps: tongues with contours, dark gaps, red tips, a white-yellow core; no rectangle at the horizon |
| `3-el-fire-wide-1p2.jpg`, `-sheet` | `4-fire-el-fire-wide-*` | at 6.2 m: a figure with a hot core |
| `3-el-plasma-close-1p2.jpg` | `4-fire-el-plasma-close-*`, `4-fire-plasma-kick.jpg`, `4-fire-morph-1.jpg` | threads, white cores, an arc, no needle hedgehog |
| `3-el-ember-close-sheet.jpg` | `4-fire-el-ember-close-*`, `4-fire-ember-heart.jpg` | the gem heart shows through |
| `3-filmb-5p6.jpg` | `4-fire-filmb-5p6.jpg`, `4-fire-filmb-3.jpg`, `-sheet` | the clash in the redwoods: no black needles |
| `3-moves-fire-0p95.jpg` (the black smear) | `4-fire-geode-mirror.jpg` | the geode: no smear; the mirror copy (faint) |
| – | `4-fire-gate-through-1.jpg`, `-2.jpg` | fire in a gate's view (the redwoods through the geode's door) |
| `1-morph-0/05/1.jpg` | `4-fire-morph-0.jpg`, `-05`, `-1` | fire, the blue torch, plasma |
| `3-w-forge-lock-sheet.jpg` | `4-fire-time-forge-clash.jpg` | the forge clash staged for timing |

The references at matching scale: `docs/element-looks/01-fire-and-ice.jpg`, `04-plasma-arc.jpg`. My own iteration
stills are in `shots/fire4/` (ignored). Note: the `4-fire-el-*` and `filmb` stills are taken as the critic took them,
with the depth of field on, and the fire is soft in them because the lens does not yet read `focus()` (it focuses by
the scene's alpha, which the fire no longer writes); the `4-fire-*` stills from my own steps have the depth of field off
(`bend.set('post', { dof: false })`) to judge the look.

## Timings (RTX 5090, 1280x800, weft's profiler over 150 stepped frames, depth of field on)

`scripts/steps/fire4-timings.json` (stills `shots/fire4/t1/`). "Before" is the critic's table (`3-critique.md`), taken on
the merged build before this work, not re-measured here.

| scene | before | after | the fire's passes after |
|---|---|---|---|
| one fire dancer close (2.3 m, Pool, the critic's el-fire-close framing) | frame 2.56 ms, scene 2.28 | **frame 0.549 ms, scene 0.072** | fire.splat 0.181, fire.composite 0.008, fire.focus 0.003, curl 0.049 (scatter 0.037, resolve 0.006, confine 0.003, vorticity 0.003), fire.sim 0.006; embers inside `scene` |
| the forge clash, fire and water locked on the forge's ledges (the critic's w-forge-lock setup, 2 s in) | frame 7.15 ms, scene 5.79 | **frame 1.156 ms, scene 0.215** | fire.splat 0.151, curl 0.051, fire.composite 0.006, fire.focus 0.003 (the rest: the lens 0.231, water's splats and smoothing ~0.28) |

The fire's whole cost close up is about 0.25 ms (the splat, at a quarter of the pixels, is most of it), against 2.3 ms
of scene before. The forge figure also contains whatever the other agents' work does not yet change (steam is the
reactions agent's); the black smoke needles, which were a large part of that overdraw, are gone.

## The critique's "Done when", item by item

1. **`3-el-fire-close`-style stills re-shot with the same step file show contours, dark gaps and red tips, side by side
   with `element-looks/01` at matching scale: met, with a caveat.** `4-fire-el-fire-close-*` (the same take from
   `critic-elements.json`, at 10 fps instead of 30: `scripts/steps/fire4-critic-a.json`): tongues with contours, gaps
   between licks, deep red at the edges, a white-yellow core. The caveat: with the depth of field on (as the critic shot
   it) the fire is soft, because the lens still focuses by the scene's alpha, which the fire must no longer write;
   the sharp version is `shots/fire4/d/t-c.png` and `4-fire-ember-heart.jpg` (depth of field off). It lands when the
   lens reads `focus()`. Against the reference, the licks are shorter and less curled than the 2D fluid's.
2. **The wide sheet shows a readable figure with a hot core, facing one way: mostly met.** `4-fire-el-fire-wide-sheet.jpg`:
   a figure, a white core, flames rising off it; which way it faces is readable in the moves, less so standing still.
3. **No black needles anywhere (`critic-film-b.json` at 5.6 s): met.** `4-fire-filmb-5p6.jpg`: the frame is the steam
   bank (the reactions agent's task 5), but no needles; the smoke draw that made them is deleted. `4-fire-filmb-3.jpg`
   is the fire in the redwoods at dusk.
4. **Plasma's halo has no straight needles and its cores are white: met.** `4-fire-el-plasma-close-1p2.jpg`,
   `4-fire-plasma-kick.jpg`, `4-fire-morph-1.jpg`. Sparks are short points now; there are still many of them in a
   kick.
5. **A close fire dancer costs ≤ 1.0 ms of scene at 1280x800 (today 2.28): met.** 0.072 ms scene, ~0.25 ms for all of
   the fire's passes.
6. **Flames in a gate view and in the geode's mirror: met / partly.** Gate: `4-fire-gate-through-1.jpg`, `-2.jpg`
   (the fire dancer walking into the redwoods, seen through the geode's door). Mirror: the copy is splatted and the
   black smear is gone (`4-fire-geode-mirror.jpg`), but the reflection is faint (it only shows where the summed copy
   passes the ramp's cut); `reflect` was raised to 0.8 after that still and not re-shot.

Also asked: the Pool's horizon behind a flame shows no rectangle (`4-fire-el-fire-close-*`); a gem heart shows through
(`4-fire-ember-heart.jpg`); the morph at 0, 0.5, 1 (`4-fire-morph-0/05/1.jpg`: fire, a blue torch, plasma); a kick and
a spin throw sheets of flame (`4-fire-el-fire-close-sheet.jpg`, frames 3, 8 and 12); a still dancer is a torch.

## Weak points

- **Soft under the depth of field until the lens reads `focus()`.** Every main-view still with the lens on is blurred
  by the background's distance. If the lens agent's work doesn't land, the fastest fallback is for the lens to take
  `min(scene alpha, focus)`.
- **The licks are the particles' own, made visible by the ramp and the noise; they are not the 2D fluid's long curling
  tongues.** The curl grid helps the edges; it is not a fluid with memory.
- The core can be one large white mass on the torso close up (the compression keeps it warm white, not blue, but big).
- The display noise is in screen space (anchored to the camera's slide, not to an orbit): on a fast orbit it can be
  seen to swim a little. Not filmed.
- A gate's fire is composited after its air (no fog through a gate), and a gate seen through a gate shows its fire
  late (the deeper view without it).
- `drySmoke` makes a faint grey column above a still dancer; on the Pool's black it reads as a slight haze.
- Not run: `?baseline` in a browser, `coarse` in a browser (16 × 32 × 16 grids, 24,000 flames), a phone, a laptop.

## Edits outside my folders

- `src/matter/core/kind.ts`: the one line `focus?(view): Texture | null` on `MatterPasses`, written with inline
  `import()` types so it stays one line (the other two agents' copy may be spelled differently: merge by hand if so).
- `scripts/steps/fire4-*.json`: my step files (pool, tune, views, timings, critic-a, critic-b).
- `docs/reports/media/4-fire-*.jpg`: the stills.
- Not committed, in `shots/` (ignored): `vite.fire.config.ts` (the project's config with HMR off, so edits don't reload a
  capture waiting on the lock) and `critic4-cap.mjs` (a copy of `scripts/critic-cap.mjs` writing `4-fire-*` instead of
  overwriting the critic's `3-*`). A `node_modules` junction to the main checkout's was made in the worktree (ignored),
  because `check-bindings.mjs` resolves weft from the working directory.

## Branch

`worktree-agent-a6c4ca564a8118527`, not pushed or merged.
