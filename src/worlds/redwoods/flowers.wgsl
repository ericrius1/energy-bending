// The wildflowers. Redwood sorrel and white trillium in the trees' shade; California poppies, buttercups, forget-me-nots,
// starflowers and Douglas irises in drifts across the clearing (vs: one flower an instance, a stem, two leaves, up to
// six petals and its eye), and spires of lupine and foxglove (vs_spire: a tall stem hung with florets, lupines in the
// clearing, foxgloves along the trees). Made from the instance index alone: the flowers on a jittered grid, which kind
// grows where from slow noise, so they come in drifts with grass between. Lit per vertex like the grass; their petals
// light up when the sun is behind them and glow warm under the lanterns.
#include "weft/frame"
#include "../light"

override GRID: u32 = 150u;    // flowers along a side of the grid
override SPIRES: u32 = 44u;   // spires along a side of theirs
override REACH: f32 = 14.0;   // either grid covers ±REACH metres


struct FOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec3f,     // lit by the shade and the lanterns
  @location(1) key: vec3f,     // the key light on it (before the angle)
  @location(2) wp: vec3f,
  @location(3) n: vec3f,
  @location(4) uv: vec2f,      // along the petal, leaf or floret; across it
  @location(5) @interpolate(flat) part: u32,   // 0 stem, 1 leaf, 2 petal, 3 eye, 4 floret
  @location(6) @interpolate(flat) kind: u32,
}

/** a kind of flower: petals (how many, long, wide, how far they rise from flat and how far their tips fall back), the
 *  stem's height, colours (petal base, petal tip, eye), the eye's radius, its leaves (long, wide, how far up the stem)
 *  and the petals' outline (0 pointed, 1 round, 2 broad at the tip) */
struct Spec { n: f32, len: f32, wid: f32, cup: f32, curl: f32, tall: f32, a: vec3f, b: vec3f, eye: vec3f, eyeR: f32, leafLen: f32, leafWid: f32, leafAt: f32, shape: f32 }

fn spec(k: u32) -> Spec {
  switch (k) {
    // redwood sorrel: small, pink-veined, among its clover leaves
    case 0u: { return Spec(5.0, 0.015, 0.011, 0.55, 0.3, 0.08, vec3f(0.5, 0.2, 0.36), vec3f(0.86, 0.72, 0.8), vec3f(0.95, 0.8, 0.3), 0.0025, 0.045, 0.04, 0.8, 2.0); }
    // white trillium: three broad petals over a whorl of big leaves
    case 1u: { return Spec(3.0, 0.05, 0.034, 0.32, 0.3, 0.26, vec3f(0.78, 0.8, 0.7), vec3f(0.92, 0.92, 0.88), vec3f(0.95, 0.82, 0.35), 0.006, 0.11, 0.075, 0.8, 0.0); }
    // forget-me-not: tiny, sky blue round a white ring and a yellow eye
    case 2u: { return Spec(5.0, 0.009, 0.009, 0.15, 0.1, 0.2, vec3f(0.85, 0.88, 0.95), vec3f(0.12, 0.26, 0.9), vec3f(1.0, 0.78, 0.15), 0.002, 0.045, 0.013, 0.35, 1.0); }
    // Douglas iris: three standards up, three falls down, violet over a pale veined throat
    case 3u: { return Spec(6.0, 0.05, 0.022, 1.15, 0.3, 0.3, vec3f(0.85, 0.8, 0.6), vec3f(0.22, 0.11, 0.62), vec3f(0.95, 0.82, 0.3), 0.003, 0.36, 0.012, 0.0, 0.0); }
    // California poppy: four orange petals in a cup
    case 4u: { return Spec(4.0, 0.034, 0.036, 0.95, -0.15, 0.24, vec3f(0.95, 0.2, 0.01), vec3f(1.0, 0.48, 0.04), vec3f(1.0, 0.45, 0.06), 0.004, 0.07, 0.016, 0.12, 1.0); }
    // buttercup: glossy yellow
    case 5u: { return Spec(5.0, 0.014, 0.013, 0.7, 0.0, 0.16, vec3f(0.95, 0.6, 0.02), vec3f(1.0, 0.75, 0.06), vec3f(0.55, 0.42, 0.06), 0.003, 0.035, 0.022, 0.15, 1.0); }
    // starflower: six white points
    default: { return Spec(6.0, 0.016, 0.007, 0.25, 0.15, 0.14, vec3f(0.95, 0.82, 0.88), vec3f(0.95, 0.93, 0.93), vec3f(1.0, 0.8, 0.25), 0.003, 0.05, 0.02, 0.5, 0.0); }
  }
}

