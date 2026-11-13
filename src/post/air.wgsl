// The light in the air, per view: the scene (alpha its view distance) with the world's air laid over it (the geode's
// shaft and haze, the redwoods' mist and rays and the lanterns' glow: worlds/light.wgsl worldAir, chosen by WORLD).
// It is also the first pass after the scene, so a broken pixel (NaN, infinity) is caught here and stays one dark
// pixel instead of spreading into a square in the blur and the bloom.
#include "weft/frame"
#include "weft/fullscreen"
#include "../worlds/light"

@group(1) @binding(0) var src: texture_2d<f32>;

/** a NaN or an infinity, told by its bits (no fast maths can fold that away) */
fn broken(c: vec4f) -> bool { return any((bitcast<vec4u>(c) & vec4u(0x7f800000u)) == vec4u(0x7f800000u)); }

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let px = vec2i(i.uv * vec2f(textureDimensions(src)));
  var s = textureLoad(src, px, 0);
  if (broken(s)) { s = vec4f(0.0, 0.0, 0.0, 80.0); }
  return vec4f(worldAir(s, px, viewRay(i.uv)), s.a);
}
