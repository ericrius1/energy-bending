// The one source of harmony. A mood is a key, a tempo, a swing, a pentatonic scale and four chords (the prototype's
// five moods, including the capoeira "Roda"); the harmony is which mood is playing, which of its chords sounds now,
// and how far the whole thing is transposed (a new piece in the show moves the key). Everything pitched asks here:
// the pad, the bass and the arps of the groove, the stones and the feet of the score, the player's melody, the jogo's
// sound effects, the matter voices. So nothing can play out of key, and the chord bed and the groove's pad are one
// thing (the pad in engine.ts), never two.
//
// Pure logic, no Web Audio. Chords are scheduled ahead of time (the scheduler looks ahead), so `at(t)` answers what
// sounds at t from a short log of chord changes, not what was set last.

export interface Chord {
  name: string;
  /** the bass note (midi, around the first octave: the bass plays it an octave or two up) */
  bass: number;
  /** the pad's four voices (midi) */
  pad: number[];
  /** the chord's pitch classes (0 = C) */
  tones: number[];
}

export interface Mood {
  name: string;
  key: string;
  bpm: number;
  swing: number;
  /** the pentatonic pitch classes; pent[0] is the key's root in every mood (the berimbau's open note follows it) */
  pent: number[];
  /** the bottom of the melody's range (midi) */
  low: number;
  chords: Chord[];
  /** the capoeira roda: berimbau, pandeiro and atabaque carry the groove */
  capo?: boolean;
}

export const MOODS: Mood[] = [
  { name: 'Ember', key: 'A minor', bpm: 112, swing: 0.10, pent: [9, 0, 2, 4, 7], low: 57,
    chords: [
      { name: 'Am', bass: 33, pad: [57, 60, 64, 67], tones: [9, 0, 4, 7] },
      { name: 'F', bass: 29, pad: [53, 57, 60, 64], tones: [5, 9, 0, 4] },
      { name: 'C', bass: 36, pad: [55, 60, 64, 67], tones: [0, 4, 7] },
      { name: 'G', bass: 31, pad: [55, 59, 62, 67], tones: [7, 11, 2] },
    ] },
  { name: 'Midnight', key: 'D minor', bpm: 100, swing: 0.16, pent: [2, 5, 7, 9, 0], low: 50,
    chords: [
      { name: 'Dm9', bass: 38, pad: [53, 57, 60, 64], tones: [2, 5, 9, 0] },
      { name: 'B♭maj7', bass: 34, pad: [53, 57, 58, 62], tones: [10, 2, 5, 9] },
      { name: 'F', bass: 29, pad: [53, 57, 60, 65], tones: [5, 9, 0] },
      { name: 'C', bass: 36, pad: [52, 55, 60, 64], tones: [0, 4, 7] },
    ] },
  { name: 'Sunrise', key: 'C major', bpm: 120, swing: 0.06, pent: [0, 2, 4, 7, 9], low: 60,
    chords: [
      { name: 'Fmaj7', bass: 29, pad: [53, 57, 60, 64], tones: [5, 9, 0, 4] },
      { name: 'G', bass: 31, pad: [55, 59, 62, 67], tones: [7, 11, 2] },
      { name: 'Am7', bass: 33, pad: [57, 60, 64, 67], tones: [9, 0, 4, 7] },
      { name: 'C', bass: 36, pad: [55, 60, 64, 67], tones: [0, 4, 7] },
    ] },
  { name: 'Neon', key: 'F♯ minor', bpm: 124, swing: 0.04, pent: [6, 9, 11, 1, 4], low: 54,
    chords: [
      { name: 'F♯m7', bass: 30, pad: [54, 57, 61, 64], tones: [6, 9, 1, 4] },
      { name: 'Dmaj7', bass: 38, pad: [54, 57, 61, 62], tones: [2, 6, 9, 1] },
      { name: 'A', bass: 33, pad: [52, 57, 61, 64], tones: [9, 1, 4] },
      { name: 'E', bass: 28, pad: [52, 56, 59, 64], tones: [4, 8, 11] },
    ] },
  { name: 'Roda', key: 'G major', bpm: 100, swing: 0.12, pent: [7, 9, 11, 2, 4], low: 55, capo: true,
    chords: [
      { name: 'G', bass: 31, pad: [55, 59, 62, 67], tones: [7, 11, 2] },
      { name: 'Em', bass: 28, pad: [52, 55, 59, 64], tones: [4, 7, 11] },
      { name: 'C', bass: 36, pad: [52, 55, 60, 64], tones: [0, 4, 7] },
      { name: 'D', bass: 38, pad: [54, 57, 62, 66], tones: [2, 6, 9] },
    ] },
];

export const moodIndex = (name: string) => MOODS.findIndex((m) => m.name.toLowerCase() === name.toLowerCase());
export const pc = (m: number) => ((Math.round(m) % 12) + 12) % 12;

/** the midi note with pitch class `p` nearest to `target` (ties go down) */
export function near(p: number, target: number) {
  const d = (((target - p) % 12) + 12) % 12, below = target - d;
  return d > 6 ? below + 12 : below;
}

