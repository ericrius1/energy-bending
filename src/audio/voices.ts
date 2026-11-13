// The instrument's raw sounds, rendered once into buffers (Gem Dancers' audio.ts, first half): four struck voices
// pitched by playback rate ("glass" a singing bowl, "crystal" a bright bell, "stone" a lithophone bar for footsteps,
// "metal" pyrite), a stereo hall, noise, a fire's crackle, birdsong and crickets for the redwoods. The synth
// (synth/stones.ts, synth/ambience.ts, synth/mix.ts) plays them. All seeded: the same buffers every time.
import { mulberry32 } from 'math/random';

export type Timbre = 'glass' | 'crystal' | 'stone' | 'metal';

/** a struck voice: partials as [ratio, amplitude, decay (s), beat (Hz)], rendered at each of `bases` (midi) for `len`
 *  seconds; a note plays from the nearest base, within half an octave, so no partial is ever pitched past hearing */
export interface Voice { bases: number[]; len: number; gain: number; click: number; partials: [number, number, number, number][] }
export const VOICES: Record<Timbre, Voice> = {
  // a bowl's modes are inharmonic and come in close pairs, so they beat: the slow shimmer of a rubbed glass
  glass: { bases: [48, 60, 72, 84], len: 4.2, gain: 0.55, click: 0, partials: [[1, 1, 3.4, 0.7], [2.71, 0.42, 1.9, 1.3], [5.05, 0.2, 0.95, 2.1], [8.03, 0.09, 0.45, 0], [11.6, 0.04, 0.24, 0]] },
  crystal: { bases: [60, 72, 84, 96], len: 2.6, gain: 0.42, click: 0, partials: [[1, 1, 1.7, 0], [2.02, 0.12, 0.9, 0.4], [3, 0.24, 0.55, 0], [4.07, 0.13, 0.32, 0], [6.5, 0.05, 0.14, 0]] },
  // a struck bar (lithophone): the fundamental, two stretched overtones and the knock of the mallet
  stone: { bases: [36, 48, 60, 72], len: 1.8, gain: 0.9, click: 0.35, partials: [[1, 1, 0.75, 0], [3.93, 0.3, 0.2, 0], [9.2, 0.08, 0.06, 0]] },
  metal: { bases: [48, 60, 72], len: 3.4, gain: 0.32, click: 0.05, partials: [[1, 1, 2.4, 0.5], [1.52, 0.62, 1.8, 0.9], [2.13, 0.45, 1.3, 0], [2.74, 0.3, 0.95, 1.6], [3.33, 0.2, 0.7, 0], [4.5, 0.1, 0.4, 0]] },
};
// the highest a partial may be rendered: pitched up half an octave it stays under ~15 kHz
const TOP = 10500;

export const nearestBase = (v: Voice, midi: number) => v.bases.reduce((a, b) => (Math.abs(b - midi) < Math.abs(a - midi) ? b : a));
/** how long a struck note rings (its buffer, at that pitch), in seconds */
export const ringLength = (t: Timbre, midi: number) => VOICES[t].len / Math.pow(2, (midi - nearestBase(VOICES[t], midi)) / 12);

/** one struck voice at one base pitch, as samples at the context's rate */
export function renderVoice(rate: number, v: Voice, base: number, seed: number) {
  const n = Math.ceil(v.len * rate);
  const out = new Float32Array(n);
  const f0 = 440 * Math.pow(2, (base - 69) / 12);
  const rng = mulberry32.create(seed);
  for (const [r, a, d, beat] of v.partials) {
    if (f0 * r > TOP) continue;
    const w = (2 * Math.PI * f0 * r) / rate, ph = mulberry32.sample(rng) * 6.283;
    const k = Math.exp(-1 / (d * rate));
    let env = a;
    for (let i = 0; i < n; i++) {
      const b = beat ? 0.75 + 0.25 * Math.cos((2 * Math.PI * beat * i) / rate) : 1;
      out[i] += env * b * Math.sin(w * i + ph);
      env *= k;
    }
  }
  // the mallet: a few milliseconds of low-passed noise
  if (v.click) {
    let lp = 0;
    for (let i = 0; i < Math.min(n, rate * 0.03); i++) {
      lp += (mulberry32.sample(rng) * 2 - 1 - lp) * 0.25;
      out[i] += lp * v.click * Math.exp(-i / (rate * 0.006));
    }
  }
  // a 2 ms attack and a short fade at the end, then normalise
  let peak = 0;
  const att = rate * 0.002, tail = rate * 0.05;
  for (let i = 0; i < n; i++) {
    if (i < att) out[i] *= i / att;
    if (i > n - tail) out[i] *= (n - i) / tail;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < n; i++) out[i] *= 0.9 / peak;
  return out;
}

