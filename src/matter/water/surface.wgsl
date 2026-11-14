// The last step of the surface: the smoothed water and ice shaded, for one view (one pipeline per world: its light).
// It rebuilds the surface's position from the smoothed depth and its normal from the depth and, near the outline,
// from the thickness (so thin edges round off), then shades it as matter lit by the world it stands in, not as
// something that glows (docs/reports/6-critique.md, "Water"):
//   water: clear, absorbing toward deep blue-green by its thickness, a little milky (the light scattered inside it is
//          the world's: its ambient, its key, the dancers' fire, a gem heart's), with the world's reflection by Fresnel,
//          highlights from the world's key and from each fire, a rim only on the side a light comes from, and the scene
//          behind seen through it, bent most at the edges. A faint light of its own (a caustic rising through it) keeps
//          it readable on black, far below a fire beside it. Its edge is not the smoothed outline: near the outline
//          the lookup is pushed by a curl noise on the body's plane that climbs and is carried by the body's motion,
//          so the silhouette breaks into wisps and tongues and thin water tears into drops; thick water stays put.
//          Water lying on the floor (the asleep heap, a fallen body) is a shallow puddle: the floor seen through it a
//          little darker, the world reflected in it, a meniscus at its edge that catches the light.
//   ice:   large flat facets from a voronoi in the frame of the bone the pixel lies on (so they ride on the body), each
//          tilted its own way and reflecting its own part of the world (dark facets among bright ones), lit by the
//          world's key and fire, steel blue to navy by thickness, hairline edges, frost only where frost forms (edges
//          that face up, the hands, feet and head), glints that flash one cell at a time; a white front where it
//          freezes.
// Four entries:
//   fs        the main view (and ?pip), a fullscreen pass over the resolved scene in the 'air' stage: it refracts a copy
//             of the scene. It writes colour only: the scene's alpha (its opaque view distance) is left as it was.
//   fs_scene  a gate's view: drawn inside the gate's own scene pass (its glow phase), blended over what is there and
//             depth-tested at the surface's own depth (no copy, no bending).
//   fs_mirror the same particles reflected in a mirroring floor, added onto the floor in the opaque phase.
//   fs_focus  the main view's focus texture (MatterPasses.focus): the surface's view distance, 1e5 elsewhere; and the
//             body texture (MatterPasses.body, WaterSurface.body): how the water dims and bends what is behind it, for
//             the post chain to apply to light laid over the scene afterwards (the fire's glow behind a water body).
#include "weft/frame"
#include "weft/fullscreen"
#include "../../worlds/light"
#include "../core/body"
#include "../../engine/seen"
#include "../gems/hearts"

struct Surf {
  absorb: vec4f,       // rgb: what each channel loses per unit of the reference's amount W (red most: thick water turns
                       // deep blue-green); w: how milky it is per unit W (the light it scatters, which hides what's behind)
  tint: vec4f,         // rgb: the colour light scattered inside it takes; w: the most it hides (its opacity, thickest)
  glow: vec4f,         // rgb: its own faint light (the rising caustic); w: how bright (it must read on black, no more)
  rim: vec4f,          // rgb: the rim's colour (× the light it comes from); w: its strength
  iceThin: vec4f,      // rgb: thin ice; w: facet cells per metre
  iceThick: vec4f,     // rgb: thick ice; w: the frost
  cover: vec4f,        // x, y: the outline's band of thickness (m); z: how much of the splats' summed chord counts; w: m → the reference's amount
  wisp: vec4f,         // x: how far the edge's tongues reach (m); y: how far its curl pushes (m); z: how much the noise tears thin water; w: the noise's scale (1/m)
  refract: f32,        // how far the scene behind is bent (uv per m of thickness, more at the edges)
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
  pad0: f32,
  iceOpacity: f32,     // how much ice hides what is behind it
  climb: f32,          // how fast the edge's noise climbs (m/s)
  lens: f32,           // how much a thick body bends what is behind it as a lens would (lensOf: 1 as water does)
  ripple: vec4f,       // x: how much the water's small waves tilt its normal; y: their scale (1/m); z: the rim's sharpness
  soft: vec4f,         // how soft what is seen through it is (× the screen's height, × how far behind the water it is):
                       // x everywhere, y more where it is thick (the lens draws it in); zw: unused
}

@group(1) @binding(0) var<uniform> surf: Surf;
@group(1) @binding(1) var scene: texture_2d<f32>;    // fs, fs_focus: the view's scene, resolved (a copy: fs writes over it)
@group(1) @binding(2) var water: texture_2d<f32>;    // the smoothed surface: distance, thickness, foam, frost
@group(1) @binding(3) var raw: texture_2d<f32>;      // the splats' nearest distance and capsule (slot + 1)
@group(1) @binding(4) var<uniform> seen: ViewSeen;
/** a gem heart inside the water (tide, gemwater): the surface thins in front of it and takes its light */
@group(1) @binding(5) var<uniform> hearts: Hearts;
/** fs: the air at what is behind the water, in a world that fogs after the water (fs_fog's: rgb the light it adds, a
 *  what it lets through; (0, 0, 0, 1) where there was no water to ask for). Elsewhere any rgba16float stand-in */
@group(1) @binding(6) var fog: texture_2d<f32>;

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

/** a capsule (slot + 1) to the capsule whose frame its pixels use: the pelvis, the belly and the tops of the legs ride
 *  on the lower back's frame (they overlap and move together), every other capsule on its own */
fn frameSlot(s1: u32) -> u32 {
  let s = s1 - 1u;
  let c = s % SEGS;
  if (c == 1u || c == 5u || c == 15u) { return s - c + 1u; }
  return s1;
}