/** `count` ascending midi notes at or above `low` whose pitch class is in `pcs` */
export function notes(pcs: readonly number[], low: number, count: number) {
  const out: number[] = [];
  for (let m = Math.ceil(low); out.length < count && m < low + 72; m++) if (pcs.includes(pc(m))) out.push(m);
  return out;
}

/** a mood moved by `semis` semitones (its chords, scale and range together) */
export function transposed(m: Mood, semis: number): Mood {
  if (!semis) return m;
  const t = (p: number) => pc(p + semis);
  return {
    ...m, pent: m.pent.map(t), low: m.low + semis,
    chords: m.chords.map((c) => ({ name: c.name, bass: c.bass + semis, pad: c.pad.map((p) => p + semis), tones: c.tones.map(t) })),
  };
}

/** what sounds at a time: the chord and the mood it belongs to (a snapshot the sound effects are handed) */
export interface Harm { chord: Chord; mood: Mood }

export class Harmony {
  moodIndex = 0;
  /** semitones the mood is moved by (a piece's key) */
  transpose = 0;
  mood: Mood = MOODS[0];
  chordIdx = 0;
  /** the mood's notes over its range: the melody's pool (the prototype's `pool`) */
  pool: number[] = [];
  private log: { t: number; h: Harm }[] = [];

  constructor(mood = 0) { this.setMood(mood); }

  get chord() { return this.mood.chords[this.chordIdx]; }
  /** the key's root (midi, around the third octave) */
  get root() { return near(this.mood.pent[0], this.mood.low); }

  setMood(i: number, transpose = this.transpose) {
    this.moodIndex = ((i % MOODS.length) + MOODS.length) % MOODS.length;
    this.transpose = transpose;
    this.mood = transposed(MOODS[this.moodIndex], transpose);
    this.chordIdx = Math.min(this.chordIdx, this.mood.chords.length - 1);
    this.pool = [];
    for (let n = this.mood.low - 12; n <= this.mood.low + 31; n++) if (this.mood.pent.includes(pc(n))) this.pool.push(n);
  }

  /** the transposition that brings this mood's root nearest a key (midi), within a tritone */
  transposeFor(key: number) {
    const base = MOODS[this.moodIndex];
    let d = pc(key - base.pent[0]);
    if (d > 6) d -= 12;
    return d;
  }

  /** chord i from time t on */
  setChord(i: number, t: number) {
    this.chordIdx = ((i % this.mood.chords.length) + this.mood.chords.length) % this.mood.chords.length;
    this.log.push({ t, h: { chord: this.chord, mood: this.mood } });
    if (this.log.length > 12) this.log.shift();
  }

  /** the harmony sounding at time t (chords are set up to a lookahead early) */
  at(t: number): Harm {
    const L = this.log;
    for (let i = L.length - 1; i >= 0; i--) if (L[i].t <= t + 0.005) return L[i].h;
    return L[0]?.h ?? { chord: this.chord, mood: this.mood };
  }

  // ---------------------------------------------------------------- choosing notes
  /** the pool index for a value 0 … 1 spread over `span` notes from `lowIdx` */
  poolIndexFor(norm: number, lowIdx: number, span: number) {
    return Math.max(0, Math.min(this.pool.length - 1, Math.round(lowIdx + Math.max(0, Math.min(1, norm)) * span)));
  }

  /** the pool index nearest `idx` that is a tone of the chord sounding at t */
  snapToChord(idx: number, t?: number) {
    const tones = (t === undefined ? this.chord : this.at(t).chord).tones;
    for (let d = 0; d < 4; d++) for (const s of [1, -1]) {
      const i = idx + d * s;
      if (i >= 0 && i < this.pool.length && tones.includes(pc(this.pool[i]))) return i;
    }
    return idx;
  }

  /** a tone of the chord at t, `step` places up from `low` (wrapping round a few octaves): a stone's note */
  chordTone(t: number, low: number, step: number, span = 6) {
    const ns = notes(this.at(t).chord.tones, low, span);
    return ns[((Math.floor(step) % ns.length) + ns.length) % ns.length];
  }

  /** a note of the key's pentatonic, `octave` octaves above the root, step 0 … 9 (Gem Dancers' `note`) */
  scale(step: number, octave: number) {
    const ivs = this.mood.pent.map((p) => pc(p - this.mood.pent[0])).sort((a, b) => a - b);
    const s = ((Math.floor(step) % 10) + 10) % 10;
    return this.root + 12 * octave + ivs[s % 5] + 12 * Math.floor(s / 5);
  }

  /** the nearest note to `midi` that belongs to the chord at t */
  nearestChordTone(t: number, midi: number) {
    const tones = this.at(t).chord.tones;
    let best = midi, d = 99;
    for (const p of tones) { const m = near(p, midi); if (Math.abs(m - midi) < d) { d = Math.abs(m - midi); best = m; } }
    return best;
  }
}
