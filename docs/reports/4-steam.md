# Wave 4: the meeting, steam fronts (the critique's task 5)

Branch `worktree-agent-ae061aff5bef8d871`. Where two elements meet is now an event rather than fog. A thin, white-hot
**front** burns along the contact between the two bodies, and **wisps** boil up from it and are gone within about a
second. Flame on ice also **drips**, and plasma on water **sparks**. The wisps are drawn at half resolution into their
own target and composited after the depth of field, with a soft blur of their own and a per-pixel cap, so steam can
no longer white out the frame. The field now radiates heat and cold, carries a kick's wake about a metre, stores
plasma's dryness, and can wind a fusion into a double helix with a look the game can drive (steam, prism, storm,
aurora).

**Measured:** typecheck, build and `npm test` are clean (the net smoothness test failed once while captures loaded the
machine, then passed 11 of 11 on the rerun). I took stills and sheets on the RTX 5090 (dev server on port 5431, every
capture under the shared lock, in short runs) and looked at all of them. The field values and the kick's wake came
from probe readbacks, and the timings from weft's profiler.

**Not measured:** a laptop or a phone, the composite's brightness read back from pixels (the cap is by construction;
see "Done when"), and a long soak.

## What I built

### Steam (`src/matter/reactions/`)

- **One pool, four sorts of particle, by index** (`steam.wgsl`): 6,000 in all (a phone gets a third).
  - Wisps (50 %), fronts (38 %), drips (6 %) and sparks (6 %). Each is 48 bytes: position, age, velocity, life and
    `info` (how plasma, how icy, how strong the meeting was, a seed).
