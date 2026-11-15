// The planting on the Pool's planters, rafts and blocks (garden.ts lays it out, report 18): clumps round each top's rim,
// so a piece seen from above is a planted pad with a lawn in its middle and a real silhouette at its edge, not a square
// of turf with white sprinkles. Each clump is made from the vertex index:
//   leaves   broad leaf cards (a midrib, the two halves folded up a little, arching out over the rim and down), cut to a
//            leaf's outline in the fragment shader
//   flowers  on a thin stem, a flat head of petals turned up to the sky and a little toward the sun, the petals lit
//            through from behind: cream, sun gold, coral and peach round a gold disc
// A clump stands on its piece as the piece stands now (the rafts ride the swell: `stones` is the stones' live buffer,
// pool.ts). Decoration, not solid: a body's feet go into it as into grass; nearer the eye than 2 m or across the line
// of sight to a body it fades by the near fade's dither (decorDrop, worlds/light.wgsl).
#include "weft/frame"
#include "../light"

struct Stone {
  at: vec4f,
  size: vec4f,
  look: vec4f,
}

struct Bed {
  at: vec4f,     // x: the piece (an index into stones), y, z: where on its top (its own frame, m), w: its outward turn (rad)
  size: vec4f,   // x: the leaves' length (m), y: flowers (0 … FLOWERS), z: a seed, w: a tint (0 … 1)
}

@group(1) @binding(0) var<storage, read> stones: array<Stone>;
@group(1) @binding(1) var<storage, read> beds: array<Bed>;

/** leaves in a clump, quads along a leaf, flowers in a clump */
const LEAVES: u32 = 7u;
const LSEG: u32 = 3u;
const FLOWERS: u32 = 3u;
/** vertices: a leaf's two halves, LSEG quads each; a flower's stem and head, a quad each */
const LEAF_VERTS: u32 = 2u * LSEG * 6u;
const FLOWER_VERTS: u32 = 12u;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,                          // a leaf: (along 0 … 1, across -1 … 1); a head: (-1 … 1)²
  @location(3) @interpolate(flat) info: vec4f,     // kind (0 a leaf, 1 a stem, 2 a flower's head), seed, tint, flower colour
}

fn rot(v: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(v.x * c - v.y * s, v.x * s + v.y * c); }

/** the piece's frame: a point on its top (its own x, z; y up from the top) into the world */
fn onPiece(s: Stone, l: vec3f) -> vec3f {
  let c = cos(s.at.w);
  let sn = sin(s.at.w);
  return vec3f(s.at.x + l.x * c + l.z * sn, s.at.y + s.size.y + l.y, s.at.z - l.x * sn + l.z * c);
}
fn turnPiece(s: Stone, v: vec3f) -> vec3f {
  let c = cos(s.at.w);
  let sn = sin(s.at.w);
  return vec3f(v.x * c + v.z * sn, v.y, -v.x * sn + v.z * c);
}

