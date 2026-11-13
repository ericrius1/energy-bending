// The fire's parameters (bend.params.fire; the panel shows a few): how many flames a fire dancer gets, how a flame
// moves and how long it lives, and how it looks. Plasma is the same particles at form 1, so its motion and look are
// here too (cling, flicker, plasmaGlow); its arcs have their own (matter/plasma/params.ts).
import { defineParams } from '../../engine/params';

export const fireParams = defineParams('fire', {
  /** flames for one dancer wearing nothing but fire, at the show's default stone count (a programme with more stones
   *  scales it; a phone takes `perDancerCoarse`); a dancer wearing fire on part of its body gets its share */
  perDancer: 150_000,
  perDancerCoarse: 40_000,
  // motion
  life: 0.7,
  buoyancy: 1.8,
  turbulence: 1.5,
  drag: 2.2,
  inherit: 0.6,
  heat: 1.45,
  embers: 1,
  cling: 160,
  // look
  size: 0.021,
  intensity: 0.012,
  stretch: 0.03,
  erode: 0.25,
  reflect: 0.35,
  emberGlow: 2.2,
  smoke: 0.5,
  plasmaGlow: 1.1,
  flicker: 0.8,
  tongues: 0.85,
  /** the world light (matter/fire/light.wgsl): intensity of a whole body of fire */
  light: 2.5,
}, {
  perDancer: { min: 10_000, max: 260_000, step: 5000, label: 'flames a dancer' },
  life: { min: 0.2, max: 3, label: 'flame life (s)' },
  buoyancy: { min: 0, max: 12, label: 'buoyancy' },
  turbulence: { min: 0, max: 12, label: 'turbulence' },
  size: { min: 0.005, max: 0.15, step: 0.001, label: 'flame size' },
  intensity: { min: 0, max: 1, step: 0.005, label: 'flame brightness' },
  erode: { min: 0, max: 1.5, label: 'tongues' },
  embers: { min: 0, max: 4, label: 'embers' },
});
