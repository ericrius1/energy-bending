# Adding a world

A world is a place to dance: its backdrop and things, its light on matter, its air, its sound, where the camera may
stand, the stage planes a view can lock to, its portals and spawn points, and any matter it is built of. The geode
(`src/worlds/geode`) is the small example; the redwoods (`src/worlds/redwoods`) the large one.

## 1. A folder, a register call, and one line of WGSL

```
src/worlds/pool/
  index.ts       worlds.register({ id: 'pool', make: (ctx) => new Pool(ctx) })   (main.ts finds it by glob)
  pool.ts        the World
  pool.wgsl      its light: struct Pool (its uniform) and its functions (env, ambient, key, air)
  backdrop.wgsl  its draws…
```

`make` runs once at start with a `WorldCtx` (kit, base URL, body buffers, coarse, film). Make your uniform there with
`kit.uniforms(lightShader.structs.Pool)` and list it in `shared: { pool: this.u }`.

Then `src/worlds/light.wgsl`, the one file outside your folder a world touches (WGSL has no registry):

1. `#include "./pool/pool"`
2. `@group(2) @binding(2) var<uniform> pool: Pool;` (the next binding; the name matches your `shared` key)
3. a case in each function: `if (WORLD == 2u) { return poolEnv(d, p); }` for `worldEnv`, `worldAmbient`, `worldKey`,
   `worldRim`, `worldFixtureTint`, `worldAir`. Your `light` is that number.

Every matter kind declares one pipeline per world with `constants: { WORLD: world.light }`, so its gems (or flames)
are lit by your world with no branch per pixel. `worlds/shared.ts` checks every binding in light.wgsl has a uniform.

## 2. The World

```ts
export class Pool implements World {
  readonly id = 'pool'; readonly light = 2; readonly mood = 0.1;
  readonly shared; readonly stages: StagePlane[]; readonly portals = []; readonly spawns = [[-1.2, 0, 0], [1.2, 0, 0]];
  readonly fixtures = []; readonly mirrorFloor = false; readonly room = 8; readonly maxDist = 12;
  async load(ctx) { /* textures */ }
  update(f, centre) { /* light that moves: the day, the follow-spot */ }
  declareScene(s) { if (s.world !== this) return; /* draws for s.phase, enabled: s.on */ }
  groundAt() { return 0; } exposure() { return 1; } tone() { return { … }; } ambience() { return null; }
}
```

- `declareScene(s)` is called for every view and phase, and for every world (return when `s.world !== this`).
  `backdrop` is drawn first with no depth (a fullscreen floor and sky, alpha = view distance for the air and the
  depth of field), `opaque` after the matter, `glow` additive with `depthWrite: false`. Pass `enabled: s.on` to every
  draw: it is what lets two views show two worlds in one frame.
- `stages`: at least one `StagePlane` (origin, right, normal toward the camera's side, extent, ledges in plane
  coordinates, the lens it wants, and how far back the camera may stand). `?lock` and `bend.lock(true)` use the first.
- `fixtures`: matter the world is built of, e.g. `{ kind: 'gems', count, radius, specimens, seed, enabled }` (the
  gems build a dome of crystals from it). Later, set matter (building) lands here.
- `tone()` is how the instrument sounds there (audio/sound.ts `Tone`); `ambience()` the wood's own sounds.

## 3. See it

`?world=pool` starts there; `w` cycles worlds; `?pip` shows the other world in an inset (with two worlds; with more,
the next one). Take a still with `node scripts/shot.mjs shots/pool --query world=pool` and look at it.
