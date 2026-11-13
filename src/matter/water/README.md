# matter/water (wave 1: water + ice; wave 3: water that runs and glows)

Fluid bodies: particles sprung loosely to homes that slide down their capsules under travelling swells, peel off fast
limbs and splash, drawn as a screen-space surface (spheres splatted, smoothed by a narrow-range filter, shaded with
the reference's luminous model: docs/element-looks.md section 2). Ice is the same particles frozen and the same
surface, shaded with facets (section 3); its shards, mist and set ice are matter/ice. Spray and foam are sprites
(drops.wgsl). It implements `MatterKind` (src/matter/core/kind.ts) and registers from an `index.ts` here, offers the
lens a focus texture (`MatterPasses.focus`), and reads the field (water thins in heat, freezes in cold, ice melts in
heat). See `docs/extending/matter-kind.md`, `docs/element-looks.md` and `docs/reports/4-water-ice.md`.

| file | what |
|---|---|
| `pool.ts` | the one particle pool for water and ice, its layout, form, acts, voices, footfalls (and ripples) |
| `sim.wgsl` | the step: the body running, swells, peeling, state of matter, splashes, foam |
| `surface.ts` | per view: splats and smoothing ('cull'), then the composite (main: 'air'; gates: in the scene; mirror) |
| `splat.wgsl`, `smooth.wgsl`, `surface.wgsl` | the surface's three steps |
| `drops.wgsl` | spray (stretched drops, a few glints) and foam (soft aerated blobs) |
