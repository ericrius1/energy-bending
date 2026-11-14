// The line between deciding and sounding. Everything that decides what to play (the scheduler and groove in
// engine.ts, the score, the player's melody, the matter voices' choice of note) calls an `Instrument`; every call says
// the time it should sound at. Live, the instrument is the Synth on an AudioContext (synth/synth.ts). For a film it
// is a Recorder: it writes the calls down as they happen, and after the last frame they are replayed, in the same
// order, into a Synth on an OfflineAudioContext. The deciding side never reads anything back from the sounding side
// (no AudioParam values, no currentTime), and both sides draw their randomness from seeded generators, so the same
// film script gives the same score, sample for sample.
import type { Tone, Room } from './sound';
import type { Harm } from './harmony';
import type { Timbre } from './voices';

/** the game's buses under a track, each × its level without one (synth/mix.ts UNDER) */
export interface UnderLevels { all: number; world: number; fx: number; sfx: number; duel: number; motion: number }

export type { Timbre };
/** the colour a jogo sound is played in: fire / plasma for the hot side, water / ice for the cold */
export type Element = 'fire' | 'plasma' | 'water' | 'ice';
export type FusionKind = 'steam' | 'prism' | 'storm' | 'aurora';
export const FUSIONS: FusionKind[] = ['steam', 'prism', 'storm', 'aurora'];
export type SfxName = 'move' | 'dodge' | 'near' | 'clash' | 'parry' | 'hit' | 'land' | 'respawn' | 'formOn' | 'formOff'
  | 'echo' | 'unison' | 'mergeReady' | 'count' | 'finale' | 'results';
export const SFX: SfxName[] = ['move', 'dodge', 'near', 'clash', 'parry', 'hit', 'land', 'respawn', 'formOn', 'formOff',
  'echo', 'unison', 'mergeReady', 'count', 'finale', 'results'];
/** the moves the prototype's sound effects know by name (anything else is a strike) */
export const MOVES = ['meia-lua', 'armada', 'martelo', 'bencao', 'rasteira', 'au', 'macaco', 'role', 'strike', 'throw', 'spin', 'jump', 'esquiva'];

/** a jogo sound effect as the instrument is handed it: what, where, how hard, and the harmony sounding then */
export interface SfxCall {
  name: SfxName;
  el: Element;
  perfect: boolean;
  pan: number;
  dist: number;
  vel: number;
  H: Harm;
  stepDur: number;
  /** for 'move': which move; 'dodge': the streak; 'count': the "go"; 'mergeReady': how long it is held */
  move?: string;
  count?: number;
  final?: boolean;
  dur?: number;
}

/** the duel's sounds (synth/duel.ts; src/duel/sound.ts decides them): the contact dance's moments, the powers, the
 *  tiers, the set's count-in, finale and banner, and the soft movement voices. Water, wind, embers, glass bowls, chimes
 *  and breath: never an impact */
export type DuelCue =
  | 'count' | 'go' | 'catch' | 'aerial' | 'range' | 'swing' | 'fling' | 'landed' | 'lift' | 'counter' | 'release'
  | 'merge' | 'finale' | 'fusion' | 'banner' | 'tier' | 'bank' | 'fall' | 'reform'
  | 'cast' | 'form' | 'react' | 'launch' | 'swap' | 'redirect'
  | 'dash' | 'walljump' | 'land' | 'jump';
export const DUEL_CUES: DuelCue[] = ['count', 'go', 'catch', 'aerial', 'range', 'swing', 'fling', 'landed', 'lift', 'counter', 'release',
  'merge', 'finale', 'fusion', 'banner', 'tier', 'bank', 'fall', 'reform', 'cast', 'form', 'react', 'launch', 'swap', 'redirect',
  'dash', 'walljump', 'land', 'jump'];
/** the movement voices (soft, under the music: their own bus) */
export const MOTION_CUES: ReadonlySet<DuelCue> = new Set(['dash', 'walljump', 'land', 'jump']);
/** a duel sound as the instrument is handed it */
export interface DuelCall {
  cue: DuelCue;
  /** the colour: the seat's matter ('fire' | 'water' | 'ice' | 'plasma' | 'gems'), and the other seat's (a catch, a merge) */
  matter: string;
  other?: string;
  /** a cast's power ('flare' … 'prism'), a reaction's kind ('geyser' | 'melt' | 'freeze') */
  power?: string;
  pan: number; dist: number; vel: number;
  /** a tier (1 … 4), a count (3, 2, 1), a swing's count in its hold, a combo's length */
  level: number;
  /** the form's on or off; a cast in the form (bigger); on the beat */
  on?: boolean; big?: boolean; perfect?: boolean;
  /** how long it lasts (s: a wave's wash, a ribbon) */
  dur?: number;
  /** the harmony sounding then, and the beat's length (s) */
  H: Harm; spb: number;
  /** 0 … 1, the same for the same event: its variations */
  seed: number;
}

/** a matter voice's one-off sound (a crackle, a splash, a zap): where, how hard, and its note if it has one */
export interface MatterPlay {
  pan: number; dist: number; strength: number;
  /** its note (from the voice's `note`, or 0 for an unpitched sound), the chord's pitch classes for any others */
  midi: number; tones: readonly number[];
  /** 0 … 1, the same for the same event (from where it happened): its variations */
  seed: number;
  /** anything else the kind reports (an arc's length, a splash's mass) */
  extra: number;
}
/** a matter voice's held sound (a roar, a pour, a buzz, a hiss), restated every frame while it lasts */
export interface HoldPlay { amount: number; speed: number; pan: number; dist: number; midi: number; tones: readonly number[] }

