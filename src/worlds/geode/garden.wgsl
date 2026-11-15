// The greenhouse's planting (phase 5, report 18; geode/garden.ts lays it out): plants with real silhouettes, where phase
// 4 had moss and vines painted on the stone. Each plant is one leaf card or frond, a ribbon bent along its length and
// cut to its shape in the fragment shader: a fern's frond arching out of its clump, its leaflets in pairs; a broad leaf
// (a philodendron's heart) on a curving stalk; a trailing vine hanging down over an edge, its small heart-shaped leaves
// either side in turn; a flower's stem with its bloom opening at the top, turned to the eye (cream, coral, sun gold,
// pale rose). Lit by the geode's light (the softbox through its water, the room, the wells' sun), the sun glowing
// through a leaf from behind it, a little gloss. And the planters they grow in (vs_pot, fs_pot): bowls of white glazed
// ceramic with a brass rim and a band of copper gone green, a disc of earth and moss inside. Decoration, not solids:
// the near fade drops them by `decorDrop` where they would stand in the lens or in front of a dancer.
#include "weft/frame"
#include "../light"

struct Plant {
  at: vec4f,     // where it grows from; w: its kind (0 a fern frond, 1 a broad leaf, 2 a trailing vine, 3 a flower)
  dir: vec4f,    // its turn about up (rad), how far it rises from level at its foot (rad), its length (m), its width (m)
  look: vec4f,   // x: a seed, y: its colour (a flower's: 0 cream, 1 coral, 2 sun gold, 3 pale rose), z: how far it droops (rad), w: -
}

struct Pot {
  at: vec4f,     // the middle of its foot; w: its radius at the belly
  look: vec4f,   // x: its height, y: a seed, z, w: -
}

@group(1) @binding(0) var<storage, read> plants: array<Plant>;
@group(1) @binding(1) var<storage, read> pots: array<Pot>;

override FIRST: u32 = 0u;
/** segments along a leaf card */
const SEGS: u32 = 8u;

struct GOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,                         // x: across it (-1 … 1), y: along it (0 its foot … 1 its tip)
  @location(3) @interpolate(flat) info: vec4f,    // kind, seed, colour, the bloom (1: this is the flower's head)
}

const GD_LEAF = vec3f(0.3, 0.56, 0.16);
const GD_FRESH = vec3f(0.56, 0.78, 0.22);
const GD_DEEP = vec3f(0.12, 0.3, 0.1);

/** the air on a leaf: a slow sway and a flutter, more toward its tip */
fn gdSway(s: f32, seed: f32) -> vec3f {
  let t = frame.time;
  return vec3f(sin(t * 0.9 + seed * 17.0), 0.0, cos(t * 0.7 + seed * 11.0)) * 0.025 * s * s + vec3f(0.0, sin(t * 2.3 + seed * 29.0 + s * 3.0) * 0.008 * s, 0.0);
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  var o: GOut;
  let P = plants[FIRST + ii];
  let kind = P.at.w;
  let seed = P.look.x;
  let L = P.dir.z;
  let W = P.dir.w;
  let h = vec3f(sin(P.dir.x), 0.0, cos(P.dir.x));
  let side0 = vec3f(h.z, 0.0, -h.x);
  let up = vec3f(0.0, 1.0, 0.0);
  o.info = vec4f(kind, seed, P.look.y, 0.0);
  if (vi >= SEGS * 6u) {
    // the flower's head: a disc turned to the eye at the top of its stem (other kinds: nothing)
    if (kind < 2.5) { o.pos = vec4f(0.0, 0.0, -2.0, 1.0); return o; }
    let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi % 6u];
    let top = P.at.xyz + (h * cos(P.dir.y) + up * sin(P.dir.y)) * L + gdSway(1.0, seed) * L;
    let toEye = normalize(frame.camPos - top);
    let rx = normalize(cross(up, toEye) + vec3f(1e-4, 0.0, 0.0));
    let ry = cross(toEye, rx);
    let r = W * 2.2;
    let wp = top + (rx * c.x + ry * c.y) * r;
    o.wp = wp;
    o.n = normalize(toEye + up * 0.6);
    o.uv = c;
    o.info.w = 1.0;
    o.pos = frame.viewProj * vec4f(wp, 1.0);
    return o;
  }
  let seg = vi / 6u;
  let cr = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi % 6u];
  let s = (f32(seg) + cr.y) / f32(SEGS);
  var c = P.at.xyz;
  var tan = h;
  var side = side0;
  if (kind > 1.5 && kind < 2.5) {
    // a vine: straight down from its edge, swaying; its leaves turned to the eye about the stem
    c = P.at.xyz - up * s * L + vec3f(sin(s * 7.0 + seed * 20.0), 0.0, cos(s * 5.0 + seed * 9.0)) * 0.04 * s + gdSway(s, seed) * 2.0;
    tan = -up;
    let toEye = frame.camPos - c;
    side = normalize(vec3f(-toEye.z, 0.0, toEye.x) + vec3f(1e-4, 0.0, 0.0));
  } else {
    // a frond, a leaf or a stem: rising from its foot and bending over (its angle falls by `droop` along it), walked in
    // a few steps to here
    let n = 6;
    let ds = s / f32(n);
    for (var k = 0; k < n; k++) {
      let a = P.dir.y - P.look.z * pow((f32(k) + 0.5) * ds, 1.4);
      c += (h * cos(a) + up * sin(a)) * L * ds;
    }
    let a = P.dir.y - P.look.z * pow(s, 1.4);
    tan = h * cos(a) + up * sin(a);
    c += gdSway(s, seed) * L;
    // (a twist along it, so a frond isn't a flat board)
    let tw = (seed - 0.5) * 0.8 * s;
    side = normalize(side0 * cos(tw) + cross(tan, side0) * sin(tw));
  }
  // its width along it: a frond tapers to its tip, a leaf swells and narrows, a stem stays thin
  var w = W;
  if (kind > 2.5) { w = W * 0.12; }
  let wp = c + side * cr.x * w;
  o.wp = wp;
  o.n = normalize(cross(tan, side));
  o.uv = vec2f(cr.x, s);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

