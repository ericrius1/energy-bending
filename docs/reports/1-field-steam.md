# Wave 1: the matter field and steam

Branch `worktree-agent-ac34b52da4762ab90`. The stub field is replaced by a real one: a coarse 3D grid of wind, heat
and wet that follows the dancers, laid down every frame from the bodies themselves (limbs drag the air, each part
warms, chills or wets it by what it wears), with CPU deposits, vortex sources and a readback of a few probe points.
Steam is the first reaction: a matter kind with no homes, born where the field's heat meets its wet.

Measured: typecheck, build and `npm test` clean; stills in the geode and the redwoods at night with forced auras;
the overlay, the vortex from the side and from above; an 8 s film of steam (contact sheet looked at); GPU timings per
pass; the probe readback's values and latency in a page. Not measured: a phone, real fire/water/ice kinds (they live
in other branches), a long soak.

## How the field works

- **Grid**: two `rgba16float` 3D textures, 48 × 32 × 48 cells of 0.18 m (8.6 × 5.8 × 8.6 m; a phone gets 32 × 24 × 32
  of 0.26 m; both are `FieldOptions`). A = wind xyz + wet; B = hot, cold, steam (what reactions read), stir (overlay).
  Heat is kept as two parts that move on their own and cancel where they meet (flame melting ice, leaving wet);
  `fieldHeat` = hot − cold.
- **The box** follows the mean of the dancers' hips, snapped to whole cells, floor 1.3 m below the hips. The step reads
  last frame's contents through last frame's origin, so moving the box never jumps or blurs the contents.
- **One compute step** (`field.step`, a thread a cell, in `sim` before every kind): semi-Lagrangian advection (two-stage
  back trace), diffusion toward the six neighbours, exponential decay toward calm, exchange of hot and cold, buoyancy
  (hot rises, cold sinks), then the sources: every capsule of every dancer (Gaussian falloff past its surface, `reach`
  0.14 m) drags the air toward its velocity and raises hot/cold/wet toward its aura level, plasma's `dry` takes wet away;
  then the CPU deposits and vortex sources. Every rate is `1 − exp(−rate·dt)`, dt clamped to 1/20 s: stable at any
  frame time. Wind is capped at 12 m/s, scalars at 4. Then a copy of the written textures over the sampled ones.
- **Tunables**: `fieldParams` (`bend.params.field`), steam's `steamParams` (`bend.params.steam`).

## How a kind reads it

```wgsl
#include "../field/field"        // from src/matter/<kind>/
fieldWind(p) -> vec3f   fieldHeat(p) -> f32   fieldWet(p) -> f32   // the stub's signatures, unchanged
fieldSteam(p) -> f32    fieldAt(p) -> FieldSample { a, b }          // extras
```

- **Bind group 3**, bindings 4 (`fieldA: texture_3d<f32>`), 5 (`fieldB`), 6 (`fieldBox: FieldBox` uniform), after
  the bodies' 0–3. `Field` re-shares group 3 (`kit.shareGroup(3, group.wgsl, …)` with the bodies' buffers and its
  own), so including `field.wgsl` (or `core/body.wgsl`) is all a shader does. Sampled with `samp_linear` from weft's
  frame group, `textureSampleLevel`, so any stage works.
- **Budget**: no storage buffers of its own, but a stage that uses group 3 counts the bodies' two storage buffers and
  the two sampled textures. A draw that samples the field gets joints and segs counted in its stages.
- **Scales**: heat 1 at a flame body's surface (plasma 1.6), −1 at ice's; wet 1 at water's; steam ~1 a strong clash.
  Zero (calm, dry) outside the box, fading over its outermost cell.
- Constants: `FIELD_DEPOSITS`, `FIELD_VORTICES`, `FIELD_PROBES`, `STEAM_MAX` in `engine/limits.wgsl`.
- Guide: `docs/extending/reactions.md`.

## Auras and forms