/** the capsule (slot + 1, 0 none) most of the splats round q lie on (where capsules overlap their spheres interleave,
 *  and taking the nearest sphere's alone would switch frames pixel by pixel: a grain of tiny cells); the outline the
 *  smoothing grew past the splats takes the capsule of the splats beside it */
fn capsuleAt(q: vec2i, dims: vec2i) -> u32 {
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
  return best;
}

/** where a pixel is in the frame of the bone it lies on (its capsule's joint), and which way is up there; the world
 *  itself where no capsule is known (the puddle, flying sheets). cap: the capsule's index on its body (SEGS: none);
 *  vel: the bone's velocity (m/s, this view's world) */
struct Bone { p: vec3f, up: vec3f, n: vec3f, cap: u32, vel: vec3f }
fn boneOf(best: u32, wp: vec3f, N: vec3f) -> Bone {
  var o: Bone;
  o.p = wp;
  o.up = vec3f(0.0, 1.0, 0.0);
  o.n = N;
  o.cap = SEGS;
  o.vel = vec3f(0.0);
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
  o.cap = slot % SEGS;
  o.vel = seenDir(sd, j.vel.xyz);
  return o;
}

/** the hands, the feet, the head, the shins and forearms: where frost forms first (capsules.ts's order) */
fn extremity(c: u32) -> f32 {
  if (c == 4u) { return 1.0; }
  if (c >= SEGS) { return 0.0; }
  let k = select(c - 5u, c - 15u, c >= 15u);
  if (c < 5u) { return 0.0; }
  if (k == 3u || k == 4u || k == 8u || k == 9u) { return 1.0; }
  if (k == 2u || k == 7u) { return 0.5; }
  return 0.0;
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

fn fbm2(p: vec2f) -> f32 { return vnoise2(p) * 0.6 + vnoise2(p * 2.13 + 5.7) * 0.28 + vnoise2(p * 4.4 + 1.3) * 0.12; }

// ---------------------------------------------------------------- the edge that breaks
/** where a pixel takes its water from: near the outline the lookup is pushed by a curl noise on the body's plane
 *  (metres at the water's distance, the camera's slide taken out as fire's composite does), whose tongues reach
 *  upward and back from the way the body moves, so the silhouette streams; thick water is not moved. `keep` thins
 *  what is pulled out (a tongue is thinner than the body it comes from), and the noise tears thin water into holes */
struct Edge { q: vec2f, keep: f32 }
fn edgeAt(uv: vec2f, wdims: vec2i) -> Edge {
  var e: Edge;
  let q0 = clamp(vec2i(uv * vec2f(wdims)), vec2i(0), wdims - 1);
  e.q = clamp(uv * vec2f(wdims), vec2f(0.5), vec2f(wdims) - 0.5);
  e.keep = 1.0;
  if (surf.wisp.x <= 0.0 && surf.wisp.y <= 0.0) { return e; }
  let W0 = textureLoad(water, q0, 0);
  var d = W0.x;
  var frost = select(0.0, clamp(W0.w / max(W0.y, 1e-6), 0.0, 1.0), W0.y > 1e-6);
  if (d <= 0.0) {
    // a pixel outside the water: is any near enough for a tongue to reach it? (two rings, nearest first)
    let reachPx = f32(wdims.y) * 0.05;
    for (var r = 1; r <= 2 && d <= 0.0; r++) {
      for (var k = 0; k < 8; k++) {
        let a = f32(k) * 0.785398 + f32(r) * 0.39;
        let s = textureLoad(water, clamp(q0 + vec2i(round(vec2f(cos(a), sin(a)) * reachPx * f32(r) / 2.0)), vec2i(0), wdims - 1), 0);
        if (s.x > 0.0 && s.y > 0.0) { d = s.x; frost = max(frost, clamp(s.w / s.y, 0.0, 1.0)); break; }
      }
    }
    if (d <= 0.0) { return e; }
  }
  let amount = W0.y * surf.cover.z;
  // how much of an edge this is: outside and in the thin band, not in thick water; ice keeps its own outline
  let edge = (1.0 - smoothstep(surf.cover.y, surf.cover.y * 7.0, amount)) * (1.0 - smoothstep(0.1, 0.4, frost));
  if (edge <= 0.001) { return e; }
  // the plane at that distance, in metres, fixed to the world as the camera slides (as fire's composite does)
  let th = tan(frame.fovY * 0.5);
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - 2.0 * uv.y);
  let w = vec2f(ndc.x * th * frame.aspect, ndc.y * th) * d + vec2f(dot(frame.camPos, frame.camRight), dot(frame.camPos, frame.camUp));
  let ppm = frame.proj[1][1] * 0.5 * f32(wdims.y) / d;
  let t = surf.time;
  let sc = surf.wisp.w;
  // the body's motion here (its bone's, from the capsule the splats round it lie on): tongues stream behind it
  // (only on the water: outside it no splat says which capsule)
  var best = 0u;
  if (W0.x > 0.0) { best = capsuleAt(q0, wdims); }
  var vs = vec2f(0.0);
  if (best > 0u) {
    let b = boneOf(best, vec3f(0.0), vec3f(0.0, 1.0, 0.0));
    vs = vec2f(dot(b.vel, frame.camRight), dot(b.vel, frame.camUp));
  }
  let sp = length(vs);
  // the pattern climbs (and runs back along the motion), so the tongues are carried with the water
  let p = (w - vec2f(0.0, t * surf.climb) + vs * 0.04) * sc;
  let ee = 0.37;
  let n0 = fbm2(p);
  let nx = fbm2(p + vec2f(ee, 0.0));
  let ny = fbm2(p + vec2f(0.0, ee));
  let curl = vec2f(ny - n0, -(nx - n0)) / ee;
  let tongue = smoothstep(0.42, 0.8, fbm2(p * 0.55 + vec2f(7.3, 2.1)));
  // which way the tongues reach: up, and back from the motion when the body is quick
  let back = select(vec2f(0.0), -vs / max(sp, 1e-3), sp > 1e-3) * smoothstep(0.3, 2.5, sp);
  let reach = normalize(vec2f(0.0, 1.0) * 0.8 + back * 1.6 + vec2f(1e-4));
  let offM = curl * surf.wisp.y - reach * surf.wisp.x * tongue * (1.0 + smoothstep(0.5, 3.0, sp));
  let offPx = vec2f(offM.x, -offM.y) * ppm * edge;
  // (in texels, not rounded: a tongue stretches the edge, and nearest texels stretched showed as small square blocks;
  // waterAt reads between them)
  e.q = clamp(e.q + offPx, vec2f(0.5), vec2f(wdims) - 0.5);
  // what is pulled out thins with how far it came; and thin water tears where the noise is low
  let far = length(offM) * edge;
  let tear = mix(1.0, smoothstep(0.2, 0.75, n0 * 0.7 + vnoise2(p * 3.1 - vec2f(0.0, t * 0.9)) * 0.6), surf.wisp.z * edge);
  e.keep = exp(-far / max(surf.wisp.x * 0.9, 1e-3)) * tear;
  return e;
}

