# Adding a world

A world is a place to dance: its backdrop and things, its light on matter, its air, its sound, where the camera may
stand, the stage planes a view can lock to (with their ledges), its portals and spawn points, and any matter it is
built of. Four are here, each a reference for something:

| world | light | what to read it for |
|---|---|---|
| `geode` | 0 | the small one: one backdrop, one glow draw, a gem fixture (its crystal wall); the hub of the portals; a stage whose ledges are blades of crystal from the wall (`shelves.ts`) |
| `redwoods` | 1 | the large one: textures, instanced plants, a day; ledges that are logs in the trunks' bark (`stage.ts`) |
| `pool` | 2 | water: a live ripple field (`water/ripples.ts`) and the surface laid over the scene in the air pass |
| `temple` | 3 | stone geometry from the vertex index, analytic moon shadows, a tide on the music's clock (`tideY`) |

## 1. A folder, a register call, and its lines in light.wgsl

```
src/worlds/pool/
  index.ts       worlds.register({ id: 'pool', make: (ctx) => new Pool(ctx) })   (main.ts finds it by glob)
  pool.ts        the World
  pool.wgsl      its light: struct Pool (its slot of the light uniform) and its functions (env, ambient, key, air,
                 scene), which read it as `worldLight.pool.<field>`
  backdrop.wgsl  its draws…
```

