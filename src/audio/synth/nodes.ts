// Small Web Audio helpers every part of the synth builds with: an oscillator that starts and stops, a gain, a filter,
// an envelope, a chain of nodes, a burst of noise. They are the prototype's `_o`, `_gn`, `_bq`, `_envG`, `_link`,
// `_noiseL` and `_path`, bound to one context and one seeded random generator: nothing here calls Math.random, so a
// replayed score makes the same sound (the noise is the same buffer read from the same places).
import { mulberry32 } from 'math/random';

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export class Nodes {
  readonly ctx: BaseAudioContext;
  /** two seconds of white noise, read from random places */
  readonly noiseBuf: AudioBuffer;
  private rng: ReturnType<typeof mulberry32.create>;

  constructor(ctx: BaseAudioContext, seed: number) {
    this.ctx = ctx;
    this.rng = mulberry32.create(seed);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = this.r() * 2 - 1;
  }

  /** a random number 0 … 1 (seeded) */
  r() { return mulberry32.sample(this.rng); }

  o(type: OscillatorType, f: number, t0: number, t1: number) {
    const o = new OscillatorNode(this.ctx, { type, frequency: f });
    o.start(t0); o.stop(t1);
    return o;
  }
  /** an oscillator started at t whose stop the caller sets (once it knows the tail) */
  on(type: OscillatorType, f: number, t: number) {
    const o = new OscillatorNode(this.ctx, { type, frequency: f });
    o.start(t);
    return o;
  }
  gn(v = 1) { return new GainNode(this.ctx, { gain: v }); }
  bq(type: BiquadFilterType, f: number, q = 0.7) { return new BiquadFilterNode(this.ctx, { type, frequency: f, Q: q }); }
  pan(v: number) { return new StereoPannerNode(this.ctx, { pan: clamp(v, -1, 1) }); }

  /** a percussive envelope: from the floor up to `peak` in `a` seconds, then down to the floor over `d` */
  env(p: AudioParam, t: number, peak: number, a: number, d: number, floor = 0.0008) {
    p.setValueAtTime(floor, t);
    p.exponentialRampToValueAtTime(Math.max(peak, floor * 2), t + a);
    p.exponentialRampToValueAtTime(floor, t + a + d);
  }
  envG(t: number, peak: number, a: number, d: number) { const g = this.gn(0); this.env(g.gain, t, peak, a, d); return g; }

  /** connect a chain of nodes in order (the last may be a parameter: a modulator); returns the last */
  link<T extends AudioNode | AudioParam>(...n: [...AudioNode[], T]): T {
    for (let i = 0; i < n.length - 1; i++) (n[i] as AudioNode).connect(n[i + 1] as AudioNode);
    return n[n.length - 1] as T;
  }

  /** noise for `dur` seconds from t, looping (so a long noise is never cut short by the buffer's end) */
  noiseL(t: number, dur: number) {
    const s = new AudioBufferSourceNode(this.ctx, { buffer: this.noiseBuf, loop: true });
    s.start(t, this.r() * 1.9); s.stop(t + dur + 0.05);
    return s;
  }
  /** a short noise (not looping) */
  noise(t: number, dur: number) {
    const s = new AudioBufferSourceNode(this.ctx, { buffer: this.noiseBuf });
    s.start(t, this.r() * 1.5, dur + 0.05);
    return s;
  }

  /** a parameter along [dt, value] points, exponential between them */
  path(p: AudioParam, t: number, pts: [number, number][]) {
    p.setValueAtTime(pts[0][1], t + pts[0][0]);
    for (let i = 1; i < pts.length; i++) p.exponentialRampToValueAtTime(pts[i][1], t + pts[i][0]);
  }

  /** distance: a gentle drop in level, a roll-off of the highs and more of the room → [input, output, extra reverb] */
  distance(dist: number): [AudioNode, AudioNode, number] {
    const d = clamp(dist, 0, 1), g = this.gn(1 - 0.5 * d), lp = this.bq('lowpass', 20000 * Math.pow(0.12, d), 0.5);
    g.connect(lp);
    return [g, lp, 0.35 * d];
  }
}
