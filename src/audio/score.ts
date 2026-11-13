// What the scene plays. A key and a slow progression under everything; the dancers' feet strike the floor like a
// lithophone (a stone bar on the chord's root, harder the harder they land); their hands sound crystal notes by how
// high they are; every stone the GPU reports landing, breaking off or clicking home rings in its own voice (geodes
// glass, crystals bright, pyrite metal), always on the key's pentatonic scale; the pointer whooshes, a held finger
// drones and its release booms a chord. Nothing is tempo-locked: the music is what the bodies and the stones do.
import { mulberry32 } from 'math/random';
import { ringLength, type Timbre } from './voices';
import type { Sink } from './sound';

const PENTA = [0, 2, 4, 7, 9];
/** a slow progression in a major key, as voicings relative to its root: I add9, vi9, IV maj7, V9 sus */
const PROG = [[0, 7, 14, 16], [-3, 4, 7, 11], [-7, 0, 4, 9], [-5, 2, 5, 9]];
const CHORD_SECONDS = 12;
/** keys the programs move through (the root around the third octave) */
export const KEYS = [53, 50, 55, 52, 48, 57];

/** per specimen (in specimens.json order): its voice and register (octaves above the key's root): low, deep in the cave */
const VOICE_OF: Record<string, [Timbre, number]> = {
  amethyst: ['glass', 0], celestite: ['glass', 0], agate: ['glass', 0], citrine: ['crystal', 1], quartz: ['crystal', 1],
  emerald: ['crystal', 1], rose: ['crystal', 1], obsidian: ['glass', 0], malachite: ['stone', 0], pyrite: ['metal', 0],
  brilliant: ['crystal', 1],
};

/** one dancer's skeleton, as the indices of the joints that make sound */
export interface Ears { feet: number[]; hands: number[] }
export const earsOf = (names: string[]): Ears => ({
  feet: ['LeftToeBase', 'RightToeBase'].map((n) => names.indexOf(n)),
  hands: ['LeftHand', 'RightHand'].map((n) => names.indexOf(n)),
});

export interface Heard {
  /** how much is moving, 0 … 1 */
  energy: number;
  /** the pointer: how fast it sweeps (m/s on the dancers' plane), how long a finger has been held (0 … 1) */
  sweep: number;
  charge: number;
}

export class Score {
  key = KEYS[0];
  private chordIx = 0;
  private nextChord = 0;
  private e = 0;
  private rng = mulberry32.create(20261028);
  private r = () => mulberry32.sample(this.rng);
  // each foot: the floor it stands on (it varies from capture to capture), whether it's up, how fast it came down
  private footFloor = new Float32Array(64).fill(NaN);
  private footUp = new Uint8Array(64);
  private footFall = new Float32Array(64);
  private footAt = new Float32Array(64);
  private lastHand = new Float32Array(64);
  private handSpeed = new Float32Array(64);
  private nextDrip = 3;
  /** stones that may ring: a trickle while they dance, a flood when something happens (a blast, a rise, a swirl) */
  private budget = 0;
  private flood = 0;
  /** the stones' voices by specimen index (set from specimens.json) */
  stoneVoice: [Timbre, number][] = [];
  /** world → stereo pan (−1 … 1) */
  pan: (x: number, y: number, z: number) => number = () => 0;
  /** stones a second that ring while nothing much is happening */
  stoneRate = 1.8;

  constructor(public out: Sink) {}

  setStones(ids: string[]) { this.stoneVoice = ids.map((id) => VOICE_OF[id] ?? ['glass', 1]); }

  get chord() { return PROG[this.chordIx % PROG.length].map((n) => n + this.key); }
  /** a note of the pentatonic scale, `octave` octaves above the key's root, step 0 … 9 */
  note(step: number, octave: number) {
    const s = ((Math.floor(step) % 10) + 10) % 10;
    return this.key + 12 * octave + PENTA[s % 5] + 12 * Math.floor(s / 5);
  }

  /** a new key (a new piece): the bed moves at once */
  setKey(when: number, key: number) {
    this.key = key;
    this.chordIx = 0;
    this.nextChord = when;
  }

