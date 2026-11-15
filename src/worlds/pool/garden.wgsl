// The Pool's water garden (garden.ts): lily pads floating on the water, lotus flowers standing on them, and clumps of
// reeds at the stones' feet and round the far water. Each a small shape made from the vertex index, one draw per kind:
//   vs_pad    a pad: a disc with its notch, a low rim (higher on the giant ones), riding the ripples and a little of the
//             swell (the water's height field, water/ripples.ts, and the swell in the pool's light)
//   vs_lotus  a flower: two rings of petals opening round a golden seed head, on its pad
//   vs_reed   a clump: blades rising out of the water, swaying, some with a cattail's brown head
// Lit by the low sun (pool.wgsl): leaves lit through from behind, the pads' wet sheen mirroring the sky. Decoration,
// not solid: nothing stands on them, and like the redwoods' grass and ferns they don't call the near fade.
#include "weft/frame"
#include "../light"

struct Plant {
  at: vec4f,     // where it stands (x, the water's height, z); w: its turn about up
  size: vec4f,   // x: its radius (a pad, a flower) or height (a reed), y: a pad's rim (m), z: a seed, w: its tint (0 … 1)
}

@group(1) @binding(0) var<storage, read> plants: array<Plant>;

/** segments round a pad, petals in a flower's two rings, blades in a clump and segments up each */
const PAD_SEG = 20u;
const OUTER = 8u;
const INNER = 7u;
const BLADES = 9u;
const BLADE_SEG = 4u;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,                         // a pad: (out from the middle 0 … 1, round it 0 … 1); a petal or a
                                                  // blade: (along it 0 … 1, across it -1 … 1)
  @location(3) @interpolate(flat) info: vec4f,    // kind (0 pad, 1 petal, 2 seed head, 3 blade, 4 cattail), seed, tint, rim
}

/** how high the water stands at xz now: the ripples, and a little of the swell (the surface itself is drawn flat) */
fn waterUp(xz: vec2f) -> f32 {
  return waveHeight(poolWaves, worldLight.pool.waves, xz) * 1.5 + poolSwell(xz).x * 0.3;
}

fn turn(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }

fn place(o: ptr<function, VOut>, wp: vec3f, n: vec3f) {
  (*o).pos = frame.viewProj * vec4f(wp, 1.0);
  (*o).wp = wp;
  (*o).n = n;
}

@vertex fn vs_pad(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let P = plants[ii];
  let R = P.size.x;
  let rim = P.size.y;
  // round it from one side of the notch to the other
  let notch = 0.16 + 0.1 * fract(P.size.z * 7.3);
  let fan = PAD_SEG * 3u;
  var ring = 0.0;
  var seg = 0u;
  var up = 0.0;
  var k = 0u;
  if (vi < fan) {
    seg = vi / 3u; k = vi % 3u;
    ring = select(1.0, 0.0, k == 0u);
    if (k == 2u) { seg += 1u; }
  } else {
    let w = vi - fan;
    seg = w / 6u;
    let c = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[w % 6u];
    seg += c.x;
    ring = 1.0;
    up = f32(c.y);
  }
  let a = notch + (6.2831853 - 2.0 * notch) * f32(seg) / f32(PAD_SEG);
  let dir = vec2f(cos(a + P.at.w), sin(a + P.at.w));
  // (the rim turned up, a little out; the middle a touch higher than the edge, the pad not quite flat)
  let r = R * ring + rim * 0.4 * up;
  let y = P.at.y + 0.012 + rim * up + 0.01 * (1.0 - ring);
  let xz = P.at.xz + dir * r;
  let wp = vec3f(xz.x, y + waterUp(P.at.xz), xz.y);
  let nrm = select(vec3f(0.0, 1.0, 0.0), normalize(vec3f(dir.x, 0.35, dir.y)), vi >= fan);
  place(&o, wp, nrm);
  o.uv = vec2f(ring, f32(seg) / f32(PAD_SEG));
  o.info = vec4f(0.0, P.size.z, P.size.w, up);
  return o;
}

