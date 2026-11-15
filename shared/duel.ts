// The duel's rules: a dance battle (docs/design/duel.md, the owner's second correction: nobody is knocked out or hurt).
// Two dancers in a world's play space run at each other, jump, catch each other, swing each other round, fling each
// other away, launch off each other and land on each other, and the two energies merge. It is competitive the way a
// dance battle is: style, combos, who leads.
//
//   combo   each dancer's chain of moves without long on the ground: every link (a catch, a swing, a fling, a lift, a
//           vault, a wall jump or run, a dash, a flip, a kick in the air, a flight landed) adds to it and to its
//           multiplier; a link on the beat (an 8th-note line within PERFECT_MS at 112 bpm, the same share of the beat at
//           any tempo: perfectMs) counts double; a link the same as the
//           last two counts little (variety over repetition). Only what a dancer does counts: a held body's own wall
//           runs and dashes don't (the contact carries it), and a flown body's link is for what it does with the
//           flight (landing it, a wall jump, a catch of its own), not for being flung. The combo is banked into style
//           when it ends (grounded a while, idle a while, held more than a beat or two; a fall drops it). Past the
//           multiplier's cap a long combo climbs tiers (TIERS: a word and a colour each), each worth more when banked.
//           A run of a dancer's own moves (a dash, a wall jump or run, a flip, a kick, an aú) adds only SOLO_RUN in a
//           row: past it they keep the combo going but add nothing, until a contact link (a catch, a swing, a fling, a
//           lift, a vault, a counter, a flight landed) comes again. So the tiers come from the dance with the other
//   pair    the two's chain: every contact link either dancer makes (a hold's catch, swings and fling, the partner's
//           landing, a lift, a vault, a counter, a whip's or an arc's catch) goes on one chain shared by both, the
//           pair combo, while the two keep meeting (PAIR_IDLE_MS between links when apart). It has its own tiers
//           (PAIR_TIERS: a word and a colour each), and when it ends each dancer banks its share of it (the worth of
//           the links it made) times the pair's multiplier
//   style   the battle's score, mostly for leading: starting a catch, catching the other out of the air, a fling the
//           flown one lands from; and the banked combos
//   energy  shared, the dance's intensity: it rises only when the two play together (a link while joined or while
//           both combos are live, more on the beat and for a link the pair hasn't made lately; the first moments of
//           a hold), and ebbs otherwise: faster the further apart they are, and when the pair repeats itself (a link
//           the pair made twice in its last few drains it). A set's energy builds with the music (gains are smaller
//           early in the set). Held high while joined it charges the merge (MERGE: the energies mix, a moment that
//           spends some of it, then a while before the next); held near the top (FUSE_AT) for a few seconds in a set
//           that merged, the finale fuses: the set's event, not its habit
//   set     a set on the music (SET_MS, about a minute of the world's track): a count-in, play, a finale (the fusion
//           when it was earned), the higher style wins it, and the next set counts in
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
  /** on the beat: within this of an 8th-note line at PERFECT_BPM; at another tempo the same share of the beat (perfectMs:
   *  71 ms at the temple's 94 bpm, 56 at the Pool's 121). A window fixed in ms was a bigger share of a faster beat, so a
   *  faster track made more links perfect (each a double gain of the shared energy): the Pool's tempo fused about a
   *  third more often than the temple's in Node (report 16) */
  PERFECT_MS: 60,
  PERFECT_BPM: 112,
  PERFECT_GRID: 0.5,
  PERFECT_MUL: 2,
  /** a combo ends after this long on the ground (a moment's step between moves keeps it), this long with no link, or
   *  its dancer held by the other for more than this many beats (what is done to a held body isn't its combo) */
  COMBO_GROUND_MS: 700,
  COMBO_IDLE_MS: 1800,
  HELD_BANK_BEATS: 1.5,
  /** each link adds this to the multiplier (1 + n × STEP, at most MULT_MAX); a link like the last two counts REPEAT */
  MULT_STEP: 0.25,
  MULT_MAX: 4,
  REPEAT: 0.35,
  /** past the multiplier's cap (MULT_MAX at the 12th link), tiers: reached at this many links (a link the same as
   *  the last two not counted), a word and a colour (CSS) each; a banked combo is worth (1 + TIER_BONUS × tier) more */
  TIERS: [
    { at: 12, name: 'FLOW', color: '#7fe8d0' },
    { at: 18, name: 'BLOOM', color: '#ff9ad5' },
    { at: 26, name: 'RADIANT', color: '#ffd36b' },
    { at: 36, name: 'SUBLIME', color: '#efe6ff' },
  ] as readonly { at: number; name: string; color: string }[],
  TIER_BONUS: 0.25,
  /** a dancer's own moves (not contact) add to its combo at most this many in a row; past it they keep it going (its
   *  idle clock) but add nothing until a contact link comes */
  SOLO_RUN: 4,
  /** the pair combo: the two's chain of contact links. It ends PAIR_IDLE_MS after its last link while the two are
   *  apart (never while joined), and with a fall (dropped) or the set. Its multiplier is 1 + n × PAIR_STEP (at most
   *  PAIR_MAX); banked, each dancer gets PAIR_BANK × its share of the links' worth × the multiplier × (1 + PAIR_BONUS
   *  × tier). Tiers at this many varied links (a link the same as the pair's last two not counted), a word and a
   *  colour (CSS) each */
  PAIR_IDLE_MS: 2000,
  PAIR_GROUND_MS: 900,
  PAIR_STEP: 0.2,
  PAIR_MAX: 3,
  PAIR_BANK: 0.2,
  PAIR_BONUS: 0.3,
  PAIR_TIERS: [
    { at: 14, name: 'DUET', color: '#b8f28a' },
    { at: 28, name: 'CURRENT', color: '#7ad0ff' },
    { at: 48, name: 'MURMURATION', color: '#c9a8ff' },
    { at: 108, name: 'AURORA', color: '#e6fff2' },
  ] as readonly { at: number; name: string; color: string }[],
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
  /** the shared energy (0 … 1). A link together adds ENERGY_LINK (twice for a catch, an aerial, a fling or a lift,
   *  twice on the beat, NOVEL times for a kind not in the pair's last RECENT links); a kind already twice in them
   *  takes ENERGY_REPEAT away instead. Joined, the hold's first CONTACT_FRESH_MS fill it at ENERGY_CONTACT a second;
   *  held on after them it ebbs at EBB_HELD (the same thing held). Apart it ebbs at EBB_NEAR a second within NEAR_M
   *  (m, across the ground) up to EBB_FAR beyond FAR_M (the same whatever each is doing alone: two dancers each busy
   *  with their own moves side by side are not playing together; until phase 3 it was halved while both combos were
   *  live, the loophole the Pool's water and swell opened, report 14-pool-fusion), and EBB_STALE more
   *  while the pair's last RECENT links have fewer than STALE_KINDS kinds. Gains are ARC_FROM times as big at a set's
   *  start, growing to whole by ARC_AT of it (the set builds with its music), and (1 - TOP_DRAG × energy²) as big
   *  near the top (the last tenth is hard won: a good set hovers high and reaches the top in its best moments).
   *  Tuned in Node (src/duel/probe.ts) for virtual players: the first MERGE past 40% of a set, about one a minute */
  TOP_DRAG: 0.8,
  ENERGY_LINK: 0.014,
  ENERGY_CONTACT: 0.07,
  CONTACT_FRESH_MS: 1400,
  NOVEL: 1.5,
  ENERGY_REPEAT: 0.012,
  RECENT: 6,
  EBB_NEAR: 0.06,
  EBB_FAR: 0.15,
  EBB_HELD: 0.04,
  NEAR_M: 2.5,
  FAR_M: 7,
  EBB_STALE: 0.03,
  STALE_KINDS: 3,
  ARC_FROM: 0.5,
  ARC_AT: 0.5,
  /** the merge: charged while joined at or above MERGE_AT (MERGE_RATE a second; MERGE_DECAY a second it fades
   *  otherwise), a MERGE at 1: it spends MERGE_SPEND of the energy, and the charge rests MERGE_REST_MS before the next */
  MERGE_AT: 0.8,
  MERGE_RATE: 0.4,
  MERGE_DECAY: 0.12,
  MERGE_SPEND: 0.15,
  MERGE_REST_MS: 15000,
  /** the fusion: the finale fuses when the set merged and its energy stayed at FUSE_AT or above for FUSE_HOLD_MS
   *  without a break */
  FUSE_AT: 0.9,
  FUSE_HOLD_MS: 3000,
} as const;

