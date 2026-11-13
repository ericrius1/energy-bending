// A dancer carried through a gate (src/portals): its stones go with it, every one that belongs to it (on its body,
// flying, resting where it fell), by the gate's one rigid move: position, velocity and orientation. Runs before the
// simulation on the frame the dancer crosses, so the springs to its homes (which already moved with the joints) see
// the stones where they should be and nothing is flung across the world.
#include "./gem"

struct Carry {
  m: array<mat4x4f, MAX_DANCERS>,   // each dancer's move (column-major), where `mask` has its bit
  q: array<vec4f, MAX_DANCERS>,     // the same moves' rotations
  mask: u32,
  count: u32,                       // stones simulated
  pad0: u32, pad1: u32,
}

@group(1) @binding(0) var<uniform> carry: Carry;
@group(1) @binding(1) var<storage, read> homes: array<Home>;
@group(1) @binding(2) var<storage, read_write> state: array<Particle>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= carry.count) { return; }
  let d = min(dancerOf(homes[i]), MAX_DANCERS - 1u);
  if ((carry.mask & (1u << d)) == 0u) { return; }
  var p = state[i];
  let m = carry.m[d];
  p.pos = (m * vec4f(p.pos, 1.0)).xyz;
  p.vel = (m * vec4f(p.vel, 0.0)).xyz;
  p.rot = qmul(carry.q[d], p.rot);
  state[i] = p;
}
