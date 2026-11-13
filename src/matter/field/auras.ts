// What each matter kind does to the air around a body wearing it: its aura. The field (field.ts) lays every dancer's
// capsules into its grid each frame, and a capsule warms, chills or wets the air by the auras of the layers worn on
// that part of the body, weighted by each layer's share of that part. So a kind never writes its own heat or wet:
// a fire arm is hot because it is fire, and a kick drags the air because it moves.
//
// A dancer's power form (Dancer.form, copied into field.forms[d], 0 … 1, or a layer's own `params.form`) moves a kind toward its other form:
// fire toward plasma, water toward ice. A new kind adds its line here, or calls setAura from its own index.ts.

/** a kind's aura: the heat it gives the air at the body (1 flame, -1 ice), the wet (1 water), how much it dries the
 *  air (0 … 1: plasma boils wet away), and how much it drags the air as it moves (1 for every body) */
export interface Aura { heat: number; wet: number; dry?: number; stir?: number }

const AURAS = new Map<string, Aura>([
  ['gems', { heat: 0, wet: 0 }],
  ['fire', { heat: 1, wet: 0 }],
  ['plasma', { heat: 1.6, wet: 0, dry: 0.6 }],
  ['water', { heat: 0, wet: 1 }],
  ['ice', { heat: -1, wet: 0.3 }],
]);

/** a kind's other form, reached as its dancer's form value goes to 1 */
const FORMS = new Map<string, string>([
  ['fire', 'plasma'],
  ['water', 'ice'],
]);

const CALM: Required<Aura> = { heat: 0, wet: 0, dry: 0, stir: 1 };

/** add or change a kind's aura (and, optionally, the kind its power form turns it into) */
export function setAura(kind: string, aura: Aura, form?: string) {
  AURAS.set(kind, aura);
  if (form) FORMS.set(kind, form);
}

/** the aura of a kind at a form value (0 … 1); a kind with no aura is calm (it still drags the air) */
export function auraOf(kind: string, form = 0): Required<Aura> {
  const a = AURAS.get(kind);
  if (!a) return CALM;
  const to = FORMS.get(kind), b = to ? AURAS.get(to) : undefined;
  const k = b ? Math.min(1, Math.max(0, form)) : 0;
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    heat: mix(a.heat, b?.heat ?? a.heat),
    wet: mix(a.wet, b?.wet ?? a.wet),
    dry: mix(a.dry ?? 0, b?.dry ?? a.dry ?? 0),
    stir: mix(a.stir ?? 1, b?.stir ?? a.stir ?? 1),
  };
}

/** the kinds with an aura (for the panel and the docs) */
export const auraKinds = () => [...AURAS.keys()];