fn h1(x: f32) -> f32 { return fract(sin(x * 12.9898) * 43758.5453); }

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let B = beds[ii];
  let S = stones[u32(B.at.x + 0.5)];
  let seed = B.size.z;
  let t = worldLight.pool.march.z;
  let L = B.size.x;
  var l = vec3f(0.0);
  var nl = vec3f(0.0, 1.0, 0.0);
  o.info = vec4f(0.0, seed, B.size.w, 0.0);
  if (vi < LEAVES * LEAF_VERTS) {
    // a leaf: its turn round the clump (spread toward the outside, a few back over the top), how far it arches
    let li = vi / LEAF_VERTS;
    let k = vi % LEAF_VERTS;
    let halfI = k / (LSEG * 6u);
    let q = (k % (LSEG * 6u)) / 6u;
    let c = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0))[k % 6u];
    let u = (f32(q) + c.x) / f32(LSEG);
    let side = select(-1.0, 1.0, halfI == 1u);
    let v = c.y * side;
    let hs = h1(seed * 31.0 + f32(li) * 7.13);
    let hs2 = h1(seed * 17.0 + f32(li) * 3.71);
    let az = B.at.w + (f32(li) / f32(LEAVES) - 0.5) * 3.6 + (hs - 0.5) * 0.7;
    let len = L * (0.65 + 0.5 * hs2);
    let lift = 0.7 + 0.5 * hs;            // how steeply it rises at its foot (rad)
    // (the arch: up at its foot, out and down to its tip; a little sway in the evening air)
    let sway = sin(t * 1.3 + seed * 9.0 + f32(li)) * 0.06 * u;
    let a = lift - u * (1.6 + 0.4 * hs2) + sway;
    // along the leaf's midrib: integrate the angle in three steps (each segment straight)
    var mid = vec2f(0.0);
    let du = 1.0 / f32(LSEG);
    for (var j = 0u; j < LSEG; j++) {
      let uj = (f32(j) + 0.5) * du;
      if (f32(j) * du >= u) { break; }
      let seg = min(du, u - f32(j) * du);
      let aj = lift - uj * (1.6 + 0.4 * hs2) + sin(t * 1.3 + seed * 9.0 + f32(li)) * 0.06 * uj;
      mid += vec2f(cos(aj), sin(aj)) * seg * len;
    }
    let out = vec3f(cos(az), 0.0, sin(az));
    let across = vec3f(-out.z, 0.0, out.x);
    // the leaf's width: widest past its middle, to a tip; its halves folded up along the midrib
    let w = len * 0.26 * sin(3.1415927 * min(u * 0.95 + 0.05, 1.0));
    let fold = 0.35;
    let foot = vec3f(B.at.y, 0.0, B.at.z) + out * 0.02 * f32(li % 3u);
    l = foot + out * mid.x + vec3f(0.0, mid.y, 0.0) + across * (v * w) + vec3f(0.0, abs(v) * w * fold, 0.0);
    let tangent = out * cos(a) + vec3f(0.0, sin(a), 0.0);
    nl = normalize(cross(tangent, across));
    if (nl.y < 0.0) { nl = -nl; }
    o.uv = vec2f(u, v);
    o.info.x = 0.0;
  } else {
    // a flower (or none, when this clump has fewer: collapsed to a point)
    let k = vi - LEAVES * LEAF_VERTS;
    let fi = k / FLOWER_VERTS;
    let kk = k % FLOWER_VERTS;
    let c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0))[kk % 6u];
    let hs = h1(seed * 13.0 + f32(fi) * 5.31);
    let hs2 = h1(seed * 41.0 + f32(fi) * 2.17);
    let ang = B.at.w + (hs - 0.5) * 2.4;
    let reach = L * (0.25 + 0.5 * hs2);
    let H = L * (0.75 + 0.6 * hs);
    let sway = vec2f(sin(t * 1.1 + seed * 5.0 + f32(fi) * 2.0), cos(t * 0.9 + seed * 3.0 + f32(fi))) * 0.02;
    let base = vec3f(B.at.y, 0.0, B.at.z);
    let head = base + vec3f(cos(ang) * reach + sway.x, H, sin(ang) * reach + sway.y);
    // (the world answering a moment opens the flowers as its wave passes: worlds/answer.wgsl, report 20)
    let R = L * (0.16 + 0.1 * hs2) * (1.0 + 0.9 * answerReach(2u, onPiece(S, head)));
    if (f32(fi) + 0.5 > B.size.y) {
      l = base - vec3f(0.0, 1.0, 0.0);
      o.uv = vec2f(0.0);
    } else if (kk < 6u) {
      // the stem: a thin strip from the foot to the head
      let ax = normalize(cross(head - base, vec3f(0.3, 0.0, 1.0)));
      let s = c.y * 0.5 + 0.5;
      l = mix(base, head, s) + vec3f(sin(s * 3.14159) * 0.03, 0.0, 0.0) + ax * c.x * 0.006;
      o.uv = vec2f(s, c.x);
      o.info.x = 1.0;
    } else {
      // the head: a disc of petals, facing up and a little out and toward the sun
      let sunL = worldLight.pool.key.xyz;
      let face = normalize(vec3f(cos(ang) * 0.35, 1.0, sin(ang) * 0.35) + vec3f(sunL.x, 0.0, sunL.z) * 0.4);
      let e1 = normalize(cross(face, vec3f(0.0, 0.0, 1.0)) + vec3f(1e-4, 0.0, 0.0));
      let e2 = cross(face, e1);
      l = head + (e1 * c.x + e2 * c.y) * R;
      nl = face;
      o.uv = c;
      o.info.x = 2.0;
      o.info.w = fract(hs * 7.0 + hs2);
    }
  }
  let wp = onPiece(S, l);
  o.pos = frame.viewProj * vec4f(wp, 1.0);
  o.wp = wp;
  o.n = turnPiece(S, nl);
  return o;
}

