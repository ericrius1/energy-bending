# Wave 1: fire and plasma

Bodies of flame and of plasma, as matter kinds, alone or mixed with gems; plasma's arcs; the fire's light for the
worlds. Branch `worktree-agent-a34a04237b686b67e`.

Measured: typecheck, build and `npm test` clean; stills of every case asked for (below) on the RTX 5090 through
`scripts/shot.mjs`; GPU time per pass with and without fire; a 6 s clip as 180 stills at 30 fps (contact sheet below). Not
measured: a phone or any `coarse` device, the field's real wind/wet/heat (the field is still the calm-air stub, so
those paths compile and run with zeros but were never seen doing anything), the light uniform inside a world shader
(nobody reads it yet).

## What it is and how it works

**One pool of flames, a form per particle.** `fire` and `plasma` are both registered loadout names, but they share one
pool of GPU particles (`FirePasses`, made once per kit through `flameFor(ctx)`). Each particle has a home on a capsule,
laid out by `matter/core/layout.ts` exactly as the gems' are (even spacing, no gem roles), and a *form* 0 … 1: the
layer's own (`plasma` layers are 1, a `fire` layer's `params.form`, default 0) plus its dancer's (`form[d]`, set by
the game). So a dancer morphs from fire to plasma smoothly, per dancer, and a loadout can mix fire, plasma and gems by
body part.

**A flame's life** (`fire/sim.wgsl`). A dead flame is born again at its home, now: position on the capsule surface,
the limb's velocity (× `inherit`), a little outward and upward push, a temperature (hotter inside the body and on the
torso), a life of ~0.3 … 0.9 s. Alive, it rises (buoyancy × temperature), is stirred by two scales of a climbing flow
plus `fieldWind`, relaxes to the air's speed, cools (`T = T0 (1 − age/life)²`), and dies. So the body is always the
figure, and its motion leaves the flames born along the way behind it: a kick throws a sheet, a spin a helix, a still
dancer burns upward. 3.5 % of the slots are ember slots: off a fast limb they become embers (long-lived, small, hot,
drifting up on the air); off plasma they are crackling sparks. Plasma (form → 1) is held by an implicit spring to its
moving home, barely rises, is stirred four times faster and lives a third as long. First births are staggered by a
random wait, so flames never beat in step.

**The field.** At birth: `fieldWet` shortens life, cools and turns the flame to smoke (drawn by a separate premultiplied
"over" draw that darkens); `fieldHeat < 0` (near ice) shortens and shrinks it. Alive: `fieldWind` is the air it relaxes
to. Nothing is written to the field.

**The look** (`fire/draw.wgsl`). Each flame is a camera-facing sprite stretched along its velocity (a streak thins as
it lengthens, so a fast limb leaves thin licks, not petals), with a tongue-shaped falloff eroded by a tileable noise
texture that climbs. The temperature goes through the reference ramp `pow(T, (1, 2, 3.6)) × (1.75, 0.95, 0.6)` with
the reference's display noise, and is added into the HDR scene, so where hundreds overlap at the body the sum goes
white-hot and feeds bloom; the edges stay orange and deep red. What makes tongues and dark gaps out of 150k sprites is a
noise in the *air* (world space, tall and thin, climbing ~0.8 m/s) that dims the flames sitting in its low regions:
the 2D original's display noise moved from the screen into the world. Plasma replaces it with ridged filament noise
(fine, stretched up, crawling fast), the plasma ramp (violet → magenta → white), a white thread down each streak and a
~40 Hz flicker. Flames min-blend their view distance into the scene's alpha (where they show), so the depth of field
and the air place a body of fire where it is, not at the wall behind it. On the geode's mirror floor a dimmed mirrored
copy is drawn.

**Arcs** (`plasma/arcs.ts`, `arcs.wgsl`): built on the CPU each frame, as in the 2D original: midpoint displacement
(16 segments, 8 if short), roughness 0.22 of the length halving each level, one or two forks (8 segments, turned
0.4 … 1 rad, thinner and dimmer, free end), rebuilt with new random numbers every frame (that is the flicker),
deterministic from the frame number. Drawn as camera-facing capsules: a white-hot core (at least ~1 px wide at any
distance) in a violet glow, additive, before bloom. The plasma kind arcs between a dancer's own hands whenever the
flame on its hands is past form 0.4 and they are within 1.5 m (on ~82 % of frames, so the strokes stutter).

**The acts.** `rise` relights the body from the feet up over the rise's spread; `shatter` blows the flames outward from
the blast and lets the fire go out; `settle(true)` lets it go out. A game that never calls the acts gets a body that
burns.

## The API other agents use

