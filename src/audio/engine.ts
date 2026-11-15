// The music engine: the prototype's generative groove (js/audio.js), deciding what plays on each 16th. The clock
// (clock.ts) hands it every step whose time has come within a short lookahead; for each it moves the harmony on a
// bar line, picks the level from how much the players are dancing, and plays the drums, the bass, the pad's colour,
// the arps, the roda's toque, the tension layer, the fusion's texture and the dancers' notes, all through an
// Instrument (instrument.ts), so the same decisions sound live or are written down for a film.
//
// Levels: 0 is Gem Dancers' ambient, beat-less mode (the slow chord bed under the stones: no drums, a chord every four
// bars); 1 a light pulse; 2 the groove; 3 busier; 4 the peak after a drop. Up a level as soon as the intensity is
// there, down one only after two quiet bars. drop() sucks the music down and lands the peak on a beat; fusion(kind)
// is a drop that holds one of four textures for eight bars; release() goes back to the groove. Moods change on a bar
// line (a portal crossing), the tempo gliding to the new one. Randomness is seeded: the same inputs, the same music.
//
// With a world's track (setTrack: a Suno instrumental, audio/track.ts) the track is the music: the clock runs at its
// tempo with its bar 1 on beat 0 (a new world's track starts on a bar line, the clock's origin moved there), the
// harmony is its key and each bar its chord, and none of the groove sounds (no drums, bass, pad, arps, toque, tension
// or fusion textures). What is left plays on its grid: the dancers' notes, the jogo's sounds, the drop's sweep and hit.
import { mulberry32 } from 'math/random';
import { MusicClock, type StepHost, type Sync } from './clock';
import { Harmony, near, notes, pc, MOODS, type Harm } from './harmony';
import { FUSIONS, SFX, type Instrument, type FusionKind, type SfxName, type Element } from './instrument';
import type { Tone, Room } from './sound';
import { trackMood, trackChord, trackPos, type TrackInfo } from './track';
import { defineParams } from '../engine/params';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export const grooveParams = defineParams('groove', {
  /** -1: the level follows the players' dancing; 0 … 4: hold it there */
  level: -1,
  /** bars a chord lasts at level 0 (Gem Dancers' bed changed every 12 s; four bars of Ember is 8.6 s) */
  ambientBars: 4,
  /** how often the fire bed crackles (0 … 1; the geode has its own hearth, so off) */
  fireAmount: 0,
  /** the groove's loudness under everything else (× the drums, bass and leads) */
  grooveGain: 1,
}, { level: { min: -1, max: 4, step: 1 }, ambientBars: { min: 1, max: 8, step: 1 }, fireAmount: { min: 0, max: 1 }, grooveGain: { min: 0, max: 1.5 } });

/** something that plays on the grid (the player's melody): told every step it is due */
export interface Performer { onStep(rel: number, s16: number, t: number): void }

export interface SfxOptions {
  element?: Element; perfect?: boolean; pan?: number; dist?: number; vel?: number; at?: number;
  move?: string; count?: number; final?: boolean; dur?: number;
}

export interface MusicEvent { t: number; type: string; [k: string]: unknown }

interface Fusion { kind: FusionKind; start: number; end: number; relStart: number }

export class Engine implements StepHost {
  readonly clock: MusicClock;
  readonly harmony = new Harmony(0);
  /** how much the players are dancing, 0 … 1 (the conductor sets it) */
  intensity = 0;
  level = 0;
  /** filter openness 0 … 1 (arms up), hip sway -1 … 1 (colours the bass) */
  bright = 0.3;
  sway = 0;
  /** the shared tension 0 … 1 (the jogo), heard as a rising layer */
  tension = 0;
  /** the two-player groove: a berimbau figure in every mood */
  jogo = false;
  /** how lit up the dancers are (Gem Dancers' energy, 0 … 1): it opens the bed at level 0 */
  bedEnergy = 0;
  /** the bed's sub under the root (the world's depth) */
  depth = 0.5;
  /** events for the visuals ({ t, type }: step, bar, kick, chord, level, drop, fusion …), polled by time */
  events: MusicEvent[] = [];
  performers: Performer[] = [];
  /** the world's track, when the track is the music (null: the generative groove) */
  track: TrackInfo | null = null;
  /** when (on the clock everything is scheduled on) the current track began to be the music */
  trackAt = 0;
  /** the beat on the clock that is the track's bar 1 (0 in the game; a film puts its shot on the film's track) */
  trackBeat0 = 0;
  /** a mirror crossing's bridge (phase 6, crossTo): the old track's tempo bent toward the new one's from now (step
   *  kA, time tA) to the next beat (kB, tB), where the new track comes in at its beat `nb` (since its bar 1: its
   *  place in the file `pos`) bent toward the old one's, and eased to its own tempo by the bar after (kC, tC). The old
   *  track plays at `rA` of its rate by tB and fades; the new starts at `rB` and is at 1 by tC. The deck reads it */
  bridge: { from: TrackInfo | null; to: TrackInfo; kA: number; kB: number; kC: number; tA: number; tB: number; tC: number; rA: number; rB: number; nb: number; pos: number; done: boolean } | null = null;
  /** a track waiting for the next bar line (free) or the shared clock's next jump (synced); undefined: none */
  private pendingTrack: TrackInfo | null | undefined = undefined;
  private bed = false;
  private padKey = '';
  private padCut = 0;
  private padLvl = 0;
  private peakUntil = -1;
  private dropStep = -1;
  private dropTime = 0;
  private lastDropRel = -999;
  private lowBars = 0;
  /** the last bar the groove played (a level-0 breakdown after it twinkles; a world that never grooved stays still) */
  private lastGrooveBar = -999;
  private pendingMood: number | null = null;
  private pendingKey: number | null = null;
  private pendingPlace: { tone: Tone; room: Room; grooveWet: number } | null = null;
  private pendingFusion: FusionKind | null = null;
  private fus: Fusion | null = null;
  private tensionOn = false;
  private rng = mulberry32.create(1009);
  private r = () => mulberry32.sample(this.rng);

