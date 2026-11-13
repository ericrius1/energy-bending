// Steam's composite: the wisps' reduced-resolution target (steam_draw.wgsl: premultiplied colour summed in rgb, the
// optical depth in alpha) laid over the focused image, in the post chain's lens pass after the depth of field.
// It blurs the wisps a little on the way up (five bilinear taps: a soft blur of their own, so steam sits inside the lens
// instead of in front of it), then caps them: however many wisps pile up, a pixel's steam covers at most `cap` of what
// is behind it (both dancers stay visible through any cloud) and is never brighter than `maxBright` of white (only the
// fronts, drawn after this, go past it). A fusion adds its look here: prism is thin-film colour by thickness, storm
// flickers from inside.
#include "weft/frame"
#include "weft/fullscreen"
#include "./steam"

@group(1) @binding(0) var<uniform> steam: Steam;
@group(1) @binding(1) var steamLow: texture_2d<f32>;

/** thin-film colour: the hue a soap film of this thickness shows */
fn film(x: f32) -> vec3f { return 0.5 + 0.5 * cos(6.2831853 * (x + vec3f(0.0, 0.33, 0.67))); }

/** 1 inside the fusion's helix as the screen shows it (a soft-edged box round the column), 0 outside */
fn helixOnScreen(uv: vec2f) -> f32 {
  if (steam.hShape.z <= 0.0) { return 0.0; }
  let c = steam.hAt.xyz;
  let lo = frame.viewProj * vec4f(c - vec3f(0.0, steam.hShape.y, 0.0), 1.0);
  let hi = frame.viewProj * vec4f(c + vec3f(0.0, steam.hShape.y + 0.6, 0.0), 1.0);
  if (lo.w <= 0.05 || hi.w <= 0.05) { return 0.0; }
  let a = lo.xy / lo.w * vec2f(0.5, -0.5) + 0.5;
  let b = hi.xy / hi.w * vec2f(0.5, -0.5) + 0.5;
  // the strands' radius in uv at that distance (×1.6: the vapour swirls out past them)
  let r = steam.hAt.w * 1.6 * frame.proj[0][0] * 0.5 / lo.w;
  let x = abs(uv.x - 0.5 * (a.x + b.x)) / max(r, 1e-4);
  let y0 = min(a.y, b.y);
  let y1 = max(a.y, b.y);
  let ey = max(max(y0 - uv.y, uv.y - y1), 0.0) / max(r, 1e-4);
  return (1.0 - smoothstep(0.7, 1.2, x)) * (1.0 - smoothstep(0.0, 0.5, ey));
}

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(steamLow));
  let b = texel * steam.blur;
  var s = textureSampleLevel(steamLow, samp_linear, i.uv, 0.0) * 0.36;
  s += textureSampleLevel(steamLow, samp_linear, i.uv + vec2f(b.x, b.y), 0.0) * 0.16;
  s += textureSampleLevel(steamLow, samp_linear, i.uv + vec2f(-b.x, b.y), 0.0) * 0.16;
  s += textureSampleLevel(steamLow, samp_linear, i.uv + vec2f(b.x, -b.y), 0.0) * 0.16;
  s += textureSampleLevel(steamLow, samp_linear, i.uv + vec2f(-b.x, -b.y), 0.0) * 0.16;
  let tau = s.a;
  if (tau < 1e-3) { discard; }
  var col = s.rgb / tau;
  var A = steam.cap * (1.0 - exp(-tau));
  let F = steam.fusion;
  // prism: thin iridescent vapour, its colour the film's thickness
  let prism = fusionIs(F, 1.0);
  col = mix(col, col * 0.5 + film(tau * 1.3 + i.uv.y * 0.6 + steam.time * 0.05) * 0.55, prism);
  // storm: lit from inside by flickers that come and go in patches
  let storm = fusionIs(F, 2.0);
  if (storm > 0.0) {
    let cell = floor(i.uv * vec2f(5.0, 3.0));
    let beat = floor(steam.time * 9.0);
    let flash = step(0.86, hash2i(vec2i(cell) + vec2i(i32(beat) * 7, i32(beat) * 13)));
    col += vec3f(0.6, 0.55, 0.95) * flash * smoothstep(0.2, 1.2, tau) * storm;
    A = mix(A, steam.cap * 1.15 * (1.0 - exp(-tau * 1.5)), storm);
  }
  // inside a fusion's helix (its column on screen: the strands' radius about the middle, its height) the vapour is the
  // body's, so the cap is lifted there (0.8 of what is behind, 1.2 of white); everywhere else it holds
  let inside = helixOnScreen(i.uv) * F.y;
  A = mix(A, 0.8 * (1.0 - exp(-tau * 1.3)), inside);
  // never brighter than maxBright of white
  let m = max(col.r, max(col.g, col.b));
  col *= min(1.0, mix(steam.maxBright, 1.2, inside) / max(m, 1e-4));
  return vec4f(col * A, A);
}
