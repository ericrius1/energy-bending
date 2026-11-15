// The Pool's edge (edge.ts lays it out, report 18): what stands round the duel's water at the height of the bodies, so
// the duel's camera, wherever it turns, has the garden's built things in its frame and not only the floor: a glass-and-
// brass pavilion behind the stage, trellis arches of brass in glazed tubs with a flowering vine over them, fountains in
// glazed basins, and sailcloth shades on brass masts, lit through by the low sun. Each part made from the vertex index,
// one draw per shape, every draw binding its own list as `items`:
//   vs_lathe  a body turned round its axis from a profile (the pavilion's plinth, ring beam and dome; a basin; a tub),
//             each segment of the profile its own material (ceramic, brass, glass, glaze, water; or nothing)
//   vs_tube   a straight tube from a to b (columns, posts, the arches' curves in pieces, masts, spouts)
//   vs_leaf   a leaf or a flower on the vines, a card cut to its shape in the fragment shader
//   vs_sail   a triangle of sailcloth, billowing
//   vs_jet    (the glow pass) the fountains' droplets, additive
// Lit as the stones are (pool.wgsl: the low sun, the sky and the water mirrored, poolGlaze, poolBrass). Decoration, not
// solid (it stands outside the arena's water, past the bodies' reach): near the eye or across the line of sight to a
// body it fades by the near fade's dither (decorDrop, worlds/light.wgsl).
#include "weft/frame"
#include "../light"

@group(1) @binding(0) var<storage, read> items: array<vec4f>;

/** around a lathe, points in its profile; segments round a tube */
const AROUND: u32 = 28u;
const STEPS: u32 = 16u;
const TUBE: u32 = 8u;
/** droplets a fountain throws */
override PER: u32 = 120u;

/** the materials */
const M_CERAMIC: f32 = 0.0;
const M_BRASS: f32 = 1.0;
const M_GLASS: f32 = 2.0;
const M_TEAL: f32 = 3.0;
const M_WATER: f32 = 4.0;
const M_AMBER: f32 = 5.0;
const M_MOSS: f32 = 6.0;
const M_LEAF: f32 = 7.0;
const M_FLOWER: f32 = 8.0;
const M_SAIL: f32 = 9.0;
const M_NONE: f32 = 10.0;

/** the profiles: (radius, height, the material of the segment from this point to the next) */
const PROFILES = array<vec3f, 48>(
  // (each walked with its outside on the left, so the normal is the segment turned a quarter to the left)
  // 0 the pavilion: its floor and plinth, (a gap), the finial, the glass dome down to the ring beam
  vec3f(0.0, 0.36, M_CERAMIC), vec3f(3.3, 0.36, M_BRASS), vec3f(3.45, 0.3, M_TEAL), vec3f(3.45, 0.1, M_TEAL),
  vec3f(3.3, -0.4, M_NONE), vec3f(0.0, 6.9, M_BRASS), vec3f(0.12, 6.5, M_BRASS), vec3f(0.36, 6.22, M_GLASS),
  vec3f(1.06, 6.06, M_GLASS), vec3f(1.78, 5.7, M_GLASS), vec3f(2.45, 5.1, M_GLASS), vec3f(2.92, 4.3, M_GLASS),
  vec3f(3.1, 3.4, M_BRASS), vec3f(3.3, 3.32, M_BRASS), vec3f(3.36, 3.12, M_BRASS), vec3f(3.18, 3.0, M_NONE),
  // 1 a fountain's basin: its water, a brass lip, the bowl in teal glaze to a white foot in the water
  vec3f(0.0, 0.5, M_WATER), vec3f(0.78, 0.5, M_BRASS), vec3f(0.84, 0.58, M_BRASS), vec3f(0.9, 0.56, M_TEAL),
  vec3f(0.88, 0.36, M_TEAL), vec3f(0.66, 0.14, M_CERAMIC), vec3f(0.32, 0.04, M_CERAMIC), vec3f(0.3, -0.35, M_NONE),
  vec3f(0.3, -0.35, M_NONE), vec3f(0.3, -0.35, M_NONE), vec3f(0.3, -0.35, M_NONE), vec3f(0.3, -0.35, M_NONE),
  vec3f(0.3, -0.35, M_NONE), vec3f(0.3, -0.35, M_NONE), vec3f(0.3, -0.35, M_NONE), vec3f(0.3, -0.35, M_NONE),
  // 2 a tub: moss in it, a brass rim, amber glaze down into the water
  vec3f(0.0, 0.42, M_MOSS), vec3f(0.27, 0.42, M_BRASS), vec3f(0.31, 0.46, M_AMBER), vec3f(0.35, 0.4, M_AMBER),
  vec3f(0.37, 0.12, M_AMBER), vec3f(0.3, -0.3, M_NONE), vec3f(0.3, -0.3, M_NONE), vec3f(0.3, -0.3, M_NONE),
  vec3f(0.3, -0.3, M_NONE), vec3f(0.3, -0.3, M_NONE), vec3f(0.3, -0.3, M_NONE), vec3f(0.3, -0.3, M_NONE),
  vec3f(0.3, -0.3, M_NONE), vec3f(0.3, -0.3, M_NONE), vec3f(0.3, -0.3, M_NONE), vec3f(0.3, -0.3, M_NONE),
);

