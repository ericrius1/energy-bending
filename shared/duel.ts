// The duel's rules: a dance battle (docs/design/duel.md, the owner's second correction: nobody is knocked out or hurt).
// Two dancers in a world's play space run at each other, jump, catch each other, swing each other round, fling each
// other away, launch off each other and land on each other, and the two energies merge. It is competitive the way a
// dance battle is: style, combos, who leads.
//
//   combo   each dancer's chain of moves without long on the ground: every link (a catch, a swing, a fling, a lift, a
//           vault, a wall jump or run, a dash, a flip, a kick in the air, being flown) adds to it and to its
//           multiplier; a link on the beat (an 8th-note line within PERFECT_MS) counts double; a link the same as the
//           last two counts little (variety over repetition). The combo is banked into style when it ends (grounded a
//           while, idle a while; a fall drops it)
//   style   the battle's score, mostly for leading: starting a catch, catching the other out of the air, a fling the
//           flown one lands from; and the banked combos
//   energy  shared: it rises only when the two play together (joined, or both in a live combo at once), on the beat
//           more, and ebbs otherwise; its peak this set decides the finale; sustained high energy while joined charges
//           the merge (the fusion)
//   set     a set on the music (SET_MS, about a minute of the world's track): a count-in, play, a finale (the fusion
//           when the peak was high enough), the higher style wins it, and the next set counts in
//   fall    below the space's kill floor: a little style lost, the combo dropped, and the body reforms in a moment
//
// Pure, like rules.ts: no clock of its own, no I/O, no physics. The contact physics (src/duel/contact.ts) and the
// bodies tell it what happened (`duelLink` per link a dancer made, `duelContact` while joined) and `duelStep` runs the
// clock each frame; it returns events for the effects and the HUD. Times in ms, the beat on the music's clock.

export const DUEL = {
  /** the count-in: 3, 2, 1 (a beat each, never shorter than COUNT_MIN_MS), then BEND and play */
  COUNT_FROM: 3,
  COUNT_MIN_MS: 450,
  /** a set's play, and the finale after it (the fusion when the energy's peak reached MERGE_PEAK), then the result's
   *  moment before the next set */
  SET_MS: 60000,
  FINALE_MS: 2900, // (the two's duet on the last bar, src/duel/finale.ts: at most 2.6 s, then the banner)
  DONE_MS: 4000,
  /** on the beat: within this of an 8th-note line */
  PERFECT_MS: 60,
  PERFECT_GRID: 0.5,
  PERFECT_MUL: 2,
  /** a combo ends after this long on the ground (a moment's step between moves keeps it), or this long with no link */
  COMBO_GROUND_MS: 700,
  COMBO_IDLE_MS: 1800,
  /** each link adds this to the multiplier (1 + n × STEP, at most MULT_MAX); a link like the last two counts REPEAT */
  MULT_STEP: 0.25,
  MULT_MAX: 4,
  REPEAT: 0.35,
  /** what each link is worth before the multiplier */
  LINK: {
    catch: 6, aerial: 8, swing: 3, fling: 6, flown: 4, lift: 7, vault: 6, counter: 5,
    walljump: 3, wallrun: 2, dash: 1, flip: 2, kick: 2, au: 2, jump: 0.5,
  } as Record<string, number>,
  /** style for leading, straight away: starting a catch, catching the other out of the air, a fling the flown one
   *  lands well from (on its feet, a catch, a wall) */
  LEAD_CATCH: 5,
  LEAD_AERIAL: 6,
  LEAD_FLING_LANDED: 4,
  /** a fall costs this much style and the combo; the body is back in REFORM_MS */
  FALL_COST: 8,
  REFORM_MS: 900,
  /** the shared energy (0 … 1): what a link together adds, how fast contact fills it (per second joined), how fast it
   *  ebbs (per second), and the merge: charged while joined above MERGE_AT (per second), MERGE_PEAK the peak a finale
   *  fuses at */
  ENERGY_LINK: 0.01,
  ENERGY_CONTACT: 0.08,
  ENERGY_EBB: 0.07,
  MERGE_AT: 0.6,
  MERGE_RATE: 0.25,
  MERGE_PEAK: 0.7,
} as const;