  constructor(public out: Instrument, readonly time: () => number, mood = 0, bpm?: number) {
    this.harmony.setMood(mood);
    this.clock = new MusicClock(bpm ?? MOODS[mood].bpm, 0);
    this.clock.swing = this.harmony.mood.swing;
  }

  get mood() { return this.harmony.mood; }
  get chord() { return this.harmony.chord; }
  get stepDur() { return this.clock.stepDur; }
  get fusionKind() { return this.fus?.kind ?? null; }
  /** stones and matter go on the grid: under a track always, once its grid is known (a film's jogo learns it when play
   *  begins: until then they play free, not on a grid the track doesn't have); otherwise while the groove runs (level
   *  1 or more, or a fusion) */
  get grooving() { return this.track ? Number.isFinite(this.trackBeat0) : this.level >= 1 || !!this.fus; }

  /** the bed comes in at t (the first touch; a film's prelude) */
  begin(t: number) {
    if (this.bed) return;
    this.bed = true;
    const rel = this.clock.step - this.clock.origin;
    this.harmony.setChord(this.track ? trackChord(this.track, rel / 4 - this.trackBeat0) : this.chordFor(Math.floor(rel / 16), 0), t);
    this.padNow(t, 2.4);
  }

  /** schedule everything due before `until` (call often: every frame, and live from a timer too) */
  tick(cur: number, until: number) { this.clock.advance(cur, until, this); }

  // ---------------------------------------------------------------- the track
  /** the track that is the music (null: back to the groove). `now`: at once (the clock's tempo set, its origin left
   *  alone: anchor it yourself); otherwise free, on the next bar line, which becomes its bar 1; synced, when the shared
   *  clock next jumps (a room's new epoch is the new track's bar 1) */
  setTrack(t: TrackInfo | null, now = false) {
    if (now) { this.pendingTrack = undefined; this.useTrack(t, this.time()); return; }
    if ((this.pendingTrack === undefined ? this.track : this.pendingTrack)?.id === t?.id) return;
    // (the track a crossing's bridge is bringing in: it comes on its beat, not again on a bar line)
    if (t && this.bridge && this.bridge.to.id === t.id) return;
    // (back to the track playing before the bar line came (a mirror crossed and crossed back within a bar): it plays on,
    // not started again from its bar 1)
    if (this.pendingTrack !== undefined && this.track?.id === t?.id) { this.pendingTrack = undefined; return; }
    this.pendingTrack = t;
  }

  private useTrack(t: TrackInfo | null, at: number) {
    this.track = t;
    this.trackAt = at;
    if (!t) { this.harmony.setMood(this.harmony.moodIndex, 0); this.clock.swing = this.harmony.mood.swing; return; }
    this.harmony.setCustom(trackMood(t));
    this.clock.swing = t.swing;
    if (!this.clock.sync && !this.clock.glides.length) this.clock.bpm = this.clock.targetBpm = t.bpm;
    this.padKey = '';
  }

