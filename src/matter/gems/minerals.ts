// How each mineral looks, and the suites a dancer wears. Colours are sRGB hex as picked; `hex()` linearises them on
// the way to the GPU. The specimens' shapes are public/specimens/ (made in Blender by scripts/specimens.py), in the
// order of the Minerals uniform; a mineral with `mesh` borrows another specimen's shape (specimens.ts copies it at
// load, so no Blender is needed for a new mineral). Each mineral has a personality for players choosing a body: its
// colour and glow, how clear it is, how much it bends light (ior) and splits it (disp), and one trait of its own
// (obsidian's fire-coloured fractures, opal's play of colour, iron's rust). How it rings is the sound side's
// (audio/score.ts reads the mineral's id).
import { hex } from '../../engine/params';

export interface Stone {
  size: number;
  crust: string; crust2: string; bump: number; grain: number;   // rough outside: two mottled colours, bumpiness, noise scale
  band: string; band2: string; bands: number; sharp: number;    // polished cut face: two band colours, rings, sharpness
  crystal: string; glow: number;                               // crystal / polished body colour and its glow
  clarity: number; sparkle: number; ior: number; irid: number;
  /** traits: fire-coloured fractures (obsidian), play of colour (opal), rust (iron); and dispersion (× the look's) */
  fracture: number; opal: number; rust: number; disp: number;
  /** a specimen whose shape this one borrows (a mineral with no Blender model of its own) */
  mesh?: string;
  /** the name a player sees */
  title?: string;
}

const S = (o: Partial<Stone>): Stone => ({
  size: 1, crust: '#6e655d', crust2: '#463f39', bump: 0.6, grain: 5, band: '#e9e5ee', band2: '#b8aec8', bands: 9, sharp: 0.5,
  crystal: '#ffffff', glow: 0.3, clarity: 0.7, sparkle: 0.3, ior: 1.55, irid: 0, fracture: 0, opal: 0, rust: 0, disp: 1, ...o,
});

export const STONES: Record<string, Stone> = {
  // a deep violet that glows from inside its geode; quiet fire
  amethyst: S({ title: 'Amethyst', size: 1.25, crust: '#7a6f66', crust2: '#4b433d', band: '#e4dfe8', band2: '#bdb0cc', bands: 3, sharp: 0.3, crystal: '#8f3dff', glow: 1.1, clarity: 0.78, ior: 1.54, disp: 1 }),
  celestite: S({ title: 'Celestite', size: 1.2, crust: '#b9a68b', crust2: '#806f5c', band: '#ece9e4', band2: '#cfd8e2', bands: 3, sharp: 0.3, crystal: '#9cd2ff', glow: 0.6, clarity: 0.85 }),
  agate: S({ title: 'Agate', size: 1.1, crust: '#8d6a4d', crust2: '#553f2e', bump: 0.8, band: '#5a7fc4', band2: '#dfe5ee', bands: 7, sharp: 0.35, crystal: '#e6efff', glow: 0.5, clarity: 0.8 }),
  // honey gold, warm light inside, more fire than amethyst
  citrine: S({ title: 'Citrine', size: 1.1, crust: '#5f4c3e', crust2: '#3a2e26', crystal: '#ffa514', glow: 0.85, clarity: 0.82, sparkle: 0.5, ior: 1.55, disp: 1.3 }),
  // clear quartz: water-clear, little colour of its own, the most fire of the quartzes
  quartz: S({ title: 'Clear quartz', size: 1, crust: '#dad5cc', crust2: '#a6a197', crystal: '#f3f6ff', glow: 0.25, clarity: 0.97, sparkle: 0.6, ior: 1.54, disp: 1.7 }),
  // deep green, a little cloudy (the jardin), dense
  emerald: S({ title: 'Emerald', size: 1.1, crust: '#55705c', crust2: '#26362b', grain: 8, crystal: '#0fc265', glow: 0.75, clarity: 0.72, sparkle: 0.5, ior: 1.58, disp: 0.8 }),
  // milky pink, soft light through it, no sharp fire
  rose: S({ title: 'Rose quartz', size: 0.9, crystal: '#ff96c0', glow: 0.4, clarity: 0.55, ior: 1.54, disp: 0.5 }),
  // black volcanic glass, an oily sheen, and cracks that glow like embers
  obsidian: S({ title: 'Obsidian', size: 0.9, crystal: '#0c0b12', glow: 0, clarity: 0.15, ior: 1.5, irid: 0.55, fracture: 1 }),
  malachite: S({ title: 'Malachite', size: 1, crust: '#1c7a49', crust2: '#0a3a22', bump: 1.4, grain: 7, band: '#22a564', band2: '#0c4428', bands: 12, sharp: 0.45, crystal: '#2bd68a', glow: 0.1 }),
  pyrite: S({ title: 'Pyrite', size: 0.8, crystal: '#d9b65a', glow: 0, sparkle: 0 }),
  brilliant: S({ title: 'Diamond', size: 0.7, crystal: '#ffffff', glow: 0.1, clarity: 1, ior: 2.42, disp: 1.4 }),
  // milky blue-white with patches of spectral colour that move as it turns (rose quartz's shape)
  opal: S({ title: 'Opal', mesh: 'rose', size: 0.95, crystal: '#dde7f0', glow: 0.35, clarity: 0.5, ior: 1.45, opal: 1, disp: 0.6 }),
  // dark iron: gunmetal, patches of rust, and orange glints in the rust (pyrite's cubes)
  iron: S({ title: 'Iron', mesh: 'pyrite', size: 0.85, crystal: '#5b5b63', glow: 0, sparkle: 0, rust: 1 }),
};