/** a stereo hall: decorrelated noise under an exponential decay that darkens as it goes, after `pre` seconds;
 *  `bright` is how open the tail starts (0.85 is Gem Dancers' cave: it closes to 0.1 by the end) */
export function renderRoom(ctx: BaseAudioContext, seconds: number, rt60: number, preDelay: number, bright = 0.85) {
  const rate = ctx.sampleRate, n = Math.ceil(seconds * rate);
  const ir = ctx.createBuffer(2, n, rate);
  const rng = mulberry32.create(7);
  const pre = Math.floor(rate * preDelay);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / rate;
      const k = bright - (bright - 0.1) * Math.min(1, t / seconds); // the tail loses its highs
      lp += (mulberry32.sample(rng) * 2 - 1 - lp) * k;
      d[i] = lp * Math.pow(10, (-3 * t) / rt60) * (t < 0.08 ? 0.6 + 5 * t : 1);
    }
  }
  return ir;
}

export function noiseBuffer(ctx: BaseAudioContext, seconds: number, brown: boolean) {
  const n = Math.ceil(seconds * ctx.sampleRate);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  const rng = mulberry32.create(brown ? 3 : 5);
  let x = 0;
  for (let i = 0; i < n; i++) {
    const w = mulberry32.sample(rng) * 2 - 1;
    x = brown ? (x + 0.02 * w) * 0.998 : w;
    d[i] = brown ? x * 3.5 : w;
  }
  // loop seamlessly: crossfade the end into the start
  const fade = Math.floor(ctx.sampleRate * 0.1);
  for (let i = 0; i < fade; i++) { const u = i / fade; d[n - fade + i] = d[n - fade + i] * (1 - u) + d[i] * u; }
  return b;
}

