// The duel's sound (docs/reports/14-sound.md): what is heard when, decided here and played by the music's instrument
// (synth/duel.ts: water, wind, embers, glass bowls, chimes and breath; never an impact). Three parts:
//
//   the map     every event the duel makes, named `<source>:<name>` (the rules' `duel:catch`… from shared/duel.ts, the
//               contact's `touch:aerial`…, the powers' `power:cast`…, a body's own `body:dash`…), looked up in
//               DUEL_SOUNDS: a line per name turns an event into a cue (or nothing). A name not in it is ignored, so a
//               new event is heard by adding a line, and an event nobody mapped never makes a sound by accident
//   the beat    a cue is put on the music's grid where that is musical (TIMING: the beat, an 8th or a 16th, nearest
//               within a small window: a line a few tens of ms ahead is waited for, one just passed counts as on it),
//               else it plays at once; movement is never held back. Each cue in the seat's matter's colour, placed
//               where it happened (spatial.ts: the camera is the ear)
//   the set     the music follows the set's clock (SetMusic): at each set's count-in the track is placed so its "go"
//               lands on a phrase's downbeat (the first set on the track's bar 1, its count-in the lead-in; later ones
//               on the phrase line nearest where the music had got to), the set lasts whole phrases (`phraseSetMs`, so
//               the finale lands on a phrase line), and if the music and the set drift apart (a context that started
//               suspended and woke at the first gesture, a tab that came back) the track is put back where the set is.
//               Not in a film (its track is laid under it) or a room's shared clock (the room says where)
//
// The duel's index.ts makes one DuelSound after `bend.duel` and routes fx.ts's and power-fx.ts's old jogo effects
// through `jogo()` (dropped: these cues replace them). `bend.duel.sound.stats()` counts what played.
import type { DuelCall, DuelCue, Instrument, UnderLevels } from '../audio/instrument';
import type { Harm } from '../audio/harmony';
import { panOf, distOf, type Listener } from '../audio/spatial';
import { trackChord, trackFor, trackBar, trackMood, type TrackInfo } from '../audio/track';
import { TRACK_ENERGY } from '../audio/energy';
import { DUEL } from '../../shared/duel.ts';
import { HAZARD, gustNow, humNow, swellNow, tideAt, type Hazard } from './hazards';

type V3 = [number, number, number];
type Ev = Record<string, unknown> & { k?: string; kind?: string; type?: string };

// ---------------------------------------------------------------- the beat
/** where a sound made at `now` (the music's beat there `beatNow`, a beat `spb` s long) goes on the grid: the nearest
 *  line of the coarsest of `grids` (in beats: 4 a bar, 1 a beat, 0.5 an 8th, 0.25 a 16th) that is at most `ahead` s
 *  away or passed at most `behind` s ago (then it plays at once: it is heard on it); otherwise at once, free. Swung
 *  16ths (an odd 16th late by `swing` of a 16th) as the music plays them. Pure */
export function onGrid(now: number, beatNow: number, spb: number, grids: readonly number[], ahead: number, behind = 0.025, swing = 0) {
  for (const g of grids) {
    const lines = (k: number) => k * g + (g === 0.25 && (((k % 2) + 2) % 2) === 1 ? swing * 0.25 : 0);
    const k0 = Math.floor(beatNow / g);
    let prev = -Infinity, next = Infinity;
    for (let k = k0 - 1; k <= k0 + 2; k++) { const b = lines(k); if (b <= beatNow + 1e-9) prev = Math.max(prev, b); else next = Math.min(next, b); }
    if ((beatNow - prev) * spb <= behind) return { t: now, snapped: true, grid: g, wait: 0 };
    const wait = (next - beatNow) * spb;
    if (wait <= ahead) return { t: now + wait, snapped: true, grid: g, wait };
  }
  return { t: now, snapped: false, grid: 0, wait: 0 };
}

/** how each cue meets the beat: its grids (coarsest first), the window ahead (s), and the least gap (s) between two of
 *  it from one seat (a repeat closer than that is the same moment) */