const QUAD = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u));

/** where a plant on a grid of `grid` stands: its root, a random number, whether it could grow there (inside the grid's
 *  circle, and on screen: one that isn't does no more) */
fn rootOf(ii: u32, grid: u32, seed: u32, high: f32) -> vec4f {
  let h = rnd3(ii * 11u + seed);
  let cell = 2.0 * REACH / f32(grid);
  let root = (vec2f(f32(ii % grid), f32(ii / grid)) + h.xy) * cell - REACH;
  let ok = length(root) < REACH && onScreen(vec3f(root.x, high * 0.5, root.y), high);
  return vec4f(root, h.z, select(0.0, 1.0, ok));
}

/** a point up a stem: f of the way up, leaning `bend` (m) at the top */
fn stemAt(root: vec2f, tall: f32, bend: vec2f, f: f32) -> vec3f {
  return vec3f(root.x + bend.x * f * f, tall * f * (1.0 - 0.15 * dot(bend, bend) / max(tall * tall, 1e-4)), root.y + bend.y * f * f);
}

/** a ribbon along the stem facing the camera: the vertex for row `row` of `rows`, side c.x */
fn stemVertex(root: vec2f, tall: f32, bend: vec2f, row: u32, rows: u32, cx: u32, width: f32) -> vec3f {
  let f = f32(row) / f32(rows);
  let p = stemAt(root, tall, bend, f);
  let along = normalize(stemAt(root, tall, bend, min(f + 0.05, 1.0)) - stemAt(root, tall, bend, max(f - 0.05, 0.0)));
  let across = normalize(cross(along, frame.camPos - p) + vec3f(1e-5, 0.0, 0.0));
  return p + across * width * (select(-0.5, 0.5, cx == 1u)) * (1.0 - 0.4 * f);
}

