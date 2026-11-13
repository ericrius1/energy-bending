# Wave 4: water that runs and glows, ice with facets

Task 2 of `docs/reports/3-critique.md`. Owner: `src/matter/water/`, `src/matter/ice/`. Branch:
`worktree-agent-af58bf72c9b99ca8e`. Everything below was rendered on the RTX 5090 through headless Chrome
(`scripts/critic-cap.mjs`, the shared render lock, each run kept under a minute of rendering), and every still named
here was looked at. Not measured: a laptop or a phone, anything by ear, a long soak, the geode mirror's cost.

## What I built

1. **The body runs** (`water/sim.wgsl`). Each liquid particle's home slides along its capsule (toward the hands and
   feet on the limbs, down the torso and the head; `flowSpeed` 0.35 m/s, each particle ±25 %) and wraps to the top of
   its capsule, where the joints overlap and hide the jump (the particle is put there at once; homes are evenly spread,
   so the surface does not change, only what travels on it). Swells 2.2 cm high, 24 cm apart, run down the body 1.6×
   faster than the water, in rivulets round it, so a still dancer's highlights slide. A fast limb peels sheets off
   its trailing side, more where a swell is passing (`peel`). Ice does not run; it eases back to its home. Also fixed
   on the way: the ripple used the home's normal in the joint's frame as if it were the world's.
2. **The surface** (`splat.wgsl`, `smooth.wgsl`, `surface.wgsl`, `surface.ts`).
   - A narrow-range filter replaces the bilateral: spatial Gaussian only, within a depth band round the pixel (behind
     it: left out; a little in front: clamped to the band's edge; far in front, an arm across the body: left out too,
     or the body ridged along the arm's outline). 16 taps a side (sparser taps aliased the beads into stripes), the
     direction order alternating pass by pass, and a pixel the splats missed takes the depth round it.
   - The outline comes from the smoothed thickness, not the union of discs: no beads. Near the outline the normal
     turns with the thickness's gradient (the reference's normal), elsewhere it comes from the depth over a few texels.
   - Shading is the reference's luminous model (`docs/element-looks.md` §2): a glow from pale to deep blue by thickness
     times a caustic that rises through the body, a cyan rim where it is thin, a view-fixed highlight plus the key's,
     a little of the world reflected, the scene behind seen through it and a little bent (`refract` 0.02), foam white
     where churned. The caustic is in the frame of the bone the pixel lies on, so it rides on the body.
   - Water lying on the floor before the rise is splatted as flat discs and shaded as a film (reflection, a trace of
     cyan): no more cyan slab.
3. **Spray and foam** (`drops.wgsl`). Flying water splats at 0.55 of its size, so a lone drop falls under the outline
   and a sheet still adds up to a surface. Every flying drop is drawn as a small streak along its velocity; 5 % glint
   as a small star; churned water (foam over 0.8) as a soft aerated blob. A liquid foot landing rings the world's own
   water through its `ripple(x, z, s, r)` where it has one (the Pool, the temple).
4. **Every view.** A gate's view gets its own splats and smoothing at 0.7 of its resolution in the 'cull' stage, and
   the composite is drawn *inside the gate's scene pass* (glow phase, `fs_scene`: premultiplied over the scene,
   depth-tested at the surface's own depth, alpha kept), because the gate's scene and air run in 'gates', before
   'air'. A mirroring floor (the geode) gets the same splats reflected about the floor at half resolution, one
   smoothing pass, added onto the floor in the opaque phase (`fs_mirror`), as the gems and fire add theirs. All honour
   `seen` (cut at the door, carried, `keep` and `grow`).
