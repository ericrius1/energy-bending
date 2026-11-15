// The light in the air, per view, and the frame's depth contract.
//
// The scene comes in two targets (engine/views.ts): the opaque scene, whose alpha is the opaque view distance
// (written by opaque draws only), and `glow`, what translucent matter added on top (flames, sparks, motes, drops),
// whose alpha is the nearest distance a glow min-blended there, if any (NO_FOCUS where none; 0 reads as none too, so
// a view whose glow pass was skipped can bind a cleared 1×1 texture). Translucent kinds may also hand over focus
// textures (MatterPasses.focus: r16float, any size, the view distance where the matter is dense enough to focus on,
// 1e5 elsewhere), bound here as focus0..2. Each slot is a body's (water, ice: matter that hides what is behind it) or a
// light's (fire, plasma: light added into the glow target); `airv.bodies` says which (src/post/post.ts fills it). A
// third sort is a window's (`airv.windows`: a live gate's disc, PostChain.focusFrom): where it holds a distance, the
// depth of field takes it in place of the opaque one (what is seen through the gate is that far), the fog never does.
//
// Surfaces, reflections and the fog test against the opaque distance: the world's scene step (worldScene: the pool's
// and the temple's water) and its air (worldAir) see the opaque scene, never the glow, so a flame
// can't cut a hole in the water behind it; the glow is laid over afterwards, fogged as far as it is (the nearer of its
// own distance and the opaque one).
//
// Two things happen to the glow before it is laid over (fs, fs_main):
//   behind a body   where a light's focus distance lies behind a body's (fire behind a water dancer), the glow is seen
//                   through the body: dimmed by what the body lets through, tinted, and moved by the body's
//                   refraction. A body kind may say all three per pixel with a body texture (`body`, post.ts
//                   MatterPasses.body); without one, `airv.through` and `airv.tint` and no offset. A light in front of the
//                   body (or of unknown distance: a thin flame's edge) still glows over it
//   on the water    fire's mirror copy (splatted below the floor about World.waterY, a perfect mirror) is bent by the
//                   water's wave normal and spread by its roughness the way the march bends and spreads what the
//                   water mirrors (water/water.wgsl waterReflect, waterMirrorBend), so the fire's reflection ripples
//                   with the columns'
//
// The water bodies (matter/water) are composited in between, for the main view and the inset, in three steps:
//   'surface'  fs_surface: the world's scene step and air on the opaque scene (`src`, a copy kept as `opaque`), into
//              the air target, copied back over the scene: what a water body refracts is the finished, fogged world
//   'air'      matter/water composites its bodies over the scene
//              fs_merge: the opaque scene again, with each water body where one was composited (told by where the
//              scene now differs from the surfaced world), at the nearer of the opaque distance and the bodies' focus
//              distance, so the pool's water mirrors the bodies; into `merged`
//              fs_main: the world's scene step and air again over `merged`, and the glow
// A gate's view (no water bodies) runs only fs.
//
// Out: the air target (rgb; alpha the opaque distance, or a water body's, which steam tests against), and for the
// main view the focus target (r16float): the distance the depth of field puts each pixel at, the nearer of the opaque
// surface and any translucent matter dense enough to focus on.
//
// It is also the first pass after the scene, so a broken pixel (NaN, infinity) is caught here and stays one dark
// pixel instead of spreading into a square in the blur and the bloom.
#include "weft/frame"
#include "weft/fullscreen"
#include "../worlds/light"

/** what one view's air needs to know besides its textures (one uniform per view: post.ts) */
struct AirView {
  bodies: u32,      // bit k set: focus slot k is a body's (water, ice), else a light's (fire)
  hasBody: f32,     // 1: `body` is a body kind's texture (r distance, g let through, ba refraction offset in uv)
  through: f32,     // without one: how much of a light behind a body shows through it (0 … 1)
  bend: f32,        // how much fire's mirror copy on the water is bent by the waves (0: a still mirror, 1: as the march)
  tint: vec4f,      // rgb: the colour a body lays over the light behind it
  windows: u32,     // bit k set: focus slot k is a window's (a gate's far view, portals/focus.wgsl), neither of the above
}

