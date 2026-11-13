// The Tide Temple's stones (layout.ts places them): blocks (the altar, the lintels, the gate, walls, steps, the platform
// the court stands on) and drums (pillars standing, snapped or lying where they fell; capitals and bases). Each
// instance is made from the vertex index: a block's six faces in a grid, a drum's rings from the middle of its foot round
// its side to the middle of its top, a ragged top pushed down by noise for a broken one (the same function of position
// on every face, so it stays closed). A drum's side has its profile in the mesh: the shaft's slight taper and swell, a
// capital's echinus flaring out to its top, a base's torus, and the flutes themselves (twenty scallops with sharp
// arrises) where there are sides enough for them.
//
// The carving is relief, lit: a height field over each carved face whose slope bends the light and whose hollows hold
// the shadow. A band of egg-and-dart under a block's top (kind 1); on a panel (kind 2), a raised frame round a roundel
// with a rosette and lines of an inscription cut in V-section, worn away in places. The stone is weathered: dark streaks
// running down from every top and joint where the rain runs, chipped arrises showing fresh stone, lichen in crusts on
// the dry upper stone, a white line of salt at the high tide's mark, weed below the low water, and wet stone dark and
// glossy under the water and drying as the tide falls (temple.wgsl templeWet). Lit by the moon behind (the pillars'
// shadows; a cool rim), the afterglow in front (a low warm light that rakes the carving), the dusk and the dancers.
#include "weft/frame"
#include "../light"

struct Stone {
  at: vec4f,     // the middle of its foot; w: its turn about up
  size: vec4f,   // block: width, height, depth; drum: radius at its foot, height, radius at its top; w: 0 block, 1 drum
  look: vec4f,   // x: seed, y: how ragged its top (m), z: carving (+ 8: no top face), w: 1 lying on its side
}

@group(1) @binding(0) var<storage, read> stones: array<Stone>;

override FIRST: u32 = 0u;
// a block's faces are N × N quads; a drum has SIDES round and RINGS up its side, CAPR across each end
override N: u32 = 4u;
override SIDES: u32 = 48u;
override RINGS: u32 = 10u;
override CAPR: u32 = 4u;
/** a fluted drum's flutes (the drum's SIDES are a multiple of them when they're in the mesh) */
const FLUTES: f32 = 20.0;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) local: vec3f,
  @location(3) @interpolate(flat) info: vec4f,   // seed, carving, part (block: its face 0 to 5; drum: 0 side, 1 an end), height
  @location(4) @interpolate(flat) shape: vec4f,  // x: 1 a drum; block: y half width, z half depth, w how ragged; drum: y radius, z how ragged, w lying
}

/** how far a broken top is pushed down at angle a, u of the way out from the middle (0 … 1) */
fn jag(seed: f32, a: f32, u: f32, broken: f32) -> f32 {
  if (broken <= 0.0) { return 0.0; }
  let ring = vnoise2(vec2f(a * 2.2 + seed * 40.0, seed * 7.0)) * 0.7 + vnoise2(vec2f(a * 6.5, seed * 13.0 + 3.0)) * 0.3;
  let chip = smoothstep(0.3, 1.0, u) * (0.25 + 0.75 * ring) + u * u * 0.35 * vnoise2(vec2f(a * 3.1 + 9.0, u * 3.0 + seed * 5.0));
  return broken * min(chip, 1.0);
}

fn place(s: Stone, q: vec3f) -> vec3f {
  let c = cos(s.at.w);
  let sn = sin(s.at.w);
  return s.at.xyz + vec3f(q.x * c + q.z * sn, q.y, -q.x * sn + q.z * c);
}
fn turn(s: Stone, v: vec3f) -> vec3f {
  let c = cos(s.at.w);
  let sn = sin(s.at.w);
  return vec3f(v.x * c + v.z * sn, v.y, -v.x * sn + v.z * c);
}