`src/matter/field/auras.ts`: `gems {0, 0}`, `fire {heat 1}`, `plasma {heat 1.6, dry 0.6}`, `water {wet 1}`,
`ice {heat −1, wet 0.3}`; fire's form is plasma, water's is ice. A capsule's aura is the sum over the loadout layers
worn on its part, each weighted by its share of that part, each at its form: `field.forms[d]` (0 … 1, per dancer slot;
nothing stored forms before, so the field owns this array for the game to set) or a layer's own `params.form` number.
Every body stirs the air (`stir` 1), whatever it wears. `field.presence[d]` (default 1) scales a dancer's heat and wet,
for a body whose matter is in a heap or shattered (see weak points). `setAura(kind, aura, form?)` lets a new kind add its
own from its `index.ts`. Debug: `?aura=fire,water` (or `fire,ice`, `plasma,…`) overrides the loadouts for the field.

## APIs (on `ctx.field`, `Field` in field.ts)

- `deposit({ p, r, heat?, wet?, wind?, windWeight? })`: within r (Gaussian) the air is raised to at least these
  levels and pushed toward `wind`. Once is an impact, every frame a stream. Up to 32 a frame (extras dropped and
  counted). Deposits made by the end of the `matter` phase land this frame (flushed in `post`). Tested: six frames of
  a deposit at (2.5, 1.5, 2.5) read back wind 2.7 m/s up, heat 0.57, wet 0.60, steam 0.35, updraft 2.27 m/s.
- `vortex(id, { at, axis?, strength, radius, inflow?, lift?, height? } | null)`: a named vortex source (Rankine core,
  inflow toward the axis, lift along it), up to 4. This is the fusion hook: the game sets `vortex('fusion', …)` at the
  dancers' middle each frame of a fusion and removes it after; everything following `fieldWind` swirls in. `?vortex=4`
  sets a test one at the dancers' middle (`fieldParams.testVortex`).
- `probe(id, p) → FieldReading | null` (`{ wind, heat, wet, steam, up, frame }`), `updraft(id, p) → number` (m/s of
  rising air averaged over 0.75 m above p), `unprobe(id)`. Up to 16 named probes. **Latency**: sampled on the GPU in this
  frame's run, copied into one of three staging buffers, mapped after the frame; a reading is one to three frames old in
  real time (`reading.frame` says which frame). Stepped by hand (`bend.step`, which waits for the GPU), it came back
  by the next step every time (age 0 against the frame index read afterwards). Measured near the fire dancer's hips:
  heat 0.66, updraft 0.11 to 0.26 m/s; near the water dancer's: wet 0.84 to 0.87.
- Stats: `bend.stats().matter.field` (box, deposits, vortices, probes, aura source); the field object is reachable for
  tests as `bend.show.kinds.find((k) => k.id === 'field').field`.

## Steam

