// The Tide Temple's stones (layout.ts places them): blocks (the altar, the lintels, the gate, walls, steps, the platform
// the court stands on) and drums (pillars standing, snapped or lying where they fell). Each instance is made from the
// vertex index: a block's six faces in a grid, a drum's rings from the middle of its foot round its side to the middle
// of its top, a ragged top pushed down by noise for a broken one (the same function of position on every face, so it
// stays closed). The carving is cut into the light, not the mesh: flutes, a meander band, panels of glyphs, each a
// groove whose slope bends the normal and whose depth darkens it. Wet below the high tide's line, netted by the moon's
// caustics and dimmed by the water under the tide now (temple.wgsl templeUnder). Lit by the moon (the pillars' shadows),
// the dusk and the dancers' own light.
#include "weft/frame"
#include "../light"

struct Stone {
  at: vec4f,     // the middle of its foot; w: its turn about up
  size: vec4f,   // block: width, height, depth; drum: radius, height, -; w: 0 block, 1 drum
  look: vec4f,   // x: seed, y: how ragged its top (m), z: carving (+ 8: no top face), w: 1 lying on its side
}

@group(1) @binding(0) var<storage, read> stones: array<Stone>;

override FIRST: u32 = 0u;
// a block's faces are N × N quads; a drum has SIDES round and RINGS up its side, CAPR across each end
override N: u32 = 4u;
override SIDES: u32 = 48u;
override RINGS: u32 = 10u;
override CAPR: u32 = 4u;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) local: vec3f,
  @location(3) @interpolate(flat) info: vec4f,   // seed, carving, part (block: its face 0 to 5; drum: 0 side, 1 an end), height
  @location(4) @interpolate(flat) shape: vec4f,  // x: 1 a drum; block: y half width, z half depth, w how ragged; drum: y radius, z how ragged
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

@vertex fn vs_drum(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let s = stones[FIRST + ii];
  let quad = vi / 6u;
  let c = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let ringQ = quad / SIDES;
  let side = quad % SIDES + c.x;
  let ring = ringQ + c.y;
  let R = s.size.x;
  let H = s.size.y;
  let a = f32(side) / f32(SIDES) * 6.2831853;
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
  var q = vec3f(cos(a) * R * rf, y, sin(a) * R * rf);
  var n = select(select(vec3f(0.0, -1.0, 0.0), vec3f(0.0, 1.0, 0.0), part == 2u), vec3f(cos(a), 0.0, sin(a)), part == 1u);
  // lying on its side: its axis along z, resting on the floor
  if (s.look.w > 0.5) {
    q = vec3f(q.x, R + q.z, q.y - H * 0.5);
    n = vec3f(n.x, n.z, n.y);
  }
  let wp = place(s, q);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.wp = wp;
  o.n = turn(s, n);
  o.local = vec3f(a, y, rf);
  o.info = vec4f(s.look.x, f32(u32(s.look.z) % 8u), select(1.0, 0.0, part == 1u), H);
  o.shape = vec4f(1.0, R, s.look.y, 0.0);
  return o;
}

// ---------------------------------------------------------------- carving
/** panels of glyphs on a face (u, v in m): each a square sunk behind a raised rim, with three strokes cut in it */
fn glyphs(u: f32, v: f32, seed: f32) -> f32 {
  let P = 0.34;
  let c = floor(vec2f(u, v) / P);
  let f = fract(vec2f(u, v) / P) * 2.0 - 1.0;
  let rim = max(abs(f.x), abs(f.y));
  var h = -0.5 * smoothstep(0.8, 0.86, rim) * smoothstep(0.96, 0.9, rim);
  let base = hash2i(vec2i(c) + vec2i(i32(seed * 977.0), 31));
  var d = 9.0;
  for (var k = 0; k < 3; k++) {
    let hk = hash2i(vec2i(c) * 7 + vec2i(k * 13 + i32(base * 61.0), 5));
    let a = (vec2f(f32(u32(hk * 9.0) % 3u), f32(u32(hk * 27.0) % 3u)) - 1.0) * 0.5;
    let b = (vec2f(f32(u32(hk * 81.0) % 3u), f32(u32(hk * 243.0) % 3u)) - 1.0) * 0.5;
    if (any(a != b)) { d = min(d, templeSeg(f, a, b)); }
    else { d = min(d, abs(length(f - a) - 0.2)); }
  }
  h -= smoothstep(0.11, 0.05, d) * step(rim, 0.78);
  return h;
}
/** how deep the carving is at a point on a face (0 … -1) */
fn carving(kind: f32, u: f32, v: f32, height: f32, seed: f32) -> f32 {
  if (kind > 0.5 && kind < 1.5) {
    // the band runs round the top of the stone (on a thin slab, its whole face)
    let bh = min(0.24, height * 0.7);
    let v0 = height - bh * 1.2;
    let bv = (v - v0) / bh;
    if (bv < 0.0 || bv > 1.0) { return 0.0; }
    return -smoothstep(0.06, 0.03, templeMeander(u / bh, bv));
  }
  if (kind > 1.5 && kind < 2.5) { return glyphs(u, v, seed) * step(0.12, v) * step(v, height - 0.08); }
  return 0.0;
}