export const TIMING: Record<DuelCue, { grids: number[]; ahead: number; gap?: number }> = {
  count: { grids: [1, 0.5], ahead: 0.12 }, go: { grids: [4, 1], ahead: 0.12 },
  catch: { grids: [1, 0.5], ahead: 0.07, gap: 0.25 }, aerial: { grids: [1, 0.5], ahead: 0.07, gap: 0.25 }, range: { grids: [1, 0.5], ahead: 0.07, gap: 0.25 },
  swing: { grids: [0.5], ahead: 0.08, gap: 0.2 }, fling: { grids: [0.5, 0.25], ahead: 0.06 }, landed: { grids: [0.5, 0.25], ahead: 0.06 },
  lift: { grids: [0.5], ahead: 0.07 }, counter: { grids: [0.25], ahead: 0.04 }, release: { grids: [], ahead: 0 },
  merge: { grids: [1, 0.5], ahead: 0.12, gap: 1 }, finale: { grids: [4, 1], ahead: 0.12, gap: 2 }, fusion: { grids: [4, 1], ahead: 0.12, gap: 2 },
  banner: { grids: [1], ahead: 0.12, gap: 2 }, tier: { grids: [1, 0.5], ahead: 0.1, gap: 0.3 }, bank: { grids: [0.5], ahead: 0.08 },
  fall: { grids: [], ahead: 0 }, reform: { grids: [0.5], ahead: 0.06 },
  cast: { grids: [0.5, 0.25], ahead: 0.06, gap: 0.05 }, form: { grids: [1, 0.5], ahead: 0.1, gap: 0.5 }, react: { grids: [1, 0.5], ahead: 0.1, gap: 0.5 },
  launch: { grids: [], ahead: 0 }, swap: { grids: [], ahead: 0 }, redirect: { grids: [0.25], ahead: 0.04 },
  dash: { grids: [], ahead: 0, gap: 0.1 }, walljump: { grids: [], ahead: 0, gap: 0.1 }, land: { grids: [], ahead: 0, gap: 0.2 }, jump: { grids: [], ahead: 0, gap: 0.15 },
  // (the hazards' phrase sounds come with their own beat: `CueReq.beat`)
  splash: { grids: [], ahead: 0, gap: 0.3 }, crest: { grids: [0.25], ahead: 0.04, gap: 0.3 },
  tide: { grids: [], ahead: 0, gap: 1 }, gust: { grids: [], ahead: 0, gap: 1 }, swell: { grids: [], ahead: 0, gap: 1 }, hum: { grids: [], ahead: 0, gap: 1 }, humlift: { grids: [1], ahead: 0.1, gap: 1 },
  // (the crossing's chime is put on its beat by SetMusic.cross, the beat the new track comes in on)
  cross: { grids: [], ahead: 0, gap: 1 },
};

// ---------------------------------------------------------------- the map
/** what an event asks to hear: a cue, whose it is, where, how hard */
export interface CueReq {
  cue: DuelCue;
  /** the seat it is (its matter's colour, where it is heard); -1 or absent: the pair's */
  seat?: number; other?: number;
  at?: V3 | null; vel?: number; level?: number; power?: string; on?: boolean; big?: boolean; perfect?: boolean; dur?: number;
  /** when it sounds, as a beat of the music's clock (a hazard's phrase sound; at once if it has passed): no grid */
  beat?: number;
}
type Rule = (e: Ev) => CueReq | CueReq[] | null;
const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const v3 = (x: unknown): V3 | null => (Array.isArray(x) && x.length >= 3 ? [num(x[0]), num(x[1]), num(x[2])] : null);
const seatOf = (e: Ev) => num(e.seat, -1);
const touch = (cue: DuelCue): Rule => (e) => ({ cue, seat: seatOf(e), other: num(e.other, -1), at: v3(e.at), perfect: !!e.perfect });

/** the duel's events and the sounds they make. Names are `<source>:<name>`: `duel:` the rules' events (shared/duel.ts
 *  DuelEvent's `k`, with the powers' own rules events), `touch:` the contact's (contact.ts ContactEvent's `kind`),
 *  `power:` the powers' moments (powers.ts PowerFx's `k`), `body:` a body's own (Character events' `type`). A name
 *  not here is ignored: add a line to hear a new one */