/** the smoothed water at a point between texels (q in texels, a texel's middle at +0.5): read between the four round
 *  it, its distance only from those that have water (0 is "none", not a depth), the rest (thickness, foam, frost)
 *  plainly, so an outline read between texels fades instead of stepping */
fn waterAt(q: vec2f, wdims: vec2i) -> vec4f {
  let p = q - 0.5;
  let i0 = vec2i(floor(p));
  let f = p - floor(p);
  let a = textureLoad(water, clamp(i0, vec2i(0), wdims - 1), 0);
  let b = textureLoad(water, clamp(i0 + vec2i(1, 0), vec2i(0), wdims - 1), 0);
  let c = textureLoad(water, clamp(i0 + vec2i(0, 1), vec2i(0), wdims - 1), 0);
  let d = textureLoad(water, clamp(i0 + vec2i(1, 1), vec2i(0), wdims - 1), 0);
  let w = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  var o = a * w.x + b * w.y + c * w.z + d * w.w;
  let has = w * vec4f(step(1e-6, a.x), step(1e-6, b.x), step(1e-6, c.x), step(1e-6, d.x));
  let hs = has.x + has.y + has.z + has.w;
  o.x = select(0.0, (a.x * has.x + b.x * has.y + c.x * has.z + d.x * has.w) / max(hs, 1e-6), hs > 1e-4);
  return o;
}

// ---------------------------------------------------------------- the world's light on the surface
/** the dancers' fire seen in a surface at p: highlights in the reflected direction R and a rim on the side facing it.
 *  Warm, never pale: the highlight is a flame's (it moves over the ripples as streaks of the fire's colour) and the
 *  rim a thin warm edge, and the sum rolls off at its brightest channel, so it saturates at the flame's own hue. (It
 *  was a broad lobe and a wide rim at a fire's full strength a metre off: (2.5, 1, 0.3) added over the whole half of a
 *  water body facing the fire, which the blue under it summed to grey-white, the pale side, Report 10) */
fn fireSpec(p: vec3f, R: vec3f, N: vec3f, rimK: f32) -> vec3f {
  var sum = vec3f(0.0);
  var lights = worldLight.fire.lights;
  for (var k = 0u; k < min(worldLight.fire.count, MAX_DANCERS); k++) {
    let l = lights[k];
    let v = l.pos.xyz - p;
    let d2 = dot(v, v);
    let L = v * inverseSqrt(max(d2, 1e-6));
    let fall = 1.0 / (d2 + l.pos.w * l.pos.w);
    let rl = max(dot(R, L), 0.0);
    sum += l.col.rgb * fall * (pow(rl, 140.0) * 2.2 + rimK * rimK * smoothstep(0.1, 0.7, dot(N, L)) * 0.15);
  }
  return sum / (1.0 + 0.8 * max(sum.r, max(sum.g, sum.b)));
}

struct Shade {
  col: vec3f,          // the light the surface gives (reflected, scattered, its own): added over what shows through it
  trans: vec3f,        // how much of what is behind it shows through, per channel
  cover: f32,          // 0 … 1: how much of the pixel is water or ice (the outline)
  dist: f32,           // the surface's view distance
  wp: vec3f,
  N: vec3f,
  amount: f32,         // its thickness (m)
}