export type LinkKind = 'catch' | 'aerial' | 'swing' | 'fling' | 'flown' | 'lift' | 'vault' | 'counter' | 'walljump' | 'wallrun' | 'dash' | 'flip' | 'kick' | 'au' | 'jump';
/** the links made with the other (the contact's, and a power's catch): the pair combo's, and what ends a solo run */
export const CONTACT_LINKS: ReadonlySet<LinkKind> = new Set<LinkKind>(['catch', 'aerial', 'swing', 'fling', 'flown', 'lift', 'vault', 'counter']);
/** the pair combo: the two's chain of contact links (n of them, `varied` toward its tiers), the links' worth by who
 *  made them (`share`) and how many each made, the last few links and whose they were */
/** a world's energy: its gains (a link's, a hold's first moments) and its ebbs (apart, held on) scaled, for a world whose
 *  ground makes the dance denser than the rules assume (the Pool: its water a floor, its swell throwing the two together) */
export interface DuelTune { gain: number; ebb: number }
export interface PairCombo { n: number; varied: number; tier: number; score: number; share: [number, number]; made: [number, number]; links: LinkKind[]; by: number[]; perfect: number; live: boolean; since: number; last: number }

/** a combo: n links, its multiplier and score, the last few links and which of them were on the beat (aligned) */
export interface Combo { n: number; mult: number; score: number; links: LinkKind[]; beats: boolean[]; perfect: number; live: boolean; since: number; last: number; /** the tier reached (0: none yet; DUEL.TIERS[tier - 1]), and the links that count toward it (all but repeats) */ tier: number; varied: number; /** the dancer's own moves in a row since its last contact link (SOLO_RUN) */ solo: number }
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
  /** joined now (the contact physics says), and since when; the seat held (-1: none) and since when */
  joined: boolean;
  joinedSince: number;
  held: number;
  heldSince: number;
  /** the pair's last links (both seats', RECENT of them: the energy's variety) */
  recent: LinkKind[];
  /** the merges this set, and the time the merge's charge rests until (ms) */
  merges: number;
  mergeRest: number;
  /** the energy at FUSE_AT or above since (ms, -1 below it), and the longest such stretch this set (ms) */
  highSince: number;
  highBest: number;
  /** whether the finale fused */
  fused: boolean;
  /** the pair combo (both dancers' contact links on one chain), and the longest this set */
  pair: PairCombo;
  pairBest: number;
  /** the world's energy (the arena's `energy`, DuelTune): its gains and its ebbs scaled; 1, 1 where it plays as the rules
   *  say */
  tune: DuelTune;
  stats: { catches: number; aerials: number; swings: number; flings: number; lifts: number; vaults: number; counters: number; falls: number; perfect: number; links: number; merges: number; sets: number };
}

