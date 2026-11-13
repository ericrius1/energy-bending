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
  // never brighter than maxBright of white
  let m = max(col.r, max(col.g, col.b));
  col *= min(1.0, steam.maxBright / max(m, 1e-4));
  return vec4f(col * A, A);
}
