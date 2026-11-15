// A gate as one view sees it. Five draws over the same per-view table of gates (portals/surface.ts):
//   disc   (opaque phase) the other world, live: for each pixel the ray from the eye meets the gate's plane; inside
//          the open disc it shows the view behind the gate (a slot's texture, at this pixel's own screen position,
//          because that view's camera is this one carried through the gate) bent by slow ripples and the rings poked
//          by bodies passing, with colour fringes toward the rim and a thin skin of light. The depth written is the
//          plane's, so what stands in front of the gate hides it and the glows behind it are hidden. Drawn as a
//          screen rectangle round the disc (the CPU's), never as geometry, so a camera about to pass through is never
//          cut by its own near plane: at the face, half the screen shows each world, as it should.
//   ring   (glow) the rim: a filament of light and two threads braided round it, in the colour of whoever last
//          passed; while the gate opens the threads draw the ring first and then weave the disc shut with light.
//   halo   (glow) the soft light round it, coloured by the far world (a blur of the live view) and the rim.
//   pool   (glow) that light on the floor under a gate standing on it.
//   motes  (glow) specks of light drawn in toward the disc from both sides, spiralling as they come.
//   frame  (opaque) the mirror's frame (report 18-wayfinding): an art-nouveau ring of brass gone green in its
//          hollows, a crown of stained glass over it in the far world's colours between brass spokes, whiplash
//          tendrils down its sides, two curled feet to the floor, and vines with leaves climbing it. Real geometry,
//          lit by the world's sun and sky (`lite`); it grows in with the gate's opening.
// A gate with no live view this frame shows the last one it had, blurred, or else its still: the far world seen
// square on through it when it last had a spare slot (portals.ts refreshStill), soft and dim, laid on the disc by the
// disc's own coordinates (it has no parallax: it is a memory of the other side, not a window). A shimmer in the far
// world's hue only until its first still is taken.
#include "weft/frame"
#include "../engine/limits"
#include "../engine/util"

/** one gate in one view */
struct Gate {
  at: vec4f,      // centre, radius
  right: vec4f,   // its right, how open (0 … 1)
  up: vec4f,      // its up, a seed
  n: vec4f,       // its normal (out of the front), the slot to sample (-1: none)
  rect: vec4f,    // its bounds on this view's screen, ndc: x0, y0, x1, y1
  rim: vec4f,     // whoever last passed (linear rgb), a flash after a crossing
  look: vec4f,    // the far world's hue (the shimmer), the gain that matches the far world's exposure to this one's
  info: vec4f,    // 1 live this frame, 0.5 last frame's, 0 nothing, -1 - k its still in layer k; the floor's height
                  // under it; glow; the side the
                  // eye was last strictly on (+1 front, -1 back: an eye on the plane looks through toward the other)
  pokes: array<vec4f, 4>,   // where (u, v), age (s), strength
  lite: vec4f,    // the frame's light in this world: the sun's colour and strength (rgb), the sky's (w)
}
/** a view's gates; `clip` is its own near plane when it looks through a gate (a disc behind that is not drawn) */
struct GateView { g: array<Gate, MAX_GATES>, clip: vec4f, count: u32, motes: u32, time: f32, face: f32 }

@group(1) @binding(0) var<uniform> gates: GateView;
@group(1) @binding(1) var slot0: texture_2d<f32>;
@group(1) @binding(2) var slot1: texture_2d<f32>;
@group(1) @binding(3) var slot2: texture_2d<f32>;
@group(1) @binding(4) var stills: texture_2d_array<f32>;

const TAU: f32 = 6.2831853;

fn farTap(slot: i32, uv: vec2f) -> vec3f {
  let u = clamp(uv, vec2f(0.001), vec2f(0.999));
  let a = textureSampleLevel(slot0, samp_linear, u, 0.0).rgb;
  let b = textureSampleLevel(slot1, samp_linear, u, 0.0).rgb;
  let c = textureSampleLevel(slot2, samp_linear, u, 0.0).rgb;
  return select(select(a, b, slot == 1), c, slot == 2);
}
/** how far the far view's pixel is from its eye (its alpha: the whole path, eye to gate to what it shows) */
fn farDist(slot: i32, uv: vec2f) -> f32 {
  let u = clamp(uv, vec2f(0.001), vec2f(0.999));
  let a = textureSampleLevel(slot0, samp_linear, u, 0.0).a;
  let b = textureSampleLevel(slot1, samp_linear, u, 0.0).a;
  let c = textureSampleLevel(slot2, samp_linear, u, 0.0).a;
  return select(select(a, b, slot == 1), c, slot == 2);
}