fn shade(qf: vec2f, wdims: vec2i, W: vec4f, keep: f32) -> Shade {
  let q = clamp(vec2i(floor(qf)), vec2i(0), wdims - 1);
  var o: Shade;
  o.cover = 0.0;
  o.dist = W.x;
  o.trans = vec3f(1.0);
  let amount = W.y * surf.cover.z * keep;
  o.amount = amount;
  if (W.x <= 0.0 || amount <= 1e-5) { return o; }

  // ---------------------------------------------------------------- the surface: where, and which way it faces
  let wduv = 1.0 / vec2f(wdims);
  let uv0 = qf * wduv;
  let P = atDist(uv0, W.x);
  // each way, the neighbour nearer in depth (so an edge doesn't bend the normal toward what's behind it), a few texels
  // away (a texel or two apart, what is left of the beads and of the separable filter's rows would show in the normal)
  let st = i32(max(2.0, round(f32(wdims.y) / 300.0)));
  let xr = textureLoad(water, clamp(q + vec2i(st, 0), vec2i(0), wdims - 1), 0);
  let xl = textureLoad(water, clamp(q - vec2i(st, 0), vec2i(0), wdims - 1), 0);
  let yd = textureLoad(water, clamp(q + vec2i(0, st), vec2i(0), wdims - 1), 0);
  let yu = textureLoad(water, clamp(q - vec2i(0, st), vec2i(0), wdims - 1), 0);
  let fo = f32(st);
  var dx = vec3f(0.0);
  var dy = vec3f(0.0);
  let useR = xr.x > 0.0 && (xl.x <= 0.0 || abs(xr.x - W.x) < abs(xl.x - W.x));
  let useD = yd.x > 0.0 && (yu.x <= 0.0 || abs(yd.x - W.x) < abs(yu.x - W.x));
  if (useR) { dx = atDist(uv0 + vec2f(fo * wduv.x, 0.0), xr.x) - P; } else if (xl.x > 0.0) { dx = P - atDist(uv0 - vec2f(fo * wduv.x, 0.0), xl.x); }
  if (useD) { dy = atDist(uv0 + vec2f(0.0, fo * wduv.y), yd.x) - P; } else if (yu.x > 0.0) { dy = P - atDist(uv0 - vec2f(0.0, fo * wduv.y), yu.x); }
  let ray = normalize(P);
  let V = -ray;
  var Nd = V;
  if (dot(dx, dx) > 0.0 && dot(dy, dy) > 0.0) { Nd = normalize(cross(dy, dx)); }
  if (dot(Nd, ray) > 0.0) { Nd = -Nd; }
  // near the outline the thickness says more than the depth: it falls off toward the edge, so the normal turns out
  // there (the reference's normal is the gradient of the amount alone)
  let Wr = amount * surf.cover.w;
  let k = surf.cover.w * surf.cover.z * 36.0 / fo * f32(wdims.y) / 800.0;
  let gx = (xr.y - xl.y) * k;
  let gy = (yd.y - yu.y) * k;
  let Nt = normalize(frame.camRight * (-gx) + frame.camUp * gy + V);
  // (the depth's normal only part of the way in: the narrow-range filter leaves terraces in the depth where an arm
  // crosses the body, which read as flat rectangles in a surface this glossy; the thickness is blurred plainly)
  var N = normalize(mix(Nt, Nd, smoothstep(0.15, 0.7, Wr) * surf.ripple.w));
  let wp = frame.camPos + P;
  o.wp = wp;
  // the water's own small waves (in the frame of the bone it runs on, so they ride the body and run down it): they
  // break the highlights and bend what is seen through it; ice is still
  let frost0 = clamp(W.w / max(W.y, 1e-5), 0.0, 1.0);
  let bone = boneOf(capsuleAt(q, wdims), wp, N);
  let wv = flow(bone.p * surf.ripple.y + bone.up * (surf.time * 0.6 * surf.ripple.y), surf.time * 1.3);
  N = normalize(N + (wv - N * dot(wv, N)) * surf.ripple.x * (1.0 - smoothstep(0.25, 0.75, frost0)));
  let cosV = clamp(dot(N, V), 0.0, 1.0);
  let R = reflect(ray, N);
  let key = worldKey(wp, true, 0.0);
  // Fresnel, but not all the way to grazing at the outline: there every pixel would mirror the same horizon and the
  // silhouette would be one bright band of constant width (the edge bends what is behind it instead, below); the
  // noise lets it reach further in places
  let cosF = max(cosV, 0.32 + 0.35 * vnoise(wp * 23.0 + vec3f(0.0, -surf.time * 0.7, 0.0)));
  let F = 0.02 + 0.98 * pow(1.0 - cosF, 5.0);
  let frost = clamp(W.w / max(W.y, 1e-5), 0.0, 1.0);
  let fi = smoothstep(0.25, 0.75, frost);
  let grain = vnoise(bone.p * 120.0);
  // the light that reaches the surface from the world: its ambient (with the woods' lanterns, the fire's share), its
  // key wrapped round, the dancers' fire, a gem heart inside
  let amb = worldAmbient(N, 1.0, wp);
  let keyD = key.col * clamp((dot(N, key.dir) + 0.35) / 1.35, 0.0, 1.0);
  let fireD = worldFire(wp, N);
  let heartL = heartLight(hearts, wp);
  let lightIn = amb + keyD + fireD + heartL;
  // a weak fill fixed to the view (up and to the left, toward the eye): the darkest worlds still show a highlight
  let Lv = normalize(frame.camRight * -0.45 + frame.camUp * 0.65 + V * 1.6);
  let rimK = pow(1.0 - cosV, surf.ripple.z);

  // ---------------------------------------------------------------- water
  let rp = fbm(bone.p * surf.caustic - bone.up * (surf.time * surf.rise * surf.caustic));
  // (only where some of it is liquid: a body of ice skips it)
  var milk = 0.0;
  var wt = vec3f(1.0);
  var wc = vec3f(0.0);
  if (fi < 0.999) {
    // through it: absorbed by its thickness toward deep blue-green, and hidden by what it scatters (a little milky)
    milk = surf.tint.w * (1.0 - exp(-surf.absorb.w * Wr));
    wt = exp(-surf.absorb.rgb * Wr) * (1.0 - milk) * (1.0 - F);
    // the light scattered inside is the world's, in the water's colour; its own faint light is the caustic rising
    // (water scatters little: most of what it gives is what it reflects. The worlds' ambient is generous, made for
    // stones and bark; in water only a little of it scatters back, while a key or a fire beside it lights it up)
    // (and compressed: a world's key or a fire a metre off must tint it, not turn it into a lit solid)
    // A fire's part rolls off at its brightest channel and is held under a quarter: compressed by luminance with the
    // rest, a fire close by (its light falls as 1/d², ten times stronger at 30 cm than at a metre) scattered up to
    // twice white in red into the water's pale tint, and over the water's blue that summed to a grey-white wash on the
    // side facing the fire (Report 10). Warm light inside blue water is a warm cast on it, not a lamp
    let li = amb * 0.06 + keyD * 0.3 + heartL * 0.4;
    let lfire = fireD * 0.6;
    wc = surf.tint.rgb * li / (1.0 + luma(li)) * milk * 0.35
       + vec3f(1.0, 0.8, 0.62) * lfire / (1.0 + max(lfire.r, max(lfire.g, lfire.b))) * milk * 0.22;
    wc += surf.glow.rgb * surf.glow.w * (0.3 + 1.6 * rp * rp) * (0.25 + milk);
    // the world reflected, and its lights: the key's highlight (sharp, and a broad sheen), each fire's, the view's fill
    wc += worldEnv(R, wp) * surf.reflect * F;
    let spec = key.col * (pow(max(dot(R, key.dir), 0.0), 260.0) * 14.0 + pow(max(dot(R, key.dir), 0.0), 26.0) * 0.5) * key.glint
             + vec3f(0.85, 0.95, 1.0) * pow(max(dot(N, Lv), 0.0), 80.0) * 0.25;
    wc += spec * surf.glint;
    // a rim only on the side a light comes from: the key's, each fire's
    let rimL = key.col * rimK * smoothstep(-0.15, 0.6, dot(N, key.dir)) * 1.6;
    wc += (rimL * surf.rim.rgb) * surf.rim.w;
    wc += fireSpec(wp, R, N, rimK * surf.rim.w) * surf.glint;
    // foam: churned water turns white and dull where it is thin, lit like anything else, but compressed as the light
    // scattered inside is, and the fire's part of it apart, so it keeps the flame's hue. Lit at a fire's full strength
    // (a fire a metre off) white foam over most of the water was a grey-white wash over the half of the body facing
    // the fire, the blue under it hidden (Report 10, the pale side); now that side is blue water with warm foam on it
    let foamy = clamp(W.z / max(W.y, 1e-5), 0.0, 1.0) * (1.0 - smoothstep(0.4, 1.2, Wr));
    let foam = smoothstep(0.35, 0.9, foamy * (0.6 + 0.8 * grain)) * surf.foam;
    let lw = (amb + keyD + heartL) * 0.7;
    let lfoam = fireD * 0.35;
    let foamCol = vec3f(0.85, 0.92, 1.0) * lw / (1.0 + luma(lw)) + lfoam / (1.0 + max(lfoam.r, max(lfoam.g, lfoam.b)));
    // (over the water's own colour, not in place of it: foam in place of the water's light, wherever a fire churns it,
    // left no blue on that side at all)
    wc = mix(wc, wc * 0.7 + foamCol + surf.glow.rgb * surf.glow.w * 0.3, foam * 0.6);
    wt *= 1.0 - foam * 0.4;
  }

  // ---------------------------------------------------------------- ice
  // (only where some of it is frozen: liquid water skips the voronoi and the second look at the world)
  var ic = vec3f(0.0);
  var it = vec3f(1.0);
  if (fi > 0.001) {
    let vr = voro3(bone.p * surf.iceThin.w);
    let cid = vr.z;
    let tilt = (vec3f(fract(cid * 13.7), fract(cid * 71.3), fract(cid * 37.1)) - 0.5) * 1.1;
    // (ice is hard: its outline doesn't round off as water's does, so its facets turn on the depth's normal almost to
    // the edge; otherwise every facet at the outline would face sideways and the outline would be one bright band)
    var Ni = normalize(mix(Nt, Nd, smoothstep(0.02, 0.2, Wr)));
    var fn_ = normalize(Ni + tilt);
    if (dot(fn_, V) < 0.08) { fn_ = normalize(fn_ + V * (0.08 - dot(fn_, V))); }
    let Rf = reflect(ray, fn_);
    let cf = clamp(dot(fn_, V), 0.0, 1.0);
    let Ff = 0.04 + 0.96 * pow(1.0 - cf, 5.0);
    // each facet reflects its own part of the world (the moon in one, the dark in the next) and is lit by the key, the
    // fire and the ambient as it is turned; the view's fill keeps a few bright in the darkest worlds
    let envF = worldEnv(Rf, wp) * surf.reflect;
    let keyF = max(dot(fn_, key.dir), 0.0);
    let lit = max(dot(fn_, normalize(Lv + key.dir * 0.4)), 0.0);
    let litIn = worldAmbient(fn_, 1.0, wp) * 0.6 + key.col * keyF + worldFire(wp, fn_) + heartL;
    // each cell its own depth of blue (pale ones and navy ones side by side), deeper where the ice is thick: never a
    // pale band of the same width round the outline
    let body = mix(surf.iceThin.rgb, surf.iceThick.rgb, clamp(fract(cid * 5.31) * 0.85 + smoothstep(0.1, 0.9, Wr) * 0.35 - 0.1, 0.0, 1.0));
    ic = body * (litIn * (0.25 + 1.2 * keyF * keyF) + vec3f(0.05 + 0.2 * lit * lit * lit) + surf.glow.rgb * surf.glow.w * 0.3);
    ic += envF * (0.12 + 0.88 * Ff);
    // hairline edges between facets, catching the light that reaches them
    ic += vec3f(0.40, 0.72, 1.0) * (1.0 - smoothstep(0.0, 0.06, vr.y)) * (0.06 + 0.5 * luma(lightIn)) * surf.edges;
    // frost: where it would form, on edges that face up and on the hands, feet and head, never as a band all round
    let upFace = smoothstep(0.15, 0.75, N.y) * (1.0 - smoothstep(0.35, 1.0, Wr));
    let tips = extremity(bone.cap) * (1.0 - smoothstep(0.3, 1.1, Wr));
    let frostA = clamp(max(upFace, tips) * (0.35 + 0.9 * grain), 0.0, 1.0) * surf.iceThick.w;
    ic = mix(ic, vec3f(0.82, 0.92, 1.0) * (lightIn * 0.9 + vec3f(0.03)), frostA * 0.75);
    // glints: one cell at a time catches the key
    let tw = rnd(u32(cid * 1e6) * 113u + u32(floor(surf.time * 6.0 + cid * 17.0)));
    let glint = smoothstep(0.9, 1.0, tw) * (1.0 - smoothstep(0.0, 0.2, vr.x));
    ic += (key.col * (pow(max(dot(Rf, key.dir), 0.0), 60.0) * 6.0 + glint * 2.0) + vec3f(1.0) * glint * 0.25) * surf.iceGlint * key.glint;
    ic += fireSpec(wp, Rf, fn_, rimK * 0.5) * surf.iceGlint;
    it = mix(vec3f(0.7, 0.85, 1.0), vec3f(0.35, 0.55, 0.8), smoothstep(0.2, 1.0, Wr)) * (1.0 - surf.iceOpacity) * (1.0 - Ff) * (1.0 - frostA * 0.7);
  }

  // ---------------------------------------------------------------- one or the other, and the freeze between them
  var col = mix(wc, ic, fi);
  var trans = mix(wt, it, fi);
  // the freeze front: a band of white crystal where the pixel is half frozen
  let front = smoothstep(0.3, 0.5, frost) * (1.0 - smoothstep(0.5, 0.7, frost));
  col += vec3f(0.8, 0.92, 1.0) * front * (0.35 + 0.65 * vnoise(bone.p * 30.0)) * (luma(lightIn) * 0.6 + 0.05);
  var cover = mix(smoothstep(surf.cover.x, surf.cover.y, amount), smoothstep(surf.cover.x * 0.6, surf.cover.y * 0.6, amount), fi);

  // ---------------------------------------------------------------- a puddle: water lying on the floor
  // (water not on a body, at the floor's height: the asleep heap, what a fallen body leaves)
  let film = (1.0 - smoothstep(0.012, 0.045, wp.y - surf.floorY)) * (1.0 - fi) * select(1.0, 0.0, bone.cap < SEGS);
  if (film > 0.0) {
    // flat, but at its edge the meniscus curls down and catches the light
    let full = 0.0035 * surf.cover.z;
    let menisc = 1.0 - smoothstep(0.15, 0.9, amount / full);
    let gw = frame.camRight * gx + normalize(vec3f(frame.camFwd.x, 0.0, frame.camFwd.z) + vec3f(1e-5)) * (-gy);
    let outward = -gw / max(length(gw), 1e-5);
    let Nf = normalize(vec3f(0.0, 1.0, 0.0) + outward * menisc * 1.4 * step(1e-6, length(gw)));
    let Rp = reflect(ray, Nf);
    let cp = clamp(dot(Nf, V), 0.0, 1.0);
    let Fp = 0.02 + 0.98 * pow(1.0 - cp, 5.0);
    // (compressed: a puddle mirrors the sky, but a moon or sun in it must stay a glint, not a white disc)
    let envR = worldEnv(Rp, wp) * surf.reflect;
    let envP = envR / (1.0 + luma(envR) * 0.8);
    let specP = key.col * (pow(max(dot(Rp, key.dir), 0.0), 900.0) * 5.0 + pow(max(dot(Rp, key.dir), 0.0), 40.0) * 0.1) * key.glint;
    let rimP = key.col * pow(1.0 - cp, 2.0) * menisc * smoothstep(-0.2, 0.6, dot(Nf, key.dir)) * 0.6;
    let fc = envP * Fp * 1.2 + (specP + rimP) * surf.glint + fireSpec(wp, Rp, Nf, menisc * 0.6) * surf.glint
           + surf.glow.rgb * surf.glow.w * 0.15 * (0.4 + rp);
    // the floor through it: wet, a little darker and colder
    let ft = vec3f(0.62, 0.74, 0.8) * (1.0 - Fp);
    col = mix(col, fc, film);
    trans = mix(trans, ft, film);
    cover = mix(cover, smoothstep(0.00015, 0.0012, amount), film);
  }
  o.col = col;
  o.trans = trans;
  o.cover = cover;
  o.N = N;
  return o;
}