@group(1) @binding(0) var src: texture_2d<f32>;
@group(1) @binding(1) var glow: texture_2d<f32>;
@group(1) @binding(2) var focus0: texture_2d<f32>;
@group(1) @binding(3) var focus1: texture_2d<f32>;
@group(1) @binding(4) var focus2: texture_2d<f32>;
/** (fs_merge) the opaque scene as drawn, and the surfaced world fs_surface made of it */
@group(1) @binding(5) var opaque: texture_2d<f32>;
@group(1) @binding(6) var surfaced: texture_2d<f32>;
@group(1) @binding(7) var<uniform> airv: AirView;
/** a body kind's own say (MatterPasses.body, matter/core/kind.ts), else a 1×1 stand-in (airv.hasBody 0) */
@group(1) @binding(8) var bodyTex: texture_2d<f32>;

/** a distance beyond this is "nothing here" (the glow clears to 1e4, focus textures hold 1e5: infinity in a half) */
const FAR_FOCUS = 5000.0;

/** a NaN or an infinity, told by its bits (no fast maths can fold that away) */
fn broken(c: vec4f) -> bool { return any((bitcast<vec4u>(c) & vec4u(0x7f800000u)) == vec4u(0x7f800000u)); }
fn broken1(x: f32) -> bool { return (bitcast<u32>(x) & 0x7f800000u) == 0x7f800000u; }

/** a focus distance read from a texture of any size (nothing: FAR_FOCUS); o: an offset in that texture's texels */
fn focusAt(t: texture_2d<f32>, uv: vec2f, o: vec2i) -> f32 {
  let d = vec2f(textureDimensions(t));
  let v = textureLoad(t, clamp(vec2i(uv * d) + o, vec2i(0), vec2i(d) - 1), 0).r;
  return select(v, FAR_FOCUS, broken1(v) || v <= 0.0 || v > FAR_FOCUS);
}
/** the nearest of the slots whose bit in `mask` is set */
fn focusOf(uv: vec2f, mask: u32, o: vec2i) -> f32 {
  var n = FAR_FOCUS;
  if ((mask & 1u) != 0u) { n = min(n, focusAt(focus0, uv, o)); }
  if ((mask & 2u) != 0u) { n = min(n, focusAt(focus1, uv, o)); }
  if ((mask & 4u) != 0u) { n = min(n, focusAt(focus2, uv, o)); }
  return n;
}
fn focusNear(uv: vec2f) -> f32 { return focusOf(uv, 7u & ~airv.windows, vec2i(0)); }
/** the nearest body (water, ice) at uv: its own texture's distance if it hands one over, else its focus slot */
fn bodyNear(uv: vec2f) -> f32 {
  var n = focusOf(uv, airv.bodies, vec2i(0));
  if (airv.hasBody > 0.5) { n = min(n, focusAt(bodyTex, uv, vec2i(0))); }
  return n;
}
/** the nearest light (fire) at uv and round it: a thin flame's edge, too faint to focus on, takes the distance of the
 *  dense flame beside it (the nearest wins, so the edge of a flame in front of a body stays in front) */
fn lightNear(uv: vec2f) -> f32 {
  let m = 7u & ~(airv.bodies | airv.windows);
  var n = focusOf(uv, m, vec2i(0));
  for (var k = 0; k < 6; k++) {
    let a = f32(k) * 1.0471976;
    n = min(n, focusOf(uv, m, vec2i(round(vec2f(cos(a), sin(a)) * 5.0))));
  }
  return n;
}
/** how much of the light at uv lies behind a body at distance bodyD (0 … 1): a vote of the light's focus here and
 *  round it (two rings, so the half-resolution focus texture's blocks blend into a soft edge); a tap with no light
 *  dense enough to focus on doesn't vote. Where none does (thin flame all round), `unsure` */
fn lightBehind(uv: vec2f, bodyD: f32, unsure: f32) -> f32 {
  let m = 7u & ~(airv.bodies | airv.windows);
  var vote = 0.0;
  var n = 0.0;
  for (var k = 0; k < 13; k++) {
    var o = vec2f(0.0);
    if (k > 0) {
      let a = f32(k) * 2.39996323;
      o = vec2f(cos(a), sin(a)) * select(2.5, 6.0, k > 6);
    }
    let d = focusOf(uv, m, vec2i(round(o)));
    if (d >= FAR_FOCUS) { continue; }
    vote += smoothstep(bodyD + 0.03, bodyD + 0.15, d);
    n += 1.0;
  }
  return select(vote / max(n, 1.0), unsure, n < 0.5);
}

