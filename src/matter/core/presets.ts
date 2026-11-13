// Loadout presets: what a dancer can wear, by name, for captures, the panel and the game's menus. One list, one way
// to put them on: `?dress=fire,water` (dancer 0 in fire, dancer 1 in water; the last name serves the rest),
// `bend.dress(d, name)`, or `dressed(name, suite)` from code. The show keeps a dress on its dancer when the programme
// restages a dance (dancer/show.ts), so a capture's dancers stay dressed. (The field's `?aura=` is a different thing:
// it pretends a dancer wears a kind for the field only, without changing its matter.)
//
// Names: gems, fire, water, ice, plasma; ember (a gem heart and head inside fire limbs); tide (water with ice hands and
// feet); gemwater (a gem heart inside water); geodeheart (one large amethyst geode heart on the torso inside fire limbs) and geodeheart-water (the same in
// water). A `+` or a space in a URL is not needed: every name is one word.
import type { BodyPart, Loadout } from './kind';

const CORE: BodyPart[] = ['torso', 'head'];
const LIMBS: BodyPart[] = ['arms', 'hands', 'legs', 'feet'];

/** a preset by name: `suite` is the gem suite the dancer would otherwise wear (gem layers keep it) */
export const PRESETS: Record<string, (suite: string) => Loadout> = {
  gems: (suite) => ({ layers: [{ kind: 'gems', share: 1, params: { suite } }] }),
  fire: () => ({ layers: [{ kind: 'fire', share: 1 }] }),
  water: () => ({ layers: [{ kind: 'water', share: 1 }] }),
  ice: () => ({ layers: [{ kind: 'ice', share: 1 }] }),
  plasma: () => ({ layers: [{ kind: 'plasma', share: 1 }] }),
  // a gem heart and head (the Ember suite) inside a body of flame
  ember: () => ({ layers: [{ kind: 'gems', share: 0.35, parts: CORE, params: { suite: 'Ember' } }, { kind: 'fire', share: 0.65, parts: LIMBS }] }),
  // a gem heart (torso and head) inside a body of water
  gemwater: (suite) => ({ layers: [{ kind: 'gems', share: 0.3, parts: CORE, params: { suite } }, { kind: 'water', share: 0.7 }] }),
  // water, with ice on the hands and feet
  tide: () => ({ layers: [{ kind: 'water', share: 0.75, parts: ['torso', 'head', 'arms', 'legs'] }, { kind: 'ice', share: 0.25, parts: ['hands', 'feet'] }] }),
  // one specimen kind (the Geode suite: amethyst only), its stones grown large (gems' `size`), on the torso alone,
  // inside limbs of flame (or of water)
  geodeheart: () => ({ layers: [{ kind: 'gems', share: 0.12, parts: ['torso'], params: { suite: 'Geode', size: 2.4 } }, { kind: 'fire', share: 0.88, parts: ['head', ...LIMBS] }] }),
  'geodeheart-water': () => ({ layers: [{ kind: 'gems', share: 0.12, parts: ['torso'], params: { suite: 'Geode', size: 2.4 } }, { kind: 'water', share: 0.88, parts: ['head', ...LIMBS] }] }),
};

/** the loadout a preset name makes (null for an unknown name) */
export function dressed(name: string, suite = 'Violet'): Loadout | null {
  const make = PRESETS[name.trim()];
  return make ? make(suite) : null;
}

/** `?dress=a,b`: one preset name per dancer slot (empty: none) */
export function dressFromQuery(search = typeof location !== 'undefined' ? location.search : ''): string[] {
  const q = new URLSearchParams(search).get('dress');
  return q ? q.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