/** how far the scene behind is bent here (uv): more at the edges, where the surface turns, and by its thickness */
fn bendOf(sh: Shade, d: f32) -> vec2f {
  let side = vec2f(dot(sh.N, frame.camRight), -dot(sh.N, frame.camUp));
  return side * surf.refract * (0.25 + min(sh.amount, 0.3) * 4.0) / max(d * 0.25, 0.4);
}

/** a thick body of water is a lens: the view through it turns toward the body's middle on the way in and again on the
 *  way out (by 2 (θi − θt) at water's index, 1.33), so what stands well behind it is seen drawn in and upside down: the
 *  top of a head shows the ground beneath it, the far side of a limb the near side of the floor. That is what lets
 *  clear water read against a bright, even background (the redwoods' fog at dusk), where what is straight behind it
 *  looks like what is beside it and a straight view shows nothing. Thin water (a sheet, a film) is a flat plate and
 *  bends little (bendOf's small bend is all it gets). The offset in uv to the point the bent view meets, at the depth of
 *  what is behind (od: the opaque distance at this pixel; d: the water's), kept on the screen */
fn lensOf(sh: Shade, uv: vec2f, od: f32, d: f32) -> vec2f {
  let k = surf.lens * smoothstep(0.1, 0.6, sh.amount * surf.cover.w);
  if (k <= 0.0) { return vec2f(0.0); }
  let ray = normalize(sh.wp - frame.camPos);
  let cosI = clamp(dot(sh.N, -ray), 0.0, 1.0);
  let sinI = sqrt(max(1.0 - cosI * cosI, 0.0));
  let dev = min(2.0 * (atan2(sinI, cosI) - asin(sinI / 1.33)) * k, 1.2);
  let tp = sh.N + ray * cosI;
  let tl = length(tp);
  if (tl < 1e-4 || dev < 1e-4) { return vec2f(0.0); }
  let T = ray * cos(dev) - tp / tl * sin(dev);
  // (to the depth of what is straight behind; it is the best guess there is of how far the bent view goes)
  let along = max(dot(ray, frame.camFwd), 0.05);
  let L = clamp((od - d) / along, 0.3, 40.0);
  let c = frame.viewProj * vec4f(sh.wp + T * L, 1.0);
  var to = vec2f(dot(T, frame.camRight), -dot(T, frame.camUp)) * 2.0 + uv;
  if (c.w > 0.05) { to = vec2f(c.x / c.w * 0.5 + 0.5, 0.5 - c.y / c.w * 0.5); }
  return clamp(to, vec2f(0.002), vec2f(0.998)) - uv;
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let sdims = vec2i(textureDimensions(scene));
  let wdims = vec2i(textureDimensions(water));
  let px = vec2i(i.uv * vec2f(sdims));
  let e = edgeAt(i.uv, wdims);
  let W = waterAt(e.q, wdims);
  let s = textureLoad(scene, px, 0);
  if (W.x <= 0.0) { discard; }
  // something solid in front of the water hides it
  if (s.a < W.x - 0.03) { discard; }
  let sh = shade(e.q, wdims, W, e.keep);
  if (sh.cover <= 0.002) { discard; }
  // the scene behind, bent by the surface and apart in colour, and softened: what stands well behind the water is out
  // of focus beside it (the lens blurs it), so seen through the water, which is in focus, it must not come out sharp
  // (the redwoods' fog march showed its grain through every body), and the lens draws it in, which would alias
  let bend = bendOf(sh, W.x) + lensOf(sh, i.uv, s.a, W.x);
  let soft = (surf.soft.x + surf.soft.y * smoothstep(0.1, 0.6, sh.amount * surf.cover.w)) * (1.0 - W.x / max(s.a, W.x + 1e-3)) * f32(sdims.y);
  var behind = vec3f(0.0);
  for (var c = 0; c < 3; c++) {
    let k = 1.0 + (f32(c) - 1.0) * surf.dispersion;
    let a = f32(c) * 2.0944 + 0.4;
    let o = vec2f(cos(a), sin(a)) * soft / vec2f(sdims);
    let uvc = clamp(i.uv + bend * k, vec2f(0.0), vec2f(1.0));
    var t = (textureSampleLevel(scene, samp_linear, uvc + o, 0.0) + textureSampleLevel(scene, samp_linear, uvc - o, 0.0)) * 0.5;
    // what was bent in from in front of the water isn't behind it: take the straight view instead
    if (t.a < W.x) { t = s; }
    behind[c] = t[c];
  }
  // a gem heart behind this pixel shows through: the water in front of it clears and takes its light
  let veil = heartVeil(hearts, sh.wp, frame.camPos);
  let trans = mix(vec3f(0.85, 0.95, 1.0), sh.trans, veil);
  let own = sh.col * mix(0.5, 1.0, veil) + heartLight(hearts, sh.wp) * 0.15 * (1.0 - veil);
  var col = behind * trans + own;
  if (!surfaced()) {
    // A world with no scene step (the geode, the redwoods) fogs its scene once, after the water, at the distance in
    // the scene's alpha: the opaque distance (the depth contract; fire's splat, which runs next, tests it). So a body
    // in front of far fog was fogged as if it stood out there too, and dissolved into it above the horizon (the
    // redwoods' pale heads, a hard line at the horizon, the march's grain over them). Here the water writes what the
    // air will turn into the right pixel: what is behind as the air shows it, through the water; the air between the
    // water and what is behind dimmed by the water like anything else behind it; and the water's own light through
    // the air in front of it only. The air's light and what it lets through, at what is behind, come from fs_fog (a
    // sixteenth of the pixels, where there is water: the march is the air's own); the stretch in front of the water is
    // taken as the same air, thinner by its length
    let f = textureSampleLevel(fog, samp_linear, i.uv, 0.0);
    let A = f.rgb;
    let Tb = vec3f(clamp(f.a, 1e-3, 1.0));
    let r = clamp(W.x / max(s.a, 1e-3), 0.0, 1.0);
    let Tw = pow(Tb, vec3f(r));
    let Aw = select(A * (1.0 - Tw) / max(1.0 - Tb, vec3f(1e-4)), A * r, (1.0 - Tb) < vec3f(1e-3));
    col = behind * trans + (own * Tw - (A - Aw) * (1.0 - trans)) / Tb;
  }
  // colour only: the scene's alpha is its opaque view distance (the focus is fs_focus's; the merge finds the bodies)
  return vec4f(mix(s.rgb, col, sh.cover), s.a);
}

