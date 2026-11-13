// The second step of the surface: the spheres' depth smoothed into one surface by a narrow-range filter (Truong and
// Yuksel 2018), run along x then along y, a few times. Neighbours count by how near they are on screen only (a
// Gaussian a few centimetres wide in the world, so near water is smoothed over more pixels than far), within a narrow
// band of depth round the pixel's own: a neighbour well behind it is another surface and is left out; one well in front
// is pulled back to the band's near edge instead of being dropped, so the bumps where beads overlap are flattened
// rather than kept (a bilateral blur keeps them: the bead outline and the grain). A pixel the splats missed takes the
// depth of the water round it, so the outline, which the composite takes from the smoothed thickness, has a surface
// under it all the way out. Thickness, foam and frost are blurred plainly (that blur is what makes the outline smooth).
// `fs_first` reads the splats; `fs_next` reads the last blur.
// Out: rgba32float = view distance (0: no water near), thickness, foam, frost. (Both entries reach all three textures
// through `blur`, so every pass binds all three; the one it doesn't read is any other target of the right type.)
#include "weft/frame"
#include "weft/fullscreen"

struct Smooth {
  dir: vec2f,          // (1, 0) along x, (0, 1) along y
  radius: f32,         // the blur's width in the world (m)
  falloff: f32,        // half the depth band (m): behind it a neighbour is left out, in front it is clamped to it
  maxPx: f32,          // the widest blur, in pixels
  pad0: f32, pad1: f32, pad2: f32,
}

@group(1) @binding(0) var<uniform> sm: Smooth;
@group(1) @binding(1) var dist: texture_2d<f32>;      // fs_first: the splats' nearest distance, and its capsule (rg32float)
@group(1) @binding(2) var thick: texture_2d<f32>;     // fs_first: the splats' thickness, foam, frost (rgba16float)
@group(1) @binding(3) var src: texture_2d<f32>;       // fs_next: the last blur (rgba32float)

// (dense enough that the taps are at most ~1.5 pixels apart at the widest: sparser, the beads alias into stripes)
const TAPS: i32 = 16;

/** the blur's half-width in pixels for water at distance d (pixels per metre there: proj[1][1] / d × half the height) */
fn pxRadius(d: f32, h: i32) -> f32 {
  return clamp(sm.radius * frame.proj[1][1] / max(d, 0.05) * f32(h) * 0.5, 1.0, sm.maxPx);
}

fn tap(q: vec2i, first: bool) -> vec4f {
  if (first) { return vec4f(textureLoad(dist, q, 0).r, textureLoad(thick, q, 0).rgb); }
  return textureLoad(src, q, 0);
}

fn blur(px: vec2i, dims: vec2i, first: bool) -> vec4f {
  let c = tap(px, first);
  let d0 = c.x;
  // the blur's width: from the pixel's own depth, or for a pixel with none, a few pixels (enough to reach the water
  // beside it and soften the outline)
  var rpx = 4.0;
  if (d0 > 0.0) { rpx = pxRadius(d0, dims.y); }
  let step = max(rpx / f32(TAPS), 1.0);
  let sigma = rpx * 0.5;
  let lo = d0 - sm.falloff;
  let hi = d0 + sm.falloff;
  var dsum = 0.0;
  var dw = 0.0;
  var rest = vec3f(0.0);
  var rw = 0.0;
  for (var k = -TAPS; k <= TAPS; k++) {
    let off = f32(k) * step;
    let q = clamp(px + vec2i(round(sm.dir * off)), vec2i(0), dims - 1);
    let s = tap(q, first);
    let ws = exp(-0.5 * off * off / (sigma * sigma));
    rest += s.yzw * ws;
    rw += ws;
    if (s.x <= 0.0) { continue; }
    if (d0 > 0.0) {
      // the narrow range: behind it, another surface; in front, clamped to its near edge (and far in front, an arm
      // across the body: left out too, or the body would ridge along the arm's outline)
      if (s.x > hi || s.x < lo - sm.falloff) { continue; }
      dsum += max(s.x, lo) * ws;
    } else {
      dsum += s.x * ws;
    }
    dw += ws;
  }
  var o = vec4f(0.0, rest / max(rw, 1e-6));
  if (dw > 0.0) { o.x = dsum / dw; }
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