@vertex fn vs_lotus(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let P = plants[ii];
  let L = P.size.x;
  let base = vec3f(P.at.x, P.at.y + 0.02 + waterUp(P.at.xz), P.at.z);
  let petals = OUTER + INNER;
  let per = 18u;
  if (vi >= petals * per) {
    // the seed head: a little golden cone in the middle
    let k = vi - petals * per;
    let s = k / 3u;
    let c = k % 3u;
    let a = f32(s + select(0u, 1u, c == 2u)) / 6.0 * 6.2831853;
    let p = select(vec3f(cos(a) * L * 0.16, L * 0.32, sin(a) * L * 0.16), vec3f(0.0, L * 0.4, 0.0), c == 0u);
    place(&o, base + p, normalize(vec3f(p.x, 0.6, p.z)));
    o.uv = vec2f(0.0);
    o.info = vec4f(2.0, P.size.z, P.size.w, 0.0);
    return o;
  }
  let pi = vi / per;
  let k = vi % per;
  let inner = pi >= OUTER;
  let j = select(pi, pi - OUTER, inner);
  let cnt = select(OUTER, INNER, inner);
  let az = (f32(j) + select(0.0, 0.5, inner)) / f32(cnt) * 6.2831853 + P.at.w;
  // a quad of the petal's three: (along, across)
  let q = k / 6u;
  let c = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[k % 6u];
  let u = (f32(q) + c.x) / 3.0;
  let v = c.y;
  // the petal: from the middle out and up, the outer ring opening wider, curling in a little at the tip
  let len = L * select(1.0, 0.82, inner);
  let tilt = select(0.55, 0.95, inner) + u * 0.5;
  let radial = vec3f(cos(az), 0.0, sin(az));
  let side = vec3f(-sin(az), 0.0, cos(az));
  let wide = len * 0.34 * pow(sin(3.1415927 * min(u * 0.92 + 0.08, 1.0)), 0.7);
  let along = radial * (len * u * cos(tilt)) + vec3f(0.0, len * u * sin(tilt), 0.0);
  // (cupped: the petal's sides a little up)
  let p = along + side * (v * wide) + vec3f(0.0, abs(v) * wide * 0.35, 0.0) + radial * (L * select(0.12, 0.05, inner));
  let n = normalize(radial * -sin(tilt) + vec3f(0.0, cos(tilt), 0.0));
  place(&o, base + p, n);
  o.uv = vec2f(u, v);
  o.info = vec4f(1.0, P.size.z, P.size.w, select(0.0, 1.0, inner));
  return o;
}

@vertex fn vs_reed(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let P = plants[ii];
  let per = BLADE_SEG * 6u;
  let b = vi / per;
  let k = vi % per;
  let q = k / 6u;
  let c = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[k % 6u];
  let u = (f32(q) + c.x) / f32(BLADE_SEG);
  let v = c.y;
  let h0 = fract(sin(f32(b) * 12.9898 + P.size.z * 78.233) * 43758.5453);
  let h1 = fract(h0 * 7.13 + 0.31);
  let h2 = fract(h0 * 3.71 + 0.57);
  let cat = (b % 3u) == 0u;
  // where the blade rises in the clump, how tall, which way it leans and faces, and the wind on it
  let foot = vec2f(cos(h0 * 6.2831853), sin(h0 * 6.2831853)) * (0.06 + 0.16 * h1);
  let H = P.size.x * (0.6 + 0.4 * h2) * select(1.0, 1.12, cat);
  let lean = normalize(vec2f(foot.x, foot.y) + vec2f(0.001)) * (0.12 + 0.2 * h1);
  let t = worldLight.pool.march.z;
  let sway = vec2f(sin(t * 1.1 + h0 * 9.0 + P.at.x * 0.3), cos(t * 0.8 + h1 * 7.0 + P.at.z * 0.3)) * 0.05;
  let bendBy = lean + sway;
  let face = h2 * 6.2831853;
  let across = vec3f(cos(face), 0.0, sin(face));
  // (a blade tapers to its tip; a cattail's head is a brown thickening near the top, its spike above it)
  var w = 0.022 * (1.0 - u * 0.85);
  var kind = 3.0;
  if (cat) {
    // (the top segment is the head: brown, thick at its foot, tapering to the spike)
    w = select(0.008, mix(0.034, 0.012, (u - 0.75) * 4.0), u > 0.74);
    kind = select(3.0, 4.0, q == BLADE_SEG - 1u);
  }
  let p = vec3f(P.at.x + foot.x + bendBy.x * H * u * u, P.at.y - 0.35 + (H + 0.35) * u, P.at.z + foot.y + bendBy.y * H * u * u) + across * (v * w);
  let n = normalize(cross(across, vec3f(bendBy.x * 2.0 * u, 1.0, bendBy.y * 2.0 * u)));
  place(&o, p, n);
  o.uv = vec2f(u, v);
  o.info = vec4f(kind, P.size.z, P.size.w, 0.0);
  return o;
}

