// The fire's parameters (bend.params.fire; the panel shows a few): how many flames a fire dancer gets, how a flame
// moves and how long it lives, and how the field they are splatted into is made light (field.wgsl, composite.wgsl).
// Plasma is the same particles at form 1, so its motion and look are here too (cling, flicker, plasmaGlow); its arcs
// have their own (matter/plasma/params.ts).
import { defineParams } from '../../engine/params';

export const fireParams = defineParams('fire', {
  /** flames for one dancer wearing nothing but fire, at the show's default stone count (a programme with more stones
   *  scales it; a phone takes `perDancerCoarse`); a dancer wearing fire on part of its body gets its share. The field
   *  is smooth, so it needs far fewer than sprites drawn one by one did; each splat is weighted by `perDancer` over
   *  this count, so the sum (and the look) stays the same when the count changes */
  perDancer: 60_000,
  perDancerCoarse: 24_000,
  // motion
  life: 0.7,
  buoyancy: 1.8,
  turbulence: 1.5,
  drag: 2.2,
  inherit: 0.6,
  heat: 1.45,
  embers: 0.6,
  cling: 160,
  size: 0.021,
  /** the tongues' curl (curl.wgsl): vorticity confinement's strength, 0 off, and the most it pushes (m/s²) */
  curl: 6,
  curlMax: 24,
  /** the world light (matter/fire/light.wgsl): intensity of a whole body of fire */
  light: 2.5,
  // the field (splat.wgsl)
  /** the field's size, as a share of the view's */
  resolution: 0.5,
  /** temperature a flame adds at its centre, at 60,000 flames a dancer */
  density: 0.03,
  spread: 1.1,
  stretch: 0.03,
  tongues: 0.5,
  /** m: a flame this close in front of something opaque (a gem heart) fades out */
  soft: 0.1,
  reflect: 0.8,
  smoke: 0.5,
  drySmoke: 0.08,
  // the composite (composite.wgsl)
  intensity: 1,
  gaps: 0.7,
  noiseScale: 7,
  climb: 0.5,
  advect: 0.8,
  period: 0.7,
  cut: 0.12,
  emberGlow: 2.2,
  plasmaGlow: 1.1,
  flicker: 0.8,
  /** summed temperature dense enough for the depth of field to focus on */
  focusT: 0.4,
}, {
  perDancer: { min: 10_000, max: 260_000, step: 5000, label: 'flames a dancer' },
  life: { min: 0.2, max: 3, label: 'flame life (s)' },
  buoyancy: { min: 0, max: 12, label: 'buoyancy' },
  turbulence: { min: 0, max: 12, label: 'turbulence' },
  size: { min: 0.005, max: 0.15, step: 0.001, label: 'flame size' },
  density: { min: 0, max: 0.5, step: 0.005, label: 'flame density' },
  intensity: { min: 0, max: 4, step: 0.05, label: 'flame brightness' },
  gaps: { min: 0, max: 1, label: 'tongues (display noise)' },
  embers: { min: 0, max: 4, label: 'embers' },
  curl: { min: 0, max: 20, step: 0.1, label: 'curl (vorticity)' },
});
