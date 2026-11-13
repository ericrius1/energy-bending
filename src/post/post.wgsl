// The post chain after the air (post/air.wgsl): depth of field, trails (the last frame, faded, kept wherever it's
// brighter), a bloom chain, and the grade; and the inset a second view is shown in (?pip). The scene's alpha is its
// view distance.
#include "weft/frame"
#include "weft/fullscreen"
#include "../engine/util"

override FIRST: f32 = 0.0;

struct Post {
  exposure: f32,    // @range(0, 4)
  bloom: f32,       // @range(0, 2)
  threshold: f32,   // @range(0, 4)
  radius: f32,      // @range(0.5, 3)
  trail: f32,       // @range(0, 1)
  decay: f32,       // @range(0.5, 0.99)
  drift: f32,       // @range(-0.003, 0.003)
  vignette: f32,    // @range(0, 1)
  grain: f32,       // @range(0, 0.2)
  aberration: f32,  // @range(0, 0.02)
  saturation: f32,  // @range(0, 2)
  contrast: f32,    // @range(0.5, 1.5)
  tonemap: f32,     // 0 ACES (saturated), 1 AgX (filmic, highlights to white)
  pad: f32,
  focus: f32,       // distance in focus (m)
  blur: f32,        // @range(0, 30)    blur in pixels of something twice as far as the focus
}
@group(1) @binding(0) var<uniform> post: Post;
@group(1) @binding(1) var src: texture_2d<f32>;
@group(1) @binding(2) var prev: texture_2d<f32>;
@group(1) @binding(3) var bloomTex: texture_2d<f32>;
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, samp_linear, uv, 0.0).rgb; }
fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }

// depth of field, gathered: every tap whose blur disc reaches this pixel counts (a tap behind this pixel can't blur
// over it by more than this pixel's own blur, so sharp things in front keep their edges)
fn coc(depth: f32) -> f32 {
  return min(post.blur * abs(1.0 - post.focus / max(depth, 0.05)), 16.0);
}
@fragment fn fs_dof(i: FullscreenOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(src));
  let px = vec2i(i.uv * dims);
  let centre = textureLoad(src, px, 0);
  let c0 = coc(centre.a);
  if (post.blur <= 0.0) { return centre; }
  var acc = centre.rgb;
  var wsum = 1.0;
  let spin = hash2(vec2f(px)) * 6.2831853;
  let n = 40;
  for (var k = 1; k <= n; k++) {
    let r = sqrt(f32(k) / f32(n)) * 16.0;
    let a = f32(k) * 2.39996323 + spin;
    let q = clamp(px + vec2i(vec2f(cos(a), sin(a)) * r), vec2i(0), vec2i(dims) - 1);
    let s = textureLoad(src, q, 0);
    var cover = coc(s.a);
    if (s.a > centre.a) { cover = min(cover, c0); }
    let w = smoothstep(r - 1.5, r + 0.5, cover);
    acc += s.rgb * w;
    wsum += w;
  }
  return vec4f(acc / wsum, centre.a);
}

// trails: max of now and the faded past, nudged by a drift so they rise like heat
@fragment fn fs_trail(i: FullscreenOut) -> @location(0) vec4f {
  let now = tap(i.uv);
  // the past is blurred a little every frame, so older copies of a fast gem melt into a soft streak
  let px = 1.2 / vec2f(textureDimensions(prev));
  let uv = i.uv + vec2f(0.0, post.drift);
  let past = (textureSampleLevel(prev, samp_linear, uv + vec2f(px.x, px.y), 0.0).rgb + textureSampleLevel(prev, samp_linear, uv + vec2f(-px.x, px.y), 0.0).rgb
    + textureSampleLevel(prev, samp_linear, uv + vec2f(px.x, -px.y), 0.0).rgb + textureSampleLevel(prev, samp_linear, uv - px, 0.0).rgb) * (0.25 * post.decay);
  return vec4f(mix(now, max(now, past), post.trail), 1.0);
}

