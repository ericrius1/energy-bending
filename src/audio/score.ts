// What the bodies and the stones play (Gem Dancers' score, now in the engine's key and chord and on its grid). The
// dancers' feet strike the floor like a lithophone (a stone bar on the chord's root, harder the harder they land);
// a hand that flicks rings a crystal note by how high it is (players play the melody instead: conductor.ts); every
// stone the GPU reports landing, breaking off or clicking home rings in its own voice (geodes glass, crystals bright,
// pyrite metal) on a tone of the chord sounding then; drips fall in the cave; the pointer whooshes, a held finger
// drones and its release booms the chord. While the groove runs (engine.grooving) a note that falls just before a 16th
// waits for it (stoneWindow, default 45 ms), one just after a 16th sounds at once (it is already on the beat), and the
// rest play free; with no groove everything is free, as in Gem Dancers.
import { mulberry32 } from 'math/random';
import { ringLength, type Timbre } from './voices';
import { near, pc, type Harmony } from './harmony';
import type { Instrument } from './instrument';
import type { MusicClock } from './clock';
import { panOf, distOf, type Listener } from './spatial';
import { Gate } from './gate';

/** per specimen (in specimens.json order): its voice and register (octaves above the key's root): low, deep in the cave */
const VOICE_OF: Record<string, [Timbre, number]> = {
  amethyst: ['glass', 0], celestite: ['glass', 0], agate: ['glass', 0], citrine: ['crystal', 1], quartz: ['crystal', 1],
  emerald: ['crystal', 1], rose: ['crystal', 1], obsidian: ['glass', 0], malachite: ['stone', 0], pyrite: ['metal', 0],
  brilliant: ['crystal', 1],
};
/** keys the programmes move through (the root around the third octave) */
export const KEYS = [53, 50, 55, 52, 48, 57];

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

/** what the score needs of the engine: is the groove running, the clock, the bed's coming in */
export interface ScoreHost { readonly grooving: boolean; readonly clock: MusicClock; begin(t: number): void; setKey(key: number): void; bedEnergy: number }

export class Score {
  private e = 0;
  private rng = mulberry32.create(20261028);
  private r = () => mulberry32.sample(this.rng);
  private footFloor = new Float32Array(64).fill(NaN);
  private footUp = new Uint8Array(64);
  private footFall = new Float32Array(64);
  private footAt = new Float32Array(64);
  private lastHand = new Float32Array(64);
  private handSpeed = new Float32Array(64);
  private nextDrip = 3;
  private budget = 0;
  private flood = 0;
  private order = new Uint32Array(0);
  private gate = new Gate();
  stoneVoice: [Timbre, number][] = [];
  /** stones a second that ring while nothing much is happening */
  stoneRate = 1.8;
  /** how long (s) a note may wait for the next 16th when the groove runs */
  stoneWindow = 0.045;
  /** how late (s) after a 16th a note still counts as on it */
  stoneBehind = 0.012;
  /** notes put on the grid and left free since the start (the measurements read these) */
  readonly placed = { snapped: 0, free: 0, waited: 0 };

  constructor(public out: Instrument, private h: Harmony, private host: ScoreHost, public listener: Listener) {}

  /** the groove is running (so notes go on the grid) */
  get grooving() { return this.host.grooving; }

  setStones(ids: string[]) { this.stoneVoice = ids.map((id) => VOICE_OF[id] ?? ['glass', 1]); }

  /** a new piece: the mood moves to its key on the next bar line */
  setKey(_when: number, key: number) { this.host.setKey(key); }

  /** when a note made at t should sound: on the grid if the groove runs and a 16th is close, else at t */
  place(t: number) {
    if (!this.host.grooving) return t;
    const q = this.host.clock.quantise(t, this.stoneWindow, this.stoneBehind);
    if (q.snapped) { this.placed.snapped++; this.placed.waited += q.t - t; } else this.placed.free++;
    return q.t;
  }

  private pan(x: number, y: number, z: number) { return panOf(this.listener, x, y, z); }
  private dist(x: number, y: number, z: number) { return distOf(this.listener, x, y, z); }
  /** the chord's root near a midi note */
  private chordRoot(t: number, around: number) { return near(pc(this.h.at(t).chord.bass), around); }

