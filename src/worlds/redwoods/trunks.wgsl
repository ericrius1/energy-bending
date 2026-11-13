// The redwoods themselves: each trunk (and each limb a lantern hangs from) a tapering tube, flared at the foot into
// buttresses, with the bark (bark.jpg, from a photograph, seamless, and its height in barkH: r the height, gb its normal)
// wrapped round it a whole number of times and the furrows pushed in. A grid of rings × sides made from the vertex
// index, one instance per log (forest.ts lays them out): the ring round the clearing in detail, the wood beyond and the
// limbs in less. Moss on the shaded foot, an old fire scar on some, lost up in the dark of the canopy.
#include "weft/frame"
#include "../light"

override SIDES: u32 = 40u;
override RINGS: u32 = 48u;
override FIRST: u32 = 0u;

struct Log {
  foot: vec4f,    // where it starts; w: its radius there (above the flare)
  axis: vec4f,    // which way it grows (unit); w: how long it is
  shape: vec4f,   // x: its radius at the tip (a fraction), y: how much it flares at the foot (0 for a limb), z: how far its tip droops (m), w: a seed
}

@group(1) @binding(0) var<storage, read> logs: array<Log>;
@group(1) @binding(1) var barkTex: texture_2d<f32>;
@group(1) @binding(2) var barkH: texture_2d<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) around: vec3f,
  @location(3) uv: vec2f,
  @location(4) ang: f32,
  @location(5) @interpolate(flat) seed: f32,
  @location(6) @interpolate(flat) limb: f32,
}

// metres of bark the texture spans round a trunk, and up it
const BARK_W: f32 = 1.7;
const BARK_H: f32 = 2.6;

