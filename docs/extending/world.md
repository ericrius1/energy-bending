# Adding a world

A world is a place to dance: its backdrop and things, its light on matter, its air, its sound, where the camera may
stand, the stage planes a view can lock to (with their ledges), its portals and spawn points, and any matter it is
built of. Five are here, each a reference for something:

| world | light | what to read it for |
|---|---|---|
| `geode` | 0 | the small one: one backdrop, one glow draw, a gem fixture (its crystal wall); the hub of the portals; a stage whose ledges are blades of crystal from the wall (`shelves.ts`) |
| `redwoods` | 1 | the large one: textures, instanced plants, a day; ledges that are logs in the trunks' bark (`stage.ts`) |
| `pool` | 2 | water: a live ripple field (`water/ripples.ts`) and the surface laid over the scene in the air pass |
| `temple` | 3 | stone geometry from the vertex index, analytic moon shadows, a tide on the music's clock (`tideY`) |
| `forge` | 4 | no ground, ledges that bob with the bass (`ledgeY`), a heat shimmer over the scene, far islands |

## 1. A folder, a register call, and its lines in light.wgsl

```
src/worlds/pool/
  index.ts       worlds.register({ id: 'pool', make: (ctx) => new Pool(ctx) })   (main.ts finds it by glob)
  pool.ts        the World
  pool.wgsl      its light: struct Pool (its uniform) and its functions (env, ambient, key, air, scene)
  backdrop.wgsl  its draws…
```

`make` runs once at start with a `WorldCtx` (kit, base URL, body buffers, coarse, film, and the `frame`: a world with a
simulation of its own adds its compute steps under `'sim'`, as the pool's ripples do). Make your uniform there with
`kit.uniforms(lightShader.structs.Pool)` and list it in `shared: { pool: this.u }`. `shared` may hold textures too
(the pool shares its ripple field as `poolWaves`).

Then `src/worlds/light.wgsl`, the one file outside your folder a world touches (WGSL has no registry):

1. `#include "./pool/pool"`
2. `@group(2) @binding(N) var<uniform> pool: Pool;` (the next binding; the name matches your `shared` key)
3. a case in each function: `if (WORLD == 2u) { return poolEnv(d, p); }` for `worldEnv`, `worldAmbient`, `worldKey`,
   `worldRim`, `worldFixtureTint`, `worldAir` and, if it lays something over the scene, `worldScene`. Your `light` is
   that number.

Every matter kind declares one pipeline per world with `constants: { WORLD: world.light }`, so its gems (or flames)
are lit by your world with no branch per pixel. `worlds/shared.ts` checks every binding in light.wgsl is provided.

`worldScene(src, px, d)` is what the air pass reads the scene through (src: the scene, alpha its view distance). Most
worlds return `textureLoad(src, px, 0)`. A world with water calls `water/water.wgsl` (`waterHit`, `waveNormal`,
`waterReflect`: the reflection is the scene on screen, marched along the reflected ray, else your sky); a hot one bends
what is far (`forgeScene`). Keep half floats in mind: the scene's alpha is an `rgba16float`, so write distances under
30 km and compare them with a part in a thousand of slack.

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
- `mirrorFloor`: true only for a floor the gems should mirror themselves in (the geode's agate). A world that draws its
  own reflections (water, through `worldScene`) says false, or the stones are reflected twice.
- `fixtures`: matter the world is built of, e.g. `{ kind: 'gems', count, radius, specimens, seed, enabled }` (the
  gems build a dome of crystals from it). Later, set matter (building) lands here.
- `tone()` is how the instrument sounds there (audio/sound.ts `Tone`); `ambience()` the wood's own sounds.

## 3. Stages and ledges (worlds/stage.ts)

A stage plane is data the body physics reads: `{ id, origin, right, halfWidth, ground, ledges, spawns }` (plus what the
camera wants: `normal`, `height`, `lens`, `maxDistance`; `stagePlane(def)` fills those in). Plane coordinates: x along
`right` from `origin`, y up, metres. A `Ledge` is `{ id, x0, x1, y, solid?, thick?, bob? }`: its top at y from x0 to
x1, one-way unless solid, bobbing `bob` m with the bass.

- **Build the ledge and what the eye sees from one description.** Each world's layout makes the ledge first and the
  geometry from it (the temple's pillar is a drum of the ledge's width and height; the forge's slab has a row of
  columns whose flat sides meet exactly on the plane; the redwoods' bough runs level at one radius under its ledge).
- **Moving ledges**: `ledgeY(ledge, beat)` (beat = `FrameCtx.beat.beats`) is the height for physics and drawing alike;
  the forge uploads each slab's lift from it every frame. The temple's water: `tideY(beat)` (temple/temple.ts).
- Proportions: a dancer is ~1.7 m and jumps ~2 m, an air jump adds ~1.5 m: low ledges ~1.1 m, middle ~1.9 m, high
  ~3.1 m over the stage's ground; the stage ~11.5 m wide (`halfWidth` 5.75).
- `spawns` (plane x, y) for seat 0 and seat 1; `World.spawns` is the same in the world (`spawnsOf(plane)`).
- `groundAt(x, z)` is the floor under a point in 3D: the top of a solid ledge you'd stand on there, or (the forge)
  how far down the game catches a fall.

## 4. Portals

`portals: PortalDef[]`, `{ id, at, normal, radius, to: { world, portal } }`: where the gate's disc stands (its middle),
which way it faces (the side you walk in from), its radius. The world chooses the site: flat, clear round it, out of
the stage's way and of the locked camera's view. src/portals draws them. The geode is the hub (`geode.<world>`, one per
world); every other world has one gate back (`<world>.geode`).

## 5. See it

`?world=pool` starts there; `w` cycles worlds; `?lock` locks to the first stage; `?pip` shows the next world in an
inset. Stills: `node scripts/shot.mjs shots/pool scripts/steps/worlds.json` (steps can set any world's params:
`temple.tideHold`, `forge.bobHold`, `*.firelight`). Look at them.