  /** once a frame: the dancers' energy (it opens the bed), the room, the pointer, the bodies */
  frame(when: number, dt: number, heard: Heard, dancers: { world: Float32Array; ears: Ears; player: boolean }[], floorY: number) {
    const o = this.out, root = this.h.root;
    this.e += (heard.energy - this.e) * Math.min(1, dt * 1.5);
    this.host.bedEnergy = this.e;
    const wl = heard.sweep / 9, dl = Math.pow(heard.charge, 1.5), dm = this.chordRoot(when, root + 9) + 2 * heard.charge;
    if (this.gate.pass('whoosh', when, wl)) o.whoosh(when, wl, heard.sweep / 12);
    if (this.gate.pass('drone', when, dl, dm)) o.drone(when, dl, dm);
    this.flood = this.flood * Math.exp(-dt * 1.3) + heard.sweep * dt * 3.5;
    this.budget = Math.min(26, this.budget + (this.stoneRate + this.flood) * dt);

    // drips in the cave: now and then a note far off
    if (when > this.nextDrip) {
      o.strike(this.place(when), 'crystal', this.h.scale(this.r() * 7, 1), 0.04 + 0.06 * this.r(), this.r() * 1.6 - 0.8, 1.4);
      this.nextDrip = when + 4 + this.r() * 8;
    }

    dancers.forEach(({ world: w, ears, player }, d) => {
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
            const x = w[o12], yy = w[o12 + 1], z = w[o12 + 2], pan = this.pan(x, yy, z), dist = this.dist(x, yy, z);
            const at = this.place(when);
            // (around midi 38, where Gem Dancers' feet fell: measured, an octave higher lost the bed's bottom)
            o.strike(at, 'stone', this.chordRoot(at, 38), 0.18 + 0.45 * hard, pan, 0.6, false, dist);
            if (hard > 0.55) o.strike(at, 'glass', this.chordRoot(at, root + 9), 0.12 * hard, pan, 1, false, dist);
            this.footAt[k] = when;
          }
          this.footFall[k] = 0;
        }
      });
      // a hand flicks: its speed peaks above a threshold; the note is how high it is (a player's hands play the melody)
      if (player) return;
      ears.hands.forEach((j, hnd) => {
        if (j < 0) return;
        const k = d * 2 + hnd, o12 = j * 12;
        const s = w[o12 + 3];
        const prev = this.handSpeed[k];
        if (prev > 2.4 && s < prev * 0.92 && when - this.lastHand[k] > 0.16 && this.r() < 0.55 + 0.4 * this.e) {
          const height = w[o12 + 1] - floorY;
          const step = Math.round(((height - 0.5) / 1.6) * 9);
          const x = w[o12], yy = w[o12 + 1], z = w[o12 + 2];
          o.strike(this.place(when), 'crystal', this.h.scale(step, 1), Math.min(0.45, 0.1 + prev * 0.05), this.pan(x, yy, z), 0.9, false, this.dist(x, yy, z));
          this.lastHand[k] = when;
        }
        this.handSpeed[k] = s;
      });
    });
  }

  /** the stones the GPU heard this frame: [x, y, z, type] [specimen, strength, -, -] per event (type 1 landed,
   *  2 knocked off, 3 clicked home). Sorted first: the GPU appends them in whatever order its threads ran, and the
   *  choice of which ring must not depend on that, or two renders of one film would differ */
  stones(when: number, ev: Float32Array, n: number) {
    if (!n) return;
    if (this.order.length < n) this.order = new Uint32Array(Math.max(n, 256));
    const ord = this.order.subarray(0, n);
    for (let i = 0; i < n; i++) ord[i] = i;
    ord.sort((a, b) => (ev[a * 8 + 3] - ev[b * 8 + 3]) || (ev[a * 8] - ev[b * 8]) || (ev[a * 8 + 1] - ev[b * 8 + 1]) || (ev[a * 8 + 2] - ev[b * 8 + 2]));
    // ring a few, chosen at random so a cascade keeps its texture; louder when there are fewer
    const ring = Math.min(n, Math.floor(this.budget));
    const loud = 1 / Math.sqrt(Math.max(1, n / 6));
    const root = this.h.root;
    for (let i = 0; i < ring; i++) {
      const e = ord[Math.floor(this.r() * n)] * 8;
      const type = ev[e + 3], kind = ev[e + 4], strength = ev[e + 5];
      // clicking home is quiet work: only some of it is heard
      if (type > 2.5 && this.r() < 0.6) continue;
      const [timbre, oct] = this.stoneVoice[kind] ?? ['glass', 1];
      const step = Math.floor((Math.sin(ev[e] * 12.9898 + ev[e + 2] * 78.233) * 0.5 + 0.5) * 10);
      const pan = this.pan(ev[e], ev[e + 1], ev[e + 2]), dist = this.dist(ev[e], ev[e + 1], ev[e + 2]);
      const at = this.place(when + this.r() * 0.03);
      if (type < 1.5) this.out.strike(at, timbre, this.h.chordTone(at, root + 12 * oct, step), Math.min(0.45, 0.05 + strength * 0.06) * loud, pan, 0.8, false, dist); // landed
      else if (type < 2.5) this.out.strike(at, timbre, this.h.chordTone(at, root + 12 * oct, step + 2), (0.05 + 0.09 * Math.min(1, strength)) * loud, pan, 0.9, false, dist); // knocked off
      else this.out.strike(at, 'crystal', this.h.chordTone(at, root + 12, step), 0.045 * loud, pan, 1, false, dist); // clicked home
      this.budget -= 1;
    }
  }

  /** a blast (a released finger, a click, a shatter): a boom and the chord struck upwards */
  blast(when: number, strength: number) {
    const s = Math.min(1, strength / 4), ch = this.h.at(when).chord;
    this.out.boom(when, this.chordRoot(when, 38), 0.4 + 0.5 * s);
    ch.pad.forEach((m, k) => this.out.strike(when + 0.06 * k, 'glass', m, 0.18 + 0.25 * s, (k / 3) * 1.2 - 0.6, 1));
    this.flood += 14 + 18 * s;
  }

  /** before anything moves (a film's opening): a bowl struck in the dark, then the bed comes in under it */
  prelude(when: number) {
    const root = this.h.root;
    this.out.strike(when, 'glass', root, 0.32, -0.2, 1.3);
    this.out.strike(when + 1.6, 'glass', root + 7, 0.16, 0.3, 1.3);
    this.host.begin(when + 0.4);
  }

  /** stones rising into a body: reversed bowls swelling up to the moment they arrive, then the boom */
  rise(when: number, seconds: number) {
    const ch = this.h.at(when + seconds).chord;
    ch.pad.forEach((m, k) => {
      this.out.strike(Math.max(when, when + seconds - ringLength('glass', m + 12)), 'glass', m + 12, 0.3, (k / 3) * 1.4 - 0.7, 1.1, true);
    });
    this.out.boom(when + seconds, this.chordRoot(when + seconds, 38), 0.4);
    this.flood += 16;
  }
}
