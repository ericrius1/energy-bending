# Report 4: gems and the mixed hearts (the critique's task 8)

Branch `worktree-agent-aee50be5de0d1ef59`. Everything below was rendered on the RTX 5090 through headless Chrome under
the shared render lock (dev server on port 5433; the "before" stills from a second server on 5434 serving an export
of the base commit `57483b3`, so before and after are the same step files on the same machine). Stills are in
`docs/reports/media/4-*` (`4-before-*` and `4-after-*`; the role and macaco "before" sheets are
`4-g-mo-role-before-sheet.jpg` and `4-g-mo-macaco-before-sheet.jpg`). The step files are `scripts/steps/gems-*.json`,
written by `scripts/steps/gems-gen.mjs`, and run with `scripts/critic-cap.mjs` (whose outputs, named `3-<take>`,
were renamed to `4-...`). Not measured: phones, laptops, anything by ear, a long soak.

## What I built

1. **Large crystals: a second scale of gem body** (`gems/shapes.ts`, `gems/crystals.ts`, `gems/crystal.wgsl`).
   The shapes are built in JS at load (no Blender): a long hexagonal prism with pointed ends (two variants), a cluster
   of small prisms for a hand or a foot, a **great geode** for the torso (a rough shell cut open at the front, a flat
   polished banded rim, a hollow lined with 90 small crystal points whose glow is strongest deep inside), and an
   **oval brilliant cut** for the head, its table facing forward. A gem layer wears them with `params.crystals`
   (`1`: every part it covers; `'torso'`: the geode and the hips only). Each crystal is placed and scaled from its
   capsule (the rig's rest offsets and the capsule radii), rides its bone on a small implicit spring (CPU side, a few
   dozen per body: `crystalSpring` 450, at most `crystalLag` 0.05 m behind), and is drawn with one instanced draw per
   shape. The shading is the stones' with more: light refracts in with 2.4 times a stone's dispersion, bounces off
   two far facets, is tinted by how deep it went (Beer's law over the crystal's thickness), sharper facet glints, a
   core glow, and the minerals' traits. While a crystal stands, the small stones under it are hidden on the body (the
   cull skips them). **It cracks** at a strong peak on a limb it covers (a kick at full stretch, `crackAt`) or when the
   body shatters: it vanishes, 35 % of its stones burst off as shards, onward with the limb, and the rest show as
   small stones; after `reform` (about 1.5 s) it grows back, flashing, as the stones come home. Between dances (the
   stones down) the crystals are down too and re-form feet first after the rise.
2. **Hearts** (`gems/hearts.wgsl`, `gems/hearts.ts`, `gems/halo.wgsl`). Every dancer whose torso is gems has a heart:
   a glowing sphere at the chest (strong in a mixed body, a quiet glow in an all-gem body), beating softly on the
   music's beat. The gems light their own stones and crystals with it (the geode's hollow fills with it) and draw a
   soft additive halo in front of it in the glow phase, so the heart reads close and as a glow at game distance. The
   hearts live in one uniform per kit, which fire, water and ice can bind (below).
