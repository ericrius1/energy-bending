// The sun worlds' hero architecture (sun-hero.ts lays out the parts; report 24-sun-built): one built piece at the bodies'
// height in each arena, inside the duel camera's frame, of the art bible's matter: the temple's sun fountain (a round
// pavilion of white ceramic columns under a dome of leaded glass on copper ribs, a tiered fountain in it) and the Pool's
// sun window (a moon gate of copper gone green holding a rose of stained glass, the low sun behind it). Made from the
// vertex index, one draw a shape, each binding its own list as `items` (the Pool's edge.wgsl is the model):
//   vs_lathe   a body turned round its axis from a profile (a plinth, a dome and its ring beam, bowls, tubs, a sill)
//   vs_tube    a straight tube from a to b (columns, rings, ribs, the gate's ring and tendrils in pieces)
//   vs_leaf    a leaf or a flower on a vine, a card cut to its shape
//   vs_window  a round window of stained glass in lead, facing its normal, lit through by the sun behind it
//   vs_jet     (the glow pass) a fountain's droplets: a plume and arcs, or (SPILL) a ring of water falling off a rim
// Lit by its world (WORLD: 2 the Pool, 3 the temple: its sun, sky, shade and the dancers' fire). Decoration, not solid:
// it stands outside where the bodies go; near the eye or across the line of sight to a body it fades by the near fade's
// dither (decorDrop, worlds/light.wgsl).
#include "weft/frame"
#include "./light"

@group(1) @binding(0) var<storage, read> items: array<vec4f>;

const AROUND: u32 = 40u;
const STEPS: u32 = 16u;
const TUBE: u32 = 10u;
/** droplets a fountain throws */
override PER: u32 = 120u;
/** the jets are a ring of water falling off a rim (1) rather than a plume and its arcs (0) */
override SPILL: u32 = 0u;

const M_CERAMIC: f32 = 0.0;
const M_COPPER: f32 = 1.0;
const M_GLASS: f32 = 2.0;
const M_TEAL: f32 = 3.0;
const M_WATER: f32 = 4.0;
const M_GOLD: f32 = 5.0;
const M_MOSS: f32 = 6.0;
const M_LEAF: f32 = 7.0;
const M_FLOWER: f32 = 8.0;
const M_FLOOR: f32 = 9.0;
const M_NONE: f32 = 10.0;
const M_WINDOW: f32 = 11.0;

/** the profiles: (radius, height, the material of the segment from this point to the next), walked with the outside on
 *  the left (the normal is the segment turned a quarter to the left) */