/** last frame's view (it was taken from another camera): soft, so the misfit doesn't show */
fn farBlur(slot: i32, uv: vec2f) -> vec3f {
  let e = 7.0 * frame.invRes;
  return (farTap(slot, uv) * 2.0 + farTap(slot, uv + vec2f(e.x, e.y)) + farTap(slot, uv + vec2f(-e.x, e.y))
    + farTap(slot, uv + vec2f(e.x, -e.y)) + farTap(slot, uv - e)) / 6.0;
}

/** a gate's still at a point of the disc (its own coordinates, 1 at the rim): taken with the disc filling the middle of
 *  a square, so the disc maps onto it directly; soft (a few taps round the point), dim (a memory, not the live world) */
fn stillAt(layer: i32, l: vec2f) -> vec3f {
  let uv = vec2f(0.5) + vec2f(l.x, -l.y) * (0.5 / 1.05);
  let e = 2.5 / f32(textureDimensions(stills).x);
  var s = textureSampleLevel(stills, samp_linear, uv, layer, 0.0).rgb * 2.0;
  s += textureSampleLevel(stills, samp_linear, uv + vec2f(e, e), layer, 0.0).rgb;
  s += textureSampleLevel(stills, samp_linear, uv + vec2f(-e, e), layer, 0.0).rgb;
  s += textureSampleLevel(stills, samp_linear, uv + vec2f(e, -e), layer, 0.0).rgb;
  s += textureSampleLevel(stills, samp_linear, uv - vec2f(e, e), layer, 0.0).rgb;
  return min(s / 6.0, vec3f(8.0)) * 0.55;
}

// ---------------------------------------------------------------- the surface's ripples
/** the skin's height at a point of the disc (its own coordinates, 1 at the rim) */
fn ripple(G: Gate, l: vec2f, t: f32) -> f32 {
  let s = G.up.w * 40.0;
  let r2 = dot(l, l);
  // slow swells, pinned at the rim
  var h = 0.0;
  h += sin(dot(l, vec2f(0.8, 0.6)) * 5.1 + t * 0.9 + s) * 0.5;
  h += sin(dot(l, vec2f(-0.5, 0.86)) * 7.3 - t * 1.3 + s * 1.7) * 0.32;
  h += sin(length(l - vec2f(0.2, -0.3)) * 9.0 - t * 1.7) * 0.22;
  h += (vnoise2(l * 3.0 + vec2f(t * 0.11, -t * 0.07) + s) - 0.5) * 0.6;
  h *= 0.02 * (1.0 - r2);
  // rings poked by bodies passing: a wave front running out, dying as it goes
  for (var k = 0; k < 4; k++) {
    let P = G.pokes[k];
    if (P.w <= 0.0) { continue; }
    let d = length(l - P.xy);
    let a = P.z;
    let front = a * 0.55;
    h += sin((d - front) * 26.0) * exp(-a * 1.4) * exp(-pow((d - front) * 4.0, 2.0)) * P.w * 0.005 * (1.0 - r2 * 0.6);
  }
  return h;
}

struct DiscV { @builtin(position) pos: vec4f, @location(0) @interpolate(flat) gate: u32 }

@vertex fn vs_disc(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DiscV {
  var o: DiscV;
  let R = gates.g[ii].rect;
  let c = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[vi];
  o.pos = vec4f(mix(R.x, R.z, c.x), mix(R.y, R.w, c.y), 0.5, 1.0);
  o.gate = ii;
  return o;
}

struct DiscOut { @location(0) col: vec4f, @builtin(frag_depth) depth: f32 }

fn screenUv(p: vec3f) -> vec2f {
  let c = frame.viewProj * vec4f(p, 1.0);
  let n = c.xy / max(c.w, 1e-5);
  return vec2f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5);
}

