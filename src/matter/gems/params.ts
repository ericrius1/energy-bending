// The gems' parameters: how the stones move (in water: loose stones sink slowly against a heavy drag, sway on a slow
// current and land softly; the stones on a body trail it a little), how they hold together in fast moves, the large
// crystals, the hearts, how they look, their sparkles, and their level of detail. A programme sets how many there
// are (dancer/show.ts showParams.count).
import { defineParams } from '../../engine/params';

export const gemParams = defineParams('gems', {
  order: 0.92,
  scale: 1,
  sizeVar: 0.25,
  fill: 0.4,
  spin: 0.15,
  breathe: 0.0,
  // motion
  stiffness: 130,
  damping: 19,
  noiseAmp: 0.02,
  noiseFreq: 3,
  noiseSpeed: 0.45,
  shedRate: 0.002,
  speedShed: 0.15,
  fallTime: 3.2,
  gravity: 3.2,
  bounce: 0.12,
  friction: 0.45,
  drag: 1.4,
  current: 0.6,
  /** how far above the stage stones joining a dance rain in from (m, over the first 2.5) */
  rainHeight: 6,
  regrow: false,
  shatter: 0.7,
  scatter: 0.5,
  streak: 0.045,
  streakGlow: 0.42,
  /** seconds the spares (stones nobody wears now) take to fade into the floor before they are parked */
  spareFade: 1.2,
  // fast motion (motion.ts, body.wgsl's hold)
  /** 0 the plain spring … 1: fast limbs hold their stones (stiffer along the travel, fed the bone's acceleration) */
  hold: 1,
  /** how far (m) a stone may trail its home when its limb is slow (a third of it when fast) */
  trailCap: 0.16,
  /** how much of speedShed's steady leak is left (the rest comes off in bursts at peaks and impacts) */
  leak: 0.12,
  /** the share of a limb's stones a burst throws, at full strength */
  burst: 0.16,
  /** a limb end faster than this (m/s) that starts to slow is a peak (a kick at full stretch) */
  peakSpeed: 4.2,
  /** a limb end slowing faster than this (m/s²) has hit something */
  impact: 70,
  /** how much a landing squashes the body */
  landSquash: 3,
  // the large crystals (crystals.ts)
  crystalSpring: 450,
  /** how far (m) a crystal may lag its bone */
  crystalLag: 0.05,
  /** seconds a cracked crystal waits before it re-forms */
  reform: 1.5,
  /** the share of its stones a cracking crystal throws */
  crackBurst: 0.6,
  /** a peak at least this strong (0 … 1) cracks a crystal */
  crackAt: 0.5,
  /** the crystals' extra dispersion (× a stone's) */
  crystal: 2.4,
  // the hearts (hearts.ts)
  /** how much a heart lights the stones and crystals round it */
  heart: 1,
  heartHalo: 0.9,
  haloSize: 2.4,
  // sparkles
  sparkRate: 0.6,
  sparkSpeed: 0.9,
  sparkLife: 1.6,
  frictionSpark: 0.8,
  sparkle: 2,
  sparkSize: 0.6,
  // look
  envIntensity: 0.8,
  glint: 0.8,
  dispersion: 0.04,
  emissive: 1,
  speedGlow: 0.35,
  reflect: 0.3,
  // performance
  reflection: true,
  lodNear: 36,
  lodFar: 12,
}, {
  stiffness: { min: 5, max: 600, label: 'hold together' },
  gravity: { min: 0, max: 20, label: 'gravity when they fall' },
  scale: { min: 0.3, max: 2.5, label: 'size' },
  emissive: { min: 0, max: 4, label: 'crystal glow' },
  dispersion: { min: 0, max: 0.3, label: 'fire' },
  sparkle: { min: 0, max: 20, label: 'sparkles' },
  reflection: { label: 'floor reflection' },
  hold: { min: 0, max: 1, label: 'hold in fast moves' },
  heart: { min: 0, max: 3, label: 'heart light' },
});