export type DuelEvent =
  | { k: 'count'; n: number }
  | { k: 'go'; set: number }
  /** (capped: a dancer's own move past SOLO_RUN in a row: it kept the combo going and added nothing) */
  | { k: 'link'; seat: number; kind: LinkKind; perfect: boolean; n: number; mult: number; value: number; capped?: boolean }
  | { k: 'lead'; seat: number; why: 'catch' | 'aerial' | 'fling'; style: number }
  | { k: 'combo'; seat: number; n: number; mult: number; banked: number; why: 'ground' | 'idle' | 'held' | 'fall' | 'set'; tier: number }
  /** a combo reached a tier (past the multiplier's cap) */
  | { k: 'tier'; seat: number; tier: number; name: string; color: string; n: number }
  /** the energies merge: the n-th merge this set */
  | { k: 'merge'; energy: number; n: number }
  | { k: 'fall'; seat: number; style: number }
  | { k: 'ready'; seat: number }
  | { k: 'finale'; fused: boolean; peak: number }
  | { k: 'done'; winner: number; style: [number, number]; set: number }
  /** a set's count-in begins: both bodies (re)form at their spawns */
  | { k: 'set'; set: number }
  /** the pair combo reached a tier (PAIR_TIERS), on the link of `seat` */
  | { k: 'pairTier'; seat: number; tier: number; name: string; color: string; n: number }
  /** the pair combo ended: banked into each dancer's style (its share), or dropped by a fall */
  | { k: 'pairCombo'; n: number; varied: number; mult: number; tier: number; banked: [number, number]; why: 'idle' | 'ground' | 'fall' | 'set' }
  /** a moment of weight (src/duel/weight.ts makes them, from the contact, the powers, the rules and the finale): the
   *  page holds the bodies' time for `hold` frames (a 60th of a second each) and slows it to `slow` for `slowS`
   *  seconds after, the camera eases toward `at`, and the sound keys off `what`. `w` 0 … 1 is how big the moment is.
   *    catch   a catch on the ground          aerial  a catch out of the air (`via: 'geyser'` at a geyser's top)
   *    range   a catch at range (`via`: the whip or the arc)
   *    fling   a fling's release              tier    a dancer's combo reached a tier
   *    pair    the pair combo reached a tier (a flash of the two's colours, a beat of slow motion)
   *    merge   the energies merged            fusion  the finale will fuse (as FINALE fires)
   *    lift    the finale's lift at its top (the fused duet held a moment) */
  | { k: 'juice'; what: JuiceWhat; w: number; hold: number; slow?: number; slowS?: number; seat?: number; other?: number; at?: [number, number, number]; via?: 'whip' | 'arc' | 'geyser'; tier?: number };
