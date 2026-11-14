// The duel's powers, phase 2 "Bend" (docs/design/duel.md: no power hurts, pushes away or scatters anyone; every power
// makes movement or contact). The rules only, beside the dance battle's (shared/duel.ts):
//
//   flow     per dancer, 0 … 1, the fuel. Dancing well fills it: each link the rules count (shared/duel.ts LinkKind) adds
//            its worth, on the beat more, a kind not danced lately more again; a link the same as either of the last
//            two adds nothing, and standing about adds nothing (nothing ebbs either: flow is spent, not lost)
//   powers   two per matter (POWERS), each costing COST of the flow; a short cooldown per power, a shorter gap between
//            any two casts, and none while joined (a hold's hands are busy)
//   form     at full flow the form button is the power form: FORM_MS of powers free and bigger; the bar drains as it
//            runs and is empty at its end
//   react    two powers that meet (REACTIONS): fire's ribbon or flare in water's wave is a steam geyser; fire on an ice
//            step melts it to a slick puddle; water's whip on an ice step freezes the rope into a bar to swing round
//
// Pure: no clock of its own, no physics (src/duel/powers.ts moves the bodies and makes the effects). Times in ms.
import type { DuelEvent, LinkKind } from './duel.ts';

export type Matter = 'fire' | 'water' | 'ice' | 'plasma' | 'gems';
export type PowerId = 'flare' | 'ribbon' | 'whip' | 'wave' | 'step' | 'slide' | 'blink' | 'arc' | 'pillar' | 'prism';
export type ReactionKind = 'geyser' | 'melt' | 'freeze';

/** each matter's two powers and its power form's name (duel.md's table) */
export const POWERS: Record<Matter, { powers: [PowerId, PowerId]; form: string }> = {
  fire: { powers: ['flare', 'ribbon'], form: 'plasma' },
  water: { powers: ['whip', 'wave'], form: 'ice' },
  ice: { powers: ['step', 'slide'], form: 'glacier' },
  plasma: { powers: ['blink', 'arc'], form: 'storm' },
  gems: { powers: ['pillar', 'prism'], form: 'heart of stone' },
};
export const POWER_NAME: Record<PowerId, string> = {
  flare: 'Flare', ribbon: 'Ribbon', whip: 'Whip', wave: 'Wave', step: 'Step', slide: 'Slide', blink: 'Blink', arc: 'Arc', pillar: 'Pillar', prism: 'Prism',
};
/** what each power does, in a line (the HUD's help, the docs) */
export const POWER_DOES: Record<PowerId, string> = {
  flare: 'a bloom under the feet: a rocket jump along the stick that lifts a partner close by too',
  ribbon: 'a dash that leaves a ribbon of warm light rising as an updraft for about 2 s',
  whip: 'a lash about 6 m along the stick: reaching the other it is a catch at range, reeled in',
  wave: 'a roll along the ground that carries whoever stands in it; jump on its crest to go higher',
  step: 'a block of ice in the air ahead or under, 4 s: a ledge for either, kicked off like a wall',
  slide: 'an ice path along the ground, slick and fast',
  blink: 'a short jump through space; through the other it swaps the two',
  arc: 'a lightning tether that pulls the two to meet mid-air, into a catch',
  pillar: 'a crystal column rising under a point, launching whoever stands on it',
  prism: 'a facet in the air: a body flying into it is turned toward the other',
};

export const POWER = {
  /** a cast's share of the flow; the form takes a full bar */
  COST: 0.25,
  /** the power form: how long (ms) */
  FORM_MS: 6000,
  /** after a cast: that power again in COOL_MS, any power in GAP_MS */
  COOL_MS: 900,
  GAP_MS: 300,
  /** what each link adds to the flow, before the beat and freshness */
  FLOW: {
    catch: 0.04, aerial: 0.06, swing: 0.012, fling: 0.035, flown: 0.02, lift: 0.04, vault: 0.04, counter: 0.03,
    walljump: 0.035, wallrun: 0.025, dash: 0.01, flip: 0.035, kick: 0.02, au: 0.035, jump: 0,
  } as Record<string, number>,
  /** on the beat ×PERFECT; a kind not among the last FRESH_N links ×FRESH; the same as either of the last two: nothing */
  PERFECT: 1.6,
  FRESH: 1.3,
  FRESH_N: 4,
};