@vertex fn vs_block(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let s = stones[FIRST + ii];
  let per = N * N * 6u;
  let face = vi / per;
  let k = vi % per;
  let quad = k / 6u;
  let cr = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[k % 6u];
  let g = (vec2f(f32(quad % N), f32(quad / N)) + cr) / f32(N) * 2.0 - 1.0;
  let carve = u32(s.look.z);
  // an open block (the platform) has no top (the backdrop's floor is its top) and no foot either: the backdrop writes no
  // depth, so anything drawn under the floor would show through it
  if ((face == 2u || face == 3u) && carve >= 8u) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  // the faces: +x, -x, +y, -y, +z, -z, each wound to face out
  var p = vec3f(0.0);
  var n = vec3f(0.0);
  switch (face) {
    case 0u: { p = vec3f(1.0, g.y, -g.x); n = vec3f(1.0, 0.0, 0.0); }
    case 1u: { p = vec3f(-1.0, g.y, g.x); n = vec3f(-1.0, 0.0, 0.0); }
    case 2u: { p = vec3f(g.x, 1.0, -g.y); n = vec3f(0.0, 1.0, 0.0); }
    case 3u: { p = vec3f(g.x, -1.0, g.y); n = vec3f(0.0, -1.0, 0.0); }
    case 4u: { p = vec3f(g.x, g.y, 1.0); n = vec3f(0.0, 0.0, 1.0); }
    default: { p = vec3f(-g.x, g.y, -1.0); n = vec3f(0.0, 0.0, -1.0); }
  }
  let half = vec3f(s.size.x * 0.5, s.size.y * 0.5, s.size.z * 0.5);
  var q = vec3f(p.x * half.x, (p.y + 1.0) * half.y, p.z * half.z);
  // a broken top: pushed down by the same function of where it is on every face
  let u = max(abs(p.x), abs(p.z));
  let a = atan2(p.z, p.x) * 1.3 + p.x * 2.0;
  q.y -= jag(s.look.x, a, u, s.look.y) * smoothstep(0.0, 1.0, (q.y / max(s.size.y, 1e-3)));
  let wp = place(s, q);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.wp = wp;
  o.n = turn(s, n);
  o.local = q;
  o.info = vec4f(s.look.x, f32(carve % 8u), f32(face), s.size.y);
  o.shape = vec4f(select(0.0, 2.0, carve >= 8u), half.x, half.z, s.look.y);
  return o;
}

/** a drum's radius at u of the way up (0 … 1): a shaft tapers a little and swells (entasis), a capital's echinus flares
 *  out to its top in a curve, a base's torus rounds in from its foot */
fn drumR(R: f32, Rt: f32, u: f32, H: f32) -> f32 {
  if (Rt > R * 1.01) { return mix(R, Rt, pow(u, 1.7)); }
  if (Rt < R * 0.99) { return mix(R, Rt, 1.0 - pow(1.0 - u, 1.7)); }
  return R * (1.0 - 0.03 * u + 0.012 * sin(3.14159265 * u) * smoothstep(1.5, 3.0, H));
}
/** a flute's depth at angle a (× the radius): a scallop between two sharp arrises */
fn fluteDepth(a: f32) -> f32 {
  let g = fract(a * FLUTES / 6.2831853) * 2.0 - 1.0;
  return 0.032 * (1.0 - g * g);
}