  /** through a mirror (phase 6, report 20-crossing): the new world's track comes in on the next beat (at least a 16th
   *  from now), at its bar `bar` (a phrase whose energy matches: SetMusic.cross chooses it) and the same beat of the
   *  bar as the clock's, so the bar lines go on where they were. The tempo is bridged rather than jumped: from now to
   *  that beat the clock (and the old track, as the deck plays it) bends toward the geometric mean of the two tempi, at
   *  most `bendOut` of its own; the new track comes in at most `bendIn` off its own tempo toward it and eases onto its
   *  own over `bars`. The free clock only (a room's shared clock says for itself). Returns the bridge */
  crossTo(t: TrackInfo, bar: number, o: { bendOut?: number; bendIn?: number; bars?: number; lead?: number } = {}) {
    const c = this.clock;
    if (c.sync) { this.setTrack(t); return null; }
    const from = this.track, cur = this.time();
    const bendOut = o.bendOut ?? 0.1, bendIn = o.bendIn ?? 0.06, steps = Math.round((o.bars ?? 1.5) * 16);
    // (a bridge already under way: what it has bent stays bent, the next one goes on from the tempo now)
    c.glides = [];
    // the next beat at least `lead` s off (a step's worth at the least: the scheduler has handed out up to c.step - 1)
    const lead = o.lead ?? 0.2;
    let kB = c.step;
    while (((((kB - c.origin) % 4) + 4) % 4) !== 0 || c.stepTime(kB) < cur + lead || kB < c.step + 1) kB++;
    const kA = c.step, b0 = c.bpm, M = Math.sqrt(b0 * t.bpm);
    const rA = Math.max(1 - bendOut, Math.min(1 + bendOut, M / b0)), rB = Math.max(1 - bendIn, Math.min(1 + bendIn, M / t.bpm));
    const kC = kB + steps;
    if (kB > kA) c.glides.push({ k0: kA, k1: kB, b0, b1: b0 * rA });
    c.glides.push({ k0: kB, k1: kC, b0: t.bpm * rB, b1: t.bpm });
    const tA = c.stepTime(kA), tB = c.timeOfStep(kB), tC = c.timeOfStep(kC);
    // (the beat of the bar the clock is on there: the new track's place keeps it, so its bar lines are the clock's)
    const j = (((kB - c.origin) / 4) % 4 + 4) % 4, nb = bar * 4 + j;
    this.pendingTrack = undefined;
    this.bridge = { from, to: t, kA, kB, kC, tA, tB, tC, rA: kB > kA ? rA : 1, rB, nb, pos: trackPos(t, nb), done: false };
    this.events.push({ t: cur, type: 'bridge', to: t.id, at: tB, bar, rA, rB });
    return this.bridge;
  }

  // ---------------------------------------------------------------- the place and the harmony
  /** a new world's sound, from the next bar line: its mood (the tempo glides there), its tone and its room */
  setPlace(moodIdx: number, tone: Tone, room: Room, grooveWet: number, now = false) {
    if (now) {
      this.harmony.setMood(moodIdx);
      if (this.track) this.harmony.setCustom(trackMood(this.track));
      else {
        this.clock.swing = this.harmony.mood.swing;
        if (!this.clock.sync) this.clock.bpm = this.clock.targetBpm = this.harmony.mood.bpm;
      }
      this.depth = tone.depth;
      const t = this.time();
      this.out.tone(t, tone);
      this.out.room(t, room, 0.01, grooveWet);
      return;
    }
    if (moodIdx !== this.harmony.moodIndex) this.pendingMood = moodIdx;
    this.pendingPlace = { tone, room, grooveWet };
  }

  /** the tone alone, now (a world's tunable changed) */
  retone(tone: Tone) { this.depth = tone.depth; this.out.tone(this.time(), tone); }

  /** a new piece: move the mood to this key (midi) from the next bar line */
  setKey(key: number) { this.pendingKey = this.harmony.transposeFor(key); }

  /** a mood by index, from the next bar line */
  setMood(i: number) { this.pendingMood = ((i % MOODS.length) + MOODS.length) % MOODS.length; }

  private chordFor(bar: number, L: number) {
    if (clamp(this.tension, 0, 1) >= 0.85 && !this.fus) return 3; // near full tension it holds on the turnaround
    const per = L <= 0 && !this.fus ? Math.max(1, grooveParams.ambientBars) : 1;
    return ((Math.floor(bar / per) % 4) + 4) % 4;
  }

  private padNow(t: number, swell: number) {
    if (this.track) return;
    const ch = this.harmony.chord, key = `${this.harmony.moodIndex}.${this.harmony.transpose}.${ch.pad.join(',')}`;
    if (key === this.padKey) return;
    this.padKey = key;
    // the sub on the chord's root around 55-100 Hz, where Gem Dancers' bed had it (measured: an octave higher, the
    // ambient bed lost 19 dB below 60 Hz against the foundation's)
    this.out.pad(t, ch.pad, swell, near(pc(ch.bass), 38));
  }

