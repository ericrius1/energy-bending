// The jogo's larger moments, as sound (the prototype's fusion and tension). A fusion lands like a drop and then holds
// one of four textures for eight bars on a bus of its own (with its own amount of room), which fades back into the
// groove over a bar: steam (a warm breath, wide saws), prism (glass arpeggios up and down the chord), storm (a rolling
// sub and tom fills), aurora (suspended chords two bars long, slow bells). The engine decides when; this plays each
// step's part. Tension is a pulsing string ostinato climbing the chord's tones, a pedal on the key's root, shaker 16ths
// and hand-drum fills into each bar line, louder and brighter as the shared tension rises.
import { fpad, tone, voice } from './tonal';
import { shaker, tom, crash } from './drums';
import { atabaque } from './capoeira';
import { mtof, type Nodes } from './nodes';
import type { Mix } from './mix';
import type { FusionKind } from '../instrument';
import { near, notes, type Harm } from '../harmony';

/** each fusion's share of the room */
const FUSION_REV: Record<FusionKind, number> = { steam: 0.35, prism: 0.45, storm: 0.15, aurora: 0.7 };

export class Moments {
  private fus: GainNode | null = null;
  private tens: { filt: BiquadFilterNode; gate: GainNode; bus: GainNode; pedal: GainNode; oscs: OscillatorNode[]; ped: OscillatorNode[] } | null = null;

  constructor(private n: Nodes, private m: Mix) {}

  /** a fusion begins: its own bus under the duck, its own send to the room */
  fusionOn(t: number, kind: FusionKind) {
    if (this.fus) this.fusionFade(t, 0.15);
    const bus = this.n.gn(1);
    bus.connect(this.m.duck);
    this.n.link(bus, this.n.gn(FUSION_REV[kind]), this.m.grooveRev);
    this.fus = bus;
  }

  fusionFade(t: number, tau: number) { this.fus?.gain.setTargetAtTime(0.0001, t, tau); }

  /** the moment it lands */
  fusionHit(t: number, kind: FusionKind, H: Harm) {
    const n = this.n, out = n.gn(1);
    out.connect(this.m.fxBus);
    n.link(out, n.gn(0.5), this.m.revIn);
    const ch0 = H.mood.chords[0];
    if (kind === 'steam') {
      const lp = n.bq('lowpass', 3000, 0.7);
      lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(380, t + 1.6);
      n.link(n.noiseL(t, 1.8), lp, n.envG(t, 0.16, 0.02, 1.6), out);
    } else if (kind === 'prism') {
      const ns = notes(ch0.tones, 84, 6);
      for (let i = 0; i < 12; i++) tone(n, out, t + i * 0.04, ns[(i * 2) % ns.length], 'ice', 0.05 * (1 - i / 14), 0.002, 0.5);
    } else if (kind === 'storm') {
      const o = n.o('sine', 62, t, t + 1.8); o.frequency.exponentialRampToValueAtTime(30, t + 1.5);
      n.link(o, n.envG(t, 0.32, 0.004, 1.4), out);
      n.link(n.noiseL(t, 1.6), n.bq('lowpass', 160, 1), n.envG(t, 0.35, 0.01, 1.4), out);
    } else {
      n.link(n.o('sine', mtof(ch0.bass + 12), t, t + 3), n.envG(t, 0.16, 0.02, 2.6), out);
      crash(n, this.m, t + 0.01, 0.25);
    }
  }

