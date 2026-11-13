# Adding a matter kind

A matter kind is one way a body can be made. The gems (`src/matter/gems`) are the worked example; this guide follows
them. Wave 1 adds fire, water, ice and plasma the same way.

## 1. A folder and one register call

```
src/matter/fire/
  index.ts      registers the kind (main.ts imports every src/matter/*/index.ts by glob: nothing else to edit)
  fire.ts       the kind: its buffers, compute steps, draws
  sim.wgsl      its simulation
  draw.wgsl     its draw
```

```ts
// src/matter/fire/index.ts
import { matterKinds } from '../core/kind';
import { FirePasses } from './fire';
matterKinds.register({ id: 'fire', declare: (ctx) => new FirePasses(ctx) });
```

`declare` may be async (the gems fetch their specimens first). It is called once, at start, before any scene is
declared.

## 2. Buffers and compute steps, in `declare`

`ctx` (a `MatterCtx`) gives you the kit, the frame builder, the shared body buffers, the hand, the field, every world,
the base URL and whether this is a phone or a film. Make your buffers, then put your compute steps into the frame:

```ts
const step = kit.compute(simShader, { label: 'fire.sim', threads: () => [this.count], bind: { sim: this.sim, homes, state } });
ctx.frame.add('sim', step, 'fire');
```

Your simulation shader gets the dancers for free by including the body core:

```wgsl
#include "../core/body"      // joints, segs, bodies, touch: bind group 3, shared (you don't bind them)
@group(1) @binding(0) var<uniform> sim: FireSim;           // your own bindings: group 1
@group(1) @binding(1) var<storage, read> homes: array<Home>;
@group(1) @binding(2) var<storage, read_write> state: array<Particle>;

struct FireSim { body: BodyStep, count: u32, /* … your own fields … */ }

@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= sim.count) { return; }
  let home = homes[i];
  var p = state[i];
  let H = homeOf(home, i, sim.body);          // where its home is now: pos, vel, rot, the outward normal
  let hips = joints[dancerOf(home) * MAXJ].pos.xyz;
  // … your own motion; or the gems' mode machine: bodyBegin, bodyStep (returns EV_* bits), bodyOrient
  state[i] = p;
}
```

Count your storage buffers per stage: the shared group adds two (joints, segs) to every stage of a shader that
includes body.wgsl. The baseline is eight. A draw that only needs particle data includes `../core/particle` instead
(no bindings).

## 3. Where the particles live: `layout(layers)`

When the cast or a loadout changes, the show hands each kind the layers that wear it (`MatterLayer`: the dancer's
slot, its rig, the parts, a weight, and the loadout layer with your `params`). `layoutHomes(count, layers, out)` in
`matter/core/layout.ts` tiles them over the capsules and writes a `Home` per particle (8 floats: capsule slot, t,
angle, depth; then your own value, size, role, random). Fill in your own value (the gems put the specimen of the
layer's suite there), then upload. `resize({ count })` comes first when a programme wants a different number.

## 4. Draws, per view and world: `declareView(s)`

Called once per view, world and scene phase (`backdrop` is for worlds only; you get `opaque` and `glow`). Add your
draws for `s.phase` into `s.pass`, enabled by `s.on` (true while that view shows that world). Lit by the world:

```ts
if (s.phase === 'opaque') s.pass.draw(drawShader, {
  label: `fire.${s.world.id}`, bind: { … }, constants: { WORLD: s.world.light }, enabled: s.on, count: 6, instances: () => this.count,
});
```

and in the shader `#include "../../worlds/light"` for `worldEnv`, `worldAmbient`, `worldKey`, `worldRim`. Something
that depends on the camera (a cull) is per view too: make it the first time a view is seen and add it to the
`'cull'` stage with `view: s.view.view` (see `GemPasses.listsFor`). Uniforms hold one value per run, so a per-view
value needs a buffer per view.

## 5. Each frame: `update(f)`

Set your uniforms from your parameters (`defineParams('fire', {…}, specs)`: they appear in the panel and in
`bend.params.fire`), from `f.dt`, `f.danceDt`, `f.t`, `f.beat`, and the hand. The body's own settings shared by
every kind (how many, trails) are `matterParams` in `matter/core/params.ts`.

Read the dancers from `f.dancers[d]`: `Dancer.form` (0 … 1, the power form: fire toward plasma, water toward ice; the
one place it lives, set with `bend.form(d, v)`), `Dancer.presence` (0 … 1, how much of its matter is on the body: the
show lowers it in a heap or after a shatter) and `Dancer.world` (the world it is in: a dancer through a gate is
elsewhere; the main view's world is `f.views[0].world`).

## 6. The show's moments: `acts`

`rise(at, spread)`, `shatter(x, y, z, strength)`, `settle(on)`, `dancing(on)`: what a body does as a programme moves
between dances. A kind with no such moments leaves `acts` out.

## 7. Through gates, heard, after the lens (wave 1's joins)

- **`seen`** (engine/seen.wgsl): each view says per dancer whether it is drawn there, where (carried through a gate)
  and which side of a door is kept. Every cull and draw of a dancer's particles reads it (`seen: s.view.seen` in the
  bind; `seenPos`, `seenRot`, `seenDir`, `seenClip`, `seen.keep` and `seen.grow`; the recipe is in
  docs/extending/portal.md). Fire, water, ice and gems do. Matter that belongs to no dancer (steam, ice's mist, plasma's
  arcs, the gems' sparkles) is drawn in the main view only, or must say what it does.
- **`carry(moves)`**: when a dancer crosses a gate, move its particles by the gate's rigid move before your step.
  `matter/core/carry.ts` (`CarryStep`) does it for a kind whose state is the core `Particle` (core/carry.wgsl); a kind
  with its own struct writes a carry shader with the same `Carry` uniform (fire/carry.wgsl).
- **`hear(ears)`**: the music hands your kind its ears once; tell them what happens each frame (holds and events:
  docs/extending/sound.md). `matter/core/sounding.ts` has the helpers (a body's middle, its fastest limb, a seeded
  number per frame, a trigger). Scale by `Dancer.presence`.
- **`declarePost(post)`**: translucent matter with no one distance (steam) draws over the focused image, in the post
  chain's lens pass after the depth of field, testing the scene's distance by hand (`post.sceneTex`'s alpha). Matter
  that has a distance stays in the scene and min-blends it into the scene's alpha (fire does).

## 8. Dress a dancer in it

```js
bend.loadout(0, { layers: [{ kind: 'gems', share: 0.4, parts: ['torso'], params: { suite: 'Ember' } },
                           { kind: 'fire', share: 0.6, parts: ['arms', 'legs', 'hands', 'feet', 'head'] }] })
```

or by preset name: `?dress=fire,water` or `bend.dress(0, 'ember')` (matter/core/presets.ts: gems, fire, water, ice,
plasma, ember, tide, gemwater, geodeheart, geodeheart-water; add yours there). The show keeps a dress on through
restaging. Then check it: `node scripts/shot.mjs shots/fire` with a steps file that sets the loadout (a step's `eval`
runs in the page with `bend`), and `bend.stats().passes` for its cost.