  // ---------------------------------------------------------------- one step
  step(rel: number, t: number) {
    const o = this.out, c = this.clock;
    // a crossing's bridge: the new track from this beat, at its place (its bar lines on the clock's)
    const Bx = this.bridge;
    if (Bx && !Bx.done && c.step >= Bx.kB) {
      Bx.done = true;
      this.useTrack(Bx.to, Bx.tB);
      this.trackBeat0 = rel / 4 - Bx.nb;
      this.harmony.setChord(trackChord(Bx.to, Bx.nb), t);
      this.events.push({ t, type: 'track', id: Bx.to.id, bridge: true });
    }
    if (this.dropStep >= 0 && c.step >= this.dropStep) {
      // solo: re-base the bar so the drop lands on beat one; synced (or on a track): it is on a bar line already
      if (!c.synced && !this.track) { c.origin = c.step; rel = 0; }
      this.dropStep = -1;
      this.level = 4; this.peakUntil = rel + 16 * 8; this.lastDropRel = rel;
      this.impact(t);
      o.crash(t, 0.5);
      if (this.pendingFusion != null) {
        const kind = this.pendingFusion; this.pendingFusion = null;
        o.fusionOn(t, kind);
        this.fus = { kind, start: rel, end: rel + 16 * 8, relStart: -1 };
        o.fusionHit(t, kind, this.harmony.at(t));
        this.events.push({ t, type: 'fusion', kind });
      }
      this.events.push({ t, type: 'drop' });
    }
    const s16 = ((rel % 16) + 16) % 16;
    const bar = Math.floor(rel / 16);
    const inSuck = this.dropStep >= 0;

    // fusion: 8 bars, then (or on release()) one bar fading back to the groove
    let F = this.fus, fm = 0;
    if (F) {
      if (F.relStart < 0 && rel >= F.end) { F.relStart = rel; o.fusionFade(t, c.stepDur * 16 / 3.5); }
      fm = F.relStart < 0 ? 1 : 1 - (rel - F.relStart) / 16;
      if (fm <= 0) {
        this.fus = F = null; fm = 0; this.level = Math.min(this.level, 3);
        this.events.push({ t, type: 'fusionEnd' });
      }
    }
    const fus = F && !inSuck ? F.kind : null;
    const T = clamp(this.tension || 0, 0, 1);

    if (s16 === 0) this.barLine(bar, t);
    if (this.track) {
      // the track is the music: no groove; the level still follows the players (the partner reads it)
      if (s16 % 8 === 0 && !inSuck) this.updateLevel(rel, s16, t);
      if (!inSuck) for (const p of this.performers) p.onStep(rel, s16, t);
      this.events.push({ t, type: 'step', s16, bar, level: this.level });
      if (this.events.length > 256) this.events.splice(0, this.events.length - 256);
      return;
    }
    if (s16 % 8 === 0 && !inSuck) this.updateLevel(rel, s16, t);

    const L = inSuck ? -1 : this.level;
    if (L >= 1 || fus) this.lastGrooveBar = bar;
    const ch = this.harmony.chord, H = this.harmony.at(t), mood = this.harmony.mood;
    const g = grooveParams.grooveGain;

    // ---- drums
    let kick = false;
    if (fus && fm >= 0.5) kick = this.fusionDrums(fus, s16, Math.floor((rel - F!.start) / 16), t);
    else if (mood.capo) kick = this.rodaDrums(s16, bar, t, L);
    else if (L === 1) {
      if (s16 === 0 || s16 === 8) { o.kick(t, 0.62 * g); kick = true; }
      if (s16 % 4 === 2) o.hat(t, 0.16 * g, false);
    } else if (L >= 2) {
      if (s16 % 4 === 0) { o.kick(t, 0.95 * g); kick = true; }
      if (s16 === 4 || s16 === 12) o.clap(t, (L >= 3 ? 0.62 : 0.5) * g);
      if (s16 % 4 === 2) o.hat(t, (L >= 3 ? 0.4 : 0.32) * g, L >= 3);
      if (L >= 3) {
        if (s16 % 2 === 1) o.hat(t, (0.12 + 0.08 * this.r()) * g, false);
        if (s16 % 4 === 0) o.hat(t, 0.14 * g, false);
        if (s16 === 15 && this.r() < 0.3) o.kick(t, 0.55 * g);
        if (s16 === 11 && this.r() < 0.25) o.clap(t, 0.22 * g);
      } else if (s16 % 2 === 1 && this.r() < 0.5) o.hat(t, 0.08 * g, false);
      if (L >= 4 && s16 === 0 && bar % 4 === 0) o.crash(t, 0.3 * g);
    }
    if (kick) {
      o.duck(t, L >= 2 ? 0.42 : 0.7);
      this.events.push({ t, type: 'kick', vel: L >= 2 ? 1 : 0.5 });
    }

    // ---- bass
    const sd = c.stepDur;
    const cutoff = 260 + 1500 * clamp(0.25 + 0.5 * this.bright + 0.35 * Math.abs(this.sway), 0, 1);
    if (fus && fm >= 0.5) this.fusionBass(fus, s16, t, ch.bass, cutoff, sd);
    else if (L === 1) {
      if (s16 === 0) o.bass(t, ch.bass + 12, sd * 10, 0.5 * g, cutoff * 0.7);
      if (s16 === 14 && this.r() < 0.5) o.bass(t, ch.bass + 12, sd * 1.6, 0.4 * g, cutoff * 0.7);
    } else if (L === 2) {
      if (s16 % 4 === 2) o.bass(t, ch.bass + 12, sd * 1.7, 0.72 * g, cutoff);
      if (s16 === 15 && this.sway > 0.3) o.bass(t, ch.bass + 24, sd * 0.8, 0.5 * g, cutoff);
    } else if (L >= 3) {
      const pat = this.sway > 0.25 ? [0, 3, 6, 10, 11, 14] : this.sway < -0.25 ? [2, 3, 6, 10, 14, 15] : [2, 6, 7, 10, 14];
      if (pat.includes(s16)) {
        const oct = (s16 === 7 || s16 === 11 || s16 === 15) ? 24 : 12;
        o.bass(t, ch.bass + oct, sd * (oct === 24 ? 0.8 : 1.6), 0.75 * g, cutoff * 1.15);
      }
    }

    // ---- the pad's colour: at level 0, Gem Dancers' bed (it opens as the dancers light up); above, the groove's
    let cut: number, lvl: number, sub: number, tau = 0.18;
    if (L <= 0 && !F) {
      const e = clamp(this.bedEnergy, 0, 1);
      cut = 320 + 1100 * e * e; lvl = 0.12 + 0.09 * e; sub = 0.41 * this.depth; tau = 0.9;
    } else {
      cut = 520 + 3600 * this.bright + 300 * Math.max(0, L); lvl = L >= 3 ? 0.13 : 0.16; sub = 0.1 * this.depth;
      if (T > 0) cut += 1800 * T; // tension opens the filter
      if (F && fm > 0) {
        // (steam's and aurora's pad levels are lower than the prototype's 0.2 and 0.22: they squashed the mix to a 6 dB crest)
        const [fc, fg] = ({ steam: [1500, 0.15], prism: [3200, 0.12], storm: [650, 0.14], aurora: [2400, 0.16] } as const)[F.kind];
        cut += (fc + (F.kind === 'steam' ? 800 * this.bright : 0) - cut) * fm;
        lvl += (fg - lvl) * fm;
      }
    }
    if (!this.bed) lvl = 0;
    if (Math.abs(cut - this.padCut) > this.padCut * 0.01 || Math.abs(lvl - this.padLvl) > 0.002) {
      this.padCut = cut; this.padLvl = lvl;
      o.padColour(t, cut, lvl, sub, tau);
    }

    // ---- the arp at the peak, twinkles in a breakdown (never in a world that has not grooved: that is Gem Dancers)
    if (F) { if (fus) o.fusionStep(t, F.kind, fm, Math.floor((rel - F.start) / 16), s16, rel - F.start, H, sd); }
    else if (L >= 4) {
      const seq = [0, 2, 1, 3, 2, 1, 3, 2];
      const m = ch.pad[seq[s16 % 8]] + 12 + (s16 % 8 === 7 ? 12 : 0);
      o.voice(t, 4, m, 0.16 * g, sd * 0.9, ((s16 % 4) - 1.5) * 0.3, 0);
    } else if (L === 0 && bar - this.lastGrooveBar <= 8 && s16 % 4 === 2 && this.r() < 0.4) {
      const pool = this.harmony.pool;
      o.voice(t, 3, pool[pool.length - 2 - Math.floor(this.r() * 6)], 0.13, sd * 6, this.r() * 1.4 - 0.7, 0);
    }

    // ---- the jogo: a light berimbau toque in every mood; tension as a rising layer
    if (this.jogo && !mood.capo && L >= 1 && !fus) this.toque(s16, bar, t, 0.34, -0.4);
    if (T > 0 || this.tensionOn) { this.tensionOn = true; o.tension(t, T, s16, L, inSuck || !!F, H, sd); }

    // ---- the fire bed
    if (this.r() < 0.25 * grooveParams.fireAmount) o.crackle(t + this.r() * sd, 1800 + this.r() * 4200, 0.03 + this.r() * 0.04, this.r() * 1.6 - 0.8);

    // ---- the dancers' notes
    if (!inSuck) for (const p of this.performers) p.onStep(rel, s16, t);
    this.events.push({ t, type: 'step', s16, bar, level: this.level });
    if (this.events.length > 256) this.events.splice(0, this.events.length - 256);
  }

