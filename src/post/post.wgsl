// The post chain after the air (post/air.wgsl): the lens (depth of field, gathered at half resolution and laid over
// the sharp image where it is out of focus), a bloom chain with a warm, wide halo for hot cores, and the grade (the
// tone map, then the world's own curves); and the inset a second view is shown in (?pip). The lens reads the air
// pass's focus target: per pixel the distance the depth of field places it at (the nearer of the opaque surface and
// any translucent matter dense enough to focus on). The glowing matter's trails are laid before the air
// (fs_glowtrail), so opaque bodies leave no ghost copies.
#include "weft/frame"
#include "weft/fullscreen"
#include "../engine/util"

override FIRST: f32 = 0.0;
/** the bloom's upsample: 1 on the levels wide enough to take the warm tint */
override WIDE: f32 = 0.0;

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
  smear: f32,       // @range(0, 4)     how far (px) the glow's past is spread each frame
  focus: f32,       // distance in focus (m)
  blur: f32,        // @range(0, 30)    blur in pixels of something twice as far as the focus
  bloomSat: f32,    // @range(0, 3)     the halo's colour: 1 as the source, more to carry its hue out (fire's orange)
  wide: f32,        // @range(0.5, 2)   how much each wider level adds (1: as before)
  gradeOn: f32,     // 0: no world grade (exactly the picture without one), 1: the grade below
  protect: f32,     // @range(0, 1)     how much of a saturated colour the grade leaves alone
  stub: f32,        // a stand-in focus distance (m) for testing the focus path; 0 off
  lift: vec4f,      // rgb: added to the shadows (w unused)
  gamma: vec4f,     // rgb: the midtones' power (1/gamma)
  gain: vec4f,      // rgb: multiplies the highlights
  shadows: vec4f,   // rgb: the shadows' tint
  highs: vec4f,     // rgb: the highlights' tint; w: where shadows turn to highlights (luma)
  look: vec4f,      // x saturation, y contrast (about the pivot z), w unused
  warm: vec4f,      // rgb: the tint the wide bloom levels take (w unused)
  shoulder: vec4f,  // the highlight shoulder: x how much (0: the plain tone map), y the peak where it starts, z where it
                    // is whole, w the peak past which a colour may go white (and is all white at 4 × w)
  bloomCurve: vec4f, // x the most a pixel gives the bloom (its brightness rolls off toward this), y the knee (× threshold)
  stage: vec4f,     // the locked view's stage dim: x how much (0 off), y the stage's focus plane (m from the eye), z how
                    // much darker what lies beyond gets, w how much softer (px of blur at full dim)
}
@group(1) @binding(0) var<uniform> post: Post;
@group(1) @binding(1) var src: texture_2d<f32>;
@group(1) @binding(2) var prev: texture_2d<f32>;
@group(1) @binding(3) var bloomTex: texture_2d<f32>;
@group(1) @binding(4) var focusTex: texture_2d<f32>;
@group(1) @binding(5) var blurTex: texture_2d<f32>;
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, samp_linear, uv, 0.0).rgb; }
fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }

// ---------------------------------------------------------------- the lens
// The blur (in full-resolution pixels, at most 16) of something at view distance `depth`
fn coc(depth: f32) -> f32 {
  return min(post.blur * abs(1.0 - post.focus / max(depth, 0.05)) + post.stage.w * beyondStage(depth), 16.0);
}

/** the locked view's stage dim at view distance `depth`: 0 on the stage and in front of it, rising to post.stage.x a
 *  few metres beyond its focus plane */
fn beyondStage(depth: f32) -> f32 {
  if (post.stage.x <= 0.0) { return 0.0; }
  let at = post.stage.y;
  return post.stage.x * smoothstep(at + 0.4, at + 0.4 + max(at * 0.6, 2.0), depth);
}

/** half resolution: the image (a 2×2 box) and, in alpha, the nearest of the four's distance (so a thin near thing
 *  isn't averaged away into the wall behind it) */
@fragment fn fs_lensdown(i: FullscreenOut) -> @location(0) vec4f {
  let full = vec2i(textureDimensions(src));
  let p = vec2i(floor(i.uv * vec2f(textureDimensions(src)) - 0.5));
  var c = vec3f(0.0);
  var d = 1e5;
  for (var k = 0; k < 4; k++) {
    let q = clamp(p + vec2i(k & 1, k >> 1), vec2i(0), full - 1);
    c += textureLoad(src, q, 0).rgb;
    d = min(d, textureLoad(focusTex, q, 0).r);
  }
  return vec4f(c * 0.25, d);
}

/** half resolution: the gather. Every tap whose blur disc reaches this pixel counts; a tap behind this pixel can't
 *  blur over it by more than this pixel's own blur, so sharp things in front keep their edges. 28 taps on a
 *  golden-angle spiral out to 8 half-res pixels (16 full), turned per pixel. Alpha: how blurred the result is
 *  (its taps' blur, weighted), which the composite uses to choose between it and the sharp image */
