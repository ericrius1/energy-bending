// The last step of the surface: the smoothed water and ice shaded, for one view (one pipeline per world: its light).
// It rebuilds the surface's position from the smoothed depth and its normal from the depth and, near the outline,
// from the thickness (so thin edges round off as the reference's do), then shades it with the reference's luminous
// model (docs/element-looks.md §2 and §3) rather than as absorbing glass:
//   water: a body that glows, pale blue where thin to deep blue where thick, times a caustic that rises through it;
//          a cyan rim where it is thin; sharp highlights; a little of the world reflected; the scene behind seen
//          through it, a little bent; foam where it is churned; a film of light on the floor where it lies in a puddle.
//   ice:   large flat facets from a voronoi in the frame of the bone the pixel lies on (so they ride on the body), each
//          tilted its own way and lit by a steep curve (some dark, some bright), steel blue to navy by thickness, bright
//          hairline edges, a thin frosted rim, glints that flash one cell at a time; a white front where it freezes.
// Three entries:
//   fs        the main view (and ?pip), a fullscreen pass over the resolved scene in the 'air' stage: it refracts a copy
//             of the scene. It writes colour only: the scene's alpha (its opaque view distance) is left as it was.
//   fs_scene  a gate's view: drawn inside the gate's own scene pass (its glow phase), blended over what is there and
//             depth-tested at the surface's own depth (no copy, no bending).
//   fs_mirror the same particles reflected in a mirroring floor, added onto the floor in the opaque phase.
//   fs_focus  the main view's focus texture (MatterPasses.focus): the surface's view distance, 1e5 elsewhere.
#include "weft/frame"
#include "weft/fullscreen"
#include "../../worlds/light"
#include "../core/body"
#include "../../engine/seen"

struct Surf {
  thin: vec4f,         // rgb: thin water's glow; w: how bright the body glows
  deep: vec4f,         // rgb: thick water's glow; w: how opaque the water is (0 … 1)
  rim: vec4f,          // rgb: the thin rim's colour; w: its strength
  iceThin: vec4f,      // rgb: thin ice; w: facet cells per metre
  iceThick: vec4f,     // rgb: thick ice; w: the frosted rim
  cover: vec4f,        // x, y: the outline's band of thickness (m); z: how much of the splats' summed chord counts; w: m → the reference's amount
  refract: f32,        // how far the scene behind is bent (uv per m of thickness)
  dispersion: f32,     // how far apart red and blue are bent
  glint: f32,          // the highlights
  foam: f32,           // how white the foam is
  caustic: f32,        // the caustic's scale (1/m)
  rise: f32,           // how fast it rises (m/s)
  reflect: f32,        // the world's reflection
  floorY: f32,         // the floor (the puddle lies on it, the mirror flips about it)
  time: f32,
  iceGlint: f32,       // ice's glints
  edges: f32,          // ice's facet edges
  mirror: f32,         // how much a mirroring floor shows
  distAlpha: f32,      // 1: also write the surface's distance into the scene's alpha (the old contract, for captures
                       // until the lens and the air read the focus texture; it cuts the Pool's horizon hole). 0: never
  pad0: f32, pad1: f32, pad2: f32,
}

@group(1) @binding(0) var<uniform> surf: Surf;
@group(1) @binding(1) var scene: texture_2d<f32>;    // fs, fs_focus: the view's scene, resolved (a copy: fs writes over it)
@group(1) @binding(2) var water: texture_2d<f32>;    // the smoothed surface: distance, thickness, foam, frost
@group(1) @binding(3) var raw: texture_2d<f32>;      // the splats' nearest distance and capsule (slot + 1)
@group(1) @binding(4) var<uniform> seen: ViewSeen;

/** the eye-to-point vector of a pixel of the water texture (uv of its centre) at view distance d */
fn atDist(uv: vec2f, d: f32) -> vec3f {
  let r = viewRay(uv);
  return r * (d / dot(r, frame.camFwd));
}

