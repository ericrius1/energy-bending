# Gates between worlds (src/portals)

A gate is a pair of discs in two worlds. Through either disc you see the other world live, from where you stand, and
walking (or flying) through one brings you out of the other. This guide is for whoever opens gates (a world, the
game), whoever draws matter (every matter kind must honour the `seen` hook below), and whoever moves the camera.

## Opening one

```ts
// a world lists its side of each gate; the partner world lists the other side, with the same pair of ids
readonly portals: PortalDef[] = [
  { id: 'geode.door', at: [0, 1.22, -2.9], normal: [0, 0, 1], radius: 1.15, to: { world: 'redwoods', portal: 'redwoods.door' } },
];
```

The portals open every world's list at start (`Portals.open` on each `PortalDef`, paired by `to.portal`). The game can
open and close gates at any time:

```ts
gates.open({ id, world, at, normal, up?, radius, to: { world, portal } }, partnerDef);  // weaves open (openTime s)
gates.close(id);                                                                     // and its partner
```

`normal` points out of the disc's front; `up` is the disc's own up (a wall gate: the world's up, the default; a gate
lying in a floor or hanging overhead needs one, the default is −z). Going in at the front of one disc brings you out
of the front of the other; at the back, out of the back. The move from one world to the other is one rigid
transform, `partner.frame · (half turn about up) · frame⁻¹`, so a floor gate paired with a gate in another world's
sky keeps down as down (you fall out of the sky), and a wall gate paired with a floor gate turns you on your side
(dancers arrive tilted: nothing here rights them; that is the dancers' business).

## The API (src/portals/portals.ts, `bend.gates` in the page)

| call | what |
|---|---|
| `open(...defs)`, `close(id)` | open a pair (or one side whose partner is in a world's list); weave it shut |
| `crossed(prev, next, world, margin?)` | the open gate in `world` the segment passes through: `{ gate, u, v, front }` or null |
| `pt(gate, p)`, `dir(gate, v)`, `quat(gate, q)`, `move(gate)` | a point, direction, orientation or the whole `Rigid` through a gate (its world → its partner's) |
| `on(fn)` | every crossing, as a `TravelEvent { who, dancer, id, gate, partner, from, to, u, v, front, t }` |
| `worldOf(dancer)`, `place(dancer, world \| null)` | which world a dancer is in (null: with the main view, where everyone starts) |
| `seen(world, dancers)` | the dancers as `world` sees them: their joints (one in a joined world carried through the nearest gate) and their middle. main.ts frames and follows these |
| `travel(event, dancers, t)` | apply a crossing reported from elsewhere (the network's `travel` message) |
| `follow` | the dancer the camera follows (reserved: see the report) |
| `exposure` | the main view's exposure now, leaning toward the far world's as a gate fills the screen |
| `stats()` | the gates, what each slot shows, the lean |

The network: when the local player crosses, send the `TravelEvent` (its `dancer`, `gate`, `front`, `t` are enough: the
gate's move is the same on every client). The receiving client calls `travel(e, dancers, t)` for that dancer. A remote
dancer posed from landmarks also crosses on its own when its middle passes the disc; `travel` is idempotent with
that (it carries only a dancer still in the gate's world).

## The hook every matter kind must honour: `seen`

Each view has a small uniform, `view.seen` (engine/seen.wgsl, `ViewSeen`), that says for each dancer slot whether it is
drawn in that view at all (the scene draws only the dancers of the world it shows), where (a dancer part way through
a gate is drawn in the other world too, carried by the gate's move) and which side of a plane (the door: the part
that has gone through is not drawn on this side). A kind's cull and draw shaders read it:

```wgsl
#include "../../engine/seen"
@group(1) @binding(N) var<uniform> seen: ViewSeen;

let sd = seen.d[min(dancerOf(home), MAX_DANCERS - 1u)];   // the particle's dancer
let p = seenPos(sd, particle.pos);                         // where to draw it in this view's world
let r = seenRot(sd, particle.rot);                         // its orientation there (seenDir for a velocity)
if (seenClip(sd, p) < -radius) { skip it }                 // beyond the door, or not in this world (always < 0)
// pass seenClip(sd, worldPos) to the fragment shader and `discard` below 0, so the cut at the door is clean
// a gate's view draws fewer: skip when rnd(i) > seen.keep, and grow the rest by seen.grow
```

and bind it per view: `bind: { ..., seen: s.view.seen }` in `declareView(s)` (and in a per-view cull, `view.seen`).
The gems do all of this (matter/gems/cull.wgsl, draw.wgsl, streaks.wgsl). The sparkles are not a dancer's (they are
drawn in every world's view: a known gap).

The second half: `MatterPasses.carry?(moves)` (matter/core/kind.ts). When a dancer is carried through a gate the
portals call it once, that frame, before the simulation, with the dancer's slot and the move (column-major 4×4). Move
every particle that belongs to that dancer (positions, velocities, orientations) by it. The gems do it in
`matter/gems/carry.wgsl`, a compute enabled only on that frame and put before their step.

A kind that ignores `seen` still works, but its particles show in every world and are not cut at the door.

## How a live gate is drawn

1. `Portals` owns up to `LIMITS.views` extra views (slots), each a full scene and air at `gates.scale` of the render
   size, rendered in the frame's `gates` stage, deepest first, before the main scene.
2. Each frame (`gates` phase, after the camera) the gates on the main screen bigger than `minPx` take up to `live`
   slots, biggest first; gates seen through those take what is left (`depth` 2). A slot's camera is its parent's
   carried through the gate (`GateCamera`), with an oblique near plane on the partner disc: nothing between it and
   the disc is drawn, in any shader, without any of them knowing.
3. Each view's gates are drawn by `portals/surface.wgsl` from a per-view table: the disc samples the slot's texture
   at its own screen position (the slot's camera is this one carried, so pixels line up) bent by ripples, with colour
   fringes, a skin of light, the rim, halo, floor light and motes. A gate with no live slot shows the last view it had
   (blurred) or a shimmer.

## The camera

The camera crossing a disc carries the camera rig (its target, its turn, its height; a tilt or roll the orbit can't
hold is eased out over `settle` seconds) and the main view goes to the other world. Anything else that moves the
camera (a fly path, a cut scene) should do the same: compute the pose in its own coordinates and multiply by the
carry. `?fly` (portalParams.fly…) is an example.
