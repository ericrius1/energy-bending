// World light: what matter drawn in a world sees and is lit by, chosen per pipeline. A shader that includes this
// file gets the worlds' light through the shared light group (group 2, made by worlds/shared.ts) and these functions,
// which switch on the WORLD override constant. A draw sets it with `constants: { WORLD: world.light }`; weft compiles
// one pipeline per value, so the switch costs nothing per pixel.
//
// The group is one uniform buffer, `worldLight` (WorldLight below), plus the water worlds' ripple textures. WorldLight has
// one member per world, its slot, which only that world writes (worlds/shared.ts lightSlot), and one for the dancers'
// fire. So the group takes one uniform buffer however many worlds there are, and every view reads its own world's
// slot: the main view of the geode and a gate's view of the redwoods, drawn in the same kit.run, read two slots of the
// same buffer, each written once that frame by its world. WebGPU's baseline allows 12 uniform buffers per shader stage
// and 64 KiB per uniform binding; `npm test` (scripts/check-bindings.mjs) counts both.
//
// Adding a world: give it a light number, write its light struct and functions in its own folder's .wgsl, include
// that file below, add its struct as the next member of WorldLight, and add its case to each function. (WGSL has no
// registry, so this file is the one place outside a world's folder that a new world touches. The TypeScript side needs
// nothing outside the folder: the world takes its slot with `lightSlot(kit, 'name')`, the member's name.)
//
// The near fade rides here too (`sight`, filled by worlds/fade.ts): a world's solid draws call `sightDrop(p, px)` and
// discard, so a column, a trunk, a stub or a blade near the eye or standing between it and the dancers is dissolved,
// pixel by pixel, instead of filling the frame; in the duel so is a piece standing in the near part of the frame, its
// edges kept (`sightLit` makes them a faint line of light). Opaque stays opaque: what is left is drawn whole, with its
// distance in alpha (the depth contract), and what is dropped shows what stands behind it. No binding of its own.
#include "weft/frame"
#include "weft/lodfade"
#include "../engine/limits"
#include "../engine/util"
#include "./water/water"
#include "./geode/geode"
#include "./redwoods/forest"
#include "./pool/pool"
#include "./temple/temple"
#include "../matter/fire/light"

/** the light of every world, a slot each, and the dancers' own. A new world appends its member */
struct WorldLight {
  /** the dancers' fire (and plasma as its violet form): one point light per flame dancer, filled each frame by the fire
   *  kind (matter/fire/lights.ts), so every world's surfaces take it */
  fire: FireLights,
  geode: Geode,
  forest: Forest,
  pool: Pool,
  temple: Temple,
  /** what the main view may fade (worlds/fade.ts): not a world's */
  sight: Sight,
}

/** a body the camera frames, as the near fade sees it: an upright capsule from `lo` (its feet: below this height
 *  nothing fades, it is the floor it stands on) to `hi` (its top) of radius lo.w; hi.w how strongly what stands
 *  between the eye and it is faded now (0 … 1, eased by the CPU; 0: this one is off) */
struct SightBody { lo: vec4f, hi: vec4f }
/** a piece the frame test dissolves (worlds/fade-frame.ts: one standing in the near part of the duel's frame): a box
 *  (a.xyz its middle, x.xyz and y.xyz two of its unit axes, h.xyz its half sizes) or, x.w 1, a capsule (a.xyz to x.xyz,
 *  radius h.w); a.w how strongly (0 … 1; 0: an empty slot) */
struct SightPiece { a: vec4f, x: vec4f, y: vec4f, h: vec4f }
/** the near fade: the framed bodies; k.x: fade within this of the eye (m), k.y: the height below which nothing fades
 *  near the eye, k.z: how strongly (0 … 1), k.w: 1 while anything may fade (0: the draws skip it all); the pieces the
 *  frame test dissolves; f.x: nothing further from the eye than this dissolves as a piece (the pair's own depth), f.w: 1
 *  while any piece dissolves; glow.rgb: the light a dissolved piece's outline adds (the arena's rim light) */
struct Sight { body: array<SightBody, 2>, k: vec4f, piece: array<SightPiece, 16>, f: vec4f, glow: vec4f }

@group(2) @binding(0) var<uniform> worldLight: WorldLight;
// the ripples' height fields of the worlds with water (each world's own texture, in its World.shared)
@group(2) @binding(1) var poolWaves: texture_2d<f32>;
@group(2) @binding(2) var templeWaves: texture_2d<f32>;

/** which world lights this pipeline: 0 the geode, 1 the redwoods, 2 the pool, 3 the temple (each World's `light`) */
override WORLD: u32 = 0u;

/** the key light on matter at p: towards it, its colour × strength (with what the world does to it there), the same
 *  plain (for a dim reflection), and how bright glints may get */
struct KeyLight { dir: vec3f, col: vec3f, plain: vec3f, glint: f32 }

/** what matter at p reflects in direction d */
fn worldEnv(d: vec3f, p: vec3f) -> vec3f {
  if (WORLD == 1u) { return woodsEnv(d, p); }
  if (WORLD == 2u) { return poolEnv(d, p); }
  if (WORLD == 3u) { return templeEnv(d, p); }
  return studio(d);
}

