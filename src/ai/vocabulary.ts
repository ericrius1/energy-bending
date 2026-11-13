// The jogo's vocabulary, as the partner plays it: which level each move is danced at (standing, low, inverted), which
// leg a kick comes off (so it can grow out of the ginga's own back step on the beat), the named exchanges two players
// fall into (an attack, the answer that goes under or around it, and the counter that comes up out of that answer in
// the same motion), the feints (a wind-up that turns into something else) and the low and inverted moves the move
// library may or may not have yet.
//
// Moves named here that the library lacks (queda de rins, cocorinha, meia-lua de compasso, negativa: requested from
// src/dancer in docs/reports/7-partner.md) are used only when `has(name)` says they are registered, so the brain plays
// the same with or without them and picks them up the day they land.
import { MOVES } from '../dancer/moves';

export type Level = 'standing' | 'low' | 'inverted';

/** the moves that may be missing from the library (src/dancer), by the names requested for them */
export const OPTIONAL = { queda: 'queda-de-rins', cocorinha: 'cocorinha', compasso: 'compasso', negativa: 'negativa' } as const;

/** is a move registered (the library's own, a clip flourish, or one of the requested ones once it lands)? */
export const has = (name: string) => !!MOVES[name];

/** the level a move is danced at */
export function levelOf(name: string): Level {
  switch (name) {
    case 'au': case 'macaco': case 'queda-de-rins': case 'quebra': return 'inverted';
    case 'esquiva': case 'rasteira': case 'role': case 'cocorinha': case 'negativa': case 'compasso': return 'low';
    default: return 'standing';
  }
}
export const inverted = (name: string) => levelOf(name) === 'inverted';

/** the beat of the bar (0 … 3) on which the ginga has a kick's leg stepped back (moves.ts gingaParams: the left foot
 *  is back on beat 0, the right on beat 2): the kick starts from that step, so it grows out of the ginga. The armada
 *  turns on the left leg; the others kick with the right. Hand moves and the throw come on either strong beat */
export function backStepOf(name: string): number[] {
  switch (name) {
    case 'armada': case 'compasso': return [0];
    case 'meia-lua': case 'martelo': case 'bencao': case 'rasteira': return [2];
    default: return [0, 2];
  }
}

/** the next beat line (≥ `from`) on which `name` grows out of the ginga's back step */
export function nextBackStep(name: string, from: number): number {
  const phases = backStepOf(name);
  let best = Infinity;
  for (const p of phases) {
    const b = Math.ceil((from - p) / 4 - 1e-9) * 4 + p;
    best = Math.min(best, b);
  }
  return best;
}

/** a named exchange: an attack, the answer that slips it, and the counter that comes up out of the answer */
export interface Exchange {
  name: string;
  /** the attack that opens it */
  attack: string;
  /** the answers that slip it, best first (the first registered one is preferred) */
  answer: string[];
  /** the counters out of the answer, best first; [] for none (a held block's push kick, a sweep from the esquiva …) */
  counter: string[];
  /** beats from the answer's start to the counter's (on the 8ths) */
  after: number;
}

/** the exchanges the pair can fall into, two bars or so each; the brains prefer them when an attack opens one */
export const EXCHANGES: readonly Exchange[] = [
  // the kick goes over, the answer goes under it and sweeps the leg it stands on
  { name: 'meia-lua, esquiva, rasteira', attack: 'meia-lua', answer: ['esquiva', 'negativa'], counter: ['rasteira', 'compasso'], after: 1.5 },
  // a spinning kick answered from the floor with a spinning kick of one's own, hands down
  { name: 'armada, cocorinha, compasso', attack: 'armada', answer: ['cocorinha', 'esquiva', 'macaco'], counter: ['compasso', 'meia-lua', 'armada'], after: 2 },
  // the snap of the martelo met by the guard, held, then a push kick to the belly
  { name: 'martelo, block, bênção', attack: 'martelo', answer: ['block'], counter: ['bencao'], after: 1.5 },
  // the push kick rolled away from and answered spinning
  { name: 'bênção, rolê, armada', attack: 'bencao', answer: ['role', 'negativa'], counter: ['armada', 'meia-lua'], after: 2 },
  // the sweep jumped over in a cartwheel, and a kick as the feet come down
  { name: 'rasteira, aú, meia-lua', attack: 'rasteira', answer: ['au', 'queda-de-rins'], counter: ['meia-lua', 'martelo'], after: 2 },
  // the hand slipped low and a sweep under it
  { name: 'strike, esquiva, rasteira', attack: 'strike', answer: ['esquiva', 'cocorinha'], counter: ['rasteira'], after: 1.5 },
];

/** the exchange an attack opens (the first one listed for it) */
export const exchangeFor = (attack: string) => EXCHANGES.find((x) => x.attack === attack) ?? null;

/** a counter that may come out of an answer, whatever the attack was: the one the body can cut into from the
 *  answer's recovery (the library's cancelInto), most fitting first */
export const COUNTERS: Record<string, string[]> = {
  esquiva: ['rasteira', 'compasso', 'martelo', 'meia-lua'],
  cocorinha: ['compasso', 'rasteira', 'meia-lua'],
  negativa: ['rasteira', 'compasso', 'armada'],
  role: ['armada', 'rasteira', 'meia-lua'],
  macaco: ['meia-lua', 'armada'],
  au: ['meia-lua', 'armada', 'martelo'],
  'queda-de-rins': ['compasso', 'meia-lua', 'armada'],
  block: ['bencao', 'meia-lua', 'martelo'],
};

/** the counters an answer can cut into (registered, and in the answer's cancelInto) */
export function countersOf(answer: string, prefer: readonly string[] = []): string[] {
  const def = MOVES[answer];
  if (!def) return [];
  const can = (n: string) => has(n) && (def.cancelInto.includes(n) || def.cancelInto.includes('*'));
  const out: string[] = [];
  for (const n of [...prefer, ...(COUNTERS[answer] ?? [])]) if (can(n) && !out.includes(n)) out.push(n);
  return out;
}

/** a feint: a move that reads as the start of one thing, cut into another from its recovery */
export interface Feint { fake: string; real: string; after: number; note: string }
export const FEINTS: readonly Feint[] = [
  { fake: 'esquiva', real: 'martelo', after: 1, note: 'drops as if for a sweep, comes up with a snap kick' },
  { fake: 'spin', real: 'armada', after: 1.5, note: 'turns as if dancing, the turn becomes the kick' },
  { fake: 'block', real: 'bencao', after: 1, note: 'the guard comes up, then the push kick' },
  { fake: 'esquiva', real: 'meia-lua', after: 1.5, note: 'low and back, then over the top' },
];

/** the fast attacks (a wind-up a person can hardly read): offered only after a telegraph */
export const fast = (name: string) => (MOVES[name]?.windup ?? 1) < 0.24;
/** the lead that telegraphs a fast attack: a guard raised or a dip, the attack cut in from its recovery a beat on */
export const TELEGRAPH: Record<string, { lead: string; after: number }> = {
  martelo: { lead: 'block', after: 1 },
  strike: { lead: 'esquiva', after: 1 },
};

/** the low and inverted answers and travels, by what the library has (the requested ones join when they land) */
export const lowAnswers = () => ['esquiva', 'role', OPTIONAL.negativa, OPTIONAL.cocorinha].filter(has);
export const invertedMoves = () => ['au', 'macaco', OPTIONAL.queda].filter(has);
