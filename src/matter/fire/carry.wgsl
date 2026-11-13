// A dancer carried through a gate (src/portals): its flames in the air go with it, by the gate's rigid move, before
// the simulation on the frame it crosses (docs/extending/portal.md; the core version is matter/core/carry.wgsl, for
// kinds whose particles are the core's Particle; a flame is its own struct).
#include "./flame"

struct Carry {
  m: array<mat4x4f, MAX_DANCERS>,
  q: array<vec4f, MAX_DANCERS>,
  mask: u32,
  count: u32,
  pad0: u32, pad1: u32,
}

@group(1) @binding(0) var<uniform> carry: Carry;
@group(1) @binding(1) var<storage, read> homes: array<Home>;
@group(1) @binding(2) var<storage, read_write> flames: array<Flame>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= carry.count) { return; }
  let d = min(dancerOf(homes[i]), MAX_DANCERS - 1u);
  if ((carry.mask & (1u << d)) == 0u) { return; }
  var f = flames[i];
  let m = carry.m[d];
  f.pos = (m * vec4f(f.pos, 1.0)).xyz;
  f.vel = (m * vec4f(f.vel, 0.0)).xyz;
  flames[i] = f;
}