/** the dancers' fire (and plasma) on a world's surface at p facing n: every world's own shading adds it (the stone,
 *  the trunks, the floors; matter a quarter of it, through worldAmbient, so a body of flame doesn't light itself) */
fn worldFire(p: vec3f, n: vec3f) -> vec3f { return fireLightAt(worldLight.fire, p, n); }

/** the soft light on a surface facing N, dimmed in crevices (ao) */
fn worldAmbient(N: vec3f, ao: f32, p: vec3f) -> vec3f {
  // (the woods' lampLight carries the dancers' fire too; the temple adds it at the weight it's given)
  if (WORLD == 1u) { return woodsAmbient(N) * (0.25 + 0.75 * ao) * 1.6 + lampLight(p, N, 0.2) * 0.5; }
  if (WORLD == 2u) { return poolAmbient(N, ao) + worldFire(p, N) * 0.25; }
  if (WORLD == 3u) { return templeAmbient(N, ao, p, 0.25); }
  return geodeAmbient(N, ao) + worldFire(p, N) * 0.25;
}

/** the key light at p (fine: worth the finer detail; fixture: one of a world's own fixed pieces) */
fn worldKey(p: vec3f, fine: bool, fixture: f32) -> KeyLight {
  var k: KeyLight;
  if (WORLD == 1u) {
    // the sun (or the moon) through the leaves and past the trunks; glints only as bright as it is
    let reach = worldLight.forest.key.w * keyLight(p);
    k.dir = worldLight.forest.key.xyz;
    k.col = worldLight.forest.keyCol.rgb * reach * 0.3;
    k.plain = k.col;
    k.glint = clamp(reach * 0.35, 0.0, 1.4);
    return k;
  }
  if (WORLD == 2u) {
    // the faint light from above
    k.dir = normalize(worldLight.pool.key.xyz);
    k.col = worldLight.pool.keyCol.rgb * worldLight.pool.key.w;
    k.plain = k.col;
    k.glint = 0.8;
    return k;
  }
  if (WORLD == 3u) {
    // the moon, low behind the stage, and the pillars' shadows
    k.dir = worldLight.temple.moon.xyz;
    k.plain = worldLight.temple.moonCol.rgb * worldLight.temple.moonCol.w;
    k.col = k.plain * templeShadow(p);
    k.glint = 1.2;
    return k;
  }
  k.dir = normalize(worldLight.geode.key.xyz);
  k.plain = vec3f(1.0, 0.96, 0.9) * worldLight.geode.key.w * 0.11;
  k.col = k.plain * geodeKeyNet(p, fine, fixture);
  k.glint = 1.0;
  return k;
}

/** the rim light: colour, w how strong */
fn worldRim() -> vec4f {
  if (WORLD == 1u) { return worldLight.forest.rim; }
  if (WORLD == 2u) { return vec4f(worldLight.pool.glow.rgb, worldLight.pool.keyCol.w); }
  if (WORLD == 3u) { return vec4f(worldLight.temple.moonCol.rgb, worldLight.temple.moonCol.w * 2.0); }
  return worldLight.geode.rim;
}

/** how a world tints its own fixed pieces (fade: dimmer away from the light) */
fn worldFixtureTint(p: vec3f, fade: bool) -> vec3f {
  if (WORLD == 1u) { return vec3f(1.0); }
  if (WORLD >= 2u) { return vec3f(1.0); }
  return geodeFixtureTint(p, fade);
}

/** the light in the air over the scene `s` (alpha: its view distance) along the view ray d */
fn worldAir(s: vec4f, px: vec2i, d: vec3f) -> vec3f {
  if (WORLD == 1u) { return woodsAir(s, px, d); }
  if (WORLD == 2u) { return poolAir(s, px, d); }
  if (WORLD == 3u) { return templeAir(s, px, d); }
  return geodeAir(s, px, d);
}

/** the scene at pixel px as the world shows it, before its air: most worlds show it as drawn; a world with water lays
 *  the surface over what was seen through it (the reflections, bent by the ripples).
 *  Only the air pass calls this (src: the scene it reads, alpha the view distance) */
fn worldScene(src: texture_2d<f32>, px: vec2i, d: vec3f) -> vec4f {
  if (WORLD == 2u) { return poolScene(src, px, d); }
  if (WORLD == 3u) { return templeScene(src, px, d); }
  return textureLoad(src, px, 0);
}

/** how much of a dissolved piece's outline is at this fragment (sightFade sets it, sightLit reads it) */
var<private> sightEdge: f32 = 0.0;

/** how much of a world's solid thing at p the camera fades away (0 … 1): what is near the eye, what stands well in
 *  front of a framed body across the line of sight to it, and (the duel) a piece standing in the near part of the
 *  frame, whole but for its edges. Only in the view that `sight` describes (the main view sets frame.user.x to 1,
 *  worlds/fade.ts; a gate's view, the inset leave it 0), and only while worlds/fade.ts finds something to fade (k.w),
 *  so most frames it costs one uniform branch. Call it in uniform control flow (first in the fragment shader): a
 *  piece's outline takes the surface's facet from the derivatives */
