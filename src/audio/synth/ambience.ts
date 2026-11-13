// The place's own sounds (Gem Dancers): a room tone of very low brown noise, a fire's crackle off in the cave (the
// hearth), and in the redwoods wind in the canopy and the leaves, crickets at night and birds called up by the hour
// (thrushes most at dawn and dusk, the wren by day, the owl at night). With them, the hand's sounds: the pointer's
// whoosh, the drone a held finger swells, the boom of a release; and a breath of air for each moving hand of a player
// (the prototype's per-hand whooshes). All of it goes into the world's bus, under the place's water.
import { mulberry32 } from 'math/random';
import { noiseBuffer, crackleBuffer, cricketBuffer, renderBirds, mtof } from '../voices';
import type { Tone } from '../sound';
import type { Nodes } from './nodes';
import type { Mix } from './mix';
import type { Stones } from './stones';

export class Ambience {
  private hearth: GainNode;
  private windGain: GainNode;
  private leafGain: GainNode;
  private cricketGain: GainNode;
  private birdBus: GainNode;
  private birds: ReturnType<typeof renderBirds>;
  private birdRng = mulberry32.create(31);
  private lastAmbience = -1;
  private whooshFilter: BiquadFilterNode;
  private whooshGain: GainNode;
  private droneOscs: OscillatorNode[] = [];
  private droneGain: GainNode;
  private noise: AudioBuffer;
  private hands: { bp: BiquadFilterNode; wg: GainNode; pan: StereoPannerNode }[];
  private forest: number;