@fragment fn fs_lensgather(i: FullscreenOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(src));
  let px = vec2i(i.uv * dims);
  let centre = textureLoad(src, px, 0);
  let c0 = coc(centre.a) * 0.5;
  var acc = centre.rgb;
  var wsum = 1.0;
  var blur = c0;
  let spin = hash2(vec2f(px)) * 6.2831853;
  let n = 28;
  for (var k = 1; k <= n; k++) {
    let r = sqrt(f32(k) / f32(n)) * 8.0;
    let a = f32(k) * 2.39996323 + spin;
    let q = clamp(px + vec2i(round(vec2f(cos(a), sin(a)) * r)), vec2i(0), vec2i(dims) - 1);
    let s = textureLoad(src, q, 0);
    var cover = coc(s.a) * 0.5;
    if (s.a > centre.a) { cover = min(cover, c0); }
    let w = smoothstep(r - 1.0, r + 0.5, cover);
    acc += s.rgb * w;
    blur += cover * w;
    wsum += w;
  }
  return vec4f(acc / wsum, blur / wsum * 2.0);
}

/** full resolution: the sharp image where it is in focus, the gathered blur where it isn't (or where something out of
 *  focus in front spreads over it) */
@fragment fn fs_dof(i: FullscreenOut) -> @location(0) vec4f {
  let px = vec2i(i.uv * vec2f(textureDimensions(src)));
  let centre = textureLoad(src, px, 0);
  let depth = textureLoad(focusTex, px, 0).r;
  // the stage dim: what lies beyond the locked stage a little darker (and, through coc, softer)
  let dim = 1.0 - post.stage.z * beyondStage(depth);
  if (post.blur <= 0.0 && post.stage.w * post.stage.x <= 0.0) { return vec4f(centre.rgb * dim, centre.a); }
  let c0 = coc(depth);
  let b = textureSampleLevel(blurTex, samp_linear, i.uv, 0.0);
  let k = smoothstep(0.6, 2.5, max(c0, b.a));
  return vec4f(mix(centre.rgb, b.rgb, k) * dim, centre.a);
}

/** postParams.focusStub: a stand-in focus texture, a disc of that distance in the middle third of the frame (what a
 *  translucent kind's focus texture holds: its distance where it's dense, 1e5 elsewhere) */
@fragment fn fs_focusstub(i: FullscreenOut) -> @location(0) vec4f {
  let r = length((i.uv - 0.5) * vec2f(frame.aspect, 1.0));
  return vec4f(select(1e5, post.stub, r < 0.18), 0.0, 0.0, 1.0);
}

// ---------------------------------------------------------------- the glow's trails
// Before the air, on the glowing matter alone (the scene's glow target: flames, sparks, streaks, plasma, motes): the
// most of now and the faded past, the past spread a little every frame and nudged up by a drift so the trails rise
// like heat and melt into a soft streak. Opaque bodies are not in it, so a fast cartwheel leaves no ghost copies.
// Alpha passes through (the nearest flame's distance, which the air reads for focus and fog)
@fragment fn fs_glowtrail(i: FullscreenOut) -> @location(0) vec4f {
  let now = textureSampleLevel(src, samp_nearest, i.uv, 0.0);
  let px = post.smear / vec2f(textureDimensions(prev));
  let uv = i.uv + vec2f(0.0, post.drift);
  var past = vec3f(0.0);
  // a ring of six, a little turned each frame, so the spread is round and doesn't stamp a grid
  let turn = f32(frame.frame % 6u) * 1.0471976 * 0.5;
  for (var k = 0; k < 6; k++) {
    let a = f32(k) * 1.0471976 + turn;
    past += textureSampleLevel(prev, samp_linear, uv + vec2f(cos(a), sin(a)) * px, 0.0).rgb;
  }
  past *= post.decay / 6.0;
  let c = select(now.rgb, vec3f(0.0), any(now.rgb != now.rgb));
  return vec4f(mix(c, max(c, past), post.trail), now.a);
}

// ---------------------------------------------------------------- bloom
// 13-tap downsample; the first level thresholds and Karis-averages so single glints don't flicker, and carries the
// source's hue out a little (bloomSat) so a white-hot flame core blooms orange and a plasma core violet
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
    let knee = post.threshold * post.bloomCurve.y;
    let soft = clamp(br - post.threshold + knee, 0.0, 2.0 * knee);
    let over = max(soft * soft / (4.0 * knee + 1e-4), br - post.threshold);
    // what passes the threshold rolls off toward bloomCurve.x: a hot core lights the air round it as a lamp does,
    // instead of stamping a disc as bright as itself (a core ten times brighter gives a halo only a little brighter)
    let cap = max(post.bloomCurve.x, 1e-3);
    let given = over * cap / (cap + over);
    o *= max(given, 0.0) / max(br, 1e-4);
    let lo = luma(o);
    o = max(vec3f(lo) + (o - vec3f(lo)) * post.bloomSat, vec3f(0.0));
  } else {
    o = (d + e + j + k) * 0.125 + (a + c + l + n) * 0.03125 + (b + f + h + m) * 0.0625 + g * 0.125;
  }
  return vec4f(o, 1.0);
}