const PROFILES = array<vec3f, 112>(
  // 0 the temple's plinth: its mosaic floor, a copper edge, white ceramic with a teal band, two steps down into the sea
  vec3f(0.0, 0.75, M_FLOOR), vec3f(2.95, 0.75, M_COPPER), vec3f(3.08, 0.7, M_CERAMIC), vec3f(3.08, 0.56, M_TEAL),
  vec3f(3.08, 0.2, M_CERAMIC), vec3f(3.08, 0.02, M_CERAMIC), vec3f(3.65, 0.02, M_CERAMIC), vec3f(3.65, -0.42, M_CERAMIC),
  vec3f(4.25, -0.42, M_CERAMIC), vec3f(4.25, -2.6, M_NONE), vec3f(4.25, -2.6, M_NONE), vec3f(4.25, -2.6, M_NONE),
  vec3f(4.25, -2.6, M_NONE), vec3f(4.25, -2.6, M_NONE), vec3f(4.25, -2.6, M_NONE), vec3f(4.25, -2.6, M_NONE),
  // 1 the temple's dome: a copper finial, leaded glass down to a copper ring beam, its soffit
  vec3f(0.0, 7.75, M_COPPER), vec3f(0.09, 7.3, M_COPPER), vec3f(0.3, 7.05, M_GLASS), vec3f(0.95, 6.86, M_GLASS),
  vec3f(1.6, 6.5, M_GLASS), vec3f(2.15, 5.98, M_GLASS), vec3f(2.55, 5.35, M_GLASS), vec3f(2.78, 4.72, M_COPPER),
  vec3f(3.2, 4.62, M_COPPER), vec3f(3.26, 4.4, M_GOLD), vec3f(3.24, 4.3, M_COPPER), vec3f(3.18, 4.18, M_CERAMIC),
  vec3f(2.6, 4.18, M_NONE), vec3f(2.6, 4.18, M_NONE), vec3f(2.6, 4.18, M_NONE), vec3f(2.6, 4.18, M_NONE),
  // 2 the fountain's basin on the floor: its water, a copper lip, the bowl in teal glaze to a white foot
  vec3f(0.0, 1.12, M_WATER), vec3f(1.5, 1.12, M_COPPER), vec3f(1.58, 1.22, M_COPPER), vec3f(1.68, 1.18, M_TEAL),
  vec3f(1.66, 0.95, M_TEAL), vec3f(1.52, 0.8, M_CERAMIC), vec3f(1.4, 0.75, M_NONE), vec3f(1.4, 0.75, M_NONE),
  vec3f(1.4, 0.75, M_NONE), vec3f(1.4, 0.75, M_NONE), vec3f(1.4, 0.75, M_NONE), vec3f(1.4, 0.75, M_NONE),
  vec3f(1.4, 0.75, M_NONE), vec3f(1.4, 0.75, M_NONE), vec3f(1.4, 0.75, M_NONE), vec3f(1.4, 0.75, M_NONE),
  // 3 its middle bowl on a stem: water, a copper lip, the bowl white with a gold line, the stem teal in copper rings
  vec3f(0.0, 2.2, M_WATER), vec3f(0.86, 2.2, M_COPPER), vec3f(0.92, 2.27, M_GOLD), vec3f(0.97, 2.22, M_CERAMIC),
  vec3f(0.82, 1.98, M_CERAMIC), vec3f(0.42, 1.84, M_COPPER), vec3f(0.2, 1.72, M_COPPER), vec3f(0.16, 1.6, M_TEAL),
  vec3f(0.15, 1.3, M_COPPER), vec3f(0.24, 1.2, M_CERAMIC), vec3f(0.3, 1.1, M_NONE), vec3f(0.3, 1.1, M_NONE),
  vec3f(0.3, 1.1, M_NONE), vec3f(0.3, 1.1, M_NONE), vec3f(0.3, 1.1, M_NONE), vec3f(0.3, 1.1, M_NONE),
  // 4 its top bowl and spout: a copper bud, water, a white lip, the stem down into the middle bowl
  vec3f(0.0, 3.1, M_COPPER), vec3f(0.08, 2.98, M_COPPER), vec3f(0.1, 2.86, M_WATER), vec3f(0.42, 2.86, M_GOLD),
  vec3f(0.46, 2.9, M_CERAMIC), vec3f(0.38, 2.72, M_CERAMIC), vec3f(0.12, 2.6, M_COPPER), vec3f(0.09, 2.2, M_NONE),
  vec3f(0.09, 2.2, M_NONE), vec3f(0.09, 2.2, M_NONE), vec3f(0.09, 2.2, M_NONE), vec3f(0.09, 2.2, M_NONE),
  vec3f(0.09, 2.2, M_NONE), vec3f(0.09, 2.2, M_NONE), vec3f(0.09, 2.2, M_NONE), vec3f(0.09, 2.2, M_NONE),
  // 5 a planted urn: moss in it, a copper rim, its body white with a teal band, a foot (0.9 m tall at scale 1)
  vec3f(0.0, 0.88, M_MOSS), vec3f(0.36, 0.88, M_COPPER), vec3f(0.42, 0.92, M_CERAMIC), vec3f(0.46, 0.8, M_TEAL),
  vec3f(0.5, 0.6, M_CERAMIC), vec3f(0.44, 0.34, M_CERAMIC), vec3f(0.26, 0.2, M_COPPER), vec3f(0.24, 0.08, M_COPPER),
  vec3f(0.34, 0.0, M_NONE), vec3f(0.34, 0.0, M_NONE), vec3f(0.34, 0.0, M_NONE), vec3f(0.34, 0.0, M_NONE),
  vec3f(0.34, 0.0, M_NONE), vec3f(0.34, 0.0, M_NONE), vec3f(0.34, 0.0, M_NONE), vec3f(0.34, 0.0, M_NONE),
  // 6 the Pool's gate's foot: a round ceramic plinth standing in the water, moss on it, a copper edge
  vec3f(0.0, 0.32, M_MOSS), vec3f(0.95, 0.32, M_COPPER), vec3f(1.02, 0.28, M_CERAMIC), vec3f(1.05, 0.12, M_TEAL),
  vec3f(1.05, -0.05, M_CERAMIC), vec3f(1.0, -0.6, M_NONE), vec3f(1.0, -0.6, M_NONE), vec3f(1.0, -0.6, M_NONE),
  vec3f(1.0, -0.6, M_NONE), vec3f(1.0, -0.6, M_NONE), vec3f(1.0, -0.6, M_NONE), vec3f(1.0, -0.6, M_NONE),
  vec3f(1.0, -0.6, M_NONE), vec3f(1.0, -0.6, M_NONE), vec3f(1.0, -0.6, M_NONE), vec3f(1.0, -0.6, M_NONE),
);