@vertex fn vs_drum(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let s = stones[FIRST + ii];
  let quad = vi / 6u;
  let c = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let ringQ = quad / SIDES;
  let side = quad % SIDES + c.x;
  let ring = ringQ + c.y;
  let R0 = s.size.x;
  let H = s.size.y;
  let Rt = select(R0, s.size.z, s.size.z > 0.0);
  let a = f32(side) / f32(SIDES) * 6.2831853;
  let carve = u32(s.look.z) % 8u;
  // the profile: across the foot (rings 0 … CAPR), up the side, back across the top
  let top0 = CAPR + RINGS - 1u;
  var rf = 1.0;
  var y = 0.0;
  if (ring <= CAPR) { rf = f32(ring) / f32(CAPR); }
  else if (ring < top0) { y = H * f32(ring - CAPR) / f32(RINGS - 1u); }
  else { y = H; rf = 1.0 - f32(ring - top0) / f32(CAPR); }
  // which part this quad is (one normal for all its corners): the foot, the side or the top
  var part = 1u;
  if (ringQ < CAPR) { part = 0u; } else if (ringQ >= top0) { part = 2u; }
  let j = jag(s.look.x, a, rf, s.look.y);
  if (ring >= top0) { y = H - j; } else if (ring > CAPR) { y = y * (H - jag(s.look.x, a, 1.0, s.look.y)) / H; }
  let u = clamp(y / max(H, 1e-3), 0.0, 1.0);
  var R = drumR(R0, Rt, u, H);
  // the flutes in the mesh where there are sides enough (six a flute), on the side and round the rim of each end
  if (carve == 3u && SIDES >= 100u) { R *= 1.0 - fluteDepth(a) * smoothstep(0.7, 1.0, rf); }
  var q = vec3f(cos(a) * R * rf, y, sin(a) * R * rf);
  // the side's normal leans out where the profile narrows upward, in where it flares
  let dR = (drumR(R0, Rt, min(u + 0.02, 1.0), H) - drumR(R0, Rt, max(u - 0.02, 0.0), H)) / max(H * (min(u + 0.02, 1.0) - max(u - 0.02, 0.0)), 1e-4);
  var n = select(select(vec3f(0.0, -1.0, 0.0), vec3f(0.0, 1.0, 0.0), part == 2u), normalize(vec3f(cos(a), -dR, sin(a))), part == 1u);
  // lying on its side: its axis along z, resting on the floor
  if (s.look.w > 0.5) {
    q = vec3f(q.x, R0 + q.z, q.y - H * 0.5);
    n = vec3f(n.x, n.z, n.y);
  }
  let wp = place(s, q);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.wp = wp;
  o.n = turn(s, n);
  o.local = vec3f(a, y, rf);
  o.info = vec4f(s.look.x, f32(carve), select(1.0, 0.0, part == 1u), H);
  o.shape = vec4f(1.0, R0, s.look.y, s.look.w);
  return o;
}

// ---------------------------------------------------------------- relief
/** a rounded bump of radius r at distance d (0 … 1 high, smooth to its foot) */
fn bump(d: f32, r: f32) -> f32 {
  let x = clamp(d / r, 0.0, 1.0);
  return sqrt(max(1.0 - x * x, 0.0));
}
/** the egg-and-dart in a band (u along it in m, bv 0 … 1 up it, bh its height): eggs in their shells, darts between */
fn eggDart(u: f32, bv: f32, bh: f32) -> f32 {
  let lam = bh * 0.95;
  let x = fract(u / lam) - 0.5;
  let y = bv - 0.52;
  let e = (x / 0.3) * (x / 0.3) + (y / 0.36) * (y / 0.36);
  var h = sqrt(max(1.0 - e, 0.0)) * 0.9;
  // the shell round the egg, sunk behind a rolled lip
  let lip = sqrt(e);
  h = max(h, bump(abs(lip - 1.33), 0.13) * 0.45);
  h -= smoothstep(1.0, 1.12, lip) * smoothstep(1.48, 1.33, lip) * 0.35;
  // the dart between: a pointed ridge, its point down
  let dx = abs(abs(x) - 0.5);
  let dart = bump(dx, 0.045 + 0.05 * smoothstep(0.1, 0.9, bv)) * smoothstep(0.12, 0.5, bv) * 0.7;
  return max(h, dart);
}
/** a carved inscription (u, v in m within its panel): lines of letters cut in V-section, from strokes between a 3 × 3
 *  grid of points per letter, many worn shallow or gone */
fn inscription(u: f32, v: f32, seed: f32) -> f32 {
  let LH = 0.075;
  let LW = 0.058;
  let line = floor(v / (LH * 1.55));
  let lv = (v - line * LH * 1.55) / LH;
  if (lv > 1.0) { return 0.0; }
  let col = floor(u / LW);
  let f = vec2f(fract(u / LW) * 1.25 - 0.125, lv) * 2.0 - 1.0;
  let cid = vec2i(i32(col), i32(line) + i32(seed * 977.0));
  // a space between words now and then
  if (hash2i(cid + vec2i(5, 1)) < 0.14) { return 0.0; }
  var d = 9.0;
  for (var k = 0; k < 3; k++) {
    let hk = hash2i(cid * 7 + vec2i(k * 13, 5));
    let a = (vec2f(f32(u32(hk * 9.0) % 3u), f32(u32(hk * 27.0) % 3u)) - 1.0) * vec2f(0.6, 0.8);
    let b = (vec2f(f32(u32(hk * 81.0) % 3u), f32(u32(hk * 243.0) % 3u)) - 1.0) * vec2f(0.6, 0.8);
    if (any(a != b) && (k < 2 || hk > 0.5)) { d = min(d, templeSeg(f, a, b)); }
  }
  // worn: some letters all but gone, every edge softened
  let wear = smoothstep(0.25, 0.65, vnoise2(vec2f(u, v) * 9.0 + seed * 31.0));
  return -max(1.0 - d / 0.22, 0.0) * (0.25 + 0.75 * wear);
}
/** a panel's relief (u across it from its middle, v up from its foot, in m; hw its half width, H its height): a raised
 *  frame inside its edge; on a wide one a roundel in the middle with an eight-petalled rosette; lines of inscription in
 *  the rest */
