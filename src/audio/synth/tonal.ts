// The pitched parts of the synth. The pad: the one chord bed (Gem Dancers' slow swell of detuned saws when nothing is
// dancing, the groove's pad when it is; one instrument, so the two can never fight), with the sub under its root.
// The bass: a saw and a sine through a resonant low-pass that closes after the attack. The melodic voices (the
// prototype's palettes: pluck, kalimba, glass, bell, soft pluck, marimba, reed), a note in an element's colour (fire's
// warm saws, plasma's shivering saw and square, water's round sine, ice's glassy partials), and the fusion's pads.
import { mtof, type Nodes } from './nodes';
import type { Mix } from './mix';
import type { Element } from '../instrument';

/** the four pad voices' places in the stereo field (the prototype's) */
const PAD_PAN = [-0.6, 0.25, -0.2, 0.6];

export class Pad {
  private voices: { oscs: OscillatorNode[]; amp: GainNode }[] = [];
  private filter: BiquadFilterNode;
  private gain: GainNode;
  private sub: GainNode;
  private subOsc: OscillatorNode | null = null;

  constructor(private n: Nodes, m: Mix) {
    this.filter = n.bq('lowpass', 480, 0.8);
    this.gain = n.gn(0);
    this.sub = n.gn(0);
    this.filter.connect(this.gain);
    this.sub.connect(this.gain);
    this.gain.connect(m.duck);
    // (into the room as Gem Dancers' bed was, not through the groove's own send: it is the bed first)
    n.link(this.gain, n.gn(0.7), m.revIn);
  }

  /** a new chord: its voices swell in with time constant `swell` while the old ones fade a little slower */
  chord(t: number, notes: readonly number[], swell: number, subMidi = notes[0] - 12) {
    const fade = Math.max(0.03, swell * 1.25);
    for (const v of this.voices) {
      v.amp.gain.cancelScheduledValues(t);
      v.amp.gain.setTargetAtTime(0, t, fade);
      for (const o of v.oscs) o.stop(t + fade * 7 + 0.05);
    }
    this.voices = notes.map((m, k) => {
      const amp = this.n.gn(0);
      amp.gain.setValueAtTime(0, t);
      amp.gain.setTargetAtTime(0.2 * (k === 0 ? 1.15 : 1), t, swell);
      amp.connect(this.n.pan(PAD_PAN[k % 4])).connect(this.filter);
      const oscs = ([[-8, 'sawtooth', 0.5], [9, 'sawtooth', 0.5], [1200, 'triangle', 0.175]] as const).map(([det, type, lvl]) => {
        const o = new OscillatorNode(this.n.ctx, { type, frequency: mtof(m), detune: det });
        o.connect(this.n.gn(lvl)).connect(amp);
        o.start(t);
        return o;
      });
      return { oscs, amp };
    });
    // the depth: a sine on the chord's root, low (it glides to the new root rather than restarting)
    const f = mtof(subMidi);
    if (!this.subOsc) {
      this.subOsc = new OscillatorNode(this.n.ctx, { type: 'sine', frequency: f });
      this.subOsc.connect(this.sub);
      this.subOsc.start(t);
    } else this.subOsc.frequency.setTargetAtTime(f, t, Math.max(0.02, swell * 0.5));
  }

  /** its filter, its level, and the sub's level */
  colour(t: number, cut: number, level: number, sub: number, tau: number) {
    this.filter.frequency.setTargetAtTime(cut, t, tau);
    this.gain.gain.setTargetAtTime(level, t, Math.max(tau, 0.4));
    this.sub.gain.setTargetAtTime(sub, t, 1.2);
  }
}

export function bass(n: Nodes, m: Mix, t: number, midi: number, dur: number, vel: number, cutoff: number) {
  const f = mtof(midi);
  const o1 = n.o('sawtooth', f, t, t + dur + 0.1), o2 = n.o('sine', f, t, t + dur + 0.1);
  const lp = n.bq('lowpass', cutoff, 5);
  lp.frequency.setValueAtTime(cutoff * 2.6, t); lp.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.7), t + 0.14);
  const g = n.gn(0), p = g.gain;
  p.setValueAtTime(0.0008, t); p.exponentialRampToValueAtTime(vel * 0.42, t + 0.008);
  p.setValueAtTime(vel * 0.42, t + Math.max(0.02, dur - 0.04)); p.exponentialRampToValueAtTime(0.0008, t + dur + 0.05);
  n.link(o1, n.gn(0.5), lp); o2.connect(lp);
  n.link(lp, g, m.duck);
}