// tent upsample, added onto the next level up (× wide: more from the wider levels; the widest take the warm tint, so
// the far halo round a hot core is warm without tinting the core itself)
@fragment fn fs_up(i: FullscreenOut) -> @location(0) vec4f {
  let px = post.radius / vec2f(textureDimensions(src));
  let uv = i.uv;
  var o = tap(uv) * 4.0;
  o += (tap(uv + vec2f(px.x, 0.0)) + tap(uv - vec2f(px.x, 0.0)) + tap(uv + vec2f(0.0, px.y)) + tap(uv - vec2f(0.0, px.y))) * 2.0;
  o += tap(uv + px) + tap(uv - px) + tap(uv + vec2f(px.x, -px.y)) + tap(uv + vec2f(-px.x, px.y));
  o *= post.wide / 16.0;
  if (WIDE > 0.5) { o *= post.warm.rgb; }
  return vec4f(o, 1.0);
}

// ---------------------------------------------------------------- the tone map and the grade
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

/** the tone map with the frame's highlight shoulder. ACES (or AgX) maps each channel alone, so a hot colour whose
 *  channels all pass about 1 (a fire core at (6, 3, 1)) comes out flat white: the critic's white discs. The shoulder
 *  maps the colour's peak instead and scales the others with it, which keeps the hue and the structure inside a core
 *  (its brighter and dimmer parts stay apart, and orange stays orange), and only lets a colour go white far past
 *  that (shoulder.w … 4 × shoulder.w), so peak whites stay bright and small. Below shoulder.y nothing changes: the
 *  worlds and their grades look as they did. Fire's own ramp has a shoulder of its own (matter/fire); this one only
 *  keeps the peak where the plain map puts it and moves only the other channels, so the two
 *  don't add up to grey */
fn toneMap(c: vec3f) -> vec3f {
  let base = select(aces(c), agx(c), post.tonemap > 0.5);
  let peak = max(c.r, max(c.g, c.b));
  if (post.shoulder.x <= 0.0 || peak <= 1e-4) { return base; }
  let mapped = select(aces(vec3f(peak)).r, agx(vec3f(peak)).r, post.tonemap > 0.5);
  let hue = c * (mapped / peak);
  let k = post.shoulder.x * smoothstep(post.shoulder.y, post.shoulder.z, peak)
    * (1.0 - smoothstep(post.shoulder.w, post.shoulder.w * 4.0, peak));
  return mix(base, hue, k);
}

/** the world's grade on a tone-mapped colour (linear, 0 … 1): lift, gamma, gain; the shadows and highlights tinted
 *  apart; saturation and contrast. A saturated colour (an element's: fire's orange, water's cyan, plasma's violet) is
 *  left mostly alone (`protect`), so the elements look like themselves in every world */
fn grade(c: vec3f) -> vec3f {
  var g = post.gain.rgb * (c + post.lift.rgb * (1.0 - c));
  g = pow(max(g, vec3f(0.0)), 1.0 / max(post.gamma.rgb, vec3f(0.05)));
  let l = luma(g);
  let t = smoothstep(0.0, max(post.highs.w, 0.05) * 2.0, l);
  g *= mix(post.shadows.rgb, post.highs.rgb, t);
  let l2 = luma(g);
  g = mix(vec3f(l2), g, post.look.x);
  g = max(post.look.z + (g - post.look.z) * post.look.y, vec3f(0.0));
  let hi = max(c.r, max(c.g, c.b));
  let chroma = (hi - min(c.r, min(c.g, c.b))) / max(hi, 1e-4);
  return mix(g, c, post.protect * smoothstep(0.35, 0.9, chroma) * smoothstep(0.05, 0.4, hi));
}

@fragment fn fs_out(i: FullscreenOut) -> @location(0) vec4f {
  let ca = (i.uv - 0.5) * post.aberration;
  var c = vec3f(tap(i.uv - ca).r, tap(i.uv).g, tap(i.uv + ca).b);
  c += textureSampleLevel(bloomTex, samp_linear, i.uv, 0.0).rgb * post.bloom;
  c *= post.exposure;
  c = toneMap(c);
  if (post.gradeOn > 0.5) { c = grade(c); }
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
  c = toneMap(c);
  // a thin frame round it
  let e = min(min(i.uv.x, 1.0 - i.uv.x), min(i.uv.y, 1.0 - i.uv.y));
  c = mix(vec3f(0.85), pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)), smoothstep(0.004, 0.008, e));
  return vec4f(c, 1.0);
}