/** the air at what stands behind the water, for fs in a world that fogs after the water (!surfaced()): at a quarter of
 *  the resolution each way, and only in blocks with water in them (two calls of the world's air march each: at full
 *  resolution they cost 0.15 to 0.35 ms at 1080p in the redwoods). rgb the light the air adds as far as the opaque
 *  scene, a what it lets through (the air is affine in the colour: two calls give both) */
@fragment fn fs_fog(i: FullscreenOut) -> @location(0) vec4f {
  let wdims = vec2i(textureDimensions(water));
  let q = vec2i(i.uv * vec2f(wdims));
  let b = max(1, i32(round(f32(wdims.x) / f32(textureDimensions(fog).x))));
  var any = false;
  for (var k = 0; k < 5; k++) {
    let o = select(vec2i(0), vec2i(select(-1, 1, (k & 1) == 0), select(-1, 1, (k & 2) == 0)) * b, k > 0);
    if (textureLoad(water, clamp(q + o, vec2i(0), wdims - 1), 0).x > 0.0) { any = true; }
  }
  if (!any) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let sdims = vec2i(textureDimensions(scene));
  let px = clamp(vec2i(i.uv * vec2f(sdims)), vec2i(0), sdims - 1);
  let s = textureLoad(scene, px, 0);
  let ray = viewRay(i.uv);
  let A = worldAir(vec4f(0.0, 0.0, 0.0, s.a), px, ray);
  let T = worldAir(vec4f(1.0, 1.0, 1.0, s.a), px, ray) - A;
  return vec4f(A, clamp(dot(T, vec3f(1.0 / 3.0)), 0.0, 1.0));
}

