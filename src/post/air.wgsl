// The light in the air, per view, and the frame's depth contract.
//
// The scene comes in two targets (engine/views.ts): the opaque scene, whose alpha is the opaque view distance
// (written by opaque draws only), and `glow`, what translucent matter added on top (flames, sparks, motes, drops),
// whose alpha is the nearest distance a flame min-blended there, if any (NO_FOCUS where none; fire's legacy, until its
// focus texture replaces it). Translucent kinds may also hand over focus textures (MatterPasses.focus: r16float, any
// size, the view distance where the matter is dense enough to focus on, 1e5 elsewhere), bound here as focus0..2.
//
// Surfaces, reflections and the fog test against the opaque distance: the world's scene step (worldScene: the pool's
// and the temple's water, the forge's heat) and its air (worldAir) see the opaque scene, never the glow, so a flame
// can't cut a hole in the water behind it; the glow is laid over afterwards, fogged as far as it is (the nearer of its
// own distance and the opaque one).
//
// The water bodies (matter/water) are composited in between, for the main view and the inset, in three steps:
//   'surface'  fs_surface: the world's scene step and air on the opaque scene (`src`, a copy kept as `opaque`), into
//              the air target, copied back over the scene: what a water body refracts is the finished, fogged world
//   'air'      matter/water composites its bodies over the scene
//              fs_merge: the opaque scene again, with each water body where one was composited (told by where the
//              scene now differs from the surfaced world), at the nearer of the opaque distance and the kinds' focus
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

@group(1) @binding(0) var src: texture_2d<f32>;
@group(1) @binding(1) var glow: texture_2d<f32>;
@group(1) @binding(2) var focus0: texture_2d<f32>;
@group(1) @binding(3) var focus1: texture_2d<f32>;
@group(1) @binding(4) var focus2: texture_2d<f32>;
/** (fs_merge) the opaque scene as drawn, and the surfaced world fs_surface made of it */
@group(1) @binding(5) var opaque: texture_2d<f32>;
@group(1) @binding(6) var surfaced: texture_2d<f32>;

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
fn focusNear(uv: vec2f) -> f32 { return min(focusAt(focus0, uv), min(focusAt(focus1, uv), focusAt(focus2, uv))); }

/** the scene at px as the world shows it, before its air */
fn sceneAt(px: vec2i, uv: vec2f) -> vec4f {
  var s = worldScene(src, px, viewRay(uv));
  if (broken(s)) { s = vec4f(0.0, 0.0, 0.0, 80.0); }
  return s;
}

struct Air { col: vec3f, opaque: f32, focus: f32 }

fn air(i: FullscreenOut) -> Air {
  let px = vec2i(i.uv * vec2f(textureDimensions(src)));
  let d = viewRay(i.uv);
  let s = sceneAt(px, i.uv);
  let gd = vec2i(textureDimensions(glow));
  var g = textureLoad(glow, clamp(vec2i(i.uv * vec2f(gd)), vec2i(0), gd - 1), 0);
  if (broken(vec4f(g.rgb, 0.0))) { g = vec4f(0.0, 0.0, 0.0, FAR_FOCUS); }
  // the nearest translucent matter dense enough to focus on: the flames' legacy distance in the glow, the focus textures
  let near = min(select(g.a, FAR_FOCUS, broken1(g.a) || g.a > FAR_FOCUS), focusNear(i.uv));
  let fd = min(s.a, near);
  var o: Air;
  o.opaque = s.a;
  o.focus = fd;
  if (dot(g.rgb, g.rgb) <= 0.0 || fd >= s.a * 0.98) {
    // the glow as far as the surface behind it (the air is affine in the colour: one call)
    o.col = worldAir(vec4f(s.rgb + g.rgb, s.a), px, d);
  } else {
    // the glow nearer: fogged as far as it is (what the air adds at that distance taken away again)
    o.col = worldAir(s, px, d) + worldAir(vec4f(g.rgb, fd), px, d) - worldAir(vec4f(0.0, 0.0, 0.0, fd), px, d);
  }
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
  let body = x.a < s.a - 0.01 || max(dc.r, max(dc.g, dc.b)) > 1e-3 * (1.0 + max(s.r, max(s.g, s.b)));
  if (!body) { return o; }
  return vec4f(x.rgb, min(x.a, focusNear(i.uv)));
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