export type LinkKind = 'catch' | 'aerial' | 'swing' | 'fling' | 'flown' | 'lift' | 'vault' | 'counter' | 'walljump' | 'wallrun' | 'dash' | 'flip' | 'kick' | 'au' | 'jump';

/** a combo: n links, its multiplier and score, the last few links and which of them were on the beat (aligned) */
export interface Combo { n: number; mult: number; score: number; links: LinkKind[]; beats: boolean[]; perfect: number; live: boolean; since: number; last: number }
export interface DuelSeat {
  style: number;
  combo: Combo;
  /** the longest combo this set (links), and every link counted (the stats) */
  best: number;
  links: number;
  /** the style earned by leading this set (catches, flings landed): the HUD's share of the lead */
  led: number;
  /** reforming after a fall since (ms), or -1 */
  fellAt: number;
  /** on the ground since (ms), or -1 in the air */
  groundSince: number;
}
export type SetPhase = 'intro' | 'play' | 'finale' | 'done';
export interface DuelState {
  phase: SetPhase;
  set: number;
  since: number;
  countMs: number;
  count: number;
  playFrom: number;
  winner: number | null;
  seats: [DuelSeat, DuelSeat];
  energy: number;
  peak: number;
  merge: number;
  /** joined now (the contact physics says), and since when */
  joined: boolean;
  joinedSince: number;
  /** whether the finale fused */
  fused: boolean;
  stats: { catches: number; aerials: number; swings: number; flings: number; lifts: number; vaults: number; counters: number; falls: number; perfect: number; links: number; merges: number; sets: number };
}

export type DuelEvent =
  | { k: 'count'; n: number }
  | { k: 'go'; set: number }
  | { k: 'link'; seat: number; kind: LinkKind; perfect: boolean; n: number; mult: number; value: number }
  | { k: 'lead'; seat: number; why: 'catch' | 'aerial' | 'fling'; style: number }
  | { k: 'combo'; seat: number; n: number; mult: number; banked: number; why: 'ground' | 'idle' | 'fall' | 'set' }
  | { k: 'merge'; energy: number }
  | { k: 'fall'; seat: number; style: number }
  | { k: 'ready'; seat: number }
  | { k: 'finale'; fused: boolean; peak: number }
  | { k: 'done'; winner: number; style: [number, number]; set: number }
  /** a set's count-in begins: both bodies (re)form at their spawns */
  | { k: 'set'; set: number };

const combo0 = (): Combo => ({ n: 0, mult: 1, score: 0, links: [], beats: [], perfect: 0, live: false, since: 0, last: -1e9 });
const seat0 = (): DuelSeat => ({ style: 0, combo: combo0(), best: 0, links: 0, led: 0, fellAt: -1, groundSince: 0 });
const countMs = (bpm: number) => Math.max(DUEL.COUNT_MIN_MS, 60000 / Math.max(40, bpm || 112));
const stats0 = () => ({ catches: 0, aerials: 0, swings: 0, flings: 0, lifts: 0, vaults: 0, counters: 0, falls: 0, perfect: 0, links: 0, merges: 0, sets: 0 });

/** a duel whose first step begins set 1 (a 'set' event places the bodies, then the count-in) */
export function newDuel(now: number, bpm = 112): DuelState {
  return {
    phase: 'done', set: 0, since: now - DUEL.DONE_MS, countMs: countMs(bpm), count: DUEL.COUNT_FROM, playFrom: now, winner: null,
    seats: [seat0(), seat0()], energy: 0, peak: 0, merge: 0, joined: false, joinedSince: 0, fused: false, stats: stats0(),
  };
}
/** from set 1 again (the next step's 'set' event places the bodies) */
export function restartDuel(d: DuelState, now: number, bpm = 112) { Object.assign(d, { ...newDuel(now, bpm), stats: d.stats }); }

/** a seat's controls are held: the count-in, or reforming after a fall */
export function frozen(d: DuelState, seat: number) { return d.phase === 'intro' || d.seats[seat].fellAt >= 0; }
/** play is on (links count) */
export const playing = (d: DuelState) => d.phase === 'play';

