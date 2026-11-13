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
let dry = fieldDry(p);     // f32: how dry the air is: 0.6 at a plasma body, 0 at fire's (tells plasma's heat from fire's)
let both = fieldAt(p);     // FieldSample { a: (wind, wet), b: (hot, cold, steam, dry) } in two samples
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
field.presence[d] = 0; // how much of dancer d's matter is on its body (0 … 1): a heap gives the air no heat or wet
```

Deposits, vortices and probe points made by the end of the `matter` phase land in this frame's step (the field reads
them in the `post` phase). **Probe latency**: the points are sampled on the GPU in this frame's run, copied to one of
three staging buffers, and mapped after the frame; the value comes back once the GPU has finished, normally the next
frame or the one after. So `probe()` and `updraft()` return what was measured one to three frames ago
(`reading.frame` is the frame it was measured in). That is fine for a jump's lift; don't use it for contact.

### Fusion: the helix and the steam's look

When two dancers fuse, the game stages it on the field, once or every frame as the amount eases:

```ts
field.fuse({ dancers: [0, 1], kind: 'storm', amount: 0.8, strength: 2.2, tightness: 1 });  // 'steam' | 'prism' | 'storm' | 'aurora'
field.fuse(null);                     // or amount 0: nothing at all (a strict no-op in the field and in steam)
field.fusionFront                     // { kind, amount } as steam reads it
```

The field winds the two dancers' auras (each body's average) into a slow **double helix** round a vortex at their
middle: two strands half a turn apart, `radius` 0.32 m, `height` 1 m either side of the centre, `tightness` turns per
metre, turning at `speed` rad/s, `width` 0.12 m; `auras: [a, b]` gives the strands' auras directly instead of the
dancers'. Where the strands are, the field holds the two matters (fire's heat on one, water's wet on the other), so
steam is made between them; the strands themselves also breathe a little steam (0.35 of a strong clash), so the helix
reads in steam whatever the two matters are. The vortex (strength × amount at 1.4 × the radius, with inflow and lift)
is the field's own and does not take one of the four `vortex` slots' names, though it does take a slot. Steam is born
along the strands and swirls up the vortex, and takes the fusion's look: **steam** white with cyan and orange licks,
**prism** thin vapour in thin-film colour, **storm** dark and heavy, lit by flickers from inside, **aurora** green
rising into violet, drawn out upward. Matter still on a body is held by its springs; a kind that wants its body
matter to flow into the fusion blends its home spring toward `fieldWind` by the amount. `?vortex=4` puts a plain test
vortex at the dancers' middle (with `?field` to see it).

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
each at the dancer's form (`Dancer.form`, copied into `field.forms[d]` each frame, or a layer's own `params.form`
number), times `Dancer.presence` (none while the matter is in a heap or shattered). A kind without an aura is calm
(it still drags the air as it moves: `stir` 1). For testing without the real kinds: `?aura=fire,water` treats dancer 0
as wearing fire and dancer 1 water, for the field only (they are still drawn as gems).

## One field, one world

The field is one box that follows the dancers of the main view's world (`Dancer.world`, kept by the portals): a dancer
through a gate in another world lays down no aura here, and has no field there. Steam, born of the field, is drawn in
the main view only (a gate's view and the ?pip inset show none, even of the same world), over the focused image after
the depth of field (`MatterPasses.declarePost`: steam has no one distance for the depth of field to read). A field per
world (or per gate view) is an open item.

## Adding a reaction

A reaction is a matter kind with no homes (`src/matter/reactions/steam.ts` is the example): its `declare` makes a
pool and a compute step in `sim`; dead particles try to be born where the field says so (`fieldSteam`, or a quantity
you derive from `fieldHeat`/`fieldWet`), live ones follow `fieldWind`. It registers from `reactions/index.ts`. If it
needs a new quantity the field doesn't hold, derive it in `step.wgsl` from what is there rather than adding a texture
(each texture costs every field-reading stage a sampled-texture binding). There is no spare channel left: B.w, once
the stir for the overlay, now holds plasma's dryness.

### How steam meets (the example)

Steam does not trust the field's 18 cm cells for where two bodies touch: a dead particle picks a random point on a
random capsule's axis, finds the nearest capsule of any other dancer, and if the two surfaces are within `gap` (7 cm)
or cross, takes a point on the contact (the ring where two crossing capsules' surfaces meet, or the middle of the
gap). It is born there with a chance set by `fieldSteam` at that point, so only matter that reacts makes anything.
The pair is read off the field there: plasma is dry (`fieldDry` past 0.06 to 0.25) or hotter than fire (heat past
1.15 to 1.45), ice is cold (cold past 0.03 to 0.2). One pool holds four sorts: **fronts** (white-hot streaks along the
contact, 0.12 s each, born again every frame: a crisp line that follows the contact and is gone when the bodies part),
**wisps** (vapour boiling out of the contact and up, gone within about a second), **drips** (flame on ice) and
**sparks** (plasma on water). Wisps are drawn at half resolution into their own target and composited after the depth
of field with a soft blur and a per-pixel cap (`cap` 0.45 of what is behind, never brighter than `maxBright` 0.85
of white); fronts, drips and sparks go on top at full resolution, the only steam allowed past 0.85.

## Looking at it

`?field` (or `bend.set('field', { overlay: true })`) draws every cell as a dot (orange hot, blue cold, cyan wet,
white where steam is being made) and every other cell's wind as a streak along where the air is going.
`bend.stats().matter.field` lists the box, the deposits, vortices and probes. The tunables are `bend.params.field`
and `bend.params.steam`.