fn qconj(q: vec4f) -> vec4f { return vec4f(-q.xyz, q.w); }
/** a point of this view's world back in its dancer's own world (a dancer carried through a gate is drawn moved) */
fn seenBack(s: Seen, p: vec3f) -> vec3f {
  let v = p - vec3f(s.x.w, s.y.w, s.z.w);
  return s.x.xyz * v.x + s.y.xyz * v.y + s.z.xyz * v.z;
}
fn seenBackDir(s: Seen, v: vec3f) -> vec3f { return s.x.xyz * v.x + s.y.xyz * v.y + s.z.xyz * v.z; }

/** where a pixel is in the frame of the bone it lies on (its capsule's joint), and which way is up there; the
 *  world itself where no capsule is known (the puddle, flying sheets) */
struct Bone { p: vec3f, up: vec3f, n: vec3f }
fn boneOf(q: vec2i, dims: vec2i, wp: vec3f, N: vec3f) -> Bone {
  var o: Bone;
  o.p = wp;
  o.up = vec3f(0.0, 1.0, 0.0);
  o.n = N;
  // the capsule most of the pixels round it lie on (where capsules overlap their spheres interleave, and taking the
  // nearest sphere's alone would switch frames pixel by pixel: a grain of tiny cells); the outline the smoothing grew
  // past the splats takes the capsule of the splats beside it
  var votes = array<u32, 9>(0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u);
  for (var k = 0; k < 9; k++) {
    let off = vec2i(k % 3 - 1, k / 3 - 1) * 3;
    let sf = textureLoad(raw, clamp(q + off, vec2i(0), dims - 1), 0).g;
    votes[k] = select(0u, frameSlot(u32(sf + 0.5)), sf > 0.5);
  }
  var best = 0u;
  var most = 0;
  for (var a = 0; a < 9; a++) {
    if (votes[a] == 0u) { continue; }
    var n = 0;
    for (var b = 0; b < 9; b++) { if (votes[b] == votes[a]) { n++; } }
    if (n > most || (n == most && a == 4)) { most = n; best = votes[a]; }
  }
  if (best == 0u) { return o; }
  let slot = best - 1u;
  let d = slot / SEGS;
  if (d >= MAX_DANCERS) { return o; }
  let sg = segs[slot];
  let j = joints[d * MAXJ + u32(sg.info.x)];
  let sd = seen.d[d];
  let inv = qconj(j.rot);
  // (each capsule's frame is moved apart from the others, so neighbouring bones don't share cells)
  o.p = qrot(inv, seenBack(sd, wp) - j.pos.xyz) + vec3f(3.1, 1.7, 2.3) * f32(slot % SEGS);
  o.up = qrot(inv, seenBackDir(sd, vec3f(0.0, 1.0, 0.0)));
  o.n = qrot(inv, seenBackDir(sd, N));
  return o;
}

/** a capsule (slot + 1) to the capsule whose frame its pixels use: the pelvis, the belly and the tops of the legs ride
 *  on the lower back's frame (they overlap and move together), every other capsule on its own */
fn frameSlot(s1: u32) -> u32 {
  let s = s1 - 1u;
  let c = s % SEGS;
  if (c == 1u || c == 5u || c == 15u) { return s - c + 1u; }
  return s1;
}

/** voronoi in 3D: (distance to the nearest cell's point, to the second minus to the nearest, the cell's id) */
fn voro3(p: vec3f) -> vec3f {
  let i = floor(p);
  let f = p - i;
  var d1 = 8.0;
  var d2 = 8.0;
  var id = 0.0;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let g = vec3f(f32(x), f32(y), f32(z));
        let c = i + g;
        let r = g + vec3f(hash3(c), hash3(c + 19.19), hash3(c + 37.7)) - f;
        let d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; id = hash3(c + 7.7); } else if (d < d2) { d2 = d; }
      }
    }
  }
  let a = sqrt(d1);
  return vec3f(a, sqrt(d2) - a, id);
}

struct Shade {
  col: vec3f,          // the light the surface gives (emitted, reflected): added over what shows through it
  opac: f32,           // how much of what is behind it is hidden
  cover: f32,          // 0 … 1: how much of the pixel is water or ice (the outline)
  dist: f32,           // the surface's view distance
  wp: vec3f,
  N: vec3f,
  amount: f32,         // its thickness (m)
}