/** light it (per vertex): what the shade and the lanterns give it, and what the key light would */
fn light(o: ptr<function, FOut>, albedo: vec3f, wp: vec3f, n: vec3f, ao: f32) {
  (*o).col = albedo * (woodsAmbient(n) * ao + lampLight(wp, n, 0.5));
  (*o).key = albedo * worldLight.forest.keyCol.rgb * worldLight.forest.key.w * keyLight(wp) * ao;
  (*o).wp = wp;
  (*o).n = n;
  (*o).pos = frame.viewProj * vec4f(wp, 1.0);
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FOut {
  var o: FOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let R = rootOf(ii, GRID, 7u, 0.45);
  let root = R.xy;
  let r = length(root);
  let ring = worldLight.forest.clock.w;
  if (R.w < 0.5) { return o; }
  // drifts of flowers with grass between, thinning out into the trees
  let drift = vnoise2(root * 0.55 + 2.0);
  if (R.z > smoothstep(0.36, 0.7, drift) * smoothstep(ring + 3.5, ring + 0.5, r) || !clearOfTrunks(root, 0.12)) { return o; }
  // (fewer, further from the eye)
  if (fract(R.z * 5.37) * (1.0 + smoothstep(8.0, 14.0, length(root - frame.camPos.xz))) > 1.0) { return o; }
  // which kind: the shade lovers under the trees, the rest in drifts of one kind or another
  let h2 = rnd3(ii * 5u + 2u);
  let shady = smoothstep(ring - 3.5, ring - 0.5, r);
  var kind = 2u;
  if (h2.x < shady * 0.9) {
    kind = select(0u, 1u, h2.y > 0.72);
  } else {
    let pick = fract(vnoise2(root * 0.2 + 9.0) * 3.0 + vnoise2(root * 0.07 + 4.0) * 2.0);
    let k = clamp(i32(floor(pick * 5.0 + (h2.y - 0.5) * 1.1)), 0, 4);
    kind = array<u32, 5>(4u, 2u, 5u, 6u, 3u)[k];
  }
  o.kind = kind;
  let S = spec(kind);
  let grow = worldLight.forest.clock.y;
  let h3 = rnd3(ii * 17u + 9u);
  let tall = S.tall * (0.7 + 0.6 * h3.x) * mix(1.0, grow, 0.5);
  let yaw = h3.y * 6.2831853;
  let t = worldLight.forest.clock.x;
  let bend = (windAt(root, t + h3.z) * 1.3 + (h3.xy - 0.5) * 0.35) * tall;
  let head = stemAt(root, tall, bend, 1.0);
  // the head faces up, tipped with the stem and a little its own way
  let ax = normalize(vec3f(bend.x / tall * 1.4 + (h3.z - 0.5) * 0.5, 1.0, bend.y / tall * 1.4 + (h2.z - 0.5) * 0.5));
  let e1 = normalize(cross(ax, vec3f(0.0, 0.0, 1.0)));
  let e2 = cross(ax, e1);

  if (vi < 24u) {
    // the stem: four segments
    let c = QUAD[vi % 6u];
    let row = vi / 6u + c.y;
    let p = stemVertex(root, tall, bend, row, 4u, c.x, 0.0028);
    o.part = 0u;
    o.uv = vec2f(f32(row) / 4.0, 0.0);
    light(&o, vec3f(0.03, 0.07, 0.015), p, normalize(vec3f(p.x - root.x, 0.3, p.z - root.y) + vec3f(0.0, 0.01, 0.0)), mix(0.4, 1.0, f32(row) / 4.0));
    return o;
  }
  if (vi < 48u) {
    // two leaves, each a diamond of two segments, out from the stem
    let l = vi - 24u;
    let li = l / 12u;
    let c = QUAD[l % 6u];
    let row = (l % 12u) / 6u + c.y;
    let u = f32(row) / 2.0;
    let phi = yaw + f32(li) * 3.14159 + 0.6;
    let outward = vec3f(cos(phi), 0.0, sin(phi));
    let sideDir = vec3f(-sin(phi), 0.0, cos(phi));
    let base = stemAt(root, tall, bend, S.leafAt);
    let iris = select(0.0, 1.0, kind == 3u);
    let len = S.leafLen * mix(0.7, 1.15, h2.z) * grow;
    let up = mix(0.35 * u - 0.5 * u * u, 0.95 * u - 0.25 * u * u, iris);
    let p0 = base + outward * len * u * mix(1.0, 0.28, iris) + vec3f(0.0, len * up, 0.0) + vec3f(bend.x, 0.0, bend.y) * u * iris * 0.6;
    let w = S.leafWid * select(0.0, 0.5, row == 1u) * grow;
    let p = p0 + sideDir * w * select(-1.0, 1.0, c.x == 1u);
    let along = normalize(outward * mix(1.0, 0.28, iris) + vec3f(0.0, mix(0.35 - u, 0.95 - 0.5 * u, iris), 0.0));
    o.part = 1u;
    o.uv = vec2f(u, select(-1.0, 1.0, c.x == 1u));
    let leafCol = select(vec3f(0.03, 0.085, 0.018), vec3f(0.05, 0.13, 0.03), kind == 0u);
    light(&o, leafCol, p, normalize(cross(sideDir, along)), 0.75);
    return o;
  }
  if (vi < 156u) {
    // the petals: up to six, three segments each, round the eye
    let l = vi - 48u;
    let pi = l / 18u;
    if (f32(pi) >= S.n) { return o; }
    let c = QUAD[l % 6u];
    let row = (l % 18u) / 6u + c.y;
    let s = f32(row) / 3.0;
    let phi = yaw + f32(pi) / S.n * 6.2831853;
    let radial = e1 * cos(phi) + e2 * sin(phi);
    let tang = -e1 * sin(phi) + e2 * cos(phi);
    var cup = S.cup;
    var curl = S.curl;
    // an iris: standards up, falls down
    if (kind == 3u && (pi & 1u) == 1u) { cup = 0.1; curl = 1.0; }
    // (the world answering a moment opens them wide as its wave passes: worlds/answer.wgsl, report 20)
    let open = answerReach(1u, head);
    cup *= 1.0 - 0.6 * open;
    let len = S.len * grow * (0.85 + 0.3 * h2.y) * (1.0 + 0.8 * open);
    let el = cup - curl * s * s * 0.6;
    let elTip = cup - curl * s * s;
    let p0 = head + ax * (S.eyeR * grow * 0.4) + radial * (S.eyeR * grow * 0.8 + len * s * cos(el)) + ax * (len * s * sin(el));
    var w = 0.0;
    if (S.shape < 0.5) { w = array<f32, 4>(0.15, 0.85, 0.95, 0.0)[row]; }
    else if (S.shape < 1.5) { w = array<f32, 4>(0.2, 0.8, 1.0, 0.6)[row]; }
    else { w = array<f32, 4>(0.15, 0.6, 1.0, 0.85)[row]; }
    let side = select(-1.0, 1.0, c.x == 1u);
    let p = p0 + tang * S.wid * grow * w * 0.5 * side;
    let along = radial * cos(elTip) + ax * sin(elTip);
    var n = normalize(cross(along, tang));
    if (dot(n, ax) < 0.0) { n = -n; }
    o.part = 2u;
    o.uv = vec2f(s, side * w);
    var b = S.b;
    // an old trillium blushes pink
    if (kind == 1u && h3.z > 0.7) { b = vec3f(0.75, 0.42, 0.58); }
    let albedo = mix(S.a, b, smoothstep(0.0, 0.7, s));
    light(&o, albedo, p, n, 0.9);
    return o;
  }
  // the eye: a little raised disc
  let l = vi - 156u;
  let ti = l / 3u;
  let corner = l % 3u;
  let er = S.eyeR * grow;
  var p = head + ax * er * 0.9;
  var n = ax;
  if (corner > 0u) {
    let a = (f32(ti) + f32(corner - 1u)) / 6.0 * 6.2831853;
    let rd = e1 * cos(a) + e2 * sin(a);
    p = head + ax * er * 0.25 + rd * er;
    n = normalize(ax + rd * 0.6);
  }
  o.part = 3u;
  o.uv = vec2f(select(0.0, 1.0, corner > 0u), 0.0);
  light(&o, S.eye, p, n, 0.85);
  return o;
}

@vertex fn vs_spire(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FOut {
  var o: FOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let R = rootOf(ii, SPIRES, 77777u, 1.4);
  let root = R.xy;
  let r = length(root);
  let ring = worldLight.forest.clock.w;
  if (R.w < 0.5 || !clearOfTrunks(root, 0.12)) { return o; }
  // lupines in drifts across the clearing, foxgloves along the trees
  let fox = smoothstep(ring - 3.5, ring - 2.0, r) * smoothstep(ring + 3.0, ring + 1.0, r);
  let lup = smoothstep(ring * 0.3, ring * 0.45, r) * smoothstep(ring - 1.5, ring - 3.0, r) * smoothstep(0.45, 0.7, vnoise2(root * 0.3 + 5.0));
  let h2 = rnd3(ii * 3u + 19u);
  let isFox = h2.x < fox;
  if (!isFox && R.z > lup) { return o; }
  if (isFox && R.z > 0.75) { return o; }
  o.kind = select(7u, 8u, isFox);
  let grow = worldLight.forest.clock.y;
  let tall = select(0.42 + 0.3 * h2.y, 0.85 + 0.55 * h2.y, isFox) * mix(1.0, grow, 0.5);
  let yaw = h2.z * 6.2831853;
  let t = worldLight.forest.clock.x;
  let bend = (windAt(root, t + h2.y) * 1.1 + (vec2f(h2.y, h2.z) - 0.5) * 0.18) * tall;

  if (vi < 36u) {
    // the stem: six segments
    let c = QUAD[vi % 6u];
    let row = vi / 6u + c.y;
    let p = stemVertex(root, tall, bend, row, 6u, c.x, select(0.005, 0.008, isFox));
    o.part = 0u;
    o.uv = vec2f(f32(row) / 6.0, 0.0);
    light(&o, vec3f(0.03, 0.07, 0.015), p, normalize(vec3f(p.x - root.x, 0.3, p.z - root.y) + vec3f(0.0, 0.01, 0.0)), mix(0.4, 1.0, f32(row) / 6.0));
    return o;
  }
  if (vi < 72u) {
    // three leaves low round the stem
    let l = vi - 36u;
    let li = l / 12u;
    let c = QUAD[l % 6u];
    let row = (l % 12u) / 6u + c.y;
    let u = f32(row) / 2.0;
    let phi = yaw + f32(li) * 2.094 + 0.3;
    let outward = vec3f(cos(phi), 0.0, sin(phi));
    let sideDir = vec3f(-sin(phi), 0.0, cos(phi));
    let len = select(0.13, 0.22, isFox) * grow;
    let p0 = vec3f(root.x, 0.02, root.y) + outward * len * u + vec3f(0.0, len * (0.45 * u - 0.45 * u * u), 0.0);
    let w = select(0.035, 0.06, isFox) * select(0.0, 0.5, row == 1u) * grow;
    let p = p0 + sideDir * w * select(-1.0, 1.0, c.x == 1u);
    o.part = 1u;
    o.uv = vec2f(u, select(-1.0, 1.0, c.x == 1u));
    light(&o, vec3f(0.035, 0.085, 0.02), p, normalize(cross(sideDir, outward + vec3f(0.0, 0.45 - 0.9 * u, 0.0))), 0.7);
    return o;
  }
  // the florets: eighteen little open cones up the top of the stem (lupine: whorls of violet pea flowers, paler towards
  // the top; foxglove: pink bells hanging down one side, buds at the top)
  let l = vi - 72u;
  let j = l / 12u;
  let tri = (l % 12u) / 3u;
  let corner = l % 3u;
  let fj = f32(j) / 17.0;
  let f = select(0.55 + 0.43 * fj, 0.48 + 0.5 * fj, isFox);
  let at = stemAt(root, tall, bend, f);
  var phi = yaw + f32(j) * 2.39996;
  if (isFox) { phi = yaw + (rnd(ii * 31u + j) - 0.5) * 1.3; }
  let outward = vec3f(cos(phi), 0.0, sin(phi));
  var dir = normalize(outward + vec3f(0.0, 0.35, 0.0));
  var len = 0.016 * (1.0 - 0.5 * fj) * grow;
  var mouth = 0.007 * (1.0 - 0.4 * fj) * grow;
  if (isFox) {
    dir = normalize(outward * 0.75 + vec3f(0.0, -0.65, 0.0));
    len = 0.048 * (1.0 - 0.55 * fj) * grow;
    mouth = 0.017 * (1.0 - 0.75 * fj * fj) * grow;
  }
  let a1 = normalize(cross(dir, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4, 0.0, 0.0));
  let a2 = cross(dir, a1);
  let apex = at + outward * 0.004;
  var p = apex;
  var n = -dir;
  if (corner > 0u) {
    let a = (f32(tri) + f32(corner - 1u)) / 4.0 * 6.2831853;
    let rd = a1 * cos(a) + a2 * sin(a);
    p = apex + dir * len + rd * mouth;
    n = normalize(rd + dir * 0.3);
  }
  o.part = 4u;
  o.uv = vec2f(select(0.0, 1.0, corner > 0u), fj);
  var albedo = mix(vec3f(0.14, 0.12, 0.62), vec3f(0.55, 0.45, 0.85), fj * fj);
  if (isFox) { albedo = mix(vec3f(0.62, 0.1, 0.42), vec3f(0.42, 0.1, 0.3), fj); }
  light(&o, albedo, p, n, 0.9);
  return o;
}

@fragment fn fs(i: FOut) -> @location(0) vec4f {
  let V = normalize(frame.camPos - i.wp);
  let L = worldLight.forest.key.xyz;
  var N = normalize(i.n);
  // two-sided: whichever face is towards you (inside a floret's cone, its inside)
  let inside = dot(N, V) < 0.0;
  if (inside) { N = -N; }
  var col = i.col;
  var key = i.key;
  if (i.part == 2u) {
    // fine veins along the petals (sorrel and the iris's throat show them most)
    let strong = select(0.18, 0.45, i.kind == 0u || i.kind == 3u);
    let vein = 1.0 - strong * pow(abs(sin(i.uv.y * 10.0)), 5.0) * smoothstep(0.95, 0.15, i.uv.x);
    col *= vein;
    key *= vein;
  }
  if (i.part == 4u && i.kind == 8u && inside) {
    // inside a foxglove's bell: pale, speckled dark
    let spots = step(0.72, vnoise(i.wp * 900.0));
    let throat = mix(vec3f(0.9, 0.75, 0.85), vec3f(0.25, 0.04, 0.12), spots);
    col = throat * length(col) * 1.2;
    key = throat * length(key) * 0.8;
  }
  let diff = (max(dot(N, L), 0.0) + 0.3) / 1.3;
  // petals and florets are thin: the light comes through them from behind
  let thin = select(0.7, 1.7, i.part >= 2u);
  let through = pow(max(dot(-V, L), 0.0), 3.0) * thin;
  let H = normalize(L + V);
  let gloss = select(30.0, 80.0, i.kind == 5u);
  let sheen = pow(max(dot(N, H), 0.0), gloss) * select(0.12, 0.6, i.kind == 5u);
  var c = col + key * (diff + through) + worldLight.forest.keyCol.rgb * worldLight.forest.key.w * sheen * length(key) * 0.5;
  // (and glow, opened, as the answer's light passes: report 20)
  c *= 1.0 + 1.8 * answerGlow(1u, i.wp) * select(0.0, 1.0, i.part >= 2u);
  return vec4f(c, dot(i.wp - frame.camPos, frame.camFwd));
}