struct HOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,                        // a lathe: (round it 0 … 1, up its profile); a leaf, a window: (-1 … 1)²
  @location(3) @interpolate(flat) info: vec4f,   // material, seed, a tint (a window: its radius), a window's open share
  @location(4) r: f32,                           // a lathe: how far out from its axis (m)
}

fn emit(o: ptr<function, HOut>, wp: vec3f, n: vec3f) {
  (*o).pos = frame.viewProj * vec4f(wp, 1.0);
  (*o).wp = wp;
  (*o).n = n;
}

const QUAD = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));

// ---------------------------------------------------------------- the world's light
fn heroT() -> f32 { if (WORLD == 2u) { return worldLight.pool.march.z; } return worldLight.temple.fire.y; }
fn heroSunDir() -> vec3f { if (WORLD == 2u) { return worldLight.pool.key.xyz; } return worldLight.temple.moon.xyz; }
fn heroSun() -> vec3f {
  if (WORLD == 2u) { return worldLight.pool.keyCol.rgb * worldLight.pool.key.w; }
  return worldLight.temple.moonCol.rgb * worldLight.temple.moonCol.w;
}
fn heroEnv(R: vec3f, p: vec3f) -> vec3f {
  if (WORLD == 2u) { return poolEnv(R, p); }
  return templeEnv(R, p);
}
/** the soft light on a surface facing N: the world's sky and shade, and (the temple) its warm low light from in front */
fn heroAmb(N: vec3f, ao: f32, p: vec3f) -> vec3f {
  if (WORLD == 2u) { return poolAmbient(N, ao) + worldFire(p, N); }
  let La = normalize(worldLight.temple.duskDir.xyz + vec3f(0.0, 0.32, 0.0));
  let dusk = mix(vec3f(luma(worldLight.temple.dusk.rgb)), worldLight.temple.dusk.rgb, 0.55);
  let after = dusk * worldLight.temple.dusk.w * worldLight.temple.tide2.x * max(dot(N, La), 0.0);
  return templeAmbient(N, ao, p, 1.0) + after;
}
/** the sun behind a silhouette, round its edge */
fn heroRim(N: vec3f, V: vec3f) -> vec3f {
  let k = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  if (WORLD == 2u) { return worldLight.pool.glow.rgb * worldLight.pool.glow.w * k * max(dot(-V, worldLight.pool.glowDir.xyz) * 0.5 + 0.5, 0.0) * 0.2; }
  return heroSun() * k * pow(max(dot(-V, heroSunDir()), 0.0), 2.0) * 0.35;
}
/** under the temple's tide: what the water does to a colour (the Pool's surface is laid in its air) */
fn heroUnder(c: vec3f, p: vec3f, lit: vec3f) -> vec3f {
  if (WORLD == 3u) { return templeUnder(c, p, lit); }
  return c;
}

