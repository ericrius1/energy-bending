// The water's parameters: how many particles a dancer's water is, how it moves (running down the body in swells, loose
// on it, quick to shed, peeling off fast limbs, heavy when it falls, splashing), how it changes state (the form, the
// field's heat and cold), and how its screen-space surface looks (the reference's luminous model: docs/element-looks.md
// §2; ice's facets in the same surface, §3). Ice's shards, mist and set ice are ice/params.ts. `form` is for the panel
// and the capture steps (dresses are matter/core/presets.ts, ?dress=): the game sets each dancer's form on the dancer
// (Dancer.form, bend.form) and dresses dancers through their loadouts.
// Colours are written as sRGB hex (engine/params.ts `hex` makes them linear); the reference's own linear values are in
// the comments.
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
  /** the body runs: how fast the water slides along the body (m/s), the swells that run down it (m high, m apart), and
   *  how much a fast limb peels sheets off its trailing side (0 evenly … 1 trailing side and swells) */
  flowSpeed: 0.35,
  bulge: 0.022,
  bulgeSpacing: 0.24,
  peel: 1,
  /** the outline breaking in the motion itself: how far the outer shell curls (m, more on a fast limb's trailing
   *  side), the curl's scale (1/m) and how fast it climbs (m/s); streamers: the chance a second an outer particle on a
   *  fast limb's trailing side is left hanging where the limb was (a ribbon of the body), before it falls */
  shellCurl: 0.022,
  shellScale: 6,
  shellClimb: 0.4,
  streamers: 1,
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
   *  cold below which water freezes. From the field's measured values (docs/reports/4-steam.md): a body's surface reads
   *  about ±0.6, 0.3 m out about ±0.08, a metre out nothing. Water freezes from 0.05 (ice within ~30 cm). Ice melts
   *  from 0.3 ("touching") and water boils from 0.6 (inside a flame): lower, a body that wears fire and water or ice
   *  itself (a fusion's mixed loadouts, `all`) melts and boils away from its own fire, since the field's heat is one
   *  sum (seen at 0.05 and 0.1: docs/reports/5-integration.md) */
  freezeRate: 1.6,
  meltHeat: 0.3,
  boilHeat: 0.6,
  freezeCold: 0.05,
  // the surface
  /** a particle's sphere, × its home's size */
  radius: 4.2,
  /** the smoothing's width (m) and its narrow depth band (m: behind it a neighbour is another surface) */
  smooth: 0.05,
  falloff: 0.06,
  /** smoothing passes (each one along x and then along y) */
  smoothPasses: 3,
  /** the surface's resolution, × the view's (a coarse device runs half); a gate's view and a mirror run less */
  resolution: 1,
  /** how much of the splats' summed chord counts as thickness (they overlap), and the outline's band (m) */
  thickness: 0.35,
  coverLo: 0.01,
  coverHi: 0.03,
  /** thickness (m) → the reference's amount W (its colours are keyed to W from 0.2 to 1.3) */
  amount: 5,
  /** what light does in it (docs/reports/7-water.md): what shows through a unit of the reference's amount W, per
   *  channel (red goes first, so thick water is deep blue-green, not a flat blue), how milky it is per unit W (the
   *  light it scatters inside hides the world behind), and the most it hides (thin water about 0.3 to 0.45) */
  deep: '#a4d4da',
  milk: 0.6,
  opacity: 0.6,
  /** the colour of the light scattered inside it (the world's light, taken in): pale cyan, as the reference's */
  tint: '#cfefff',
  /** its own faint light (the caustic rising through it): enough to read on black, far below a fire beside it */
  glowColor: '#3bace4',
  glow: 0.12,
  /** the rim, only on the side a light comes from (the world's key, each fire), × that light */
  rim: '#d8f4ff',
  rimStrength: 1,
  /** how sharp the rim is (the power of 1 − n·v: higher, thinner) */
  rimSharp: 4,
  /** the water's small waves on its surface: how much they tilt it, their scale (1/m) */
  ripples: 0.12,
  rippleScale: 11,
  /** how much the surface's normal comes from its depth (1) rather than from its thickness (0) where it is thick */
  depthNormal: 0.5,
  /** the edge that breaks: how far its tongues reach (m), how far its curl pushes (m), how much thin water tears, the
   *  noise's scale (1/m) and how fast it climbs (m/s) */
  wisp: 0.035,
  curl: 0.02,
  tear: 0.5,
  wispScale: 9,
  climb: 0.5,
  /** the caustic rising through it: its scale (1/m) and speed (m/s) */
  caustic: 9,
  rise: 0.22,
  refract: 0.12,
  dispersion: 0.05,
  reflect: 0.6,
  glint: 1,
  foam: 1,
  /** also write the surface's distance into the scene's alpha (off: the frame's depth contract keeps alpha for opaque
   *  things; the lens reads MatterPasses.focus). On only for captures made before the lens and the air read focus */
  distAlpha: false,
  /** a mirroring floor's copy */
  mirror: 0.6,
  /** spray: stretched drops, their size (m), how many glint (share), foam's white */
  drops: 0.5,
  dropSize: 0.004,
  dropGlints: 0.05,
  foamDrops: 1,
}, {
  perDancer: { min: 10_000, max: 200_000, step: 5000, label: 'water per dancer' },
  form: { min: 0, max: 1, step: 0.01, label: 'form (water … ice)' },
  stiffness: { min: 5, max: 300, label: 'water holds together' },
  flowSpeed: { min: 0, max: 1.5, label: 'runs down the body (m/s)' },
  bulge: { min: 0, max: 0.06, step: 0.001, label: 'swells (m)' },
  drip: { min: 0, max: 0.5, label: 'drips' },
  speedShed: { min: 0, max: 5, label: 'spray from fast limbs' },
  splash: { min: 0, max: 1 },
  radius: { min: 1, max: 6, label: 'drop size' },
  smooth: { min: 0.005, max: 0.1, step: 0.001, label: 'surface smoothing' },
  smoothPasses: { min: 0, max: 3, step: 1 },
  thickness: { min: 0.05, max: 2 },
  refract: { min: 0, max: 0.3 },
  deep: { color: true, label: 'what thick water lets through' },
  tint: { color: true, label: 'light inside' },
  glowColor: { color: true, label: 'own light' },
  glow: { min: 0, max: 1, label: 'own light' },
  opacity: { min: 0, max: 1 },
  rim: { color: true, label: 'rim (toward light)' },
  wisp: { min: 0, max: 0.3, step: 0.005, label: 'edge tongues (m)' },
  curl: { min: 0, max: 0.15, step: 0.005, label: 'edge curl (m)' },
  tear: { min: 0, max: 1 },
});
