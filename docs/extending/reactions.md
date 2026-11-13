# The field and reactions

The matter field (`src/matter/field`) is a coarse 3D grid of air that follows the dancers' middle: wind, heat and
wet. Every frame, before any kind's own step, it carries its air along its wind, spreads and fades it, lets heat rise
(cold sink), and lays every dancer's capsules into it: the air near a moving limb is dragged to the limb's velocity,
and warmed, chilled or wetted by the **aura** of what that part of the body wears. A kind never writes its own heat or
wet: a fire arm is hot because it is fire. Reactions (`src/matter/reactions`) are what falls out where heat and wet
meet, whoever brought them: steam now.

## Reading the field from a kind's shader

```wgsl
#include "../field/field"          // from src/matter/<kind>/; no bindings to pass, nothing to set

let w = fieldWind(p);      // vec3f, m/s, world
let h = fieldHeat(p);      // f32: 0 the room, 1 at a flame body's surface, -1 at an ice body's
let wet = fieldWet(p);     // f32: 0 dry, 1 at a water body's surface
let s = fieldSteam(p);     // f32: how fast steam is being made here (heat meeting wet, flame melting ice)
let both = fieldAt(p);     // FieldSample { a: (wind, wet), b: (hot, cold, steam, stir) } in two samples
```

- The field is two `rgba16float` 3D textures and a small uniform, in **bind group 3**, shared with the bodies (joints,
  capsules): `field.ts` re-shares group 3 with the field's three bindings (4, 5, 6) added after the bodies' four. A
  shader that includes `field.wgsl` (or `core/body.wgsl`) is served by that group; you bind nothing. Use them from any
  stage (compute, vertex, fragment): they are sampled with `textureSampleLevel`, so no derivatives are needed.
- **Budget**: including the field costs no storage buffers of its own, but a stage that uses group 3 also counts the
  bodies' two storage buffers (joints, capsules) and two sampled textures. A draw that samples the field in its
  vertex stage therefore has two storage buffers in that stage before its own.
- Outside the box (8.6 × 5.8 × 8.6 m on a desktop, 32 × 24 × 32 cells of 0.26 m on a phone) everything is calm:
  zero wind, zero heat, dry. Values fade to that over the outermost cell.
- The field's step runs first in the `sim` stage, so a kind's step and draws see this frame's field.
- It is coarse (18 cm cells): it tells a particle what the air is doing round it, not where a surface is. For detail,
  add your own noise on top (as the steam does).

### Scales

| value | 0 | 1 | negative |
|---|---|---|---|
| heat | the room | at a flame body's surface (plasma reaches 1.6) | cold: -1 at an ice body's surface |
| wet | dry | at a water body's surface | never |
| steam | none | a strong clash (fire in water, flame in ice) | never |

Heat is kept as two parts that move on their own, hot and cold, which use each other up where they meet (ice melting
by a flame) and leave wet behind; `fieldHeat` is their difference. Where they meet is where the most steam is made.
Values can exceed 1 where several bodies crowd (they are clamped to 4).

What a kind does with them is its own: fire flickers brighter and climbs faster in heat and gutters in wet, water
boils off where it is hot, ice melts where heat is positive, flying particles follow `fieldWind` so a kick's spray
trails it. The PLAN's reactions (water in heat becomes steam, flame in wet dies to smoke, ice near heat melts, water
near ice freezes) are each read off these numbers.

## Putting things into the field from the CPU

The field is `ctx.field` in `declare(ctx)` (a `Field`, `src/matter/field/field.ts`).