export type JuiceWhat = 'catch' | 'aerial' | 'range' | 'fling' | 'tier' | 'pair' | 'merge' | 'fusion' | 'lift';

const combo0 = (): Combo => ({ n: 0, mult: 1, score: 0, links: [], beats: [], perfect: 0, live: false, since: 0, last: -1e9, tier: 0, varied: 0, solo: 0 });
const pair0 = (): PairCombo => ({ n: 0, varied: 0, tier: 0, score: 0, share: [0, 0], made: [0, 0], links: [], by: [], perfect: 0, live: false, since: 0, last: -1e9 });
const seat0 = (): DuelSeat => ({ style: 0, combo: combo0(), best: 0, links: 0, led: 0, fellAt: -1, groundSince: 0 });
const countMs = (bpm: number) => Math.max(DUEL.COUNT_MIN_MS, 60000 / Math.max(40, bpm || 112));
const stats0 = () => ({ catches: 0, aerials: 0, swings: 0, flings: 0, lifts: 0, vaults: 0, counters: 0, falls: 0, perfect: 0, links: 0, merges: 0, sets: 0 });

/** a duel whose first step begins set 1 (a 'set' event places the bodies, then the count-in) */
export function newDuel(now: number, bpm = 112, tune: Partial<DuelTune> = {}): DuelState {
  return {
    phase: 'done', set: 0, since: now - DUEL.DONE_MS, countMs: countMs(bpm), count: DUEL.COUNT_FROM, playFrom: now, winner: null,
    seats: [seat0(), seat0()], energy: 0, peak: 0, merge: 0, joined: false, joinedSince: 0, held: -1, heldSince: 0, recent: [],
    merges: 0, mergeRest: -1e9, highSince: -1, highBest: 0, fused: false, pair: pair0(), pairBest: 0, tune: { gain: tune.gain ?? 1, ebb: tune.ebb ?? 1 }, stats: stats0(),
  };
}
/** from set 1 again (the next step's 'set' event places the bodies) */
export function restartDuel(d: DuelState, now: number, bpm = 112) { Object.assign(d, { ...newDuel(now, bpm, d.tune), stats: d.stats }); }

