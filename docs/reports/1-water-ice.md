# Wave 1: water and ice

Branch: `worktree-agent-a8e3aa917f96cbabe`. Two matter kinds, `water` and `ice`, that are one pool of particles: a
dancer can wear water, ice, or either mixed with gems (or with each other), a dancer's water freezes into ice where
it stands (a wave climbing from the feet) and melts back, and the game can lay **set ice** in the world that bodies
stand on, that melts and shatters. Water is drawn as a screen-space liquid surface; ice as faceted shards.

Measured: typecheck, build and `npm test` clean; stills of every case asked for, looked at and iterated on (six
rounds); a 6 s clip at 30 fps with a contact sheet; GPU timings per pass at the default count on the RTX 5090; the
set-ice logic (ledges, save/load, melt, hit, expiry) run in Node. Not measured: a phone or `coarse` device, the pip
view with water, a real field (the field is still the calm-air stub, so heat, cold and wind paths have run only at
zero).

## What it is and how it works

**One pool, two faces** (`src/matter/water/pool.ts`). Each particle has the core's `Particle` and `Home` plus an `Aux`
(water.wgsl): how frozen it is (0 water … 1 ice), foam, gone (boiled away), last frame's freeze. Both kinds' layers are
laid out together by the core `layoutHomes`; an `ice` layer's homes carry 1 in `look.x` (born frozen), a `water`
layer's 0. The registry sees two `MatterPasses` (`WaterPasses`, ids `water` and `ice`), both faces of the same pool,
made by whichever is declared first (a `WeakMap` by kit, so not a global setting). Only the first-declared face runs
the frame and the acts; both forward `layout`, `resize` and `declareView` (idempotent).