  /** one step of the fusion's texture: fm is how much of it is left (1 … 0 as it fades), fb the bar within it */
  fusionStep(t: number, kind: FusionKind, fm: number, fb: number, s16: number, rel: number, H: Harm, sd: number) {
    const n = this.n, bus = this.fus, ch = H.chord, barDur = sd * 16;
    if (!bus) return;
    if (kind === 'steam') {
      if (s16 === 0) {
        fpad(n, bus, t, [...ch.pad, ch.pad[0] + 12], barDur, { types: ['sawtooth', 'sawtooth'], cut: 1600, peak: 0.04 * fm, attack: 0.3, spread: 0.9, det: 14 });
        if (fb % 2 === 0) { // a warm breath of steam across two bars
          const g = n.gn(0), P = g.gain;
          P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(0.05 * fm + 0.001, t + barDur); P.exponentialRampToValueAtTime(0.0008, t + barDur * 2);
          n.link(n.noiseL(t, barDur * 2), n.bq('bandpass', 700, 0.6), g, bus);
        }
      }
      if (s16 % 8 === 6) voice(n, this.m, t, 4, ch.pad[(s16 >> 3) + 1] + 12, 0.12 * fm, sd * 3, s16 < 8 ? -0.5 : 0.5);
    } else if (kind === 'prism') {
      const seq = [0, 1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1];
      const ns = [...ch.pad, ...ch.pad.map((p) => p + 12), ch.pad[0] + 24];
      voice(n, this.m, t, s16 % 2 ? 3 : 2, ns[seq[s16]] + 12, (s16 % 4 === 0 ? 0.15 : 0.1) * fm, sd * 1.5, Math.sin(rel * 0.7) * 0.7);
      if (s16 === 0) fpad(n, bus, t, ch.pad.map((p) => p + 12), barDur, { types: ['triangle', 'sine'], cut: 5000, peak: 0.025 * fm, attack: 0.1, spread: 0.8, det: 6 });
      if (s16 === 14 && fb % 2 === 1) for (let i = 0; i < 4; i++) voice(n, this.m, t + i * sd / 2, 2, ns[8 - i] + 24, 0.08 * fm, sd, 0.6 - i * 0.4);
    } else if (kind === 'storm') {
      if (s16 === 0) {
        const g = n.gn(0), P = g.gain;
        P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(0.14 * fm + 0.001, t + barDur * 0.7); P.exponentialRampToValueAtTime(0.0008, t + barDur + 0.1);
        n.link(n.noiseL(t, barDur + 0.15), n.bq('lowpass', 160, 1), g, bus);
        fpad(n, bus, t, ch.pad.map((p) => p - 12), barDur, { types: ['sawtooth', 'square'], cut: 700, peak: 0.03 * fm, attack: 0.05, spread: 0.5, det: 9 });
      }
      if (fb % 2 === 1 && s16 >= 12) {
        const ns = notes(ch.tones, ch.bass + 12, 4);
        tom(n, this.m, t, ns[15 - s16], 0.55 * fm, (s16 - 13.5) * 0.4);
      }
    } else { // aurora: suspended (sus2) chords two bars long, slow bells on the half-time beats
      if (s16 === 0 && fb % 2 === 0) {
        const r = ch.bass + 24;
        fpad(n, bus, t, [r, r + 7, r + 12, r + 14, r + 19], barDur * 2, { types: ['triangle', 'sine'], cut: 2600, peak: 0.04 * fm, attack: 0.9, spread: 1, det: 8 });
      }
      if (s16 === 0 || s16 === 8) {
        const ns = notes(ch.tones, 79, 4);
        voice(n, this.m, t, 3, ns[(fb * 2 + (s16 >> 3)) % ns.length], 0.14 * fm, sd * 8, s16 ? 0.5 : -0.5);
      }
    }
  }

  private ensureTension() {
    const n = this.n;
    const filt = n.bq('lowpass', 800, 2.2), gate = n.gn(1), bus = n.gn(0), pedal = n.gn(0);
    const mk = (type: OscillatorType, det: number) => { const o = new OscillatorNode(n.ctx, { type, detune: det, frequency: 220 }); o.start(); return o; };
    const oscs = [mk('sawtooth', -11), mk('sawtooth', 10), mk('square', 0)];
    oscs.forEach((o, i) => n.link(o, n.gn(i === 2 ? 0.3 : 0.5), filt));
    n.link(filt, gate, bus, this.m.duck);
    n.link(bus, n.gn(0.15), this.m.grooveRev);
    const pl = n.bq('lowpass', 380, 0.7);
    const ped = [mk('sine', 0), mk('triangle', 0)];
    ped[0].connect(pl); n.link(ped[1], n.gn(0.35), pl);
    n.link(pl, pedal, this.m.duck);
    return (this.tens = { filt, gate, bus, pedal, oscs, ped });
  }

  /** one step of tension T (0 … 1) at level L; quiet in a drop's suck or a fusion */
  tension(t: number, T: number, s16: number, L: number, quiet: boolean, H: Harm, sd: number) {
    const X = this.tens ?? this.ensureTension(), on = T > 0.02 && !quiet;
    X.bus.gain.setTargetAtTime(on ? 0.02 + 0.1 * T : 0, t, 0.25);
    X.pedal.gain.setTargetAtTime(on && T > 0.25 ? 0.16 * (T - 0.25) / 0.75 : 0, t, 0.5);
    if (!on) return;
    if (s16 % 4 === 0) {
      const ns = notes(H.chord.tones, 64, 4);
      const f = mtof(ns[Math.min(3, Math.floor(T * 3.6))]);
      X.oscs.forEach((o, i) => o.frequency.setTargetAtTime(f * (i === 2 ? 0.5 : 1), t, 0.02));
      const pf = mtof(near(H.mood.pent[0], 38));
      X.ped[0].frequency.setTargetAtTime(pf, t, 0.05); X.ped[1].frequency.setTargetAtTime(pf * 2, t, 0.05);
    }
    X.filt.frequency.setTargetAtTime(400 + 4200 * T * T + 200 * Math.max(0, L), t, 0.08);
    if (T >= 0.5 || s16 % 2 === 0) {
      X.gate.gain.setValueAtTime(1, t);
      X.gate.gain.setTargetAtTime(0.15 + 0.25 * (1 - T), t + 0.012, sd * 0.3);
    }
    if (T > 0.35 && L >= 1 && s16 % 2 === 1) shaker(this.n, this.m, t, 0.05 + 0.12 * T);
    if (T > 0.7 && L >= 1 && s16 >= 12 && (s16 % 2 === 0 || T > 0.85)) atabaque(this.n, this.m, t, s16 === 15 ? 'slap' : 'open', 0.2 + 0.35 * T, -0.25);
  }
}