// ---------------------------------------------------------------- the light on stone
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let seed = i.info.x;
  let kind = i.info.y;
  // (the normals are made outward; the stones are drawn from both sides)
  var N = normalize(i.n);
  let geomN = normalize(cross(dpdx(i.wp), dpdy(i.wp)));
  var groove = 0.0;
  // (the platform's inner walls, seen through the floor from inside the court, aren't there)
  if (i.shape.x > 1.5 && dot(N, frame.camPos - i.wp) < 0.0) { discard; }
  if (i.shape.x < 0.5 || i.shape.x > 1.5) {
    // a block: its face's own coordinates (u across, v up the face), carving into the light, edges worn round
    let face = u32(i.info.z);
    let hx = i.shape.y;
    let hz = i.shape.z;
    let L = i.local;
    if (face != 2u && face != 3u && kind > 0.5) {
      let u = select(L.x, L.z, face < 2u) * select(1.0, -1.0, face == 1u || face == 5u);
      let e = 0.004;
      let h0 = carving(kind, u, L.y, i.info.w, seed);
      let hu = carving(kind, u + e, L.y, i.info.w, seed);
      let hv = carving(kind, u, L.y + e, i.info.w, seed);
      groove = -h0;
      let depth = 0.012;
      let T = normalize(cross(vec3f(0.0, 1.0, 0.0), N) + vec3f(1e-5));
      N = normalize(N - (T * (hu - h0) + vec3f(0.0, 1.0, 0.0) * (hv - h0)) / e * depth);
    }
    // the edges: worn round over a few centimetres
    let toEdge = min(min(hx - abs(L.x), hz - abs(L.z)), min(L.y, i.info.w - L.y) * 4.0);
    // (lighter where the edges are worn, and the broken top faceted)
    groove -= smoothstep(0.05, 0.0, toEdge) * 0.15;
    N = normalize(mix(N, geomN, smoothstep(0.0, 0.1, L.y - (i.info.w - 0.5)) * step(0.001, i.shape.w)));
  } else if (i.info.z < 0.5) {
    // a drum's side: the flutes, cut into the light round it
    if (kind > 2.5) {
      let a = i.local.x;
      let F = 20.0;
      let g = 0.5 + 0.5 * cos(a * F);
      let slope = -sin(a * F) * F * 0.5;
      groove = smoothstep(0.85, 0.0, g) * 0.22;
      let T = normalize(cross(vec3f(0.0, 1.0, 0.0), N) + vec3f(1e-5));
      N = normalize(N + T * slope * 0.025 * (1.0 - g));
    }
  } else {
    // the ends: flat where whole, faceted where broken
    N = normalize(mix(N, geomN, smoothstep(0.0, 0.15, i.shape.z) * smoothstep(0.35, 0.8, i.local.z)));
  }
  let wp = i.wp;
  // the stone: a warm limestone, mottled and pitted, greyer with lichen up high, green-black with weed below the
  // high tide's line, darker where it's wet
  let n1 = fbm(wp * 1.3 + seed * 17.0);
  let n2 = vnoise(wp * 7.0 + seed * 3.0);
  var albedo = light.temple.stone.rgb * (0.72 + 0.45 * n1) * (0.88 + 0.24 * n2);
  albedo = mix(albedo, albedo * vec3f(0.78, 0.8, 0.86), smoothstep(0.55, 0.8, vnoise(wp * 0.6 + 4.0)));
  let pits = smoothstep(0.72, 0.8, vnoise(wp * 23.0 + seed));
  albedo *= 1.0 - 0.35 * pits - 0.45 * groove;
  let lichen = smoothstep(0.62, 0.78, vnoise(wp * 2.1 + seed * 9.0)) * smoothstep(0.9, 1.6, wp.y) * max(N.y * 0.5 + 0.5, 0.3);
  albedo = mix(albedo, vec3f(0.34, 0.3, 0.2), lichen * 0.5);
  let line = light.temple.fire.w + 0.05 * (vnoise(wp * 3.0) - 0.5);
  let wet = smoothstep(line + 0.08, line - 0.02, wp.y);
  let weed = wet * smoothstep(0.35, 0.65, vnoise(wp * 4.0 + seed * 5.0) * 0.6 + (line - wp.y) * 1.5);
  albedo = mix(albedo, vec3f(0.035, 0.05, 0.03), weed * 0.6);
  albedo *= 1.0 - 0.45 * wet;
  // the light
  let V = normalize(frame.camPos - wp);
  let Ld = light.temple.moon.xyz;
  let moon = light.temple.moonCol.rgb * light.temple.moonCol.w * templeShadow(wp + N * 0.03);
  let ao = (1.0 - 0.55 * groove) * mix(0.55, 1.0, smoothstep(0.0, 0.7, wp.y + 0.3));
  let diff = max(dot(N, Ld), 0.0);
  var col = albedo * (moon * diff + templeAmbient(N, ao, wp, 1.0) * ao);
  // the moon behind it lights its edges (the light grazing round the sides toward us)
  // (round the sides only: a top seen at a glance isn't lit from behind)
  let edgeOn = pow(1.0 - max(dot(N, V), 0.0), 3.0) * max(dot(-V, Ld), 0.0) * (1.0 - abs(N.y));
  col += moon * albedo * edgeOn * 0.8;
  // wet stone shines: the moon's highlight and the sky in it
  let R = reflect(-V, N);
  let gloss = mix(0.06, 1.0, wet) * light.temple.stone.w;
  col += moon * pow(max(dot(R, Ld), 0.0), mix(12.0, 80.0, wet)) * gloss * 0.6;
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  // (dry stone is rough: it only mirrors the sky when it's wet)
  col += templeSky(normalize(vec3f(R.x, abs(R.y), R.z)), 0.0) * fres * gloss * mix(0.08, 0.5, wet);
  col = templeUnder(col, wp, albedo * moon * diff);
  return vec4f(col, dot(wp - frame.camPos, frame.camFwd));
}