@fragment fn fs_disc(i: DiscV) -> DiscOut {
  let G = gates.g[i.gate];
  let uv = i.pos.xy * frame.invRes;
  let d = viewRay(uv);
  let eye = frame.camPos;
  let n = G.n.xyz;
  let dn = dot(d, n);
  if (abs(dn) < 1e-6) { discard; }
  // (an eye on the plane itself, inside the disc: a ray going on through, away from the side the eye came from,
  // meets the disc where the eye is; one going back out doesn't)
  let side = dot(eye - G.at.xyz, n);
  var t = dot(G.at.xyz - eye, n) / dn;
  if (abs(side) < 1e-4) {
    if (dn * G.info.w > 0.0) { discard; }
    t = 0.0;
  } else if (t <= 0.0) { discard; }
  let p = eye + d * t;
  if (dot(gates.clip.xyz, p) + gates.clip.w < 0.0) { discard; }
  let q = p - G.at.xyz;
  let Rad = G.at.w;
  let l = vec2f(dot(q, G.right.xyz), dot(q, G.up.xyz)) / Rad;
  let r = length(l);
  let open = G.right.w;
  let time = gates.time;
  let th = atan2(l.y, l.x);

  // ---- the weave: the disc fills from the rim inward along two families of spiral threads
  let reach = smoothstep(0.0, 0.45, open);
  if (r > 1.0 || reach <= 0.0) { discard; }
  let wave = 1.0 + 0.04 * sin(th * 5.0 + time * 1.3 + G.up.w * 20.0) * (1.0 - open);
  let ls = log(max(r, 0.02)) * 2.2;
  let a1 = fract(th * 9.0 / TAU + ls - time * 0.03);
  let a2 = fract(-th * 9.0 / TAU + ls + time * 0.025);
  let f = min(abs(a1 - 0.5), abs(a2 - 0.5)) * 2.0;        // 0 on a thread, 1 between
  let width = smoothstep(0.3, 1.0, open) * 1.05 + (1.0 - smoothstep(0.0, 0.25, 1.0 - r)) * reach;
  if (f > width * wave) { discard; }
  let threadEdge = (1.0 - smoothstep(0.0, 0.18, width - f)) * (1.0 - smoothstep(0.85, 1.0, open));

  // ---- the skin: its slope bends the view behind it
  let e = 0.012;
  let h0 = ripple(G, l, time);
  let gx = (ripple(G, l + vec2f(e, 0.0), time) - h0) / e;
  let gy = (ripple(G, l + vec2f(0.0, e), time) - h0) / e;
  // (the skin calms as the eye comes up to it: at the face the two worlds must meet exactly, and a slope seen from a
  // few centimetres would throw the view across the screen)
  let calm = smoothstep(0.03, 0.7, abs(dot(eye - G.at.xyz, n)) / Rad);
  let suv0 = uv;
  let du = screenUv(p + G.right.xyz * Rad * 0.1) - screenUv(p);
  let dv = screenUv(p + G.up.xyz * Rad * 0.1) - screenUv(p);
  var bend = (du * gx + dv * gy) * 2.2 * calm;
  let bl = length(bend);
  if (bl > 0.02) { bend *= 0.02 / bl; }
  let suv = suv0 + bend;
  // colour fringes: more toward the rim, along the line from the centre and along the bend
  let cuv = screenUv(G.at.xyz);
  let radial = normalize(suv0 - cuv + vec2f(1e-5));
  let fr = ((smoothstep(0.6, 1.0, r) * 0.0035 + 0.0008) * radial + bend * 0.25) * calm;

  var far = vec3f(0.0);
  let slot = i32(G.n.w);
  let live = G.info.x;
  if (slot >= 0 && live > 0.75) {
    far = vec3f(farTap(slot, suv + fr).r, farTap(slot, suv).g, farTap(slot, suv - fr).b);
  } else if (slot >= 0 && live > 0.25) {
    far = farBlur(slot, suv) * 0.9;
  } else if (live < -0.5) {
    // its still, swaying a little with the skin (seen from the back, the other way round)
    let ls = vec2f(l.x * select(-1.0, 1.0, side >= 0.0), l.y) + vec2f(gx, gy) * 0.6;
    far = stillAt(i32(-live - 1.0 + 0.5), ls);
  } else {
    // nothing live: a shimmer in the far world's hue
    let nz = fbm(vec3f(l * 3.0, time * 0.15 + G.up.w * 9.0));
    far = G.look.rgb * (0.25 + 0.75 * nz * nz) * (0.7 + 0.3 * sin(time * 2.0 + r * 9.0));
  }
  far *= G.look.w;

  // ---- the skin of light on it
  let glance = 1.0 - abs(dn);
  let F = pow(glance, 4.0);
  let slope = length(vec2f(gx, gy));
  let film = thinFilm(r * 0.9 + h0 * 40.0 + time * 0.04 + G.up.w) ;
  var col = far * (1.0 - 0.2 * F);
  col += film * (0.003 + 0.05 * F) * mix(vec3f(1.0), G.rim.rgb, 0.5) * calm;
  col += G.rim.rgb * min(slope * slope, 0.05) * 0.6 * calm;
  // the rim's light, and a crossing's flash running round it (only round it: at the face the disc is the whole
  // screen, and a veil over it would be a pop)
  col += G.rim.rgb * pow(smoothstep(0.9, 1.0, r), 4.0) * (0.25 + G.rim.w * 2.0) * mix(0.3, 1.0, calm);
  col += G.rim.rgb * threadEdge * 2.0;

  var o: DiscOut;
  // the plane's depth, a few millimetres toward the eye (a gate on a wall or a floor wins over it)
  let cd = frame.viewProj * vec4f(eye + d * max(t - 0.004, 1e-4), 1.0);
  o.depth = clamp(cd.z / cd.w, 0.0, 1.0);
  // alpha is the distance the air and the depth of field read. Far from the gate it is the gate's own (this world's
  // air lies over the disc as over a window); at the face it becomes the far view's path, so the depth of field
  // doesn't see the whole screen as a few centimetres away as the eye passes through. Capped at `face` (gates.faceDist,
  // 2.5 m: a metre blurred the crossing behind a player; the brightness at the face measured the same at 0 and 1 m)
  let here = dot(p - eye, frame.camFwd);
  var dist = here;
  // (from two radii out, not at the skin's calm: a camera following a player through the door takes a second over the
  // last metre, and reading the plane's few centimetres there blurred the whole frame)
  let pane = smoothstep(0.7, 2.0, abs(dot(eye - G.at.xyz, n)) / Rad);
  if (slot >= 0 && live > 0.75) { dist = mix(max(here, min(farDist(slot, suv), gates.face)), here, pane); }
  o.col = vec4f(col, dist);
  return o;
}