/** is a beat (music clock) on the 8th-note grid, within PERFECT_MS at this tempo? */
export function onBeat(beat: number | null, bpm: number) {
  if (beat == null || !Number.isFinite(beat)) return false;
  const g = DUEL.PERFECT_GRID, x = beat / g, off = (x - Math.round(x)) * g;
  return Math.abs((off * 60000) / Math.max(40, bpm)) <= DUEL.PERFECT_MS;
}

const bank = (d: DuelState, k: number, why: 'ground' | 'idle' | 'fall' | 'set', out: DuelEvent[]) => {
  const S = d.seats[k], C = S.combo;
  if (!C.live) return;
  const banked = why === 'fall' ? 0 : Math.round(C.score * C.mult);
  S.style += banked;
  out.push({ k: 'combo', seat: k, n: C.n, mult: C.mult, banked, why });
  S.combo = combo0();
};

/** a link a dancer made (the contact physics' catch, swing, fling, lift, vault, counter; the body's wall jump, wall run,
 *  dash, flip, kick in the air, aú; being flown). Returns its events (the link, and any leading style) */
export function duelLink(d: DuelState, seat: number, kind: LinkKind, perfect: boolean, now: number): DuelEvent[] {
  const out: DuelEvent[] = [];
  if (d.phase !== 'play' || d.seats[seat].fellAt >= 0) return out;
  const S = d.seats[seat], C = S.combo;
  if (!C.live) { C.live = true; C.since = now; }
  const repeat = C.links.length >= 2 && C.links[C.links.length - 1] === kind && C.links[C.links.length - 2] === kind;
  const value = (DUEL.LINK[kind] ?? 1) * (perfect ? DUEL.PERFECT_MUL : 1) * (repeat ? DUEL.REPEAT : 1);
  C.n++; C.score += value; C.last = now; C.mult = Math.min(DUEL.MULT_MAX, 1 + C.n * DUEL.MULT_STEP);
  if (perfect) { C.perfect++; d.stats.perfect++; }
  C.links.push(kind); C.beats.push(perfect);
  if (C.links.length > 8) { C.links.shift(); C.beats.shift(); }
  S.best = Math.max(S.best, C.n); S.links++; d.stats.links++;
  const st = d.stats as Record<string, number>;
  const key = ({ catch: 'catches', aerial: 'aerials', swing: 'swings', fling: 'flings', lift: 'lifts', vault: 'vaults', counter: 'counters' } as Record<string, string>)[kind];
  if (key) st[key]++;
  out.push({ k: 'link', seat, kind, perfect, n: C.n, mult: C.mult, value });
  // the shared energy: a link while joined, or while the other's combo is live too, is playing together
  const O = d.seats[1 - seat].combo;
  if (d.joined || O.live) d.energy = Math.min(1, d.energy + DUEL.ENERGY_LINK * (perfect ? 2 : 1) * (kind === 'catch' || kind === 'aerial' || kind === 'fling' || kind === 'lift' ? 2 : 1));
  // leading
  const lead = (why: 'catch' | 'aerial' | 'fling', v: number) => { S.style += v; S.led += v; out.push({ k: 'lead', seat, why, style: v }); };
  if (kind === 'catch') lead('catch', DUEL.LEAD_CATCH);
  else if (kind === 'aerial') lead('aerial', DUEL.LEAD_AERIAL);
  return out;
}
/** a fling one seat made has been landed well by the other (its feet, a wall, a catch): the flinger leads */
export function duelFlingLanded(d: DuelState, flinger: number): DuelEvent[] {
  if (d.phase !== 'play') return [];
  d.seats[flinger].style += DUEL.LEAD_FLING_LANDED; d.seats[flinger].led += DUEL.LEAD_FLING_LANDED;
  return [{ k: 'lead', seat: flinger, why: 'fling', style: DUEL.LEAD_FLING_LANDED }];
}
/** the contact physics: joined or not this frame */
export function duelContact(d: DuelState, joined: boolean, now: number) {
  if (joined && !d.joined) d.joinedSince = now;
  d.joined = joined;
}

/** the bodies this frame, as the rules read them */
export interface DuelBody { y: number; grounded: boolean }
export interface DuelArena { yKill: number; bpm: number; setMs?: number }