/** the minerals a player chooses a body from (each also names a one-mineral suite) */
export const MINERALS = ['amethyst', 'citrine', 'emerald', 'obsidian', 'opal', 'quartz', 'rose', 'iron'] as const;

// a dancer's suite: [heart (pelvis, belly, chest), limbs, accents (head, hands, feet)], chosen to sit together. A suite
// of more than three is a mosaic: each stone picks any of them (the first three still lead their roles).
export const SUITES: Record<string, string[]> = {
  Violet: ['amethyst', 'quartz', 'rose'],
  Sky: ['celestite', 'quartz', 'brilliant'],
  Ember: ['citrine', 'pyrite', 'obsidian'],
  Forest: ['malachite', 'emerald', 'quartz'],
  'Blue lace': ['agate', 'celestite', 'brilliant'],
  Midnight: ['amethyst', 'obsidian', 'pyrite'],
  Dawn: ['rose', 'citrine', 'brilliant'],
  Custom: ['agate', 'emerald', 'rose'],
  // one specimen kind only: a geode heart (presets.ts geodeheart)
  Geode: ['amethyst', 'amethyst', 'amethyst'],
  // many minerals: Gem Dancers' look at its richest
  Mosaic: ['amethyst', 'quartz', 'rose', 'citrine', 'emerald', 'opal', 'celestite', 'obsidian', 'agate'],
  // one mineral each, by name (a player's single-mineral body)
  ...Object.fromEntries(Object.keys(STONES).map((id) => [id, [id, id, id]])),
};

/** the Minerals uniform: one Kind per specimen, in the order of the specimens (specimens.ts) */
export function kindsOf(ids: string[]) {
  return ids.map((id) => {
    const s = STONES[id] ?? S({});
    return {
      crust: [...hex(s.crust), s.bump], crust2: [...hex(s.crust2), s.grain],
      band: [...hex(s.band), s.bands], band2: [...hex(s.band2), s.sharp],
      crystal: [...hex(s.crystal), s.glow], extra: [s.clarity, s.sparkle, s.ior, s.irid],
      fx: [s.fracture, s.opal, s.rust, s.disp],
    };
  });
}

/** a mineral's glow colour (linear, brightest channel 1): what its heart shines */
export function glowOf(id: string): [number, number, number] {
  const c = hex((STONES[id] ?? S({})).crystal);
  const m = Math.max(c[0], c[1], c[2], 1e-3);
  return [c[0] / m, c[1] / m, c[2] / m];
}
