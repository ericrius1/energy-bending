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
import { trackChord, trackFor, type TrackInfo } from '../audio/track';
import { DUEL } from '../../shared/duel.ts';

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
};

// ---------------------------------------------------------------- the map
/** what an event asks to hear: a cue, whose it is, where, how hard */
export interface CueReq {
  cue: DuelCue;
  /** the seat it is (its matter's colour, where it is heard); -1 or absent: the pair's */
  seat?: number; other?: number;
  at?: V3 | null; vel?: number; level?: number; power?: string; on?: boolean; big?: boolean; perfect?: boolean; dur?: number;
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
  // ---- phase 3's juice events (the rules' names as the other work lands them: aliases of the cues above; a frame's
  // or a moment's twin of a touch is dropped by the cue's gap)
  'duel:pairTier': (e) => ({ cue: 'tier', seat: seatOf(e) >= 0 ? seatOf(e) : 0, other: 1, level: num(e.tier, 1) }),
  'duel:pair-tier': (e) => ({ cue: 'tier', seat: seatOf(e) >= 0 ? seatOf(e) : 0, other: 1, level: num(e.tier, 1) }),
  'duel:catch': (e) => ({ cue: e.kind === 'range' || e.how === 'range' ? 'range' : e.kind === 'aerial' || e.air ? 'aerial' : 'catch', seat: seatOf(e), other: num(e.other, -1), at: v3(e.at) }),
  'duel:release': (e) => ({ cue: 'fling', seat: seatOf(e), other: num(e.other, -1), at: v3(e.at) }),
  'duel:hold': (e) => ({ cue: 'lift', seat: seatOf(e) >= 0 ? seatOf(e) : 0, other: 1, at: v3(e.at) }),
  'duel:finaleHold': (e) => ({ cue: 'lift', seat: seatOf(e) >= 0 ? seatOf(e) : 0, other: 1, at: v3(e.at) }),
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

// ---------------------------------------------------------------- the set's length on the music
/** a set's length (ms) as whole phrases (`bars`, 4) of the track nearest the length asked, so a set that begins on a
 *  phrase line ends on one (the finale on the music's line). Pure */
export function phraseSetMs(askedMs: number, bpm: number, bars = 4) {
  const phrase = (bars * 240000) / Math.max(40, bpm);
  return Math.max(1, Math.round(askedMs / phrase)) * phrase;
}
/** the phrase line (beats since bar 1) nearest `beat`: every 4 bars from bar 1 before the track's loop, every 4 bars
 *  from the loop's start inside it (the loop's length is whole phrases, so the lines hold round it). Pure */
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
    const key = `${CATCHES[r.cue] ? 'catch' : r.cue}:${seat}`, last = this.last.get(key);
    if (last != null && now - last < (T.gap ?? 0.12)) { this.counts.twins++; return false; }
    this.last.set(key, now);
    const bpm = H.clock.bpm || 112, spb = 60 / bpm;
    const g = T.grids.length ? onGrid(now, H.clock.beatAt(now), spb, T.grids, T.ahead, 0.025, H.clock.swing) : { t: now, snapped: false, wait: 0 };
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
  };
  deck: { stop(fade?: number): void } | null;
  live: { ctx: { state: string } } | null;
  loader: { want(t: TrackInfo): unknown } | null;
  trackFixed: boolean;
  now(): number;
}

/** the duel's balance under a world's track (synth/mix.ts UNDER, each × the bus's level without a track): the moments
 *  and the movement up from the jogo's levels (measured, a catch peaked 2 dB over the music's rms and a landing 20 dB
 *  under it: unheard), the matter voices (fire's roar, water's pour: the world's bus) up 4 dB. docs/reports/14-sound.md */
export const DUEL_BALANCE: Partial<UnderLevels> = { world: 0.95, duel: 3.6, motion: 3.4 };