/** a heart-shaped leaf at q (0 its stem's end, y along it to 1 its tip, x across): 1 inside */
fn gdHeart(q: vec2f) -> f32 {
  let t = clamp(q.y, 0.0, 1.0);
  let w = 0.62 * sin(3.14159 * pow(t, 0.62)) * (1.0 + 0.25 * smoothstep(0.25, 0.0, t));
  let notch = smoothstep(0.0, 0.12, q.y + abs(q.x) * 0.5 - 0.06);
  return step(abs(q.x), w) * step(0.0, q.y) * step(q.y, 1.0) * notch;
}

@fragment fn fs(i: GOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (decorDrop(i.wp, i.pos.xy)) { discard; }
  let kind = i.info.x;
  let seed = i.info.y;
  let x = i.uv.x;
  let s = i.uv.y;
  var albedo = GD_LEAF;
  var cover = 0.0;
  var gloss = 0.15;
  var vein = 0.0;
  if (i.info.w > 0.5) {
    // a bloom: petals round a heart, cream, coral, sun gold or pale rose
    let r = length(i.uv);
    let a = atan2(i.uv.y, i.uv.x) + seed * 6.0;
    let n = select(5.0, 8.0, fract(seed * 7.3) > 0.5);
    let petal = 0.55 + 0.45 * pow(abs(cos(a * n * 0.5)), 0.6);
    cover = step(r, petal * 0.95);
    let k = u32(i.info.z + 0.5) % 4u;
    let pc = array<vec3f, 4>(vec3f(0.98, 0.94, 0.84), vec3f(0.98, 0.5, 0.4), vec3f(1.0, 0.76, 0.28), vec3f(0.98, 0.72, 0.74))[k];
    albedo = mix(pc, pc * vec3f(1.0, 0.85, 0.7), smoothstep(0.2, 0.9, r));
    albedo = mix(albedo, vec3f(1.0, 0.75, 0.2), step(r, 0.22));
    vein = (1.0 - smoothstep(0.0, 0.06, abs(fract(a * n / 6.2831853 + 0.5) - 0.5))) * 0.25 * step(0.25, r);
    gloss = 0.05;
  } else if (kind < 0.5) {
    // a fern frond: a thin rachis, leaflets in pairs angled toward the tip, smaller toward it
    let env = 0.95 * sin(3.14159 * pow(s, 0.65)) * (1.0 - 0.25 * s);
    let n = 15.0;
    let ph = fract(s * n - abs(x) * 0.55 + 0.25);
    let leaflet = step(abs(ph - 0.5), 0.36 * (1.0 - 0.7 * abs(x) / max(env, 1e-3)));
    cover = max(step(abs(x), env) * leaflet, step(abs(x), 0.05));
    albedo = mix(GD_LEAF, GD_FRESH, smoothstep(0.5, 1.0, s) * 0.8 + 0.2 * fract(seed * 13.0));
    vein = step(abs(x), 0.04) * 0.4;
  } else if (kind < 1.5) {
    // a broad leaf on its stalk (the stalk the first fifth): a heart with a pale midrib and its veins
    let q = vec2f(x * 0.95, (s - 0.22) / 0.78);
    cover = max(gdHeart(q), step(abs(x), 0.05) * step(s, 0.26));
    let vv = abs(fract((q.y - abs(q.x) * 0.6) * 6.0) - 0.5);
    vein = (step(abs(x), 0.025) * 0.6 + (1.0 - smoothstep(0.0, 0.05, vv)) * 0.25 * step(0.0, q.y)) * cover;
    albedo = mix(GD_DEEP * 1.4, GD_LEAF, 0.5 + 0.5 * fract(seed * 5.1));
    gloss = 0.5;
  } else if (kind < 2.5) {
    // a trailing vine: its stem, and small heart leaves either side in turn
    let n = 9.0;
    let k = floor(s * n);
    let side = select(-1.0, 1.0, fract(k * 0.5) < 0.25);
    // (each leaf points out from the stem to its side: along it is across the card, across it is along the stem)
    cover = max(gdHeart(vec2f((fract(s * n) - 0.5) * 1.4, x * side * 1.05)), step(abs(x), 0.07));
    albedo = mix(GD_LEAF * 0.9, GD_FRESH * 0.9, fract(k * 0.37 + seed));
    gloss = 0.3;
  } else {
    // a flower's stem
    cover = step(abs(x), 0.9);
    albedo = GD_LEAF * 0.8;
  }
  if (cover < 0.5) { discard; }
  albedo *= 1.0 - vein * 0.35;
  albedo = mix(albedo, albedo * vec3f(1.1, 1.05, 0.8), vein * 0.5 * step(kind, 0.5));
  var N = normalize(i.n);
  if (!front) { N = -N; }
  let V = normalize(frame.camPos - i.wp);
  if (dot(N, V) < 0.0) { N = -N; }
  let L = worldLight.geode;
  let key = worldKey(i.wp, false, 0.0);
  let sunL = -geodeSunDir();
  let sunC = GEO_SUN * L.sun.w;
  let diff = max(dot(N, key.dir), 0.0) * 0.6 + 0.4 * max(dot(N, key.dir) * 0.5 + 0.5, 0.0);
  var col = albedo * (key.col * diff * 0.22 + geodeAmbient(N, 0.8) * 0.16 + sunC * max(dot(N, sunL) * 0.5 + 0.5, 0.0) * 0.12);
  // the light through it from behind (the sun or the softbox on its far side): a leaf glows yellow-green
  let back = max(-dot(N, sunL), 0.0) * 0.5 + max(-dot(N, key.dir), 0.0) * 0.3;
  col += albedo * vec3f(1.1, 1.15, 0.55) * (sunC * 0.16 + key.col * 0.06) * back;
  col += albedo * worldFire(i.wp, N) * 0.6;
  // a little gloss: the softbox and the room in it
  let R = reflect(-V, N);
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  col += (studio(R) * 0.05 + vec3f(1.0, 0.97, 0.9) * pow(max(dot(R, key.dir), 0.0), 60.0) * key.glint * 0.15) * gloss * (0.3 + fres);
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

// ---------------------------------------------------------------- the planters

/** the planter's outline at t (0 its foot … 1 its rim): radius as a share of its belly's, a bowl on a short foot with a
 *  rolled lip */
fn potProfile(t: f32) -> f32 {
  let foot = 0.55 + 0.1 * smoothstep(0.0, 0.08, t);
  let belly = 0.62 + 0.38 * sin(3.14159 * clamp((t - 0.08) / 0.92, 0.0, 1.0) * 0.62 + 0.25);
  let lip = 0.06 * smoothstep(0.88, 0.95, t);
  return select(foot, belly + lip, t > 0.1);
}

struct POut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) t: f32,                            // up it (0 its foot … 1 its rim; 2 the earth inside)
  @location(3) @interpolate(flat) seed: f32,
}