/** a seat's controls are held: the count-in, or reforming after a fall */
export function frozen(d: DuelState, seat: number) { return d.phase === 'intro' || d.seats[seat].fellAt >= 0; }
/** play is on (links count) */
export const playing = (d: DuelState) => d.phase === 'play';

/** the on-beat window (ms either side of an 8th-note line) at a tempo: PERFECT_MS at PERFECT_BPM, the same share of the
 *  beat at any other */
export const perfectMs = (bpm: number) => (DUEL.PERFECT_MS * DUEL.PERFECT_BPM) / Math.max(40, bpm || DUEL.PERFECT_BPM);
/** is a beat (music clock) on the 8th-note grid, within the window (perfectMs) at this tempo? */
export function onBeat(beat: number | null, bpm: number) {
  if (beat == null || !Number.isFinite(beat)) return false;
  const g = DUEL.PERFECT_GRID, x = beat / g, off = (x - Math.round(x)) * g;
  return Math.abs((off * 60000) / Math.max(40, bpm)) <= perfectMs(bpm);
}

/** the tier a combo of n links has reached (0: none) */
export function tierOf(n: number) {
  let t = 0;
  for (let i = 0; i < DUEL.TIERS.length; i++) if (n >= DUEL.TIERS[i].at) t = i + 1;
  return t;
}
/** a tier's word and colour (null for 0) */
export const tierInfo = (t: number) => (t > 0 ? DUEL.TIERS[Math.min(t, DUEL.TIERS.length) - 1] : null);
/** the pair combo's tier at n varied links (0: none), and its word and colour */
export function pairTierOf(n: number) {
  let t = 0;
  for (let i = 0; i < DUEL.PAIR_TIERS.length; i++) if (n >= DUEL.PAIR_TIERS[i].at) t = i + 1;
  return t;
}
export const pairTierInfo = (t: number) => (t > 0 ? DUEL.PAIR_TIERS[Math.min(t, DUEL.PAIR_TIERS.length) - 1] : null);
/** the pair combo's multiplier */
export const pairMult = (P: PairCombo) => Math.min(DUEL.PAIR_MAX, 1 + P.n * DUEL.PAIR_STEP);

/** the pair combo ends: each dancer banks its share (nothing on a fall) */
const bankPair = (d: DuelState, why: 'idle' | 'ground' | 'fall' | 'set', out: DuelEvent[]) => {
  const P = d.pair;
  if (!P.live) return;
  const mult = pairMult(P), k = DUEL.PAIR_BANK * mult * (1 + DUEL.PAIR_BONUS * P.tier);
  const banked: [number, number] = why === 'fall' ? [0, 0] : [Math.round(P.share[0] * k), Math.round(P.share[1] * k)];
  d.seats[0].style += banked[0]; d.seats[1].style += banked[1];
  out.push({ k: 'pairCombo', n: P.n, varied: P.varied, mult, tier: P.tier, banked, why });
  d.pair = pair0();
};
/** a contact link on the pair's chain (a link the same as the pair's last two counts little and not toward a tier) */
function pairLink(d: DuelState, seat: number, kind: LinkKind, perfect: boolean, now: number, out: DuelEvent[]) {
  const P = d.pair;
  if (!P.live) { P.live = true; P.since = now; }
  const repeat = P.links.length >= 2 && P.links[P.links.length - 1] === kind && P.links[P.links.length - 2] === kind;
  const value = (DUEL.LINK[kind] ?? 1) * (perfect ? DUEL.PERFECT_MUL : 1) * (repeat ? DUEL.REPEAT : 1);
  P.n++; P.score += value; P.share[seat] += value; P.made[seat]++; P.last = now;
  if (perfect) P.perfect++;
  P.links.push(kind); P.by.push(seat);
  if (P.links.length > 8) { P.links.shift(); P.by.shift(); }
  if (!repeat) P.varied++;
  d.pairBest = Math.max(d.pairBest, P.n);
  const tier = pairTierOf(P.varied);
  if (tier > P.tier) { P.tier = tier; const T = pairTierInfo(tier)!; out.push({ k: 'pairTier', seat, tier, name: T.name, color: T.color, n: P.n }); }
}

