// Dressing dancers in water and ice by name, for captures and for trying looks (waterParams.dress, or ?dress= in the
// URL): 'water,ice' dresses dancer 0 in water and dancer 1 in ice. The programme dresses dancers in gems each time it
// stages a dance; while a dress is set this puts it back, through the page's automation hooks (window.bend.loadout,
// engine/hooks.ts), the same way a capture or an agent would. The game itself dresses dancers through their loadouts.
import type { FrameCtx } from '../../engine/frame';
import type { Loadout, BodyPart } from '../core/kind';

const LIMBS: BodyPart[] = ['arms', 'hands', 'legs', 'feet'];
const CORE: BodyPart[] = ['torso', 'head'];

/** the loadouts by name; `suite` is the gem suite the dancer wore (gems keep it) */
export const DRESSES: Record<string, (suite: string) => Loadout> = {
  water: () => ({ layers: [{ kind: 'water', share: 1 }] }),
  ice: () => ({ layers: [{ kind: 'ice', share: 1 }] }),
  // a gem heart inside a body of water
  'gems+water': (suite) => ({ layers: [{ kind: 'gems', share: 0.3, parts: CORE, params: { suite } }, { kind: 'water', share: 0.7 }] }),
  // ice limbs on a water torso
  'ice+water': () => ({ layers: [{ kind: 'water', share: 0.45, parts: CORE }, { kind: 'ice', share: 0.55, parts: LIMBS }] }),
  // water limbs on an ice torso
  'water+ice': () => ({ layers: [{ kind: 'ice', share: 0.45, parts: CORE }, { kind: 'water', share: 0.55, parts: LIMBS }] }),
  gems: (suite) => ({ layers: [{ kind: 'gems', share: 1, params: { suite } }] }),
};

interface Hooks { loadout(d: number, l: Loadout): unknown }

/** put each named dress on its dancer if the programme took it off */
export function dressFor(f: FrameCtx, dress: string) {
  if (!dress) return;
  const hooks = (globalThis as { bend?: Hooks }).bend;
  if (!hooks) return;
  const names = dress.split(',').map((s) => s.trim());
  f.dancers.forEach((d, k) => {
    const name = names[Math.min(k, names.length - 1)];
    const make = DRESSES[name];
    if (!make) return;
    const gem = d.loadout.layers.find((l) => l.kind === 'gems');
    const want = make(String(gem?.params?.suite ?? 'Violet'));
    if (JSON.stringify(want) !== JSON.stringify(d.loadout)) hooks.loadout(k, want);
  });
}