fn shade(q: vec2i, wdims: vec2i, W: vec4f) -> Shade {
  var o: Shade;
  o.cover = 0.0;
  o.dist = W.x;
  let amount = W.y * surf.cover.z;
  o.amount = amount;
  if (W.x <= 0.0 || amount <= 1e-5) { return o; }

  // ---------------------------------------------------------------- the surface: where, and which way it faces
  let wduv = 1.0 / vec2f(wdims);
  let uv0 = (vec2f(q) + 0.5) * wduv;
  let P = atDist(uv0, W.x);
  // each way, the neighbour nearer in depth (so an edge doesn't bend the normal toward what's behind it); two texels
  // each way (one texel's grain would show in the normal)
  let xr = textureLoad(water, clamp(q + vec2i(2, 0), vec2i(0), wdims - 1), 0);
  let xl = textureLoad(water, clamp(q - vec2i(2, 0), vec2i(0), wdims - 1), 0);
  let yd = textureLoad(water, clamp(q + vec2i(0, 2), vec2i(0), wdims - 1), 0);
  let yu = textureLoad(water, clamp(q - vec2i(0, 2), vec2i(0), wdims - 1), 0);
  var dx = vec3f(0.0);
  var dy = vec3f(0.0);
  let useR = xr.x > 0.0 && (xl.x <= 0.0 || abs(xr.x - W.x) < abs(xl.x - W.x));
  let useD = yd.x > 0.0 && (yu.x <= 0.0 || abs(yd.x - W.x) < abs(yu.x - W.x));
  if (useR) { dx = atDist(uv0 + vec2f(2.0 * wduv.x, 0.0), xr.x) - P; } else if (xl.x > 0.0) { dx = P - atDist(uv0 - vec2f(2.0 * wduv.x, 0.0), xl.x); }
  if (useD) { dy = atDist(uv0 + vec2f(0.0, 2.0 * wduv.y), yd.x) - P; } else if (yu.x > 0.0) { dy = P - atDist(uv0 - vec2f(0.0, 2.0 * wduv.y), yu.x); }
  let ray = normalize(P);
  let V = -ray;
  var Nd = V;
  if (dot(dx, dx) > 0.0 && dot(dy, dy) > 0.0) { Nd = normalize(cross(dy, dx)); }
  if (dot(Nd, ray) > 0.0) { Nd = -Nd; }
  // near the outline the thickness says more than the depth: it falls off toward the edge, so the normal turns out
  // there (the reference's normal is the gradient of the amount alone)
  let Wr = amount * surf.cover.w;
  let k = surf.cover.w * surf.cover.z * 18.0 * f32(wdims.y) / 800.0;
  let gx = (xr.y - xl.y) * k;
  let gy = (yd.y - yu.y) * k;
  let Nt = normalize(frame.camRight * (-gx) + frame.camUp * gy + V);
  var N = normalize(mix(Nt, Nd, smoothstep(0.15, 0.7, Wr)));
  let wp = frame.camPos + P;
  o.wp = wp;
  let cosV = clamp(dot(N, V), 0.0, 1.0);
  let R = reflect(ray, N);
  let key = worldKey(wp, true, 0.0);
  // the reference's own light, fixed to the view (up and to the left, toward the eye): the highlights and the facets
  // read in any world, the darkest included
  let Lv = normalize(frame.camRight * -0.45 + frame.camUp * 0.65 + V * 1.6);
  let F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  let env = worldEnv(R, wp) * surf.reflect;
  let frost = clamp(W.w / max(W.y, 1e-5), 0.0, 1.0);
  let fi = smoothstep(0.25, 0.75, frost);
  let bone = boneOf(q, wdims, wp, N);
  let grain = vnoise(bone.p * 120.0);

  // ---------------------------------------------------------------- water
  let rp = fbm(bone.p * surf.caustic + bone.n * 0.7 - bone.up * (surf.time * surf.rise * surf.caustic));
  var wc = mix(surf.thin.rgb, surf.deep.rgb, smoothstep(0.2, 1.3, Wr)) * (0.35 + 1.5 * rp * rp) * surf.thin.w;
  wc += surf.rim.rgb * surf.rim.w * (1.0 - smoothstep(0.22, 0.62, Wr));
  let spec = pow(max(dot(N, Lv), 0.0), 56.0) * 1.5 + pow(max(dot(R, key.dir), 0.0), 400.0) * 6.0 * key.glint * luma(key.col) * 2.0;
  wc += vec3f(0.9, 0.97, 1.0) * spec * surf.glint;
  wc += env * F;
  // foam: churned water turns white and dull where it is thin
  let foamy = clamp(W.z / max(W.y, 1e-5), 0.0, 1.0) * (1.0 - smoothstep(0.4, 1.2, Wr));
  let foam = smoothstep(0.35, 0.9, foamy * (0.6 + 0.8 * grain)) * surf.foam;
  wc = mix(wc, vec3f(0.8, 0.9, 1.0) * (0.35 + 0.4 * max(dot(N, Lv), 0.0)), foam);

  // ---------------------------------------------------------------- ice
  let vr = voro3(bone.p * surf.iceThin.w + bone.n * 0.15);
  let cid = vr.z;
  let tilt = (vec3f(fract(cid * 13.7), fract(cid * 71.3), fract(cid * 37.1)) - 0.5) * 1.1;
  let fn_ = normalize(N + tilt);
  let lit = max(dot(fn_, normalize(Lv + key.dir * 0.4)), 0.0);
  var ic = mix(surf.iceThin.rgb, surf.iceThick.rgb, smoothstep(0.18, 0.9, Wr)) * (0.25 + 1.3 * lit * lit * lit);
  ic += vec3f(0.40, 0.72, 1.0) * (1.0 - smoothstep(0.0, 0.06, vr.y)) * (0.10 + 0.25 * (1.0 - smoothstep(0.2, 1.0, Wr))) * surf.edges;
  ic += vec3f(0.75, 0.90, 1.0) * (1.0 - smoothstep(0.12, 0.34, Wr)) * (0.35 + 0.9 * grain) * surf.iceThick.w;
  let tw = rnd(u32(cid * 1e6) * 113u + u32(floor(surf.time * 6.0 + cid * 17.0)));
  let glint = smoothstep(0.9, 1.0, tw) * (1.0 - smoothstep(0.0, 0.2, vr.x));
  ic += vec3f(1.0) * (pow(lit, 40.0) * 1.4 + glint * 3.0) * surf.iceGlint;
  ic += env * F * 0.5;

  // ---------------------------------------------------------------- one or the other, and the freeze between them
  var col = mix(wc, ic, fi);
  // the freeze front: a band of white crystal where the pixel is half frozen
  let front = smoothstep(0.15, 0.5, frost) * (1.0 - smoothstep(0.5, 0.85, frost));
  col += vec3f(0.8, 0.92, 1.0) * front * smoothstep(0.45, 0.8, grain) * 0.8;
  var opac = mix(surf.deep.w, 0.96, fi);
  var cover = mix(smoothstep(surf.cover.x, surf.cover.y, amount), smoothstep(surf.cover.x * 0.6, surf.cover.y * 0.6, amount), fi);

  // ---------------------------------------------------------------- a puddle: a film of light on the floor
  let film = (1.0 - smoothstep(0.015, 0.05, wp.y - surf.floorY)) * smoothstep(0.5, 0.85, N.y) * (1.0 - fi);
  if (film > 0.0) {
    let Ff = 0.1 + 0.9 * pow(1.0 - cosV, 4.0);
    let fc = env * Ff * 1.4 + surf.rim.rgb * 0.05 * (0.5 + rp) + vec3f(0.9, 0.97, 1.0) * spec * surf.glint * 0.6;
    col = mix(col, fc, film);
    opac = mix(opac, 0.15, film);
    cover = mix(cover, smoothstep(0.0002, 0.0015, amount), film);
  }
  o.col = col;
  o.opac = opac;
  o.cover = cover;
  o.N = N;
  return o;
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let sdims = vec2i(textureDimensions(scene));
  let wdims = vec2i(textureDimensions(water));
  let px = vec2i(i.uv * vec2f(sdims));
  let q = clamp(vec2i(i.uv * vec2f(wdims)), vec2i(0), wdims - 1);
  let W = textureLoad(water, q, 0);
  let s = textureLoad(scene, px, 0);
  if (W.x <= 0.0) { discard; }
  // something solid in front of the water hides it
  if (s.a < W.x - 0.03) { discard; }
  let sh = shade(q, wdims, W);
  if (sh.cover <= 0.002) { discard; }
  // the scene behind, a little bent by the surface and apart in colour
  let bend = vec2f(dot(sh.N, frame.camRight), -dot(sh.N, frame.camUp)) * surf.refract * min(sh.amount, 0.3) / max(W.x * 0.25, 0.4);
  var behind = vec3f(0.0);
  for (var c = 0; c < 3; c++) {
    let k = 1.0 + (f32(c) - 1.0) * surf.dispersion;
    var t = textureLoad(scene, clamp(vec2i((i.uv + bend * k) * vec2f(sdims)), vec2i(0), sdims - 1), 0);
    // what was bent in from in front of the water isn't behind it: take the straight view instead
    if (t.a < W.x) { t = s; }
    behind[c] = t[c];
  }
  let col = behind * (1.0 - sh.opac) * vec3f(0.75, 0.92, 1.0) + sh.col;
  // colour only: the scene's alpha is its opaque view distance (the focus is fs_focus's)
  return vec4f(mix(s.rgb, col, sh.cover), select(s.a, W.x, surf.distAlpha > 0.5 && sh.cover > 0.5));
}