```ts
// a point: within r (Gaussian), the air is raised to at least these levels and pushed toward `wind`.
// Once is an impact; every frame is a stream. Up to LIMITS.fieldDeposits a frame (more are dropped, counted in stats).
field.deposit({ p: [x, y, z], r: 0.3, heat: 1, wet: 0, wind: [0, 2, 0], windWeight: 1 });

// a vortex source, named, until changed or removed: the air turns round `axis` at `strength` m/s at `radius`,
// is drawn in at `inflow` m/s and up at `lift` m/s, over `height` m along the axis
field.vortex('fusion', { at: [x, y, z], axis: [0, 1, 0], strength: 3, radius: 0.6, inflow: 0.8, lift: 0.6, height: 1.5 });
field.vortex('fusion', null);

// read the field back at a point (named probes, up to LIMITS.fieldProbes): one to three frames late
const r = field.probe('p1-feet', [x, 0.2, z]);    // FieldReading | null: { wind, heat, wet, steam, up, frame }
const lift = field.updraft('p1-jump', [x, y, z]); // m/s of rising air averaged up 0.75 m above the point (0 at first)
field.unprobe('p1-jump');

field.forms[d] = 0.7;   // dancer d's power form: fire toward plasma, water toward ice (0 … 1)
```

Deposits, vortices and probe points made by the end of the `matter` phase land in this frame's step (the field reads
them in the `post` phase). **Probe latency**: the points are sampled on the GPU in this frame's run, copied to one of
three staging buffers, and mapped after the frame; the value comes back once the GPU has finished, normally the next
frame or the one after. So `probe()` and `updraft()` return what was measured one to three frames ago
(`reading.frame` is the frame it was measured in). That is fine for a jump's lift; don't use it for contact.

### Fusion flows (groundwork)

When two dancers fuse, the game (wave 2) sets a vortex between them each frame, at their middle, axis up, with some
inflow: `field.vortex('fusion', { at: mid, strength, radius, inflow, lift })`, and removes it after. The vortex turns,
draws in and lifts the air; everything that follows `fieldWind` (flying particles, steam, flame) swirls into a shared
centre. Matter still on a body is held by its springs; a kind that wants its body matter to flow into the fusion
blends its home spring toward `fieldWind` by a fusion amount it is given. `?vortex=4` puts a test vortex at the
dancers' middle (with `?field` to see it).

## Adding an aura for a new kind

Auras live in `src/matter/field/auras.ts`:

```ts
export interface Aura { heat: number; wet: number; dry?: number; stir?: number }
// gems   { heat: 0,   wet: 0 }
// fire   { heat: 1,   wet: 0 }               form → plasma
// plasma { heat: 1.6, wet: 0,   dry: 0.6 }   (boils wet away)
// water  { heat: 0,   wet: 1 }               form → ice
// ice    { heat: -1,  wet: 0.3 }
```

Add a line there, or from your own kind's `index.ts` (keeping the edit in your folder):

```ts
import { setAura } from '../field/auras';
setAura('lava', { heat: 1.3, wet: 0, dry: 0.3 }, 'obsidian');   // optional third: the kind its power form becomes
```

A capsule's aura is the auras of the loadout layers worn on its part, weighted by each layer's share of that part,
each at the dancer's form (`field.forms[d]`, or a layer's own `params.form` number). A kind without an aura is calm
(it still drags the air as it moves: `stir` 1). For testing without the real kinds: `?aura=fire,water` treats dancer 0
as wearing fire and dancer 1 water, for the field only (they are still drawn as gems).

## Adding a reaction

A reaction is a matter kind with no homes (`src/matter/reactions/steam.ts` is the example): its `declare` makes a
pool and a compute step in `sim`; dead particles try to be born where the field says so (`fieldSteam`, or a quantity
you derive from `fieldHeat`/`fieldWet`), live ones follow `fieldWind`. It registers from `reactions/index.ts`. If it
needs a new quantity the field doesn't hold, derive it in `step.wgsl` into the spare channel (B.w holds the stir, for
the overlay) rather than adding a texture: each texture costs every field-reading stage a sampled-texture binding.

## Looking at it

`?field` (or `bend.set('field', { overlay: true })`) draws every cell as a dot (orange hot, blue cold, cyan wet,
white where steam is being made) and every other cell's wind as a streak along where the air is going.
`bend.stats().matter.field` lists the box, the deposits, vortices and probes. The tunables are `bend.params.field`
and `bend.params.steam`.
