// The green round the clearing. Sword ferns (vs): rosettes of arching fronds at the trees' feet and out through the wood,
// each frond a rachis with sixteen pairs of narrow pinnae, swaying at the tips. And the redwoods' own foliage (vs_spray):
// flat sprays of needles along the limbs the lanterns hang from, cards whose comb of needles is drawn in the fragment
// and cut out sample by sample (the colour's alpha carries the view distance, so the coverage goes in the sample mask).
#include "weft/frame"
#include "../light"

override FRONDS: u32 = 14u;   // fronds a rosette
override GRID: u32 = 34u;     // rosettes along a side of the grid
override REACH: f32 = 34.0;   // the grid covers ±REACH metres
override LIMB0: u32 = 0u;     // the first limb in the logs
override LIMBS: u32 = 12u;    // how many limbs
override SPRAYS: u32 = 16u;   // sprays a limb (and as many again up each trunk of the ring, its sprouts)

struct Log { foot: vec4f, axis: vec4f, shape: vec4f }

@group(1) @binding(0) var<storage, read> logs: array<Log>;

struct LOut {
  @builtin(position) pos: vec4f,
  @location(0) col: vec3f,
  @location(1) key: vec3f,
  @location(2) wp: vec3f,
  @location(3) n: vec3f,
  @location(4) uv: vec2f,
  @location(5) @interpolate(flat) seed: f32,
}

const QUAD = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u));

