// The live sound: an AudioContext (made at the first touch, as browsers ask), the Synth on it, and a timer that
// keeps the scheduler fed. The scheduler looks 120 ms ahead normally (so the players' notes stay tight), more after a
// janky frame or while the tab is hidden, so a throttled main thread never leaves a gap; a Worker's timer keeps
// ticking in a background tab, where the page's own timers drop to once a second. `heardTime` is what is coming out
// of the speakers now (the context's time less the output latency), for judging a move against the beat.
import { Synth } from './synth/synth';
import type { Tone } from './sound';

export class Live {
  readonly ctx: AudioContext;
  readonly synth: Synth;
  lookahead = 0.12;
  /** the host sets this from page visibility: a longer lookahead while hidden */
  hidden = false;
  private timer: ReturnType<typeof setInterval>;
  private worker: Worker | null = null;
  private jank = 0;
  private lastTick: number | null = null;
  private td: Float32Array<ArrayBuffer> | null = null;

  constructor(tone: Tone, private onTick: (cur: number, until: number) => void) {
    // iOS: play through the ring/silent switch, like any music app
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.synth = new Synth(this.ctx, tone);
    void this.ctx.resume();
    this.timer = setInterval(() => this.tick(), 25);
    try {
      const src = 'let i=0;onmessage=e=>{clearInterval(i);if(e.data>0)i=setInterval(()=>postMessage(0),e.data)}';
      this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this.worker.onmessage = () => this.tick();
      this.worker.postMessage(25);
    } catch { this.worker = null; }
  }

  get time() { return this.ctx.currentTime; }

  /** feed the scheduler up to the lookahead (from the timers, and from each frame) */
  tick() {
    if (this.ctx.state !== 'running') return;
    const pn = performance.now();
    if (this.lastTick != null) {
      const gap = Math.max(0, pn - this.lastTick);
      this.jank = Math.max(gap, this.jank * Math.exp(-gap / 6000));
    }
    this.lastTick = pn;
    let la = Math.max(0.12, Math.min(1.5, this.jank * 0.00125 + 0.04));
    if (this.hidden) la = Math.max(la, 1.0);
    this.lookahead = la;
    const cur = this.ctx.currentTime;
    this.onTick(cur, cur + la);
  }

  /** the context's time being heard now (or at performance time `perfMs`, an input event's timeStamp) */
  heardTime(perfMs?: number) {
    const ctx = this.ctx, p0 = performance.now(), pn = perfMs ?? p0;
    let base: number;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime! > 0 && ts.performanceTime! > 0 && ts.contextTime! > ctx.currentTime - 1 && ts.contextTime! <= ctx.currentTime + 0.05) {
      base = ts.contextTime! + (p0 - ts.performanceTime!) / 1000;
    } else base = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    return base + (pn - p0) / 1000;
  }

  /** the output's level now: after the limiter ('out', what is heard) or before it ('pre': peaks near 1 mean it works hard) */
  levelMeter(which: 'out' | 'pre' = 'out') {
    const an = which === 'pre' ? this.synth.mix.preAnalyser : this.synth.mix.analyser;
    this.td ??= new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(this.td);
    let s = 0, pk = 0;
    for (let i = 0; i < this.td.length; i++) { const v = this.td[i]; s += v * v; pk = Math.max(pk, Math.abs(v)); }
    return { rms: Math.sqrt(s / this.td.length), peak: pk };
  }

  stop() {
    clearInterval(this.timer);
    this.worker?.terminate();
    void this.ctx.close();
  }
}