// ---------------------------------------------------------------- the shapes
/** a lathe: items[2i] (its foot, scale), items[2i + 1] (profile, turn, seed, -) */
@vertex fn vs_lathe(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> HOut {
  var o: HOut;
  let A = items[ii * 2u];
  let B = items[ii * 2u + 1u];
  let q = vi / 6u;
  let c = QUAD[vi % 6u];
  let seg = q / AROUND;
  let k = q % AROUND;
  let prof = u32(B.x + 0.5) * STEPS;
  let j = min(seg + u32(c.y), STEPS - 1u);
  let P = PROFILES[prof + j];
  let mat = PROFILES[prof + seg].z;
  let a = (f32(k) + c.x) / f32(AROUND) * 6.2831853 + B.y;
  let dir = vec3f(cos(a), 0.0, sin(a));
  let P0 = PROFILES[prof + seg];
  let P1 = PROFILES[prof + min(seg + 1u, STEPS - 1u)];
  let t2 = vec2f(P1.x - P0.x, P1.y - P0.y);
  let n2 = normalize(vec2f(-t2.y, t2.x) + vec2f(1e-5, 0.0));
  let wp = A.xyz + (dir * P.x + vec3f(0.0, P.y, 0.0)) * A.w;
  emit(&o, wp, normalize(dir * n2.x + vec3f(0.0, n2.y, 0.0)));
  o.uv = vec2f((f32(k) + c.x) / f32(AROUND), P.y);
  o.r = P.x * A.w;
  o.info = vec4f(mat, B.z, 0.0, 0.0);
  if (mat > 9.5) { o.pos = vec4f(0.0, 0.0, 2.0, 1.0); }
  return o;
}

/** a tube: items[2i] (a, radius), items[2i + 1] (b, material) */
@vertex fn vs_tube(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> HOut {
  var o: HOut;
  let A = items[ii * 2u];
  let B = items[ii * 2u + 1u];
  let q = vi / 6u;
  let c = QUAD[vi % 6u];
  let ax = B.xyz - A.xyz;
  let w = normalize(ax);
  let u = normalize(cross(w, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(w.y) > 0.9)));
  let v = cross(w, u);
  let a = (f32(q) + c.x) / f32(TUBE) * 6.2831853;
  let n = u * cos(a) + v * sin(a);
  // (its ends a little past a and b, so tubes meeting at an angle close their joint)
  let wp = A.xyz + ax * c.y + w * (c.y * 2.0 - 1.0) * A.w * 0.8 + n * A.w;
  emit(&o, wp, n);
  o.uv = vec2f(f32(q) / f32(TUBE), c.y * length(ax));
  o.info = vec4f(B.w, f32(ii) * 0.137, 0.0, 0.0);
  return o;
}

/** a leaf or a flower: items[3i] (where, size), items[3i + 1] (which way it points from the vine, 0 a leaf / 1 a
 *  flower), items[3i + 2] (seed, tint, -, -) */
@vertex fn vs_leaf(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> HOut {
  var o: HOut;
  let A = items[ii * 3u];
  let B = items[ii * 3u + 1u];
  let C = items[ii * 3u + 2u];
  let c = QUAD[vi % 6u] * 2.0 - 1.0;
  let flower = B.w > 0.5;
  let out = normalize(B.xyz);
  let side = normalize(cross(out, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4, 0.0, 0.0));
  let flutter = sin(heroT() * 2.3 + C.x * 30.0) * 0.12;
  var along = normalize(out + vec3f(0.0, select(-0.45, 0.2, flower), 0.0) + side * flutter);
  var across = normalize(cross(along, select(vec3f(0.0, 1.0, 0.0), out, flower)) + vec3f(1e-4, 0.0, 0.0));
  var n = normalize(cross(across, along));
  if (flower) {
    n = normalize(out + vec3f(0.0, 0.6, 0.0));
    across = normalize(cross(n, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4, 0.0, 0.0));
    along = cross(across, n);
    emit(&o, A.xyz + (across * c.x + along * c.y) * A.w, n);
  } else {
    emit(&o, A.xyz + along * (c.y * 0.5 + 0.5) * A.w * 1.6 + across * c.x * A.w * 0.55, n);
  }
  o.uv = c;
  o.info = vec4f(select(M_LEAF, M_FLOWER, flower), C.x, C.y, 0.0);
  return o;
}

/** a round window: items[2i] (its middle, radius), items[2i + 1] (which way it faces, the share of its radius left
 *  open in the middle: 0 none) */
@vertex fn vs_window(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> HOut {
  var o: HOut;
  let A = items[ii * 2u];
  let B = items[ii * 2u + 1u];
  let c = QUAD[vi % 6u] * 2.0 - 1.0;
  let n = normalize(B.xyz);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), n) + vec3f(1e-4, 0.0, 0.0));
  let up = cross(n, right);
  emit(&o, A.xyz + (right * c.x + up * c.y) * A.w, n);
  o.uv = c;
  o.info = vec4f(M_WINDOW, f32(ii) * 0.31, A.w, B.w);
  return o;
}