/** whether this world surfaces its scene (its scene step and air) before the water composites (src/post/post.ts
 *  sceneStep: the Pool, the temple): then the copy the water bends is the finished, fogged world */
fn surfaced() -> bool { return WORLD >= 2u && WORLD <= 3u; }

struct SceneOut { @location(0) c: vec4f, @builtin(frag_depth) depth: f32 }

fn depthAt(wp: vec3f) -> f32 {
  let c = frame.viewProj * vec4f(wp, 1.0);
  return clamp(c.z / c.w, 0.0, 1.0);
}

@fragment fn fs_scene(i: FullscreenOut) -> SceneOut {
  let wdims = vec2i(textureDimensions(water));
  let e = edgeAt(i.uv, wdims);
  let W = waterAt(e.q, wdims);
  let sh = shade(e.q, wdims, W, e.keep);
  if (sh.cover <= 0.002) { discard; }
  var o: SceneOut;
  // premultiplied over what is there (the colour blend), alpha untouched (the alpha blend keeps it)
  let veil = heartVeil(hearts, sh.wp, frame.camPos);
  let hide = (1.0 - dot(sh.trans, vec3f(0.3, 0.4, 0.3))) * veil;
  o.c = vec4f(sh.col * mix(0.5, 1.0, veil) * sh.cover, sh.cover * hide);
  o.depth = depthAt(sh.wp);
  return o;
}