fn light(o: ptr<function, LOut>, albedo: vec3f, wp: vec3f, n: vec3f, ao: f32) {
  (*o).col = albedo * (woodsAmbient(n) * ao + lampLight(wp, n, 0.5));
  (*o).key = albedo * light.forest.keyCol.rgb * light.forest.key.w * keyLight(wp) * ao;
  (*o).wp = wp;
  (*o).n = n;
  (*o).pos = frame.viewProj * vec4f(wp, 1.0);
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LOut {
  var o: LOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  let ros = ii / FRONDS;
  let k = ii % FRONDS;
  let h = rnd3(ros * 13u + 5u);
  let cell = 2.0 * REACH / f32(GRID);
  let root = (vec2f(f32(ros % GRID), f32(ros / GRID)) + h.xy) * cell - REACH;
  let r = length(root);
  let ring = light.forest.clock.w;
  // thick along the ring of trees, scattered through the wood, none out in the clearing
  let keep = smoothstep(ring - 2.6, ring - 1.2, r) * mix(0.9, 0.4, smoothstep(ring + 4.0, ring + 9.0, r));
  if (r > REACH || h.z > keep || !onScreen(vec3f(root.x, 0.6, root.y), 1.8) || !clearOfTrunks(root, 0.3)) { return o; }
  let f3 = rnd3(ii * 7u + 3u);
  let size = (0.65 + 0.6 * h.x) * mix(1.0, 1.25, smoothstep(ring, ring + 8.0, r));
  let L = size * (0.75 + 0.35 * f3.x);
  let phi = f32(k) / f32(FRONDS) * 6.2831853 + h.y * 6.2831853 + (f3.y - 0.5) * 0.5;
  let outward = vec3f(cos(phi), 0.0, sin(phi));
  let sideDir = vec3f(-sin(phi), 0.0, cos(phi));
  let el0 = 1.05 + 0.35 * f3.z;
  let arch = 1.25 + 0.4 * f3.x;
  let t = light.forest.clock.x;
  let wind = windAt(root, t + f3.y * 2.0);
  let base = vec3f(root.x, 0.0, root.y);
  // a point s of the way along the rachis, and its direction
  let green = mix(vec3f(0.016, 0.06, 0.01), vec3f(0.04, 0.11, 0.02), f3.z);
  if (vi < 36u) {
    let c = QUAD[vi % 6u];
    let row = vi / 6u + c.y;
    let s = f32(row) / 6.0;
    let el = el0 - arch * s * 0.5;
    let p = base + (outward * cos(el) + vec3f(0.0, sin(el), 0.0)) * L * s + vec3f(wind.x, 0.0, wind.y) * L * s * s * 0.6;
    let w = 0.006 * size * (1.0 - 0.7 * s) * select(-0.5, 0.5, c.x == 1u);
    o.uv = vec2f(s, 0.0);
    light(&o, green * 0.8, p + sideDir * w, normalize(vec3f(0.0, 1.0, 0.0) - outward * 0.3), mix(0.4, 1.0, s));
    return o;
  }
  // the pinnae: sixteen pairs, narrow kites off the rachis, angled towards the tip and a little up
  let l = vi - 36u;
  let j = l / 12u;
  let sideSign = select(-1.0, 1.0, ((l / 6u) & 1u) == 1u);
  let corner = l % 6u;
  let s = 0.1 + 0.88 * (f32(j) + 0.5) / 16.0;
  let el = el0 - arch * s * 0.5;
  let elT = el0 - arch * s;
  let at = base + (outward * cos(el) + vec3f(0.0, sin(el), 0.0)) * L * s + vec3f(wind.x, 0.0, wind.y) * L * s * s * 0.6;
  let along = outward * cos(elT) + vec3f(0.0, sin(elT), 0.0);
  let len = 0.15 * L * (1.0 - pow(s, 3.0)) * smoothstep(0.02, 0.2, s) + 0.012;
  let dir = normalize(sideDir * sideSign * 0.82 + along * 0.45 + vec3f(0.0, 0.16, 0.0));
  let wd = 0.016 * L * (1.0 - 0.5 * s);
  // the kite: the base on the rachis, the two shoulders, the tip
  let tip = at + dir * len;
  let shoulder = at + dir * len * 0.3;
  var p = at;
  var u = 0.0;
  switch (corner) {
    case 1u: { p = shoulder - along * wd * 0.5; u = 0.3; }
    case 2u, 4u: { p = tip; u = 1.0; }
    case 5u: { p = shoulder + along * wd * 0.5; u = 0.3; }
    default: { p = at; u = 0.0; }
  }
  let nrm = normalize(cross(dir, along) * sideSign + vec3f(0.0, 0.4, 0.0));
  o.uv = vec2f(s, u);
  o.seed = f3.x;
  light(&o, mix(green, green * 1.6 + vec3f(0.01, 0.02, 0.0), u * 0.5), p, nrm, mix(0.5, 1.0, u * 0.5 + s * 0.5));
  return o;
}

@fragment fn fs(i: LOut) -> @location(0) vec4f {
  let V = normalize(frame.camPos - i.wp);
  let L = light.forest.key.xyz;
  var N = normalize(i.n);
  if (dot(N, V) < 0.0) { N = -N; }
  let diff = (max(dot(N, L), 0.0) + 0.25) / 1.25;
  let through = pow(max(dot(-V, L), 0.0), 4.0) * 1.2 * i.uv.y;
  let H = normalize(L + V);
  // sword ferns are glossy
  let gloss = pow(max(dot(N, H), 0.0), 60.0) * 0.5;
  let c = i.col + i.key * (diff + through) + light.forest.keyCol.rgb * light.forest.key.w * gloss * length(i.key) * 0.6;
  return vec4f(c, dot(i.wp - frame.camPos, frame.camFwd));
}

// ---------------------------------------------------------------- the redwoods' sprays, along the limbs

@vertex fn vs_spray(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LOut {
  var o: LOut;
  let h = rnd3(ii * 19u + 4u);
  let k = ii % SPRAYS;
  var at = vec3f(0.0);
  var outward = vec3f(1.0, 0.0, 0.0);
  var size = 1.0;
  if (ii < LIMBS * SPRAYS) {
    // along a limb: a spray reaches out to one side of it, flat, drooping a little at its end (more towards the tip)
    let lg = logs[LIMB0 + ii / SPRAYS];
    let len = lg.axis.w;
    let u = 0.18 + 0.82 * pow((f32(k) + h.x) / f32(SPRAYS), 0.7);
    let ax = lg.axis.xyz;
    at = lg.foot.xyz + ax * u * len + vec3f(0.0, -lg.shape.z * u * u, 0.0);
    let flatSide = normalize(cross(ax, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4, 0.0, 0.0)) * select(-1.0, 1.0, h.y > 0.5);
    outward = normalize(flatSide * 0.8 + ax * (0.3 + 0.5 * h.z) + vec3f(0.0, (h.z - 0.45) * 0.6, 0.0));
    size = (0.8 + 0.7 * h.z) * (1.0 - 0.3 * u);
  } else {
    // up a trunk of the ring: its sprouts, tufts reaching out of the bark (more of them low down)
    let t = ii / SPRAYS - LIMBS;
    let tr = light.forest.trunks[t % 9u];
    let y = 1.5 + 24.0 * pow(h.x, 1.6);
    let a = h.y * 6.2831853;
    let rd = vec3f(cos(a), 0.0, sin(a));
    at = vec3f(tr.x, y, tr.y) + rd * trunkRadius(y, tr.z, tr.w) * 0.96;
    outward = normalize(rd + vec3f(0.0, (h.z - 0.3) * 0.8, 0.0));
    size = 0.45 + 0.6 * h.z;
  }
  let across = normalize(cross(outward, vec3f(0.0, 1.0, 0.0)) + vec3f(0.0, 0.0, 1e-4));
  let c = QUAD[vi % 6u];
  let row = vi / 6u + c.y;
  let x = f32(row) / 2.0;
  let y = select(-1.0, 1.0, c.x == 1u);
  let t = light.forest.clock.x;
  let wind = windAt(at.xz, t * 1.3 + h.x * 3.0);
  let p = at + outward * size * x + vec3f(0.0, -0.18 * size * x * x, 0.0) + across * y * size * 0.32 + vec3f(wind.x, 0.0, wind.y) * x * x * 0.6;
  o.uv = vec2f(x, y);
  o.seed = h.x;
  let n = normalize(cross(across, outward));
  light(&o, vec3f(0.02, 0.05, 0.013), p, select(n, -n, n.y < 0.0), 0.85);
  return o;
}

/** the comb of needles: a twig along x (0 at its base, 1 at its tip), flat needles either side slanting forward,
 *  shorter towards the tip; coverage 0 … 1 */
fn comb(x: f32, y: f32, reach: f32) -> f32 {
  if (x < 0.0 || x > 1.0) { return 0.0; }
  let ay = abs(y);
  let nl = reach * (1.0 - pow(x, 1.6)) + 0.01;
  let along = x - ay * 0.35;
  let rows = abs(fract(along / 0.034 + select(0.0, 0.5, y > 0.0)) - 0.5);
  let needle = smoothstep(0.24, 0.12, rows) * smoothstep(nl, nl * 0.8, ay);
  let twig = smoothstep(0.012, 0.006, ay);
  return max(needle, twig);
}

struct SprayOut { @location(0) c: vec4f, @builtin(sample_mask) mask: u32 }

@fragment fn fs_spray(i: LOut) -> SprayOut {
  var o: SprayOut;
  // the main twig and two side twigs branching off it, each a comb
  let x = i.uv.x;
  let y = i.uv.y;
  var a = comb(x * 1.05, y, 0.32);
  for (var k = 0; k < 2; k++) {
    let x0 = 0.2 + f32(k) * 0.28;
    let sgn = select(-1.0, 1.0, k == 0);
    let dx = x - x0;
    let sa = 0.64 * sgn;
    let bx = (dx * 0.77 + y * sa) * 1.9;
    let by = (-dx * sa + y * 0.77) * 1.9;
    a = max(a, comb(bx, by, 0.3) * step(0.0, by * sgn + 0.06));
  }
  // coverage into samples, dithered so it doesn't band
  let px = vec2u(i.pos.xy);
  let dither = f32((px.x * 3u + px.y * 5u) % 4u) / 4.0;
  let m = u32(clamp(a * 4.0 + dither - 0.5, 0.0, 4.0));
  o.mask = (1u << m) - 1u;
  if (o.mask == 0u) { discard; }
  let V = normalize(frame.camPos - i.wp);
  let L = light.forest.key.xyz;
  var N = normalize(i.n);
  if (dot(N, V) < 0.0) { N = -N; }
  let diff = (max(dot(N, L), 0.0) + 0.3) / 1.3;
  let through = pow(max(dot(-V, L), 0.0), 3.0) * 2.2;
  // the new growth at the tips is fresher
  let fresh = mix(1.0, 2.2, smoothstep(0.55, 1.0, x)) * (0.8 + 0.4 * i.seed);
  let c = (i.col + i.key * (diff + through)) * fresh;
  o.c = vec4f(c, dot(i.wp - frame.camPos, frame.camFwd));
  return o;
}