**Motion** (`sim.wgsl`, 'sim' stage, 4 own storage buffers + the 2 shared = 6 of 8). The core mode machine
(`bodyStep`) does the motion, with its `BodyStep` blended per particle between water (stiffness 60, damping 7,
drips, speed-shed) and ice (stiffness 420, no shedding). Water hangs loosely and ripples (waves along the body, along
each home's normal); fast limbs shed; a shed drop keeps its limb's velocity plus a fling (`spray`), so a kick throws a
sheet and a spin a spiral; drops fall, splash on the floor (`world.groundAt` under the dancers) sideways and up with
foam, gather after a fraction of a second and fly home on a spring three times stiffer than the gems' return. Asleep,
the water lies in a puddle round each dancer and rises with the show's `rise`; `shatter` and `settle` work as for gems.
The field: `fieldWind` pushes water (spray most); `fieldHeat` above `meltHeat` melts ice (a melting particle on the body
is let go as a drip), above `boilHeat` water thins away (`gone`, back at home when cool); below `-freezeCold` water
freezes.

**Form.** `form(d, v)` sets a dancer's target; the shown form eases toward it at 0.55/s, and each particle's target
state is a smooth step at its home's height against the form's front, so the freeze climbs from the feet and melts
back down from the head; each particle then changes state at `freezeRate` (with a little randomness).

**The water surface** (`surface.ts`, `splat.wgsl`, `smooth.wgsl`, `surface.wgsl`). Per view, own targets:
1. `water.splat.depth`: liquid particles as sphere impostors writing true sphere depth into an own `depth32float`
   and the view distance into `r32float`;
2. `water.splat.thick`: the same spheres added (no depth test) into `rgba16float`: chord thickness, foam, frost;
3. `water.smooth.x/y` ×3: a separable bilateral blur (world-sized kernel, depth falloff) into `rgba32float`;
4. `water.scene.copy` + `water.surface`: the composite (one pipeline per world for its light) over the view's
   resolved `hdr`: where the water is nearer than the scene (the scene's alpha is its view distance) it rebuilds
   position and normal from the smoothed depth (2-texel differences, nearer side at edges), refracts the scene behind
   (bent by the normal and thickness, three taps for dispersion, rejecting taps from in front), absorbs it with
   thickness toward deep blue with the world's light scattered in, mixes the world's reflection by Fresnel, adds
   sharp key and rim glints, a cyan rim where thin, foam where thin and fast, and writes the water's distance into
   alpha.
Flying drops also get glinting star sprites (`drops.wgsl`, glow phase).

**Ice** (`src/matter/ice/`). `shards.wgsl`: a jagged hexagonal crystal built from the vertex index (24 flat
triangles, no mesh buffer) on every 14th particle, pointing out of the body (the core's `bodyOrient` with `order` 1,
plus a random tilt), grown as its particle freezes and shrunk as it melts. Shading: steep facet light (`diff³`),
thin-to-thick tint (pale steel blue to navy), the world refracted inside with dispersion, a tinted Fresnel reflection
(glossier when wet), bright facet edges from barycentrics, a frosted rim broken by 120/m noise, a frost front where it
is just freezing, glints that flash one facet at a time six times a second, and the key's sparkle. `mist_sim.wgsl` /
`mist_draw.wgsl`: a ring of 24,576 motes reborn at random frozen particles: one in four is cold mist that sinks and
spreads on the floor, the rest glittering dust that drifts down (additive, glow phase).

**Set ice** (`setice.ts`, pure logic, drawn by the same shard pipeline with `SET = 1`). A piece is a path, a width
and a life. Its shards come from its seed (a level slab along the path, most pointing up and out, a fifth hanging
under as icicles), each growing when the freeze running along the path at 4 m/s reaches it; they wane at the end of
life, shrink as they melt and fly apart under gravity when shattered.

## The API other agents use

```ts
// loadouts (any mix; parts as for gems)
{ kind: 'water', share, parts? }         // liquid; follows the dancer's form
{ kind: 'ice', share, parts? }           // born frozen, stays frozen unless heat melts it
// e.g. ice limbs on a water torso:
{ layers: [{ kind: 'water', share: 0.45, parts: ['torso', 'head'] }, { kind: 'ice', share: 0.55, parts: ['arms', 'hands', 'legs', 'feet'] }] }

// the passes (find them in the kinds list by id 'water' or 'ice': both are faces of one pool)
class WaterPasses implements MatterPasses {
  form(d: number, v: number): void;      // dancer d's form, 0 water … 1 ice (eased: the freeze climbs from the feet)
  formOf(d: number): number;             // as shown now
  readonly setIce: SetIce;
  readonly pool: WaterPool;
}

// set ice (src/matter/ice/setice.ts)
setIce.add({ points: [x, y, z][], width?: number /* m, 0.5 */, life?: number /* s, 0 = for ever */, seed?: number }): number  // id, 0 if refused
setIce.remove(id); setIce.shatter(id);
setIce.hit(x, y, z, r): number[]                       // shatters every piece within r; their ids
setIce.warm(x, y, z, r, amount /* 0..1 */, dt)         // heat melts what's near (iceParams.setMelt per second at 1)
setIce.ledgesIn(plane: StagePlane, reach = 0.6): IceLedge[]
  // IceLedge { x0, y0, x1, y1, piece }: x along plane.right from plane.origin, y up from it; the slab's top; a stretch
  // counts once the freeze has reached its far end, until it is 85 % melted or shattered; sloped stretches stay sloped
setIce.save(): SetIceDesc   // { v: 1, pieces: [{ id, p: number[] (xyz…, mm), w, life, age, seed, melt }] }
setIce.load(d: SetIceDesc)  // ages, not clock times: loads the same on any client; same seed, same shards
setIce.now                  // its own clock (s), moved on by the pool each frame
```

Parameters: `bend.params.water` (motion, state change, surface look; `perDancer` 100,000; `form` sets every dancer)
and `bend.params.ice` (shard size and look, mist, set-ice density). For captures and trying looks: `?dress=water,ice`
(or `bend.set('water', { dress })`) dresses dancer 0, 1, … by name (`water`, `ice`, `gems+water` (write `%2B` in a
URL), `ice+water`, `water+ice`, `gems`) and keeps them dressed when the programme restages; `bend.set('ice',
{ demo: 'bridge' | 'ramp' | 'clear' })` lays a demo piece. Both go through `window.bend.loadout` / the pool, nothing
else.

Budget: `perDancer × (the dancers' water+ice shares) × clamp(budget.count / 15000, 0.3, 1)`, capped at `WATER_MAX`
400,000 (buffers made once at that size: 38 MB). `coarse`: 40,000 per dancer, the surface at half resolution, one
smoothing pass.

## Where the fluid pass sits in the frame

```
gpu sim    water.sim, ice.mist (after gems)
gpu cull   water.splat.depth, water.splat.thick, water.smooth.x0..y2   (per view, before the scene: they don't need it)
gpu scene  scene: worlds, gems, ice shards and set ice (opaque), drops, mist (glow)
gpu air    water.scene.copy, water.surface  →  air  →  post (lens, trail, bloom, grade)
```

The composite has to come after the MSAA resolve (it refracts what is behind the water) and before the air (so fog,
depth of field and bloom treat water as scene). Kinds declare before the post chain does in `main.ts`, so a kind's
items added to `'air'` run before the post chain's `air` pass. **No file outside my folders was edited.** The one
dependency to keep in mind: if `main.ts` ever builds the post chain before declaring the scene, the water would
composite after the air (wrong fog, still visible).

## Timings (RTX 5090, 1280×800, render scale 1, weft profiler over 150 frames, stepped)

Geode, salsa, dancer 0 water (100,000 particles), dancer 1 gems:

| pass | ms |
|---|---|
| water.sim | 0.010 |
| water.splat.depth | 0.149 |
| water.splat.thick | 0.082 |
| water.smooth ×6 (3 passes, x and y) | 0.149 (0.024 to 0.027 each) |
| water.surface (copy + composite) | 0.018 |
| **water total** | **≈ 0.41** |
| whole frame | 1.010 (gems-only geode in wave 0: 0.56 to 0.64) |

Redwoods by day, same cast: water total ≈ 0.42 ms (frame 1.85; the redwoods' scene is 0.86). Two water dancers
(200,000 particles, first try, 2 smoothing passes): splats 0.13 + 0.07.

Ice, measured with the scene pass (the shards are draws inside it, not passes of their own): geode, dancer 0 frozen
(7,143 shards): scene 0.23 → 0.57 ms (+0.34; an earlier, brighter look measured +0.6). Redwoods at night, two ice
dancers (200,000 particles, 14,286 shards): scene 2.22 ms against 0.86 without, so about **+1.4 ms for two ice
bodies** (frame 3.29 ms): the costliest thing here. The mist step
is 0.003 ms. A frozen body still runs its splat passes (0.1 ms each; nothing is splatted) because the CPU can't see
which particles are liquid.

## Stills (docs/reports/media/)

| file | what it shows |
|---|---|
| `water-geode.jpg` | the salsa in the geode, dancer 0 (right) water, dancer 1 gems: a glossy, translucent blue body, glints, drops |
| `water-redwoods-day.jpg` | the same at 13:00 in the redwoods: the meadow and the trunk refracted through the water body |
| `water-spin.jpg` | the pirouettes, close: water flung off the turning body in arcs, drops glinting |
| `water-kick.jpg` | breaking, low: the legs' water, splashes and puddled drops round the feet |
| `freeze-0.jpg`, `freeze-half.jpg`, `freeze-1.jpg` | the form at 0, rising past 0.5 (ice up to the waist, water above), and 1 |
| `ice-night.jpg` | two ice dancers in the redwoods at 21:36: faceted, frosted, glinting, with dust and a faint mist |
| `gems-water.jpg` | a gem heart (torso and head) inside a body of water, both dancers |
| `ice-bridge.jpg` | a set-ice bridge (an arch of shards with icicles) beside the dancer |
| `water-film-contact.jpg` | 12 frames of the 6 s clip (pirouettes, orbiting camera); the clip is `water-film.mp4` there (git-ignored) |

## Honest weak points

- **The water's outline is lumpy.** The bilateral smooth flattens the inside of the surface well, but the silhouette is
  the union of spheres, so shoulders and the head's outline show bumps the size of a drop, and drops near the body
  read as beads. A narrow-range filter or a screen-space erosion of the outline would help; not done.
- **A faint blockiness** from the separable blur shows in highlights at grazing angles (taking the normal over two
  texels hides most of it).
- **Water reads as glossy blue glass/gel more than as pouring water** in a still; in motion (the clip) the shedding,
  spray and return read as water. It is denser and bluer than the 2D reference's cyan-white figure.
- **Ice is bright and silvery** rather than the reference's steel blue with dark facets; the facets are small (one
  shard per 14 particles) so a body reads as crystalline frost more than as large planes. `iceParams.shardEvery` and
  `size` move this.
- **Ice is the expensive part**: about 0.35 to 0.7 ms per frozen body at 100,000 particles (overdraw of overlapping
  shards, 72 vertices each). Fewer, bigger shards (`iceParams.shardEvery`) is the knob.
- **Gems left on a body**: when a dancer is redressed from gems to water or ice, the gems kind keeps its stones on that
  dancer's old homes (a gems layout with no layers rewrites nothing), so a few gems show on the ice in `ice-night.jpg`.
  That is the gems' behaviour, not this folder's; noted for whoever owns gems. The programme's 15,000 stones also
  streak through several stills.
- **Thickness ignores occluders** (the thickness splat has no scene depth), so water behind a trunk can tint the edge of
  water in front of it.
- **Set ice melts only by API** (`warm`): the field's heat is GPU-only and the ledges are CPU, so heat from the field
  does not melt set ice by itself. The play/field agents need to call `warm` (or a readback is added later).
- The field is still a stub, so freezing by cold, melting and boiling by heat and the wind have not been seen working.
- The pip view and portals: the surface is made per view and should work there; not captured.
- The clip is 180 stills read back one by one (scripts/shot.mjs), not `film.mjs` (its film script dresses in gems).
- Port 5402 was taken by another project's server (a TLS server from `world`), so the dev server ran on **5412**.

## Not done

- Water reflected in the geode's mirror floor (the gems have a mirrored draw; water has none).
- Wet into the field (`Field.deposit` is a stub): water deposits nothing yet.
- Shed ice actually setting along a path: `setIce.add` makes the piece from its seed; it does not capture the body's
  own flying shards.
- Sound events for splashes and cracking ice.
- A Node test in `npm test` for set ice (the check above was run by hand from the scratchpad; `npm test` is
  check-limits only and package.json is outside my folders).

## Edits outside my folders

None in `src/`. New files: `scripts/steps/water.json`, `ice.json`, `water-try.json`, `water-film.json`, this report,
and the jpgs above in `docs/reports/media/`.