/** a fire somewhere in the cave: sparse crackles of a few milliseconds, most of them tiny, some in little clusters */
export function crackleBuffer(ctx: BaseAudioContext, seconds: number) {
  const rate = ctx.sampleRate, n = Math.ceil(seconds * rate);
  const b = ctx.createBuffer(2, n, rate);
  const rng = mulberry32.create(9);
  const r = () => mulberry32.sample(rng);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let t = r() * 0.2;
    while (t < seconds - 0.05) {
      const at = Math.floor(t * rate), len = Math.floor(rate * (0.002 + 0.006 * r())), amp = 0.05 + 0.9 * r() * r() * r();
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += (r() * 2 - 1 - lp) * 0.6;
        d[at + i] += lp * amp * Math.exp(-i / (len * 0.3));
      }
      t += r() < 0.3 ? 0.01 + r() * 0.04 : 0.08 + r() * 0.35;
    }
  }
  return b;
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** a note of birdsong: start (s), length (s), its pitch gliding from → to (Hz), a warble (Hz, a flute's quaver) and a
 *  buzz (Hz, the varied thrush's rasp) */
type Note = [number, number, number, number, number, number];

/** a phrase of birdsong rendered into a buffer: each note a gliding whistle with a soft breath of harmonics */
export function renderSong(ctx: BaseAudioContext, notes: Note[]) {
  const rate = ctx.sampleRate;
  const seconds = notes.reduce((m, [t0, len]) => Math.max(m, t0 + len), 0) + 0.05;
  const n = Math.ceil(seconds * rate);
  const b = ctx.createBuffer(1, n, rate);
  const d = b.getChannelData(0);
  for (const [t0, len, f0, f1, warble, buzz] of notes) {
    const i0 = Math.floor(t0 * rate), m = Math.floor(len * rate);
    let ph = 0;
    for (let i = 0; i < m && i0 + i < n; i++) {
      const u = i / m, tt = i / rate;
      const f = f0 + (f1 - f0) * u + (warble ? Math.sin(2 * Math.PI * warble * tt) * f0 * 0.05 : 0);
      ph += (2 * Math.PI * f) / rate;
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.6) * (u < 0.87 ? 1 : 1 - (u - 0.87) / 0.13);
      const am = buzz ? 0.5 + 0.5 * Math.sin(2 * Math.PI * buzz * tt) : 1;
      d[i0 + i] += env * am * (Math.sin(ph) + 0.16 * Math.sin(2 * ph) + 0.05 * Math.sin(3 * ph));
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < n; i++) d[i] *= 0.85 / (peak || 1);
  return b;
}

/** the songs: two of a Swainson's thrush (a fluting spiral upward), two of a varied thrush (one long buzzing whistle),
 *  a Pacific wren's tumbling trill, a great horned owl */
export function renderBirds(ctx: BaseAudioContext): Record<'thrush' | 'varied' | 'wren' | 'owl', AudioBuffer[]> {
  const spiral = (f: number, k: number): Note[] => [[0, 0.13, f * 0.75, f * 0.72, 0, 0],
    ...Array.from({ length: k }, (_, i): Note => [0.18 + i * 0.1, 0.085, f * (1 + i * 0.16), f * (1.18 + i * 0.17), 38 + i * 3, 0])];
  const rng = mulberry32.create(21);
  const r = () => mulberry32.sample(rng);
  const wren: Note[] = [];
  for (let t = 0, motif = 0; t < 3.2; motif++) {
    const base = 3200 + r() * 2600, reps = 3 + Math.floor(r() * 4);
    for (let i = 0; i < reps && t < 3.2; i++, t += 0.052) wren.push([t, 0.032, base * (1 + (i % 2) * 0.12), base * (1.08 + (i % 2) * 0.1), 0, 0]);
    t += 0.02;
  }
  const hoo = (t: number, len: number): Note => [t, len, 395, 360, 0, 0];
  return {
    thrush: [renderSong(ctx, spiral(2000, 6)), renderSong(ctx, spiral(2300, 5))],
    varied: [renderSong(ctx, [[0, 1.5, 3150, 3080, 0, 92]]), renderSong(ctx, [[0, 1.3, 2450, 2400, 0, 84]])],
    wren: [renderSong(ctx, wren)],
    owl: [renderSong(ctx, [hoo(0, 0.32), hoo(0.55, 0.16), hoo(0.76, 0.2), hoo(1.25, 0.36), hoo(1.85, 0.42)])],
  };
}

/** a cricket, looping: chirps of three pulses of a high whistle, `rate` chirps a second */
export function cricketBuffer(ctx: BaseAudioContext, seconds: number, freq: number, rate: number, seed: number) {
  const sr = ctx.sampleRate, n = Math.ceil(seconds * sr);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  const rng = mulberry32.create(seed);
  for (let t = mulberry32.sample(rng) * 0.2; t < seconds - 0.1; t += 1 / rate + (mulberry32.sample(rng) - 0.5) * 0.04) {
    for (let p = 0; p < 3; p++) {
      const i0 = Math.floor((t + p * 0.03) * sr), m = Math.floor(0.018 * sr);
      for (let i = 0; i < m; i++) {
        const u = i / m, ph = (2 * Math.PI * freq * (i0 + i)) / sr;
        d[i0 + i] += Math.sin(Math.PI * u) * (Math.sin(ph) + 0.3 * Math.sin(2 * ph));
      }
    }
  }
  return b;
}