  /** what changes on a bar line: the mood, the place, the key, the chord, the delay's beat */
  private barLine(bar: number, t: number) {
    const o = this.out, h = this.harmony;
    const barDur = this.clock.stepDur * 16;
    // a new track (free): this bar line is its bar 1
    if (this.pendingTrack !== undefined && !this.clock.sync) {
      const tr = this.pendingTrack; this.pendingTrack = undefined;
      // (and its chords from its own bar 1: a film's shot had the old track's place in trackBeat0)
      if (tr) { this.clock.origin = this.clock.step; bar = 0; if (Number.isFinite(this.trackBeat0)) this.trackBeat0 = 0; }
      this.useTrack(tr, t);
      this.events.push({ t, type: 'track', id: tr?.id ?? null });
    }
    if (this.track) { this.pendingMood = null; this.pendingKey = null; }
    if (this.pendingMood != null || this.pendingKey != null) {
      if (this.pendingMood != null) this.pendingKey = null; // a new mood is in its own key
      h.setMood(this.pendingMood ?? h.moodIndex, this.pendingMood != null ? 0 : this.pendingKey!);
      this.clock.swing = h.mood.swing;
      if (!this.clock.sync) this.clock.targetBpm = h.mood.bpm;
      this.events.push({ t, type: 'mood', index: h.moodIndex, name: h.mood.name });
      this.pendingMood = null; this.pendingKey = null;
    }
    if (this.pendingPlace) {
      const p = this.pendingPlace; this.pendingPlace = null;
      this.depth = p.tone.depth;
      o.tone(t, p.tone);
      o.room(t, p.room, barDur, p.grooveWet);
    }
    const i = this.track ? trackChord(this.track, ((this.clock.step - this.clock.origin) / 4) - this.trackBeat0) : this.chordFor(bar, this.level);
    const prev = h.chordIdx;
    h.setChord(i, t);
    if (this.bed) this.padNow(t, this.level <= 0 && !this.fus ? 2.4 : 0.045);
    if (i !== prev) this.events.push({ t, type: 'chord', index: i, name: h.chord.name });
    o.delayBeat(t, 60 / this.clock.bpm);
    this.events.push({ t, type: 'bar', bar });
  }