// ---------------------------------------------------------------- the matter
fn heroPetal(k: f32) -> vec3f {
  if (k < 0.3) { return vec3f(0.95, 0.9, 0.78); }
  if (k < 0.55) { return vec3f(1.0, 0.72, 0.2); }
  if (k < 0.82) { return vec3f(1.0, 0.45, 0.32); }
  return vec3f(1.0, 0.62, 0.72);
}

/** stained glass at (r 0 … 1 out from the middle, a round it): the panes' colour and the lead between them (w). A
 *  lotus: a sun-gold disc in the middle in rays, a ring of coral and rose petals, leaves of green between their tips,
 *  sky teal round the rim, every pane in lead */
fn roseGlass(r: f32, a: f32, px: f32) -> vec4f {
  let PET = 12.0;
  let s = fract(a * PET / 6.2831853) - 0.5;
  let s2 = fract(a * PET / 6.2831853 + 0.5) - 0.5;
  var col = vec3f(0.03, 0.4, 0.5);
  var lead = smoothstep(px * 1.5, px * 0.5, abs(r - 0.97)) + smoothstep(px * 1.5, px * 0.5, abs(r - 0.25));
  if (r < 0.25) {
    // the sun: gold rays in amber
    let ray = fract(a * 16.0 / 6.2831853) - 0.5;
    col = mix(vec3f(1.0, 0.5, 0.04), vec3f(1.0, 0.8, 0.25), smoothstep(0.2, 0.0, abs(ray)));
    lead = max(lead, smoothstep(px * 1.2, 0.0, abs(ray) * r * 6.28 / 16.0) * step(0.06, r));
    lead = max(lead, smoothstep(px * 1.5, px * 0.5, abs(r - 0.06)));
  } else {
    // a petal: from the disc out to its tip, widest past its middle
    let u = (r - 0.25) / 0.6;
    let half = 0.42 * sin(3.1415927 * clamp(u, 0.0, 1.0) * 0.92 + 0.12) * smoothstep(1.02, 0.85, u);
    let inPetal = abs(s) < half;
    // (a leaf between two petals' tips)
    let lu = (r - 0.55) / 0.38;
    let lhalf = 0.3 * sin(3.1415927 * clamp(lu, 0.0, 1.0));
    let inLeaf = abs(s2) < lhalf && lu > 0.0 && lu < 1.0;
    if (inPetal) {
      col = mix(vec3f(0.95, 0.22, 0.2), vec3f(1.0, 0.5, 0.55), smoothstep(0.1, 0.0, abs(s) - half * 0.4) * (0.4 + 0.6 * u));
      lead = max(lead, smoothstep(px * 1.5 / max(r * 6.28 / PET, 1e-3), 0.0, half - abs(s)));
      lead = max(lead, smoothstep(px * 1.2, 0.0, abs(s) * r * 6.28 / PET) * step(0.35, u));
    } else if (inLeaf) {
      col = mix(vec3f(0.1, 0.5, 0.12), vec3f(0.4, 0.72, 0.15), lu);
      lead = max(lead, smoothstep(px * 1.5 / max(r * 6.28 / PET, 1e-3), 0.0, lhalf - abs(s2)));
    } else {
      col = mix(vec3f(0.03, 0.38, 0.5), vec3f(0.3, 0.7, 0.78), smoothstep(0.5, 1.0, r));
      // (the sky panes cut in rings)
      lead = max(lead, smoothstep(px * 1.5, px * 0.5, abs(r - 0.72)) * step(0.6, r));
    }
  }
  return vec4f(col, clamp(lead, 0.0, 1.0));
}

