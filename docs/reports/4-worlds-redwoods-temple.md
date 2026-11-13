# Wave 4: the redwoods and the temple, finished (critique task 7)

Branch `worktree-agent-a4c22b27cee7adb11` (on top of `57483b3`; not pushed or merged).

The redwoods keep their light; their lanterns, boughs, log and gate are finished, and they have a little more life. The
temple keeps its moonrise; its stone, carving, moon, water and ruins are redone, and the drowned court now goes on into
the haze. Everything was rendered on the RTX 5090 through headless Chrome (dev server on port 5428, every capture under
the shared render lock) with `scripts/critic-cap.mjs` and my step file `scripts/steps/rt-worlds.json` (written by
`scripts/steps/rt-gen.mjs`: the critic's world takes under new names, plus the hours, the tides, gem dancers,
`?baseline` and two timing takes). I looked at every still.

Measured: `npm run typecheck`, `npm run build`, `npm test` (all of it: limits, the binding budget, src, audio, portals,
net), stills of both worlds (empty orbits, the locked stage with fire and water, gem dancers, the hours, the tides,
`?baseline` once each), GPU timings before and after in the same session. Not measured: a phone or laptop (the `coarse`
paths are written, never run), sound, a long soak, the camera agent's lock framing with these stages (theirs).

## Timings (RTX 5090, 1280x800, gem dancers, a wide free view, weft's profiler over 150 frames)

The "before" is this branch's base (`57483b3`) checked out into the same dev server in the same session, same take.

| world | before | after | notes |
|---|---|---|---|
| redwoods at dusk (`rt-rw-time`) | frame 1.70 ms: scene 0.78, air 0.40, three live gates 0.17 | frame 1.44 ms: scene 0.86, air 0.38, no live gate | the gate is no longer in this view, so the frame is cheaper; the scene's own draws grew 0.08 ms (new geometry, see below), the air shrank 0.02 |
| temple at moonrise (`rt-tm-time`) | frame 0.34 ms: scene 0.11, air 0.05 | frame 0.47 ms: scene 0.24, air 0.06 | 1.38× the frame (the brief allowed 1.5×) |
| redwoods locked, fire and water (`rt-rw-lock` at 2 s) | 2.96 ms: scene 1.41, gate0 0.37, gate1 0.25, air 0.37 | 2.15 and 2.38 ms in two runs: scene 1.24 / 1.26, air 0.37 / 0.34 | no live gate behind the stage any more (the moves at 2 s differ run to run) |
| temple locked, fire and water (`rt-tm-lock` at 2 s) | not taken (the run was abandoned waiting for the lock) | 1.28 ms: scene 0.75, air 0.05 | |

Timings on a 5090 move by a few per cent between runs.

**Redwoods, per-pixel cost.** Nothing new runs per pixel of the scene except the lanterns' paper (a few dozen pixels)
and the worn path (only within 0.7 m of it: the noise is skipped elsewhere). Savings found and made:

- The air (`woodsAir`): the lanterns' glow read the mist with a noise per lantern per pixel (16 `vnoise2` a pixel); it
  now reads it by the lantern's height, the billows' mean (the same for every pixel). The march's key-light test is
  skipped while there is no key light (between the sun's setting and the moon's rising). Air 0.40 → 0.38 ms.
- The backdrop: the ground past 140 m (behind trunks and mist anyway) is no longer shaded at all.
- The grass's vertex stage: a tuft thinned away by distance no longer pays the loop over the trunks first (same
  picture, fewer loops).
- Not done, and the real lever if the redwoods must get cheaper: the air march is 15 steps × (the canopy noise + 13
  trunks tested) per pixel at full resolution. Marching it at half resolution with a depth-aware upsample (the post
  owner's pass) or testing only the nearest 8 trunks for the shafts would each take roughly a third off the air; both
  change the shafts a little, so I left them for the owner of the post chain to weigh.

The scene's +0.08 ms is the new geometry: the lanterns (5,760 vertices each, from 1,296), the boughs (about 90 short
pieces of 600 vertices), the ferns and fungus on the logs (about 250 instances of 60), sixteen halos, the dust.