fn panel(u: f32, v: f32, hw: f32, H: f32, seed: f32) -> f32 {
  let inset = 0.05;
  let fw = 0.045;
  let ex = hw - abs(u);
  let ey = min(v - 0.06, H - 0.08 - v);
  let edge = min(ex, ey);
  if (edge < inset) { return 0.0; }
  var h = bump(abs(edge - inset - fw * 0.5), fw * 0.5) * 0.7;
  let inner = edge - inset - fw;
  if (inner < 0.0) { return h; }
  let Rr = min(min(0.34, (H - 0.14) * 0.42), hw * 0.32);
  let wide = hw > 0.8;
  let cv = (H - 0.02) * 0.5;
  let r = length(vec2f(u, v - cv));
  if (wide && r < Rr * 1.25) {
    // the roundel: a rolled rim, a sunk field, the rosette raised in it, a boss in the middle
    let th = atan2(v - cv, u);
    var g = bump(abs(r - Rr), Rr * 0.09) * 0.8;
    let petal = Rr * 0.78 * (0.42 + 0.58 * pow(abs(cos(th * 4.0)), 0.7));
    g = max(g, smoothstep(petal, petal - Rr * 0.12, r) * (0.55 + 0.25 * (1.0 - r / petal)) * step(r, Rr * 0.92));
    g = max(g, bump(r, Rr * 0.16) * 0.9);
    g -= smoothstep(Rr * 0.92, Rr * 0.88, r) * 0.12;
    return max(h, g) * (0.8 + 0.2 * vnoise2(vec2f(u, v) * 23.0));
  }
  if (inner > 0.03) { h = min(h, inscription(u + hw, v, seed)); }
  return h;
}
/** the relief at a point of a block's face (0 flat; up out of the face +, cut in -) */
fn carving(kind: f32, u: f32, v: f32, hw: f32, height: f32, seed: f32) -> f32 {
  if (kind > 0.5 && kind < 1.5) {
    // under the top: a band of egg-and-dart, a plain fillet over it
    let bh = min(0.2, height * 0.6);
    let v0 = height - bh * 1.35;
    let bv = (v - v0) / bh;
    if (bv < 0.0) { return 0.0; }
    if (bv > 1.0) { return 0.35 * smoothstep(1.0, 1.08, bv); }
    return eggDart(u, bv, bh) * (0.75 + 0.25 * vnoise2(vec2f(u, v) * 17.0 + seed * 9.0));
  }
  if (kind > 1.5 && kind < 2.5) { return panel(u, v, hw, height, seed); }
  return 0.0;
}

