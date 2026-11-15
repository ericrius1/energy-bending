// The sparkle pool: born in sim.wgsl (where gems grind, break off or hit the floor), they fly, fall and fade here.
#include "./gem"

@group(1) @binding(0) var<uniform> sim: Sim;
@group(1) @binding(1) var<storage, read_write> sparks: array<Spark>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&sparks)) { return; }
  var s = sparks[i];
  if (s.life <= 0.0) { return; }
  let dt = sim.body.dt;
  s.life -= dt;
  s.vel.y -= sim.body.gravity * 0.3 * dt;
  s.vel *= exp(-1.8 * dt);
  s.pos += s.vel * dt;
  if (s.pos.y < sim.body.floorY) { s.pos.y = sim.body.floorY; s.vel.y = -s.vel.y * 0.35; }
  sparks[i] = s;
}