export const DUEL_SOUNDS: Record<string, Rule> = {
  // ---- the set
  'duel:count': (e) => ({ cue: 'count', level: num(e.n, 3) }),
  'duel:go': () => ({ cue: 'go' }),
  'duel:merge': () => ({ cue: 'merge', seat: 0, other: 1 }),
  'duel:finale': (e) => ({ cue: e.fused ? 'fusion' : 'finale', seat: 0, other: 1 }),
  'duel:done': (e) => ({ cue: 'banner', seat: num(e.winner, 0) }),
  'duel:tier': (e) => ({ cue: 'tier', seat: seatOf(e), level: num(e.tier, 1) }),
  'duel:combo': (e) => (num(e.n) >= 6 && e.why !== 'fall' && e.why !== 'set' ? { cue: 'bank', seat: seatOf(e), level: num(e.n) } : null),
  'duel:fall': (e) => ({ cue: 'fall', seat: seatOf(e) }),
  'duel:ready': (e) => ({ cue: 'reform', seat: seatOf(e) }),
  // ---- phase 3's weight and pair combos (shared/duel.ts 'juice', 'pairTier', 'pairCombo'; src/duel/weight.ts). A
  // juice moment comes in the frame of its touch (or of the power's catch): the strongest catch a moment wins (the
  // juice's, first in the frame, sized by its `w`), a fling's twin is dropped by its gap. Its tier, pair, merge and
  // fusion are heard from the rules' own events ('tier', 'pairTier', 'merge', 'finale'): the juice adds nothing there
  'duel:juice': (e) => {
    const w = Math.max(0, Math.min(1, num(e.w, 0.5))), vel = 0.75 + 0.35 * w, at = v3(e.at), seat = seatOf(e), other = num(e.other, -1);
    switch (e.what) {
      case 'catch': case 'aerial': case 'range': case 'fling': return { cue: e.what as DuelCue, seat, other, at, vel };
      case 'lift': return { cue: 'lift', seat: seat >= 0 ? seat : 0, other: other >= 0 ? other : 1, at, vel: 1, big: true };
      default: return null;
    }
  },
  'duel:pairTier': (e) => ({ cue: 'tier', seat: seatOf(e) >= 0 ? seatOf(e) : 0, other: seatOf(e) === 1 ? 0 : 1, level: num(e.tier, 1), big: true }),
  'duel:pairCombo': (e) => (num(e.varied) >= 6 && e.why !== 'fall' && e.why !== 'set' ? { cue: 'bank', seat: 0, other: 1, level: num(e.n), big: true } : null),
  // ---- the contact
  'touch:catch': touch('catch'),
  'touch:aerial': touch('aerial'),
  'touch:swing': (e) => ({ ...touch('swing')(e) as CueReq, level: num(e.n, 1) }),
  'touch:fling': touch('fling'),
  // (a flight's end is the flinger's event; the flyer is heard landing. Caught: the catch is the sound)
  'touch:landed': (e) => (e.how === 'catch' ? null : { cue: 'landed', seat: num(e.other, -1), at: v3(e.at) }),
  'touch:lift': touch('lift'),
  'touch:vault': touch('lift'),
  'touch:counter': touch('counter'),
  'touch:release': (e) => (e.why === 'reform' ? null : touch('release')(e)),
  // ---- the powers
  'power:cast': (e) => ({ cue: 'cast', seat: seatOf(e), at: v3(e.at), power: String(e.power ?? ''), big: !!e.big, dur: e.power === 'wave' ? 2.2 : e.power === 'ribbon' ? 2 : undefined }),
  'power:form': (e) => ({ cue: 'form', seat: seatOf(e), at: v3(e.at), on: !!e.on }),
  'power:react': (e) => ({ cue: 'react', seat: Array.isArray(e.seats) ? num(e.seats[0], 0) : 0, other: Array.isArray(e.seats) ? num(e.seats[1], -1) : -1, at: v3(e.at), power: String(e.kind ?? 'geyser') }),
  // (a catch a power made: at range)
  'power:catch': (e) => ({ cue: 'range', seat: seatOf(e), other: num(e.other, -1), at: v3(e.at) }),
  'power:launch': (e) => ({ cue: 'launch', seat: seatOf(e), at: v3(e.at) }),
  'power:blink': (e) => (e.swap ? { cue: 'swap', seat: seatOf(e), at: v3(e.to) } : null),
  'power:redirect': (e) => ({ cue: 'redirect', seat: seatOf(e), at: v3(e.at) }),
  // ---- the arenas' hazards (hazards.ts HazardFx's `k`; their phrase sounds come from HazardSound, below)
  'hazard:splash': (e) => ({ cue: 'splash', seat: seatOf(e), at: v3(e.at), level: num(e.strength, 0.5) }),
  'hazard:crest': (e) => ({ cue: 'crest', seat: seatOf(e), at: v3(e.at) }),
  'hazard:lift': (e) => ({ cue: 'launch', seat: seatOf(e), at: v3(e.at) }),
  // ---- the bodies (soft)
  'body:dash': (e) => ({ cue: 'dash', at: [num(e.x), num(e.y) + 1, num(e.z)] }),
  'body:wallJump': (e) => ({ cue: 'walljump', at: [num(e.x), num(e.y) + 1, num(e.z)], level: 1 }),
  'body:land': (e) => (num(e.impact) >= 3.5 ? { cue: 'land', at: [num(e.x), num(e.y), num(e.z)], level: Math.min(1, 0.15 + (num(e.impact) - 3.5) / 9) } : null),
  'body:jump': (e) => (e.air ? { cue: 'jump', at: [num(e.x), num(e.y) + 1, num(e.z)] } : null),
};

/** an event's sounds by its name (none for a name not in the map) */
export function cuesOf(name: string, e: Ev, map: Record<string, Rule> = DUEL_SOUNDS): CueReq[] {
  const r = map[name];
  if (!r) return [];
  const out = r(e);
  return out == null ? [] : Array.isArray(out) ? out : [out];
}

/** a catch heard once a moment: at range over out of the air over on the ground */
const CATCHES: Partial<Record<DuelCue, number>> = { catch: 1, aerial: 2, range: 3 };
/** how hard each cue plays (× the make-up gain in synth/duel.ts) */
const VEL: Partial<Record<DuelCue, number>> = { catch: 0.85, aerial: 0.95, range: 0.95, merge: 0.9, fusion: 1, finale: 0.95, banner: 0.85, tier: 0.9 };

// ---------------------------------------------------------------- the arenas' hazards
/** the hazards' own sounds, on their phrases (hazards.ts: each acts on the music's 4-bar phrase, shown before it acts):
 *  the redwoods' gust (leaves on the air from its warning, then the wind), the Pool's swell rolling across from the
 *  phrase line, the geode's crystal humming through its warning and its column lifting on the line, the temple's tide a
 *  slow wash each phrase while it is in. Each once a phrase, timed to its beat. Pure: the hazard and the beat in, cues out */