  private updateLevel(rel: number, s16: number, t: number) {
    const forced = grooveParams.level;
    const prev = this.level;
    if (forced >= 0 && !(rel < this.peakUntil)) {
      this.level = Math.round(clamp(forced, 0, 4));
    } else {
      const I = this.intensity;
      const down = prev > 0 ? 0.035 : 0;
      let tgt = I < 0.07 - down ? 0 : I < 0.24 - down ? 1 : I < 0.48 - down ? 2 : 3;
      if (rel < this.peakUntil) { if (I > 0.05 || forced >= 0) tgt = 4; else this.peakUntil = -1; }
      if (tgt > prev) { this.level = tgt; this.lowBars = 0; }
      else if (tgt < prev) {
        if (tgt === 0 && I < 0.04) { this.level = 0; this.lowBars = 0; }
        else if (s16 === 0) { this.lowBars++; if (this.lowBars >= 2) { this.level = prev - 1; this.lowBars = 0; } }
      } else this.lowBars = 0;
    }
    if (this.level >= 2 && prev < 2) this.out.crash(t, 0.22);
    if (this.level !== prev) this.events.push({ t, type: 'level', level: this.level, prev });
  }

  // ---------------------------------------------------------------- the roda, the fusion's groove
  private rodaDrums(s16: number, bar: number, t: number, L: number) {
    const o = this.out;
    let kick = false;
    // at level 0 the berimbau only plays in a breakdown (a world that has not grooved is Gem Dancers' still bed)
    if (L >= 1 || (L === 0 && bar - this.lastGrooveBar <= 8)) this.toque(s16, bar, t, L === 0 ? 0.55 : 0.8, -0.3);
    if (L === 0 && bar - this.lastGrooveBar <= 8 && s16 === 0 && bar % 2 === 0) o.atabaque(t, 'bass', 0.5, 0.25);
    if (L >= 1) {
      const at: Record<number, 'bass' | 'open' | 'slap'> = L === 1 ? { 0: 'bass', 8: 'open' } : { 0: 'bass', 3: 'open', 6: 'open', 8: 'bass', 10: 'slap', 12: 'open', 14: 'open' };
      if (at[s16]) o.atabaque(t, at[s16], 0.7, 0.25);
      if (L >= 4 && (s16 === 13 || s16 === 15)) o.atabaque(t, 'slap', 0.45, 0.25);
      if (L === 1) { if (s16 % 8 === 0) o.pandeiro(t, 'thumb', 0.6); }
      else {
        const k = s16 % 4;
        o.pandeiro(t, k === 0 ? 'thumb' : k === 2 ? 'slap' : 'tip', k === 0 ? 0.75 : k === 2 ? 0.6 : (L >= 3 ? 0.4 : 0.3));
      }
    }
    if (L >= 2) {
      if (L === 2 ? (s16 === 0 || s16 === 8) : s16 % 4 === 0) { o.kick(t, L === 2 ? 0.6 : 0.82); kick = true; }
      if (L >= 3 && (s16 === 4 || s16 === 12)) o.clap(t, 0.38);
      if (L >= 4 && s16 === 0 && bar % 4 === 0) o.crash(t, 0.25);
    }
    return kick;
  }

  /** "ch-ch dong ding" on 8ths, with a "ch dong dong ding" turn at the end of each 4-bar phrase */
  private toque(s16: number, bar: number, t: number, vel: number, pan: number) {
    let pat: Record<number, 'ch' | 'dong' | 'ding'> = { 0: 'ch', 2: 'ch', 4: 'dong', 6: 'ding' };
    if (s16 >= 8 && (((bar % 4) + 4) % 4) === 3) pat = { 0: 'ch', 2: 'dong', 4: 'dong', 6: 'ding' };
    const k = pat[s16 % 8];
    if (!k) return;
    const pent = this.harmony.mood.pent, dong = near(pent[0], 47);
    this.out.berimbau(t, k, vel * (k === 'ch' ? 0.8 : 1), pan, dong, notes(pent, dong + 1, 1)[0]);
  }

