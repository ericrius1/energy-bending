// The water's parameters: how many particles a dancer's water is, how it moves (loose on the body, quick to shed,
// heavy when it falls, splashing), how it changes state (the form, the field's heat and cold), and how its
// screen-space surface looks. Ice's own look is ice/params.ts. `form` is for the panel and the capture
// steps (dresses are matter/core/presets.ts, ?dress=): the game sets each dancer's form on the dancer (Dancer.form, bend.form) and dresses dancers through their loadouts.
import { defineParams } from '../../engine/params';

/** the most particles the pool holds (buffers are made this big once: 96 bytes each, so 38 MB). A desktop dancer
 *  is 100k; four water dancers fit. Kept here, not in engine/limits.ts, because only this folder sizes by it. */
export const WATER_MAX = 400_000;

export const waterParams = defineParams('water', {
  /** particles in one dancer made all of water (a coarse device runs 30k); a dancer half water gets half */
  perDancer: 100_000,
  /** every dancer's form, 0 water … 1 ice, set from the panel or a capture (the game calls WaterPasses.form) */
  form: 0,
  // motion (water; ice blends to its own stiffness per particle)
  stiffness: 60,
  damping: 7,
  iceStiffness: 420,
  iceDamping: 40,
  fill: 0.6,
  noiseAmp: 0.008,
  noiseFreq: 4,
  noiseSpeed: 1.4,
  /** the surface's ripple (m), and how close its waves run along the body (1/m) */
  wobble: 0.005,
  wobbleFreq: 9,
  /** drops let go a second, per particle, while dancing; more where a limb is fast */
  drip: 0.012,
  speedShed: 0.45,
  /** how hard a shed drop is flung on, as a share of its limb's speed */
  spray: 0.35,
  scatter: 0.08,
  fallTime: 0.9,
  gravity: 9.8,
  bounce: 0.05,
  friction: 0.5,
  drag: 0.3,
  splash: 0.25,
  /** how much the field's wind pushes spray */
  wind: 1,
  /** how fast a particle changes state (1/s), the field heat above which ice melts and water boils away, and the
   *  cold below which water freezes */
  freezeRate: 1.6,
  meltHeat: 0.45,
  boilHeat: 0.75,
  freezeCold: 0.25,
  // the surface
  /** a particle's sphere, × its home's size */
  radius: 4.2,
  /** the smoothing's width (m) and the depth difference (m) past which it stops smoothing across */
  smooth: 0.045,
  falloff: 0.05,
  /** smoothing passes (each one along x and then along y) */
  smoothPasses: 3,
  /** the surface's resolution, × the view's (a coarse device runs half) */
  resolution: 1,
  /** how much of the splats' summed thickness counts as water (they overlap) */
  thickness: 0.35,
  absorbR: 4,
  absorbG: 1.2,
  absorbB: 0.55,
  deep: '#1a72b8',
  glow: 0.8,
  refract: 0.03,
  dispersion: 0.12,
  reflect: 1,
  glint: 1,
  foam: 1,
  frost: 1,
  edge: 0.02,
  /** glints on flying drops */
  drops: 1,
  dropSize: 0.012,
}, {
  perDancer: { min: 10_000, max: 200_000, step: 5000, label: 'water per dancer' },
  form: { min: 0, max: 1, step: 0.01, label: 'form (water … ice)' },
  stiffness: { min: 5, max: 300, label: 'water holds together' },
  drip: { min: 0, max: 0.5, label: 'drips' },
  speedShed: { min: 0, max: 5, label: 'spray from fast limbs' },
  splash: { min: 0, max: 1 },
  radius: { min: 1, max: 6, label: 'drop size' },
  smooth: { min: 0.005, max: 0.08, step: 0.001, label: 'surface smoothing' },
  smoothPasses: { min: 0, max: 3, step: 1 },
  thickness: { min: 0.05, max: 2 },
  refract: { min: 0, max: 0.3 },
  deep: { color: true, label: 'deep water' },
});
