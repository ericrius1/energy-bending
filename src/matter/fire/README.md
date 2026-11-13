# matter/fire: bodies of flame (and plasma's flames)

One pool of GPU particles for every dancer wearing `fire` or `plasma`. Each particle has a home on a capsule (laid out
by `matter/core/layout.ts`, as the gems' are), and lives a fraction of a second at a time: born at its home with the
limb's velocity, it rises, is stirred and cools, then is born again at its home. A still dancer burns upward like a
torch; a kick leaves the flames born along its path behind it as a sheet; a spin, a helix.

They are drawn as a **field**, not as sprites: per view the flames splat temperature, form, smoke, velocity and
distance into a half-resolution target, and one composite applies the colour ramp to the **sum** (the 2D prototype's
method: the ramp of a summed field gives contours, dark gaps, red tips and a white core as one shape; a sum of ramped
sprites gave fur). A small velocity grid round each fire dancer pushes the flames round the eddies of their own flow
(vorticity confinement), so tongues curl.

| file | what |
|---|---|
| `index.ts` | registers the kind `fire` |
| `fire.ts` | `FirePasses`: buffers, layout, the sim step, the draws, the acts, the light, `focus(view)`; `flameFor(ctx)` (one pool per kit, shared with plasma) |
| `flame.wgsl` | the `Flame` particle, the `FireSim` uniform, the fire and plasma ramps |
| `sim.wgsl` | one step per flame (birth, buoyancy, stirring, the curl's push, the field, plasma's cling, embers) |
| `curl.ts`, `curl.wgsl`, `curlgrid.wgsl` | the curl grids: scatter the flames' velocity, resolve (the field's wind where no flame is), vorticity, confinement |
| `field.ts` | `FlameField`, one per view: its targets and passes, and where in the frame they run (main view: 'air' stage, over `hdr`; a gate's view: end of 'gates', over its `air`) |
| `field.wgsl` | what the field's channels hold, the `FireField` uniform, the torch ramp (form 0.5) |
| `splat.wgsl` | the flames (and the mirror floor's copy) added into the field, each hidden by opaque matter in front of it (the scene's alpha) |
| `composite.wgsl` | the field made light: flow-advected display noise, the fire / torch / plasma ramps by form, smoke laid over; `fs_focus` writes the focus texture |
| `draw.wgsl` | embers and sparks: small points added into the scene |
| `light.wgsl`, `lights.ts` | the world light: one point light per flame dancer (`fireLights(kit)`) |
| `params.ts` | `bend.params.fire` |

The depth contract: nothing here writes the scene's alpha (the opaque view distance). `focus(view)` returns an
`r16float` the size of the view's field: the flames' view distance (m) where they are dense (`focusT`), 6e4 elsewhere
(1e5 doesn't fit a half float).

**A fusion** (play/fusion.ts) is drawn here: both dancers wear `{ kind: 'fire', share, params: { fusion: 1, side } }`
(a whole dancer's flame whatever the share). Those flames carry their side where a form would be (home and flame
`look.x` = 2 + side), move by the field's fusion kind (`fusionMotion`, `fusionRole` in sim.wgsl: a body, the helix's
two strands, storm's rain; past bar 8 thrown outward), splat themselves into `heat.a` and their side into `heat.g`,
and the composite puts that share of a pixel through the kind's ramp (`fusionLook`: steam, prism, storm, aurora).

The ramps have a **shoulder** (`shoulder` in flame.wgsl): above 1 the brightest channel rolls off toward 1.6 and the
others keep their ratio, and the hottest fire is held to a yellow-white, plasma to a violet-white, so a core keeps its
hue and structure instead of clipping to a flat white disc.

Loadouts: `{ kind: 'fire', share, parts?, params?: { form?: 0 … 1 } }`, `{ kind: 'plasma', share, parts? }` (form 1).
The game's per-dancer form is `Dancer.form` (`bend.form(d, v)`), added to the layer's own. See
`docs/reports/1-fire-plasma.md` and `docs/reports/4-fire.md`.