/** the log's radius s metres along it, at angle a round it */
fn profile(s: f32, len: f32, r0: f32, sh: vec4f, a: f32) -> f32 {
  let u = clamp(s / len, 0.0, 1.0);
  if (sh.y <= 0.0) { return r0 * mix(1.0, sh.x, u); }
  let lobes = 0.22 * sin(5.0 * a + sh.w * 6.3) + 0.13 * sin(11.0 * a + sh.w * 2.1) + 0.07 * sin(17.0 * a + sh.w * 9.7);
  return r0 * (pow(1.0 - u, 0.8) * (1.0 - sh.x) + sh.x) * (1.0 + sh.y * exp(-s / 1.7) * (1.0 + lobes * smoothstep(3.5, 0.0, s)));
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let quad = vi / 6u;
  let c = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let side = quad % SIDES + c.x;
  let ring = quad / SIDES + c.y;
  let L = logs[FIRST + ii];
  let len = L.axis.w;
  let trunk = L.shape.y > 0.0;
  let v = f32(ring) / f32(RINGS - 1u);
  // (a trunk's rings crowd its foot, where the buttresses are)
  let s = select(v, pow(v, 1.8), trunk) * len;
  let a = f32(side) / f32(SIDES) * 6.2831853;
  let ax = L.axis.xyz;
  let helper = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(ax.y) > 0.9);
  let b1 = normalize(cross(ax, helper));
  let b2 = cross(ax, b1);
  let radial = b1 * cos(a) + b2 * sin(a);
  let u = s / len;
  // a limb sags towards its tip
  let centre = L.foot.xyz + ax * s + vec3f(0.0, -L.shape.z * u * u, 0.0);
  let along = normalize(ax + vec3f(0.0, -2.0 * L.shape.z * u / len, 0.0));
  let r = profile(s, len, L.foot.w, L.shape, a);
  // the bark, a whole number of times round so it meets itself, its furrows pushed in (a blurred level of its height)
  let tiles = max(1.0, round(6.2831853 * L.foot.w * select(1.0, 1.4, trunk) / BARK_W));
  o.uv = vec2f(f32(side) / f32(SIDES) * tiles + L.shape.w * 7.0, -s / BARK_H + L.shape.w * 3.0);
  let h = textureSampleLevel(barkH, samp_repeat, o.uv, 2.0).r;
  let depth = select(0.012, 0.075 * min(L.foot.w, 1.8), trunk) * smoothstep(0.0, 0.3, r);
  let wp = centre + radial * (r + (h - 0.5) * depth);
  // the normal: out from the axis, tipped by the taper
  let ds = 0.03 * len;
  let dr = (profile(s + ds, len, L.foot.w, L.shape, a) - profile(max(s - ds, 0.0), len, L.foot.w, L.shape, a)) / (s + ds - max(s - ds, 0.0));
  o.n = normalize(radial - along * dr);
  o.around = -b1 * sin(a) + b2 * cos(a);
  o.wp = wp;
  o.ang = a;
  o.seed = L.shape.w;
  o.limb = select(1.0, 0.0, trunk);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let V = normalize(frame.camPos - i.wp);
  let N0 = normalize(i.n);
  let T = normalize(i.around - N0 * dot(i.around, N0));
  let B = cross(N0, T);
  let hs = textureSample(barkH, samp_repeat, i.uv);
  var albedo = textureSample(barkTex, samp_repeat, i.uv).rgb;
  let N = normalize(N0 + (T * (hs.g * 2.0 - 1.0) + B * (hs.b * 2.0 - 1.0)) * 1.3);
  let y = i.wp.y;
  // each tree its own shade, some redder, some greyer with age
  albedo *= mix(vec3f(0.9, 0.74, 0.66), vec3f(0.74, 0.66, 0.64), fract(i.seed * 17.3));
  // the foot: darker and damp, mossy on the shaded north side
  let low = smoothstep(4.0, 0.0, y) * (1.0 - i.limb);
  albedo *= 1.0 - 0.3 * low;
  let mossy = smoothstep(0.55, 0.85, vnoise(i.wp * 2.3) * 0.45 + vnoise(i.wp * 7.1) * 0.2 + max(-N0.z, 0.0) * 0.3 + low * 0.3 + i.limb * 0.25) * smoothstep(5.0, 0.6, y + i.limb * -6.0);
  albedo = mix(albedo, vec3f(0.035, 0.07, 0.016) * (0.5 + 0.9 * hs.r), mossy * 0.75);
  // an old fire scar, blackened, up one side of some of the trunks
  if (i.limb < 0.5 && fract(i.seed * 7.31) > 0.55) {
    let toward = abs(atan2(sin(i.ang - i.seed * 40.0), cos(i.ang - i.seed * 40.0)));
    let tall = 1.6 + 2.6 * fract(i.seed * 3.7);
    let scar = smoothstep(0.75, 0.45, toward + vnoise(i.wp * 2.3) * 0.25) * smoothstep(tall, tall * 0.55, y + toward * 1.4);
    albedo = mix(albedo, vec3f(0.018, 0.016, 0.015) * (0.6 + 0.9 * hs.r), scar);
  }
  let L = forest.key.xyz;
  let vis = keyLight(i.wp + N0 * 0.06);
  let lit = forest.keyCol.rgb * forest.key.w * vis;
  let diff = max(dot(N, L), 0.0);
  let ao = mix(0.45, 1.0, hs.r) * mix(0.5, 1.0, smoothstep(0.0, 3.0, y));
  var col = albedo * (lit * diff + woodsAmbient(N) * ao + lampLight(i.wp, N, 0.0) * mix(0.6, 1.0, hs.r));
  // the bark's fibres catch a low sun behind the trunk: a glowing edge
  let back = pow(max(dot(-V, L), 0.0), 3.0) * pow(1.0 - max(dot(N0, V), 0.0), 2.0);
  col += lit * back * albedo * 1.6;
  // high up, the trunk goes into the dark of the canopy
  col *= mix(1.0, 0.18, smoothstep(forest.keyCol.w * 0.45, forest.keyCol.w * 0.9, y));
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}