```ts
// loadouts (bend.loadout(d, …) or a programme's cast)
{ kind: 'fire',   share, parts?, params?: { form?: number } }   // form 0 (default) … 1
{ kind: 'plasma', share, parts? }                               // flames at form 1, plus the hand arcs

// the per-dancer form: the game animates it (0 fire … 1 plasma), added to each layer's own form
const fire = kinds.find((k) => k.id === 'fire') as FirePasses;   // matter/fire/fire.ts
fire.form[d] = 0.7;
fire.handForm(d);            // the form of the flame on d's hands now (0 if its hands aren't flame)
fire.weightOf(d);            // how much of dancer d is flame (0 … 1)
fire.flameLights;            // the lights as last written (CPU copy)

// arcs: one frame each, call every frame (or pass `frames` to keep it that many frames, re-forked each frame)
const plasma = kinds.find((k) => k.id === 'plasma') as PlasmaPasses;  // matter/plasma/plasma.ts
plasma.arcs.add([x, y, z], [x, y, z], intensity /* 0 … 2, 1 = a dancer's own */, frames = 1);
plasma.form;                 // the same array as fire.form

// the world light: one small uniform per kit, made by whoever asks first (a world can bind it when it is made)
import { fireLights } from '../../matter/fire/lights';
draw bind: { fireLights: fireLights(kit) }
```

```wgsl
#include "../../matter/fire/light"                         // structs and a helper, no bindings
@group(1) @binding(N) var<uniform> fireLights: FireLights;  // your own group and binding
col += albedo * fireLightAt(fireLights, worldPos, normal);
// FireLights { count: u32, lights: array<FireLight, MAX_DANCERS> }
// FireLight  { pos: vec4f /* xyz, w = the body's radius (m) */, col: vec4f /* rgb × intensity, w = intensity */ }
```

One light per dancer wearing flame, at the middle of its hips and chest + 10 cm, radius 0.45 m, colour (1, 0.42, 0.12)
for fire to (0.62, 0.32, 1.0) for plasma by the dancer's form, intensity `fire.light` (2.5) × how much of the dancer
is flame × the burn × a flicker (faster and deeper for plasma). It falls to 0 when the fire is out. `fireLightAt` is
wrap-lit, inverse-square softened by the radius.

**Parameters**: `bend.params.fire` (`perDancer` 150k, `perDancerCoarse` 40k, motion: `life`, `buoyancy`,
`turbulence`, `drag`, `inherit`, `heat`, `embers`, `cling`; look: `size`, `intensity`, `stretch`, `erode`, `tongues`,
`reflect`, `emberGlow`, `smoke`, `plasmaGlow`, `flicker`; `light`), `bend.params.plasma` (the arcs: `handArcs`,
`handReach`, `handDuty`, `width`, `minPx`, `roughness`, `forks`, `glow`).

**Counts.** A dancer wearing nothing but flame gets `perDancer` flames (`perDancerCoarse` when `ctx.coarse`), a dancer
wearing it on part of the body its share, all scaled by `resize(budget)`: `budget.count / 15000` (the show's stone
count over its default, clamped 0.3 … 2). Capped at `LIMITS.flames` (262,144) across all dancers, so two full fire
dancers get 131k each. With no flame dancer the simulation and the draws are switched off (0 cost).

**Binding budget.** Fire sim: 4 storage buffers (homes, flames + the shared joints, segs), plus whatever the field adds
when it becomes textures. Flame draw: 1 storage buffer (vertex), 1 sampled texture. Arc draw: 1 storage buffer.

## Timings (GPU, RTX 5090, 1280×800, render scale 1, weft's profiler over 150 frames)

| what (geode unless said) | scene pass | fire's share | fire.sim |
|---|---|---|---|
| no fire (both dancers gems), wide | 0.183 ms | 0 | 0 |
| one fire dancer (150k) + one gem dancer, wide | 1.08 ms | ~0.90 ms | 0.008 ms |
| the same, mirror copy off | 0.96 ms | ~0.78 ms | 0.009 ms |
| the same at 100k flames (mirror on) | 1.05 ms | ~0.87 ms | 0.007 ms |
| two fire dancers (131k each), wide, 900 frames in | 3.15 ms | ~3.0 ms | 0.015 ms |
| one plasma dancer + gems, close, with arcs | 0.80 ms | ~0.62 ms | 0.011 ms |
| redwoods 21:36, one fire dancer + gems, wide | 2.69 ms | ~1.7 ms (the redwoods' own scene is ~0.93) | 0.010 ms |
| one fire dancer, close shot (an earlier iteration: slightly smaller, brighter sprites) | 4.2 ms | ~4 ms | 0.011 ms |

The flames are fill-bound: the simulation is ~0.01 ms and halving the count barely changes the scene pass; what costs
is how much of the screen the fire covers (a close-up of a dancer costs four times a wide shot). Two full fire
dancers filling the frame, at ~3 ms, are the case to watch on a laptop; `size` (sprite size) is the lever, then the
render scale. A dry-fire smoke draw was removed from the default (it cost about a third of the fill for smoke nobody
could see on the dark); smoke now comes only from wet, and with the field's wet at 0 every smoke sprite is culled in
the vertex stage.

## Stills (docs/reports/media/1-fire-*.jpg, 1280×800, read back with bend.grab)

| file | what it shows | what's wrong |
|---|---|---|
| `1-fire-geode.jpg` | the salsa couple both in fire, wide, mid-dance: white-hot bodies, orange skins, tongues climbing off the heads and shoulders | the edges read a little furry (many thin streaks) rather than as smooth licking tongues |
| `1-fire-geode-close.jpg` | the same, close | close up the core is mostly white; less orange than the reference |
| `1-fire-redwoods-night.jpg` | 21:36 in the redwoods, the fire dancer beside a Sky gem dancer, flames rising off the shoulder | a hard horizontal seam crosses the faint flame tips at the meadow's horizon (not understood yet: probably the air pass or depth of field treating the faint tips by the distance behind them; writing the flame's distance down to fainter flames did not remove it); the world isn't lit by the fire (the light uniform is unread) |
| `1-fire-trail.jpg` | the pirouette in fire, orbiting camera: the turning arm leaves a wing of flame | a spin's helix shows in the film more than in a still |
| `1-mixed-gems-fire.jpg` | one dancer: Ember gems on the torso and head, fire on the arms, hands, legs and feet | |
| `1-plasma-arc.jpg` | a plasma dancer (violet, filamented, flickering) with an arc from its hand to the gem dancer's head, forking | |
| `1-morph-0/05/1.jpg` | the same dancer at form 0, 0.5 and 1 (40 to 60 frames apart, so the pose moves a little) | 0.5 reads as a pink ghost: it is a crossfade of the two looks |
| `1-duo-fire-gems.jpg` | one fire dancer and one gem dancer | |
| `1-film-contact.jpg` | 8 frames of the 6 s clip (salsa, the fire dancer and a Sky gem dancer, close), 0.73 s apart: the body stays a figure, an arm swing throws a wing of flame, flames climb off the head | the clip itself (180 stills at 30 fps, `shots/fire-film.mp4`, not committed) has no sound |