/** the scene at px as the world shows it, before its air */
fn sceneAt(px: vec2i, uv: vec2f) -> vec4f {
  var s = worldScene(src, px, viewRay(uv));
  if (broken(s)) { s = vec4f(0.0, 0.0, 0.0, 80.0); }
  return s;
}

/** where the view ray d meets the world's water in front of the scene `s` (the Pool's, the temple's tide): the point,
 *  the wave normal there, the distance along the ray (t < 0: none) and the water's height */
struct WaterAt { p: vec3f, t: f32, n: vec3f, wy: f32 }
fn waterAt(s: vec4f, d: vec3f) -> WaterAt {
  var o: WaterAt;
  o.t = -1.0;
  if (WORLD == 2u) {
    let w = worldLight.pool.water;
    let h = waterHit(s, d, w.x);
    if (h.w < 0.0) { return o; }
    o.p = h.xyz; o.t = h.w; o.wy = w.x;
    o.n = waveNormal(poolWaves, worldLight.pool.waves, h.xz, w.z, w.w, h.w, worldLight.pool.march.z);
  } else if (WORLD == 3u) {
    let w = worldLight.temple.water;
    let h = waterHit(s, d, w.x);
    if (h.w < 0.0) { return o; }
    o.p = h.xyz; o.t = h.w; o.wy = w.x;
    o.n = waveNormal(templeWaves, worldLight.temple.waves, h.xz, w.z, w.w, h.w, worldLight.temple.fire.y);
  }
  return o;
}

fn glowAt(uv: vec2f) -> vec3f {
  let c = textureSampleLevel(glow, samp_linear, uv, 0.0).rgb;
  return select(c, vec3f(0.0), broken(vec4f(c, 0.0)));
}

/** the glow at this pixel as it should be laid over the scene `s`: fire's mirror copy bent by the waves, and light
 *  behind a body seen through it */
fn glowSeen(g0: vec3f, s: vec4f, uv: vec2f, d: vec3f) -> vec3f {
  var g = g0;
  if (dot(g, g) <= 0.0) { return g; }
  let lightD = lightNear(uv);
  let along = max(dot(d, frame.camFwd), 1e-3);
  // on the water: a light whose distance is past the surface (or unknown) is the mirror copy
  if ((WORLD == 2u || WORLD == 3u) && airv.bend > 0.0) {
    let w = waterAt(s, d);
    if (w.t > 0.0 && lightD > w.t * along + 0.05) {
      let r0 = reflect(d, w.n);
      let r = normalize(vec3f(r0.x, max(r0.y, 0.003), r0.z));
      let rf = normalize(vec3f(d.x, max(-d.y, 0.003), d.z));
      // how far along the reflected ray the flame stands: from its focus distance, else about a body's reach
      var tf = 1.0;
      if (lightD < FAR_FOCUS) { tf = clamp(lightD / along - w.t, 0.05, 20.0); }
      let spread = clamp(length(r - rf) * 0.6 + tf * 0.006, 0.002, 0.3);
      var acc = vec3f(0.0);
      var ws = 0.0;
      for (var k = 0; k < 3; k++) {
        let o = f32(k) - 1.0;
        let wk = select(1.0, 0.6, k != 1);
        let rk = normalize(vec3f(r.x, max(r.y + o * spread, 0.002), r.z));
        acc += glowAt(uv + waterMirrorBend(w.p, rk, tf, w.wy, uv)) * wk;
        ws += wk;
      }
      g = mix(g, acc / ws, airv.bend);
    }
  }
  // behind a body: seen through it
  let bodyD = bodyNear(uv);
  if (bodyD < FAR_FOCUS) {
    // (no flame dense enough anywhere round: a thin flame over a body is more often behind it, its own body hidden)
    let behind = lightBehind(uv, bodyD, 0.7);
    if (behind > 0.0) {
      var through = airv.through;
      var seen = g;
      if (airv.hasBody > 0.5) {
        let bd = vec2f(textureDimensions(bodyTex));
        let b = textureLoad(bodyTex, clamp(vec2i(uv * bd), vec2i(0), vec2i(bd) - 1), 0);
        through = clamp(b.g, 0.0, 1.0);
        if (any(b.ba != vec2f(0.0))) { seen = glowAt(uv + clamp(b.ba, vec2f(-0.1), vec2f(0.1))); }
      }
      g = mix(g, seen * through * airv.tint.rgb, behind);
    }
  }
  return g;
}

