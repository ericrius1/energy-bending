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
// A gate with no live view this frame shows the last one it had, blurred, or else a shimmer in the far world's hue.
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
  info: vec4f,    // 1 live this frame, 0.5 last frame's, 0 nothing; the floor's height under it; glow; -
  pokes: array<vec4f, 4>,   // where (u, v), age (s), strength
}
/** a view's gates; `clip` is its own near plane when it looks through a gate (a disc behind that is not drawn) */
struct GateView { g: array<Gate, MAX_GATES>, clip: vec4f, count: u32, motes: u32, time: f32, pad: f32 }

@group(1) @binding(0) var<uniform> gates: GateView;
@group(1) @binding(1) var slot0: texture_2d<f32>;
@group(1) @binding(2) var slot1: texture_2d<f32>;
@group(1) @binding(3) var slot2: texture_2d<f32>;

const TAU: f32 = 6.2831853;

fn farTap(slot: i32, uv: vec2f) -> vec3f {
  let u = clamp(uv, vec2f(0.001), vec2f(0.999));
  let a = textureSampleLevel(slot0, samp_linear, u, 0.0).rgb;
  let b = textureSampleLevel(slot1, samp_linear, u, 0.0).rgb;
  let c = textureSampleLevel(slot2, samp_linear, u, 0.0).rgb;
  return select(select(a, b, slot == 1), c, slot == 2);
}
/** last frame's view (it was taken from another camera): soft, so the misfit doesn't show */
fn farBlur(slot: i32, uv: vec2f) -> vec3f {
  let e = 7.0 * frame.invRes;
  return (farTap(slot, uv) * 2.0 + farTap(slot, uv + vec2f(e.x, e.y)) + farTap(slot, uv + vec2f(-e.x, e.y))
    + farTap(slot, uv + vec2f(e.x, -e.y)) + farTap(slot, uv - e)) / 6.0;
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
    h += sin((d - front) * 26.0) * exp(-a * 1.4) * exp(-pow((d - front) * 4.0, 2.0)) * P.w * 0.035 * (1.0 - r2 * 0.6);
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
  let t = dot(G.at.xyz - eye, n) / dn;
  if (t <= 0.0) { discard; }
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
  col += G.rim.rgb * slope * slope * 0.6 * calm;
  col += G.rim.rgb * pow(smoothstep(0.9, 1.0, r), 4.0) * (0.25 + G.rim.w * 2.0);
  col += G.rim.rgb * threadEdge * 2.0;
  col += G.rim.rgb * G.rim.w * 0.15 * (1.0 - r);

  var o: DiscOut;
  // the plane's depth, a few millimetres toward the eye (a gate on a wall or a floor wins over it)
  let cd = frame.viewProj * vec4f(eye + d * max(t - 0.004, 1e-4), 1.0);
  o.depth = clamp(cd.z / cd.w, 0.0, 1.0);
  o.col = vec4f(col, dot(p - eye, frame.camFwd));
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
fn farLight(G: Gate) -> vec3f {
  let slot = i32(G.n.w);
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
  o.col = (farLight(G) * 0.6 + G.rim.rgb * (0.25 + G.rim.w)) * smoothstep(0.2, 0.9, open) * G.info.z;
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
  o.col = (farLight(G) * 0.8 + G.rim.rgb * (0.2 + G.rim.w)) * smoothstep(0.3, 1.0, open) * G.info.z;
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
  o.col = mix(G.rim.rgb, vec3f(1.0), 0.5) * life * (1.5 + 2.5 * ph) * smoothstep(0.2, 0.7, open) * G.info.z;
  return o;
}

@fragment fn fs_motes(i: GlowV) -> @location(0) vec4f {
  let r2 = dot(i.uv, i.uv);
  return vec4f(i.col * exp(-r2 * 4.0), 0.0);
}