Reference comparison (`docs/element-looks/01`, `04`): the fire matches the ramp (deep red edges, orange, white-hot
core), rises, and leaves embers; it is denser and less tongue-shaped than the 2D fluid, whose vorticity makes long
coherent licks that independent particles do not. The plasma reads instantly as not-fire: violet threads, white cores,
flicker, no rise, crackling sparks, and the arc is the reference's bolt.

## Honest weak points

- **Tongues are faked**, by a noise in the air that dims flames, not by the flow. It reads as fire, but up close the
  texture is many short streaks (fur) rather than the 2D fluid's smooth curling licks. A real fix is a coarse velocity
  grid with vorticity (the field agent's grid could carry it) or splatting the flames into a low-resolution
  temperature volume and shading that.
- **Fill cost** grows with screen coverage (see timings). Not tested on a phone; `perDancerCoarse` is a guess.
- **The form morph** is a crossfade of looks and motions per particle; at 0.5 it is a pinkish ghost, neither one.
- **Smoke** only appears with wet, which the field stub never reports: the smoke draw was compiled but never seen.
- **Field reactions** (wet, cold, wind) are wired but untested for the same reason.
- **The world light** is written every frame but no world reads it yet; it was not seen lighting anything.
- **A seam in the redwoods** across faint flame tips at the horizon (see the stills).
- **Additive with depth test, no sorting**: flames behind a gem body are hidden by it correctly; flames in front of
  another fire body simply add (right for fire).
- The hand arcs connect a dancer's own two index fingers; arcs between two plasma dancers are the game's to add.

## Not done

- No fire light in the world shaders (another agent's job; the uniform and helper are ready).
- No steam/quench reactions (the reactions agent's), no writing heat into the field (the field derives it).
- No arc between dancers by itself; no arc lighting the air or the floor (the 2D original stamped a faint capsule).
- No phone measurement, no `?lowlimits` run.

## Edits outside my folders

- `src/engine/limits.ts`: two caps, `flames: 262_144` and `arcSegments: 4096` (TS only: no shader indexes by them, so
  `limits.wgsl` is unchanged).
- `scripts/shot.mjs`: a step may have `eval` / `eval2` (a script run in the page with `bend`, before / after the step's
  frames, then `frames2` more). Needed to set loadouts and forms in captures. Four lines and the header comment.
- `src/matter/gems/gems.ts` (a bug fix): when no dancer wears gems (`layout([])`) the stones kept their last homes and
  were drawn inside the fire bodies. Now every stone becomes a spare (falls and fades, as a smaller budget does) and the
  budget comes back when a dancer wears gems again (`resize` keeps the programme's count in `budget`; the old body of
  `resize` is `resizeTo`). Seen fixed in `1-fire-geode.jpg` and `1-fire-trail.jpg`.
- New step files: `scripts/steps/fire.json` (the stills and timing variants), `fire-film.json` (the clip),
  `fire-iter.json` (the four-still loop I iterated with), `fire-probe.json`.

Nothing in `src/matter/core` changed.

## Notes for others

- The render lock was the bottleneck of this work (waits of 10 to 30 minutes per capture). Editing `src/` while a
  capture runs reloads the page (Vite) and the capture continues on a fresh default page: I lost one film that way.
- Port 5401 on 127.0.0.1 is taken by another project's report server; this worktree's dev server answered on `[::1]`
  (`--url "http://[::1]:5401/energybending/"`).