  private fusionDrums(kind: FusionKind, s16: number, fb: number, t: number) {
    const o = this.out;
    let kick = false;
    const k = (v: number, hard?: boolean) => { o.kick(t, v, hard); kick = true; };
    if (kind === 'steam') {
      if (s16 % 4 === 0) k(0.85);
      if (s16 === 4 || s16 === 12) o.clap(t, 0.42);
      if (s16 % 4 === 2) o.hat(t, 0.3, true);
      else if (s16 % 2 === 1) o.hat(t, 0.07, false);
    } else if (kind === 'prism') {
      if (s16 % 4 === 0) k(0.9);
      if (s16 === 4 || s16 === 12) o.clap(t, 0.55);
      o.hat(t, s16 % 4 === 2 ? 0.32 : 0.1 + 0.05 * this.r(), false);
      if (s16 === 0 && fb % 4 === 0) o.crash(t, 0.25);
    } else if (kind === 'storm') {
      if (s16 % 4 === 0) k(1.0, true);
      if (s16 === 14 && fb % 2 === 0) k(0.6, true);
      if (s16 === 4 || s16 === 12) o.clap(t, 0.62);
      if (s16 % 4 === 2) o.hat(t, 0.36, true);
      if (s16 % 2 === 1) o.hat(t, 0.1, false);
    } else { // aurora: half time
      if (s16 === 0) k(0.9);
      if (s16 === 10) k(0.45);
      if (s16 === 8) { o.clap(t, 0.6); o.crash(t, 0.08); }
      if (s16 % 4 === 2) o.hat(t, 0.18, false);
      if (s16 === 0 && fb % 2 === 0) o.crash(t, 0.2);
    }
    return kick;
  }

  private fusionBass(kind: FusionKind, s16: number, t: number, root: number, cutoff: number, sd: number) {
    const o = this.out;
    if (kind === 'steam') {
      if (s16 === 0 || s16 === 8) o.bass(t, root + 12, sd * 7, 0.7, cutoff * 0.7);
      if (s16 === 14) o.bass(t, root + 24, sd * 0.9, 0.45, cutoff * 0.7);
    } else if (kind === 'prism') {
      if (s16 % 4 === 2) o.bass(t, root + 12, sd * 1.7, 0.72, cutoff);
      if (s16 === 15) o.bass(t, root + 24, sd * 0.8, 0.5, cutoff);
    } else if (kind === 'storm') { // rolling 16ths around the kick
      if (s16 % 4 !== 0) {
        const oct = s16 % 4 === 3 ? 24 : 12;
        o.bass(t, root + oct, sd * 0.75, s16 % 4 === 2 ? 0.75 : 0.6, cutoff * 1.1);
      }
    } else if (s16 === 0) o.bass(t, root + 12, sd * 15, 0.6, cutoff * 0.6);
  }

  /** the drop lands: the impact and the tonic, big and wide */
  private impact(t: number) {
    this.out.impact(t);
    if (this.track) return;
    this.harmony.mood.chords[0].pad.forEach((m, i) => this.out.voice(t, 0, m + 12, 0.3, 1.4, (i - 1.5) * 0.4, 0));
  }

  // ---------------------------------------------------------------- the drop, the fusion, release
  /** the next drop: false while one is pending or the last was under two bars ago */
  drop() {
    const rel = this.clock.step - this.clock.origin;
    if (this.dropStep >= 0) return false;
    if (rel - this.lastDropRel < 32 && this.lastDropRel > -900) return false;
    this.armDrop(null);
    return true;
  }

  /** solo on the next beat (then re-based to bar one); synced on the next shared bar line (or a bar the server chose) */
  private armDrop(atStep: number | null) {
    const c = this.clock, now = this.time(), synced = c.synced, unit = synced || this.track ? 16 : 4;
    let s = c.step;
    const lead = atStep != null && synced ? 0.1 : 0.28;
    if (atStep != null && synced) s = Math.max(s, atStep);
    while ((((s - c.origin) % unit) + unit) % unit !== 0 || c.stepTime(s) < now + lead) s++;
    const t = c.stepTime(s);
    this.dropStep = s; this.dropTime = t;
    this.out.suck(now, t);
    this.out.riser(now, t - now);
    this.events.push({ t: now, type: 'predrop', dur: t - now });
  }

  /** hit like a drop, then hold a fusion's texture for 8 bars. at: server ms of a bar line, when synced. Returns when it
   *  lands (or null if this fusion is already playing) */
  fusion(kind: FusionKind = 'steam', at?: number) {
    if (!FUSIONS.includes(kind)) kind = 'steam';
    if (this.fus && this.fus.kind === kind && this.fus.relStart < 0 && this.pendingFusion == null) return null;
    this.pendingFusion = kind;
    if (this.dropStep >= 0) return this.dropTime; // a pending drop becomes the fusion
    let atStep: number | null = null;
    const S = this.clock.sync;
    if (at != null && S && this.clock.synced) atStep = Math.ceil((at - S.epoch) / (60000 / (S.bpm * 4)) - 1e-6);
    this.armDrop(atStep);
    return this.dropTime;
  }