// ---------------------------------------------------------------- joined to the page (src/duel/index.ts)
/** what duelSound reads of bend.duel (index.ts's api), lazily: it is made just before it */
interface DuelApiLike {
  events(): readonly object[];
  now(): number;
  readonly state: { since: number; countMs: number; phase: string };
  match: { touches: readonly object[]; bodyEvents: readonly (readonly object[])[]; chars: readonly { root: ArrayLike<number> }[] };
  powers: { fx: readonly object[]; rules: { seats: readonly { matter: string }[] } };
}
export interface DuelSoundOptions {
  frame: { tick(phase: 'audio', fn: () => void, what: string): void };
  music: MusicLike & { engine: MusicLike['engine'] & { out: Instrument; harmony: { at(t: number): Harm } }; sfx(name: never, o: never): unknown };
  listener: Listener;
  film: boolean;
  world: () => string;
  duel: () => DuelApiLike;
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
  };
  const host: SoundHost = { out: E.out, now: () => M.now(), clock: E.clock as unknown as SoundHost['clock'], harmony: E.harmony, listener: o.listener };
  const sound = new DuelSound(host, src, DUEL_SOUNDS, (name, x) => (M.sfx as unknown as (n: string, x: unknown) => void)(name, x)) as DuelSound & { music: SetMusic };
  const music = sound.music = new SetMusic(M, o.world, o.film);
  let balanced: unknown;
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
  readonly counts = { sets: 0, placed: 0, follows: 0, lastDriftBeats: 0, nudgedMs: 0, slowedMs: 0 };
  /** how far the music is ahead of the set (ms, the last frame's), and the set's own pause not yet given up (ms) */
  private driftMs = 0;
  private paused = 0;
  /** the set's clock may run this much faster or slower to keep with the music (a frame's hitch made up unheard) */
  slew = 0.04;
  /** a drift past this (beats) puts the music back where the set is: in play (and the finale) only a big one (a
   *  context woken late, a tab back: the deck crossfades half a second), in the count-in and the banner a small one
   *  (a hitch's frames lost by the set's clock: the finale then still lands on its line) */
  driftBeats = { play: 0.5, between: 0.06 };

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

  /** each frame: put the track back where the set is if they drifted apart (not while the context is suspended) */
  follow(nowMs: number, phase = 'play') {
    const M = this.music;
    if (!this.plan || !this.on || !M.live || M.live.ctx.state !== 'running') return;
    const E = M.engine, spb = 60 / E.clock.bpm, t = M.now();
    const want = this.plan.beat + (nowMs - this.plan.goMs) / 1000 / spb, is = E.clock.beatAt(t) - E.trackBeat0;
    this.counts.lastDriftBeats = is - want;
    this.driftMs = (is - want) * spb * 1000;
    const most = phase === 'intro' || phase === 'done' ? this.driftBeats.between : this.driftBeats.play;
    if (Math.abs(is - want) > most) { this.counts.follows++; this.place(nowMs); }
  }

  /** what to add to the set's clock this frame (ms; index.ts adds it to the duel's `now`): a hitch's lost frames made up
   *  a few percent at a time, so the finale lands on its line. A set slowed or held on purpose (a hit-stop, slow
   *  motion: its dance time runs slower than the frame's) is not pulled back: a short hold is made up, a long one moves
   *  the plan (the set lands that much later on the music, until the next set's count-in) */
  nudge(dt: number, danceDt: number) {
    const M = this.music;
    if (!this.plan || !this.on || !M.live || M.live.ctx.state !== 'running' || dt <= 0) return 0;
    if (Math.abs(danceDt - dt) > 0.03 * dt) {
      this.paused += (dt - danceDt) * 1000;
      if (Math.abs(this.paused) > 250) { this.plan.goMs -= this.paused; this.counts.slowedMs += this.paused; this.driftMs -= this.paused; this.paused = 0; }
      return 0;
    }
    this.paused = 0;
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