export class HazardSound {
  private last: Record<string, number> = {};
  update(H: Hazard | null | undefined, beat: number, spb: number, mid: V3): CueReq[] {
    if (!H || !H.on) return [];
    const out: CueReq[] = [], P = HAZARD, once = (k: string, p: number) => { if (this.last[k] === p) return false; this.last[k] = p; return true; };
    const near = (b: number) => beat >= b - 0.25;
    if (H.kind === 'wind' && H.wind) {
      const g = gustNow(H, beat), from = g.phrase * P.PHRASE - P.GUST_WARN;
      if (g.has && near(from) && once('gust', g.phrase)) out.push({ cue: 'gust', beat: from, level: P.GUST_WARN * spb, dur: (P.GUST_RISE + P.GUST_HOLD + P.GUST_FALL) * spb, at: [mid[0] - g.dir[0] * 6, mid[1] + 1, mid[2] - g.dir[1] * 6] });
    } else if (H.kind === 'swell' && H.swell) {
      const w = swellNow(H, beat), S = H.swell;
      if (w.u < 0.5 && once('swell', w.phrase)) out.push({ cue: 'swell', beat: w.phrase * P.PHRASE, dur: P.SWELL_BEATS * spb, at: [S.center[0], mid[1], S.center[1]] });
    } else if (H.kind === 'hum' && H.hum) {
      const m = humNow(H, beat), next = (m.phrase + 1) * P.PHRASE;
      if (m.warn > 0 && once('hum', m.phrase + 1)) out.push({ cue: 'hum', beat: next - P.HUM_WARN, dur: P.HUM_WARN * spb, at: [m.next[0], m.next[1] + 1, m.next[2]] });
      if (m.lift > 0 && once('humlift', m.phrase)) out.push({ cue: 'humlift', beat: m.phrase * P.PHRASE, at: [m.spot[0], m.spot[1] + 1, m.spot[2]] });
    } else if (H.kind === 'tide' && H.tide) {
      const p = Math.floor(beat / P.PHRASE), T = H.tide, lvl = (tideAt(H, p * P.PHRASE + P.PHRASE / 2) - T.low) / Math.max(0.01, T.high - T.low);
      if (lvl > 0.15 && once('tide', p)) out.push({ cue: 'tide', beat: p * P.PHRASE, level: lvl, dur: P.PHRASE * spb, at: mid });
    }
    return out;
  }
}

// ---------------------------------------------------------------- the set's length on the music
/** a set's length (ms) as whole phrases (`bars`, 4) of the track nearest the length asked, so a set that begins on a
 *  phrase line ends on one (the finale on the music's line). Pure */
export function phraseSetMs(askedMs: number, bpm: number, bars = 4) {
  const phrase = (bars * 240000) / Math.max(40, bpm);
  return Math.max(1, Math.round(askedMs / phrase)) * phrase;
}
/** the phrase line (beats since bar 1) nearest `beat`: every 4 bars from bar 1 before the track's loop, every 4 bars
 *  from the loop's start inside it (the loop's length is whole phrases, so the lines hold round it). Pure */
/** where a crossing enters the new track (phase 6): the first bar of a 4-bar phrase of its body (its loop) whose
 *  loudness (src/audio/energy.ts: dB against the track's median bar) is nearest the old track's around the bar it was
 *  on, lifted a little for a set in full flow (`energy` 0 … 1), a phrase that starts with a dip a little worse. Never
 *  its intro */
export function entryBar(from: TrackInfo, fromBar: number, to: TrackInfo, energy: number) {
  const A = TRACK_ENERGY[from.id], B = TRACK_ENERGY[to.id];
  const mean = (E: readonly number[], b0: number, n: number) => { let s = 0, k = 0; for (let b = b0; b < b0 + n; b++) if (b >= 0 && b < E.length) { s += E[b]; k++; } return k ? s / k : 0; };
  const want = (A ? mean(A, fromBar - 1, 4) : 0) + (Math.max(0, Math.min(1, energy)) - 0.5) * 1.2;
  let best = to.loop.startBar, score = Infinity;
  for (let b = to.loop.startBar; b + 4 <= to.loop.endBar; b += 4) {
    if (!B) break;
    const m = mean(B, b, 4), s = Math.abs(m - want) + 0.3 * Math.max(0, m - B[b]);
    if (s < score - 1e-9) { score = s; best = b; }
  }
  return best;
}

export function phraseLine(beat: number, t: TrackInfo, bars = 4) {
  const P = bars * 4, L0 = t.loop.startBar * 4;
  if (beat < L0 - P / 2) return Math.max(0, Math.round(beat / P) * P);
  return Math.max(0, L0 + Math.round((beat - L0) / P) * P);
}