/** one frame: the set's clock, falls, combos ending, the shared energy and the merge */
export function duelStep(d: DuelState, now: number, dt: number, bodies: readonly [DuelBody, DuelBody], arena: DuelArena): DuelEvent[] {
  const out: DuelEvent[] = [];
  const setMs = arena.setMs ?? DUEL.SET_MS;
  // ---- the set's clock
  if (d.phase === 'done' && now - d.since >= DUEL.DONE_MS) {
    d.set += 1; d.phase = 'intro'; d.since = now; d.countMs = countMs(arena.bpm); d.count = DUEL.COUNT_FROM; d.winner = null;
    d.seats = [seat0(), seat0()]; d.energy = 0; d.peak = 0; d.merge = 0; d.fused = false;
    out.push({ k: 'set', set: d.set }, { k: 'count', n: d.count });
  }
  if (d.phase === 'intro') {
    const n = DUEL.COUNT_FROM - Math.floor((now - d.since) / d.countMs);
    if (n <= 0) { d.phase = 'play'; d.since = now; d.playFrom = now; d.count = 0; out.push({ k: 'go', set: d.set }); }
    else if (n !== d.count) { d.count = n; out.push({ k: 'count', n }); }
  }
  if (d.phase === 'play' && now - d.playFrom >= setMs) {
    for (let k = 0; k < 2; k++) bank(d, k, 'set', out);
    d.phase = 'finale'; d.since = now; d.fused = d.peak >= DUEL.MERGE_PEAK;
    out.push({ k: 'finale', fused: d.fused, peak: d.peak });
  }
  if (d.phase === 'finale' && now - d.since >= DUEL.FINALE_MS) {
    const s: [number, number] = [d.seats[0].style, d.seats[1].style];
    d.winner = s[0] === s[1] ? (d.seats[0].best >= d.seats[1].best ? 0 : 1) : s[0] > s[1] ? 0 : 1;
    d.phase = 'done'; d.since = now; d.stats.sets++;
    out.push({ k: 'done', winner: d.winner, style: s, set: d.set });
  }
  // ---- each body: falls and reforming, the ground (combos end), idle
  for (let k = 0; k < 2; k++) {
    const S = d.seats[k], b = bodies[k];
    if (S.fellAt >= 0) {
      if (now - S.fellAt >= DUEL.REFORM_MS) { S.fellAt = -1; out.push({ k: 'ready', seat: k }); }
      continue;
    }
    if (b.grounded) { if (S.groundSince < 0) S.groundSince = now; } else S.groundSince = -1;
    if (d.phase !== 'play') continue;
    if (b.y < arena.yKill) {
      bank(d, k, 'fall', out);
      const cost = Math.min(S.style, DUEL.FALL_COST);
      S.style -= cost; S.fellAt = now; d.stats.falls++;
      out.push({ k: 'fall', seat: k, style: cost });
      continue;
    }
    const C = S.combo;
    if (C.live && !d.joined && S.groundSince >= 0 && now - S.groundSince >= DUEL.COMBO_GROUND_MS) bank(d, k, 'ground', out);
    else if (C.live && now - C.last >= DUEL.COMBO_IDLE_MS) bank(d, k, 'idle', out);
  }
  // ---- the shared energy: contact fills it, it ebbs otherwise; the merge charges while joined and high
  if (d.phase === 'play') {
    const s = dt / 1000;
    if (d.joined) d.energy = Math.min(1, d.energy + DUEL.ENERGY_CONTACT * s);
    else d.energy = Math.max(0, d.energy - DUEL.ENERGY_EBB * s * (d.seats[0].combo.live && d.seats[1].combo.live ? 0.3 : 1));
    d.peak = Math.max(d.peak, d.energy);
    if (d.joined && d.energy >= DUEL.MERGE_AT) {
      const was = d.merge;
      d.merge = Math.min(1, d.merge + DUEL.MERGE_RATE * s);
      if (was < 1 && d.merge >= 1) { d.stats.merges++; out.push({ k: 'merge', energy: d.energy }); }
    } else d.merge = Math.max(0, d.merge - DUEL.MERGE_RATE * 0.5 * s);
  }
  return out;
}