  /** once a frame: the bed, the room, the pointer, the bodies */
  frame(when: number, dt: number, h: Heard, dancers: { world: Float32Array; ears: Ears }[], floorY: number) {
    const o = this.out;
    if (when >= this.nextChord) {
      o.chord(when, this.chord);
      this.chordIx++;
      this.nextChord = when + CHORD_SECONDS;
    }
    this.e += (h.energy - this.e) * Math.min(1, dt * 1.5);
    o.energy(when, this.e);
    o.whoosh(when, h.sweep / 9, h.sweep / 12);
    o.drone(when, Math.pow(h.charge, 1.5), this.chord[0] + 12 + 2 * h.charge);
    this.flood = this.flood * Math.exp(-dt * 1.3) + h.sweep * dt * 3.5;
    this.budget = Math.min(26, this.budget + (this.stoneRate + this.flood) * dt);

    // drips in the cave: now and then a note far off
    if (when > this.nextDrip) {
      o.strike(when, 'crystal', this.note(this.r() * 7, 1), 0.04 + 0.06 * this.r(), this.r() * 1.6 - 0.8, 1.4);
      this.nextDrip = when + 4 + this.r() * 8;
    }

    dancers.forEach(({ world: w, ears }, d) => {
      // a foot lands: it was lifted off its floor and has come back down to it
      ears.feet.forEach((j, f) => {
        if (j < 0) return;
        const k = d * 2 + f, o12 = j * 12;
        const y = w[o12 + 1] - floorY, vy = w[o12 + 9];
        if (Number.isNaN(this.footFloor[k])) this.footFloor[k] = y;
        // the floor: the lowest it's been, creeping up if it stays high (a dancer on a step, a drift in the capture)
        this.footFloor[k] = y < this.footFloor[k] ? y : this.footFloor[k] + (y - this.footFloor[k]) * Math.min(1, dt * 0.08);
        const above = y - this.footFloor[k];
        if (above > 0.05) { this.footUp[k] = 1; this.footFall[k] = Math.max(this.footFall[k], -vy); }
        else if (this.footUp[k] && above < 0.022) {
          this.footUp[k] = 0;
          if (when - this.footAt[k] > 0.16) {
            const hard = Math.min(1, this.footFall[k] / 1.6);
            const pan = this.pan(w[o12], w[o12 + 1], w[o12 + 2]);
            this.out.strike(when, 'stone', this.chord[0] - 12, 0.18 + 0.45 * hard, pan, 0.6);
            if (hard > 0.55) this.out.strike(when, 'glass', this.chord[0] + 12, 0.12 * hard, pan, 1);
            this.footAt[k] = when;
          }
          this.footFall[k] = 0;
        }
      });
      // a hand flicks: its speed peaks above a threshold; the note is how high it is
      ears.hands.forEach((j, hnd) => {
        if (j < 0) return;
        const k = d * 2 + hnd, o12 = j * 12;
        const s = w[o12 + 3];
        const prev = this.handSpeed[k];
        if (prev > 2.4 && s < prev * 0.92 && when - this.lastHand[k] > 0.16 && this.r() < 0.55 + 0.4 * this.e) {
          const height = w[o12 + 1] - floorY;
          const step = Math.round(((height - 0.5) / 1.6) * 9);
          this.out.strike(when, 'crystal', this.note(step, 1), Math.min(0.45, 0.1 + prev * 0.05), this.pan(w[o12], w[o12 + 1], w[o12 + 2]), 0.9);
          this.lastHand[k] = when;
        }
        this.handSpeed[k] = s;
      });
    });
  }

  /** the stones the GPU heard this frame: [x, y, z, type] [specimen, strength, -, -] per event */
  stones(when: number, ev: Float32Array, n: number) {
    if (!n) return;
    // ring a few, chosen at random so a cascade keeps its texture; louder when there are fewer
    const ring = Math.min(n, Math.floor(this.budget));
    const loud = 1 / Math.sqrt(Math.max(1, n / 6));
    for (let i = 0; i < ring; i++) {
      const e = Math.floor(this.r() * n) * 8;
      const type = ev[e + 3], kind = ev[e + 4], strength = ev[e + 5];
      // clicking home is quiet work: only some of it is heard
      if (type > 2.5 && this.r() < 0.6) continue;
      const [timbre, oct] = this.stoneVoice[kind] ?? ['glass', 1];
      const step = Math.floor((Math.sin(ev[e] * 12.9898 + ev[e + 2] * 78.233) * 0.5 + 0.5) * 10);
      const pan = this.pan(ev[e], ev[e + 1], ev[e + 2]);
      const at = when + this.r() * 0.03;
      if (type < 1.5) this.out.strike(at, timbre, this.note(step, oct), Math.min(0.45, 0.05 + strength * 0.06) * loud, pan, 0.8); // landed
      else if (type < 2.5) this.out.strike(at, timbre, this.note(step + 2, oct), (0.05 + 0.09 * Math.min(1, strength)) * loud, pan, 0.9); // knocked off
      else this.out.strike(at, 'crystal', this.note(step, 1), 0.045 * loud, pan, 1); // clicked home
      this.budget -= 1;
    }
  }

  /** a blast (a released finger, a click, a shatter): a boom and the chord struck upwards */
  blast(when: number, strength: number) {
    const s = Math.min(1, strength / 4);
    this.out.boom(when, this.chord[0] - 12, 0.4 + 0.5 * s);
    this.chord.forEach((m, k) => this.out.strike(when + 0.06 * k, 'glass', m, 0.18 + 0.25 * s, (k / 3) * 1.2 - 0.6, 1));
    this.flood += 14 + 18 * s;
  }

  /** before anything moves (a film's opening): a bowl struck in the dark, then the bed comes in under it */
  prelude(when: number) {
    this.out.strike(when, 'glass', this.key, 0.32, -0.2, 1.3);
    this.out.strike(when + 1.6, 'glass', this.key + 7, 0.16, 0.3, 1.3);
    this.out.chord(when + 0.4, this.chord);
    this.out.energy(when, 0);
    this.chordIx++;
    this.nextChord = when + 0.4 + CHORD_SECONDS;
  }

  /** stones rising into a body: reversed bowls swelling up to the moment they arrive, then the boom */
  rise(when: number, seconds: number) {
    this.chord.forEach((m, k) => {
      this.out.strike(Math.max(when, when + seconds - ringLength('glass', m + 12)), 'glass', m + 12, 0.3, (k / 3) * 1.4 - 0.7, 1.1, true);
    });
    this.out.boom(when + seconds, this.chord[0] - 12, 0.4);
    this.flood += 16;
  }
}