// ---------------------------------------------------------------- the duel's sound
/** what the sound reads of the music (the page's Music; a test's fake) */
export interface SoundHost {
  /** where the calls go (the music's instrument: live, or a film's recorder) */
  out: Instrument;
  /** when a sound made now plays (s, on the clock everything is scheduled on) */
  now(): number;
  clock: { beatAt(t: number): number; readonly bpm: number; readonly swing: number };
  harmony: { at(t: number): Harm };
  listener: Listener;
}
/** what the sound reads of the duel each frame */
export interface DuelSource {
  /** this frame's rules events (the powers' rules events in them), the contact's, the powers' moments */
  events(): readonly object[];
  touches(): readonly object[];
  powers(): readonly object[];
  /** a seat's body events this frame */
  body(seat: number): readonly object[];
  /** the arena's hazard and its moments this frame (hazards.ts; none in an arena without one) */
  hazard?(): Hazard | null;
  hazards?(): readonly object[];
  /** a seat's matter (its dress: the colour), and its chest (where its sounds are) */
  matter(seat: number): string;
  chest(seat: number): V3;
}

export class DuelSound {
  /** what played: cues by name, how many waited for the grid, the mean wait (ms), the dropped twins */
  readonly counts = { cues: {} as Record<string, number>, total: 0, snapped: 0, waitMs: 0, twins: 0, ignored: 0 };
  /** the set's big moments as heard: when, the music's beat then, whether they waited for the grid (the last 40) */
  readonly moments: { cue: DuelCue; t: number; beat: number; snapped: boolean; waitMs: number }[] = [];
  /** the names the map ignored, and how often */
  readonly unmapped: Record<string, number> = {};
  /** the old jogo effects fx.ts and power-fx.ts still ask for (dropped; `keepJogo` passes them on, for comparison) */
  keepJogo = false;
  jogoAsked = 0;
  private last = new Map<string, number>();
  private n = 0;
  private hazardSound = new HazardSound();
  /** the first time a cue played (s), for a rate a minute */
  private t0 = -1;
  private tLast = 0;

  constructor(readonly host: SoundHost, readonly src: DuelSource, readonly map: Record<string, Rule> = DUEL_SOUNDS, private jogoSfx?: (name: string, o: Record<string, unknown>) => void) {}

  /** the old effects' sounds (fx.ts, power-fx.ts): these cues replace them */
  jogo(name: string, o: Record<string, unknown>) { this.jogoAsked++; if (this.keepJogo) this.jogoSfx?.(name, o); }

  /** each frame, after the duel stepped: everything it made, heard */
  frame() {
    const S = this.src, reqs: CueReq[] = [];
    const take = (prefix: string, list: readonly object[], seat = -1) => {
      for (const x of list) {
        const e = x as Ev;
        const name = `${prefix}:${String(e.k ?? e.kind ?? e.type ?? '')}`;
        const rs = cuesOf(name, e, this.map);
        if (!rs.length && !(name in this.map)) { this.counts.ignored++; this.unmapped[name] = (this.unmapped[name] ?? 0) + 1; }
        for (const r of rs) reqs.push(seat >= 0 && (r.seat == null || r.seat < 0) ? { ...r, seat } : r);
      }
    };
    take('duel', S.events());
    take('touch', S.touches());
    take('power', S.powers());
    for (let k = 0; k < 2; k++) take('body', S.body(k), k);
    take('hazard', S.hazards?.() ?? []);
    const H = S.hazard?.();
    if (H) { const now = this.host.now(), spb = 60 / (this.host.clock.bpm || 112); reqs.push(...this.hazardSound.update(H, this.host.clock.beatAt(now), spb, midpoint(S.chest(0), S.chest(1)))); }
    if (!reqs.length) return 0;
    // one catch a moment (a touch and a power's catch, or a juice event's twin, in one frame): the strongest
    const best = new Map<number, CueReq>();
    for (const r of reqs) {
      const rank = CATCHES[r.cue];
      if (!rank) continue;
      const k = r.seat ?? -1, b = best.get(k);
      if (!b || rank > (CATCHES[b.cue] ?? 0)) best.set(k, r);
    }
    let played = 0;
    for (const r of reqs) {
      if (CATCHES[r.cue] && best.get(r.seat ?? -1) !== r) { this.counts.twins++; continue; }
      if (this.play(r)) played++;
    }
    return played;
  }

