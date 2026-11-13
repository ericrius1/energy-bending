// Loadout presets: what a dancer can wear, by name, for captures, the panel and the game's menus. One list, one way
// to put them on: `?dress=fire,water` (dancer 0 in fire, dancer 1 in water; the last name serves the rest),
// `bend.dress(d, name)`, or `dressed(name, suite)` from code. The show keeps a dress on its dancer when the programme
// restages a dance (dancer/show.ts), so a capture's dancers stay dressed. (The field's `?aura=` is a different thing:
// it pretends a dancer wears a kind for the field only, without changing its matter.)
//
// Names: fire, water, ice, plasma; the gem bodies: gems (Gem Dancers' small stones in the dancer's suite of three),
// mosaic (small stones of many minerals), single (small stones of one mineral), monolith (large crystals of one
// mineral: prisms along the limbs, a geode torso, a cut stone for a head; they crack into small stones and re-form),
// and single-<mineral> / monolith-<mineral> for each mineral a player can choose (amethyst, citrine, emerald,
// obsidian, opal, quartz, rose, iron). The mixed bodies, a heart of one matter in a body of another: ember (a gem
// heart and head inside fire limbs), gemwater (inside water), gemice (inside ice), geodeheart (the great geode torso
// inside fire limbs) and geodeheart-water, tide (water with ice hands and feet), and all (a geode heart and a gem head,
// fire arms, water legs, ice hands and feet). A `+` or a space in a URL is not needed: every name is one word.
import type { BodyPart, Loadout } from './kind';

const CORE: BodyPart[] = ['torso', 'head'];
const LIMBS: BodyPart[] = ['arms', 'hands', 'legs', 'feet'];
/** the minerals a player can choose a one-mineral body in (matter/gems/minerals.ts MINERALS) */
const MINERALS = ['amethyst', 'citrine', 'emerald', 'obsidian', 'opal', 'quartz', 'rose', 'iron'];

// a gem layer: gems' params are suite (a suite's name or a mineral's), one (every stone the suite's first mineral),
// crystals (1: large crystals on every part it covers; 'torso': the geode and the hips only), heart (how strongly its
// torso glows through the matter round it; matter/gems/hearts.ts), size (× its stones' size)
const gem = (share: number, params: Record<string, unknown>, parts?: BodyPart[]) => ({ kind: 'gems', share, ...(parts ? { parts } : {}), params });

/** a preset by name: `suite` is the gem suite the dancer would otherwise wear (gem layers keep it) */
export const PRESETS: Record<string, (suite: string) => Loadout> = {
  gems: (suite) => ({ layers: [gem(1, { suite })] }),
  fire: () => ({ layers: [{ kind: 'fire', share: 1 }] }),
  water: () => ({ layers: [{ kind: 'water', share: 1 }] }),
  ice: () => ({ layers: [{ kind: 'ice', share: 1 }] }),
  plasma: () => ({ layers: [{ kind: 'plasma', share: 1 }] }),
  // the gem bodies
  mosaic: () => ({ layers: [gem(1, { suite: 'Mosaic' })] }),
  single: (suite) => ({ layers: [gem(1, { suite, one: true })] }),
  monolith: (suite) => ({ layers: [gem(1, { suite, one: true, crystals: 1 })] }),
  ...Object.fromEntries(MINERALS.flatMap((m) => [
    [`single-${m}`, () => ({ layers: [gem(1, { suite: m, one: true })] })],
    [`monolith-${m}`, () => ({ layers: [gem(1, { suite: m, one: true, crystals: 1 })] })],
  ])),
  // a gem heart and head (the Ember suite) inside a body of flame
  ember: () => ({ layers: [gem(0.35, { suite: 'Ember', heart: 1.2 }, CORE), { kind: 'fire', share: 0.65, parts: LIMBS }] }),
  // a gem heart (torso and head) inside a body of water, and inside ice
  gemwater: (suite) => ({ layers: [gem(0.3, { suite, heart: 1 }, CORE), { kind: 'water', share: 0.7 }] }),
  gemice: (suite) => ({ layers: [gem(0.3, { suite, heart: 1 }, CORE), { kind: 'ice', share: 0.7, parts: LIMBS }] }),
  // water, with ice on the hands and feet
  tide: () => ({ layers: [{ kind: 'water', share: 0.75, parts: ['torso', 'head', 'arms', 'legs'] }, { kind: 'ice', share: 0.25, parts: ['hands', 'feet'] }] }),
  // the great amethyst geode over the torso (a large crystal, its hollow lined with points and lit by the heart),
  // inside limbs of flame (or of water)
  geodeheart: () => ({ layers: [gem(0.16, { suite: 'Geode', crystals: 'torso', heart: 1.2 }, ['torso']), { kind: 'fire', share: 0.84, parts: ['head', ...LIMBS] }] }),
  'geodeheart-water': () => ({ layers: [gem(0.16, { suite: 'Geode', crystals: 'torso', heart: 1.2 }, ['torso']), { kind: 'water', share: 0.84, parts: ['head', ...LIMBS] }] }),
  // all of them together: a geode heart and a cut-stone head, fire arms, water legs, ice hands and feet
  all: () => ({ layers: [
    gem(0.22, { suite: 'Violet', crystals: 1, heart: 1.2 }, CORE),
    { kind: 'fire', share: 0.3, parts: ['arms'] },
    { kind: 'water', share: 0.33, parts: ['legs'] },
    { kind: 'ice', share: 0.15, parts: ['hands', 'feet'] },
  ] }),
};

/** a preset by name (null for an unknown name) */
export function dressed(name: string, suite = 'Violet'): Loadout | null {
  const make = PRESETS[name.trim()];
  return make ? make(suite) : null;
}

/** `?dress=a,b`: one preset name per dancer slot (empty: none) */
export function dressFromQuery(search = typeof location !== 'undefined' ? location.search : ''): string[] {
  const q = new URLSearchParams(search).get('dress');
  return q ? q.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
