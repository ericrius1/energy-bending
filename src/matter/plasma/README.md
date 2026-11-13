# matter/plasma: fire's power form, and arcs

Plasma's body is the fire's flames at form 1 (`matter/fire`: one pool, a form per particle), so a dancer can morph
between the two smoothly. This kind registers the loadout name `plasma`, hands its layers to the flame pool, and adds
the arcs: jagged, forking lightning rebuilt on the CPU every frame and drawn as additive capsules before bloom.

| file | what |
|---|---|
| `index.ts` | registers the kind `plasma` |
| `plasma.ts` | `PlasmaPasses`: layers to the flame pool, arcs between a dancer's hands when they are plasma |
| `arcs.ts`, `arcs.wgsl` | `Arcs`: `add(from, to, intensity, frames?)`, midpoint displacement and forks, the draw |
| `params.ts` | `bend.params.plasma` (the arcs) |

From the game: `(kinds.find((k) => k.id === 'plasma') as PlasmaPasses).arcs.add([x, y, z], [x, y, z], 1)` each frame
an arc should show (or once with `frames`). See `docs/reports/1-fire-plasma.md`.