  /** a cue now: on the grid if it's near, in its seat's colour, where it happened */
  play(r: CueReq) {
    const H = this.host, now = H.now(), seat = r.seat ?? -1;
    const T = TIMING[r.cue];
    if (!T) return false;
    // (a twin: the same cue from the same seat within its gap; catches share one)
    // (a pair's tier or combo is its own moment beside the dancer's)
    const key = `${CATCHES[r.cue] ? 'catch' : r.cue}${r.big && (r.cue === 'tier' || r.cue === 'bank') ? '+pair' : ''}:${seat}`, last = this.last.get(key);
    if (last != null && now - last < (T.gap ?? 0.12)) { this.counts.twins++; return false; }
    this.last.set(key, now);
    const bpm = H.clock.bpm || 112, spb = 60 / bpm;
    const g = r.beat != null ? { t: now + Math.max(0, (r.beat - H.clock.beatAt(now)) * spb), snapped: false, wait: 0 }
      : T.grids.length ? onGrid(now, H.clock.beatAt(now), spb, T.grids, T.ahead, 0.025, H.clock.swing) : { t: now, snapped: false, wait: 0 };
    const S = this.src, k = seat >= 0 ? seat : 0;
    const at = r.at ?? (seat >= 0 ? S.chest(seat) : midpoint(S.chest(0), S.chest(1)));
    const L = H.listener;
    this.n++;
    const call: DuelCall = {
      cue: r.cue, matter: S.matter(k), other: r.other != null && r.other >= 0 && r.other !== k ? S.matter(r.other) : undefined,
      power: r.power, pan: panOf(L, at[0], at[1], at[2]), dist: distOf(L, at[0], at[1], at[2]),
      vel: Math.min(1.2, (r.vel ?? VEL[r.cue] ?? 0.8) * (r.perfect ? 1.1 : 1)), level: r.level ?? 1,
      on: r.on, big: r.big, perfect: r.perfect, dur: r.dur, H: H.harmony.at(g.t), spb, seed: frac(Math.sin(this.n * 12.9898 + k * 78.233) * 43758.5453),
    };
    H.out.duel(g.t, call);
    const c = this.counts;
    c.cues[r.cue] = (c.cues[r.cue] ?? 0) + 1; c.total++;
    if (g.snapped) { c.snapped++; c.waitMs += (g.wait * 1000 - c.waitMs) / c.snapped; }
    if (MOMENTS.has(r.cue)) { this.moments.push({ cue: r.cue, t: +g.t.toFixed(3), beat: +H.clock.beatAt(g.t).toFixed(3), snapped: g.snapped, waitMs: Math.round(g.wait * 1000) }); if (this.moments.length > 40) this.moments.shift(); }
    if (this.t0 < 0) this.t0 = now;
    this.tLast = now;
    return true;
  }

  stats() {
    const mins = Math.max(1 / 60, (this.tLast - this.t0) / 60);
    return { ...this.counts, cues: { ...this.counts.cues }, perMinute: +(this.counts.total / mins).toFixed(1), jogoAsked: this.jogoAsked, moments: [...this.moments], unmapped: { ...this.unmapped } };
  }
}

const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;
const MOMENTS = new Set<DuelCue>(['count', 'go', 'merge', 'finale', 'fusion', 'banner', 'tier', 'form', 'react']);
const midpoint = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const frac = (x: number) => x - Math.floor(x);

// ---------------------------------------------------------------- the music following the set
/** what SetMusic moves: the page's Music */
export interface MusicLike {
  engine: {
    clock: { beatAt(t: number): number; anchor(t: number, beats: number, from?: number): void; readonly bpm: number; readonly sync: unknown };
    track: TrackInfo | null; trackAt: number; trackBeat0: number; setTrack(t: TrackInfo | null, now?: boolean): void;
    harmony: { setChord(i: number, t: number): void };
    /** a mirror crossing's bridge to another track (engine.ts crossTo) */
    crossTo?(t: TrackInfo, bar: number): { tB: number; tC: number; kB: number; kC: number; nb: number; rA: number; rB: number } | null;
  };
  deck: { stop(fade?: number): void } | null;
  live: { ctx: { state: string } } | null;
  loader: { want(t: TrackInfo): unknown } | null;
  trackFixed: boolean;
  now(): number;
}

/** the duel's balance under a world's track (synth/mix.ts UNDER, each × the bus's level without a track): the moments
 *  and the movement up from the jogo's levels (measured at those, a catch peaked 2 dB over the music's rms and a
 *  landing 20 dB under it: unheard). Report 14-sound set these for the game's sounds 4 to 8 LU under the track, a catch's
 *  peak 5 to 7 dB over the track's rms, but its measure left out the master's compressor, whose automatic make-up gain
 *  lifts everything under its threshold by 4.9 dB (Web Audio's DynamicsCompressorNode; measured in Chrome, report 17):
 *  the duel's sounds came out level with the track, in the page and in the films alike. `all` (the game's whole bus,
 *  0.2 in UNDER) takes those 4.9 dB back off in the duel, so the balance is the one report 14 chose. The matter voices
 *  (the world's bus) keep the jogo's level under it */
export const DUEL_BALANCE: Partial<UnderLevels> = { all: 0.114, duel: 2.6, motion: 3.4 };

// ---------------------------------------------------------------- joined to the page (src/duel/index.ts)
/** what duelSound reads of bend.duel (index.ts's api), lazily: it is made just before it */
interface DuelApiLike {
  events(): readonly object[];
  now(): number;
  readonly state: { since: number; countMs: number; phase: string };
  match: { touches: readonly object[]; bodyEvents: readonly (readonly object[])[]; chars: readonly { root: ArrayLike<number> }[] };
  powers: { fx: readonly object[]; rules: { seats: readonly { matter: string }[] } };
  hazards?: { hazard: Hazard | null; fx: readonly object[] };
}
export interface DuelSoundOptions {
  frame: { tick(phase: 'audio', fn: () => void, what: string): void };
  music: MusicLike & { engine: MusicLike['engine'] & { out: Instrument; harmony: { at(t: number): Harm } }; sfx(name: never, o: never): unknown };
  listener: Listener;
  film: boolean;
  world: () => string;
  duel: () => DuelApiLike;
  /** start the sound (the show awake, the music's AudioContext): the duel's own `begin` does it; so does the page's
   *  first gesture, inside it, before any seat has joined (a click on a waiting seat, a key no layout knows) */
  wake?: () => void;
}

