// The gems' parameters: how the stones move (in water: loose stones sink slowly against a heavy drag, sway on a slow
// current and land softly; the stones on a body trail it a little), how they look, their sparkles, and their level of
// detail. A programme sets how many there are (dancer/show.ts showParams.count).
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
});
