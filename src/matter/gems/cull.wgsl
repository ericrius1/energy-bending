// GPU-driven level of detail, per view: every stone picks the detail its size on screen deserves (or none, if it's
// off screen or under a pixel) and appends itself to that list. The draw arguments are the counters, so each
// specimen × detail is one indirect draw of exactly the stones that need it. The lists are packed: specimen k owns
// LODS × its count from LODS × (stones before it), one run per detail. Threads past the dancers' stones take the
// fixtures of the view's world (view.fixBase …). Stones near a mirroring floor count their reflection too.
// It runs once per view (weft's `view` option gives it that view's camera in `frame`), into that view's lists.
#include "weft/frame"
#include "./gem"

@group(1) @binding(0) var<uniform> sim: Sim;
@group(1) @binding(1) var<uniform> cview: CullView;
@group(1) @binding(2) var<storage, read> state: array<Particle>;
@group(1) @binding(3) var<storage, read_write> args: array<atomic<u32>>;
@group(1) @binding(4) var<storage, read_write> list: array<u32>;
@group(1) @binding(5) var<storage, read_write> argsR: array<atomic<u32>>;   // the reflection: low detail only
@group(1) @binding(6) var<storage, read_write> listR: array<u32>;
@group(1) @binding(7) var<storage, read> homes: array<Home>;
@group(1) @binding(8) var<storage, read> homes2Prev: array<vec4f>;

// a stone still down from the last dance (resting, or falling between dances) wears that dance's stone until it rises
fn looksOf(i: u32, p: Particle) -> vec4f {
  if (sim.prevLook > 0.5 && i < sim.envBase && (modeIs(p.mode, RESTING) || (modeIs(p.mode, FLYING) && sim.body.settle > 0.5))) { return homes2Prev[i]; }
  return homes[i].look;
}

// radius on screen in pixels (negative: off screen)
fn pixels(p: vec3f, r: f32) -> f32 {
  let c = frame.viewProj * vec4f(p, 1.0);
  if (c.w <= frame.near) { return -1.0; }
  let px = r * frame.proj[1][1] / c.w * frame.res.y * 0.5;
  let m = 1.0 + 2.0 * px / min(frame.res.x, frame.res.y) + 0.02;
  if (abs(c.x) > c.w * m || abs(c.y) > c.w * m) { return -1.0; }
  return px;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let j = gid.x;
  if (j >= sim.count + cview.fixCount) { return; }
  let i = select(j, cview.fixBase + (j - sim.count), j >= sim.count);
  let p = state[i];
  let h2 = looksOf(i, p);
  let t = u32(h2.x);
  var r = h2.y * 1.2;
  if (i < sim.envBase) { r = stoneSize(i, h2.y, sim.gemScale * sim.types[t].z, sim.sizeVar) * 1.2 * spareScale(i, sim.inUse, sim.spareFade); }
  let floorY = sim.body.floorY;
  if (cview.reflectOn > 0.5 && p.pos.y - floorY < 0.8 + r && pixels(vec3f(p.pos.x, 2.0 * floorY - p.pos.y, p.pos.z), r) > sim.cullPx) {
    let rs = atomicAdd(&argsR[(t * LODS + 2u) * 4u + 1u], 1u);
    listR[u32(sim.types[t].x) + rs] = i;
  }
  let px = pixels(p.pos, r);
  if (px < sim.cullPx) { return; }
  var lod = 2u;
  if (px > sim.lod0) { lod = 0u; } else if (px > sim.lod1) { lod = 1u; }
  let slot = atomicAdd(&args[(t * LODS + lod) * 4u + 1u], 1u);
  list[u32(sim.types[t].x) * LODS + lod * u32(sim.types[t].y) + slot] = i;
}