`src/matter/reactions/` registers kind `steam` (9,000 puffs, a phone 3,000; 32 bytes each). A dead puff picks a place
(70 % near a random capsule, 15 % near last frame's deposits, the rest low in the box) and is born there with a
chance set by `fieldSteam`, which the step makes from `hot·wet` above a small threshold (so two auras' faint tails a
metre apart make none), more where hot meets cold. A live puff eases to the field's wind plus its own fading lift
plus a slow curl, grows (0.07 → 0.24 m) and fades over 1.8–3.2 s. Drawn in the glow phase per world: pale, a little
self-luminous, lit by the world's ambient and key, warmed orange by `fieldHeat`, white-hot where steam is being made,
three soft lobes per puff; premultiplied "over" that leaves the scene's alpha (the view distance) alone.

## Timings (RTX 5090, 1280 × 800, weft profiler over 150 stepped frames, two dancers, 15k gems)

| pass | ms |
|---|---|
| field.step (73,728 cells, 2 dancers × 25 capsules) | 0.023 – 0.027 |
| field.probe (4 points) | 0.002 |
| field.copy | not timed separately (a raw copy of 1.2 MB) |
| steam.sim (9,000 puffs) | 0.003 – 0.005 |
| steam draw, geode | ≈ 0.28 (scene 0.496 with steam vs 0.214 without aura, same steps) |
| overlay (when on) | not separated: scene 0.448 with the overlay on and steam drawn at density 0 (its fill still paid) |

The field is well under the 0.3 ms target. The steam draw is the cost: fill and 4× MSAA blending of soft sprites.
It started at ≈ 1 ms (16k puffs, noise per pixel) and came down with fewer births, smaller puffs and lobes instead of
noise. Redwoods night scene with steam 1.32 ms (the foundation's redwoods day scene was ≈ 0.93; not the same hour, so
not a clean comparison).

## Stills (docs/reports/media/field-*.jpg)

| file | what it shows |
|---|---|
| `field-overlay.jpg` | `?field&aura=fire,water`, steam hidden: orange (hot) cells round and above the fire dancer, cyan (wet) round the water dancer, faint wind streaks off the limbs |
| `field-steam-geode.jpg` | the salsa with dancer 0 fire, dancer 1 water (both drawn as gems): steam billowing up behind and between them |
| `field-geode-no-aura.jpg` | the same frame with no auras: no steam (the baseline for timing) |
| `field-steam-redwoods-night.jpg` | 21:36: steam rising between the dancers, lit warm by the "fire" dancer's heat |
| `field-steam-ice-fire.jpg` | `aura=fire,ice`: steam where heat meets cold, a larger cloud rising beside them |
| `field-vortex-side.jpg`, `field-vortex-above.jpg` | `?field&vortex=4`: the test vortex's wind streaks, from above a clear swirl round the dancers |
| `field-steam-film-contact.jpg` | six frames of an 8 s film (`film.mjs --query aura=fire,water`): steam as the dancers rise and move; one frame shows a cloud over the heap before they rise |

## Honest weak points

- **Depth of field and steam**: steam writes no view distance, so the DoF blurs it as if it were at the depth behind it.
  In the geode, steam over the out-of-focus crystal wall turns the wall's bokeh into bright white discs (visible in
  every geode steam still). A fix needs the steam's distance in the scene alpha, which one blend state can't do with
  premultiplied colour; a separate pass or a different DoF input would.
- **Steam over a heap**: the field's auras come from the skeletons, which stand while their matter lies in a heap, so
  in the film a cloud forms before the dancers rise. `field.presence[d]` is there to fix it, but nothing sets it yet (the
  show is outside my folders).
- With forced auras on a salsa couple (always touching) steam is nearly constant; real kinds with real clashes will
  make it come and go. The steam looks soft and cloudy, not as wispy and luminous as the 2D reference; there is no
  sorting, so dense steam can look flat.
- The wind is not divergence-free (no pressure solve): it is drag and decay, fine for trails, not for swirling eddies
  of its own beyond the vortex sources and the curl noise in steam.
- Steam costs ≈ 0.28 ms of fill on a 5090 at 1280 × 800; on a phone it will need fewer, smaller puffs or half-res.
- The overlay is a point-splat of cells, not a ray march; dense, and blurred by the DoF.
- Readback latency in real time (rAF) was not measured, only stepped; the ring of three staging buffers is the same
  pattern as the gems' sound events.

## Not done

Smoke (flame in wet), quench, melting and freezing as reactions of their own, the fusion's body-matter flows beyond the
vortex source, a pressure projection, the phone, and wiring `presence` and `forms` from the show/game.

## Edits outside my folders (for the merge)

- `src/main.ts`, one line: `const field = new Field();` → `const field = new Field({ kit, frame, bodies, coarse, query });`
  (the field needs the kit, the frame and the bodies' buffers, and must exist before any kind or world builds a
  pipeline against group 3).
- `src/engine/limits.ts` + `limits.wgsl`: four caps added at the end: `fieldDeposits` 32, `fieldVortices` 4,
  `fieldProbes` 16, `steam` 65,536 (`FIELD_DEPOSITS`, `FIELD_VORTICES`, `FIELD_PROBES`, `STEAM_MAX`). `npm test` checks
  them.
- Not edited, but changed in effect: bind group 3 is now shared by `Field` with the bodies' four bindings plus the
  field's three. If `core/body.wgsl` gains a binding, `field.ts` must pass it too (weft throws loudly if it doesn't).
- New: `docs/extending/reactions.md`, `scripts/steps/field.json`, `docs/reports/media/field-*.jpg`, this report.