export interface PowerSeat {
  matter: Matter;
  flow: number;
  /** the power form's end (ms; -1 when not in it) and when it began */
  formUntil: number;
  formFrom: number;
  /** each power's next ready time (ms) and the next any-power time */
  cool: [number, number];
  gap: number;
  /** the last few links (freshness and repeats) */
  recent: string[];
  /** counts this duel (the stats) */
  casts: [number, number];
  forms: number;
  /** flow gained this duel */
  gained: number;
}
export interface PowersState { seats: [PowerSeat, PowerSeat]; reactions: Record<ReactionKind, number> }

export type PowerEvent =
  | { k: 'cast'; seat: number; slot: 0 | 1; power: PowerId; free: boolean; big: boolean }
  | { k: 'form'; seat: number; on: boolean }
  | { k: 'react'; kind: ReactionKind; seats: number[] };

/** a body's matter from a dress or a kind name (steam and anything unknown dance as water and gems) */
export function matterOf(kind: string | null | undefined): Matter {
  switch (kind) {
    case 'fire': case 'water': case 'ice': case 'plasma': case 'gems': return kind;
    case 'steam': return 'water';
    default: return 'gems';
  }
}

const seat0 = (matter: Matter): PowerSeat => ({ matter, flow: 0, formUntil: -1, formFrom: -1, cool: [0, 0], gap: 0, recent: [], casts: [0, 0], forms: 0, gained: 0 });
export function newPowers(m0: Matter, m1: Matter): PowersState {
  return { seats: [seat0(m0), seat0(m1)], reactions: { geyser: 0, melt: 0, freeze: 0 } };
}
/** a new set: the flow empty, the form over, the cooldowns cleared (the counts kept) */
export function resetPowers(ps: PowersState) {
  for (const S of ps.seats) { S.flow = 0; S.formUntil = -1; S.formFrom = -1; S.cool = [0, 0]; S.gap = 0; S.recent = []; }
}
export const powerOf = (ps: PowersState, seat: number, slot: 0 | 1): PowerId => POWERS[ps.seats[seat].matter].powers[slot];
export const inForm = (ps: PowersState, seat: number, now: number) => ps.seats[seat].formUntil > now;
/** the form's time left, 0 … 1 (0 when not in it) */
export const formLeft = (ps: PowersState, seat: number, now: number) => {
  const S = ps.seats[seat];
  return S.formUntil > now ? Math.min(1, (S.formUntil - now) / POWER.FORM_MS) : 0;
};

/** a link danced: its flow (returned). Nothing in the power form (the bar is running down), nothing for a repeat */
export function powersLink(ps: PowersState, seat: number, kind: LinkKind | string, perfect: boolean, now: number): number {
  const S = ps.seats[seat];
  const r = S.recent, repeat = r.length > 0 && (r[r.length - 1] === kind || r[r.length - 2] === kind);
  const fresh = !r.slice(-POWER.FRESH_N).includes(kind);
  r.push(kind);
  if (r.length > 8) r.shift();
  if (S.formUntil > now || repeat) return 0;
  const gain = (POWER.FLOW[kind] ?? 0.02) * (perfect ? POWER.PERFECT : 1) * (fresh ? POWER.FRESH : 1);
  const was = S.flow;
  S.flow = Math.min(1, S.flow + gain);
  S.gained += S.flow - was;
  return S.flow - was;
}