fn sightFade(p: vec3f) -> f32 {
  let K = worldLight.sight.k;
  if (frame.user.x < 0.5 || K.w <= 0.0) { return 0.0; }
  let e = fromEye(p);
  let dist = length(e);
  // near the eye (above the floor under it)
  var f = select(0.0, (1.0 - smoothstep(K.x * 0.5, K.x, dist)) * K.z, p.y > K.y);
  let d = e / max(dist, 1e-4);
  // the pieces in the near part of the frame: the whole piece dissolves (patch by patch, a front moving through a noise
  // in the stone as its strength rises, so a half-dissolved piece is whole patches and holes, not a screen door the lens
  // blurs into a veil), but its edges and its outline against what is behind (where the surface turns away from the
  // eye) stay as a faint line, which sightLit brightens; no line within a metre of the eye (there it is only a blur), and
  // nothing at the pair's own depth
  let F = worldLight.sight.f;
  if (F.w > 0.0) {
    let facet = normalize(cross(dpdx(p), dpdy(p)));
    let rim = 1.0 - smoothstep(0.06, 0.18, abs(dot(facet, d)));
    let w = clamp(dist * 0.003, 0.01, 0.04);
    let away = 1.0 - smoothstep(F.x - 0.6, F.x, dist);
    let faint = smoothstep(0.6, 1.4, dist);
    let grain = vnoise(p * 2.7);
    for (var j = 0u; j < 16u; j++) {
      let P = worldLight.sight.piece[j];
      if (P.a.w <= 0.0) { continue; }
      var out = 0.0;
      var line = rim;
      if (P.x.w > 0.5) {
        let ab = P.x.xyz - P.a.xyz;
        let t = clamp(dot(p - P.a.xyz, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        out = length(p - P.a.xyz - ab * t) - P.h.w;
      } else {
        let l = p - P.a.xyz;
        let z = cross(P.x.xyz, P.y.xyz);
        // how far in from each face: on a face the least is about 0, on an edge the middle one is too. A surface on the
        // box's faces (a blade, a beam, a slab) keeps its edges; one inside it (a round column stood in for by a box) keeps
        // its outline against what is behind, where it turns away from the eye
        let q = P.h.xyz - abs(vec3f(dot(l, P.x.xyz), dot(l, P.y.xyz), dot(l, z)));
        out = -min(q.x, min(q.y, q.z));
        let mid = q.x + q.y + q.z - min(q.x, min(q.y, q.z)) - max(q.x, max(q.y, q.z));
        let edge = 1.0 - smoothstep(w, w * 2.0, max(mid, 0.0));
        line = max(edge, rim * smoothstep(0.03, 0.06, -out));
      }
      if (out > 0.12) { continue; }
      let k = smoothstep(grain - 0.08, grain + 0.08, P.a.w * 1.2 - 0.1) * away;
      line *= faint;
      f = max(f, k * (1.0 - 0.7 * line));
      sightEdge = max(sightEdge, k * line);
    }
  }
  for (var k = 0u; k < 2u; k++) {
    let b = worldLight.sight.body[k];
    if (b.hi.w <= 0.0 || p.y < b.lo.y + 0.12) { continue; }
    // the ray from the eye through p at its closest to the body's axis: within its radius, and p well before it
    let A = b.lo.xyz - frame.camPos - frame.camLo;
    let u = b.hi.xyz - b.lo.xyz;
    let bu = dot(d, u);
    let uu = max(dot(u, u), 1e-6);
    let den = uu - bu * bu;
    var t = 0.5;
    if (den > 1e-6) { t = clamp((bu * dot(d, A) - dot(u, A)) / den, 0.0, 1.0); }
    let q = A + u * t;
    let s = dot(d, q);
    let off = length(q - d * max(s, 0.0));
    let r = b.lo.w;
    let across = 1.0 - smoothstep(r * 0.45, r * 1.1, off);
    let before = 1.0 - smoothstep(s - r * 0.5 - 0.55, s - r * 0.5 - 0.15, dist);
    f = max(f, across * before * b.hi.w);
  }
  return f;
}

/** whether a solid draw's fragment at p (pixel px) is dropped by the near fade: a dither (weft/lodfade's interleaved
 *  noise), so a half-faded column is half its pixels, and MSAA's resolve softens the dots. Call it first in the
 *  fragment shader, in uniform control flow: `if (sightDrop(i.wp, i.pos.xy)) { discard; }` */
fn sightDrop(p: vec3f, px: vec2f) -> bool {
  let f = sightFade(p);
  return f > 0.0 && f > ign(px) * 0.98 + 0.01;
}

/** a solid draw's colour with what is left of a dissolved piece (its edges) glowing a little in the arena's rim light,
 *  so the piece reads as a faint line of light. After sightDrop: `return vec4f(sightLit(col), …)` */
fn sightLit(c: vec3f) -> vec3f {
  if (sightEdge <= 0.0) { return c; }
  return c * (1.0 + 0.6 * sightEdge) + worldLight.sight.glow.rgb * sightEdge;
}
