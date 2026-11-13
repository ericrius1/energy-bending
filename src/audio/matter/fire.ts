// Fire's voice. A roar that breathes: low brown noise through a band that opens with the speed of the limb moving
// through the flame, a hiss of the flame's tips above it, its level the amount of flame, swelling and settling slowly
// as if the fire were breathing. Crackles: clusters of tiny clicks (unpitched, off the grid: fire is not in time).
// A flare: the whoomph when a kick throws flame, a low swell opening upward.
//   ears.hold({ kind: 'fire', type: 'roar', key, x, y, z, amount, speed })   every frame, per burning body
//   ears.event({ kind: 'fire', type: 'crackle', x, y, z, strength })          now and then (more where it's hot)
//   ears.event({ kind: 'fire', type: 'flare', x, y, z, strength })            a burst of flame (a kick, an ignition)
import { matterVoices, holdOut, eventOut } from './sounds';
import { noiseBuffer } from '../voices';

matterVoices.register({
  id: 'fire',
  holds: {
    roar: {
      make(n, m) {
        const out = holdOut(n, m, 0.3);
        const low = new AudioBufferSourceNode(n.ctx, { buffer: noiseBuffer(n.ctx, 5, true), loop: true });
        const band = n.bq('bandpass', 300, 0.7), body = n.bq('lowpass', 1200, 0.5);
        // the breath: a slow swell and settle of the whole roar (0.3 Hz, ±35 %)
        const breath = n.gn(1), lfo = new OscillatorNode(n.ctx, { frequency: 0.31 });
        n.link(lfo, n.gn(0.35), breath.gain);
        n.link(low, band, body, breath, out.input);
        const tips = new AudioBufferSourceNode(n.ctx, { buffer: n.noiseBuf, loop: true });
        const hp = n.bq('highpass', 2600, 0.6), tipGain = n.gn(0.05);
        n.link(tips, hp, n.bq('lowpass', 7000), tipGain, breath);
        low.start(0, n.r() * 4); tips.start(0, n.r()); lfo.start(0);
        return {
          set(t, p) {
            const s = Math.min(1, p.speed / 5);
            out.place(t, Math.min(1, p.amount) * (0.16 + 0.22 * s), p.pan, p.dist);
            band.frequency.setTargetAtTime(220 + 900 * s, t, 0.12);
            body.frequency.setTargetAtTime(900 + 2800 * s, t, 0.12);
            tipGain.gain.setTargetAtTime(0.04 + 0.12 * s, t, 0.12);
          },
        };
      },
    },
  },
  events: {
    crackle: {
      play(n, m, t, p) {
        const out = n.gn(1);
        eventOut(n, m, out, p, 0.2);
        const k = 2 + Math.floor(p.seed * 4);
        for (let i = 0; i < k; i++) {
          const tt = t + n.r() * 0.06, f = 1500 + n.r() * 3800;
          n.link(n.noise(tt, 0.012), n.bq('bandpass', f, 2), n.envG(tt, (0.08 + 0.12 * n.r()) * Math.min(1.5, p.strength), 0.0006, 0.006 + 0.008 * n.r()), out);
        }
      },
    },
    flare: {
      play(n, m, t, p) {
        const out = n.gn(Math.min(1.2, p.strength));
        eventOut(n, m, out, p, 0.35);
        const lp = n.bq('lowpass', 300, 0.8);
        n.path(lp.frequency, t, [[0, 300], [0.18, 2600], [0.6, 500]]);
        n.link(n.noiseL(t, 0.7), lp, n.envG(t, 0.35, 0.05, 0.55), out);
        const o = n.o('sine', 70, t, t + 0.5); o.frequency.exponentialRampToValueAtTime(42, t + 0.4);
        n.link(o, n.envG(t, 0.22, 0.02, 0.4), out);
      },
    },
  },
});
