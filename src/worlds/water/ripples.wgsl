// The water's ripples: a damped wave equation on a square height field that follows the dancers (water/ripples.ts
// moves the window in whole cells and says how far, so the waves stay where they are in the world). Each texel holds
// the height now (r, metres) and a step ago (g). Two steps a frame, each reading one texture and writing the other.
// The first also takes the pushes: the dancers' feet and hands where they meet the water (read from the shared body
// joints, so every dancer stirs it without anyone calling anything) and the drops the game asked for (`ripple()`).
#include "../../matter/core/body"

struct Ripples {
  origin: vec2f,   // world xz of texel (0, 0)'s centre
  cell: f32,       // metres per texel
  n: u32,          // texels a side
  shift: vec2i,    // how many texels the window moved since the last frame (taken by the first step)
  c2: f32,         // (wave speed × step / cell)², under 0.5 to stay stable
  damp: f32,       // how much of its motion a texel keeps each step
  waterY: f32,     // the surface's height
  feet: f32,       // how hard a foot pushes the water
  drops: u32,      // how many drops this frame
  edge: f32,       // texels over which the waves die out at the window's edge
  drop: array<vec4f, 16>,   // x, z, strength (m of push), radius (m)
}

override FIRST: u32 = 1u;

@group(1) @binding(0) var<uniform> rip: Ripples;
@group(1) @binding(1) var src: texture_2d<f32>;
@group(1) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

fn at(c: vec2i) -> vec2f {
  let n = i32(rip.n);
  if (c.x < 0 || c.y < 0 || c.x >= n || c.y >= n) { return vec2f(0.0); }
  return textureLoad(src, c, 0).xy;
}

/** the joints that touch the water: ankles, toes, hands (skeleton/rig.ts JOINT) */
const TOUCH = array<u32, 6>(4u, 5u, 10u, 11u, 23u, 32u);

@compute @workgroup_size(8, 8)
fn step(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= rip.n || id.y >= rip.n) { return; }
  let c = vec2i(id.xy);
  var o = vec2i(0);
  if (FIRST == 1u) { o = rip.shift; }
  let s = at(c + o);
  let lap = at(c + o + vec2i(1, 0)).x + at(c + o - vec2i(1, 0)).x + at(c + o + vec2i(0, 1)).x + at(c + o - vec2i(0, 1)).x - 4.0 * s.x;
  var h = s.x + (s.x - s.y) * rip.damp + rip.c2 * lap;
  let prev = s.x;
  if (FIRST == 1u) {
    let p = rip.origin + vec2f(c) * rip.cell;
    var push = 0.0;
    for (var k = 0u; k < min(rip.drops, 16u); k++) {
      let dr = rip.drop[k];
      let e = p - dr.xy;
      push += dr.z * exp(-dot(e, e) / (dr.w * dr.w));
    }
    // a foot or a hand in the water pushes it down where it moves: harder coming down, softer sliding along
    for (var d = 0u; d < bodies.dancers; d++) {
      for (var k = 0u; k < 6u; k++) {
        let j = joints[d * MAXJ + TOUCH[k]];
        let e = p - j.pos.xz;
        let r2 = dot(e, e);
        if (r2 > 0.09) { continue; }
        let above = j.pos.y - rip.waterY;
        let wet = smoothstep(0.14, 0.02, above);
        if (wet <= 0.0) { continue; }
        let moving = max(-j.vel.y, 0.0) * 0.8 + length(j.vel.xz) * 0.25;
        push += rip.feet * wet * min(moving, 4.0) * exp(-r2 / 0.0064);
      }
    }
    // (into the height only: a push is a kick to the water's speed, which then runs out as rings)
    h -= push;
  }
  // the waves die out towards the window's edge, so nothing reflects off it
  let n = f32(rip.n);
  let rim = min(min(f32(c.x), f32(c.y)), min(n - 1.0 - f32(c.x), n - 1.0 - f32(c.y)));
  let fade = smoothstep(0.0, rip.edge, rim);
  textureStore(dst, c, vec4f(clamp(h * fade, -0.2, 0.2), clamp(prev * fade, -0.2, 0.2), 0.0, 1.0));
}