/** the duel's sound on the page: the cues each frame (the 'audio' phase, after the duel stepped and before the music's
 *  scheduler runs), the track following the set. Returns the DuelSound with `music` (the SetMusic) on it */
export function duelSound(o: DuelSoundOptions) {
  const M = o.music, E = M.engine;
  let seen: readonly object[] | null = null;
  const D = () => o.duel();
  const src: DuelSource = {
    events: () => D().events(),
    touches: () => D().match.touches,
    powers: () => D().powers.fx,
    body: (k) => D().match.bodyEvents[k] ?? [],
    matter: (k) => D().powers.rules.seats[k]?.matter ?? 'water',
    chest: (k) => { const r = D().match.chars[k]?.root ?? [0, 0, 0]; return [r[0], r[1] + 1.1, r[2]]; },
    hazard: () => D().hazards?.hazard ?? null,
    hazards: () => D().hazards?.fx ?? [],
  };
  const host: SoundHost = { out: E.out, now: () => M.now(), clock: E.clock as unknown as SoundHost['clock'], harmony: E.harmony, listener: o.listener };
  const sound = new DuelSound(host, src, DUEL_SOUNDS, (name, x) => (M.sfx as unknown as (n: string, x: unknown) => void)(name, x)) as DuelSound & { music: SetMusic; cross: (world: string, energy: number) => ReturnType<SetMusic["cross"]> };
  const music = sound.music = new SetMusic(M, o.world, o.film);
  // through a mirror (phase 6): the new world's track on the next beat (SetMusic.cross), and the crossing's chime on
  // that beat in the new track's key, in both dancers' colours. Returns the bridge (or null: a film, a room's clock)
  sound.cross = (world: string, energy: number) => {
    const B = music.cross(world, energy, D().now());
    const T = trackFor(world);
    if (!B || !T) return B;
    const mood = trackMood(T), H: Harm = { mood, chord: mood.chords[trackChord(T, B.nb)] ?? mood.chords[0] };
    const call: DuelCall = { cue: 'cross', matter: src.matter(0), other: src.matter(1), pan: 0, dist: 0.2, vel: 0.95, level: 1, H, spb: 60 / T.bpm, seed: frac(B.tB * 7.13) };
    E.out.duel(B.tB, call);
    sound.counts.cues.cross = (sound.counts.cues.cross ?? 0) + 1; sound.counts.total++;
    sound.moments.push({ cue: 'cross', t: +B.tB.toFixed(3), beat: +E.clock.beatAt(B.tB).toFixed(3), snapped: true, waitMs: Math.round((B.tB - M.now()) * 1000) });
    return B;
  };
  let balanced: unknown;
  // (any first gesture starts the sound inside it: a context made there runs at once, Safari's and iOS's included;
  // one made outside a gesture, as the bots' duel makes it at load, waits for Live's own wake on the next gesture)
  if (o.wake && !o.film && typeof addEventListener === 'function') {
    const first = () => { for (const ev of GESTURES) removeEventListener(ev, first, { capture: true }); if (!M.live) o.wake!(); };
    for (const ev of GESTURES) addEventListener(ev, first, { capture: true, passive: true });
  }
  o.frame.tick('audio', () => {
    // the duel's balance, once the sound has started (after Music.start's own) or for a film's recorder at once
    if (balanced !== M.live && E.track) { balanced = M.live; E.out.under(M.now(), 1, DUEL_BALANCE); }
    const d = D(), ev = d.events();
    // (only a frame the duel stepped: before it starts, its lists stand still)
    if (ev === seen) return;
    seen = ev;
    for (const e of ev as readonly Ev[]) if (e.k === 'set') music.set(d.now(), d.state.since, d.state.countMs);
    music.follow(d.now(), d.state.phase);
    sound.frame();
  }, 'duel: its sound (sound.ts)');
  return sound;
}

/** the track placed under the set: its "go" on a phrase's downbeat, following the set's clock */
export class SetMusic {
  /** where the set is on the track: its "go" (duel ms) is this beat since the track's bar 1 */
  plan: { goMs: number; beat: number } | null = null;
  readonly counts = { sets: 0, placed: 0, follows: 0, lastDriftBeats: 0, nudgedMs: 0, crossed: 0 };
  /** how far the music is ahead of the set (ms, the last frame's) */
  private driftMs = 0;
  /** how much faster the set's clock may run to catch the music up (its own holds and hitches made up unheard). The
   *  weight's holds (src/duel/weight.ts: a catch's few frames, a pair tier's beat of slow motion) hold the set's clock
   *  with the bodies, 3 to 5 s a set (measured): 12 % makes that up within the set, so its finale lands near its line */
  slew = 0.12;
  /** a drift past this (beats) puts the music back where the set is: in play (and the finale) only a big one (a
   *  context woken late, a tab back: the deck crossfades half a second), in the count-in and the banner a small one */
  driftBeats = { play: 2, between: 0.12 };