/** glass lit by the sun behind it and the sky's light through it (col: the glass's own), its face mirroring the sky */
fn heroGlass(col: vec3f, lead: f32, N: vec3f, V: vec3f, wp: vec3f, amb: vec3f) -> vec3f {
  let L = heroSunDir();
  let sun = heroSun();
  // (the sun seen through it: strongest looking into the sun, never dark)
  let back = pow(max(dot(-V, L), 0.0), 3.0) * 1.6 + max(-dot(N, L) * sign(dot(N, V)), 0.0) * 0.6 + 0.4;
  let through = col * (sun * back * 0.7 + amb * 0.5);
  let Nv = select(-N, N, dot(N, V) >= 0.0);
  let R = reflect(-V, Nv);
  let F = 0.04 + 0.96 * pow(1.0 - max(dot(Nv, V), 0.0), 5.0);
  var c = through * (1.0 - F * 0.7) + heroEnv(R, wp) * F * 0.7 + sun * pow(max(dot(R, L), 0.0), 400.0) * 5.0;
  // the lead: dark, a little gold on its crown
  c = mix(c, vec3f(0.05, 0.04, 0.03) + sun * vec3f(0.25, 0.18, 0.08) * 0.08, lead);
  return c;
}

@fragment fn fs(i: HOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (decorDrop(i.wp, i.pos.xy)) { discard; }
  let m = i.info.x;
  var N = normalize(i.n);
  let V = normalize(frame.camPos - i.wp);
  if (!front && (m > 6.5 && m < 8.5)) { N = -N; }
  let L = heroSunDir();
  let sun = heroSun();
  let kd = max(dot(N, L), 0.0);
  let ao = smoothstep(-0.4, 1.2, i.wp.y);
  let amb = heroAmb(N, ao, i.wp);
  let R = reflect(-V, N);
  let px = length(fwidth(i.wp));
  var col = vec3f(0.0);
  var lit = vec3f(0.0);
  if (m > 6.5 && m < 8.5) {
    // a leaf (a pointed oval) or a flower (petals round a gold disc), lit through by the low sun
    var albedo = vec3f(0.0);
    var through = 0.0;
    if (m < 7.5) {
      let u = i.uv.y * 0.5 + 0.5;
      let w = pow(sin(3.1415927 * min(u * 0.95 + 0.05, 1.0)), 0.8);
      if (abs(i.uv.x) > w) { discard; }
      albedo = mix(vec3f(0.05, 0.17, 0.035), vec3f(0.17, 0.33, 0.06), i.info.z) * (1.0 + 0.4 * smoothstep(0.1, 0.0, abs(i.uv.x)));
      through = 0.8;
    } else {
      let r = length(i.uv);
      let a = atan2(i.uv.y, i.uv.x);
      let petal = 0.55 + 0.45 * pow(abs(cos(a * 2.5)), 0.6);
      if (r > petal) { discard; }
      let disc = smoothstep(0.3, 0.22, r);
      albedo = mix(heroPetal(i.info.z), vec3f(0.85, 0.5, 0.06), disc);
      through = 0.9 * (1.0 - disc);
    }
    let back = (pow(max(dot(-V, L), 0.0), 3.0) + max(-dot(N, L), 0.0) * 0.5) * through;
    lit = sun * (kd + back);
    col = albedo * (lit + amb);
  } else if (m > 10.5) {
    // a round window: its panes and lead (roseGlass), the open middle cut away, a copper frame round it (the tubes)
    let r = length(i.uv);
    if (r > 1.0 || r < i.info.w) { discard; }
    let g = roseGlass(r, atan2(i.uv.y, i.uv.x), px / max(i.info.z, 1e-3));
    col = heroGlass(g.rgb, g.a, N, V, i.wp, amb);
  } else if (m > 1.5 && m < 2.5) {
    // the dome's glass: copper ribs (twelve round it, two rings up it); between them a lotus petal of coral in each
    // panel on sky teal, sun gold at the crown, all in lead
    let ui = i.uv.x * 12.0;
    let s = fract(ui) - 0.5;
    let h = clamp((7.05 - i.uv.y) / (7.05 - 4.72), 0.0, 1.0);
    let rib = smoothstep(0.03, 0.015, 0.5 - abs(s));
    let ring = smoothstep(0.02, 0.0, abs(h - 0.45) - 0.012);
    var g = mix(vec3f(0.12, 0.52, 0.56), vec3f(0.5, 0.8, 0.82), h);
    let half = 0.36 * sin(3.1415927 * clamp((h - 0.15) / 0.8, 0.0, 1.0));
    var lead = smoothstep(0.03, 0.0, abs(abs(s) - half)) * step(0.15, h) * step(h, 0.95);
    if (abs(s) < half && h > 0.15) { g = mix(vec3f(1.0, 0.45, 0.36), vec3f(1.0, 0.75, 0.62), h); }
    if (h < 0.15) { g = vec3f(1.0, 0.72, 0.2); }
    lead = max(lead, ring);
    col = heroGlass(g, lead, N, V, i.wp, amb);
    let copper = max(rib, ring * 0.0);
    let verd = vec3f(0.14, 0.44, 0.36) * (0.9 + 0.2 * vnoise(i.wp * 9.0));
    col = mix(col, verd * (sun * kd + amb) + heroEnv(R, i.wp) * 0.08, copper);
  } else if (m > 3.5 && m < 4.5) {
    // a bowl's water: clear, rippled by what falls in, the sky in it
    let t = heroT();
    let wn = normalize(vec3f(sin(i.uv.x * 90.0 + t * 4.0 + i.info.y * 9.0) * 0.06, 1.0, cos(length(i.wp.xz) * 30.0 - t * 5.0) * 0.06));
    let Rw = reflect(-V, wn);
    let F = 0.05 + 0.95 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
    col = mix(vec3f(0.06, 0.36, 0.38) * (sun * 0.25 + amb * 0.6), heroEnv(Rw, i.wp), F) + sun * pow(max(dot(Rw, L), 0.0), 400.0) * 6.0;
  } else if ((m > 0.5 && m < 1.5) || (m > 4.5 && m < 5.5)) {
    // copper gone green (rubbed warm on its crowns and edges), or gold leaf
    let rubbed = select(smoothstep(0.62, 0.82, vnoise(i.wp * 6.0 + i.info.y * 7.0)) * 0.7, 1.0, m > 4.5);
    let verd = mix(vec3f(0.13, 0.42, 0.34), vec3f(0.3, 0.62, 0.5), vnoise(i.wp * 17.0));
    let metal = select(vec3f(0.92, 0.52, 0.32), vec3f(0.95, 0.7, 0.32), m > 4.5);
    lit = sun * kd;
    let patina = verd * (lit + amb) + heroEnv(R, i.wp) * 0.05;
    let shiny = metal * (heroEnv(R, i.wp) * 0.7 + sun * (pow(max(dot(R, L), 0.0), 50.0) * 4.0 + kd * 0.25) + amb * 0.25);
    col = mix(patina, shiny, rubbed);
  } else {
    // ceramic (white glaze with a whiplash inlaid in gold), teal glaze, a mosaic floor, moss
    var albedo = vec3f(0.72, 0.7, 0.64) * (0.95 + 0.08 * vnoise(i.wp * 7.0));
    var gloss = 0.85;
    if (m > 2.5 && m < 3.5) { albedo = vec3f(0.035, 0.28, 0.28) * (0.9 + 0.2 * vnoise(i.wp * 5.0)); }
    if (m > 5.5 && m < 6.5) {
      let mn = vnoise(i.wp * 6.0);
      albedo = mix(vec3f(0.035, 0.09, 0.02), vec3f(0.16, 0.3, 0.06), mn);
      let fc = vec2i(floor(i.wp.xz * 9.0));
      let fh = hash2i(fc + vec2i(11, 3));
      let fd = length(fract(i.wp.xz * 9.0) - 0.5);
      albedo = mix(albedo, heroPetal(fract(fh * 7.3)), step(0.82, fh) * smoothstep(0.24, 0.14, fd));
      gloss = 0.0;
    }
    if (m > 8.5 && m < 9.5) {
      // the floor: a lotus of glazed tesserae, teal and gold on white, round the fountain
      let r = i.r;
      let a = i.uv.x * 6.2831853;
      let pet = abs(fract(a * 8.0 / 6.2831853) - 0.5);
      let petal = step(pet * r * 1.6, 0.42 * sin(3.1415927 * clamp((r - 1.7) / 1.1, 0.0, 1.0)));
      let tess = vnoise(i.wp * 30.0);
      albedo = mix(vec3f(0.75, 0.72, 0.64), mix(vec3f(0.04, 0.3, 0.3), vec3f(0.95, 0.7, 0.3), step(2.35, r)), petal * step(1.7, r));
      albedo *= 0.88 + 0.12 * tess;
      gloss = 0.4;
    }
    lit = sun * kd;
    col = albedo * (lit + amb);
    let F = (0.05 + 0.95 * pow(1.0 - max(dot(N, V), 0.0), 5.0)) * gloss;
    col = col * (1.0 - F) + (heroEnv(R, i.wp) * 0.9 + sun * pow(max(dot(R, L), 0.0), 220.0) * 6.0) * F;
  }
  col += heroRim(N, V);
  col = heroUnder(col, i.wp, lit * 0.5);
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

// ---------------------------------------------------------------- the jets (the glow pass)
struct JOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) bright: vec3f,
}

