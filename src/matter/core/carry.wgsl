// A dancer carried through a gate (src/portals): the particles that belong to it go with it, by the gate's one rigid
// move, before the simulation on the frame it crosses (docs/extending/portal.md). This is the core version, for any kind
// whose state is the core's `Particle` and whose homes are `Home`s (water and ice; the gems keep their own copy,
// gems/carry.wgsl, which is the same). A kind with its own particle struct writes its own (fire/carry.wgsl).
#include "./particle"

struct Carry {
  m: array<mat4x4f, MAX_DANCERS>,   // each dancer's move (column-major), where `mask` has its bit
  q: array<vec4f, MAX_DANCERS>,     // the same moves' rotations
  w: array<vec4f, MAX_DANCERS>,     // only within this sphere (xyz, radius; 0: every particle): shed ones stay behind
  mask: u32,
  count: u32,                       // particles simulated
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
  let s = carry.w[d];
  if (s.w > 0.0 && distance(p.pos, s.xyz) > s.w) { return; }
  let m = carry.m[d];
  p.pos = (m * vec4f(p.pos, 1.0)).xyz;
  p.vel = (m * vec4f(p.vel, 0.0)).xyz;
  p.rot = qmul(carry.q[d], p.rot);
  state[i] = p;
}
