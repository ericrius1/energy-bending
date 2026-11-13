# Wave 6, task 2: water that looks like water (and ice that inherits it)

Task 2 of `docs/reports/6-critique.md`. Owner: `src/matter/water/`, `src/matter/ice/`. Branch:
`worktree-agent-acda034a90fcf784c`. Everything below was rendered on the RTX 5090 through headless Chrome against a dev
server on port 5452 (`scripts/critic-cap.mjs`, the shared render lock, each run well under a minute of rendering;
most of the wall-clock time was waiting for the lock). I looked at every still named here. **Not looked at:** a laptop
or a phone, anything by ear, fire seen *through* water after the post agent's change (not in my branch), the release's
puddle sheet after a fusion, the `?pip` inset, a long soak.

## The verdict in five lines

1. The cyan outline is gone, in every world: no term of the shading depends on "thin" any more except absorption.
   Water is now clear matter lit by its world: you see the temple's columns and the redwoods' grass bent through it,
   the moon and the fire in its highlights, and a warm rim on the side that faces the fire (`7-ba-el-*.jpg`).
2. It reads as water at a glance in the temple and at game distance on the Pool (`7i-lock-pool-sheet.jpg`); it is
   **weakest at dusk in the redwoods**, where a clear body in front of bright fog is faint (by physics: there is little
   to refract and nothing dark to reflect), and in the Pool and the geode, where it still leans toward glossy glass.
3. The outline breaks: the outer shell curls a few centimetres, a fast limb leaves ribbons that hang and fall, drips
   gather under the hands and chin, and the edge's lookup is pushed by a climbing curl noise so the silhouette is never a
   smooth capsule contour. It is not yet the reference's flame-like curling wisps (`09`): it reads as poured, splashing
   water, which is closer to the brief ("sheds and streams") than to `09`.
4. Ice inherits it: no constant-width white outline, frost only on edges that face up and on hands, feet and head,
   facets that reflect their own part of the world, cells of their own blue (`7-ba-el-ip-redwoods-close.jpg`). It is
   now closer to `02`'s pale ice than before.
5. Cost: +0.04 ms for a close water dancer at 1280x800 (1.03 ms), +0.10 to +0.12 ms of water passes at 1080p.

## What I changed, and why

### The surface: lit, not glowing (`water/surface.wgsl`, `water/params.ts`, `water/pool.ts`)

The critic found five causes (6-critique "Elements", Water). Each, and what replaced it:

