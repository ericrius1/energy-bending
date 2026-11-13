// The stones' voices (Gem Dancers' instrument): four struck sounds rendered once per base pitch (voices.ts) and
// played by playback rate, a glass bowl's reversed swell for a rise, each through a panner into the world's bus (under
// the place's water) with a send to the room. A cap on sounding voices keeps a cascade from piling up; it counts by
// each note's own end time, so it holds the same way live and offline (where everything is scheduled up front).
import { VOICES, nearestBase, ringLength, renderVoice, type Timbre } from '../voices';
import type { Nodes } from './nodes';
import type { Mix } from './mix';

export class Stones {
  private bank = new Map<string, AudioBuffer>();
  private ends: number[] = [];
  maxVoices = 56;

  constructor(private n: Nodes, private m: Mix) {
    const ctx = n.ctx, rate = ctx.sampleRate;
    (Object.keys(VOICES) as Timbre[]).forEach((t, k) => VOICES[t].bases.forEach((base) => {
      const data = renderVoice(rate, VOICES[t], base, 11 + k * 7 + base);
      const b = ctx.createBuffer(1, data.length, rate);
      b.getChannelData(0).set(data);
      this.bank.set(`${t}${base}`, b);
      if (t === 'glass') {
        const r = ctx.createBuffer(1, data.length, rate);
        r.getChannelData(0).set(data.slice().reverse());
        this.bank.set(`glass.rev${base}`, r);
      }
    }));
  }

  strike(when: number, timbre: Timbre, midi: number, vel: number, pan: number, wet = 0.5, reverse = false, dist = 0) {
    if (vel < 0.01) return;
    if (this.ends.length >= this.maxVoices) {
      this.ends = this.ends.filter((e) => e > when);
      if (this.ends.length >= this.maxVoices) return;
    }
    const v = VOICES[timbre];
    const base = nearestBase(v, midi);
    const buf = this.bank.get(reverse ? `glass.rev${base}` : `${timbre}${base}`)!;
    const src = new AudioBufferSourceNode(this.n.ctx, { buffer: buf, playbackRate: Math.pow(2, (midi - base) / 12) });
    const g = this.n.gn(Math.min(1, vel) * v.gain);
    src.connect(g);
    const p = this.m.route(g, this.m.world, pan, wet, 0, dist);
    this.ends.push(when + ringLength(timbre, midi));
    src.onended = () => p.disconnect();
    src.start(Math.max(when, 0));
  }
}