/** a melodic voice: 0 pluck, 1 kalimba, 2 glass, 3 bell, 4 soft pluck, 5 marimba, 6 reed */
export function voice(n: Nodes, m: Mix, t: number, palette: number, midi: number, vel: number, dur: number, pan = 0, dist = 0) {
  const f = mtof(midi), out = n.gn(1);
  let del = 0.35, rev = 0.45;
  if (palette === 0 || palette === 4) {
    const soft = palette === 4;
    const o1 = n.on('sawtooth', f, t), o2 = n.on('square', f * 1.004, t), o3 = n.on('sine', f * 2, t);
    const lp = n.bq('lowpass', 2000, soft ? 1.5 : 3.2);
    const top = Math.min(soft ? 3800 : 9500, f * (soft ? 3 : 3.5 + vel * 7));
    lp.frequency.setValueAtTime(top, t); lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.1), t + 0.1 + dur * 0.5);
    o1.connect(lp); n.link(o2, n.gn(0.4), lp); n.link(o3, n.gn(0.25), lp); lp.connect(out);
    const tail = Math.max(0.16, dur) + 0.22;
    n.env(out.gain, t, vel * 0.2, 0.004, tail);
    for (const o of [o1, o2, o3]) o.stop(t + tail + 0.05);
    del = soft ? 0.5 : 0.38; rev = 0.3;
  } else if (palette === 1 || palette === 3) {
    const bell = palette === 3;
    const car = n.on('sine', f, t), mod = n.on('sine', f * (bell ? 3.51 : 4.0), t);
    const mg = n.gn(0);
    mg.gain.setValueAtTime(f * (bell ? 2.6 : 2.2) * (0.5 + vel), t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + (bell ? 0.6 : 0.09));
    n.link(mod, mg, car.frequency); car.connect(out);
    const tail = bell ? 1.6 : Math.max(0.5, dur + 0.4);
    n.env(out.gain, t, vel * (bell ? 0.2 : 0.3), 0.003, tail);
    car.stop(t + tail + 0.05); mod.stop(t + tail + 0.05);
    del = 0.3; rev = bell ? 0.6 : 0.35;
  } else if (palette === 2) {
    const o1 = n.o('sine', f, t, t + 1.35), o2 = n.o('sine', f * 2.005, t, t + 1.35), o3 = n.o('sine', f * 3.01, t, t + 1.35);
    o1.connect(out); n.link(o2, n.gn(0.3), out); n.link(o3, n.gn(0.1), out);
    n.env(out.gain, t, vel * 0.26, 0.012, 1.3);
    del = 0.35; rev = 0.6;
  } else if (palette === 5) {
    const o1 = n.o('sine', f, t, t + 0.5), o2 = n.o('sine', f * 4, t, t + 0.5);
    o1.connect(out); n.link(o2, n.envG(t, 0.5, 0.001, 0.05), out);
    n.env(out.gain, t, vel * 0.34, 0.002, 0.45);
    del = 0.3; rev = 0.35;
  } else {
    const tail = Math.max(0.25, dur) + 0.2;
    const o1 = n.o('square', f, t, t + tail + 0.05), o2 = n.o('sawtooth', f * 0.5, t, t + tail + 0.05);
    const lp = n.bq('lowpass', Math.min(2600, f * 3), 1);
    o1.connect(lp); n.link(o2, n.gn(0.3), lp); lp.connect(out);
    out.gain.setValueAtTime(0.0008, t); out.gain.exponentialRampToValueAtTime(vel * 0.13, t + 0.03);
    out.gain.setValueAtTime(vel * 0.13, t + tail - 0.15); out.gain.exponentialRampToValueAtTime(0.0008, t + tail);
  }
  m.route(out, m.leadBus, pan, rev, del, dist, true);
}

/** a pitched note in an element's colour, into `dst` */
export function tone(n: Nodes, dst: AudioNode, t: number, midi: number, el: Element, peak: number, a: number, d: number, bright = 1) {
  const f = mtof(midi), end = t + a + d + 0.06;
  const g = n.envG(t, peak, a, d); g.connect(dst);
  if (el === 'ice') {
    n.o('sine', f, t, end).connect(g);
    n.link(n.o('triangle', f * 2.005, t, end), n.gn(0.25 * bright), g);
    n.link(n.o('sine', f * 3.01, t, end), n.gn(0.1 * bright), g);
  } else if (el === 'water') {
    n.o('sine', f, t, end).connect(g);
    n.link(n.o('triangle', f * 2, t, end), n.gn(0.15 * bright), g);
    n.link(n.o('sine', f * 4, t, end), n.envG(t, 0.25 * bright, 0.001, 0.05), g);
  } else {
    const lp = n.bq('lowpass', 2000, 1.8);
    lp.frequency.setValueAtTime(Math.min(14000, f * (2.5 + 4 * bright)), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(280, f * 1.1), t + a + d * 0.7);
    lp.connect(g);
    if (el === 'plasma') {
      const o1 = n.o('sawtooth', f, t, end), o2 = n.o('square', f * 2, t, end);
      const dep = n.gn(14);
      n.link(n.o('sine', 28, t, end), dep); dep.connect(o1.detune); dep.connect(o2.detune);
      n.link(o1, n.gn(0.5), lp); n.link(o2, n.gn(0.25), lp);
    } else for (const det of [-8, 8]) { const o = n.o('sawtooth', f, t, end); o.detune.value = det; n.link(o, n.gn(0.5), lp); }
  }
}

export interface PadShape { types: OscillatorType[]; cut: number; peak: number; attack: number; spread: number; det: number }
/** a fusion's pad: a held chord of `midis` for `dur`, spread across the field */
export function fpad(n: Nodes, dst: AudioNode, t: number, midis: number[], dur: number, o: PadShape) {
  const k = midis.length, peak = Math.max(o.peak, 0.002);
  midis.forEach((m, i) => {
    const f = mtof(m), g = n.gn(0), P = g.gain;
    P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(peak, t + o.attack);
    P.setValueAtTime(peak, t + dur); P.exponentialRampToValueAtTime(0.0008, t + dur + 0.45);
    const lp = n.bq('lowpass', o.cut, 0.7);
    o.types.forEach((type, j) => { const osc = n.o(type, f, t, t + dur + 0.5); osc.detune.value = (j ? 1 : -1) * o.det; osc.connect(lp); });
    n.link(lp, g, n.pan(k > 1 ? (i / (k - 1) * 2 - 1) * o.spread : 0), dst);
  });
}