struct Air { col: vec3f, opaque: f32, focus: f32 }

fn air(i: FullscreenOut) -> Air {
  let px = vec2i(i.uv * vec2f(textureDimensions(src)));
  let d = viewRay(i.uv);
  let s = sceneAt(px, i.uv);
  let gd = vec2i(textureDimensions(glow));
  var g = textureLoad(glow, clamp(vec2i(i.uv * vec2f(gd)), vec2i(0), gd - 1), 0);
  if (broken(vec4f(g.rgb, 0.0))) { g = vec4f(0.0, 0.0, 0.0, FAR_FOCUS); }
  // the nearest translucent matter dense enough to focus on: a glow's own distance (0: none), the focus textures
  let near = min(select(g.a, FAR_FOCUS, broken1(g.a) || g.a <= 0.0 || g.a > FAR_FOCUS), focusNear(i.uv));
  let fd = min(s.a, near);
  let gc = glowSeen(g.rgb, s, i.uv, d);
  var o: Air;
  o.opaque = s.a;
  // (through a live gate's disc the lens focuses as far as what is seen there; the air above fogs to the disc)
  let win = focusOf(i.uv, airv.windows, vec2i(0));
  o.focus = min(select(s.a, win, win < FAR_FOCUS), near);
  if (dot(gc, gc) <= 0.0 || fd >= s.a * 0.98) {
    // the glow as far as the surface behind it (the air is affine in the colour: one call)
    o.col = worldAir(vec4f(s.rgb + gc, s.a), px, d);
  } else {
    // the glow nearer: fogged as far as it is (what the air adds at that distance taken away again)
    o.col = worldAir(s, px, d) + worldTransmission(gc, fd, px, d);
  }
  // (behind a fusion's flower the world dims a little, never the glow: worlds/answer.wgsl answerVeil, report 20)
  let veil = answerVeil(s.a, d);
  if (veil < 1.0) { o.col -= (1.0 - veil) * (worldAir(s, px, d) - answerLight(s.a, d)); }
  return o;
}

/** step one (main view, inset): the world's scene step and its air on the opaque scene alone */
@fragment fn fs_surface(i: FullscreenOut) -> @location(0) vec4f {
  let px = vec2i(i.uv * vec2f(textureDimensions(src)));
  let s = sceneAt(px, i.uv);
  return vec4f(worldAir(s, px, viewRay(i.uv)), s.a);
}

/** step two: the opaque scene with the water bodies in it. `src` is the scene after the bodies were composited over
 *  the surfaced world; where it differs from that world, a body is there (its own colour, at its distance) */
@fragment fn fs_merge(i: FullscreenOut) -> @location(0) vec4f {
  let px = vec2i(i.uv * vec2f(textureDimensions(src)));
  let x = textureLoad(src, px, 0);
  let s = textureLoad(surfaced, px, 0);
  let o = textureLoad(opaque, px, 0);
  let dc = abs(x.rgb - s.rgb);
  let isBody = x.a < s.a - 0.01 || max(dc.r, max(dc.g, dc.b)) > 1e-3 * (1.0 + max(s.r, max(s.g, s.b)));
  if (!isBody) { return o; }
  // (the bodies' distance only: a flame in front of a water body is not where the body is)
  return vec4f(x.rgb, min(x.a, bodyNear(i.uv)));
}

/** a view whose depth of field nobody reads (a gate's, the inset): the air alone */
@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let a = air(i);
  return vec4f(a.col, a.opaque);
}

struct MainOut { @location(0) col: vec4f, @location(1) focus: vec4f }
/** the main view: the air, and the focus target for the lens */
@fragment fn fs_main(i: FullscreenOut) -> MainOut {
  let a = air(i);
  var o: MainOut;
  o.col = vec4f(a.col, a.opaque);
  o.focus = vec4f(min(a.focus, 60000.0), 0.0, 0.0, 1.0);
  return o;
}