// ---------------------------------------------------------------- the rim: a filament and two braided threads
const SEGS_RING: u32 = 96u;

struct GlowV { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec3f }

fn ringPoint(G: Gate, th: f32, strand: u32, time: f32) -> vec3f {
  let Rad = G.at.w;
  var rr = 1.0;
  var off = 0.0;
  if (strand > 0u) {
    let ph = select(0.0, 3.14159, strand == 2u) + G.up.w * 10.0;
    rr = 1.0 + 0.022 * sin(th * 7.0 + time * 0.8 + ph);
    off = 0.03 * cos(th * 7.0 + time * 0.8 + ph);
  }
  return G.at.xyz + (G.right.xyz * cos(th) + G.up.xyz * sin(th)) * Rad * rr + G.n.xyz * Rad * off;
}

@vertex fn vs_ring(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GlowV {
  var o: GlowV;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let strands = 3u;
  let gi = ii / strands;
  let strand = ii % strands;
  if (gi >= gates.count) { return o; }
  let G = gates.g[gi];
  let open = G.right.w;
  if (open <= 0.0) { return o; }
  let seg = vi / 6u;
  let c = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[vi % 6u];
  // opening, the threads run round first (the arc grows), then the filament comes up
  let arc = smoothstep(0.0, 0.5, open);
  let th0 = f32(seg) / f32(SEGS_RING) * TAU * arc + G.up.w * TAU;
  let th1 = f32(seg + 1u) / f32(SEGS_RING) * TAU * arc + G.up.w * TAU;
  let time = gates.time;
  let a = ringPoint(G, th0, strand, time);
  let b = ringPoint(G, th1, strand, time);
  let P = mix(a, b, c.x);
  let T = normalize(b - a + vec3f(1e-6));
  var w = G.at.w * select(0.011, 0.006, strand > 0u);
  // a filament a few pixels wide however far: never thinner than ~1.5 px
  let dist = max(length(P - frame.camPos), 0.05);
  w = max(w, dist * 1.6 * frame.invRes.y * 2.0 * tan(frame.fovY * 0.5));
  let side = normalize(cross(T, P - frame.camPos)) * w;
  o.pos = frame.viewProj * vec4f(P + side * c.y, 1.0);
  o.uv = c;
  let k = select(1.0, 0.7, strand > 0u) * select(smoothstep(0.35, 0.8, open), 1.0, strand > 0u);
  let flick = 0.85 + 0.15 * sin(time * 3.0 + th0 * 5.0 + f32(strand) * 2.0);
  o.col = mix(G.rim.rgb, vec3f(1.0), 0.15) * (1.3 + G.rim.w * 4.0) * k * flick * G.info.z;
  return o;
}

@fragment fn fs_ring(i: GlowV) -> @location(0) vec4f {
  let x = i.uv.y;
  return vec4f(i.col * exp(-x * x * 3.5), 0.0);
}

// ---------------------------------------------------------------- the halo, and its light on the floor
/** the far world's light, as it shows through the gate (a wide blur of its live view round the gate's middle) */
/** the glows fade as the eye comes up to the disc: at the face there is no gate to see, only the other world */
fn faceFade(G: Gate) -> f32 { return smoothstep(0.05, 0.8, abs(dot(frame.camPos - G.at.xyz, G.n.xyz)) / G.at.w); }

fn farLight(G: Gate) -> vec3f {
  let slot = i32(G.n.w);
  if (G.info.x < -0.5) {
    let k = i32(-G.info.x - 1.0 + 0.5);
    return (stillAt(k, vec2f(0.0)) + stillAt(k, vec2f(0.5, 0.3)) + stillAt(k, vec2f(-0.5, -0.3))) / 3.0 * G.look.w;
  }
  if (slot < 0 || G.info.x < 0.25) { return G.look.rgb * 0.5; }
  let c = screenUv(G.at.xyz);
  let e = 0.06;
  var s = vec3f(0.0);
  for (var k = 0; k < 8; k++) {
    let a = f32(k) * 0.785;
    s += farTap(slot, c + vec2f(cos(a), sin(a)) * e);
  }
  return min(s / 8.0, vec3f(6.0)) * G.look.w;
}

@vertex fn vs_halo(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GlowV {
  var o: GlowV;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ii >= gates.count) { return o; }
  let G = gates.g[ii];
  let open = G.right.w;
  if (open <= 0.0) { return o; }
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let Rad = G.at.w;
  let toEye = normalize(frame.camPos - G.at.xyz);
  // a little toward the eye, so the disc's own depth doesn't hide it
  let ctr = G.at.xyz + toEye * Rad * 0.3;
  let s = Rad * 2.4;
  o.pos = frame.viewProj * vec4f(ctr + (frame.camRight * c.x + frame.camUp * c.y) * s, 1.0);
  o.uv = c * 2.4;
  o.col = (farLight(G) * 0.6 + G.rim.rgb * (0.25 + G.rim.w)) * smoothstep(0.2, 0.9, open) * G.info.z * faceFade(G);
  return o;
}

@fragment fn fs_halo(i: GlowV) -> @location(0) vec4f {
  let r = length(i.uv);
  let k = exp(-max(r - 1.0, 0.0) * 2.2) * smoothstep(0.75, 1.15, r) * (1.0 - smoothstep(2.0, 2.4, r));
  return vec4f(i.col * k * 0.07, 0.0);
}

@vertex fn vs_pool(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GlowV {
  var o: GlowV;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ii >= gates.count) { return o; }
  let G = gates.g[ii];
  let open = G.right.w;
  let Rad = G.at.w;
  let above = G.at.y - G.info.y;
  // only a gate standing over a floor (not lying in it, nor high above it)
  if (open <= 0.0 || abs(G.n.y) > 0.7 || above > Rad * 2.0) { return o; }
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let s = Rad * 2.2;
  let P = vec3f(G.at.x, G.info.y + 0.004, G.at.z) + vec3f(c.x, 0.0, c.y) * s;
  o.pos = frame.viewProj * vec4f(P, 1.0);
  o.uv = c * 2.2;
  o.col = (farLight(G) * 0.8 + G.rim.rgb * (0.2 + G.rim.w)) * smoothstep(0.3, 1.0, open) * G.info.z * faceFade(G);
  return o;
}

@fragment fn fs_pool(i: GlowV) -> @location(0) vec4f {
  let r = length(i.uv);
  return vec4f(i.col * exp(-r * r * 0.9) * 0.12, 0.0);
}

// ---------------------------------------------------------------- motes drawn in toward the disc
@vertex fn vs_motes(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GlowV {
  var o: GlowV;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let M = max(gates.motes, 1u);
  let gi = ii / M;
  let k = ii % M;
  if (gi >= gates.count) { return o; }
  let G = gates.g[gi];
  let open = G.right.w;
  if (open <= 0.2) { return o; }
  let Rad = G.at.w;
  let time = gates.time;
  let seed = rnd(k * 7919u + u32(G.up.w * 9973.0));
  let period = 5.0 + 6.0 * rnd(k * 31u + 5u);
  let ph = fract(seed + time / period);
  // a spiral in: from well outside the rim down to the disc, turning as it comes
  let rr = mix(2.2 + 0.8 * rnd(k * 13u + 1u), 0.15 + 0.6 * rnd(k * 17u + 3u), ph * ph);
  let ang = seed * TAU + ph * 2.2 * select(1.0, -1.0, (k & 1u) == 1u);
  let side = select(1.0, -1.0, (k & 2u) == 2u);
  let along = (1.0 - ph) * (1.0 - ph) * (0.6 + 0.8 * rnd(k * 29u + 11u)) * side;
  let P = G.at.xyz + (G.right.xyz * cos(ang) + G.up.xyz * sin(ang)) * rr * Rad + G.n.xyz * along * Rad;
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  let size = 0.008 + 0.01 * rnd(k * 37u + 2u);
  o.pos = frame.viewProj * vec4f(P + (frame.camRight * c.x + frame.camUp * c.y) * size, 1.0);
  o.uv = c;
  let life = smoothstep(0.0, 0.15, ph) * (1.0 - smoothstep(0.85, 1.0, ph));
  o.col = mix(G.rim.rgb, vec3f(1.0), 0.5) * life * (1.5 + 2.5 * ph) * smoothstep(0.2, 0.7, open) * G.info.z * faceFade(G);
  return o;
}

@fragment fn fs_motes(i: GlowV) -> @location(0) vec4f {
  let r2 = dot(i.uv, i.uv);
  return vec4f(i.col * exp(-r2 * 4.0), 0.0);
}

// ---------------------------------------------------------------- the frame: brass, stained glass, vines
// Laid out by vertex index, per gate (instance): FRAME_CURVES tubes of FRAME_SEGS × FRAME_SIDES quads, then the glass
// panes, then the leaves. Gate-local coordinates (x right, y up, z out of the front) in radii; the floor's height is
// info.y.
const FRAME_CURVES: u32 = 14u;
const FRAME_SEGS: u32 = 40u;
const FRAME_SIDES: u32 = 6u;
const FRAME_TUBE_V: u32 = FRAME_CURVES * FRAME_SEGS * FRAME_SIDES * 6u;
const FRAME_PANES: u32 = 7u;
const FRAME_PANE_SUB: u32 = 5u;
const FRAME_GLASS_V: u32 = FRAME_PANES * FRAME_PANE_SUB * 6u;
const FRAME_LEAVES: u32 = 40u;
const ARCH_A0: f32 = 0.2618;   // 15°
const ARCH_A1: f32 = 2.8798;   // 165°
const RING_R: f32 = 1.07;
const ARCH_R: f32 = 1.52;

fn bez(a: vec2f, b: vec2f, c: vec2f, t: f32) -> vec2f { let u = 1.0 - t; return u * u * a + 2.0 * u * t * b + t * t * c; }
fn archR(a: f32) -> f32 { return ARCH_R + 0.16 * pow(max(sin(a), 0.0), 12.0); }
fn onCircle(r: f32, a: f32) -> vec2f { return vec2f(cos(a), sin(a)) * r; }

/** a curve's point (gate-local, radii) and its thickness, at s (0 … 1). `floorY`: the floor's height, local */
fn frameCurve(c: u32, s: f32, floorY: f32) -> vec4f {
  if (c == 0u) { return vec4f(onCircle(RING_R, s * TAU), 0.0, 0.07 + 0.025 * pow(abs(sin(s * TAU)), 6.0)); }
  if (c == 1u) { let a = mix(ARCH_A0, ARCH_A1, s); return vec4f(onCircle(archR(a), a), -0.01, 0.048); }
  if (c <= 7u) {
    // the spokes between the panes (the arch's two ends are the tendrils')
    let a = mix(ARCH_A0, ARCH_A1, f32(c - 1u) / f32(FRAME_PANES));
    return vec4f(onCircle(mix(RING_R, archR(a), s), a), -0.01, 0.026);
  }
  if (c <= 9u) {
    // the feet: from the ring's lower quarter down to the floor, ending in a curl
    let sx = select(-1.0, 1.0, c == 9u);
    let a0 = select(4.15, 5.27, c == 9u);
    let p0 = onCircle(RING_R, a0);
    let p2 = vec2f(sx * 0.95, floorY + 0.06);
    let p1 = vec2f(sx * 0.72, mix(p0.y, floorY, 0.9));
    var p = bez(p0, p1, p2, min(s / 0.8, 1.0));
    if (s > 0.8) {
      let k = (s - 0.8) / 0.2;
      let a = k * 4.4;
      let r = 0.13 * (1.0 - 0.6 * k);
      p = p2 + vec2f(sx * (sin(a) * r), (1.0 - cos(a)) * r);
    }
    return vec4f(p, 0.0, mix(0.06, 0.03, s));
  }
  if (c <= 11u) {
    // the whiplash tendrils: from the ring's flank up and out to the arch's end, an S on the way
    let sx = select(-1.0, 1.0, c == 11u);
    let a0 = select(3.4, 6.02, c == 11u);
    let a1 = select(ARCH_A1, ARCH_A0, c == 11u);
    let p0 = onCircle(RING_R, a0);
    let p2 = onCircle(archR(a1), a1);
    let p1 = vec2f(sx * 1.95, -0.05);
    let p = bez(p0, p1, p2, s) + vec2f(sx * 0.08 * sin(s * 6.2832), 0.0);
    return vec4f(p, 0.0, mix(0.045, 0.03, s));
  }
  // the vines: a thin green stem twining round the ring's lower half and up one flank (12), and the other (13)
  let sx = select(-1.0, 1.0, c == 13u);
  let a = select(mix(4.71, 1.95, s), mix(4.71, 1.19 - 0.0, s), c == 13u);
  let p = onCircle(RING_R + 0.06 + 0.035 * sin(s * 37.0), select(a, 9.42 - a, c == 13u));
  return vec4f(p, 0.05 * cos(s * 37.0) + 0.02 * sx, 0.016);
}

struct FrameV {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(flat) kind: u32,   // 0 brass, 1 glass, 2 leaf, 3 stem
  @location(4) @interpolate(flat) gate: u32,
}

fn toWorld(G: Gate, l: vec3f) -> vec3f { return G.at.xyz + (G.right.xyz * l.x + G.up.xyz * l.y + G.n.xyz * l.z) * G.at.w; }
fn dirWorld(G: Gate, l: vec3f) -> vec3f { return normalize(G.right.xyz * l.x + G.up.xyz * l.y + G.n.xyz * l.z); }

@vertex fn vs_frame(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FrameV {
  var o: FrameV;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (ii >= gates.count) { return o; }
  let G = gates.g[ii];
  let open = G.right.w;
  if (open <= 0.0) { return o; }
  // grows in with the opening, all there from half open
  let grow = smoothstep(0.0, 0.5, open);
  let floorY = (G.info.y - G.at.y) / G.at.w;
  o.gate = ii;
  let q = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  var L = vec3f(0.0);
  var N = vec3f(0.0, 0.0, 1.0);
  if (vi < FRAME_TUBE_V) {
    let quad = vi / 6u;
    let corner = q[vi % 6u];
    let c = quad / (FRAME_SEGS * FRAME_SIDES);
    let r = quad % (FRAME_SEGS * FRAME_SIDES);
    let seg = r / FRAME_SIDES;
    let side = r % FRAME_SIDES;
    let s = (f32(seg) + corner.x) / f32(FRAME_SEGS);
    let ang = (f32(side) + corner.y) / f32(FRAME_SIDES) * TAU;
    let P = frameCurve(c, s, floorY);
    let ds = 0.004;
    let P2 = frameCurve(c, min(s + ds, 1.0), floorY).xyz - frameCurve(c, max(s - ds, 0.0), floorY).xyz;
    let T = normalize(P2 + vec3f(1e-6, 0.0, 0.0));
    let B0 = select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(T.z) > 0.9);
    let U = normalize(cross(T, B0));
    let V = cross(T, U);
    N = U * cos(ang) + V * sin(ang);
    L = P.xyz + N * P.w * grow;
    o.kind = select(0u, 3u, c >= 12u);
    o.uv = vec2f(s, f32(c));
  } else if (vi < FRAME_TUBE_V + FRAME_GLASS_V) {
    // the crown's panes: between the ring and the arch, a little behind the brass
    let k = vi - FRAME_TUBE_V;
    let quad = k / 6u;
    let corner = q[k % 6u];
    let pane = quad / FRAME_PANE_SUB;
    let sub = quad % FRAME_PANE_SUB;
    let u = (f32(pane) + (f32(sub) + corner.x) / f32(FRAME_PANE_SUB)) / f32(FRAME_PANES);
    let a = mix(ARCH_A0, ARCH_A1, u);
    L = vec3f(onCircle(mix(RING_R, archR(a), corner.y), a), -0.012);
    L = vec3f(L.xy * mix(0.85, 1.0, grow), L.z);
    N = vec3f(0.0, 0.0, 1.0);
    o.kind = 1u;
    o.uv = vec2f(u * f32(FRAME_PANES), corner.y);
  } else {
    // the leaves: on the vines, each a small blade turned out from its stem
    let k = vi - FRAME_TUBE_V - FRAME_GLASS_V;
    let leaf = k / 6u;
    let corner = q[k % 6u];
    let stem = 12u + (leaf & 1u);
    let s = (f32(leaf / 2u) + 0.5 + 0.3 * (rnd(leaf * 17u + 3u) - 0.5)) / f32(FRAME_LEAVES / 2u);
    let P = frameCurve(stem, s, floorY).xyz;
    let out2 = normalize(vec3f(P.xy, 0.0));
    let tw = rnd(leaf * 31u + 7u) * TAU;
    let along = normalize(out2 * cos(tw * 0.3) + vec3f(-out2.y, out2.x, 0.0) * sin(tw * 0.3) + vec3f(0.0, 0.0, 0.5 * sin(tw)));
    let side = normalize(cross(along, vec3f(0.0, 0.0, 1.0)) + vec3f(0.0, 0.0, 0.3));
    let size = (0.08 + 0.05 * rnd(leaf * 13u + 1u)) * grow;
    let c2 = corner * 2.0 - 1.0;
    L = P + along * (corner.x * size * 1.6) + side * c2.y * size * 0.5;
    N = normalize(cross(along, side));
    o.kind = 2u;
    o.uv = vec2f(corner.x, c2.y);
  }
  let wp = toWorld(G, L);
  o.wp = wp;
  o.nrm = dirWorld(G, N);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

@fragment fn fs_frame(i: FrameV, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let G = gates.g[i.gate];
  // (a piece of the frame right at the eye dissolves, as the near fade does a world's solids: a camera standing by a
  // mirror isn't looking through a brass tube)
  let near = smoothstep(0.5, 1.6, length(i.wp - frame.camPos));
  if (near < 1.0 && pixelRnd(vec2i(i.pos.xy), 7u) > near) { discard; }
  var n = normalize(i.nrm);
  if (!ff && i.kind != 0u && i.kind != 3u) { n = -n; }
  let v = normalize(frame.camPos - i.wp);
  let sunDir = normalize(vec3f(0.35, 0.85, 0.4));
  let sun = G.lite.rgb;
  let sky = G.lite.w;
  let dif = max(dot(n, sunDir), 0.0);
  let hemi = 0.55 + 0.45 * n.y;
  var col = vec3f(0.0);
  if (i.kind == 0u) {
    // brass, gone green in its hollows (and where the noise says it weathered)
    let patina = smoothstep(0.45, 0.75, vnoise(i.wp * 5.0) * 0.7 + (1.0 - hemi) * 0.5);
    let base = mix(vec3f(0.66, 0.4, 0.13), vec3f(0.22, 0.52, 0.42), patina * 0.75);
    let h = normalize(sunDir + v);
    let spec = pow(max(dot(n, h), 0.0), 40.0) * (1.0 - patina * 0.8);
    let fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    col = base * (sun * dif + vec3f(sky) * hemi * vec3f(0.9, 0.95, 1.0)) + sun * spec * vec3f(1.0, 0.86, 0.6) * 1.6
      + mix(vec3f(0.9, 0.7, 0.4), vec3f(0.7, 0.85, 1.0), n.y * 0.5 + 0.5) * sky * fres * 0.6;
  } else if (i.kind == 1u) {
    // stained glass: each pane its colour (gold, teal, rose, leaf; the keystone the far world's own), lit from behind
    // by the far world, a lead line drawing a petal in each
    let pane = u32(floor(i.uv.x));
    let f = fract(i.uv.x);
    let pal = array<vec3f, 4>(vec3f(1.0, 0.72, 0.25), vec3f(0.25, 0.78, 0.75), vec3f(1.0, 0.45, 0.42), vec3f(0.45, 0.82, 0.3));
    var tint = pal[pane % 4u];
    if (pane == FRAME_PANES / 2u) { tint = G.look.rgb; }
    tint = mix(tint, G.look.rgb, 0.2);
    tint = tint * tint;
    let petal = abs(length(vec2f((f - 0.5) * 1.6, i.uv.y - 0.15)) - 0.42);
    let lead = smoothstep(0.035, 0.0, petal);
    let grain = 0.8 + 0.4 * vnoise(i.wp * 14.0);
    let glow = 0.5 + 1.6 * sky + G.rim.w * 2.0;
    col = mix(tint * grain * glow * (0.6 + 0.4 * i.uv.y), vec3f(0.05, 0.04, 0.02), lead * 0.85);
    col += sun * dif * tint * 0.25;
  } else if (i.kind == 2u) {
    // a leaf: a pointed oval blade, a midrib, light through it
    let x = i.uv.x;
    let y = i.uv.y;
    let w = sin(x * 3.14159) * (1.0 - 0.3 * x);
    if (abs(y) > w) { discard; }
    let base = mix(vec3f(0.18, 0.42, 0.12), vec3f(0.42, 0.68, 0.2), x * 0.6 + 0.2 * vnoise(i.wp * 20.0));
    let rib = smoothstep(0.08, 0.0, abs(y)) * 0.25;
    let through = max(dot(-n, sunDir), 0.0) * 0.5;
    col = base * (sun * (dif + through) + vec3f(sky) * hemi * vec3f(0.85, 1.0, 0.9)) * (1.0 + rib);
  } else {
    col = vec3f(0.22, 0.4, 0.14) * (sun * dif + vec3f(sky) * hemi);
  }
  let here = dot(i.wp - frame.camPos, frame.camFwd);
  return vec4f(col, here);
}
