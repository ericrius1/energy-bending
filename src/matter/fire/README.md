# matter/fire: bodies of flame (and plasma's flames)

One pool of GPU particles for every dancer wearing `fire` or `plasma`. Each particle has a home on a capsule (laid out
by `matter/core/layout.ts`, as the gems' are), and lives a fraction of a second at a time: born at its home with the
limb's velocity, it rises, is stirred and cools, then is born again at its home. A still dancer burns upward like a
torch; a kick leaves the flames born along its path behind it as a sheet; a spin, a helix.

| file | what |
|---|---|
| `index.ts` | registers the kind `fire` |
| `fire.ts` | `FirePasses`: buffers, layout, the sim step, the draws, the acts, the light; `flameFor(ctx)` (one pool per kit, shared with plasma) |
| `flame.wgsl` | the `Flame` particle, the `FireSim` uniform, the colour ramps |
| `sim.wgsl` | one step per flame (birth, buoyancy, stirring, the field, plasma's cling, embers) |
| `draw.wgsl` | stretched soft sprites eroded by climbing noise: flames (additive), smoke (premultiplied over), the mirror floor's copy |
| `light.wgsl`, `lights.ts` | the world light: one point light per flame dancer (`fireLights(kit)`) |
| `params.ts` | `bend.params.fire` |

Loadouts: `{ kind: 'fire', share, parts?, params?: { form?: 0 … 1 } }`, `{ kind: 'plasma', share, parts? }` (form 1).
The game's per-dancer form is `(kinds.find((k) => k.id === 'fire') as FirePasses).form[d]` (0 … 1, added to the
layer's own). See `docs/reports/1-fire-plasma.md` for the whole API, the light and the timings.