struct EOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,                         // a lathe: (round it 0 … 1, up its profile); a leaf: (-1 … 1)²; a sail: barycentric
  @location(3) @interpolate(flat) info: vec4f,    // material, seed, a tint, -
}

fn emit(o: ptr<function, EOut>, wp: vec3f, n: vec3f) {
  (*o).pos = frame.viewProj * vec4f(wp, 1.0);
  (*o).wp = wp;
  (*o).n = n;
}

const QUAD = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));

/** a lathe: items[2i] (x, y, z of its foot, scale), items[2i + 1] (profile, turn, seed, -) */
@vertex fn vs_lathe(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> EOut {
  var o: EOut;
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
  // (the normal: across the segment's slope in the profile)
  let P0 = PROFILES[prof + seg];
  let P1 = PROFILES[prof + min(seg + 1u, STEPS - 1u)];
  let t2 = vec2f(P1.x - P0.x, P1.y - P0.y);
  let n2 = normalize(vec2f(-t2.y, t2.x) + vec2f(1e-5, 0.0));
  let wp = A.xyz + (dir * P.x + vec3f(0.0, P.y, 0.0)) * A.w;
  emit(&o, wp, normalize(dir * n2.x + vec3f(0.0, n2.y, 0.0)));
  o.uv = vec2f(a / 6.2831853, P.y);
  o.info = vec4f(mat, B.z, 0.0, 0.0);
  // (a segment of nothing: collapsed, so it draws nothing)
  if (mat > 9.5) { o.pos = vec4f(0.0, 0.0, 2.0, 1.0); }
  return o;
}

/** a tube: items[2i] (a, radius), items[2i + 1] (b, material) */
@vertex fn vs_tube(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> EOut {
  var o: EOut;
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
  o.uv = vec2f(f32(q) / f32(TUBE), c.y);
  o.info = vec4f(B.w, f32(ii) * 0.137, 0.0, 0.0);
  return o;
}

/** a leaf or a flower: items[3i] (where, size), items[3i + 1] (which way it points from the vine, kind: 0 a leaf, 1 a
 *  flower), items[3i + 2] (seed, tint, -, -) */
@vertex fn vs_leaf(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> EOut {
  var o: EOut;
  let A = items[ii * 3u];
  let B = items[ii * 3u + 1u];
  let C = items[ii * 3u + 2u];
  let c = QUAD[vi % 6u] * 2.0 - 1.0;
  let t = worldLight.pool.march.z;
  let flower = B.w > 0.5;
  let out = normalize(B.xyz);
  // a leaf hangs from its stalk out and down a little; a flower faces out and up
  let side = normalize(cross(out, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4, 0.0, 0.0));
  let flutter = sin(t * 2.3 + C.x * 30.0) * 0.12;
  var along = normalize(out + vec3f(0.0, select(-0.45, 0.2, flower), 0.0) + side * flutter);
  var across = normalize(cross(along, select(vec3f(0.0, 1.0, 0.0), out, flower)) + vec3f(1e-4, 0.0, 0.0));
  var n = normalize(cross(across, along));
  if (flower) {
    // (a head: a disc facing out and up, its centre at the vine)
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

/** a sail: items[3i], [3i + 1], [3i + 2] its corners (w: how far it billows, a seed, its tint) */
@vertex fn vs_sail(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> EOut {
  var o: EOut;
  let P0 = items[ii * 3u];
  let P1 = items[ii * 3u + 1u];
  let P2 = items[ii * 3u + 2u];
  // a triangle cut into rows: row r has 2r + 1 small triangles
  let ROWS = 6u;
  let tri = vi / 3u;
  let k = vi % 3u;
  var r = 0u;
  var first = 0u;
  for (var j = 0u; j < ROWS; j++) { if (tri >= first + 2u * j + 1u) { first += 2u * j + 1u; r = j + 1u; } }
  let m = tri - first;
  let up = (m % 2u) == 1u;
  let col = m / 2u;
  var b = vec2f(0.0);
  // (barycentric: s down from P0 toward the P1–P2 edge, u across it)
  let fr = f32(r);
  let fc = f32(col);
  if (!up) {
    b = select(select(vec2f(fr + 1.0, fc + 1.0), vec2f(fr + 1.0, fc), k == 1u), vec2f(fr, fc), k == 0u);
  } else {
    b = select(select(vec2f(fr + 1.0, fc + 1.0), vec2f(fr, fc + 1.0), k == 1u), vec2f(fr, fc), k == 0u);
  }
  let s = b.x / f32(ROWS);
  let u = select(b.y / max(b.x, 1.0), 0.0, b.x < 0.5);
  let edge = mix(P1.xyz, P2.xyz, u);
  var p = mix(P0.xyz, edge, s);
  // (the billow: out along the sail's normal, most in its middle, breathing with the air)
  let nrm = normalize(cross(P1.xyz - P0.xyz, P2.xyz - P0.xyz));
  let t = worldLight.pool.march.z;
  let belly = s * (1.0 - s) * 4.0 * (u * (1.0 - u) * 4.0 * 0.6 + 0.4) * P0.w * (0.85 + 0.15 * sin(t * 0.7 + P1.w * 6.0));
  p += nrm * belly;
  emit(&o, p, nrm);
  o.uv = vec2f(s, u);
  o.info = vec4f(M_SAIL, P1.w, P2.w, 0.0);
  return o;
}

/** the colour of a material at a point (albedo) */
fn edgeAlbedo(m: f32, info: vec4f, uv: vec2f, wp: vec3f) -> vec3f {
  if (m < 0.5) { return vec3f(0.62, 0.58, 0.5) * (0.94 + 0.08 * vnoise(wp * 7.0)); }
  if (m < 1.5) { return vec3f(0.95, 0.66, 0.28); }
  if (m < 3.5 && m > 2.5) { return vec3f(0.04, 0.3, 0.3) * (0.9 + 0.2 * vnoise(wp * 5.0)); }
  if (m > 4.5 && m < 5.5) { return mix(vec3f(0.36, 0.17, 0.065), vec3f(0.22, 0.08, 0.03), smoothstep(0.4, 0.1, wp.y)); }
  if (m > 5.5 && m < 6.5) { return mix(vec3f(0.03, 0.06, 0.018), vec3f(0.085, 0.13, 0.03), vnoise(wp * 9.0)); }
  return vec3f(0.5);
}

/** a flower's petals by k (cream, sun gold, coral, peach) */
fn edgePetal(k: f32) -> vec3f {
  if (k < 0.3) { return vec3f(0.95, 0.9, 0.78); }
  if (k < 0.55) { return vec3f(1.0, 0.72, 0.2); }
  if (k < 0.82) { return vec3f(1.0, 0.45, 0.32); }
  return vec3f(1.0, 0.66, 0.5);
}

@fragment fn fs(i: EOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (decorDrop(i.wp, i.pos.xy)) { discard; }
  let m = i.info.x;
  var N = normalize(i.n);
  let V = normalize(frame.camPos - i.wp);
  if (!front && (m > 6.5)) { N = -N; }
  let K = worldLight.pool.key;
  let sun = worldLight.pool.keyCol.rgb * K.w;
  let kd = max(dot(N, K.xyz), 0.0);
  let ao = smoothstep(-0.4, 0.8, i.wp.y);
  let amb = poolAmbient(N, ao);
  var col = vec3f(0.0);
  if (m > 6.5 && m < 8.5) {
    // a leaf (a pointed oval from its stalk) or a flower (petals round a gold disc), lit through by the low sun
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
      albedo = mix(edgePetal(i.info.z), vec3f(0.85, 0.5, 0.06), disc);
      through = 0.9 * (1.0 - disc);
    }
    let back = (pow(max(dot(-V, K.xyz), 0.0), 3.0) + max(-dot(N, K.xyz), 0.0) * 0.5) * through;
    col = albedo * (sun * (kd + back) + amb + worldFire(i.wp, N));
  } else if (m > 8.5 && m < 9.5) {
    // sailcloth: cream and sun gold in panels, a brass-coloured hem, the low sun glowing through it from behind
    let panel = fract(i.uv.y * 4.0 + i.uv.x * 0.3);
    var albedo = select(vec3f(0.92, 0.84, 0.66), vec3f(0.95, 0.66, 0.26), (i32(floor(i.uv.y * 4.0 + i.uv.x * 0.3)) & 1) == 1 && i.info.z > 0.5);
    albedo *= 1.0 - 0.25 * smoothstep(0.03, 0.0, min(panel, 1.0 - panel));
    albedo = mix(albedo, vec3f(0.8, 0.55, 0.22), smoothstep(0.94, 0.97, i.uv.x));
    let back = max(-dot(N, K.xyz), 0.0) * 0.9 + pow(max(dot(-V, K.xyz), 0.0), 4.0) * 0.6;
    col = albedo * (sun * (kd * 0.8 + back) + amb);
  } else if (m > 1.5 && m < 2.5) {
    // the dome's glass: brass ribs (sixteen round it, rings up it); the panes mirror the sky and the sun, and through
    // them the warm green of the plants inside, lit from above
    let rib = max(smoothstep(0.035, 0.012, abs(fract(i.uv.x * 16.0) - 0.5) * 2.0 * 0.5 - 0.46) , smoothstep(0.03, 0.0, abs(fract(i.uv.y * 2.4) - 0.5) - 0.47));
    let R = reflect(-V, N);
    let F = 0.08 + 0.92 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
    let inside = mix(vec3f(0.06, 0.13, 0.05), vec3f(0.35, 0.3, 0.12), vnoise(i.wp * 2.3)) * (sun * 0.25 + amb * 0.6);
    let glint = pow(max(dot(R, K.xyz), 0.0), 300.0) * 12.0;
    let env = poolEnv(R, i.wp);
    col = inside * (1.0 - F) + (env + sun * glint) * F;
    // (the sun behind the dome, seen through its glass: a gold glow round the far panes)
    col += sun * vec3f(1.0, 0.75, 0.4) * pow(max(dot(-V, K.xyz), 0.0), 6.0) * 0.35 * (1.0 - F);
    col = mix(col, poolBrass(N, V, env, amb, kd), rib);
  } else if (m > 3.5 && m < 4.5) {
    // a basin's water: clear, rippled by the jet falling in, the sky in it
    let t = worldLight.pool.march.z;
    let rr = length(i.wp.xz - floor(i.wp.xz) - 0.5);
    let wn = normalize(vec3f(sin(i.uv.y * 40.0 + t * 4.0 + i.uv.x * 30.0) * 0.08, 1.0, cos(i.uv.x * 50.0 - t * 3.0) * 0.08));
    let R = reflect(-V, wn);
    let F = 0.05 + 0.95 * pow(1.0 - max(dot(wn, V), 0.0), 5.0);
    col = mix(worldLight.pool.deep.rgb * 1.6 + vec3f(0.05, 0.2, 0.18) * sun * 0.2, poolEnv(R, i.wp), F) + sun * pow(max(dot(R, K.xyz), 0.0), 400.0) * 6.0 + rr * 0.0;
  } else if (m > 0.5 && m < 1.5) {
    col = poolBrass(N, V, poolEnv(reflect(-V, N), i.wp), amb, kd);
  } else {
    let albedo = edgeAlbedo(m, i.info, i.uv, i.wp);
    col = albedo * (sun * kd + amb + worldFire(i.wp, N));
    if (m < 0.5 || (m > 2.5 && m < 3.5) || (m > 4.5 && m < 5.5)) { col = poolGlaze(col, N, V, poolEnv(reflect(-V, N), i.wp), 0.85); }
  }
  // the sun behind round every silhouette
  let rimL = pow(1.0 - max(dot(N, V), 0.0), 4.0) * max(dot(-V, worldLight.pool.glowDir.xyz) * 0.5 + 0.5, 0.0);
  col += worldLight.pool.glow.rgb * worldLight.pool.glow.w * rimL * 0.2;
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}

struct JOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) bright: vec3f,
}

/** the fountains' droplets: items[i] (x, the spout's top, z, how high the jet rises) */
@vertex fn vs_jet(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> JOut {
  var o: JOut;
  let J = items[ii / PER];
  let h = rnd3(ii * 13u + 7u);
  let g = 9.8;
  let vy = sqrt(2.0 * g * J.w) * (0.92 + 0.1 * h.x);
  // (four arcs from the spout's cup out over the bowl, and a plume up the middle)
  let arc = (ii % 5u) != 0u;
  let life = 2.0 * vy / g * select(1.0, 1.15, arc);
  let t = worldLight.pool.march.z;
  let age = fract(t / life + h.y) * life;
  let a = select(h.z * 6.2831853, (f32(ii % 4u) + 0.5 + (h.z - 0.5) * 0.15) * 1.5707963, arc);
  let spread = vec2f(cos(a), sin(a)) * select(0.05 + 0.06 * h.x, 0.62 / life, arc);
  let p = vec3f(J.x, J.y, J.z) + vec3f(spread.x * age, vy * age - 0.5 * g * age * age, spread.y * age);
  let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[vi];
  // (larger than the temple's: the rim stands 10 to 15 m from the duel's eye)
  let size = 0.028 + 0.024 * h.x;
  let vel = vec3f(spread.x, vy - g * age, spread.y);
  let sv = normalize(vel - frame.camFwd * dot(vel, frame.camFwd) + vec3f(0.0, 1e-4, 0.0));
  let sx = normalize(cross(sv, frame.camFwd));
  o.pos = frame.viewProj * vec4f(p + sx * c.x * size + sv * c.y * size * 2.5, 1.0);
  o.uv = c;
  let sun = worldLight.pool.keyCol.rgb * worldLight.pool.key.w;
  let V = normalize(frame.camPos - p);
  let glint = pow(max(dot(-V, worldLight.pool.key.xyz), 0.0), 6.0);
  // (gone below the bowl's water; dim past the near fade's reach, faded as the decorations are)
  o.bright = (sun * (0.16 + 0.9 * glint) + poolAmbient(vec3f(0.0, 1.0, 0.0), 1.0) * 0.3) * smoothstep(0.0, 0.04, age) * select(1.0, 0.0, p.y < J.y - 0.75) * (1.0 - decorFade(p));
  return o;
}

@fragment fn fs_jet(i: JOut) -> @location(0) vec4f {
  let k = exp(-dot(i.uv, i.uv) * 3.0);
  return vec4f(i.bright * k * vec3f(0.92, 0.98, 1.0), 0.0);
}