/** the sun and the sky on a leaf or a petal (trans: how much it lets the sun through from behind) */
fn gardenLight(albedo: vec3f, N: vec3f, V: vec3f, wp: vec3f, trans: f32) -> vec3f {
  let K = worldLight.pool.key;
  let sun = worldLight.pool.keyCol.rgb * K.w;
  let kd = max(dot(N, K.xyz), 0.0);
  let through = pow(max(dot(-V, K.xyz), 0.0), 3.0) * trans + max(dot(-N, K.xyz), 0.0) * trans * 0.4;
  return albedo * (sun * (kd + through) + poolAmbient(N, 1.0) + worldFire(wp, N));
}

@fragment fn fs(i: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let kind = i32(i.info.x + 0.5);
  let V = normalize(frame.camPos - i.wp);
  var N = normalize(i.n);
  if (!front) { N = -N; }
  let seed = i.info.y;
  let tint = i.info.z;
  var col = vec3f(0.0);
  if (kind == 0) {
    // a pad: green (a young one bronze-red), veins running out from the notch's point, a darker rim, the wet sheen
    let r = i.uv.x;
    let ang = i.uv.y;
    var albedo = mix(vec3f(0.07, 0.2, 0.035), vec3f(0.13, 0.26, 0.04), vnoise2(i.wp.xz * 3.0 + seed * 9.0));
    albedo = mix(albedo, vec3f(0.22, 0.07, 0.04), smoothstep(0.82, 0.95, tint));
    let vein = 1.0 - smoothstep(0.0, 0.08, abs(fract(ang * 13.0) - 0.5) * 2.0 * (0.4 + r));
    albedo *= 1.0 + 0.35 * vein * smoothstep(0.1, 0.4, r);
    albedo = mix(albedo, albedo * vec3f(0.8, 0.45, 0.4), smoothstep(0.85, 1.0, r) * 0.6 + i.info.w * 0.5);
    col = gardenLight(albedo, N, V, i.wp, 0.25);
    let R = reflect(-V, N);
    let fres = 0.03 + 0.4 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col += poolEnv(R, i.wp) * fres * 0.25;
  } else if (kind == 1) {
    // a petal: cream at its foot, pink to coral toward its tip, lit through by the low sun
    let u = i.uv.x;
    let pink = mix(vec3f(0.95, 0.42, 0.55), vec3f(0.98, 0.5, 0.38), tint);
    var albedo = mix(vec3f(0.85, 0.78, 0.62), pink, smoothstep(0.15, 0.85, u));
    albedo *= 0.85 + 0.15 * (1.0 - abs(i.uv.y));
    col = gardenLight(albedo * 0.75, N, V, i.wp, 0.9);
  } else if (kind == 2) {
    col = gardenLight(vec3f(0.75, 0.52, 0.1), N, V, i.wp, 0.2);
  } else if (kind == 3) {
    // a reed's blade: green, yellowing toward its tip, lit through
    let albedo = mix(vec3f(0.08, 0.2, 0.04), vec3f(0.32, 0.36, 0.1), smoothstep(0.4, 1.0, i.uv.x)) * (0.8 + 0.4 * tint);
    col = gardenLight(albedo, N, V, i.wp, 0.7);
  } else {
    col = gardenLight(vec3f(0.18, 0.09, 0.04), N, V, i.wp, 0.1);
  }
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}
