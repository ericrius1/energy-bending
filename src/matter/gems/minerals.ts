// How each specimen looks, and the suites (three specimens a dancer wears: heart, limbs, accents). Colours are sRGB
// hex as picked; `hex()` linearises them on the way to the GPU. The specimens' shapes are public/specimens/ (made in
// Blender by scripts/specimens.py); their order there is the order of the Minerals uniform.
import { hex } from '../../engine/params';

export interface Stone {
  size: number;
  crust: string; crust2: string; bump: number; grain: number;   // rough outside: two mottled colours, bumpiness, noise scale
  band: string; band2: string; bands: number; sharp: number;    // polished cut face: two band colours, rings, sharpness
  crystal: string; glow: number;                               // crystal / polished body colour and its glow
  clarity: number; sparkle: number; ior: number; irid: number;
}

const S = (o: Partial<Stone>): Stone => ({
  size: 1, crust: '#6e655d', crust2: '#463f39', bump: 0.6, grain: 5, band: '#e9e5ee', band2: '#b8aec8', bands: 9, sharp: 0.5,
  crystal: '#ffffff', glow: 0.3, clarity: 0.7, sparkle: 0.3, ior: 1.55, irid: 0, ...o,
});

export const STONES: Record<string, Stone> = {
  amethyst: S({ size: 1.25, crust: '#7a6f66', crust2: '#4b433d', band: '#e4dfe8', band2: '#bdb0cc', bands: 3, sharp: 0.3, crystal: '#9a4dff', glow: 0.9, clarity: 0.75 }),
  celestite: S({ size: 1.2, crust: '#b9a68b', crust2: '#806f5c', band: '#ece9e4', band2: '#cfd8e2', bands: 3, sharp: 0.3, crystal: '#9cd2ff', glow: 0.6, clarity: 0.85 }),
  agate: S({ size: 1.1, crust: '#8d6a4d', crust2: '#553f2e', bump: 0.8, band: '#5a7fc4', band2: '#dfe5ee', bands: 7, sharp: 0.35, crystal: '#e6efff', glow: 0.5, clarity: 0.8 }),
  citrine: S({ size: 1.1, crust: '#5f4c3e', crust2: '#3a2e26', crystal: '#ffaa1c', glow: 0.55, clarity: 0.8, sparkle: 0.5 }),
  quartz: S({ size: 1, crust: '#dad5cc', crust2: '#a6a197', crystal: '#f3f6ff', glow: 0.25, clarity: 0.95, sparkle: 0.6 }),
  emerald: S({ size: 1.1, crust: '#55705c', crust2: '#26362b', grain: 8, crystal: '#13c96c', glow: 0.6, clarity: 0.75, sparkle: 0.5 }),
  rose: S({ size: 0.9, crystal: '#ff9cc4', glow: 0.2, clarity: 0.6, ior: 1.55 }),
  obsidian: S({ size: 0.9, crystal: '#0c0b12', glow: 0, clarity: 0.15, ior: 1.5, irid: 0.55 }),
  malachite: S({ size: 1, crust: '#1c7a49', crust2: '#0a3a22', bump: 1.4, grain: 7, band: '#22a564', band2: '#0c4428', bands: 12, sharp: 0.45, crystal: '#2bd68a', glow: 0.1 }),
  pyrite: S({ size: 0.8, crystal: '#d9b65a', glow: 0, sparkle: 0 }),
  brilliant: S({ size: 0.7, crystal: '#ffffff', glow: 0.1, clarity: 1, ior: 2.42 }),
};

// a dancer's suite: [heart (pelvis, belly, chest), limbs, accents (head, hands, feet)], chosen to sit together
export const SUITES: Record<string, [string, string, string]> = {
  Violet: ['amethyst', 'quartz', 'rose'],
  Sky: ['celestite', 'quartz', 'brilliant'],
  Ember: ['citrine', 'pyrite', 'obsidian'],
  Forest: ['malachite', 'emerald', 'quartz'],
  'Blue lace': ['agate', 'celestite', 'brilliant'],
  Midnight: ['amethyst', 'obsidian', 'pyrite'],
  Dawn: ['rose', 'citrine', 'brilliant'],
  Custom: ['agate', 'emerald', 'rose'],
};

/** the Minerals uniform: one Kind per specimen, in the order of specimens.json */
export function kindsOf(ids: string[]) {
  return ids.map((id) => {
    const s = STONES[id];
    return {
      crust: [...hex(s.crust), s.bump], crust2: [...hex(s.crust2), s.grain],
      band: [...hex(s.band), s.bands], band2: [...hex(s.band2), s.sharp],
      crystal: [...hex(s.crystal), s.glow], extra: [s.clarity, s.sparkle, s.ior, s.irid],
    };
  });
}