/** why a power can't be cast now, or null if it can (`joined`: the seat holds or is held) */
export function cantCast(ps: PowersState, seat: number, slot: 0 | 1, now: number, joined = false): string | null {
  const S = ps.seats[seat];
  if (joined) return 'joined';
  if (now < S.gap || now < S.cool[slot]) return 'cooling';
  if (S.formUntil <= now && S.flow < POWER.COST - 1e-9) return 'flow';
  return null;
}
/** cast a seat's power (slot 0 or 1): its event, or null when it can't. In the form it is free and bigger */
export function powersCast(ps: PowersState, seat: number, slot: 0 | 1, now: number, joined = false): Extract<PowerEvent, { k: 'cast' }> | null {
  if (cantCast(ps, seat, slot, now, joined)) return null;
  const S = ps.seats[seat], free = S.formUntil > now;
  if (!free) S.flow = Math.max(0, S.flow - POWER.COST);
  S.cool[slot] = now + POWER.COOL_MS * (free ? 0.6 : 1);
  S.gap = now + POWER.GAP_MS;
  S.casts[slot]++;
  return { k: 'cast', seat, slot, power: powerOf(ps, seat, slot), free, big: free };
}
/** a cast that found nothing to act on (an arc with nobody in range) gives its flow back */
export function powersRefund(ps: PowersState, seat: number, slot: 0 | 1, free: boolean) {
  const S = ps.seats[seat];
  if (!free) S.flow = Math.min(1, S.flow + POWER.COST);
  S.cool[slot] = 0; S.casts[slot] = Math.max(0, S.casts[slot] - 1);
}
/** the form button: at full flow, the power form begins */
export function powersForm(ps: PowersState, seat: number, now: number): PowerEvent | null {
  const S = ps.seats[seat];
  if (S.formUntil > now || S.flow < 1 - 1e-6) return null;
  S.formFrom = now; S.formUntil = now + POWER.FORM_MS; S.forms++;
  return { k: 'form', seat, on: true };
}

/** one frame: the rules' events (links fill the flow; a new set empties it) and the form running down */
export function powersStep(ps: PowersState, now: number, events: readonly DuelEvent[] = []): PowerEvent[] {
  const out: PowerEvent[] = [];
  for (const e of events) {
    if (e.k === 'link') powersLink(ps, e.seat, e.kind, e.perfect, now);
    else if (e.k === 'set') { for (let k = 0; k < 2; k++) if (ps.seats[k].formUntil > now) out.push({ k: 'form', seat: k, on: false }); resetPowers(ps); }
  }
  for (let k = 0; k < 2; k++) {
    const S = ps.seats[k];
    if (S.formUntil < 0) continue;
    if (now >= S.formUntil) { S.formUntil = -1; S.flow = 0; out.push({ k: 'form', seat: k, on: false }); }
    else S.flow = (S.formUntil - now) / POWER.FORM_MS;
  }
  return out;
}

/** what two powers make when they meet (either order), or null */
export function reactionOf(a: PowerId, b: PowerId): ReactionKind | null {
  const has = (x: PowerId, y: PowerId) => (a === x && b === y) || (a === y && b === x);
  if (has('ribbon', 'wave') || has('flare', 'wave')) return 'geyser';
  if (has('flare', 'step') || has('ribbon', 'step')) return 'melt';
  if (has('whip', 'step')) return 'freeze';
  return null;
}
/** a reaction made: counted (each pops once, where it happens) */
export function powersReact(ps: PowersState, kind: ReactionKind, seats: number[]): PowerEvent {
  ps.reactions[kind]++;
  return { k: 'react', kind, seats };
}

/** what the HUD shows of a seat's powers */
export function powersHud(ps: PowersState, seat: number, now: number, joined = false) {
  const S = ps.seats[seat], free = S.formUntil > now;
  return {
    flow: S.flow, form: formLeft(ps, seat, now),
    powers: POWERS[S.matter].powers.map((id, slot) => ({ id, name: POWER_NAME[id], ready: !cantCast(ps, seat, slot as 0 | 1, now, joined), cost: free ? 0 : POWER.COST })),
  };
}