// ---------------------------------------------------------------- the light on stone
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  if (sightDrop(i.wp, i.pos.xy)) { discard; }   // the near fade (worlds/fade.ts)
  let seed = i.info.x;
  let kind = i.info.y;
  // (the normals are made outward; the stones are drawn from both sides)
  var N = normalize(i.n);
  let geomN = normalize(cross(dpdx(i.wp), dpdy(i.wp)));
  // how big a pixel is on the stone (m): the carving's relief is taken over at least two of them and fades where its
  // detail is finer than that (at a distance an egg-and-dart's lips would shimmer and ghost into a doubled outline)
  let foot = length(fwidth(i.wp));
  var groove = 0.0;
  var relief = 0.0;
  var chip = 0.0;
  // where the water runs down from (the top of the stone, or the joint above), and across the face (m)
  var below = 0.0;
  var across = 0.0;
  // (the platform's inner walls, seen through the floor from inside the court, aren't there)
  if (i.shape.x > 1.5 && dot(N, frame.camPos - i.wp) < 0.0) { discard; }
  if (i.shape.x < 0.5 || i.shape.x > 1.5) {
    // a block: its face's own coordinates (u across, v up the face), the relief into the light, edges worn and chipped
    let face = u32(i.info.z);
    let hx = i.shape.y;
    let hz = i.shape.z;
    let L = i.local;
    let side = face < 2u;
    let u = select(L.x, L.z, side) * select(1.0, -1.0, face == 1u || face == 5u);
    let hw = select(hx, hz, side);
    across = u + seed * 13.0;
    below = i.info.w - L.y;
    if (face != 2u && face != 3u && kind > 0.5) {
      let e = max(0.004, foot * 2.0);
      let h0 = carving(kind, u, L.y, hw, i.info.w, seed);
      let hu = carving(kind, u + e, L.y, hw, i.info.w, seed);
      let hv = carving(kind, u, L.y + e, hw, i.info.w, seed);
      relief = h0;
      groove = max(-h0, 0.0);
      let depth = 0.016 * smoothstep(0.035, 0.012, foot);
      let T = normalize(cross(vec3f(0.0, 1.0, 0.0), N) + vec3f(1e-5));
      N = normalize(N - (T * (hu - h0) + vec3f(0.0, 1.0, 0.0) * (hv - h0)) / e * depth);
      // (stains run from the carved band too)
      if (kind < 1.5) { below = min(below, max(i.info.w - min(0.2, i.info.w * 0.6) * 1.35 - L.y, 0.0) + 0.3); }
    }
    // the arrises: worn round over a few centimetres, and here and there a chip knocked out of them (fresh stone, its
    // broken face tipped off the edge)
    // (how far to the nearest edge of this face: across it and up it)
    let ey = min(L.y, i.info.w - L.y) * 2.0;
    var toEdge = min(hx - abs(L.x), hz - abs(L.z));
    if (face < 2u) { toEdge = min(hz - abs(L.z), ey); } else if (face > 3u) { toEdge = min(hx - abs(L.x), ey); }
    let c = smoothstep(0.64, 0.7, vnoise(i.wp * 7.0 + seed * 11.0)) * smoothstep(0.075, 0.02, toEdge);
    chip = c;
    groove = max(groove, smoothstep(0.66, 0.6, vnoise(i.wp * 7.0 + seed * 11.0)) * c * 0.6);
    N = normalize(mix(N, geomN, 0.5 * c) + (vnoise(i.wp * 31.0) - 0.5) * c * 0.5);
    groove -= smoothstep(0.05, 0.0, toEdge) * 0.15;
    N = normalize(mix(N, geomN, smoothstep(0.0, 0.1, L.y - (i.info.w - 0.5)) * step(0.001, i.shape.w)));
  } else if (i.info.z < 0.5) {
    // a drum's side: the flutes' scallops (their slope bends the light round the drum; where they're in the mesh the
    // silhouette is fluted too), the joints between the drums a tall shaft is built of, chipped arrises
    let a = i.local.x;
    let R = i.shape.y;
    across = a * R + seed * 13.0;
    let H = i.info.w;
    // a tall shaft is a stack of drums about a metre each; the water runs down from each joint
    let dh = 0.9 + 0.25 * fract(seed * 7.7);
    let yj = i.local.y;
    let jf = fract(yj / dh);
    let joint = smoothstep(0.012, 0.003, min(jf, 1.0 - jf) * dh) * step(1.6, H) * step(0.3, yj) * step(yj, H - 0.2);
    below = min(H - yj, jf * dh + 0.15 * step(1.6, H));
    groove = max(groove, joint * 0.7);
    if (kind > 2.5) {
      let F = FLUTES;
      let g = fract(a * F / 6.2831853) * 2.0 - 1.0;
      // the scallop's slope round the drum (d depth / d angle, over the radius)
      let slope = 0.032 * 2.0 * g * F / 6.2831853 * 2.0;
      groove = max(groove, (1.0 - g * g) * 0.25);
      let T = normalize(cross(vec3f(0.0, 1.0, 0.0), N) + vec3f(1e-5));
      N = normalize(N + T * slope * 1.2);
      // the arrises take the knocks
      chip = smoothstep(0.6, 0.68, vnoise(i.wp * 9.0 + seed * 5.0)) * smoothstep(0.25, 0.0, 1.0 - abs(g)) * 0.8;
    }
  } else {
    // the ends: flat where whole, faceted where broken
    N = normalize(mix(N, geomN, smoothstep(0.0, 0.15, i.shape.z) * smoothstep(0.35, 0.8, i.local.z)));
    below = 0.0;
    across = i.wp.x + i.wp.z;
  }
  let wp = i.wp;
  // the stone: a pale limestone, quiet in the large, grainy in the small, faint beds running through the blocks
  let n1 = fbm(wp * 0.9 + seed * 17.0);
  let grain = vnoise(wp * 41.0 + seed * 3.0);
  let beds = 0.5 + 0.5 * sin(wp.y * 23.0 + vnoise(wp * 1.7) * 4.0 + seed * 9.0);
  var albedo = worldLight.temple.stone.rgb * (0.86 + 0.2 * n1) * (0.93 + 0.12 * grain) * (0.96 + 0.05 * beds);
  let pits = smoothstep(0.78, 0.86, vnoise(wp * 47.0 + seed));
  albedo *= 1.0 - 0.14 * pits - 0.35 * groove;
  // fresh stone where it chipped: paler, warmer, not yet weathered
  albedo = mix(albedo, worldLight.temple.stone.rgb * vec3f(1.1, 1.07, 1.0), chip * 0.5);
  // the rain's streaks: dark, grey-green, running down from every top and joint, long and narrow, fading as they go
  let streakN = vnoise2(vec2f(across * 9.0, wp.y * 0.6 + seed * 5.0)) * 0.7 + vnoise2(vec2f(across * 23.0, wp.y * 1.3)) * 0.3;
  let run = smoothstep(0.5, 0.8, streakN) * exp(-below / 1.1) * (1.0 - abs(N.y));
  albedo = mix(albedo, albedo * vec3f(0.42, 0.44, 0.4), run * (1.0 - chip) * 0.85);
  // the side that faces the sea and the moon takes the weather: a mottled crust, grey-brown in blotches, rust-ochre
  // stains here and there, more of the rain's streaks; so seen against the afterglow, lit by the moon behind the eye,
  // the stone is as weathered as its fronts are, not a pale block
  let seaSide = smoothstep(0.35, -0.6, N.z) * worldLight.temple.tide2.w;
  if (seaSide > 0.001) {
    // (the large mottle is the stone's own, n1, sharpened; one more noise for the rust: the fronts pay nothing)
    let blot = smoothstep(0.42, 0.62, n1) * (0.75 + 0.25 * grain);
    albedo = mix(albedo, albedo * vec3f(0.6, 0.58, 0.54), blot * seaSide * 0.8);
    let rust = smoothstep(0.62, 0.8, vnoise(wp * 1.3 + seed * 3.0 + 11.0)) * (0.6 + 0.4 * grain);
    albedo = mix(albedo, albedo * vec3f(1.12, 0.92, 0.7), rust * seaSide * 0.6);
    albedo = mix(albedo, albedo * vec3f(0.5, 0.52, 0.48), smoothstep(0.42, 0.72, streakN) * exp(-below / 2.2) * (1.0 - abs(N.y)) * seaSide * 0.6);
    albedo *= 1.0 - 0.18 * seaSide * (grain - 0.5);
  }
  // grime in the hollows of the carving, and the relief's crowns rubbed paler
  albedo *= 1.0 + 0.12 * max(relief, 0.0) - 0.25 * max(-relief, 0.0);
  // the tide: lichen only where the sea never reaches; a white line of salt at the high water's mark; weed and the
  // sea's dark stain below the low water; wet and dark where the water is or lately was
  let hi = worldLight.temple.tide.y;
  let wob = 0.04 * (vnoise(wp * 3.0) - 0.5);
  let dry = smoothstep(hi + 0.25, hi + 0.6, wp.y);
  let crust = vnoise(wp * 4.3 + seed * 9.0) * 0.6 + vnoise(wp * 13.0) * 0.4;
  let lichen = smoothstep(0.6, 0.72, crust) * dry * max(N.y * 0.6 + 0.6, 0.0) * smoothstep(-0.3, 0.6, -N.z + 0.3);
  albedo = mix(albedo, mix(vec3f(0.5, 0.36, 0.13), vec3f(0.36, 0.38, 0.3), smoothstep(0.66, 0.7, crust)), lichen * 0.7);
  let salt = smoothstep(0.035, 0.0, abs(wp.y - hi - 0.03 + wob)) * (0.55 + 0.45 * vnoise(wp * 19.0)) + smoothstep(0.012, 0.0, abs(wp.y - hi * 0.55 + wob)) * 0.35;
  albedo = mix(albedo, vec3f(0.78, 0.78, 0.74), salt * 0.5 * (1.0 - abs(N.y) * 0.7));
  let stain = smoothstep(hi + 0.02, hi - 0.1, wp.y + wob);
  albedo = mix(albedo, albedo * vec3f(0.7, 0.72, 0.62), stain * 0.6);
  let weed = smoothstep(hi * 0.35, -0.02, wp.y + wob) * smoothstep(0.35, 0.65, vnoise(wp * 4.0 + seed * 5.0));
  albedo = mix(albedo, vec3f(0.03, 0.045, 0.025), weed * 0.7);
  let wet = templeWet(wp.y + wob * 0.5);
  albedo *= 1.0 - 0.45 * wet;
  // the light
  let V = normalize(frame.camPos - wp);
  let Ld = worldLight.temple.moon.xyz;
  let moon = worldLight.temple.moonCol.rgb * worldLight.temple.moonCol.w * templeShadow(wp + N * 0.03);
  let ao = (1.0 - 0.55 * max(groove, 0.0)) * mix(0.55, 1.0, smoothstep(0.0, 0.7, wp.y + 0.3));
  let diff = max(dot(N, Ld), 0.0);
  // the afterglow behind the audience, low: a warm light raking the fronts (it is what shows the carving)
  let La = normalize(worldLight.temple.duskDir.xyz + vec3f(0.0, 0.32, 0.0));
  let dusk = mix(vec3f(luma(worldLight.temple.dusk.rgb)), worldLight.temple.dusk.rgb, 0.55);
  let after = dusk * worldLight.temple.dusk.w * worldLight.temple.tide2.x * templeAfterShade(wp);
  // and the moonlit sky over the court: a cool fill from above and in front, so the fronts are blue-grey stone in the
  // night, the warmth only where the afterglow or a dancer's fire touches them
  let skyFill = worldLight.temple.moonCol.rgb * worldLight.temple.moonCol.w * worldLight.temple.tide2.y * (0.45 + 0.35 * N.y + 0.2 * N.z);
  // (the moon's direct light on stone is held down so a face turned square to it reads as stone, not white)
  var col = albedo * (moon * diff * worldLight.temple.tide2.z + after * max(dot(N, La), 0.0) * ao + skyFill * ao + templeAmbient(N, ao, wp, 1.0) * ao);
  // the moon behind it lights its edges (the light grazing round the sides toward us)
  // (round the sides only: a top seen at a glance isn't lit from behind)
  let edgeOn = pow(1.0 - max(dot(N, V), 0.0), 3.0) * max(dot(-V, Ld), 0.0) * (1.0 - abs(N.y));
  col += moon * albedo * edgeOn * 0.8;
  // wet stone shines: the moon's highlight and the sky in it
  let R = reflect(-V, N);
  let gloss = mix(0.05, 1.0, wet) * worldLight.temple.stone.w;
  col += moon * pow(max(dot(R, Ld), 0.0), mix(12.0, 80.0, wet)) * gloss * 0.6;
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  // (dry stone is rough: it only mirrors the sky when it's wet)
  col += templeSky(normalize(vec3f(R.x, abs(R.y), R.z)), 0.0) * fres * gloss * mix(0.06, 0.5, wet);
  col = templeUnder(col, wp, albedo * moon * diff);
  return vec4f(col, dot(wp - frame.camPos, frame.camFwd));
}
