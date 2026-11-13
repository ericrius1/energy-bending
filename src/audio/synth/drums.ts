// The kit, synthesised (the prototype's drums): a sine kick that drops from 170 to 47 Hz with a click of noise (and,
// hard, a punchier front), a clap of three noise bursts and a tail, closed and open hats, a crash, tuned toms, a rim,
// a shaker; and the drop's riser and impact, and the fire's crackle bed. Each takes the time it sounds at.
//
// Rebalanced from the prototype by measurement (docs/reports/1-audio.md): its groove put 91 % of its energy under
// 250 Hz, the 2-6 kHz band 31 dB down and the crest factor at 7 dB (the kick driving the limiter). The kick's body is
// 2 dB lower, the hats 5 dB higher and the clap 2 dB higher than the prototype's.
import { mtof, type Nodes } from './nodes';

const KICK = 0.8, HAT = 1.8, CLAP = 1.25;
import type { Mix } from './mix';

export function kick(n: Nodes, m: Mix, t: number, vel: number, hard = false) {
  const o = n.o('sine', 170, t, t + 0.5);
  o.frequency.exponentialRampToValueAtTime(47, t + 0.1);
  n.link(o, n.envG(t, vel * 0.95 * KICK, 0.003, 0.4), m.drumBus);
  n.link(n.noise(t, 0.02), n.bq('highpass', 1800), n.envG(t, vel * 0.18, 0.001, 0.018), m.drumBus);
  if (hard) {
    // a punchier front: a fast high body and a click
    const o2 = n.o('sine', 280, t, t + 0.1);
    o2.frequency.exponentialRampToValueAtTime(60, t + 0.035);
    n.link(o2, n.envG(t, vel * 0.32, 0.001, 0.06), m.drumBus);
    n.link(n.noiseL(t, 0.012), n.bq('bandpass', 3500, 1), n.envG(t, vel * 0.22, 0.0005, 0.008), m.drumBus);
  }
}

export function clap(n: Nodes, m: Mix, t: number, vel: number) {
  vel *= CLAP;
  const g = n.gn(0), p = g.gain;
  p.setValueAtTime(0.0008, t);
  for (const d of [0, 0.011, 0.023]) { p.setValueAtTime(vel * 0.5, t + d); p.exponentialRampToValueAtTime(vel * 0.08, t + d + 0.009); }
  p.setValueAtTime(vel * 0.45, t + 0.032);
  p.exponentialRampToValueAtTime(0.0008, t + 0.26);
  n.link(n.noise(t, 0.4), n.bq('bandpass', 1350, 1.1), n.bq('highpass', 700), g, m.drumBus);
  n.link(g, n.gn(0.3), m.grooveRev);
}

export function hat(n: Nodes, m: Mix, t: number, vel: number, open: boolean) {
  n.link(n.noise(t, open ? 0.3 : 0.06), n.bq('highpass', 7200), n.envG(t, vel * 0.3 * HAT, 0.002, open ? 0.2 : 0.04), n.pan(0.25), m.drumBus);
}

export function crash(n: Nodes, m: Mix, t: number, vel: number) {
  const g = n.envG(t, vel * 0.45, 0.004, 1.7);
  n.link(n.noise(t, 1.9), n.bq('highpass', 4200), g, m.drumBus);
  n.link(g, n.gn(0.5), m.grooveRev);
}

export function tom(n: Nodes, m: Mix, t: number, midi: number, vel: number, pan = 0) {
  const f = mtof(midi);
  const o = n.o('sine', f * 1.7, t, t + 0.4);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
  const g = n.envG(t, vel * 0.6, 0.003, 0.3), p = n.pan(pan);
  n.link(o, g, p, m.drumBus);
  n.link(n.noise(t, 0.05), n.bq('bandpass', 900, 0.7), n.envG(t, vel * 0.2, 0.001, 0.04), p);
  n.link(g, n.gn(0.25), m.grooveRev);
}

export function rim(n: Nodes, m: Mix, t: number, vel: number, pan = 0) {
  const o = n.o('triangle', 1500, t, t + 0.1);
  o.frequency.exponentialRampToValueAtTime(600, t + 0.02);
  const g = n.envG(t, vel * 0.3, 0.001, 0.05);
  n.link(o, g, n.pan(pan), m.drumBus);
  n.link(g, n.gn(0.4), m.grooveRev);
}

export function shaker(n: Nodes, m: Mix, t: number, vel: number) {
  const g = n.gn(0), P = g.gain;
  P.setValueAtTime(0.0008, t); P.exponentialRampToValueAtTime(vel * 0.25, t + 0.012); P.exponentialRampToValueAtTime(0.0008, t + 0.05);
  n.link(n.noiseL(t, 0.06), n.bq('highpass', 5000), n.bq('bandpass', 8000, 0.8), g, n.pan(0.2), m.drumBus);
}

/** before a drop: noise swelling up a band-pass from 500 Hz to 7 kHz over `dur` */
export function riser(n: Nodes, m: Mix, t: number, dur: number) {
  const bp = n.bq('bandpass', 500, 1.4);
  bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
  const g = n.gn(0);
  g.gain.setValueAtTime(0.0008, t); g.gain.exponentialRampToValueAtTime(0.22, t + dur * 0.96); g.gain.exponentialRampToValueAtTime(0.0008, t + dur + 0.03);
  n.link(n.noise(t, dur + 0.1), bp, g, m.fxBus);
  n.link(g, n.gn(0.5), m.revIn);
}

/** the drop lands: a falling sub and a burst of noise closing down (the tonic over it is the engine's) */
export function impact(n: Nodes, m: Mix, t: number) {
  const o = n.o('sine', 95, t, t + 1.5);
  o.frequency.exponentialRampToValueAtTime(34, t + 0.7);
  n.link(o, n.envG(t, 0.85, 0.004, 1.3), m.fxBus);
  const lp = n.bq('lowpass', 9000);
  lp.frequency.setValueAtTime(9000, t); lp.frequency.exponentialRampToValueAtTime(300, t + 1.3);
  const ng = n.envG(t, 0.3, 0.003, 1.4);
  n.link(n.noise(t, 1.6), lp, ng, m.fxBus);
  n.link(ng, n.gn(0.8), m.revIn);
}

/** one spark of the fire bed (its pitch, level and place chosen by the engine) */
export function crackle(n: Nodes, m: Mix, t: number, freq: number, amp: number, pan: number) {
  n.link(n.noise(t, 0.012), n.bq('bandpass', freq, 2), n.envG(t, amp, 0.0008, 0.008), n.pan(pan), m.fxBus);
}
