// The jogo's light in the world: every glow the game itself draws (the meters between and under the dancers, the trail
// a dodged kick leaves, the thread of an invitation, the streams of a fusion, the results' gems), built on the CPU each
// frame (play/glow.ts) and added into the scene before bloom, as the plasma arcs are. One instance is a capsule from a
// to b (a point when they meet), facing the camera, or lying flat on the floor; its shape picks the falloff:
//   0 soft    a round glow, bright core
//   1 ring    a thin bright circle (the meters' rings, a ripple of light)
//   2 gem     a tall faceted diamond (the results' gems, the streak's beads)
//   3 spark   a hot point with a wide faint glow
// (+4: lying flat on the floor instead of facing the camera)
#include "weft/frame"

/** a: one end (xyz) and the radius (m); b: the other end and the intensity; c: colour and the shape (+4 flat) */
struct Glow { a: vec4f, b: vec4f, c: vec4f }
struct GlowLook { count: u32, minPx: f32, pad0: f32, pad1: f32 }

@group(1) @binding(0) var<uniform> look: GlowLook;
@group(1) @binding(1) var<storage, read> glows: array<Glow>;

struct GOut {
  @builtin(position) pos: vec4f,
  // across the shape in units of its radius (x along, y across), the segment's length in radii, the shape
  @location(0) at: vec4f,
  @location(1) @interpolate(flat) col: vec4f,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

/** how far the quad reaches, in radii, per shape */
fn reachOf(shape: u32) -> f32 {
  if (shape == 0u) { return 2.6; }
  if (shape == 3u) { return 4.0; }
  return 1.6;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  var o: GOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ii >= look.count) { return o; }
  let g = glows[ii];
  let kind = u32(g.c.w + 0.5);
  let shape = kind & 3u;
  let flat = kind >= 4u;
  let a = g.a.xyz;
  let b = g.b.xyz;
  let mid = (a + b) * 0.5;
  let dist = max(dot(mid - frame.camPos, frame.camFwd), 0.05);
  // never thinner than look.minPx pixels where it is (a far meter still reads), its light spread when widened
  let px = dist * 2.0 * tan(frame.fovY * 0.5) / max(frame.res.y, 1.0);
  let r = max(g.a.w, px * look.minPx);
  let R = reachOf(shape);
  let c = CORNERS[vi];
  var wp: vec3f;
  var len = length(b - a) / r;
  if (flat) {
    // a disc or ring lying on the floor round a, a hair above it
    wp = a + vec3f(c.x * r * R, 0.004, c.y * r * R);
    o.at = vec4f(c.x * R, c.y * R, 0.0, f32(shape));
  } else {
    var dir = frame.camUp;
    var side = frame.camRight;
    if (len > 1e-3) {
      dir = (b - a) / (len * r);
      let toCam = normalize(frame.camPos - mid);
      let s = cross(dir, toCam);
      let sl = length(s);
      side = select(frame.camRight, s / max(sl, 1e-5), sl > 1e-3);
    } else { len = 0.0; }
    // x runs from -R to len + R along the segment (in radii), y across it
    let along = mix(-R, len + R, c.x * 0.5 + 0.5);
    wp = a + dir * (along * r) + side * (c.y * R * r);
    o.at = vec4f(along, c.y * R, len, f32(shape));
  }
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.col = vec4f(g.c.rgb, g.b.w * min(1.0, g.a.w / r));
  return o;
}

@fragment fn fs(i: GOut) -> @location(0) vec4f {
  let shape = u32(i.at.w + 0.5);
  let along = clamp(i.at.x, 0.0, i.at.z);
  let q = vec2f(i.at.x - along, i.at.y);
  let d = length(q);
  var v = 0.0;
  if (shape == 0u) {
    v = exp(-2.4 * d * d) * 1.4 + exp(-1.1 * d) * 0.22;
    v *= smoothstep(2.6, 1.6, d);
  } else if (shape == 1u) {
    let e = (d - 1.0) / 0.13;
    v = exp(-e * e) * 1.3 + exp(-2.0 * d * d) * 0.06;
    v *= smoothstep(1.6, 1.25, d);
  } else if (shape == 2u) {
    // a tall diamond with four facets lit differently, and a thin glow round it
    let m = abs(q.x) * 0.62 + abs(q.y) * 1.25;
    let inside = smoothstep(1.0, 0.9, m);
    let facet = select(0.55, 1.0, q.x * q.y > 0.0) * select(0.8, 1.15, q.x > 0.0);
    let ee = (m - 0.97) / 0.05;
    let edge = exp(-ee * ee) * 0.8;
    v = inside * (0.5 * facet + 0.35 * exp(-3.0 * d * d)) + edge + exp(-2.5 * max(m - 1.0, 0.0)) * 0.08 * (1.0 - inside);
    v *= smoothstep(1.6, 1.2, m);
  } else {
    v = exp(-7.0 * d * d) * 2.6 + exp(-1.4 * d) * 0.16;
    v *= smoothstep(4.0, 2.5, d);
  }
  // light only: no focus distance (the glow target's alpha is min-blended, so 1e5 leaves it as it was). A glow is not
  // a surface: writing its distance where it was bright made a binary mask that the depth of field kept sharp and the
  // air fogged the scene behind as if a body stood across it (the landing's hard disc, the pill-shaped sparks)
  return vec4f(i.col.rgb * i.col.a * v, 1e5);
}
