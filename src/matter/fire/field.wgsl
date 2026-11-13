// What the fire's screen-space field shares (no bindings): its uniform, and the ramps the composite applies to the
// summed temperature. The flames are splatted into two half-resolution targets per view (splat.wgsl):
//
//   heat  r: temperature (summed)   g: temperature × form (form = g / r; a fusion's flames: × their side)   b: smoke
//         a: temperature of a fusion's flames (a / r: how much of a pixel is the fusion's body)
//   flow  rg: temperature × the flame's velocity across the screen (m/s, camera right and up)
//   b: temperature × view distance (m)   a: unused
//
// and one composite (composite.wgsl) turns the sums into light. The ramp is applied once, to the sum, as the 2D
// prototype does (docs/element-looks.md §1): a non-linear ramp of a summed field gives contours (the licks), where a
// sum of ramped sprites gives fur.
#include "./flame"

struct FireField {
  gain: f32,           // temperature a flame splats at its centre (already divided by how many flames a dancer has)
  spread: f32,         // a splat's half width, × the flame's own size
  soft: f32,           // m: how far in front of an opaque surface a flame fades out (a gem heart shows through)
  smokeGain: f32,      // smoke a flame splats (wet flames; dry fire makes a little at the end of its life)
  drySmoke: f32,       // how much smoke dry fire makes (0 … 1)
  reflect: f32,        // the mirror floor's copy
  stretch: f32,        // seconds of motion a splat is stretched along
  tongues: f32,        // the world-space noise that splits flames into tongues before they are summed
  // the composite
  intensity: f32,      // light per unit of the ramp
  gaps: f32,           // display noise: T × (1 − gaps + 2 gaps n) (the reference: 0.34)
  scale: f32,          // display noise cells per metre (the reference: 11 × 7 per screen height ≈ 4.6 × 2.9 / m)
  climb: f32,          // m/s the display noise climbs on its own (the flow carries it too)
  advect: f32,         // how much of the splatted velocity carries the display noise
  period: f32,         // s: the flow-map's cycle (two phases, half a cycle apart)
  smokeDark: f32,      // how much a unit of smoke covers what is behind
  plasmaGlow: f32,
  flicker: f32,        // plasma's ~40 Hz flicker
  cut: f32,            // temperature subtracted after the noise (the reference: 0.035): the edge's dark gap
  focusT: f32,         // summed temperature dense enough to focus on (the focus texture)
  time: f32,
  embers: f32,         // ember glow (embers are drawn as points in the scene, draw.wgsl)
  mirrorY: f32,        // the height of the floor the mirror copy is reflected about (the geode's agate, the Pool's
                       // water, the temple's tide: World.waterY)
  mirrorFall: f32,     // 1/m: how fast the copy fades with the flame's height over the floor (polished agate fades
                       // fast; still water mirrors the whole body)
  pad2: f32,
  /** a fusion (field.ts fusionFront): kind (0 steam, 1 prism, 2 storm, 3 aurora), amount 0 … 1, where in its eight bars
   *  (0 … 8, past 8 the release), the landing's pulse */
  fusion: vec4f,
  /** the pair's middle (xyz) and floor (m), for the kinds' colour by height */
  fusionAt: vec4f,
}

/** the in-between of fire and plasma (form 0.5): a blue torch, deep blue at its skin, cyan-white inside, a white cone
 *  at its core. Hotter than fire, not yet ionised: its own state, not a pink crossfade */
fn torchRamp(T: f32) -> vec3f {
  let t = clamp(T, 0.0, 3.4);
  return shoulder(vec3f(0.10, 0.22, 1.0) * 1.1 * t + vec3f(0.35, 0.70, 1.0) * 0.45 * t * t + vec3f(1.0, 0.96, 0.9) * 0.55 * t * t * t);
}