  /** back to the groove over one bar (also cancels a fusion that has not landed) */
  release() {
    const now = this.time();
    if (this.pendingFusion != null) {
      this.pendingFusion = null;
      if (this.dropStep >= 0) { this.dropStep = -1; this.out.unsuck(now); }
      if (!this.fus) return true;
    }
    const F = this.fus;
    if (!F || F.relStart >= 0) return false;
    F.relStart = this.clock.step - this.clock.origin;
    this.out.fusionFade(Math.max(this.clock.gridTime, now), this.clock.stepDur * 16 / 3.5);
    this.peakUntil = -1;
    return true;
  }

  // ---------------------------------------------------------------- the shared clock
  syncTo(s: Sync & { mood?: number; track?: TrackInfo | null }) {
    const prev = this.clock.sync;
    this.clock.syncTo(s);
    if (s.track !== undefined && (this.pendingTrack === undefined ? this.track : this.pendingTrack)?.id !== s.track?.id) {
      // the new track starts with the room's new epoch (its bar 1), when the clock jumps onto it; at once if no jump
      // is coming (the same epoch and tempo)
      if (prev && prev.epoch === this.clock.sync!.epoch && prev.bpm === this.clock.sync!.bpm && this.clock.syncOff != null) this.useTrack(s.track, this.time());
      else this.pendingTrack = s.track;
    }
    if (s.mood != null && Number.isFinite(+s.mood) && +s.mood !== this.harmony.moodIndex) this.setMood(+s.mood);
  }

  /** the grid jumped onto a shared clock: everything counted in steps moves with it */
  jump(d: number, cur: number) {
    if (this.pendingTrack !== undefined) {
      const tr = this.pendingTrack; this.pendingTrack = undefined;
      this.useTrack(tr, Math.max(cur, this.clock.stepTime(0)));
    }
    if (this.lastDropRel > -900) this.lastDropRel += d;
    if (this.peakUntil >= 0) this.peakUntil += d;
    this.lastGrooveBar += Math.round(d / 16);
    if (this.fus) { this.fus.start += d; this.fus.end += d; if (this.fus.relStart >= 0) this.fus.relStart += d; }
    const n = this.clock.step;
    this.harmony.setChord(this.track ? trackChord(this.track, n / 4 - this.trackBeat0) : this.chordFor(Math.floor(n / 16), this.level), cur + 0.005);
    if (this.bed) this.padNow(cur + 0.005, 0.045);
    if (this.dropStep >= 0) { // a pending drop moves to the next shared bar line
      let s = Math.ceil(n / 16) * 16;
      while (this.clock.stepTime(s) < cur + 0.1) s += 16;
      this.dropStep = s; this.dropTime = this.clock.stepTime(s);
      this.out.suck(cur, this.dropTime);
    }
  }

  // ---------------------------------------------------------------- the body and the jogo
  /** a percussive hit from the body, on the grid (side < 0: left) */
  stomp(side: number, vel = 1, palette = 0) {
    const t = this.clock.quantTime(this.time(), 1), ch = this.harmony.chord, o = this.out;
    if (palette === 0) {
      if (side < 0) { o.tom(t, ch.bass + 12, 0.95 * vel, -0.3); o.kick(t, 0.5 * vel); }
      else { o.clap(t, 0.6 * vel); o.tom(t, ch.bass + 19, 0.55 * vel, 0.3); }
    } else if (side < 0) o.tom(t, ch.bass + 24, 0.5 * vel, -0.5);
    else o.rim(t, 0.8 * vel, 0.5);
    return t;
  }

  /** a run up (or down) the scale, on the grid */
  gliss(up = true, palette = 1) {
    const t0 = this.clock.quantTime(this.time(), 1), sd = this.clock.stepDur / 2, pool = this.harmony.pool;
    const k = 10, start = up ? 3 : pool.length - 3;
    for (let i = 0; i < k; i++) {
      const idx = clamp(start + (up ? i : -i), 0, pool.length - 1);
      this.out.voice(t0 + i * sd, palette, pool[idx], 0.34 + 0.03 * i, sd * 2, (i / k - 0.5) * 1.4, 0);
    }
    return t0;
  }

  /** a jogo sound: when it plays (now, or `at` if later), pitched from the chord sounding then */
  sfx(name: SfxName, opts: SfxOptions = {}) {
    if (!SFX.includes(name)) return null;
    const now = this.time(), t = Math.max(opts.at ?? now, now);
    const el: Element = opts.element && ['fire', 'plasma', 'water', 'ice'].includes(opts.element) ? opts.element : 'fire';
    const H: Harm = this.harmony.at(t);
    this.out.sfx(t, {
      name, el, perfect: !!opts.perfect, pan: clamp(opts.pan ?? 0, -1, 1), dist: clamp(+(opts.dist ?? 0) || 0, 0, 1),
      vel: clamp(opts.vel ?? 0.8, 0, 1), H, stepDur: this.clock.stepDur, move: opts.move, count: opts.count, final: opts.final, dur: opts.dur,
    });
    return t;
  }

  /** the events whose time has come (for the visuals) */
  pollEvents(now = this.time()) {
    const due: MusicEvent[] = [], keep: MusicEvent[] = [];
    for (const e of this.events) (e.t <= now ? due : keep).push(e);
    this.events = keep;
    return due;
  }
}