const bank = (d: DuelState, k: number, why: 'ground' | 'idle' | 'held' | 'fall' | 'set', out: DuelEvent[]) => {
  const S = d.seats[k], C = S.combo;
  if (!C.live) return;
  const banked = why === 'fall' ? 0 : Math.round(C.score * C.mult * (1 + DUEL.TIER_BONUS * C.tier));
  S.style += banked;
  out.push({ k: 'combo', seat: k, n: C.n, mult: C.mult, banked, why, tier: C.tier });
  S.combo = combo0();
};
/** what energy gains are worth this far into the set (the set builds with its music) and this near the top */
const arc = (d: DuelState, now: number, setMs: number) =>
  (DUEL.ARC_FROM + (1 - DUEL.ARC_FROM) * Math.min(1, Math.max(0, (now - d.playFrom) / (setMs * DUEL.ARC_AT)))) * (1 - DUEL.TOP_DRAG * d.energy * d.energy);

/** a link a dancer made (the contact physics' catch, swing, fling, lift, vault, counter; the body's wall jump, wall run,
 *  dash, flip, kick in the air, aú; a flight landed, `flown`). Returns its events (the link, any tier reached, and any
 *  leading style). `setMs`: the set's length, for the energy's build (default SET_MS) */
export function duelLink(d: DuelState, seat: number, kind: LinkKind, perfect: boolean, now: number, setMs: number = DUEL.SET_MS): DuelEvent[] {
  const out: DuelEvent[] = [];
  if (d.phase !== 'play' || d.seats[seat].fellAt >= 0) return out;
  const S = d.seats[seat], C = S.combo;
  if (!C.live) { C.live = true; C.since = now; }
  const contact = CONTACT_LINKS.has(kind);
  // (a dancer's own moves past SOLO_RUN in a row: the combo goes on, nothing is added; the energy reads it as before)
  if (!contact && C.solo >= DUEL.SOLO_RUN) {
    C.last = now; S.links++; d.stats.links++;
    out.push({ k: 'link', seat, kind, perfect, n: C.n, mult: C.mult, value: 0, capped: true });
    shareEnergy(d, seat, kind, perfect, now, setMs);
    return out;
  }
  C.solo = contact ? 0 : C.solo + 1;
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
  if (!repeat) C.varied++;
  const tier = tierOf(C.varied);
  if (tier > C.tier) { C.tier = tier; const T = tierInfo(tier)!; out.push({ k: 'tier', seat, tier, name: T.name, color: T.color, n: C.n }); }
  if (contact) pairLink(d, seat, kind, perfect, now, out);
  shareEnergy(d, seat, kind, perfect, now, setMs);
  // leading
  const lead = (why: 'catch' | 'aerial' | 'fling', v: number) => { S.style += v; S.led += v; out.push({ k: 'lead', seat, why, style: v }); };
  if (kind === 'catch') lead('catch', DUEL.LEAD_CATCH);
  else if (kind === 'aerial') lead('aerial', DUEL.LEAD_AERIAL);
  return out;
}
/** the shared energy for a link: a link while joined, or while the other's combo is live too, is playing together;
 *  one the pair hasn't made lately counts more, one it keeps making takes away (a swing after a swing in one hold is
 *  the same swing going on: it neither counts again nor repeats) */
