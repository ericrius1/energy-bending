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
//   a fusion        both bodies' flames summed into one shape (heat.a: how much of a pixel is the fusion's), through
//                   the kind's own ramp (fusionLook): steam a soft white-gold vapour with orange and cyan licks by which
//                   body it came from, prism clear and cold with spectral edges where the field's contour bends light,
//                   storm a dark blue-violet lit from inside by flickers and threads of lightning, aurora curtains of
//                   green into violet by height, drifting at half time
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

/** a soft spectrum, 0 … 1 round the hues (never a full-saturation primary: desaturated toward white) */
fn spectrum(h: f32) -> vec3f {
  let c = clamp(abs(fract(h + vec3f(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
  return mix(vec3f(1.0), c, 0.7);
}

/** the summed temperature at uv (compressed as the composite's is) */
fn tAt(uv: vec2f) -> f32 {
  let T = textureSampleLevel(heat, samp_linear, uv, 0.0).r;
  return 2.2 * (1.0 - exp(-T / 2.2));
}

/** what a fusion's kind makes of the summed field: Tc the compressed sum, Td after the display noise, n the carried
 *  noise, side 0 … 1 (which body's flames), fil plasma's threads, w the flame's plane (m), y its height over the floor
 *  (m), uv the pixel (prism samples its neighbours for the contour) */
fn fusionLook(K: u32, Tc: f32, Td: f32, n: f32, side: f32, fil: f32, w: vec2f, y: f32, uv: vec2f, t: f32) -> vec3f {
  let v = 1.0 - exp(-1.5 * Td);
  if (K == 1u) {
    // prism: clear and cold; at the contours the field's gradient splits the light, a hue that turns with the edge's
    // direction and the flow, thin; inside a faint thin-film shimmer
    // (the gradient over a few texels, so the edge is a soft band, not a crackle)
    let px = 3.5 / vec2f(textureDimensions(heat));
    let g = vec2f(tAt(uv + vec2f(px.x, 0.0)) - tAt(uv - vec2f(px.x, 0.0)), tAt(uv + vec2f(0.0, px.y)) - tAt(uv - vec2f(0.0, px.y)));
    let gl = length(g);
    let edge = smoothstep(0.05, 0.5, gl) * (1.0 - smoothstep(1.4, 2.2, Tc));
    // the spectrum lies in bands across the body (dispersion: the hue by where the light leaves it), bent by the
    // carried noise so the bands turn with the motion, and by the contour's direction a little
    let hue = w.x * 0.55 + w.y * 0.18 + n * 0.35 + atan2(g.y, g.x) * 0.04 + t * 0.05;
    let body = vec3f(0.82, 0.9, 1.0) * (0.22 * v + 0.6 * smoothstep(1.2, 2.5, Td));
    let film = spectrum(Td * 0.4 + n * 0.5 + w.x * 0.3 - t * 0.04) * v * 0.32;
    return body + film + spectrum(hue) * edge * 0.95;
  }
  if (K == 2u) {
    // storm: dark blue-violet and heavy; patches lit from inside that come and go; threads of lightning in it
    let deep = vec3f(0.09, 0.08, 0.30) * v * 1.6 + vec3f(0.22, 0.16, 0.55) * smoothstep(0.9, 2.4, Td) * 0.6;
    // (soft patches: a smooth noise, moved to a new place each flicker, its peaks lit; never a cell's hard edge)
    let beat = floor(t * 7.0);
    let jump = vec2f(hash2i(vec2i(i32(beat), 3)), hash2i(vec2i(i32(beat), 11))) * 37.0;
    let flash = smoothstep(0.66, 0.86, vnoise2(w * vec2f(1.7, 1.2) + jump)) * step(0.35, hash2i(vec2i(i32(beat), 29)));
    let soft = smoothstep(0.25, 1.4, Tc);
    let lit = vec3f(0.62, 0.58, 1.0) * flash * soft * (0.6 + 0.8 * n) * 1.4;
    let bolt = vec3f(0.75, 0.62, 1.0) * pow(fil, 1.5) * soft * (0.4 + 2.0 * flash) * 1.3;
    return deep + lit + bolt;
  }
  if (K == 3u) {
    // aurora: curtains (tall folds: fine across, long up, drifting slowly) green low, cyan, violet high; a cyan-white
    // core where both bodies are
    let hh = clamp(y / 3.2, 0.0, 1.0);
    let hue = mix(mix(vec3f(0.2, 1.0, 0.62), vec3f(0.25, 0.9, 1.0), smoothstep(0.15, 0.45, hh)), vec3f(0.62, 0.22, 1.0), smoothstep(0.4, 0.85, hh + (side - 0.5) * 0.15));
    let c1 = ridge(vnoise2(vec2f(w.x * 3.3 + t * 0.12 + n * 0.6, w.y * 0.35 - t * 0.08)));
    let c2 = ridge(vnoise2(vec2f(w.x * 7.1 - t * 0.09, w.y * 0.6 + 3.1)));
    let curtain = 0.35 + 1.1 * pow(c1, 3.0) + 0.5 * pow(c2, 4.0);
    let core = vec3f(0.82, 1.0, 0.97) * smoothstep(0.8, 2.2, Td) * 0.9 * (1.0 - smoothstep(0.45, 0.8, hh));
    return hue * v * curtain * 1.15 + core;
  }
  // steam: a soft white-gold vapour body, a warm core, and at its thin edges licks of orange (the fire's body) and
  // cyan (the water's)
  // (softer than the others: it saturates slowly, so a thick part is brighter than a thin one and the vapour has depth)
  let vs = 1.0 - exp(-0.8 * Td);
  let body = vec3f(0.95, 0.94, 0.92) * vs * 1.25 * (0.8 + 0.4 * n);
  let core = vec3f(1.0, 0.8, 0.5) * smoothstep(1.2, 2.8, Td) * 0.5;
  let thin = smoothstep(0.02, 0.2, Td) * (1.0 - smoothstep(0.3, 1.0, Td));
  let tint = mix(vec3f(1.0, 0.42, 0.12), vec3f(0.2, 0.72, 1.0), smoothstep(0.3, 0.7, side));
  let lick = tint * thin * smoothstep(0.4, 0.75, n) * 1.6;
  return body + core + lick;
}

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
  // a fusion's body: its share of the pixel through the kind's look (the landing swells it for a moment)
  let wF = clamp(h.a / max(T, 1e-4), 0.0, 1.0);
  if (wF > 0.002) {
    let side = clamp(h.g / max(h.a, 1e-4), 0.0, 1.0);
    let K = u32(field.fusion.x + 0.5);
    // the flame's point in the world (along the view ray to its distance): its height over the pair's floor
    let ray = frame.camFwd + frame.camRight * (ndc.x * th * frame.aspect) + frame.camUp * (ndc.y * th);
    let y = frame.camPos.y + ray.y * dist - field.fusionAt.w;
    // soft vapour (steam, aurora) takes less of the dark gaps than flame does
    let gk = select(1.0, 0.45, K == 0u || K == 3u);
    let Tf = max(0.0, Tc * (1.0 - field.gaps * gk + 2.0 * field.gaps * gk * ns) - field.cut * gk);
    let fc = shoulder(fusionLook(K, Tc, Tf, n, side, fil, w, y, i.uv, t) * (1.0 + 0.9 * field.fusion.w));
    col = mix(col, fc, wF);
  }
  // (the shoulder again on the mix: fire, torch, plasma's haze and a fusion's look summed can pass it)
  col = shoulder(col * field.intensity);
  // smoke: soft, warm grey-brown, a little lit by the flame it was
  let sa = clamp((1.0 - exp(-smoke * field.smokeDark)) * (0.6 + 0.4 * n), 0.0, 0.85) * (1.0 - form) * (1.0 - wF);
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