- **Births on the contact** (`steam_sim.wgsl`):
  1. A dead particle picks a random point on the axis of a random capsule of a random dancer.
  2. It finds the nearest capsule of any other dancer.
  3. If the two surfaces are within `gap` (7 cm) or cross, it takes a point on the contact: the ring where the two
     capsules' surfaces cross, or the middle of the gap.
  4. It is born there with a chance set by `fieldSteam` at that point, so only matter that reacts makes anything.

  Fronts are born again every frame and live 0.12 s, so the line follows the contact and is gone when the bodies part.
  Wisps can also be born where the field makes steam away from any contact (a deposit, the fusion's helix), at a
  lower rate.
- **Which pair it is, from the field alone**, read at the contact point:
  - Plasma: dry (`fieldDry` 0.06 to 0.25) or hotter than fire (heat 1.15 to 1.45).
  - Ice: cold (0.03 to 0.2).
- **How the pairs differ:**

  | pair | look |
  |---|---|
  | fire and water | neutral white wisps with a warm orange underside (lit by the field's heat 18 cm below each wisp, on the lower half of the sprite); an amber-white front |
  | fire and ice | a harder, longer, blue-white crack line; a fast jet of vapour out of the contact (`jet` 1.6 m/s) with shorter lives; drips of meltwater falling |
  | plasma and water | faintly violet-white vapour; small jagged flickering sparks (3 to 7 cm) round the contact. I drew my own: `arcs.add` lives on the plasma kind's object and is not reachable from a reaction's context, and steam only draws in the lens pass anyway |
  | plasma and ice | cold blue-violet vapour that sinks for its first third (`sink` 0.9 × `rise`) before it rises |
- **Wisps** (`steam_draw.wgsl`):
  - Drawn at half the render size, summed (premultiplied colour in rgb, optical depth in alpha).
  - Each is stretched along its motion on screen, bent by a curl and cut into filaments, so a stream reads as vapour,
    not balls.
  - Lit by the world (ambient and key), so they work in each world's light.
  - Soft intersection with opaque matter: a hand test against the scene's view distance, faded over the wisp's own
    size.
  - Each wisp lives 0.55 to 1.1 s.
- **Composite** (`steam_comp.wgsl`), in the lens pass after the depth of field:
  - Five bilinear taps make a blur of its own.
  - Coverage is `cap × (1 − e^−τ)` with `cap` 0.45 (0.52 at most in a storm fusion), so at least 55 % of what is
    behind any pixel always shows through.
  - Colour is scaled so its brightest channel is at most `maxBright` 0.85.
- **Fronts, drips and sparks** (`steam_front.wgsl`):
  - Full resolution, added, after the composite.
  - Screen-space ribbons at least 1.3 px wide, dimmed when thinner than that.
  - A hand depth test with 18 cm of slack (a front lies on a body's surface, inside a flame's soft edge).
  - A per-frame flicker.
  - These are the only parts of steam allowed past 0.85 (`frontGlow` 2.0, HDR, so they bloom).
- **Tunables:** `bend.params.steam` (`cap`, `maxBright`, `gap`, `frontGlow`, `frontLife`, `jet`, `sink`, `lowRes`,
  `blur` and the rest).

### Field (`src/matter/field/`)

- **Radiant tails:** heat and cold now reach past the near falloff, with `radiate` 0.3 at the surface falling by e
  over `radiateLen` 0.25 m.
- **The kick's wake:** a fast limb's drag reaches further, as reach × (1 + `wake` × speed) with `wake` 0.08.
- **Plasma's dryness** is kept in B.w (before, the stir, which nothing read) and decays at 2.5/s; read it with
  `fieldDry(p)`.
- **The fusion:** `field.fuse(f)`, `field.fusionFront` and `field.helix` (below).
- **Cost:** `field.step` stayed at 0.03 ms with the wider loop.

## The fusion hook (for the gameplay agent)

```ts
const field = bend.show.kinds.find((k) => k.id === 'field').field;   // or ctx.field in a kind
field.fuse({ dancers: [0, 1], kind: 'storm', amount: 0.8, strength: 2.2, tightness: 1 });  // 'steam'|'prism'|'storm'|'aurora'
field.fuse(null);   // or amount 0: a strict no-op
```

- **The helix:** each frame the field winds the two dancers' body-averaged auras into two strands half a turn apart,
  round a vortex at their middle. Optional settings: `at`, `axis`, `radius` 0.32, `height` 1, `width` 0.12, `speed`
  0.7 rad/s, and `auras: [a, b]` instead of the dancers'.
- **The vortex** is the field's own, at strength × amount; it takes one of the four vortex slots.
- **Steam** is born along the strands and swirls up the vortex.
- **Each kind's look:**
  - steam: white, with some wisps licked cyan or orange.
  - prism: thinner, in thin-film colour by optical depth.
  - storm: dark slate and heavier, with patches flickering violet from inside.
  - aurora: green rising into violet, drawn out upward.
  - The fronts take the tint too.
- **Amount 0** sends kind 0 at weight 0 to every shader, where every term is multiplied by the amount, and the field's
  helix branch is skipped. That makes it a no-op by construction; I did not compare frames to the bit.
- **Shot** with `scripts/steps/steam-fusion.json`, ramping the amount over 1.2 s; the stills are listed below. The
  double helix reads as a twisting column of crossed filaments rather than as two clean strands (see weak points).

## Measured field values (for the fire and water agents)

Two dancers 3.2 m apart in the Pool, 240 frames after waking. The probes were at chest height (hips + 0.25 m),
sideways away from the other dancer, at 0.16 m from the spine (about the torso's surface: its capsules are 0.14 to
0.16 m), then 0.3 m and 1 m past that. Probes are trilinear on 18 cm cells.

| body | value | surface | +0.3 m | +1 m | 0.3 m over the head | 0.6 m over the head |
|---|---|---|---|---|---|---|
| fire | heat | 0.586 | 0.075 | 0.004 | 0.022 | 0.006 |
| plasma | heat | 1.034 | 0.137 | 0.008 | 0.033 | 0.009 |
| water | wet | 0.606 | 0.058 | 0.000 | 0.002 | 0.000 |
| ice | heat (cold) | −0.673 | −0.091 | −0.005 | −0.019 | −0.006 |
| ice | wet | 0.207 | 0.024 | 0.000 | | |

- **Steam:** 0 at all of these points (the bodies were apart). Steam is 0.2 to 1+ only where bodies meet.
- **Wind at rest:** 0.2 to 0.44 m/s at the surface (plasma's rises at 0.27 m/s).
- **The kick's wake:** during an armada, the highest wind seen at hip height was 4.06 m/s at 0.5 m from the hips,
  2.91 m/s at 0.9 m and 0.28 m/s at 1.3 m. The air a metre behind a kick moves at about 3 m/s.
- **Thresholds I'd suggest:**
  - Water thinning in heat: from heat 0.05 (a flame within about 30 cm).
  - Ice melting: heat > 0.05.
  - Water freezing: heat < −0.05 (ice within about 30 cm).
  - Flame bending: follow `fieldWind` directly (it is 3 to 4 m/s behind a kick).
  - Surface values are 0.6 rather than 1 because the cell is coarse and the aura decays as it is laid; a kind that
    wants "touching" should read heat > 0.3.
- **Debug captures in `?field`:**
  - `4-steam-field-flame-behind-kick.jpg`: wind streaks behind a fire dancer's armada.
  - `4-steam-field-water-in-heat.jpg`: fire beside water, orange heat dots between them.
  - `4-steam-field-water-beside-ice.jpg`: ice beside water.
  - `4-steam-field-ice-beside-fire.jpg`: fire beside ice.

  The radiant tail is faint on the overlay at 0.7 m between surfaces (0.06): honest, but subtle.

## Timings (RTX 5090, 1280 × 800, weft's profiler over 150 stepped frames)

| scene | before | after |
|---|---|---|
| forge clash (`w-forge-lock`), measured from 2.0 s, gpu frame | 6.67 ms (scene 5.44, lens 0.22) | 6.33 / 6.48 ms (scene 5.38 / 5.55, lens 0.04, steam.low 0.04, steam.sim 0.02) |
| same, steam's births off (A/B in the same build) | | 6.83 ms (scene 5.69, lens 0.04) |
| same, field's radiant tail and wake off | | 6.85 ms (scene 5.81) |
| plasma against ice film (`film2`), from 6 s | 2.42 ms (lens 0.13) | 2.33 / 2.46 ms (lens 0.05) |
| field.step | 0.03 | 0.03 |

- **Steam's part of the clash:** about 0.07 ms after (steam.low 0.04, steam.sim 0.02, the composite and fronts inside
  a lens pass of 0.04 to 0.05 that takes 0.04 without steam). Before, it was about 0.14 ms of the lens plus its sim.
  That is well under the 0.5 ms asked.
- **The rest of the clash is fire's scene** (smoke and flames), which the fire agent is cutting. Measured from 3.0 s
  instead (the armada and the spin), the scene was 19.9 ms. Steam there was still 0.04 + 0.05 ms, so that is fire's
  overdraw, not mine. The radiant tail did not change the scene's cost: the A/B difference is within run-to-run noise.

## Stills (`docs/reports/media/`)

**Reference:** `docs/element-looks/03-fire-ice-clash-steam.jpg`, `05-fusion-steam.jpg`.

**Before (the critic's step files, re-shot at 10 fps):**
- `4-steam-before-forge-lock-{sheet,2,3,4p2,5}.jpg`
- `4-steam-before-film-plasma-ice-{sheet,5p4,6,7p2,8}.jpg`: the whiteout at 6.6 to 8 s.

**After, the same steps:**
- `4-steam-forge-lock-{sheet,2,3,4p2,5}.jpg`: crackling white front lines on the contact while the bodies overlap;
  the water dancer is visible through every frame. The grey wings are fire's smoke.
- `4-steam-film-plasma-ice-{sheet,5p4,6,7p2,8}.jpg`: no whiteout. Violet vapour and small arcs between an ice dancer
  and a plasma dancer, both visible.

**Each pair, close (2.4 m) and at game distance (6 m)**, sheets plus stills at 0.3, 1 and 2 s:
- Pool: `4-steam-{fire-water,fire-ice,plasma-water,plasma-ice}-{close,game}-*`.
- Redwoods at night (21:36): the same names with `-redwoods`.

**Circling:**
- `4-steam-circle-{pool,redwoods}-sheet.jpg`: two dancers circling for 6 s (fire and water).

**Fusion:**
- `4-steam-fusion-{steam,prism,storm,aurora}{,-redwoods}-{sheet,1p5,3p5}.jpg`.

What I saw against the reference:
- **The front:**
  - It reads as a crisp bright line when bodies overlap (the forge).
  - At a hand-to-hand touch it is a bright point. That is physically right, but not the reference's long seam: the
    reference shows two bodies overlapping almost whole.
  - At game distance the point bloomed into a large flash at `frontGlow` 3.2. I lowered it to 2.0 and re-shot two
    takes: plasma and ice at game distance in the redwoods (the flash is now a point), and plasma and water close in
    the redwoods. The rest of the pair takes were shot at 3.2.
- **Wisps:**
  - In the first pass (`fire-water-close`) they were cotton balls. Filaments, more stretch, less density and more
    curl made them wisps.
  - Fire and ice throws a blue-white jet upward with icicle drips; plasma and ice is a violet-blue haze.
- **The fusions:** steam and aurora are beautiful (`fusion-aurora-3p5`: green-violet curtains rising from between
  them). Prism is a little garish. Storm reads as dark vapour; its flicker is subtle in a sheet.
- **Circling:** steam comes and goes with the contact. At 4.2 m the front is small, and the last row of the Pool take
  shows the dancers overlapping into a mess (the staging teleports them each frame).

## The critique's "Done when", item by item

1. **`3-film-6` and `w-forge-lock` re-shot show both dancers through the steam in every frame: met.** I looked at
   every frame of both sheets. Both dancers show in every frame; where a body is hidden, flame or fire's smoke hides
   it, not steam.
   - By construction, steam covers at most 45 % (52 % in a storm fusion).
   - In the forge, fire's smoke (the fire agent's) still hides the water dancer in places.
2. **The forge clash costs ≤ 2.5 ms at 1280 × 800 with tasks 1 and 5 in: not met yet, and it depends on task 1.**
   - Steam's part is about 0.07 ms (asked: under 0.5).
   - The clash is 6.3 to 6.5 ms in this branch, 5.4 to 5.6 ms of it fire's scene, without the fire agent's work.
3. **Steam is never brighter than 0.85 of white except at the front: met by construction, not measured in pixels.**
   - The composite scales its colour so its brightest channel is ≤ `maxBright` 0.85.
   - Fronts, drips and sparks are the only steam drawn past it.
   - Measured on the frame, the brightest pixels are fire and the fronts, never the vapour.
4. **(The brief) wisps gone within about a second, never a standing cloud: met.** Lives are 0.55 to 1.1 s. The pair
   takes show vapour only while the bodies touch.
5. **(The brief) the front follows the contact and vanishes when they part: met.** Fronts are reborn on the contact
   every frame and live 0.12 s. Visible in the forge sheet and in the pair sheets, where flashes appear only at
   touches. The circling take shows it weakly (see weak points).

## Weak points

- **The front is only as long as the contact.** Hand-to-hand gives a bright point, not a seam. A line along a near
  miss (within 7 cm) shows only when limbs run parallel.
- **The double helix reads as crossed filaments in a twisting column, not as two distinct strands.** The 18 cm cell
  blurs strands 64 cm apart, and the wisps' filaments add criss-cross. A sharper look would place wisps on the
  strands only (already 60 % of the off-contact births) with lower turbulence during a fusion.
- **Prism's thin-film colour is a little loud** (magenta and green blotches).
- **The depth slack is coarse:** steam is a hand test against one distance per pixel. A front behind a limb 10 cm in
  front of it still shows. A water body's composite distance hides fronts on its far side (correct).
- **Steam stays main-view only** (as before): none in gate views or ?pip.
- **Dryness to plasma** uses thresholds picked from the auras (plasma 0.6 dry), not tuned from stills. Fire next to
  plasma (both hot, no wet) makes nothing, as intended.
- **The circling staging** teleports the dancers each frame (`bend.place`), so their bodies jitter. A proper circling
  dance would show the front better.
- **Sparks are my own**, because the plasma kind's arcs are not reachable from a reaction. If the fire agent exposes
  arcs on the matter context, steam could use them.

## Edits outside my folders

- `docs/extending/reactions.md`: `fieldDry`, B.w is now dryness, the fusion API, "How steam meets".
- New step files and their generator: `scripts/steps/steam-gen.mjs` writes `steam-critic.json`, `steam-pairs.json`,
  `steam-pairs-redwoods.json`, `steam-circle.json` and `steam-fusion.json`; written by hand are `steam-field.json`
  (probe measurements) and `steam-fieldview.json` (`?field` stills).
- Stills: `docs/reports/media/4-steam-*.jpg`. This report.
- Nothing in `src/` outside `src/matter/reactions/` and `src/matter/field/`.
- `PostChain.lens` and `sceneTex` are used as they were, plus one new item: steam adds its own pass to the `air`
  stage (after the main view's air) from `declarePost`. If the depth-contract agent renames `sceneTex` or changes
  what its alpha means, the three steam draws that read it need the same change.
- Generated files: `src/matter/field/step.d.wgsl.ts` and `src/matter/reactions/*.d.wgsl.ts` (weft writes these).