## The redwoods

### What changed, and why

- **Lanterns** (`lanterns.wgsl`, `day.ts`). They were uniform discs: a sphere lit evenly from inside. Now: a taller round
  of paper on nine bamboo hoops (the paper pulled in at each hoop and bellied between them, so the silhouette is
  scalloped), twelve panel seams, a dark lacquered lid and foot ring, a slow turn on the cord. Lit from a candle low
  inside: brightest round the flame's height, dim at the lid and foot, warmer and darker at the edge (more paper to
  look through), the flame's hot spot showing through the front, the hoops and seams dark against the glow. A soft halo
  round each lit lantern, as strong as the mist is thick there (a 16-quad draw in the glow phase). The flicker is a
  candle's: slow breathing, a quicker waver, now and then a gutter. Their light on bark, grass and ground was already
  there (`lampLight`) and is unchanged.
- **Boughs** (`stage.ts`). A bough was nine capsules with visible kinks. It is now a polyline smoothed into a curve
  (each corner a quadratic arc), cut every 0.3 m, so no joint shows; it swells into a collar where it leaves the trunk,
  wanders a little off the plane where it isn't a ledge, and tapers to a lifting tip. The ledge spans stay level and on
  the plane (the arcs keep 0.2 m clear of a ledge's ends), so the physics data is unchanged. Moss cushions their tops
  (`trunks.wgsl`), and licorice ferns hang from them (`ferns.wgsl` `vs_epi`). The bark runs on unbroken from piece to
  piece (one turn count and seed per chain).
- **The fallen log.** Its broken end is now hollow: the heart rotted out 1.4 radii deep (real geometry: the end's rings
  pushed in), punky brown at the mouth and black inside. Moss on its top, grey-green lichen down its sides, dark rot
  where it lies in the wet, ferns and shelf fungus down its flanks, and the grass grown long against it.
- **The gate** (`redwoods.ts`). It stood behind the stage's left ledge, so the locked view had a dancer drawn half
  through the disc. It now stands between two trees of the ring on the camera's side (-10.03, 1.35, 5.23), facing the
  clearing, out of the locked view (which looks the other way), with a worn, winding path from it into the meadow (the
  ground trodden to earth, the grass short and bare in places). A bonus: in the locked view no gate is live, which
  took 0.6 ms off the fire-and-water lock.
- **The horizon seam** (`woods.wgsl`). Cause: the backdrop was discontinuous at the horizon. Just below it the ground
  was drawn with its own colour at a huge distance; just above it the sky was the misty far wood at 140 m. The air pass
  hides that, because it fogs both by their distance. But a flame's faint tip writes its own near distance into the
  scene's alpha (the depth contract the critique describes under "The Pool's horizon hole"), so the air pass doesn't fog
  that pixel and the raw backdrop shows through the tip: dark ground below the line, bright mist above it. Fix on my
  side: the far ground now fades to the same far-wood colour and the same 140 m as the low sky, so the raw backdrop is
  continuous across the horizon and there is nothing for a tip to reveal. The root cause (one alpha doing two jobs) is
  task 3's (`src/post`, the depth contract), and the fire's (`fire/draw.wgsl` writing its distance under faint tips).
  Not verified with the fire dancer's original still, which was at 21:36 with a camera I couldn't reproduce exactly; the
  night stills below show no seam.
- **Small life**: fireflies (a third of them) gather round the dancers at night, circling at arm's length; a landing
  (the hips coming down fast and stopping with a foot down) throws a puff of dust round the feet that flies out, slows
  and settles in about a second, lit by whatever light it passes through (`pollen.wgsl` `vs_kick`; the dancers and their
  last landings ride in the redwoods' light slot). The grass already parted under feet and springs back; unchanged.

### Stills (before → after)

| what | before | after |
|---|---|---|
| empty orbit at dusk (the critic's take) | `3-w-redwoods-empty-sheet.jpg` | `4-rw-empty-sheet.jpg` |
| locked, fire and water at dusk | `4-before-rw-lock-sheet.jpg`, `-3.jpg` (and the critic's `3-w-redwoods-lock-*`) | `4-rw-lock-sheet.jpg`, `4-rw-lock-3.jpg` |
| locked, gem dancers | | `4-rw-lock-gems-2.jpg` |
| day, dusk, night, the lanterns close at night, the log's end, the boughs | `4-before-rw-hours-0 … 7.jpg` | `4-rw-hours-0 … 7.jpg` |
| `?baseline` | | `4-rw-base-0.jpg` |
| the timing view | `4-before-rw-time.jpg` | `4-rw-time.jpg` |

The dusk stills keep their light: the same fog, the same warm backlight between the trunks, the same meadow (compare
`4-before-rw-hours-1.jpg` with `4-rw-hours-1.jpg`, and the orbit sheets). What differs is what I meant to change.

### The critique's "Done when", item by item

- *The `w-redwoods-*` sheets re-shot keep their light*: yes (`4-rw-empty-sheet.jpg`, `4-rw-lock-sheet.jpg`).
- *…and lose the ping-pong lanterns*: yes close up and at middle distance (`4-rw-hours-3.jpg`, `4-rw-lock-3.jpg`: ribbed
  paper, lid, warm core, halo). At 15 m and more a lantern is still a round warm glow a few pixels across, which is what
  a paper lantern is at that distance.
- *In the redwoods' lock no dancer stands in front of a disc*: yes, the gate is behind the locked camera
  (`4-rw-lock-*.jpg`, `4-rw-lock-gems-2.jpg`).

### Weak points

- The fallen log reads darker in the locked view than before: moss on its top, the long grass in front of its foot.
  Its bark still shows on its face, but it is less warm. A matter of a few numbers in `bark()` if the art director
  prefers the old warmth.
- The ferns on the boughs are small and read as sprigs from the locked view's distance; the moss does most of the work.
- The dust of a landing is additive (it can only lighten): leaves, which are darker than the light they cross, would need
  an alpha draw. Not done.
- The fireflies' gathering is stateless (they are where a function of the dancers' position puts them), so when a
  dancer leaps, its fireflies leap with it.

## The Tide Temple

### What changed, and why

- **The stone** (`stones.wgsl`). It was a warm pink with large blotches and dark pits all over (the "cardboard"). Now a
  pale limestone, quiet in the large and grainy in the small, with faint bedding, weathered by where the water goes:
  dark grey-green streaks running down from every top and every joint (the rain), the drums of a tall shaft showing
  their joints a metre apart with their own streaks, chipped arrises showing fresher stone (blocks' edges and the
  flutes' arrises), crusts of lichen (ochre and grey-green) only on the dry upper stone, a white line of salt at the high
  tide's mark and a fainter one below, the sea's stain and weed under the low water, and wet stone dark and glossy under
  the water and **drying as the tide falls**: the tide is a cosine of its phase, so for any height the shader knows when
  the falling water last passed it and dries it from then (`templeWet` in `temple.wgsl`; the floor's flags too).
- **Fluting and capitals with real relief.** Drums now have their profile in the mesh: twenty flutes as scallops with
  sharp arrises (120 sides, six a flute; a phone keeps them in the light only), the shaft's slight taper and swell, and
  every whole column a base (a torus narrowing to the shaft) and a capital (an echinus flaring out under the abacus).
  The flutes' light comes from the analytic scallop.
- **Carving that is carved.** The Greek key and the stamped glyph squares are gone from the stones. A carved band is now
  an egg-and-dart moulding in rounded relief under a plain fillet; a carved panel is a raised frame round a roundel with
  an eight-petalled rosette (on wide panels: the altar's front, the far gate's lintel) and lines of a small inscription
  cut in V-section, worn shallow or gone in places. All of it is a height field whose slope bends the light, so it
  reads under a raking light: a low warm light from the afterglow behind the audience (new, modest: `temple.afterglow`),
  the dancers' fire, and the moon's rim. The floor's carved ring stays, worn faint in patches.
- **The light on the stone's fronts.** The fronts face away from the moon, so they were lit almost only by the warm
  dusk term: that was most of the pink. They now have a cool fill from the moonlit sky (`temple.skyFill`) and a paler,
  weaker afterglow, so they are blue-grey stone at night with warmth only where the afterglow or a dancer's fire
  touches.
- **The moon** (`temple.wgsl templeSky`). A soft corona round it (brownish in, bluish out), and a thin veil of cloud
  always somewhere across its face, slowly changing, lit silver through, the disc dimmed behind it; the long streak
  clouds now drift. (I tried the faint 22-degree ice halo as well; it read as a lens artefact and is out.)
- **The glitter path** (`templeScene`). The moon's light on the water as a band of glints from under the moon to the eye:
  the facets of the small waves that tip the moon into the eye, as a Gaussian of the slope the half-vector needs,
  twinkling where the sparkle is fine enough to resolve and smooth further off; blocked where the reflection found a
  stone.
- **Ruins composing the stage** (`layout.ts`). Behind the stage on the left the stump of a column and the column fallen
  from it in three drums, in a broken line toward the altar; on the right a taller snapped shaft and its capital's block
  fallen at its foot. Nothing new stands in front of the stage plane.
- **The drowned court beyond.** Out in the sea past the court's edge, standing on the sea bed with the water round
  their feet: two colonnades running away either side of the moon's path (some whole, most snapped), a far gate under
  the moon (so the near gate frames the moon above a second, hazier gate), broken walls. Drawn in less detail (32-sided
  drums in their own draw), fewer on a phone. The sea haze is a little thicker (`haze` 0.006 → 0.013) so they recede.
- The tide still follows `tideY(beat)` exactly (the water's height is untouched), and the ledges are the same data
  (the lintel columns' shaft is 3 cm thinner and has a base and capital inside the same heights; the ledges' tops and
  spans are unchanged; printed with the ledges in the lock take).

### Stills (before → after)

| what | before | after |
|---|---|---|
| empty orbit (the critic's take) | `3-w-temple-empty-sheet.jpg` | `4-tm-empty-sheet.jpg` |
| locked, fire and water | `3-w-temple-lock-3.jpg`, `3-w-temple-lock-sheet.jpg` | `4-tm-lock-3.jpg`, `4-tm-lock-sheet.jpg` |
| locked, gem dancers | | `4-tm-lock-gems-2.jpg` |
| low tide, high tide, close on the altar, the moon, the west side, the floor | `4-before-tm-tides-0 … 6.jpg` | `4-tm-tides-0 … 6.jpg` |
| `?baseline` | | `4-tm-base-0.jpg` |
| the timing view | `4-before-tm-time.jpg` | `4-tm-time.jpg` |

### The critique's "Done when", item by item

- *The `w-temple-*` sheets re-shot keep their light*: yes, the moonrise is the same sky, moon position and colour; the
  stone is cooler.
- *…and lose the cardboard stone*: mostly. The blotches and pits are gone and the stone is weathered by its water. In
  the moonlit views from the west (the orbit's middle rows) the moon-facing faces are still very pale and flat.
- *…and lose the clip-art glyphs*: yes: no Greek key or glyph squares on any stone; relief bands, roundels and a worn
  inscription instead. The relief reads best close (`4-tm-tides-2.jpg`); from the lock's distance the altar's panel is
  a texture of worn lines, which is what an inscription is at 10 m.

### Weak points

- The carving is in the light, not the silhouette (as before): a block's edge stays straight past its egg-and-dart.
- The far court is all column and wall: no figures, no steps; from the orbit's west side it reads as a field of
  columns rather than a plan.
- The moon-facing faces seen from the west are near white: the moon key is strong and the stone pale. A grade, or a
  lower `moonLight`, would settle it; I didn't change the light.
- The view from out over the sea in front of the court (`4-tm-tides-3.jpg`) has a black band under the court: the
  platform's front and the dark water at night. Unchanged from before; not a view the game uses.

## A composed angle, spawns, a grade

The `grade` hook is not in my worktree, so these are suggestions in numbers (lift / gamma / gain per channel, then
saturation, contrast, vignette), for whoever lands the hook:

- **Redwoods**: lift (0.010, 0.006, 0.004), gamma (1.00, 0.98, 0.96), gain (1.02, 1.00, 0.96), saturation 1.05,
  contrast 1.06, vignette 0.25. Warm, slightly lifted shadows (the mist's glow), highlights held back from yellow, a
  gentle vignette to sit the lanterns and the meadow in the frame. At night, saturation 0.9 and gain (0.96, 0.98, 1.04).
- **Temple**: lift (0.000, 0.006, 0.016), gamma (1.00, 1.00, 1.02), gain (1.03, 1.00, 0.95), saturation 0.92, contrast
  1.10, vignette 0.30. Cool teal-blue shadows (the night and the water), warm highlights (the afterglow, the fire), a
  little less saturation so the stone stays stone, more contrast for the moon's rim on the columns.

Stage angles and spawns: the plane carries `lens` and `height` only (`StagePlane` has no yaw; adding one is the camera
owner's). Redwoods: `lens` 22 and spawns (-1.2, 0), (1.2, 0) kept: two dancers under the high bough, the log and the low
bough either side, lanterns above, nothing in front (`4-rw-lock-gems-2.jpg`). Temple: `lens` 19 and the spawns on the two
broken pillars kept: the moon between the gate's columns, the altar and the lintel between the dancers, the far gate
under the moon (`4-tm-lock-3.jpg`). The most flattering free angles I found: the redwoods from yaw 0.3, 9 m, pitch 0.1,
50° at 19:24 (`4-rw-hours-1.jpg`); the temple from yaw 0, 9 m, pitch 0.12, 50° at low tide (`4-tm-tides-0.jpg`).

## Edits outside my folders

- `src/worlds/light.d.wgsl.ts`: generated by weft's plugin from the new members of `Forest` and `Temple` (light.wgsl
  itself is unchanged: both worlds' structs live in their own folders).
- Every shader that includes `worlds/light.wgsl` gets the same struct change in its generated `*.d.wgsl.ts` when the dev
  server next loads it. I did not commit those in other folders: my worktree's weft is newer (its `Frame` has a
  `jitterNdc` field) and committing them would carry that too. They regenerate by themselves.
- `scripts/steps/rt-gen.mjs`, `scripts/steps/rt-worlds.json`: my step files.
- `docs/reports/media/4-*.jpg` and this report.
- No new assets (everything is procedural), so `docs/ASSETS.md` is unchanged.

## How to see it

`?world=redwoods` and `?world=temple`; `bend.set('redwoods', { hour: 19.4, dayGoes: false })` for dusk, 21.6 for night;
`bend.set('temple', { tideHold: 0 })` low, `0.5` high; new temple params `afterglow`, `skyFill`, `dry`, `glitter`,
`glitterWidth`, `sparkle`, `veil`. Re-shoot: `node scripts/steps/rt-gen.mjs && node scripts/critic-cap.mjs
scripts/steps/rt-worlds.json --url http://[::1]:5428/energybending/ --only rt-rw-hours,rt-tm-tides`.