| cause (6-critique) | now |
|---|---|
| (1) a rim `rim × (1 − smoothstep(0.22, 0.62, Wr))` wherever thin: the constant-width cyan band | removed. The rim is `key.col × (1 − n·v)^4 × [n faces the key]` plus each fire's (`fireSpec`): only on the side a light comes from, its colour the light's. Fresnel is held back at the outline (`cosV` floored at 0.32 to 0.67 by a noise), because at full grazing every outline pixel mirrors the same horizon and the band comes back (seen in the Pool: `7ab-*`, A/B'd) |
| (2) the body emissive (`glow` 1) | the body's own light is a caustic at `glow` 0.12 (enough to read on the Pool's black, far below the fire). What it shows is: the scene behind, refracted and absorbed; the world reflected (`worldEnv`) by Fresnel; the key's highlight (sharp and broad), each fire's highlight; light scattered inside (a little milk: the world's ambient at 6 %, its key, the fire, a gem heart; compressed so a close fire tints it rather than turning it into a lit solid) |
| (3) `opacity` 0.85, `refract` 0.02 | what shows through is `exp(−absorb × W) × (1 − milk) × (1 − F)`: per channel, red first, so thin water lets about 70 to 80 % of the world through and thick water turns it deep blue-green, not flat blue; `refract` 0.12, bending more at the edges and by thickness; `dispersion` 0.05 |
| (4) the silhouette only smoothed capsules | below, "a silhouette that breaks" |
| (5) highlights from a light fixed to the view | from the world's key (`worldKey`) and each fire light's position (`worldLight.fire`); the view-fixed light is a weak fill (0.25, power 80) |

Also: the surface's normal takes the depth's normal only half way where thick (`depthNormal` 0.5): the narrow-range
filter leaves terraces in the depth where an arm crosses the body, which read as flat rectangles on a glossy surface
(A/B'd in `7ab-*`); small waves riding the bone tilt the normal (`ripples` 0.12), so highlights break and the world
seen through it wobbles. The new parameters: `deep` (what one unit of W lets through), `milk`, `opacity`, `tint`,
`glowColor`, `glow`, `rim`, `rimStrength`, `rimSharp`, `ripples`, `rippleScale`, `depthNormal`, `wisp`, `curl`, `tear`,
`wispScale`, `climb`; `thin` is gone. The `Surf` uniform changed accordingly.

### A silhouette that breaks

- **In the motion** (`water/sim.wgsl`, `water/water.wgsl`): the outer shell (`place.w` > 0.75) is pushed by a flow a
  few centimetres across that climbs the body (`shellCurl` 2.2 cm, ×2.5 on a fast limb's trailing side); a fast
  limb's trailing outer water is left hanging for 0.12 to 0.37 s where the limb was (`streamers`: FROZEN, splatted at
  0.85 of the body's size so it is a ribbon of the surface, not spray), then falls and flies home; drips gather under
  the outer shell's undersides (the hands, the chin, an elbow held out: the drip rate × `0.15 + 4·under³`). A limb that
  stops fast throws its shed water on past it (that was already true: shed drops keep the limb's velocity).
- **In the surface** (`edgeAt` in `surface.wgsl`): near the outline (thin water and just outside it; not thick water
  and not ice) the lookup is pushed by a curl noise on the body's plane, in metres at its distance with the camera's
  slide taken out (as fire's composite does), climbing (`climb` 0.5 m/s) and carried back from the bone's motion;
  tongues reach up and back (`wisp` 3.5 cm), thinning as they go; thin water tears where the noise is low (`tear`).
  Pixels outside the water look for water within 5 % of the screen's height on three rings before giving up.
- **Spray and surface together:** drops are dimmer and take a compressed share of the key (`drops.wgsl`), so a
  shower of drips is a glitter, not rain; streamers are part of the surface.

### The puddle

Water lying on the floor (not on a capsule, within 1.2 to 4.5 cm of it) is a puddle: the floor seen through it
darker and colder, the world reflected in it by Fresnel (compressed, so the moon in it is a glint, not a white disc),
the key's highlight, the fire's, and at its edge a meniscus: the normal tilts out where the film thins, catching the
light. It no longer depends on the reconstructed normal facing up (that is what turned its edge into the cyan band of
the lozenge). On waking it gathers and rises feet first as before (`7i-puddle-sheet.jpg`).

### Ice (`surface.wgsl`'s ice half, `ice/params.ts`)

No band: the facets turn on the depth's normal almost to the outline (ice is hard: its outline doesn't round off), and
each cell has its own depth of blue (a pale one beside a navy one) instead of the colour following thickness. Each facet
reflects its own direction of the world and is lit by the key, the fire and the ambient as it is turned; the dark
facets stay. Frost (`ice.rim`, reused) only where it forms: edges facing up and the hands, feet, head (and half on the
shins and forearms), broken by grain. `ice.opacity` 0.8 (the world shows faintly through). Set ice is the same surface,
so a bridge has frost along its top and none underneath (`7i-bridge-0p4.jpg`).

### Hearts (`tide`)

`heartVeil` now clears the water in front of the heart toward plain transmission (0.85 to 1), `heartLight` is in the
light scattered inside at 40 %, and a little added where the veil is. And a fault in the sim made `tide`'s whole body
freeze: its own ice hands and feet are cold in the field, and the freeze threshold only discounted the dancer's
*form*. It now also discounts the dancer's own ice share (`colds` in `WaterSim`), so `tide` is liquid with ice hands
and feet, and the chest shows the celestite and its glow (`7i-tide-1.jpg`). Water beside an ice *dancer* still freezes.

### What the post agent needs for fire seen through water

The air adds the glow target (fire's light) over the whole merged scene, so a fire behind a water body is added on top
of it. The water now provides, for the main view and `?pip`, a **veil** texture (`WaterPasses.veil(view)`, from
`WaterSurface.veil`; rgba16float, the size of the water's targets, written by `fs_focus` in the same pass as the
focus): **rg** the bend in uv at that pixel, **b** how much light behind the water comes through (0 … 1, the luma of
its absorption and milk; ice's opacity where frozen), **a** the water's view distance (1e4 where there is none). To
apply it in the air: where the glow's distance (the fire's focus) is further than `veil.a`, read the glow at
`uv + veil.rg` instead of `uv` and multiply it by `veil.b`; where the glow is nearer, leave it. It is not on
`MatterPasses` (only this pool has it): find it with `'veil' in passes` on the water kind's passes. I did not touch
`src/post`.

## Before and after (the critic's takes re-shot, `--prefix 7`; before = the critic's `6-*`)

| take | before | after | side by side |
|---|---|---|---|
| fire and water, redwoods at dusk (`el-fw-redwoods-close`) | `6-el-fw-redwoods-close-1p2.jpg` | `7-el-fw-redwoods-close-1p2.jpg`, sheet `7-el-fw-redwoods-close-sheet.jpg` | `7-ba-el-fw-redwoods-close.jpg` |
| two water dancers, temple (`el-water-solo-close`) | `6-el-water-solo-close-1p2.jpg` | `7-el-water-solo-close-1p2.jpg`, sheet | `7-ba-el-water-solo-close.jpg` |
| fire and water, temple (`el-fw-temple-close`) | `6-el-fw-temple-close-sheet.jpg` | `7-el-fw-temple-close-sheet.jpg`, `-1p2.jpg` | |
| plasma and ice, redwoods (`el-ip-redwoods-close`) | `6-el-ip-redwoods-close-1p2.jpg` | `7-el-ip-redwoods-close-1p2.jpg` | `7-ba-el-ip-redwoods-close.jpg` |
| film 2's dolly in the temple at 3.6 s, beside the fire (1920x1080) | `6-film2-dolly-3p6.jpg` | `7-film2-dolly-3p6.jpg`, sheet `7-film2-dolly-sheet.jpg` | `7-ba-film2-dolly-3p6.jpg` |
| film 1's rise in the redwoods at 3 s (1920x1080) | `6-film1-rise-3.jpg` | `7-film1-rise-3.jpg`, sheet `7-film1-rise-sheet.jpg` | `7-ba-film1-rise-3.jpg` |

(`7-film1-rise-*` and `7-el-ip-redwoods-close-*`, `7-el-fw-temple-close-*` were shot with the water's own light at
0.12; the rest, and my final checks, at 0.18, the value committed. The difference is small: a slightly brighter
body on black.)

What I see in them: the uniform cyan outline is gone in every one. In the redwoods the water is a clear, faintly blue
body; the grass and the trunk show bent through it; the side toward the fire carries the fire's warm highlights and
rim, the other side the dusk sky's. In the temple the body is blue-green glass in which the columns and the water
behind are seen bent; the moon makes a rim on its far edge and the fire a gold one on the near edge. At film 2's
distance it is a translucent blue figure beside the fire, quieter than the fire, which is what the brief asked. The
asleep heap at film 1's 3 s is a translucent puddle gathering and rising, not a lozenge.

My own takes (`scripts/steps/water-7-gen.mjs` → `water-7.json`, `--prefix 7i`), all looked at:
`7i-fw-{temple,redwoods,pool,geode}-*.jpg` (fire and water in four worlds, at rest, a kick, an aú),
`7i-solo-moves-sheet.jpg` (rest, armada, spin: streamers and the spin's spray), `7i-freeze-sheet.jpg` (0, 0.5, 1),
`7i-ice-redwoods-*.jpg`, `7i-puddle-sheet.jpg` (asleep, then the rise), `7i-tide-1.jpg`, `7i-lock-pool-sheet.jpg`
(the locked game view), `7i-bridge-0p4.jpg` (set ice), `7i-door-0p8.jpg` (a water dancer before the geode's live door).
The A/Bs that decided the Fresnel floor, the milk and the depth normal are `7ab-ab-*.jpg` (`water-7-ab.json`; the
file holds the last variants run).

## Timings (RTX 5090, 1280x800, weft's profiler over 150 stepped frames, `scripts/steps/water-7-timings.json`)

Before = this branch's base (`d070f8d`, the critic's), run on the same server in the same session before any change
(`shots/w7-before/timings.jsonl`); after = the final code (`shots/w7-after2/timings.jsonl`). Frame totals move by
±0.05 ms from run to run with other agents on the GPU (the gems-only scene read 0.58 and then 0.91 ms with no water in
it), so the water's own passes are the better comparison.

| scene | frame before → after (ms) | water's passes before → after (ms) |
|---|---|---|
| one water dancer, 2.3 m, Pool (`t7-water-close`) | 0.994 → 1.031 | surface 0.070 → 0.092; splats 0.185 + 0.103 → 0.182 + 0.101; smoothing 0.21 → 0.21; focus (+ veil) 0.004 → 0.007; sim 0.013 → 0.014 |
| two ice dancers, 3.6 m (`t7-two-ice`) | 1.127 → 1.144 | surface 0.058 → 0.095; all water passes 0.52 → 0.56 |
| two gem dancers, the same staging (`t7-two-none`) | 0.583 → 0.914 (noise: no water drawn) | none |
| fire and water, redwoods at dusk, 2.6 m (`t7-fw-redwoods`) | 2.258 → 2.328 | surface 0.064 → 0.112; the rest unchanged |

So: a close water dancer is about 1.03 ms (the brief's "about 1.0"); the composite costs +0.02 to +0.05 ms (the edge's
search round every pixel near water, the fire lights' highlights); two ice bodies cost +0.54 ms over gems before and,
counting the same passes, about +0.57 after (the gems run after the change was disturbed, so I take the pass sums).
An earlier version of this work cost +0.11 ms in the composite (0.18); computing ice only where something is frozen,
water only where something is liquid, two search rings instead of three and the capsule vote only on the water
brought it back.

**1920x1080** (the critic's `t-temple-pair` and `t-redwoods-pair` from `critic6.json`; before = the critic's own run,
`shots/critic6/timings.jsonl` in the main checkout, same code as my base; after = `shots/w7-1080/timings.jsonl`):

| scene | frame before → after (ms) | all water passes before → after (ms) | the composite (`water.surface`) |
|---|---|---|---|
| temple, fire and water, 4 m | 1.954 → 2.222 | 0.650 → 0.769 (+0.12) | about 0.07 → 0.181 |
| redwoods at dusk, fire and water, 4 m | 2.889 → 3.231 | 0.643 → 0.740 (+0.10) | 0.071 → 0.158 |

Water costs +0.10 to +0.12 ms at 1080p (the "≤ 0.2 ms more" is met). The whole frames rose more than the water did
(+0.27, +0.34): the critic's run and mine are different sessions with other agents' work on the GPU, and I did not
separate the rest; the water's passes are what this branch changed. Still under the 3.3 ms the critic gave for every
film scene.

## The critique's "Done when", item by item

Water (6-critique, "Water: what to change", Done when):

| item | met? | evidence and why |
|---|---|---|
| `el-fw-redwoods-close` and `el-water-solo-close` re-shot show no constant-width outline | **met** | `7-ba-el-fw-redwoods-close.jpg`, `7-ba-el-water-solo-close.jpg`, both sheets: no term of the shading is keyed to "thin" any more except absorption; the rim is only toward a light |
| a body whose highlights move with the world's light | **met** | highlights and rim come from `worldKey` and each fire light's position: the moon's rim on the far side in the temple, the fire's gold on the near side (`7-el-fw-temple-close-sheet.jpg`, `7-film2-dolly-3p6.jpg`); the view-fixed light is a 0.25 fill |
| the background seen through it | **met** | the columns and the court bent through the bodies (`7-el-water-solo-close-1p2.jpg`), the grass and a trunk in the redwoods (`7-el-fw-redwoods-close-1p2.jpg`) |
| an edge that breaks into wisps in at least half the frames | **partly** | in the kicks and the spin the edge streams (ribbons, a torn trailing edge, the spin's spray: `7i-solo-moves-sheet.jpg`, `7-el-fw-redwoods-close-sheet.jpg` last row); at rest the outline is irregular and curling but these are not `09`'s long flame-like wisps. Counting frames of `7-el-water-solo-close-sheet.jpg` where the outline has a visible break or tongue, I count about half; in the rest it is lumpy, not smooth, but whole |
| beside the fire in `film2-dolly` at 3.6 s it reads as the same quality of matter | **met, by my eye** | `7-ba-film2-dolly-3p6.jpg`: both are lit by the same moon and the same fire; the water is quieter than the fire, as the brief wants. The fire behind it still adds through it (post agent) |
| water costs ≤ 0.2 ms more than today at 1080p | **met** | +0.10 to +0.12 ms in the water's passes (the 1080p table) |

Task 2 (6-critique, "The work plan"):

| item | met? | evidence |
|---|---|---|
| `6-film1-rise` re-shot shows no flat cyan lozenge at 3 s | **met** | `7-ba-film1-rise-3.jpg`: a translucent puddle with the floor through it, gathering and rising |
| `6-el-ip-redwoods-close` re-shot shows ice without a constant-width white outline | **met** | `7-ba-el-ip-redwoods-close.jpg`: no band; frost on up-facing edges and the head and hands only; paler and closer to `02` |

The brief's own list:

1. Lit, not glowing: **done** (the table at the top of "What I changed"). The own light is 0.18 of the caustic, far
   below the fire beside it.
2. The world through it: **done** for the main view: thin water lets 70 to 80 % through, thick water absorbs toward
   deep blue-green, refraction bends most at the edges. Fire through water: **the veil is provided** (above); the post
   agent applies it.
3. A silhouette that breaks: **partly** (shell curl, streamers, drips, the edge's tongues and tearing; a crown when a
   limb stops is the existing shed-with-velocity; ropes between limbs come from the smoothing joining near limbs, not
   from anything new). Not `09`'s wisps; the fallback is named in the weak points.
4. The puddle: **done** (reflective, meniscus, the floor through it; gathers and rises on waking).
5. Ice inherits: **done** (no outline, frost where it forms, facets lit by the world, dark facets kept, set ice the
   same: `7i-bridge-0p4.jpg`).
6. `tide`'s heart: **done, with a fix** (its own ice no longer freezes its water; the chest is liquid and the heart's
   stones and glow show through it: `7i-tide-1.jpg`). The heart is still more glow than stone at that distance.
7. The fallback: **not used**. The first choice removed the outline; the fallback is what would turn the edge into
   `09`'s wisps (weak point 2).
8. Kept: form and the freeze climbing (`7i-freeze-sheet.jpg`), `setIce` (`7i-bridge-0p4.jpg`), gate views
   (`7i-door-0p8.jpg`: the water dancer before the geode's live door; I did not shoot water *beyond* a disc this time),
   the geode's mirror (`7i-fw-geode-*.jpg`: the bodies reflected in the agate), `focus` (unchanged values, now with the
   veil in the same pass), `hear`, `carry`, budgets, the field's reactions (unchanged code paths; the freeze threshold
   gained the own-ice term). The cost: above.

## Weak points

1. **Faint at dusk in the redwoods.** A clear body in front of bright fog has little to show; the fog's grain shows
   over it. A little more milk or own light per world would help; I kept it physical.
2. **The edge's tongues are pixel shifts** of the smoothed surface (nearest texels): close up, a tongue can show as a
   stepped or stretched copy of the edge, and they are not `09`'s curling flame-wisps. The critic's fallback (water's
   edge as a field like fire's) would give those; I did not build it, because the first choice removed the outline
   and the field would cost a target per view plus the gate views. If the film wants `09`'s look, that is the next step.
3. **Terraces** from the narrow-range filter still show as faint rectangles where an arm crosses the body (halved,
   not gone).
4. **Pool and geode lean glassy/silver**: their ambient and key are strong (made for stones), and water reflects and
   scatters them.
5. **Drips** from tide's melting hands still fall as visible streaks inside the body.
6. **Fire through water** is still added over the water until the post agent reads the veil.
7. The gate view (`fs_scene`) has no refraction (as before) and its single alpha approximates the per-channel
   absorption.

## Edits outside my folders

- `scripts/steps/water-7-gen.mjs`, `water-7.json`, `water-7-ab.json`, `water-7-timings.json`: my step files.
- `docs/reports/7-water.md` and `docs/reports/media/7-*.jpg`, `7i-*.jpg`, `7ab-*.jpg`, `7-ba-*.jpg`: this report and
  its stills.
- None in `src/` outside `src/matter/water/` and `src/matter/ice/`. The regenerated `*.d.wgsl.ts` files committed are
  only those in my folders (the `WaterSim` struct grew, so ice's shader typings changed with it).
