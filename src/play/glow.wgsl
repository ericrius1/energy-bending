// The jogo's light in the world: every glow the game itself draws (the meters between and under the dancers, the trail
// a dodged kick leaves, the thread of an invitation, the streams of a fusion, the results' gems), built on the CPU each
// frame (play/glow.ts) and added into the scene before bloom, as the plasma arcs are. One instance is a capsule from a
// to b (a point when they meet), facing the camera, or lying flat on the floor; its shape picks the falloff:
//   0 soft    a round glow, bright core
//   1 ring    a thin bright circle (the meters' rings, a ripple of light)
//   2 gem     a tall faceted diamond (the results' gems, the streak's beads)
//   3 spark   a hot point with a wide faint glow
// (+4: lying flat on the floor instead of facing the camera)
//   8 petal   a petal from a (its base) to b (its tip), r its half width: a narrow base swelling to a round tip, its
//             colour lit toward the tip, a gold rim and midrib and a gold heart at the base (the finale's bloom)
//   9 leaf    the same with a pointed tip (a leaf on a vine of light)
//  10 petal   the same, its gold midrib, rim and heart faint, and where it is drawn into a view's glow pass (the
//             duel's bloom: glow-draw.ts declareLayer) its own distance written where it stands, so the air lays it
//             over the world there (post/air.wgsl; report 24: thirteen gold midribs from one heart read as white rays
//             across the petals, and the petals, added into the scene, were fogged and lit as the sky behind them)
// (+4 on a petal or a leaf, 12 and 13: lying across the floor instead of turned to the camera)
#include "weft/frame"

/** a: one end (xyz) and the radius (m); b: the other end and the intensity; c: colour and the shape (+4 flat) */
struct Glow { a: vec4f, b: vec4f, c: vec4f }
/** count: instances drawn; skipLo … skipHi: a range of the list this draw leaves out (another draws it) */
struct GlowLook { count: u32, minPx: f32, skipLo: f32, skipHi: f32 }

@group(1) @binding(0) var<uniform> look: GlowLook;
@group(1) @binding(1) var<storage, read> glows: array<Glow>;

struct GOut {
  @builtin(position) pos: vec4f,
  // across the shape in units of its radius (x along, y across), the segment's length in radii, the shape
  @location(0) at: vec4f,
  @location(1) @interpolate(flat) col: vec4f,
  /** the view distance (along the camera's forward) */
  @location(2) dist: f32,
}

const CORNERS = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));

/** how far the quad reaches, in radii, per shape */
fn reachOf(shape: u32) -> f32 {
  if (shape == 0u) { return 2.6; }
  if (shape >= 4u) { return 1.25; }
  if (shape == 3u) { return 4.0; }
  return 1.6;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  var o: GOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ii >= look.count || (f32(ii) >= look.skipLo && f32(ii) < look.skipHi)) { return o; }
  let g = glows[ii];
  let kind = u32(g.c.w + 0.5);
  // (a petal or a leaf is shape 4 or 5; one lying across the floor keeps its length's direction, its width level)
  let petal = kind >= 8u;
  let shape = select(kind & 3u, 4u + (kind & 1u) + (kind & 2u), petal);
  let flat = kind >= 4u && kind < 8u;
  let lying = petal && (kind & 4u) != 0u;
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
      if (lying) {
        let ls = cross(dir, vec3f(0.0, 1.0, 0.0));
        side = select(side, ls / max(length(ls), 1e-5), length(ls) > 1e-3);
      }
    } else { len = 0.0; }
    // x runs from -R to len + R along the segment (in radii), y across it
    let along = mix(-R, len + R, c.x * 0.5 + 0.5);
    wp = a + dir * (along * r) + side * (c.y * R * r);
    o.at = vec4f(along, c.y * R, len, f32(shape));
  }
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.dist = dot(wp - frame.camPos, frame.camFwd);
  o.col = vec4f(g.c.rgb, g.b.w * min(1.0, g.a.w / r));
  return o;
}

/** a petal's (or a leaf's) half width at t (0 its base, 1 its tip), in radii */
fn petalW(t: f32, leaf: bool) -> f32 {
  let u = clamp(t, 0.0, 1.0);
  if (leaf) { return pow(sin(3.14159265 * pow(u, 0.75)), 0.9); }
  let s = pow(u, 1.6);
  return 2.0 * sqrt(max(s * (1.0 - s), 0.0));
}

@fragment fn fs(i: GOut) -> @location(0) vec4f {
  let shape = u32(i.at.w + 0.5);
  let along = clamp(i.at.x, 0.0, i.at.z);
  let q = vec2f(i.at.x - along, i.at.y);
  let d = length(q);
  // (the edge's width on screen, in radii: taken here, in uniform control flow)
  let aa = max(fwidth(i.at.y), 0.015);
  var v = 0.0;
  if (shape >= 4u) {
    // a petal or a leaf: its body in its colour, brighter toward the tip where the sun catches it; a gold rim, a gold
    // midrib fading toward the tip and a gold heart at the base; a faint glow round it
    let t = i.at.x / max(i.at.z, 1e-3);
    let w = petalW(t, shape == 5u);
    let goldK = select(1.0, 0.25, shape == 6u);
    let e = select(abs(i.at.y) - w, 1.0 + abs(i.at.y), t < 0.0 || t > 1.0);
    let inside = smoothstep(aa * 1.5, -aa * 1.5, e);
    let tt = clamp(t, 0.0, 1.0);
    let body = inside * (0.42 + 0.58 * tt * tt) * (0.85 + 0.15 * smoothstep(0.0, -0.5, e));
    let rim = inside * exp(-pow((e + 0.08) / 0.1, 2.0)) * (0.5 + 0.5 * tt);
    let vein = inside * exp(-pow(i.at.y / 0.05, 2.0)) * (1.0 - tt) * 0.7;
    let heart = inside * pow(1.0 - tt, 4.0) * 0.9;
    let halo = exp(-4.0 * max(e, 0.0)) * 0.07 * (1.0 - inside);
    let gold = vec3f(1.6, 1.18, 0.46);
    let c = i.col.rgb * (body + halo) + gold * (rim * 0.85 + vein + heart) * goldK;
    // (a laid-over petal says where it stands; in the scene pass the blend leaves the alpha as it was)
    return vec4f(c * i.col.a, select(1e5, i.dist, shape == 6u && inside > 0.5));
  }
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