export interface Instrument {
  // ---- the room
  /** where it is heard: the low-pass over the world, the reverb's level, the hearth, the sub */
  tone(t: number, tone: Tone): void;
  /** the reverb's shape (a long glassy cave, an open glade), crossfaded over `fade` seconds, and how much of the
   *  groove goes into it */
  room(t: number, room: Room, fade: number, grooveWet?: number): void;
  /** before a drop: sweep the music down from now to t1 (then open it again at t1) */
  suck(t0: number, t1: number): void;
  unsuck(t: number): void;
  /** the kick ducks the pad and the bass */
  duck(t: number, depth: number): void;
  /** the ping-pong delay follows the tempo (a dotted eighth) */
  delayBeat(t: number, beat: number): void;
  /** under a world's track (1) the world's sounds, the effects and the jogo's sit lower; 0 puts them back. `levels`
   *  (synth/mix.ts UNDER's, each × the bus's level without a track) for a mode with its own balance: the duel's */
  under(t: number, amount: number, levels?: Partial<UnderLevels>): void;
  // ---- drums
  kick(t: number, vel: number, hard?: boolean): void;
  clap(t: number, vel: number): void;
  hat(t: number, vel: number, open: boolean): void;
  crash(t: number, vel: number): void;
  tom(t: number, midi: number, vel: number, pan: number): void;
  rim(t: number, vel: number, pan: number): void;
  shaker(t: number, vel: number): void;
  berimbau(t: number, kind: 'ch' | 'dong' | 'ding', vel: number, pan: number, dong: number, ding: number): void;
  pandeiro(t: number, kind: 'thumb' | 'slap' | 'tip', vel: number): void;
  atabaque(t: number, kind: 'bass' | 'open' | 'slap', vel: number, pan: number): void;
  riser(t: number, dur: number): void;
  impact(t: number): void;
  crackle(t: number, freq: number, amp: number, pan: number): void;
  // ---- pitched
  bass(t: number, midi: number, dur: number, vel: number, cutoff: number): void;
  /** a melodic voice: 0 pluck, 1 kalimba, 2 glass, 3 bell, 4 soft pluck, 5 marimba, 6 reed */
  voice(t: number, palette: number, midi: number, vel: number, dur: number, pan: number, dist: number): void;
  /** the bed moves to a chord: the new voices swell in (time constant `swell`, s) over the old ones fading; the sub
   *  plays `sub` (midi: the chord's root, low) */
  pad(t: number, notes: readonly number[], swell: number, sub?: number): void;
  /** the bed's colour: its filter, its level and the sub under its root */
  padColour(t: number, cut: number, level: number, sub: number, tau: number): void;
  // ---- the jogo's larger moments
  fusionOn(t: number, kind: FusionKind): void;
  fusionFade(t: number, tau: number): void;
  fusionHit(t: number, kind: FusionKind, H: Harm): void;
  fusionStep(t: number, kind: FusionKind, fm: number, fb: number, s16: number, rel: number, H: Harm, sd: number): void;
  tension(t: number, T: number, s16: number, L: number, quiet: boolean, H: Harm, sd: number): void;
  sfx(t: number, call: SfxCall): void;
  /** the duel's sounds (src/duel/sound.ts) */
  duel(t: number, call: DuelCall): void;
  // ---- the stones and the room's own sounds (Gem Dancers)
  strike(t: number, timbre: Timbre, midi: number, vel: number, pan: number, wet?: number, reverse?: boolean, dist?: number): void;
  ambience(t: number, day: number, night: number, dawn: number, wind: number): void;
  whoosh(t: number, level: number, pitch: number): void;
  drone(t: number, level: number, midi: number): void;
  boom(t: number, midi: number, vel: number): void;
  /** a moving hand's breath of air (one per hand) */
  hand(t: number, i: number, amount: number, pan: number): void;
  // ---- matter
  matter(t: number, kind: string, type: string, p: MatterPlay): void;
  hold(t: number, key: string, kind: string, p: HoldPlay): void;
}

type Call = [keyof Instrument, unknown[]];

/** an Instrument that writes every call down (for a film), to be replayed into a Synth on an OfflineAudioContext.
 *  The arguments are kept as passed: callers hand it fresh values or shared constants and never change them after */
export class Recorder {
  readonly calls: Call[] = [];
  /** where it will be heard (the place at the start of the film) */
  tone: Tone = { water: 2600, cave: 0.8, hearth: 0.5, depth: 0.5, forest: 0 };
  room: Room | null = null;
  readonly instrument: Instrument;
  constructor() {
    this.instrument = new Proxy({} as Instrument, {
      get: (_, m: string | symbol) => (...a: unknown[]) => { this.calls.push([m as keyof Instrument, a]); },
    });
  }
  /** play what was written into another instrument, in order */
  replay(into: Instrument) { for (const [m, a] of this.calls) (into[m] as (...x: unknown[]) => void)(...a); }
  /** how many calls of each kind (for the measurements) */
  census() {
    const c: Record<string, number> = {};
    for (const [m] of this.calls) c[m] = (c[m] ?? 0) + 1;
    return c;
  }
}

/** an Instrument that does nothing (before the sound starts, live) */
export const silent: Instrument = new Proxy({} as Instrument, { get: () => () => {} });

/** a stereo AudioBuffer as a 16-bit WAV file */
export function wav(b: AudioBuffer) {
  const n = b.length, ch = b.numberOfChannels, rate = b.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => b.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) out.setInt16(o, Math.round(Math.max(-1, Math.min(1, data[c][i])) * 32767), true);
  return out.buffer;
}
