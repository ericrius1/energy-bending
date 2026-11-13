// The fire field made light: one fullscreen pass per view over its scene, reading the summed temperature, form, smoke,
// velocity and distance the flames splatted (splat.wgsl; field.wgsl says what is where) and applying the reference's
// look to the sum (docs/element-looks.md §1 and §4):
//
//   display noise   T × (0.66 + 0.68 n) − 0.035, n an fbm on the flame's plane (metres at its distance) that climbs and
//                   is carried along the splatted velocity (a flow map: two phases half a cycle apart, crossfaded), so
//                   tongues have structure that moves with the flames, and a kick's sheet streams the way it was thrown
//   fire            the warm ramp pow(T, (1, 2, 3.6)) × (1.75, 0.95, 0.6): deep red tips, orange, a white-hot core, and
//                   where the noise pulls T under the cut, dark gaps
//   the torch       form 0.5: a blue torch flame (field.wgsl torchRamp), sharper, threads starting in it
//   plasma          ridged filaments scrolling fast, ~40 Hz flicker, the violet → magenta → white ramp, a violet haze
//   smoke           a soft warm grey-brown that covers what is behind (premultiplied over); none from plasma
//
// The blend adds the light and lays the smoke over it, and leaves the scene's alpha (the opaque view distance) alone:
// translucent matter does not write it (the depth contract). `fs_focus` writes the focus texture: the flames' view
// distance where they are dense enough to focus on, far elsewhere.
#include "weft/frame"
#include "weft/fullscreen"
#include "./field"

@group(1) @binding(0) var<uniform> field: FireField;
@group(1) @binding(1) var heat: texture_2d<f32>;
@group(1) @binding(2) var flow: texture_2d<f32>;
@group(1) @binding(3) var noiseTex: texture_2d<f32>;

/** the display noise (an fbm, the noise texture's g) at p (cells) */
fn dnoise(p: vec2f) -> f32 { return textureSampleLevel(noiseTex, samp_repeat, p * 0.25, 0.0).g; }

/** n carried along the flow: two phases of a cycle, each sliding the pattern by vel × its age, crossfaded so neither
 *  is seen as it resets */
fn carried(w: vec2f, vel: vec2f, t: f32) -> f32 {
  let P = max(field.period, 0.05);
  let ph = fract(t / P);
  let ph2 = fract(t / P + 0.5);
  let s = vec2f(field.scale, field.scale * 0.62);
  let climb = vec2f(0.0, t * field.climb);
  let a = dnoise((w - vel * (ph * P) - climb) * s);
  let b = dnoise((w - vel * (ph2 * P) - climb) * s + vec2f(17.3, 5.1));
  let k = 1.0 - abs(2.0 * ph - 1.0);
  let n = mix(b, a, k);
  // the crossfade halves the noise's contrast at the middle: give it back
  return 0.5 + (n - 0.5) / max(sqrt(k * k + (1.0 - k) * (1.0 - k)), 0.5);
}

fn ridge(x: f32) -> f32 { return 1.0 - abs(2.0 * x - 1.0); }

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  let h = textureSampleLevel(heat, samp_linear, i.uv, 0.0);
  let T = h.r;
  let smoke = h.b;
  if (T < 0.003 && smoke < 0.003) { return vec4f(0.0); }
  let fl = textureSampleLevel(flow, samp_linear, i.uv, 0.0);
  let inv = 1.0 / max(T, 0.02);
  let form = clamp(h.g / max(T, 1e-4), 0.0, 1.0);
  let vel = fl.xy * inv * field.advect;
  let dist = max(fl.z / max(T, 1e-4), 0.1);
  let t = field.time;
  // the flame's plane in metres: the pixel at its distance, plus where the camera is (so a camera that slides along
  // its right or up doesn't drag the noise with it)
  let th = tan(frame.fovY * 0.5);
  let ndc = vec2f(i.uv.x * 2.0 - 1.0, 1.0 - 2.0 * i.uv.y);
  let w = vec2f(ndc.x * th * frame.aspect, ndc.y * th) * dist + vec2f(dot(frame.camPos, frame.camRight), dot(frame.camPos, frame.camUp));
  let n = carried(w, vel, t);
  // the sum, its cores compressed (many flames in a line of sight would otherwise all read as one white-hot mass):
  // linear where it is thin, toward 2.2 where it is thick
  let Tc = 2.2 * (1.0 - exp(-T / 2.2));
  // fire: the reference's display noise on the sum (with more contrast: the sum is smoother than the 2D fluid's
  // field), less a cut that opens the dark gaps, through the warm ramp
  let ns = smoothstep(0.2, 0.8, n);
  let Td = max(0.0, Tc * (1.0 - field.gaps + 2.0 * field.gaps * ns) - field.cut);
  let fire = fireRamp(min(Td, 3.2));
  // plasma: filaments (per metre: the reference's 30 × 13 per screen height of 2.4 m), scrolling up fast, bent by the
  // display noise, a flicker at ~40 Hz
  let q = w * vec2f(12.5, 5.4);
  let r1 = ridge(vnoise2(q + vec2f(t * 2.3, -t * 9.0) + n * 3.0));
  let r2 = ridge(vnoise2(q * 2.1 + vec2f(-t * 3.7, -t * 13.0)));
  let fil = pow(r1, 8.0) + 0.7 * pow(r2, 10.0);
  let flick = mix(1.0, 0.75 + 0.5 * vnoise2(vec2f(t * 41.0, w.y * 1.7 + w.x * 0.8)), field.flicker);
  let Tp = clamp(Tc * (0.25 + 3.2 * fil) * flick - 0.03, 0.0, 3.6);
  let plasma = (plasmaRamp(Tp) * 0.5 + vec3f(0.30, 0.06, 0.55) * 0.5 * smoothstep(0.02, 0.6, Tc)) * field.plasmaGlow;
  // the torch: sharper tongues, half-formed threads in it
  let Tt = max(0.0, Tc * (0.2 + 1.6 * ns) * (0.7 + 0.9 * sqrt(fil)) - field.cut);
  let torch = torchRamp(Tt);
  var col = mix(fire, torch, smoothstep(0.0, 0.5, form));
  col = mix(col, plasma, smoothstep(0.5, 1.0, form));
  col *= field.intensity;
  // smoke: soft, warm grey-brown, a little lit by the flame it was
  let sa = clamp((1.0 - exp(-smoke * field.smokeDark)) * (0.6 + 0.4 * n), 0.0, 0.85) * (1.0 - form);
  let sc = vec3f(0.022, 0.018, 0.016) + fireRamp(Tc * 0.35) * 0.05;
  return vec4f(col + sc * sa, sa);
}

/** the focus texture (half resolution, r16float): the flames' view distance (m) where they are dense, far elsewhere
 *  (6e4: 1e5 does not fit a half float, which would hold it as infinity and spread NaN through a linear filter) */
@fragment fn fs_focus(i: FullscreenOut) -> @location(0) vec4f {
  let px = vec2i(i.uv * vec2f(textureDimensions(heat)));
  let T = textureLoad(heat, px, 0).r;
  let d = textureLoad(flow, px, 0).z / max(T, 1e-4);
  return vec4f(select(6e4, d, T > field.focusT), 0.0, 0.0, 1.0);
}