function shareEnergy(d: DuelState, seat: number, kind: LinkKind, perfect: boolean, now: number, setMs: number) {
  const O = d.seats[1 - seat].combo;
  const goingOn = kind === 'swing' && d.joined && d.recent[d.recent.length - 1] === 'swing';
  if (!goingOn) {
    const seen = d.recent.filter((x) => x === kind).length;
    if (d.joined || O.live) {
      if (seen >= 2) d.energy = Math.max(0, d.energy - DUEL.ENERGY_REPEAT);
      else d.energy = Math.min(1, d.energy + DUEL.ENERGY_LINK * d.tune.gain * arc(d, now, setMs) * (perfect ? 2 : 1) * (seen ? 1 : DUEL.NOVEL)
        * (kind === 'catch' || kind === 'aerial' || kind === 'fling' || kind === 'lift' ? 2 : 1));
    }
    d.recent.push(kind);
    if (d.recent.length > DUEL.RECENT) d.recent.shift();
  }
}
/** a fling one seat made has been landed well by the other (its feet, a wall, a catch): the flinger leads */
export function duelFlingLanded(d: DuelState, flinger: number): DuelEvent[] {
  if (d.phase !== 'play') return [];
  d.seats[flinger].style += DUEL.LEAD_FLING_LANDED; d.seats[flinger].led += DUEL.LEAD_FLING_LANDED;
  return [{ k: 'lead', seat: flinger, why: 'fling', style: DUEL.LEAD_FLING_LANDED }];
}
/** the contact physics: joined or not this frame, and the seat held (-1: none) */
export function duelContact(d: DuelState, joined: boolean, now: number, held = -1) {
  if (joined && !d.joined) d.joinedSince = now;
  d.joined = joined;
  const h = joined ? held : -1;
  if (h !== d.held) { d.held = h; d.heldSince = now; }
}

/** the bodies this frame, as the rules read them (x, z: where on the ground, for how far apart they are) */
export interface DuelBody { y: number; grounded: boolean; x?: number; z?: number }
export interface DuelArena { yKill: number; bpm: number; setMs?: number }