  constructor(private n: Nodes, private m: Mix, private stones: Stones, tone: Tone) {
    const ctx = n.ctx, dry = m.world, send = m.revIn;
    this.forest = tone.forest;
    // the wood: wind (gusting), leaves, crickets, birds
    const gust = new OscillatorNode(ctx, { frequency: 0.07 });
    gust.start(0);
    this.windGain = n.gn(0);
    const windSrc = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx, 6, true), loop: true });
    n.link(windSrc, n.bq('bandpass', 320, 0.6), this.windGain);
    windSrc.start(0);
    this.leafGain = n.gn(0);
    const leafSrc = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx, 4, false), loop: true });
    n.link(leafSrc, n.bq('bandpass', 3600, 0.9), this.leafGain);
    leafSrc.start(0);
    const sway = n.gn(1);
    n.link(gust, n.gn(0.6), sway.gain);
    this.windGain.connect(sway);
    this.leafGain.connect(sway);
    sway.connect(dry);
    this.cricketGain = n.gn(0);
    this.cricketGain.connect(dry);
    n.link(this.cricketGain, n.gn(0.3), send);
    [[4650, 2.4, -0.55, 3], [5150, 3.1, 0.6, 4], [4300, 1.9, 0.1, 5]].forEach(([f, cr, pan, seed]) => {
      const c = new AudioBufferSourceNode(ctx, { buffer: cricketBuffer(ctx, 5, f, cr, seed), loop: true });
      n.link(c, n.pan(pan), this.cricketGain);
      c.start(0);
    });
    this.birdBus = n.gn(1);
    this.birdBus.connect(dry);
    n.link(this.birdBus, n.gn(0.8), send);
    this.birds = renderBirds(ctx);

    // the room tone: brown noise, very low, a deep rumble
    this.noise = noiseBuffer(ctx, 4, false);
    const air = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer(ctx, 6, true), loop: true });
    n.link(air, n.bq('lowpass', 180), n.gn(0.011), dry);
    air.start(0);

    // the hearth: a fire's crackle, faint, somewhere off in the cave
    const fire = new AudioBufferSourceNode(ctx, { buffer: crackleBuffer(ctx, 9.7), loop: true });
    this.hearth = n.gn(0.06 * tone.hearth);
    n.link(fire, n.bq('bandpass', 1500, 0.6), this.hearth, dry);
    n.link(this.hearth, n.gn(0.5), send);
    fire.start(0);

    // the pointer's whoosh: a soft breath of band-passed noise whose level and pitch follow the swipe
    const w = new AudioBufferSourceNode(ctx, { buffer: this.noise, loop: true });
    this.whooshFilter = n.bq('bandpass', 500, 1.4);
    this.whooshGain = n.gn(0);
    n.link(w, this.whooshFilter, n.bq('lowpass', 2400), this.whooshGain, dry);
    n.link(this.whooshGain, n.gn(1.4), send);
    w.start(0);

    // a held finger: a root, its fifth and an octave, trembling, swelling with the charge
    this.droneGain = n.gn(0);
    const trem = n.gn(1);
    const lfo = new OscillatorNode(ctx, { frequency: 5.5 });
    n.link(lfo, n.gn(0.35), trem.gain);
    lfo.start(0);
    n.link(trem, this.droneGain, dry);
    n.link(this.droneGain, n.gn(1.2), send);
    for (const [type, gain] of [['sine', 0.5], ['sine', 0.3], ['triangle', 0.14]] as const) {
      const o = new OscillatorNode(ctx, { type, frequency: 220 });
      n.link(o, n.gn(gain), trem);
      o.start(0);
      this.droneOscs.push(o);
    }

    // a player's hands moving through the air (one each)
    this.hands = [0, 1].map(() => {
      const src = new AudioBufferSourceNode(ctx, { buffer: n.noiseBuf, loop: true });
      const bp = n.bq('bandpass', 600, 0.9), wg = n.gn(0), pan = n.pan(0);
      n.link(src, bp, wg, pan, m.fxBus);
      n.link(pan, n.gn(0.3), send);
      src.start(0, n.r());
      return { bp, wg, pan };
    });
  }

  setTone(t: number, tone: Tone) {
    this.forest = tone.forest;
    this.hearth.gain.setTargetAtTime(0.06 * tone.hearth, t, 0.2);
  }

  ambience(when: number, day: number, night: number, dawn: number, wind: number) {
    const f = this.forest;
    this.windGain.gain.setTargetAtTime(f * (0.012 + 0.03 * wind), when, 1.5);
    this.leafGain.gain.setTargetAtTime(f * 0.009 * wind, when, 1.5);
    this.cricketGain.gain.setTargetAtTime(f * night * 0.03, when, 2.5);
    const dt = this.lastAmbience < 0 ? 0.25 : Math.max(0, Math.min(1, when - this.lastAmbience));
    this.lastAmbience = when;
    if (f < 0.5) return;
    const rng = this.birdRng, r = () => mulberry32.sample(rng);
    const calls: [keyof ReturnType<typeof renderBirds>, number][] = [
      ['thrush', (0.04 + 0.22 * dawn) * day], ['varied', (0.02 + 0.1 * dawn) * day], ['wren', 0.035 * day * (1 - dawn * 0.5)], ['owl', 0.045 * night],
    ];
    for (const [kind, rate] of calls) {
      if (r() >= rate * dt) continue;
      const songs = this.birds[kind];
      const at = when + r() * dt;
      const src = new AudioBufferSourceNode(this.n.ctx, { buffer: songs[Math.floor(r() * songs.length)], playbackRate: 0.93 + 0.14 * r() });
      // somewhere off in the wood: further is quieter and duller
      const far = r();
      const p = this.n.pan((r() * 2 - 1) * 0.85);
      this.n.link(src, this.n.bq('lowpass', kind === 'owl' ? 900 : 9000 - 6000 * far), this.n.gn((kind === 'owl' ? 0.09 : 0.055) * (1 - 0.7 * far)), p, this.birdBus);
      src.onended = () => p.disconnect();
      src.start(at);
    }
  }

  whoosh(when: number, level: number, pitch: number) {
    this.whooshGain.gain.setTargetAtTime(Math.min(1, level) * 0.06, when, 0.12);
    this.whooshFilter.frequency.setTargetAtTime(160 + 520 * Math.min(1, pitch), when, 0.15);
  }

  drone(when: number, level: number, midi: number) {
    this.droneGain.gain.setTargetAtTime(Math.min(1, level) * 0.16, when, level > 0 ? 0.25 : 0.04);
    [0, 7, 12].forEach((iv, k) => this.droneOscs[k].frequency.setTargetAtTime(mtof(midi + iv), when, 0.3));
  }

  /** a deep hit: a stone bar way down, a thump of low noise */
  boom(when: number, midi: number, vel: number) {
    this.stones.strike(when, 'stone', midi, vel, 0, 0.8);
    this.stones.strike(when, 'stone', midi + 12, vel * 0.5, 0, 0.6);
    const n = new AudioBufferSourceNode(this.n.ctx, { buffer: this.noise });
    const g = this.n.gn(0);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.9 * vel, when + 0.01);
    g.gain.setTargetAtTime(0, when + 0.02, 0.25);
    this.n.link(n, this.n.bq('lowpass', 180), g, this.m.world);
    g.connect(this.m.revIn);
    n.start(when);
    n.stop(when + 2);
  }

  hand(t: number, i: number, amount: number, pan: number) {
    const w = this.hands[i & 1], a = Math.max(0, Math.min(1, amount));
    w.wg.gain.setTargetAtTime(a * 0.085, t, 0.05);
    w.bp.frequency.setTargetAtTime(350 + 2400 * a, t, 0.06);
    w.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.05);
  }
}