@fragment fn fs_mirror(i: FullscreenOut) -> SceneOut {
  let wdims = vec2i(textureDimensions(water));
  let e = edgeAt(i.uv, wdims);
  let W = waterAt(e.q, wdims);
  let sh = shade(e.q, wdims, W, e.keep);
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

struct FocusOut { @location(0) focus: vec4f, @location(1) body: vec4f }

/** the focus (the surface's view distance where it shows, 1e5 elsewhere) and the body texture (MatterPasses.body,
 *  matter/core/kind.ts): r the water's view distance (1e4: none), g how much of the light behind it comes through
 *  (0 … 1), ba how far this pixel's view through the water is bent (uv). For light laid over the scene after the water
 *  (the fire's glow, which the air adds): where that light is further than r, the air samples it at uv + ba and
 *  multiplies it by g */
@fragment fn fs_focus(i: FullscreenOut) -> FocusOut {
  let sdims = vec2i(textureDimensions(scene));
  let wdims = vec2i(textureDimensions(water));
  let q = clamp(vec2i(i.uv * vec2f(wdims)), vec2i(0), wdims - 1);
  let W = textureLoad(water, q, 0);
  let s = textureLoad(scene, clamp(vec2i(i.uv * vec2f(sdims)), vec2i(0), sdims - 1), 0);
  let amount = W.y * surf.cover.z;
  // (where the composite shows it half or more: the smoothed thickness reaches a little past the outline, and there the
  // lens focused on the water's distance would show the far air's march grain sharp in a halo round the body)
  let there = W.x > 0.0 && amount > (surf.cover.x + surf.cover.y) * 0.5 && s.a >= W.x - 0.03;
  var o: FocusOut;
  o.focus = vec4f(select(1e5, W.x, there), 0.0, 0.0, 1.0);
  o.body = vec4f(1e4, 1.0, 0.0, 0.0);
  if (there) {
    // a cheap version of shade's: the thickness's slope for the bend, its absorption and milk for what comes through
    let Wr = amount * surf.cover.w;
    let st = i32(max(2.0, round(f32(wdims.y) / 300.0)));
    let gx = textureLoad(water, clamp(q + vec2i(st, 0), vec2i(0), wdims - 1), 0).y - textureLoad(water, clamp(q - vec2i(st, 0), vec2i(0), wdims - 1), 0).y;
    let gy = textureLoad(water, clamp(q + vec2i(0, st), vec2i(0), wdims - 1), 0).y - textureLoad(water, clamp(q - vec2i(0, st), vec2i(0), wdims - 1), 0).y;
    let k = surf.cover.w * surf.cover.z * 36.0 / f32(st) * f32(wdims.y) / 800.0;
    let side = normalize(vec3f(-gx * k, gy * k, 1.0));
    let bend = vec2f(side.x, -side.y) * surf.refract * (0.25 + min(amount, 0.3) * 4.0) / max(W.x * 0.25, 0.4);
    let frost = clamp(W.w / max(W.y, 1e-5), 0.0, 1.0);
    let milk = surf.tint.w * (1.0 - exp(-surf.absorb.w * Wr));
    let wt = dot(exp(-surf.absorb.rgb * Wr), vec3f(0.3, 0.4, 0.3)) * (1.0 - milk);
    let cover = smoothstep(surf.cover.x, surf.cover.y, amount);
    o.body = vec4f(W.x, mix(1.0, mix(wt, 1.0 - surf.iceOpacity, smoothstep(0.25, 0.75, frost)), cover), bend);
  }
  return o;
}
