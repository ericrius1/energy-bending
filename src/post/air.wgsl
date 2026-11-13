// The light in the air, per view, and the frame's depth contract.
//
// The scene comes in two targets (engine/views.ts): `src`, the opaque scene, whose alpha is the opaque view distance
// (written by opaque draws only), and `glow`, what translucent matter added on top (flames, sparks, motes, drops),
// whose alpha is the nearest distance a flame min-blended there, if any (NO_FOCUS where none; fire's legacy, until its
// focus texture replaces it). Translucent kinds may also hand over focus textures (MatterPasses.focus: r16float, any
// size, the view distance where the matter is dense enough to focus on, 1e5 elsewhere), bound here as focus0..2.
//
// Surfaces, reflections and the fog test against the opaque distance: the world's scene step (worldScene: the pool's
// and the temple's water, the forge's heat) and its air (worldAir) run on the opaque scene alone, before anything
// translucent is added, so a flame or a water body can't cut a hole in the water behind it. For the main view and the
// inset that is a pass of its own (fs_surface, in the 'surface' stage), so the water bodies composited next
// (matter/water, at the start of 'air') refract the finished, fogged world; then this pass (SCENE 0) lays the glow over
// it, fogged as far as the glow is (the nearer of its own distance and the opaque one). A gate's view does all of it
// here in one pass (SCENE 1).
//
// Out: the air target (rgb; alpha the opaque distance, which steam tests against), and for the main view the focus
// target (r16float): the distance the depth of field puts each pixel at, the nearer of the opaque surface and any
// translucent matter dense enough to focus on.
//
// It is also the first pass after the scene, so a broken pixel (NaN, infinity) is caught here and stays one dark
// pixel instead of spreading into a square in the blur and the bloom.
#include "weft/frame"
#include "weft/fullscreen"
#include "../worlds/light"

/** 1: the world's scene step and its air run here (a view with no surface pass of its own: a gate's); 0: the surface
 *  pass did both, and only the glow is laid over here */
override SCENE: u32 = 1u;

@group(1) @binding(0) var src: texture_2d<f32>;
@group(1) @binding(1) var glow: texture_2d<f32>;
@group(1) @binding(2) var focus0: texture_2d<f32>;
@group(1) @binding(3) var focus1: texture_2d<f32>;
@group(1) @binding(4) var focus2: texture_2d<f32>;

/** a distance beyond this is "nothing here" (the glow clears to 1e4, focus textures hold 1e5: infinity in a half) */
const FAR_FOCUS = 5000.0;

/** a NaN or an infinity, told by its bits (no fast maths can fold that away) */
fn broken(c: vec4f) -> bool { return any((bitcast<vec4u>(c) & vec4u(0x7f800000u)) == vec4u(0x7f800000u)); }
fn broken1(x: f32) -> bool { return (bitcast<u32>(x) & 0x7f800000u) == 0x7f800000u; }

/** a focus distance read from a texture of any size (nothing: FAR_FOCUS) */
fn focusAt(t: texture_2d<f32>, uv: vec2f) -> f32 {
  let d = vec2f(textureDimensions(t));
  let v = textureLoad(t, clamp(vec2i(uv * d), vec2i(0), vec2i(d) - 1), 0).r;
  return select(v, FAR_FOCUS, broken1(v) || v <= 0.0 || v > FAR_FOCUS);
}

/** the opaque scene at px as the world shows it, before its air */
fn opaqueAt(px: vec2i, uv: vec2f) -> vec4f {
  var s = worldScene(src, px, viewRay(uv));
  if (broken(s)) { s = vec4f(0.0, 0.0, 0.0, 80.0); }
  return s;
}

struct Air { col: vec3f, opaque: f32, focus: f32 }

fn air(i: FullscreenOut) -> Air {
  let px = vec2i(i.uv * vec2f(textureDimensions(src)));
  let d = viewRay(i.uv);
  var s: vec4f;
  if (SCENE == 1u) { s = opaqueAt(px, i.uv); } else { s = textureLoad(src, px, 0); if (broken(s)) { s = vec4f(0.0, 0.0, 0.0, 80.0); } }
  let gd = vec2i(textureDimensions(glow));
  var g = textureLoad(glow, clamp(vec2i(i.uv * vec2f(gd)), vec2i(0), gd - 1), 0);
  if (broken(vec4f(g.rgb, 0.0))) { g = vec4f(0.0, 0.0, 0.0, FAR_FOCUS); }
  // the nearest translucent matter dense enough to focus on: the flames' legacy distance in the glow, the focus textures
  var near = select(g.a, FAR_FOCUS, broken1(g.a) || g.a > FAR_FOCUS);
  near = min(near, min(focusAt(focus0, i.uv), min(focusAt(focus1, i.uv), focusAt(focus2, i.uv))));
  let fd = min(s.a, near);
  var o: Air;
  o.opaque = s.a;
  o.focus = fd;
  let lit = dot(g.rgb, g.rgb) > 0.0;
  if (SCENE == 1u) {
    if (!lit || fd >= s.a * 0.98) {
      // the glow as far as the surface behind it (the air is affine in the colour: one call)
      o.col = worldAir(vec4f(s.rgb + g.rgb, s.a), px, d);
    } else {
      // the glow nearer: fogged as far as it is (what the air adds at that distance taken away again)
      o.col = worldAir(s, px, d) + worldAir(vec4f(g.rgb, fd), px, d) - worldAir(vec4f(0.0, 0.0, 0.0, fd), px, d);
    }
  } else {
    o.col = s.rgb;
    if (lit) { o.col += worldAir(vec4f(g.rgb, fd), px, d) - worldAir(vec4f(0.0, 0.0, 0.0, fd), px, d); }
  }
  return o;
}

/** the main view's and the inset's first step: the world's scene step and its air on the opaque scene alone */
@fragment fn fs_surface(i: FullscreenOut) -> @location(0) vec4f {
  let px = vec2i(i.uv * vec2f(textureDimensions(src)));
  let s = opaqueAt(px, i.uv);
  return vec4f(worldAir(s, px, viewRay(i.uv)), s.a);
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