3. **Fast motion** (`gems/motion.ts`, `core/body.wgsl` opt-in, `gems/sim.wgsl`).
   - Each home now moves exactly with its bone: the joint's velocity plus ω × r (ω read off the skeleton's
     rotations on the CPU each frame), so spins and rolls no longer drag the body sideways through the damping term.
   - `BodyStep.hold` (gems 1, every other kind 0): on the body the spring is up to 8 times stiffer **along** the limb's
     travel than at rest and only 2.5 times stiffer across it, it is fed the bone's acceleration (linear and
     centripetal) as the limb goes fast, and a stone never trails its home by more than `trailCap` (0.16 m slow, a
     third of that fast). Slow dance keeps its lag; fast limbs hold together.
   - Returning stones fly home in the body's moving frame under hold (matched to its velocity quickly, never more than
     0.3 m behind when it is fast, and home within 10 cm), so a roll or a jump doesn't leave a comet of stones.
   - **Bursts instead of a leak**: speedShed's steady leak at speed is cut to 6 % (`leak`); a limb end that was fast
     **relative to the hips** and starts to slow (a kick's peak), or a hand or foot that stops hard (an impact), throws
     7 % of that capsule's stones (`burst`), onward with the limb but with only half of the whole body's velocity (a
     jump's apex is not a peak, and shards thrown at a jump's full speed hung above it as a column). A capsule rests
     0.7 s between bursts. A peak strong enough cracks a crystal instead.
   - **Landing squash**: the hips stopping a fall squash the body towards the ground (stones and crystals) on a
     damped 4 Hz spring.
4. **Spare stones**: spares (stones nobody wears now) fade in 1.2 s instead of 2.5, draw no streaks, and once faded
   are **parked**: no longer simulated, culled or drawn (`simulated` goes to 0 in `bend.stats().matter.gems`, checked:
   15,000, then 0 after 1.6 s with a fire dancer). A later dance takes them back as before.
5. **Minerals** (`gems/minerals.ts`, `gems/specimens.ts`). Each mineral has a stronger personality and a trait:
   amethyst (deep violet, glows from inside), citrine (honey gold, warm light, more fire), emerald (deep green, a little
   cloudy, dense), **obsidian** (black glass, oily sheen, **cracks that glow like embers** and breathe), **opal** (new:
   milky blue-white with cells of spectral colour that change as it turns), clear quartz (water-clear, most fire of the
   quartzes), rose quartz (milky pink, soft), **iron** (new: gunmetal with patches of rust and orange glints in the
   rust). Per-mineral dispersion (`disp`) multiplies the look's. Opal and iron borrow the rose and pyrite shapes: the
   specimen loader copies a shape's vertices with the copy's own draw number, so a new mineral needs no Blender. 13
   specimen kinds of 32. Each mineral names a one-mineral suite; `Mosaic` mixes nine.
6. **Presets** (`core/presets.ts`): `monolith` (all large crystals, one mineral: the suite's first), `geodeheart` (the
   great geode torso inside fire limbs; `geodeheart-water` in water), `mosaic` (many minerals, small stones), `single`
   (small stones, one mineral), and `single-<mineral>` / `monolith-<mineral>` for the eight minerals; the mixed
   `ember` (heart 1.2), `gemwater`, new `gemice`, `tide` (now with a small celestite heart in its water, so it has a
   heart to show) and new `all` (a geode heart and cut-stone head, fire arms, water legs, ice hands and feet).

## Stills (before and after)

| what | before | after |
|---|---|---|
| ember close / wide (the Pool) | `3-el-ember-close-sheet.jpg`, `3-el-ember-wide-sheet.jpg` (the critic's) | `4-after-g-el-ember-close-0p3.jpg`, `-1p2`, `-sheet`; `4-after-g-el-ember-wide-1p2.jpg`, `-sheet` |
| geodeheart close / wide | `3-el-geodeheart-close-sheet.jpg`, `-wide-sheet` | `4-after-g-el-geodeheart-close-*`, `4-after-g-el-geodeheart-wide-*` |
| tide close / wide | `3-el-tide-close-sheet.jpg`, `-wide-sheet` | `4-after-g-el-tide-close-*`, `4-after-g-el-tide-wide-*` |
| presets close in the geode | — | `4-after-g-el-{monolith,geodeheart,mosaic,single}-geode-close-*` |
| presets close in the redwoods at dusk | — | `4-after-g-el-{monolith,ember,tide,geodeheart}-redwoods-close-*` |
| monolith mid-kick, cracking and re-forming | — | `4-after-g-mo-monolith-kick-sheet.jpg`, `4-after-g-el-monolith-redwoods-close-2p4.jpg` (mid-aú, shedding) |
| rolê (classic body) | `4-g-mo-role-before-sheet.jpg` | `4-after-g-mo-role-classic-sheet.jpg` |
| macaco (back handspring) | `4-g-mo-macaco-before-sheet.jpg` | `4-after-g-mo-macaco-classic-sheet.jpg` |
| a jump and its fall | `4-before-g-mo-jump-classic-sheet.jpg` | `4-after-g-mo-jump-classic-sheet.jpg` |
| armada | `4-before-g-mo-armada-classic-sheet.jpg` | `4-after-g-mo-armada-classic-sheet.jpg` |
| a fire dancer alone after a gem dance | `4-before-g-spares-fire-*` | `4-after-g-spares-fire-*` |
| a water dancer the same | `4-before-g-spares-water-*` | `4-after-g-spares-water-*` |
| each mineral (monolith turntable, 8 frames) | — | `4-after-g-min-<mineral>-sheet.jpg`; all eight: `4-after-g-minerals.jpg` |

What I saw:
- **ember**: the citrine heart is a gold glow through the flame close and a gold spot at 6.2 m (it was gone inside the
  fire before). The head's stones show as embers. **geodeheart**: the torso is a violet glow with the geode's rim and
  hollow visible close; a violet spot at game distance; in the geode world the faceted shell and the cut rim read.
  **tide**: the celestite heart is hidden by the water surface (the water's composite draws over the scene after it),
  so it does not show yet: that needs the water side (below).
- **monolith**: a body of faceted prisms, a geode chest and a pointed head; a kick cracks the shin and foot crystals
  into a spray of small stones that come back and grow the crystal again; reads as a crystal dancer.
- **rolê and macaco**: the body stays a body; before, the rolê left a long ribbon of streaking stones along the floor
  and the macaco ended in a burst of streaks. A low cloud of loose stones still follows the rolê.
- **The jump**: the column of stones over the falling body is mostly **the trail post** (`post.trailFx`, 0.2 with
  decay 0.75: a screen-space after-image, the critic's "trail post ghosts fast moves"): with `trailFx` 0 the column is
  mostly gone (probe, not committed). The gems' share of it (shards hanging above, returning stones lagging) is fixed.
- **Spares**: the dark needles on the floor and in the flame are still there after the spares are parked
  (`simulated` 0), so **they are not the gems'**: they are the fire kind's (its smoke and ember sprites), as the
  critic suspected.
- **Fire and water are unchanged** by the body.wgsl edit: `4-before-g-spares-{fire,water}-1p5.jpg` against
  `4-after-...` (the same frames; small differences are the simulation's own randomness). Every new path is behind
  `BodyStep.hold > 0` (gems only) and `Goal.acc` is zero for kinds that don't fill it.
- **Minerals**: eight distinct bodies; obsidian's ember fractures and opal's play of colour read best; iron reads as
  rusty bronze more than dark iron.

## Timings (RTX 5090, 1280x800, weft's profiler over 150 stepped frames, two dancers in the geode)

| scene | GPU frame | scene pass | gems.sim | gems.cull |
|---|---|---|---|---|
| two classic gem dancers, before | 0.545 ms | 0.209 | 0.007 | 0.010 |
| two classic gem dancers, after | 0.487 ms | 0.219 | 0.009 | 0.008 |
| a monolith pair | 0.407 ms | 0.108 | 0.009 | 0.004 |
| mosaic and single | 0.510 ms | 0.234 | 0.008 | 0.008 |

The crystals are cheaper than the stones they hide. The CPU side (motion, crystals, hearts) is a few hundred joints
and a few dozen springs a frame; not measured separately. Bindings: the gems' sim is now 8 of 12 uniform buffers (the
Motion uniform), storage unchanged (7 of 8); `npm test`'s binding check passes.

## What fire and water (and ice) must read for hearts to show

Include `src/matter/gems/hearts.wgsl` in the draw, declare `@group(1) @binding(n) var<uniform> hearts: Hearts;`, and
bind `hearts: heartsOf(kit)` (from `src/matter/gems/hearts.ts`; one uniform buffer, zeros when no one has a heart):
- `heartVeil(hearts, wp, frame.camPos)`: 1 … ~0.15. Multiply the flame's (or splat's, or shard's) brightness and alpha
  by it. It is below 1 only for a point between the camera and a heart, within about two heart radii of the line of
  sight to it, so the flame in front of the heart thins and the rest is untouched.
- `heartLight(hearts, wp)`: the hearts' light (linear rgb, already × strength), falling off over a few radii. Add a
  share of it to the colour of the matter round the heart (fire: tint the flame; water: light its surface).
- `heartDepth(hearts, d, cam, fwd)`: dancer d's heart along the camera's forward axis (the scene alpha's distance), for
  a pass that tests against the depth it reads (the water's surface composite, which draws after the scene).
- `Hearts.h[d].at` (centre, radius; radius 0: no heart) and `.glow` (colour, strength with the heartbeat) are there for
  anything else.
The water side matters most: tide's heart is under the water surface and shows only once the surface thins over it.

## The critique's "Done when", item by item

- **"el-ember, el-geodeheart and el-tide re-shot show the heart clearly at 2.3 m and as a glow at 6 m."** ember: yes
  (`4-after-g-el-ember-close-0p3.jpg`, `4-after-g-el-ember-wide-1p2.jpg`). geodeheart: yes
  (`4-after-g-el-geodeheart-close-*`, `-wide-*`). tide: **no**: tide had no heart; it now has one, but the water surface
  covers it until the water draw honours `heartVeil` (and my halo is drawn in the scene, under the surface).
- **"the heart emits (fire dims where it overlaps the heart)"**: the heart emits and lights its stones and crystals;
  the fire dimming is the fire agent's, through `heartVeil` above. Not done on their side yet (not my folder).
- **"the geode heart is a real faceted geode"**: yes, a large crystal geode with a cut rim and a lined hollow; the
  hollow faces forward, so from behind it is a rough grey shell.
- **"stops drawing its spare stones as streaks when nobody wears gems"**: yes (no streaks for spares, a 1.2 s fade,
  then parked); the remaining needles are fire's.

## Weak points

- The crystals' refraction reads more like faceted coloured glass than deep gem crystal: the colour is a little flat
  and saturated (citrine and emerald most). The large crystals' arms often show as small stones in the turntables
  (a crack from the loadout change's motion), and the head's cut stone is small next to the geode.
- Bursts are tuned by eye on the armada, rolê, macaco and jump; the impact threshold (140 m/s²) comes from mocap
  velocities smoothed by half, and a different clip library may need retuning (`peakSpeed`, `impact`, `burst`).
- ?play still sets the gems' stiffness to 700 (`src/dancer/play.ts`), which makes the hold mostly redundant there and
  takes away the slow lag in play; with the hold, 250 to 300 should be enough. That is the dancers agent's file.
- The trail post is the main cause of the jump's column (not mine). The halo is clipped by the Pool's known horizon
  rectangle like everything else in that world.
- `heartVeil` is not used by anyone yet; tide's heart does not show until the water draw takes it.
- Wide (6 m) presets in the geode and the redwoods were not shot (only close there; wide in the Pool for the three
  hearts). No phone or `?baseline` run of the crystals.
- Iron reads as rusty bronze; it wants a darker base and less rust coverage.
- The full `npm test` passed once in this session after the core changes; the last run's net tests failed only on
  `EADDRINUSE 127.0.0.1:5418` (another worktree's test server on the fixed port); every other suite passed.

## Edits outside `src/matter/gems/`

- `src/matter/core/presets.ts` (allowed): the new presets.
- `src/matter/core/body.wgsl` (allowed): `Goal.acc`, `spring2`, `holdStep`, the RETURNING hold branch, all behind
  `BodyStep.hold > 0`.
- `src/matter/core/particle.wgsl`: `BodyStep`'s three pads became `hold`, `trailCap`, `pad0` (the struct is where the
  body's params live; same size, other kinds leave them 0).
- Generated typings regenerated by weft's plugin because `BodyStep` and `Goal` changed: `*.d.wgsl.ts` beside every
  shader that includes `core/body` or `core/particle` (core, field, fire, ice, reactions, water, worlds/redwoods
  grass, worlds/water ripples). Only the renamed fields differ.
- `docs/extending/matter-kind.md`: the hold opt-in, the hearts contract, the preset list.
- `scripts/steps/gems-gen.mjs` and `scripts/steps/gems-*.json` (my step files).
