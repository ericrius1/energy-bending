// The redwoods' arbour (phase 5, report 18; arbour.ts lays it out): the clearing's landmark, at the height of the
// bodies all round it, so the duel's eye has it behind the pair whichever way it looks. Between each pair of the fairy
// ring's trees an arch of honey wood springs from trunk to trunk (bound to each with brass, banded in brass along it),
// a vine climbing it with heart leaves and small flowers; from each arch hang seed-pod lanterns of solar glass in brass
// ribs, which have drunk the day and glow amber as it goes. Round the trees' feet and the stumps', fungi: pale caps on
// cream stems that glow teal-green after dusk, breathing. Their halos in the glow pass (vs_halo).
// Decoration, not solids: the near fade drops what would stand in the lens or in front of a dancer (decorDrop).
#include "weft/frame"
#include "../light"

struct Arch {
  a: vec4f,      // one end (on its trunk); w: the arch's radius (m)
  b: vec4f,      // the other end; w: how high its middle rises over the line between them (m)
  look: vec4f,   // x: a seed; y, z, w: -
}
struct Pod {
  at: vec4f,     // where its cord hangs from; w: the cord's length
  look: vec4f,   // x: its radius, y: a seed, z: its glass (0 amber, 1 sun gold, 2 rose), w: 1 a fungus (at: its foot; look.x its cap's radius; at.w its height)
}

@group(1) @binding(0) var<storage, read> arches: array<Arch>;
@group(1) @binding(1) var<storage, read> pods: array<Pod>;

override FIRST: u32 = 0u;
const SEGS: u32 = 28u;
const SIDES: u32 = 6u;
const LEAVES: u32 = 56u;

/** a point of arch k's curve at t (0 … 1), and its way along there */
fn archAt(A: Arch, t: f32) -> vec3f {
  let base = mix(A.a.xyz, A.b.xyz, t);
  // (a pointed, swelling arch: art nouveau's, rising faster than a circle's and drawn up to its crown)
  let rise = pow(sin(3.14159265 * t), 0.75);
  let across = normalize(cross(vec3f(0.0, 1.0, 0.0), A.b.xyz - A.a.xyz));
  return base + vec3f(0.0, A.b.w * rise, 0.0) + across * 0.18 * sin(6.2831853 * t) * (1.0 - rise * 0.5);
}

/** the light of the woods on a surface at p facing n (the sun through the leaves, the soft light under the trees, the
 *  lanterns and the dancers' fire), and the key's colour there */
fn arbourLight(p: vec3f, n: vec3f, wrap: f32) -> vec3f {
  let L = worldLight.forest.key.xyz;
  let key = worldLight.forest.keyCol.rgb * worldLight.forest.key.w * keyLight(p) * 0.3;
  let diff = max((dot(n, L) + wrap) / (1.0 + wrap), 0.0);
  return key * diff + woodsAmbient(n) * 1.4 + lampLight(p, n, wrap) * 0.6;
}

struct AOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,                        // the arch: x round it, y its arc length (m); a leaf: its own card
  @location(3) @interpolate(flat) info: vec4f,   // a seed, a leaf's kind (0 a leaf, 1 a flower), its colour, -
}

// ---------------------------------------------------------------- the arches