const POT_SIDES: u32 = 20u;
const POT_RINGS: u32 = 8u;

@vertex fn vs_pot(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> POut {
  var o: POut;
  let P = pots[ii];
  let R = P.at.w;
  let H = P.look.x;
  o.seed = P.look.y;
  let quad = vi / 6u;
  let c = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let a = f32(quad % POT_SIDES + c.x) / f32(POT_SIDES) * 6.2831853;
  let ring = quad / POT_SIDES;
  let rad = vec3f(cos(a), 0.0, sin(a));
  if (ring >= POT_RINGS) {
    // the earth inside: a disc a little under the rim
    let rr = f32(c.y) * potProfile(0.94) * R * 0.98;
    let wp = P.at.xyz + vec3f(0.0, H * 0.92, 0.0) + rad * rr;
    o.wp = wp;
    o.n = vec3f(0.0, 1.0, 0.0);
    o.t = 2.0;
    o.pos = frame.viewProj * vec4f(wp, 1.0);
    return o;
  }
  let t = f32(ring + c.y) / f32(POT_RINGS);
  let r = potProfile(t) * R;
  let wp = P.at.xyz + vec3f(0.0, t * H, 0.0) + rad * r;
  let dr = (potProfile(min(t + 0.02, 1.0)) - potProfile(max(t - 0.02, 0.0))) * R / (0.04 * H);
  o.wp = wp;
  o.n = normalize(rad - vec3f(0.0, dr, 0.0));
  o.t = t;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

@fragment fn fs_pot(i: POut) -> @location(0) vec4f {
  if (decorDrop(i.wp, i.pos.xy)) { discard; }
  let L = worldLight.geode;
  let V = normalize(frame.camPos - i.wp);
  let N = normalize(i.n);
  let key = worldKey(i.wp, false, 0.0);
  let sunL = -geodeSunDir();
  let sunC = GEO_SUN * L.sun.w;
  if (i.t > 1.5) {
    // earth and moss
    let m = vnoise(i.wp * 14.0);
    let soil = mix(vec3f(0.06, 0.04, 0.025), GEO_MOSS * 1.4, smoothstep(0.35, 0.6, m));
    return vec4f(soil * (key.col * 0.15 + geodeAmbient(N, 0.6) * 0.15 + sunC * 0.05), dot(i.wp - frame.camPos, frame.camFwd));
  }
  // white glaze; a brass rim; a band of copper gone green round the belly, with leaves of glaze in it
  let rim = smoothstep(0.86, 0.88, i.t);
  let band = smoothstep(0.42, 0.44, i.t) * smoothstep(0.62, 0.6, i.t);
  let a = atan2(i.wp.z, i.wp.x);
  var albedo = vec3f(0.95, 0.93, 0.88);
  let leafy = smoothstep(0.25, 0.1, abs(fract(a * 3.0 + i.seed) - 0.5) - abs(i.t - 0.52) * 1.5);
  albedo = mix(albedo, mix(vec3f(0.3, 0.62, 0.5), vec3f(0.95, 0.9, 0.8), leafy), band);
  let metal = rim;
  let brass = vec3f(0.95, 0.7, 0.34);
  let diff = max(dot(N, key.dir), 0.0);
  let wrapS = max(dot(N, sunL) * 0.6 + 0.4, 0.0);
  var col = albedo * (key.col * diff * 0.18 + geodeAmbient(N, 0.7) * 0.18 + sunC * wrapS * 0.1) * (1.0 - metal);
  col += albedo * worldFire(i.wp, N) * 0.6 * (1.0 - metal);
  let R = reflect(-V, N);
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  let env = studio(R) * 0.2 + geodeWallSoft(i.wp, R) * 1.5;
  let glint = vec3f(1.0, 0.96, 0.9) * (pow(max(dot(R, key.dir), 0.0), 120.0) * key.glint * 0.5 + pow(max(dot(R, sunL), 0.0), 80.0) * sunC.r * 0.25);
  col += (env + glint) * mix(vec3f(fres + 0.03), brass * (0.5 + 0.5 * fres) * 2.0, metal);
  col += brass * metal * (key.col * diff * 0.05 + sunC * wrapS * 0.06);
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}