struct SceneOut { @location(0) c: vec4f, @builtin(frag_depth) depth: f32 }

fn depthAt(wp: vec3f) -> f32 {
  let c = frame.viewProj * vec4f(wp, 1.0);
  return clamp(c.z / c.w, 0.0, 1.0);
}

@fragment fn fs_scene(i: FullscreenOut) -> SceneOut {
  let wdims = vec2i(textureDimensions(water));
  let q = clamp(vec2i(i.uv * vec2f(wdims)), vec2i(0), wdims - 1);
  let W = textureLoad(water, q, 0);
  let sh = shade(q, wdims, W);
  if (sh.cover <= 0.002) { discard; }
  var o: SceneOut;
  // premultiplied over what is there (the colour blend), alpha untouched (the alpha blend keeps it)
  o.c = vec4f(sh.col * sh.cover, sh.cover * sh.opac);
  o.depth = depthAt(sh.wp);
  return o;
}

@fragment fn fs_mirror(i: FullscreenOut) -> SceneOut {
  let wdims = vec2i(textureDimensions(water));
  let q = clamp(vec2i(i.uv * vec2f(wdims)), vec2i(0), wdims - 1);
  let W = textureLoad(water, q, 0);
  let sh = shade(q, wdims, W);
  if (sh.cover <= 0.002 || sh.wp.y > surf.floorY) { discard; }
  // dimmer the deeper it is under the floor, and more at a glance along the floor than looking down into it
  let below = surf.floorY - sh.wp.y;
  let glance = 1.0 - abs(normalize(sh.wp - frame.camPos).y);
  let fres = 0.25 + 0.75 * pow(max(glance, 0.0), 3.0);
  var o: SceneOut;
  o.c = vec4f(sh.col * sh.cover * surf.mirror * fres * exp(-below * 1.2), 0.0);
  o.depth = depthAt(sh.wp);
  return o;
}

@fragment fn fs_focus(i: FullscreenOut) -> @location(0) vec4f {
  let sdims = vec2i(textureDimensions(scene));
  let wdims = vec2i(textureDimensions(water));
  let q = clamp(vec2i(i.uv * vec2f(wdims)), vec2i(0), wdims - 1);
  let W = textureLoad(water, q, 0);
  let s = textureLoad(scene, clamp(vec2i(i.uv * vec2f(sdims)), vec2i(0), sdims - 1), 0);
  let amount = W.y * surf.cover.z;
  let there = W.x > 0.0 && amount > surf.cover.x * 0.6 && s.a >= W.x - 0.03;
  return vec4f(select(1e5, W.x, there), 0.0, 0.0, 1.0);
}