  constructor(private music: MusicLike, private world: () => string, private film: boolean) {}

  private get on() { const E = this.music.engine; return !this.film && !this.music.trackFixed && !E.clock.sync && !!E.track; }

  /** a set's count-in began (its 'set' event) at duel time `nowMs`; its "go" is COUNT_FROM counts of `countMs` later */
  set(nowMs: number, sinceMs: number, countMs: number) {
    const M = this.music, E = M.engine;
    // the world's own track, at once (a world change pending on the next bar line would move the clock's origin)
    const tr = trackFor(this.world());
    if (!this.film && !M.trackFixed && !E.clock.sync && tr && E.track?.id !== tr.id) { E.setTrack(tr, true); void M.loader?.want(tr); }
    if (!this.on) return;
    const goMs = sinceMs + DUEL.COUNT_FROM * countMs;
    const tGo = M.now() + (goMs - nowMs) / 1000, nat = E.clock.beatAt(tGo) - E.trackBeat0;
    const beat = this.plan ? phraseLine(nat, E.track!) : 0;
    this.plan = { goMs, beat };
    this.counts.sets++;
    this.place(nowMs);
  }

  /** through a mirror (phase 6, report 20-crossing): the new world's track comes in on the next beat (Engine.crossTo:
   *  the tempo bent across over the bar), not on the bar line after the main view goes over, and not at its quiet bar
   *  1: at the phrase of its body whose loudness matches where the old track was (and the set's energy). The set's
   *  place on the track moves with it. Null where the set doesn't place the track (a film, a room's clock), or for the
   *  same track */
  cross(world: string, energy: number, nowMs: number) {
    const M = this.music, E = M.engine, to = trackFor(world), from = E.track;
    // (a film whose mirrors are open, its track not fixed, crosses as play does: the clock bends and the chime plays in
    // its score, and film.mjs lays the two tracks from the bridge info.json records; report 23)
    const film = this.film && !M.trackFixed && !E.clock.sync;
    if (!(this.on || film) || !to || !from || from.id === to.id || !E.crossTo) return null;
    const t = M.now();
    const bar = entryBar(from, trackBar(from, E.clock.beatAt(t) - E.trackBeat0), to, energy);
    const B = E.crossTo(to, bar);
    if (!B) return null;
    void M.loader?.want(to);
    // (the set's place: from the bridge's end, on the new track's own tempo)
    this.plan = { goMs: nowMs + (B.tC - t) * 1000, beat: B.nb + (B.kC - B.kB) / 4 };
    this.quietUntil = B.tC + 0.1;
    this.driftMs = 0;
    this.counts.crossed++;
    return B;
  }
  /** the music time until which the set leaves the track alone (a crossing's bridge under way) */
  private quietUntil = -Infinity;

  /** each frame: put the track back where the set is if they drifted apart (not while the context is suspended) */
  follow(nowMs: number, phase = 'play') {
    const M = this.music;
    if (!this.plan || !this.on || !M.live || M.live.ctx.state !== 'running' || M.now() < this.quietUntil) return;
    const E = M.engine, spb = 60 / E.clock.bpm, t = M.now();
    const want = this.plan.beat + (nowMs - this.plan.goMs) / 1000 / spb, is = E.clock.beatAt(t) - E.trackBeat0;
    this.counts.lastDriftBeats = is - want;
    this.driftMs = (is - want) * spb * 1000;
    const most = phase === 'intro' || phase === 'done' ? this.driftBeats.between : this.driftBeats.play;
    if (Math.abs(is - want) > most) { this.counts.follows++; this.place(nowMs); }
  }

  /** what to add to the set's clock this frame (ms; index.ts adds it to the duel's `now`): the drift made up a few
   *  percent at a time, so the finale lands near its line. Not while the set is held or slowed on purpose (the weight's
   *  hit-stop, slow motion: its dance time runs slower than the frame's): it catches up after */
  nudge(dt: number, danceDt: number) {
    const M = this.music;
    if (!this.plan || !this.on || !M.live || M.live.ctx.state !== 'running' || dt <= 0 || M.now() < this.quietUntil) return 0;
    if (Math.abs(danceDt - dt) > 0.03 * dt) return 0;
    const cap = this.slew * danceDt * 1000, n = Math.max(-cap, Math.min(cap, this.driftMs));
    this.driftMs -= n;
    this.counts.nudgedMs += n;
    return n;
  }

  private place(nowMs: number) {
    const M = this.music, E = M.engine, T = E.track!, spb = 60 / E.clock.bpm, t = M.now();
    const beat = this.plan!.beat + (nowMs - this.plan!.goMs) / 1000 / spb;
    E.clock.anchor(t, beat + E.trackBeat0, t);
    // before the file begins (the first set's count-in): the deck starts it on its first sample, crisply, on time
    const file0 = t - beat * spb - T.downbeat;
    if (file0 > t) { M.deck?.stop(0.4); E.trackAt = file0; }
    E.harmony.setChord(trackChord(T, Math.max(0, beat)), t);
    this.driftMs = 0;
    this.counts.placed++;
  }
}