/** one frame: the set's clock, falls, combos ending, the shared energy and the merge */
export function duelStep(d: DuelState, now: number, dt: number, bodies: readonly [DuelBody, DuelBody], arena: DuelArena): DuelEvent[] {
  const out: DuelEvent[] = [];
  const setMs = arena.setMs ?? DUEL.SET_MS;
  // ---- the set's clock
  if (d.phase === 'done' && now - d.since >= DUEL.DONE_MS) {
    d.set += 1; d.phase = 'intro'; d.since = now; d.countMs = countMs(arena.bpm); d.count = DUEL.COUNT_FROM; d.winner = null;
    d.seats = [seat0(), seat0()]; d.energy = 0; d.peak = 0; d.merge = 0; d.fused = false;
    d.recent = []; d.merges = 0; d.mergeRest = -1e9; d.highSince = -1; d.highBest = 0; d.pair = pair0(); d.pairBest = 0;
    out.push({ k: 'set', set: d.set }, { k: 'count', n: d.count });
  }
  if (d.phase === 'intro') {
    const n = DUEL.COUNT_FROM - Math.floor((now - d.since) / d.countMs);
    if (n <= 0) { d.phase = 'play'; d.since = now; d.playFrom = now; d.count = 0; out.push({ k: 'go', set: d.set }); }
    else if (n !== d.count) { d.count = n; out.push({ k: 'count', n }); }
  }
  if (d.phase === 'play' && now - d.playFrom >= setMs) {
    for (let k = 0; k < 2; k++) bank(d, k, 'set', out);
    bankPair(d, 'set', out);
    d.phase = 'finale'; d.since = now; d.fused = fusionEarned(d);
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
      bankPair(d, 'fall', out);
      const cost = Math.min(S.style, DUEL.FALL_COST);
      S.style -= cost; S.fellAt = now; d.stats.falls++;
      out.push({ k: 'fall', seat: k, style: cost });
      continue;
    }
    const C = S.combo, beatMs = 60000 / Math.max(40, arena.bpm || 112);
    if (C.live && d.held === k && now - d.heldSince >= DUEL.HELD_BANK_BEATS * beatMs) bank(d, k, 'held', out);
    else if (C.live && !d.joined && S.groundSince >= 0 && now - S.groundSince >= DUEL.COMBO_GROUND_MS) bank(d, k, 'ground', out);
    else if (C.live && now - C.last >= DUEL.COMBO_IDLE_MS) bank(d, k, 'idle', out);
  }
  // ---- the pair combo ends a while after its last link, the two apart
  if (d.phase === 'play' && d.pair.live && !d.joined) {
    const g0 = d.seats[0].groundSince, g1 = d.seats[1].groundSince;
    const grounded = g0 >= 0 && g1 >= 0 && now - Math.max(g0, g1) >= DUEL.PAIR_GROUND_MS;
    if (grounded || now - d.pair.last >= DUEL.PAIR_IDLE_MS) bankPair(d, grounded ? 'ground' : 'idle', out);
  }
  // ---- the shared energy: a hold's first moments fill it, it ebbs apart (the further, the faster; more when the pair
  // repeats itself); the merge charges while joined and high, and rests after each; the stretch near the top is timed
  if (d.phase === 'play') {
    const s = dt / 1000;
    if (d.joined) {
      if (now - d.joinedSince < DUEL.CONTACT_FRESH_MS) d.energy = Math.min(1, d.energy + DUEL.ENERGY_CONTACT * d.tune.gain * arc(d, now, setMs) * s);
      else d.energy = Math.max(0, d.energy - DUEL.EBB_HELD * d.tune.ebb * s);
    } else {
      const A = bodies[0], B = bodies[1];
      const gap = A.x != null && B.x != null ? Math.hypot(A.x - B.x, (A.z ?? 0) - (B.z ?? 0)) : DUEL.NEAR_M;
      const far = Math.min(1, Math.max(0, (gap - DUEL.NEAR_M) / (DUEL.FAR_M - DUEL.NEAR_M)));
      const stale = d.recent.length >= DUEL.RECENT && new Set(d.recent).size < DUEL.STALE_KINDS ? DUEL.EBB_STALE : 0;
      const ebb = DUEL.EBB_NEAR + (DUEL.EBB_FAR - DUEL.EBB_NEAR) * far + stale;
      d.energy = Math.max(0, d.energy - ebb * d.tune.ebb * s);
    }
    d.peak = Math.max(d.peak, d.energy);
    if (d.energy >= DUEL.FUSE_AT) {
      if (d.highSince < 0) d.highSince = now;
      d.highBest = Math.max(d.highBest, now - d.highSince);
    } else d.highSince = -1;
    if (d.joined && d.energy >= DUEL.MERGE_AT && now >= d.mergeRest) {
      d.merge = Math.min(1, d.merge + DUEL.MERGE_RATE * s);
      if (d.merge >= 1) {
        d.merges++; d.stats.merges++; d.merge = 0; d.mergeRest = now + DUEL.MERGE_REST_MS;
        out.push({ k: 'merge', energy: d.energy, n: d.merges });
        d.energy = Math.max(0, d.energy - DUEL.MERGE_SPEND);
      }
    } else d.merge = Math.max(0, d.merge - DUEL.MERGE_DECAY * s);
  }
  return out;
}

/** has this set earned the fusion so far: it merged, and its energy held at FUSE_AT for FUSE_HOLD_MS */
export const fusionEarned = (d: DuelState) => d.merges > 0 && d.highBest >= DUEL.FUSE_HOLD_MS;
/** 0 … 1: how near the set is to the fusion (the longest stretch near the top, of FUSE_HOLD_MS; short of 1 until it
 *  has merged too) */
export const fusionCharge = (d: DuelState) => (fusionEarned(d) ? 1 : Math.min(d.merges > 0 ? 1 : 0.95, d.highBest / DUEL.FUSE_HOLD_MS));