// 13-tap downsample; the first level thresholds and Karis-averages so single glints don't flicker
fn karis(c: vec3f) -> f32 { return 1.0 / (1.0 + luma(c)); }
@fragment fn fs_down(i: FullscreenOut) -> @location(0) vec4f {
  let px = 1.0 / vec2f(textureDimensions(src));
  let uv = i.uv;
  let a = tap(uv + px * vec2f(-2.0, -2.0)); let b = tap(uv + px * vec2f(0.0, -2.0)); let c = tap(uv + px * vec2f(2.0, -2.0));
  let d = tap(uv + px * vec2f(-1.0, -1.0)); let e = tap(uv + px * vec2f(1.0, -1.0));
  let f = tap(uv + px * vec2f(-2.0, 0.0)); let g = tap(uv); let h = tap(uv + px * vec2f(2.0, 0.0));
  let j = tap(uv + px * vec2f(-1.0, 1.0)); let k = tap(uv + px * vec2f(1.0, 1.0));
  let l = tap(uv + px * vec2f(-2.0, 2.0)); let m = tap(uv + px * vec2f(0.0, 2.0)); let n = tap(uv + px * vec2f(2.0, 2.0));
  var o: vec3f;
  if (FIRST > 0.5) {
    let g0 = (d + e + j + k) * 0.25; let g1 = (a + b + f + g) * 0.25; let g2 = (b + c + g + h) * 0.25;
    let g3 = (f + g + l + m) * 0.25; let g4 = (g + h + m + n) * 0.25;
    let w0 = karis(g0) * 0.5; let w1 = karis(g1) * 0.125; let w2 = karis(g2) * 0.125; let w3 = karis(g3) * 0.125; let w4 = karis(g4) * 0.125;
    o = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    let br = max(o.r, max(o.g, o.b));
    let knee = post.threshold * 0.5;
    let soft = clamp(br - post.threshold + knee, 0.0, 2.0 * knee);
    let contrib = max(soft * soft / (4.0 * knee + 1e-4), br - post.threshold) / max(br, 1e-4);
    o *= max(contrib, 0.0);
  } else {
    o = (d + e + j + k) * 0.125 + (a + c + l + n) * 0.03125 + (b + f + h + m) * 0.0625 + g * 0.125;
  }
  return vec4f(o, 1.0);
}

// tent upsample, added onto the next level up
@fragment fn fs_up(i: FullscreenOut) -> @location(0) vec4f {
  let px = post.radius / vec2f(textureDimensions(src));
  let uv = i.uv;
  var o = tap(uv) * 4.0;
  o += (tap(uv + vec2f(px.x, 0.0)) + tap(uv - vec2f(px.x, 0.0)) + tap(uv + vec2f(0.0, px.y)) + tap(uv - vec2f(0.0, px.y))) * 2.0;
  o += tap(uv + px) + tap(uv - px) + tap(uv + vec2f(px.x, -px.y)) + tap(uv + vec2f(-px.x, px.y));
  return vec4f(o / 16.0, 1.0);
}

// AgX (minimal fit) for the highlights: bright gems roll off to white instead of clipping to flat colour
fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x; let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agx(c: vec3f) -> vec3f {
  let m = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  let lo = -12.47393; let hi = 4.026069;
  var v = clamp(log2(max(m * c, vec3f(1e-10))), vec3f(lo), vec3f(hi));
  v = agxContrast((v - lo) / (hi - lo));
  let inv = mat3x3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417,
    -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  return pow(max(inv * v, vec3f(0.0)), vec3f(2.2));
}

fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

@fragment fn fs_out(i: FullscreenOut) -> @location(0) vec4f {
  let ca = (i.uv - 0.5) * post.aberration;
  var c = vec3f(tap(i.uv - ca).r, tap(i.uv).g, tap(i.uv + ca).b);
  c += textureSampleLevel(bloomTex, samp_linear, i.uv, 0.0).rgb * post.bloom;
  c *= post.exposure;
  c = select(aces(c), agx(c), post.tonemap > 0.5);
  let l = luma(c);
  c = max(mix(vec3f(l), c, post.saturation), vec3f(0.0));
  c = pow(c, vec3f(post.contrast));
  let v = distance(i.uv, vec2f(0.5));
  c *= 1.0 - post.vignette * smoothstep(0.25, 0.85, v);
  var g = pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
  let n = fract(sin(dot(i.uv * vec2f(frame.res) + frame.time * 61.0, vec2f(12.9898, 78.233))) * 43758.5453);
  g += (n - 0.5) * post.grain;
  return vec4f(g, 1.0);
}

// the inset: a second view's air, tone-mapped and graded lightly, drawn into its corner of the screen (the pass's
// viewport puts it there; src is that view's air texture)
@fragment fn fs_inset(i: FullscreenOut) -> @location(0) vec4f {
  var c = textureSampleLevel(src, samp_linear, i.uv, 0.0).rgb * post.exposure;
  c = select(aces(c), agx(c), post.tonemap > 0.5);
  // a thin frame round it
  let e = min(min(i.uv.x, 1.0 - i.uv.x), min(i.uv.y, 1.0 - i.uv.y));
  c = mix(vec3f(0.85), pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)), smoothstep(0.004, 0.008, e));
  return vec4f(c, 1.0);
}
