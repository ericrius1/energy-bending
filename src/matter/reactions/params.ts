// Steam's tunables: how many particles the pool holds and how it splits them (set at start), how readily wisps,
// fronts and sparks are born where two bodies meet, how wisps rise and billow and how long they live, how big and how
// dense they look, the cap on any pixel's steam, and how bright the front at the contact burns.
import { defineParams } from '../../engine/params';
import { LIMITS } from '../../engine/limits';

export const steamParams = defineParams('steam', {
  /** particles in the pool (read at start; a phone runs a third): wisps, fronts, drips and sparks by these shares */
  pool: 6000,
  wispShare: 0.5,
  frontShare: 0.38,
  dripShare: 0.06,
  /** wisps: the chance a second a dead one is born at a contact where the field makes steam at strength 1 */
  birth: 7,
  /** how fast a new wisp rises on its own (m/s), fading as it ages */
  rise: 0.9,
  /** how quickly a wisp takes the wind's velocity (1/s) */
  follow: 3,
  /** the slow curl that makes it billow (m/s) */
  turbulence: 0.7,
  /** how long a wisp lives (s): gone within about a second, never a standing cloud */
  lifeMin: 0.55,
  lifeMax: 1.1,
  /** its size when born and when it fades (m, the blob's radius) */
  sizeBirth: 0.04,
  sizeEnd: 0.22,
  /** a wisp's optical depth at its middle (the composite turns the sum into coverage under `cap`) */
  density: 0.3,
  /** its own soft light */
  glow: 0.12,
  /** how much the field's heat below a wisp lights its underside orange */
  warmth: 0.6,
  /** the most of what is behind that steam may cover in any pixel, however dense (both dancers stay visible) */
  cap: 0.55,
  /** the brightest steam may be (of white), the fronts aside */
  maxBright: 0.85,
  /** how far apart two bodies' surfaces may be for their meeting to make a front (m) */
  gap: 0.07,
  /** fronts: the chance a dead one is born when it finds a reacting contact (0 … 1), how long one lives (s), and how
   *  bright it burns (HDR: it blooms) */
  frontRate: 1,
  frontLife: 0.12,
  frontGlow: 3.2,
  /** flame on ice throws a jet of vapour (m/s); plasma on ice: how fast its cold vapour sinks before it rises (× rise) */
  jet: 1.6,
  sink: 0.9,
  /** drips and sparks: births a second at a contact making steam at strength 1 */
  sparkRate: 40,
  /** the wisps' target, as a fraction of the render size, and the composite's blur (in its texels) */
  lowRes: 0.5,
  blur: 1.2,
}, {
  birth: { min: 0, max: 40, label: 'steam births' },
  rise: { min: 0, max: 3, label: 'steam rises' },
  density: { min: 0, max: 2, label: 'steam density' },
  cap: { min: 0, max: 1, label: 'steam cap' },
  glow: { min: 0, max: 1, label: 'steam glow' },
  frontGlow: { min: 0, max: 10, label: 'front glow' },
  pool: { min: 1000, max: LIMITS.steam, step: 1000, label: 'steam particles (reload)' },
});
