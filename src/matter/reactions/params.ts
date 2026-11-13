// Steam's tunables: how many puffs the pool holds (set at start), how readily they are born where the field makes
// steam, how they rise and billow, how long they live, how big and how dense they look, and how they glow.
import { defineParams } from '../../engine/params';
import { LIMITS } from '../../engine/limits';

export const steamParams = defineParams('steam', {
  /** puffs in the pool (read at start; a phone runs a third) */
  pool: 16000,
  /** births: the chance a second a dead puff is born where the field makes steam at strength 1 */
  birth: 9,
  /** how fast a new puff rises on its own (m/s), fading as it ages */
  rise: 0.75,
  /** how quickly a puff takes the wind's velocity (1/s) */
  follow: 3,
  /** the slow curl that makes it billow (m/s) */
  turbulence: 0.35,
  /** how long a puff lives (s) */
  lifeMin: 1.8,
  lifeMax: 3.8,
  /** its size when born and when it fades (m, the blob's radius) */
  sizeBirth: 0.07,
  sizeEnd: 0.3,
  /** how opaque a puff is at its middle */
  density: 0.22,
  /** its own soft light */
  glow: 0.12,
  /** how much the field's heat lights it orange */
  warmth: 0.45,
}, {
  birth: { min: 0, max: 40, label: 'steam births' },
  rise: { min: 0, max: 3, label: 'steam rises' },
  density: { min: 0, max: 1, label: 'steam density' },
  glow: { min: 0, max: 1, label: 'steam glow' },
  pool: { min: 1000, max: LIMITS.steam, step: 1000, label: 'steam puffs (reload)' },
});
