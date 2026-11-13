// The second step of the water surface: the spheres' depth smoothed into one surface. A bilateral blur, run along x
// then along y (twice, by default): neighbours count by how near they are on screen (a Gaussian a few centimetres
// wide in the world, so near water is smoothed over more pixels than far) and by how near they are in depth (so the
// arm in front doesn't melt into the body behind it). The thickness, foam and frost are blurred plainly, which also
// softens the surface's outline. `fs_first` reads the splats; `fs_next` reads the last blur.
// Out: rgba32float = view distance (0: no water), thickness, foam, frost. (Both entries reach all three textures
// through `blur`, so every pass binds all three; the one it doesn't read is any other target of the right type.)
#include "weft/frame"
#include "weft/fullscreen"

struct Smooth {
  dir: vec2f,          // (1, 0) along x, (0, 1) along y
  radius: f32,         // the blur's width in the world (m)
  falloff: f32,        // depth difference (m) at which a neighbour stops counting
  maxPx: f32,          // the widest blur, in pixels
  pad0: f32, pad1: f32, pad2: f32,
}

@group(1) @binding(0) var<uniform> sm: Smooth;
@group(1) @binding(1) var dist: texture_2d<f32>;      // fs_first: the splats' nearest distance (r32float)
@group(1) @binding(2) var thick: texture_2d<f32>;     // fs_first: the splats' thickness, foam, frost (rgba16float)
@group(1) @binding(3) var src: texture_2d<f32>;       // fs_next: the last blur (rgba32float)

const TAPS: i32 = 10;

/** the blur's half-width in pixels for water at distance d (pixels per metre there: proj[1][1] / d × half the height) */
fn pxRadius(d: f32, h: i32) -> f32 {
  return clamp(sm.radius * frame.proj[1][1] / max(d, 0.05) * f32(h) * 0.5, 1.0, sm.maxPx);
}

fn blur(px: vec2i, dims: vec2i, first: bool) -> vec4f {
  var c: vec4f;
  if (first) { c = vec4f(textureLoad(dist, px, 0).r, textureLoad(thick, px, 0).rgb); }
  else { c = textureLoad(src, px, 0); }
  let d0 = c.x;
  var rpx = pxRadius(d0, dims.y);
  if (d0 <= 0.0) { rpx = 3.0; }
  let step = max(rpx / f32(TAPS), 1.0);
  let sigma = rpx * 0.5;
  var dsum = 0.0;
  var dw = 0.0;
  var rest = vec3f(0.0);
  var rw = 0.0;
  for (var k = -TAPS; k <= TAPS; k++) {
    let off = f32(k) * step;
    let q = clamp(px + vec2i(round(sm.dir * off)), vec2i(0), dims - 1);
    var s: vec4f;
    if (first) { s = vec4f(textureLoad(dist, q, 0).r, textureLoad(thick, q, 0).rgb); }
    else { s = textureLoad(src, q, 0); }
    let ws = exp(-0.5 * off * off / (sigma * sigma));
    rest += s.yzw * ws;
    rw += ws;
    if (s.x > 0.0 && d0 > 0.0) {
      let dd = (s.x - d0) / sm.falloff;
      let w = ws * exp(-dd * dd);
      dsum += s.x * w;
      dw += w;
    }
  }
  var o = vec4f(0.0, rest / max(rw, 1e-6));
  if (d0 > 0.0) { o.x = dsum / max(dw, 1e-6); }
  return o;
}

@fragment fn fs_first(i: FullscreenOut) -> @location(0) vec4f {
  let dims = vec2i(textureDimensions(dist));
  return blur(vec2i(i.uv * vec2f(dims)), dims, true);
}

@fragment fn fs_next(i: FullscreenOut) -> @location(0) vec4f {
  let dims = vec2i(textureDimensions(src));
  return blur(vec2i(i.uv * vec2f(dims)), dims, false);
}