5. **Ice in the same surface.** Ice on the body splats into the same targets (its share in the thickness's third
   channel). The composite turns each pixel into the frame of the bone it lies on (the nearest splat's capsule,
   voted over its neighbours; the pelvis, belly and hip capsules share the lower back's frame) and shades it with a
   3D voronoi there: large cells (11 per metre), each tilted its own way and lit by `lit³` (dark facets among bright
   ones), steel blue to navy by thickness, hairline edges, a thin frosted rim, glints one cell at a time at 6 Hz.
   Ice that has broken off and flies is not splatted; it is shards. On the body, shards stand only where the body
   turns away from the eye (the silhouette bristles). The freeze shows as water above, faceted ice below and a thin
   white front between. A dancer's own form is cold in the field (its aura), which used to freeze the whole body at
   once; the field's cold now needs to be stronger the higher the dancer's own form, so the freeze climbs from the
   feet (`sim.wgsl`).
6. **Set ice** is splatted into the same surface (`ice/set.wgsl` holds the set shard and where it is now, shared by
   the splat and the shards), so bridges have the bodies' facets; its icicles, a few crystals standing out of the top
   and every shattered piece stay shards. `setIce` (add, hit, warm, ledgesIn, save, load) is unchanged.
7. **The depth contract.** The composite writes colour only: the scene's alpha is left as it was. `focus?(view):
   Texture | null` is on `MatterPasses` (`core/kind.ts`), and the water returns an `r16float` texture the size of its
   surface targets holding the surface's view distance where it shows (not hidden by something solid) and `1e5`
   elsewhere (cleared to it every frame the view is drawn). Note for the lens agent: `1e5` is above half-float's
   largest value, so it reads back as `+inf` from an `r16float`; compare with `>`, don't do arithmetic on it. The main
   view and `?pip` have one; a gate's view returns null. For captures until the lens reads the focus, `water.distAlpha`
   (off by default) writes the old distance into alpha.
8. **Cost.** Ice's cold mist was most of a close ice body's time (0.55 ms of overdraw at 2.3 m, measured by turning it
   off): its puffs are now 8 cm instead of 14, each brighter by the square of the change, and the draw is off when mist
   and dust are 0.

Kept: per-dancer form, `setIce` and its drawing, `hear(ears)` (footfalls moved out of `voice` into `footfalls`, which
also rings the ripples; the splash events are the same), `carry`, loadout mixing (the `tide` dress was not re-shot),
reading the field (below).

## Before and after (the reference: `docs/element-looks/09-solo-fire-water-default.jpg`, `02-ice-facets-frost.jpg`)

My own short takes are `scripts/steps/water-ice-4.json` (all in `?play`, Pool unless named); before = the merge
`57483b3`, after = this branch. The "after" stills of my takes set `water.distAlpha` (the old alpha), because until the
lens and the air read the focus texture the Pool's water is painted over every translucent body below the horizon
(see "Weak points"); `4-after-contract-1.jpg` and the critic's re-shot takes (`4-el-*`) are with the contract as it is.

| what | before | after |
|---|---|---|
| a still dancer, 2.3 m | `4-before-rest-close-1.jpg` (blue rubber, one streak) | `4-after-rest-close-1.jpg`, sheet `4-after-rest-close-sheet.jpg` |
| an armada and a spin, 2.3 m | `4-before-kick-close-sheet.jpg` | `4-after-kick-close-sheet.jpg` (sheets peel off the kick and the spin's arms) |
| the critic's `el-water-close` (`critic-elements.json`) | `3-el-water-close-sheet.jpg`, `3-el-water-close-1p2.jpg` (glitter) | `4-el-water-close-sheet.jpg`, `4-el-water-close-1p2.jpg` (streaked spray, no stars) |
| the critic's `el-water-wide`, 6.2 m | `3-el-water-wide-sheet.jpg` | `4-el-water-wide-sheet.jpg`; with the old alpha `4-after-wide-1p2.jpg`, `4-after-wide-sheet.jpg` |
| ice close and wide | `4-before-ice-0p5.jpg`, `4-before-ice-1p5.jpg` | `4-after-ice-0p5.jpg`, `4-after-ice-1p5.jpg` |
| the critic's `el-ice-close` / `el-ice-wide` | `3-el-ice-close-0p3.jpg`, `3-el-ice-wide-sheet.jpg` | `4-el-ice-close-0p3.jpg`, `4-el-ice-wide-sheet.jpg` |
| the freeze 0, 0.5, 1 | `4-before-freeze-sheet.jpg` | `4-after-freeze-0p2.jpg` (0), `4-after-freeze-1p5.jpg` (0.5: legs ice, head water), `4-after-freeze-3p1.jpg` (1), sheet |
| set ice bridge (geode) | `4-before-bridge-0p4.jpg` (white sugar) | `4-after-bridge-0p4.jpg` (faceted, reflected in the floor) |
| water beside fire, 0.6 m apart | `4-before-fire-1p5.jpg` | `4-after-fire-sheet.jpg`, `4-after-fire-1p2.jpg` |
| ice beside fire | (none) | `4-after-melt-sheet.jpg`, `4-after-melt-2p3.jpg` |
| water through a live gate | `3-film-11p8.jpg` (drops only) | `4-after-door-0p8.jpg` (the geode's door: a water dancer in the redwoods with its surface, and the gate-in-gate arch) |
| the Pool's horizon behind a water body, the contract as it is | `3-el-fire-close-0p3.jpg`, `3-el-water-close-sheet.jpg` (rectangle) | `4-after-contract-1.jpg`, `4-el-water-close-sheet.jpg` (no rectangle) |

What I saw: at rest the water is a light-filled blue body with a cyan rim and sliding highlights, its caustic mottling
moving with the body; the outline is smooth (no beads). In the armada a sheet of water peels from the kicking leg and
the spin throws arcs from both hands, then the body gathers again. After a kick the air is full of thin streaks, not
stars. Ice reads at once as faceted crystal: large flat cells, some dark, some bright, a pale frosted rim, glints;
close (`4-el-ice-close-0p3.jpg`) the facets are large and clearly planar, as in `02-ice-facets-frost.jpg`, though
deeper blue than the reference's pale ice. At 6 m with the old alpha (`4-after-ice-1p5.jpg`) it is a steel-blue faceted
figure; with the contract (`4-el-ice-wide-sheet.jpg`) the part below the horizon is darkened by the Pool's water and it
reads as a glass outline. The freeze at 0.5 shows faceted legs under liquid shoulders with a thin white front.

## Timings (RTX 5090, 1280x800, weft's profiler over 150 stepped frames, `scripts/steps/water-ice-4-timings.json`)

Before is the merge `57483b3` run from a second worktree on its own dev server, same step file, same session.

| scene | before (ms) | after (ms) | the water's and ice's passes after |
|---|---|---|---|
| one water dancer, 2.3 m (`wt-water-close`) | 0.825 | 0.935 (0.949 and 0.928 in the critic's `el-water-close`) | splat.depth 0.18, splat.thick 0.10, smoothing 6 × 0.035 = 0.21, surface 0.06, sim 0.012, focus 0.002 |
| one ice dancer, 2.3 m (`wt-ice-close`) | 1.147 | 1.214 (1.186 in `el-ice-close`) | scene 0.33 (shards and mist), splat.depth 0.19, splat.thick 0.11, smoothing 0.21, surface 0.06 |
| ... same, before the mist change | | 1.558 to 1.579 | scene 0.70 to 0.73; with mist and dust off 1.007 (scene 0.14); with shards cut to one in 40, 1.462 |
| two ice dancers, 3.6 m (`wt-two-ice`) | 0.941 | 0.954 | splat.depth 0.12, splat.thick 0.09, smoothing 0.21, surface 0.04, scene 0.21 |
| two gem dancers, the same staging (`wt-two-none`) | 0.428 | 0.414 | |
| fire and water, a live gate into the redwoods (`wt-water-gate`) | 2.239 | 2.620 | main: as above; gate0: splats 0.05 + 0.05, smoothing 6 × 0.009, its composite inside scene.gate0 (0.99 → 0.99) |

Two ice bodies cost 0.954 − 0.414 = **+0.54 ms** over two gem dancers (before: +0.51 ms; the critic measured +1.4 ms).
The smoothing costs more than before (16 taps instead of 10: 0.21 against 0.14 ms) and the composite does more work
(0.06 against 0.015 ms); the splats are the same. The geode mirror's extra splats were not timed.

## The critique's "Done when", item by item

| item | met? | evidence and why |
|---|---|---|
| `3-el-water-close` re-shot shows a luminous, moving surface at rest (compare `09`) | **met, with the contract's caveat** | `4-el-water-close-sheet.jpg` (first frames), `4-after-rest-close-1.jpg`. Luminous blue with a cyan rim and sliding highlights; the swells and caustic move on a still body. Below the Pool's horizon the Pool's water is painted over it until the air reads focus (weak point 1). Bluer and less white than `09` |
| no star-glitter after a kick | **met** | `4-el-water-close-1p2.jpg`: streaked spray, a few small glints, rare foam |
| a bead-free outline | **met** | the outline is the smoothed thickness's contour in every still |
| the wide shot reads at 6 m on the Pool's black | **met with the old alpha, partly with the contract** | `4-after-wide-1p2.jpg` reads well; `4-el-water-wide-sheet.jpg` reads above the horizon, dimmer below it (weak point 1) |
| water through a gate has its surface (`critic-film.json` at 11.8 s) | **met, not at that timestamp** | `4-after-door-0p8.jpg` (the geode's live door into the redwoods). The critic's film at 11.8 s did not put the water dancer beyond the disc in my run (its timing depends on the walk), so I used the debug door instead |
| ice wide reads as steel-blue faceted crystal, not a white cut-out | **met with the old alpha; with the contract it reads as glass** | `4-after-ice-1p5.jpg`; `4-el-ice-wide-sheet.jpg` |
| ice close shows large flat facets with dark ones among them (compare `02`) | **met** | `4-el-ice-close-0p3.jpg`, `4-after-ice-0p5.jpg`. Deeper and bluer than `02`'s pale ice |
| two ice bodies cost less than +1.4 ms | **met** | +0.54 ms (table above) |

The brief's other checks: kick and spin (`4-after-kick-close-sheet.jpg`), still dancer (`4-after-rest-close-*`), the
freeze at 0, 0.5, 1 (`4-after-freeze-*`), a set-ice bridge (`4-after-bridge-0p4.jpg`), water beside fire
(`4-after-fire-*`), the Pool's horizon behind a water body (`4-after-contract-1.jpg`: no rectangle). The field: water
0.6 m from a fire dancer thins on its fire side and steam rises between them (`4-after-fire-sheet.jpg`), and an ice
dancer beside fire loses its facets where the flame touches it (the near arm turns glossy, `4-after-melt-2p3.jpg`):
seen in stills, not measured (no readback of the particles' state). Freezing in another dancer's cold was not
exercised.

`npm run typecheck`, `npm run build`: clean. `npm test`: limits, the binding budget (the water's composite is now the
most uniforms of any stage, 8 of 12: it includes the bodies' group for the bone frames), src, audio, gates and every
other suite pass; one net test fails, "B: tracks the source in real time (rms < 0.02)" (rms 0.07 to 0.10), which runs
on wall-clock time and printed "CPU busy 100% of 32 logical cores" while other agents were running. It fails the same way on the merge `57483b3` run in the same hour (rms 0.083), so it is the
machine's load, not this work.

## Weak points

1. **The contract's interim.** With the scene's alpha left alone, the Pool's water (`worlds/water`, drawn in the air
   from alpha) is painted over every translucent body below the horizon, and the Pool no longer reflects the water
   body; the air's fog and the depth of field treat the water as the background. The focus texture is there for the
   lens and air agent to read; until then the water is dimmer and softer in the Pool than in my `distAlpha` stills.
2. **Separable filtering** still leaves faint streaks at strong occlusions (an arm across the chest), now mostly
   hidden by the wider normal stencil; a 2D pass at the end would remove them.
3. **Ice where capsules overlap** (the crouched legs, the hips) shows smaller, busier cells: neighbouring pixels still
   switch between bone frames there (`4-after-freeze-1p5.jpg`, the legs).
4. **Ice is bluer and darker than the reference**, which is pale white-blue; it is the critic's palette (steel blue to
   navy) and the reference's numbers, but it has less of `02`'s glow. A brighter `thin` would move it there.
5. **The streaked spray** reads a little like rain at 2.3 m after a big kick; dimmer or fewer streaks would calm it.
6. **The water through the live gate** is drawn without bending what is behind it, and the dancer walking through the
   Pool's own gate in `?play` showed oddities of the portals' carrying (the dancer seen outside the disc while it
   crosses), shared by every kind (`4-after-gate-sheet.jpg`).
7. **Set ice** is splatted with the world's own coordinates for its facets (it doesn't move), and drawn only in the
   world it was laid in, as before; its shattered pieces are the old shards.
8. Not done: the geode mirror's timing; a field-cold freeze test; the `tide` dress; phones (`coarse` keeps its half
   resolution and one smoothing pass).

## Edits outside my folders

- `src/matter/core/kind.ts`: the one optional member `focus?(view: ViewCtx): Texture | null` on `MatterPasses`, and
  the two type imports it needs (`Texture` from weft, `ViewCtx` from engine/views).
- `scripts/steps/water-ice-4.json`, `scripts/steps/water-ice-4-timings.json`: my step files.
- `docs/reports/4-water-ice.md` and `docs/reports/media/4-*.jpg`: this report and its stills.
- Not committed: `npm install` and the newer weft it fetched regenerate `*.d.wgsl.ts` files across `src/post`,
  `src/portals` and `src/worlds` (a new `jitterNdc` in weft's Frame) and change `package-lock.json`; I left those out
  (only the `.d.wgsl.ts` files in my folders are committed, regenerated by the build).
