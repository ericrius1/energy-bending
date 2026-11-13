// The matter field's tunables: how fast the air forgets (decays toward calm), how much it spreads, how hot air rises
// and cold air sinks, how strongly moving limbs drag it and auras soak into it, and how much steam a clash makes.
// Rates are per second. The overlay and the test vortex are for looking at it (?field, ?vortex).
import { defineParams } from '../../engine/params';

export const fieldParams = defineParams('field', {
  /** wind fades toward calm (1/s) */
  windDecay: 1.1,
  /** heat, cold and wet fade (1/s) */
  hotDecay: 1.6,
  coldDecay: 1.2,
  wetDecay: 0.9,
  /** spreading toward the neighbours (1/s) */
  diffuse: 2.5,
  /** hot air rises: m/s² at heat 1; cold air sinks */
  buoyancy: 4,
  sink: 1.2,
  /** how quickly moving limbs bring the air to their own velocity (1/s) */
  drag: 14,
  /** how quickly the air near a body takes its aura (1/s) */
  auraRate: 10,
  /** how far past a capsule's surface an aura and its drag reach (m, the falloff's scale) */
  reach: 0.14,
  /** heat and cold radiate past a body's near falloff: a faint tail of this level at the surface, falling by e over
   *  `radiateLen` m (0.3 and 0.25: 0.09 at 30 cm, nothing at a metre), so water feels a flame beside it and ice melts */
  radiate: 0.3,
  radiateLen: 0.25,
  /** a fast limb drags the air further: the drag's reach × (1 + wake × speed in m/s): the wake behind a kick */
  wake: 0.08,
  /** dryness (plasma's) fades (1/s) */
  dryDecay: 2.5,
  /** how fast flame and ice use each other up where they meet (1/s), and how much wet that melting leaves */
  exchange: 3,
  melt: 0.6,
  /** how much steam heat meeting wet makes (reactions read it) */
  steamGain: 1,
  /** the fastest the wind may blow (m/s) */
  windMax: 12,
  /** how quickly a vortex source turns the air (1/s) */
  vortexRate: 5,
  /** draw the field over the scene (?field) */
  overlay: false,
  /** brightness of the overlay */
  overlayGain: 1,
  /** a test vortex at the dancers' middle, its strength in m/s (?vortex sets 3): 0 off */
  testVortex: 0,
}, {
  windDecay: { min: 0, max: 6, label: 'wind fades' },
  diffuse: { min: 0, max: 10, label: 'air spreads' },
  buoyancy: { min: 0, max: 12, label: 'hot air rises' },
  drag: { min: 0, max: 40, label: 'limbs drag the air' },
  reach: { min: 0.03, max: 0.5, step: 0.01, label: 'aura reach' },
  radiate: { min: 0, max: 1, label: 'heat radiates' },
  radiateLen: { min: 0.05, max: 1, step: 0.01, label: 'radiant tail (m)' },
  wake: { min: 0, max: 0.5, step: 0.01, label: 'kick wake' },
  steamGain: { min: 0, max: 4, label: 'steam from a clash' },
  overlay: { label: 'show the field' },
  testVortex: { min: 0, max: 8, label: 'test vortex' },
});