@vertex fn vs_arch(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> AOut {
  var o: AOut;
  let A = arches[ii];
  let quad = vi / 6u;
  let c = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let seg = quad / SIDES + c.y;
  let side = quad % SIDES + c.x;
  let t = f32(seg) / f32(SEGS);
  let p = archAt(A, t);
  let tan = normalize(archAt(A, min(t + 0.01, 1.0)) - archAt(A, max(t - 0.01, 0.0)));
  let s1 = normalize(cross(tan, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4, 0.0, 0.0));
  let s2 = cross(s1, tan);
  let a = f32(side) / f32(SIDES) * 6.2831853;
  let rad = s1 * cos(a) + s2 * sin(a);
  // (a little thicker where it springs from the trunk)
  let r = A.a.w * (1.0 + 0.6 * pow(abs(t - 0.5) * 2.0, 6.0));
  let wp = p + rad * r;
  o.wp = wp;
  o.n = rad;
  o.uv = vec2f(a, t * length(A.b.xyz - A.a.xyz) * 1.3);
  o.info = vec4f(A.look.x, 0.0, 0.0, 0.0);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

@fragment fn fs_arch(i: AOut) -> @location(0) vec4f {
  if (decorDrop(i.wp, i.pos.xy)) { discard; }
  let V = normalize(frame.camPos - i.wp);
  let N = normalize(i.n);
  // honey wood, oiled, its grain along it; a band of brass every 70 cm
  let grain = 0.85 + 0.15 * vnoise(vec3f(i.uv.x * 2.0, i.uv.y * 18.0, i.info.x * 9.0));
  let band = smoothstep(0.03, 0.02, abs(fract(i.uv.y / 0.7) - 0.5) * 0.7 - 0.31);
  let wood = vec3f(0.72, 0.44, 0.19) * grain;
  let brass = vec3f(0.95, 0.68, 0.32);
  let R = reflect(-V, N);
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  let L = worldLight.forest.key.xyz;
  let key = worldLight.forest.keyCol.rgb * worldLight.forest.key.w * keyLight(i.wp) * 0.3;
  let env = woodsEnv(R, i.wp);
  let spec = key * pow(max(dot(R, L), 0.0), 50.0);
  var col = wood * arbourLight(i.wp, N, 0.2) + (env * 0.5 + spec * 0.5) * fres;
  let metal = brass * (env * 1.2 + spec * 2.0 + arbourLight(i.wp, N, 0.0) * 0.25);
  col = mix(col, metal, band);
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

// ---------------------------------------------------------------- the vine on them: heart leaves and flowers

@vertex fn vs_leaf(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> AOut {
  var o: AOut;
  let A = arches[ii];
  let k = vi / 6u;
  let c = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi % 6u];
  let h = rnd3(ii * 131u + k * 7u + 3u);
  // along the arch, thicker toward its feet and its crown; winding round it
  let t = clamp((f32(k) + h.x) / f32(LEAVES), 0.02, 0.98);
  let p = archAt(A, t);
  let tan = normalize(archAt(A, min(t + 0.01, 1.0)) - archAt(A, max(t - 0.01, 0.0)));
  let s1 = normalize(cross(tan, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4, 0.0, 0.0));
  let s2 = cross(s1, tan);
  let a = t * 40.0 + h.y * 2.0;
  let out = s1 * cos(a) + s2 * sin(a);
  let flower = h.z > 0.8;
  let size = select(0.09 + 0.07 * h.y, 0.06 + 0.03 * h.y, flower);
  // a leaf hangs a little off its stem: out from the arch and drooping; a flower faces out
  let sway = sin(worldLight.forest.clock.x * 1.3 + h.x * 30.0) * 0.03 * worldLight.forest.wind;
  let dir = normalize(out + vec3f(0.0, -0.6, 0.0) * select(1.0, 0.2, flower) + tan * sway);
  let across = normalize(cross(dir, tan) + vec3f(1e-5, 0.0, 0.0));
  let base = p + out * A.a.w;
  var wp = base + across * c.x * size * 0.6 + dir * c.y * size;
  if (flower) { wp = base + out * 0.03 + (across * c.x + tan * (c.y * 2.0 - 1.0)) * size; }
  o.wp = wp;
  o.n = normalize(cross(across, dir) + out * 0.5);
  o.uv = c;
  o.info = vec4f(h.x, select(0.0, 1.0, flower), h.y, 0.0);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

@fragment fn fs_leaf(i: AOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (decorDrop(i.wp, i.pos.xy)) { discard; }
  var albedo = vec3f(0.0);
  if (i.info.y > 0.5) {
    // a flower: five round petals, cream or coral, a gold heart
    let q = vec2f(i.uv.x, i.uv.y * 2.0 - 1.0);
    let r = length(q);
    let a = atan2(q.y, q.x);
    if (r > 0.6 + 0.4 * abs(cos(a * 2.5))) { discard; }
    albedo = select(vec3f(0.98, 0.94, 0.84), vec3f(0.98, 0.52, 0.42), i.info.z > 0.55);
    albedo = mix(albedo, vec3f(1.0, 0.75, 0.2), step(r, 0.25));
  } else {
    // a heart leaf: its notch at the stem, its tip at the end
    let t = i.uv.y;
    let w = 0.95 * sin(3.14159 * pow(t, 0.62)) * (1.0 + 0.25 * smoothstep(0.25, 0.0, t));
    if (abs(i.uv.x) > w || t + abs(i.uv.x) * 0.4 < 0.08) { discard; }
    albedo = mix(vec3f(0.1, 0.26, 0.06), vec3f(0.26, 0.5, 0.12), i.info.z) * (1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.06, abs(i.uv.x))));
  }
  var N = normalize(i.n);
  if (!front) { N = -N; }
  let V = normalize(frame.camPos - i.wp);
  if (dot(N, V) < 0.0) { N = -N; }
  var col = albedo * arbourLight(i.wp, N, 0.5);
  // the low sun through a leaf from behind
  let L = worldLight.forest.key.xyz;
  col += albedo * vec3f(1.0, 1.1, 0.5) * worldLight.forest.keyCol.rgb * worldLight.forest.key.w * keyLight(i.wp) * 0.1 * pow(max(dot(-V, L), 0.0), 3.0);
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

// ---------------------------------------------------------------- the pod lanterns, and the fungi

/** how strongly a pod glows now: a little by day, fully from dusk, each breathing in its own time */
fn podGlow(seed: f32) -> f32 {
  let dusk = max(worldLight.forest.horizon.w * 1.4, worldLight.forest.night);
  let breathe = 0.85 + 0.15 * sin(worldLight.forest.clock.x * (0.6 + 0.5 * seed) + seed * 40.0);
  return (0.12 + 0.88 * clamp(dusk, 0.0, 1.0)) * breathe;
}

/** a pod's middle now: hung on its cord, swaying */
fn podCentre(P: Pod) -> vec3f {
  let t = worldLight.forest.clock.x;
  let w = worldLight.forest.wind;
  let sway = vec3f(sin(t * 0.9 + P.look.y * 30.0), 0.0, cos(t * 0.7 + P.look.y * 20.0)) * 0.05 * (0.4 + w) * P.at.w;
  return P.at.xyz - vec3f(0.0, P.at.w + P.look.x * 1.3, 0.0) + sway;
}

/** the pod's outline at v (0 its top … 1 its point): a seed, round above and drawn to a point below */
fn podR(v: f32) -> f32 { return sin(3.14159 * pow(v, 0.65)) * (1.0 - 0.25 * v); }
/** a fungus's outline at v (0 its foot … 1 its crown): a stem, then a domed cap */
fn shroomR(v: f32) -> vec2f {
  // (x: radius as a share of the cap's, y: height as a share of the whole)
  if (v < 0.5) { return vec2f(0.22 - 0.05 * v, v * 1.2); }
  let u = (v - 0.5) * 2.0;
  return vec2f(mix(0.3, 1.0, sin(u * 1.5707963)) * (1.0 - smoothstep(0.7, 1.0, u) * (1.0 - cos((1.0 - u) * 1.5707963))), 0.6 + 0.4 * sin(u * 1.5707963) * 0.9);
}

struct POut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) v: f32,                            // down a pod (0 top … 1 point; < 0 its cap; 2 its cord), up a fungus (0 … 1)
  @location(3) @interpolate(flat) info: vec4f,    // the seed, its glass, 1 a fungus, its glow
  @location(4) a: f32,                            // round it (rad)
}

const PSIDES: u32 = 10u;
const PRINGS: u32 = 8u;

@vertex fn vs_pod(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> POut {
  var o: POut;
  let P = pods[FIRST + ii];
  let fungus = P.look.w > 0.5;
  o.info = vec4f(P.look.y, P.look.z, select(0.0, 1.0, fungus), podGlow(P.look.y));
  let lathe = PSIDES * PRINGS * 6u;
  if (vi >= lathe) {
    // a pod's cord (a fungus has none)
    if (fungus) { o.pos = vec4f(0.0, 0.0, -2.0, 1.0); return o; }
    let c = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[(vi - lathe) % 6u];
    let top = P.at.xyz;
    let bot = podCentre(P) + vec3f(0.0, P.look.x * 1.2, 0.0);
    let q = mix(top, bot, c.y);
    let side = normalize(cross(bot - top, frame.camPos - q) + vec3f(1e-5, 0.0, 0.0));
    o.wp = q + side * c.x * 0.006;
    o.n = normalize(frame.camPos - q);
    o.v = 2.0;
    o.pos = frame.viewProj * vec4f(o.wp, 1.0);
    return o;
  }
  let quad = vi / 6u;
  let c = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[vi % 6u];
  let ring = quad / PSIDES + c.y;
  let a = f32(quad % PSIDES + c.x) / f32(PSIDES) * 6.2831853;
  let v = f32(ring) / f32(PRINGS);
  let rad = vec3f(cos(a), 0.0, sin(a));
  var wp = vec3f(0.0);
  var n = rad;
  if (fungus) {
    let s = shroomR(v);
    let s2 = shroomR(min(v + 0.05, 1.0));
    let H = P.at.w;
    wp = P.at.xyz + vec3f(0.0, s.y * H, 0.0) + rad * s.x * P.look.x;
    n = normalize(rad * (s2.y - s.y) * H - vec3f(0.0, (s2.x - s.x) * P.look.x, 0.0) + vec3f(0.0, 0.001, 0.0));
    if (v > 0.5 && dot(n, vec3f(0.0, 1.0, 0.0)) < 0.0) { n = -n; }
  } else {
    let R = P.look.x;
    let m = podCentre(P);
    let r = podR(v) * R;
    wp = m + vec3f(0.0, (0.5 - v) * R * 2.6, 0.0) + rad * r;
    n = normalize(rad + vec3f(0.0, (podR(max(v - 0.05, 0.0)) - podR(min(v + 0.05, 1.0))) * 1.5, 0.0));
  }
  o.wp = wp;
  o.n = n;
  o.v = v;
  o.a = a;
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  return o;
}

@fragment fn fs_pod(i: POut) -> @location(0) vec4f {
  if (decorDrop(i.wp, i.pos.xy)) { discard; }
  let V = normalize(frame.camPos - i.wp);
  var N = normalize(i.n);
  if (dot(N, V) < 0.0) { N = -N; }
  let g = i.info.w;
  if (i.v > 1.5) {
    return vec4f(vec3f(0.05, 0.035, 0.02) * arbourLight(i.wp, N, 0.5), dot(i.wp - frame.camPos, frame.camFwd));
  }
  if (i.info.z > 0.5) {
    // a fungus: a cream stem, a pale cap; after dusk its cap and gills glow teal-green from within
    let cap = step(0.5, i.v);
    let albedo = mix(vec3f(0.8, 0.76, 0.66), vec3f(0.75, 0.82, 0.72), cap);
    var col = albedo * arbourLight(i.wp, N, 0.3);
    let dusk = worldLight.forest.horizon.w;
    let breathe = 0.6 + 0.4 * sin(worldLight.forest.clock.x * (0.5 + i.info.x) + i.info.x * 50.0);
    let spots = 0.7 + 0.3 * vnoise(i.wp * 60.0);
    col += vec3f(0.25, 1.0, 0.72) * (cap * 1.4 + (1.0 - cap) * 0.3) * spots * dusk * breathe * 0.9;
    return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
  }
  // a pod: solar glass between brass ribs, a brass cap at its top; lit from inside, warm, brightest at its belly
  let ribs = 1.0 - smoothstep(0.02, 0.06, abs(fract(i.a / 6.2831853 * 8.0) - 0.5) * 2.0 * 3.14159 / 8.0 * 1.6);
  let capB = smoothstep(0.16, 0.12, i.v);
  let metal = max(ribs * 0.85, capB);
  let k = u32(i.info.y + 0.5) % 3u;
  let glass = array<vec3f, 3>(vec3f(1.0, 0.62, 0.22), vec3f(1.0, 0.8, 0.35), vec3f(1.0, 0.56, 0.45))[k];
  let thick = 1.0 / max(abs(dot(N, V)), 0.25);
  let inner = glass * g * (1.6 + 1.2 * sin(3.14159 * i.v)) * exp(-(thick - 1.0) * vec3f(0.05, 0.25, 0.6));
  let brass = vec3f(0.95, 0.68, 0.32);
  let R = reflect(-V, N);
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  let env = woodsEnv(R, i.wp);
  var col = mix(inner + glass * arbourLight(i.wp, N, 0.5) * 0.4 + env * fres * 0.5, brass * (env * 1.1 + arbourLight(i.wp, N, 0.0) * 0.3 + glass * g * 0.15), metal);
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

// ---------------------------------------------------------------- their halos in the air (the glow pass)

struct HOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) col: vec3f,
  @location(2) wp: vec3f,
}

@vertex fn vs_halo(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> HOut {
  var o: HOut;
  let P = pods[FIRST + ii];
  let fungus = P.look.w > 0.5;
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  var m = vec3f(0.0);
  var size = 0.0;
  var col = vec3f(0.0);
  if (fungus) {
    m = P.at.xyz + vec3f(0.0, P.at.w * 0.9, 0.0);
    size = P.look.x * 3.5;
    col = vec3f(0.12, 0.5, 0.36) * worldLight.forest.horizon.w;
  } else {
    m = podCentre(P);
    size = P.look.x * 5.0;
    let k = u32(P.look.z + 0.5) % 3u;
    col = array<vec3f, 3>(vec3f(1.0, 0.55, 0.18), vec3f(1.0, 0.72, 0.3), vec3f(1.0, 0.5, 0.38))[k] * podGlow(P.look.y) * 0.5;
  }
  o.col = col;
  o.uv = c;
  o.wp = m;
  o.pos = frame.viewProj * vec4f(m + (frame.camRight * c.x + frame.camUp * c.y) * size, 1.0);
  return o;
}

@fragment fn fs_halo(i: HOut) -> @location(0) vec4f {
  let d = dot(i.uv, i.uv);
  if (d > 1.0) { discard; }
  // (fading out near the eye, as the near fade drops the thing itself)
  let near = smoothstep(1.5, 3.0, length(i.wp - frame.camPos));
  return vec4f(i.col * (exp(-d * 6.0) * 0.8 + exp(-d * 2.0) * 0.15) * near, 0.0);
}
