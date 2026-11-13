// The roda's instruments, synthesised (the prototype's capoeira percussion). The berimbau: "dong" the open string on
// the key's root, "ding" with the coin pressed (the next scale note up), "ch" the coin resting on the wire (a muted
// buzz), each with the stick's click and the caxixi's rattle; the gourd is a moving band-pass, the wire's buzz a
// tanh-shaped sine. The pandeiro: thumb, slap and fingertip with its jingles. The atabaque: bass, open and slap.
import { mtof, type Nodes } from './nodes';
import type { Mix } from './mix';

let buzzCurve: Float32Array<ArrayBuffer> | null = null;
function buzz() {
  if (!buzzCurve) {
    buzzCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; buzzCurve[i] = Math.tanh(x * 7); }
  }
  return buzzCurve;
}

export function berimbau(n: Nodes, m: Mix, t: number, kind: 'ch' | 'dong' | 'ding', vel: number, pan: number, dong: number, ding: number) {
  const out = n.gn(1), p = n.pan(pan);
  out.connect(p); p.connect(m.drumBus);
  n.link(p, n.gn(0.18), m.grooveRev);
  n.link(n.noiseL(t, 0.02), n.bq('highpass', 2500), n.envG(t, vel * 0.16, 0.0005, 0.008), out);
  n.link(n.noiseL(t, 0.06), n.bq('highpass', 6500), n.envG(t, vel * 0.07, 0.003, 0.045), out);
  if (kind === 'ch') {
    n.link(n.noiseL(t, 0.05), n.bq('bandpass', 2600, 1.4), n.envG(t, vel * 0.2, 0.001, 0.03), out);
    n.link(n.o('square', mtof(dong) * 3, t, t + 0.06), n.bq('bandpass', 1800, 2), n.envG(t, vel * 0.05, 0.001, 0.025), out);
    return;
  }
  const f = mtof(kind === 'ding' ? ding : dong);
  const dec = kind === 'ding' ? 0.45 : 0.85, end = t + dec + 0.1;
  const env = n.envG(t, vel * 0.22, 0.002, dec); env.connect(out);
  const s1 = n.o('sawtooth', f, t, end), s2 = n.o('square', f * 1.004, t, end);
  for (const o of [s1, s2]) { const fr = o.frequency.value; o.frequency.setValueAtTime(fr * 1.05, t); o.frequency.exponentialRampToValueAtTime(fr, t + 0.03); }
  // the gourd opening off the belly: a moving resonance
  const gourd = n.bq('bandpass', 500, 3.5);
  gourd.frequency.setValueAtTime(420, t); gourd.frequency.exponentialRampToValueAtTime(1150, t + 0.11); gourd.frequency.exponentialRampToValueAtTime(650, t + dec);
  const body = n.bq('lowpass', f * 3, 0.8);
  s1.connect(gourd); n.link(s2, n.gn(0.35), gourd); s1.connect(body);
  n.link(gourd, n.gn(1.4), env); n.link(body, n.gn(0.45), env);
  const sh = new WaveShaperNode(n.ctx, { curve: buzz() });
  n.link(n.o('sine', f * 2, t, end), n.gn(4), sh, n.bq('bandpass', 2400, 1), n.envG(t, vel * 0.05, 0.002, dec * 0.5), out);
}

export function pandeiro(n: Nodes, m: Mix, t: number, kind: 'thumb' | 'slap' | 'tip', vel: number) {
  const out = n.gn(1);
  n.link(out, n.pan(0.35), m.drumBus);
  const g = n.gn(0), P = g.gain, jv = vel * (kind === 'tip' ? 0.09 : 0.16);
  P.setValueAtTime(0.0008, t);
  [0, 0.005, 0.011].forEach((d, i) => { P.setValueAtTime(jv * (1 - i * 0.25), t + d); P.exponentialRampToValueAtTime(jv * 0.2, t + d + 0.004); });
  P.exponentialRampToValueAtTime(0.0008, t + (kind === 'slap' ? 0.11 : 0.07));
  n.link(n.noiseL(t, 0.12), n.bq('highpass', 6000), n.bq('bandpass', 9000, 1.8), g, out);
  if (kind === 'thumb') {
    const o = n.o('sine', 175, t, t + 0.2); o.frequency.exponentialRampToValueAtTime(115, t + 0.04);
    n.link(o, n.envG(t, vel * 0.32, 0.002, 0.12), out);
  } else if (kind === 'slap') n.link(n.noiseL(t, 0.04), n.bq('bandpass', 1400, 1), n.envG(t, vel * 0.16, 0.001, 0.03), out);
}

export function atabaque(n: Nodes, m: Mix, t: number, kind: 'bass' | 'open' | 'slap', vel: number, pan = 0) {
  const out = n.gn(1), p = n.pan(pan);
  out.connect(p); p.connect(m.drumBus);
  n.link(p, n.gn(0.12), m.grooveRev);
  if (kind === 'bass') {
    const o = n.o('sine', 110, t, t + 0.45); o.frequency.exponentialRampToValueAtTime(78, t + 0.06);
    n.link(o, n.envG(t, vel * 0.5, 0.003, 0.32), out);
    n.link(n.noiseL(t, 0.04), n.bq('lowpass', 500), n.envG(t, vel * 0.15, 0.001, 0.03), out);
  } else if (kind === 'open') {
    const o = n.o('sine', 205, t, t + 0.3); o.frequency.exponentialRampToValueAtTime(188, t + 0.04);
    n.link(o, n.envG(t, vel * 0.36, 0.002, 0.22), out);
    n.link(n.o('sine', 205 * 2.7, t, t + 0.1), n.envG(t, vel * 0.06, 0.001, 0.06), out);
  } else {
    n.link(n.noiseL(t, 0.06), n.bq('bandpass', 1100, 1.2), n.envG(t, vel * 0.3, 0.001, 0.045), out);
    n.link(n.o('sine', 320, t, t + 0.08), n.envG(t, vel * 0.12, 0.001, 0.05), out);
  }
}