`make` runs once at start with a `WorldCtx` (kit, base URL, body buffers, coarse, film, and the `frame`: a world with a
simulation of its own adds its compute steps under `'sim'`, as the pool's ripples do). Take your light's slot there
with `this.u = lightSlot(ctx.kit, 'pool')` (`worlds/shared.ts`; the name is your member of `WorldLight`) and write it
with `this.u.set({ … })` in `update` (nested partials, as a weft uniform). `shared` holds only textures for the light
group (the pool shares its ripple field as `{ poolWaves: this.waves.tex }`); most worlds say `shared = {}`.

The worlds' light is one uniform buffer, `worldLight: WorldLight` (group 2, binding 0): a slot per world and one for the
dancers' fire. However many worlds there are, a lit shader binds one uniform for them, and every view reads its own
world's slot (a gate's view of another world in the same frame reads that world's). Nothing in `worlds/shared.ts`,
`world.ts`, `engine/` or `main.ts` changes for a new world.

Then `src/worlds/light.wgsl`, the one file outside your folder a world touches (WGSL has no registry):

1. `#include "./pool/pool"`
2. `pool: Pool,` as the next member of `struct WorldLight` (after the last world's; the member's name is what
   `lightSlot` takes and what your shaders read: `worldLight.pool.key`)
3. a world with a texture of its own (water's height field): `@group(2) @binding(N) var poolWaves: texture_2d<f32>;`
   at the next binding, named as your `shared` key. Each costs every lit shader stage a sampled texture (16 at the
   baseline; `npm test` counts them)
4. a case in each function: `if (WORLD == 2u) { return poolEnv(d, p); }` for `worldEnv`, `worldAmbient`, `worldKey`,
   `worldRim`, `worldFixtureTint`, `worldAir` and, if it lays something over the scene, `worldScene`. Your `light` is
   that number.

Every matter kind declares one pipeline per world with `constants: { WORLD: world.light }`, so its gems (or flames)
are lit by your world with no branch per pixel. `worlds/shared.ts` checks every binding in light.wgsl is provided, and
`lightSlot` throws if `WorldLight` has no member of that name. The whole `WorldLight` must stay under 64 KiB (the
baseline's largest uniform binding; it is 3.5 KiB with four worlds and the fire): `npm test`
(`scripts/check-bindings.mjs`) fails past it, or when any shader stage needs more uniform buffers, storage buffers,
textures or samplers than the baseline allows. Run the game under the baseline with `?baseline`.

`worldScene(src, px, d)` is what the air pass reads the scene through (src: the scene, alpha its view distance). Most
worlds return `textureLoad(src, px, 0)`. A world with water calls `water/water.wgsl` (`waterHit`, `waveNormal`,
`waterReflect`: the reflection is the scene on screen, marched along the reflected ray, else your sky). Keep half
floats in mind: the scene's alpha is an `rgba16float`, so write distances under
30 km and compare them with a part in a thousand of slack. The `src` the air hands you is the **opaque** scene only
(the depth contract, AGENTS.md): flames and other glowing matter are in a separate glow target laid over afterwards,
so your reflection never sees them. A water world returns `waterY()` (its surface height) so fire draws its own
mirror copy there.

## 2. The World

```ts
export class Pool implements World {
  readonly id = 'pool'; readonly light = 2; readonly mood = -0.5;
  readonly shared; readonly stages: StagePlane[]; readonly portals: PortalDef[]; readonly spawns: [number, number, number][];
  readonly fixtures = []; readonly mirrorFloor = false; readonly room = 40; readonly maxDist = 16;
  async load(ctx) { /* textures */ }
  update(f, centre) { /* light that moves, the tide, the ripples' window */ }
  declareScene(s) { if (s.world !== this) return; /* draws for s.phase, enabled: s.on */ }
  groundAt(x, z) { return 0; } exposure() { return 1; } tone() { return { … }; } ambience() { return null; }
  ripple?(x, z, strength, radius) { /* worlds with water */ }
}
```

- `declareScene(s)` is called for every view and phase, and for every world (return when `s.world !== this`).
  `backdrop` is drawn first with no depth (a fullscreen floor and sky, alpha = view distance for the air and the
  depth of field), `opaque` after the matter, `glow` additive with `depthWrite: false`. Pass `enabled: s.on` to every
  draw: it is what lets two views show two worlds in one frame.
- **The near fade.** Every solid thing a dancer could stand behind or the camera could graze (columns, trunks, logs,
  blades, slabs, lanterns: what `solids` describes) calls `if (sightDrop(i.wp, i.pos.xy)) { discard; }` first in its
  fragment shader (worlds/light.wgsl, worlds/fade.ts): it dissolves what is within 0.6 m of the eye or stands well in
  front of a framed dancer, a dither, in the main view only. No binding; nothing below the dancers' feet fades, so a
  floor may call it too. A backdrop never does (it has no depth to show through to).
- `mirrorFloor`: true only for a floor the gems should mirror themselves in (the geode's agate). A world that draws its
  own reflections (water, through `worldScene`) says false, or the stones are reflected twice.
- `fixtures`: matter the world is built of, e.g. `{ kind: 'gems', count, radius, specimens, seed, enabled }` (the
  gems build a dome of crystals from it). Later, set matter (building) lands here.
- `tone()` is how the instrument sounds there (audio/sound.ts `Tone`); `ambience()` the wood's own sounds.
- `grade` (optional, `Grade` in worlds/world.ts, src/post/grade.ts): the world's colour after the tone map (lift,
  gamma, gain, shadow and highlight tints, saturation, contrast); it eases over half a second at a crossing. Saturated
  colours (the elements') are mostly protected.
- `waterY()` (optional): the height of water that mirrors (the Pool, the temple's tide).
- `clear(a, b)` (optional): how much of a segment is clear of the world's big solid things, for the camera (the
  redwoods answer from their trunks).

## 3. Stages and ledges (worlds/stage.ts)

A stage plane is data the body physics reads: `{ id, origin, right, halfWidth, ground, ledges, spawns, ledgeY? }`
(engine/camera.ts, one type for the rig, the physics and the worlds), plus what the camera may want: `height` (how much
to frame when nobody is on it), `lens`, and the locked camera's composed angle `yaw` and `pitch` (rad off square-on
and down; defaults camera.lockYaw / lockPitch); `stagePlane(def)` fills `height` in and passes the rest on. The normal is `planeNormal(plane)`
(right × up) and how far back the locked camera may stand comes from the world's `room`. Plane coordinates: x along
`right` from `origin`, y up, metres. A `Ledge` is `{ id, x0, x1, y, solid?, thick?, bob? }`: its top at y from x0 to
x1, one-way unless solid, bobbing `bob` m with the bass.

- **Build the ledge and what the eye sees from one description.** Each world's layout makes the ledge first and the
  geometry from it (the temple's pillar is a drum of the ledge's width and height; the redwoods' bough runs level
  at one radius under its ledge).
- **Moving ledges**: `ledgeY(ledge, beat)` (beat = `FrameCtx.beat.beats`) is the height for physics and drawing alike;
  a world with bobbing ledges uploads each one's lift from it every frame. The temple's water: `tideY(beat)` (temple/temple.ts).
- Proportions: a dancer is ~1.7 m and jumps ~2 m, an air jump adds ~1.5 m: low ledges ~1.1 m, middle ~1.9 m, high
  ~3.1 m over the stage's ground; the stage ~11.5 m wide (`halfWidth` 5.75).
- `spawns` (plane x, y) for seat 0 and seat 1; `World.spawns` is the same in the world (`spawnsOf(plane)`).
- `groundAt(x, z)` is the floor under a point in 3D: the top of a solid ledge you'd stand on there, or (a world
  without a floor everywhere) how far down the game catches a fall. A world you can fall off also says `fallY`: below it a body (free or locked)
  has fallen out and re-forms at its spawn.
- `?play` locks to `stages[0]` as it is (the pool's stage has no ledges on purpose); set ice on the plane adds one-way
  ledges (`setIce.ledgesIn`). Nothing reads `tideY` for the bodies yet (wading is not modelled).

## Light from the dancers

The fire kind's light rides in the same uniform (`worldLight.fire`, filled each frame by `matter/fire/lights.ts`), and
`worlds/light.wgsl` gives `worldFire(p, n)`: one
point light per flame dancer (fire warm, plasma violet by the dancer's form). Add it to your world's own shading of
its solid things (the geode's floor and shelves, everything the redwoods' lanterns light, the temple's
ambient does); matter takes a quarter of it through `worldAmbient`.

## 4. Portals

`portals: PortalDef[]`, `{ id, at, normal, radius, to: { world, portal }, up? }` (`up` for a gate lying in a floor or
a sky): where the gate's disc stands (its middle),
which way it faces (the side you walk in from), its radius. The world chooses the site: flat, clear round it, out of
the stage's way and of the locked camera's view. src/portals draws them. The geode is the hub (`geode.<world>`, one per
world); every other world has one gate back (`<world>.geode`). The portals open every world's list at start (eight
gates: `LIMITS.gates`), and the nearest on screen go live.

## 5. See it

`?world=pool` starts there; `w` cycles worlds; `?lock` locks to the first stage; `?pip` shows the next world in an
inset. Stills: `node scripts/shot.mjs shots/pool scripts/steps/worlds.json` (steps can set any world's params:
`temple.tideHold`, `*.firelight`). Look at them.