/** a flower's petals (cream, sun gold, coral, peach) by k (0 … 1) */
fn petalCol(k: f32) -> vec3f {
  if (k < 0.32) { return vec3f(0.95, 0.9, 0.78); }
  if (k < 0.58) { return vec3f(1.0, 0.72, 0.2); }
  if (k < 0.82) { return vec3f(1.0, 0.45, 0.32); }
  return vec3f(1.0, 0.66, 0.5);
}

@fragment fn fs(i: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (decorDrop(i.wp, i.pos.xy)) { discard; }
  let kind = i32(i.info.x + 0.5);
  var N = normalize(i.n);
  if (!front) { N = -N; }
  let V = normalize(frame.camPos - i.wp);
  let K = worldLight.pool.key;
  let sun = worldLight.pool.keyCol.rgb * K.w;
  var albedo = vec3f(0.0);
  var through = 0.0;
  var gloss = 0.0;
  if (kind == 0) {
    // a leaf: cut to its outline (a pointed oval), a paler midrib and veins, yellowing a little at the edge
    let u = i.uv.x;
    let v = abs(i.uv.y);
    let w = pow(sin(3.1415927 * min(u * 0.95 + 0.05, 1.0)), 0.75) * (1.0 - 0.25 * u);
    if (v > w) { discard; }
    let vein = smoothstep(0.08, 0.0, v) * 0.5 + smoothstep(0.06, 0.0, abs(fract(u * 6.0 - v * 1.5) - 0.5) - 0.44) * 0.25;
    albedo = mix(vec3f(0.05, 0.16, 0.035), vec3f(0.16, 0.32, 0.06), i.info.z * 0.6 + 0.2 * u) * (1.0 + vein);
    albedo = mix(albedo, vec3f(0.3, 0.36, 0.08), smoothstep(0.75, 1.0, v / max(w, 1e-3)) * 0.4);
    through = 0.8;
    gloss = 0.35;
  } else if (kind == 1) {
    albedo = vec3f(0.08, 0.2, 0.05);
    through = 0.4;
  } else {
    // a head: petals round a gold disc (their count by the colour), each with a soft notch at its tip
    let r = length(i.uv);
    let a = atan2(i.uv.y, i.uv.x);
    let n = select(8.0, 6.0, i.info.w > 0.58);
    let petal = 0.55 + 0.45 * pow(abs(cos(a * n * 0.5)), 0.6);
    if (r > petal) { discard; }
    let disc = smoothstep(0.3, 0.24, r);
    albedo = mix(petalCol(i.info.w) * (0.75 + 0.25 * smoothstep(0.2, 0.8, r)), vec3f(0.85, 0.5, 0.06), disc);
    through = 0.9 * (1.0 - disc);
    // (and glow, opened, as the answer's light passes: report 20)
    albedo *= 1.0 + 2.2 * answerGlow(2u, i.wp);
  }
  let kd = max(dot(N, K.xyz), 0.0);
  // (the low sun through a leaf or a petal from behind: the clump's rim lights gold)
  let back = (pow(max(dot(-V, K.xyz), 0.0), 3.0) + max(-dot(N, K.xyz), 0.0) * 0.5) * through;
  var col = albedo * (sun * (kd + back) + poolAmbient(N, 1.0) + worldFire(i.wp, N));
  let R = reflect(-V, N);
  col += sun * pow(max(dot(R, K.xyz), 0.0), 30.0) * gloss * 0.3 + poolEnv(R, i.wp) * gloss * 0.05;
  return vec4f(col, dot(i.wp - frame.camPos, frame.camFwd));
}