/** a fountain's droplets: items[i] (x, the spout's top, z, how high the jet rises); with SPILL a ring: (x, the rim's
 *  height, z, its radius), the water falling off it to `drop` m below (a second vec4: drop, -, -, -) */
@vertex fn vs_jet(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> JOut {
  var o: JOut;
  let g = 9.8;
  let h = rnd3(ii * 13u + 7u);
  let t = heroT();
  var p = vec3f(0.0);
  var vel = vec3f(0.0);
  var alive = 1.0;
  var leap = 1.0;
  if (SPILL == 1u) {
    let J = items[(ii / PER) * 2u];
    let D = items[(ii / PER) * 2u + 1u];
    // (off the rim all round, a little outward, falling the drop to the bowl below)
    let a = h.z * 6.2831853;
    let dir = vec3f(cos(a), 0.0, sin(a));
    let v0 = 0.25 + 0.15 * h.x;
    let life = sqrt(2.0 * D.x / g) * 1.05;
    let age = fract(t / life + h.y) * life;
    p = J.xyz + dir * (J.w + v0 * age) + vec3f(0.0, -0.5 * g * age * age, 0.0);
    vel = dir * v0 + vec3f(0.0, -g * age, 0.0);
    alive = select(1.0, 0.0, p.y < J.y - D.x);
  } else {
    let J = items[ii / PER];
    let vy = sqrt(2.0 * g * J.w) * (0.92 + 0.1 * h.x);
    let arc = (ii % 5u) != 0u;
    let life = 2.0 * vy / g * select(1.0, 1.25, arc);
    let age = fract(t / life + h.y) * life;
    let a = select(h.z * 6.2831853, (f32(ii % 6u) + 0.5 + (h.z - 0.5) * 0.15) * 1.0471976, arc);
    let spread = vec2f(cos(a), sin(a)) * select(0.05 + 0.06 * h.x, 0.75 / life, arc);
    leap = 1.0 + 1.0 * answerLift(WORLD, J.xyz);
    p = J.xyz + vec3f(spread.x * age, (vy * age - 0.5 * g * age * age) * leap, spread.y * age);
    vel = vec3f(spread.x, vy - g * age, spread.y);
    alive = select(1.0, 0.0, p.y < J.y - 0.85);
  }
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  // (large: the hero stands 15 to 25 m from the duel's eye)
  let size = 0.03 + 0.026 * h.x;
  let sv = normalize(vel - frame.camFwd * dot(vel, frame.camFwd) + vec3f(0.0, 1e-4, 0.0));
  let sx = normalize(cross(sv, frame.camFwd));
  o.pos = frame.viewProj * vec4f(p + sx * c.x * size + sv * c.y * size * 2.5, 1.0);
  o.uv = c;
  let V = normalize(frame.camPos - p);
  let glint = pow(max(dot(-V, heroSunDir()), 0.0), 6.0);
  o.bright = (heroSun() * (0.14 + 0.9 * glint) * leap + heroAmb(vec3f(0.0, 1.0, 0.0), 1.0, p) * 0.3) * alive * (1.0 - decorFade(p));
  return o;
}

@fragment fn fs_jet(i: JOut) -> @location(0) vec4f {
  let k = exp(-dot(i.uv, i.uv) * 3.0);
  return vec4f(i.bright * k * vec3f(0.92, 0.98, 1.0), 0.0);
}
