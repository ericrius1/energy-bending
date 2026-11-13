// The film's frames for the encoder: the graded frame (rendered bigger than it's shown, for smoother sparkle) brought
// down to the film's size with a tent filter and turned into the encoder's own format, YUV 4:2:0 (BT.709, video
// range), packed four bytes to a word: the Y plane, then U, then V. A sixth of what RGBA at the render size would
// cost to read back and send.
#include "weft/frame"

struct Yuv {
  size: vec2u,   // the film's size (width a multiple of 8, height even)
  src: vec2u,    // the render's
}
@group(1) @binding(0) var<uniform> yuv: Yuv;
@group(1) @binding(1) var src: texture_2d<f32>;
@group(1) @binding(2) var<storage, read_write> planes: array<u32>;

// the colour over one film pixel's footprint: four bilinear taps spread across it
fn rgbAt(p: vec2f) -> vec3f {
  let s = vec2f(yuv.src) / vec2f(yuv.size);
  let at = p * s;
  let o = s * 0.25;
  let inv = 1.0 / vec2f(yuv.src);
  var c = textureSampleLevel(src, samp_linear, (at + vec2f(-o.x, -o.y)) * inv, 0.0).rgb;
  c += textureSampleLevel(src, samp_linear, (at + vec2f(o.x, -o.y)) * inv, 0.0).rgb;
  c += textureSampleLevel(src, samp_linear, (at + vec2f(-o.x, o.y)) * inv, 0.0).rgb;
  c += textureSampleLevel(src, samp_linear, (at + vec2f(o.x, o.y)) * inv, 0.0).rgb;
  return c * 0.25;
}

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let W = yuv.size.x;
  let H = yuv.size.y;
  let lumaWords = W * H / 4u;
  let cw = W / 2u;
  let chromaWords = cw * (H / 2u) / 4u;
  let i = gid.x;
  var word = 0u;
  if (i < lumaWords) {
    let x0 = (i * 4u) % W;
    let y = (i * 4u) / W;
    for (var k = 0u; k < 4u; k++) {
      let c = rgbAt(vec2f(f32(x0 + k) + 0.5, f32(y) + 0.5));
      word |= u32(clamp(16.0 + 219.0 * luma(c), 0.0, 255.0) + 0.5) << (8u * k);
    }
  } else if (i < lumaWords + 2u * chromaWords) {
    let j = i - lumaWords;
    let v = j >= chromaWords;
    let jj = j % chromaWords;
    let x0 = (jj * 4u) % cw;
    let y = (jj * 4u) / cw;
    for (var k = 0u; k < 4u; k++) {
      // a chroma sample covers two by two film pixels
      let p = vec2f(f32(x0 + k) * 2.0 + 1.0, f32(y) * 2.0 + 1.0);
      let c = (rgbAt(p + vec2f(-0.5, -0.5)) + rgbAt(p + vec2f(0.5, -0.5)) + rgbAt(p + vec2f(-0.5, 0.5)) + rgbAt(p + vec2f(0.5, 0.5))) * 0.25;
      let Y = luma(c);
      let d = select((c.b - Y) / 1.8556, (c.r - Y) / 1.5748, v);
      word |= u32(clamp(128.0 + 224.0 * d, 0.0, 255.0) + 0.5) << (8u * k);
    }
  } else {
    return;
  }
  planes[i] = word;
}
