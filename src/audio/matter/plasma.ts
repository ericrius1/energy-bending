// Plasma's voice. A buzz: a saw and a square on the chord's root, low, trembling at 30 Hz, through a band that opens
// with speed; its level the charge. A zap when an arc jumps: a square chirp falling from high, a crack of noise, and a
// bright note of the chord in plasma's colour (on the grid when the groove runs; a longer arc rings longer).
//   ears.hold({ kind: 'plasma', type: 'buzz', key, x, y, z, amount, speed })   while a body is charged
//   ears.event({ kind: 'plasma', type: 'zap', x, y, z, strength, extra: arcLength })
import { matterVoices, holdOut, eventOut } from './sounds';
import { tone } from '../synth/tonal';
import { mtof } from '../synth/nodes';
import { near, pc } from '../harmony';

matterVoices.register({
  id: 'plasma',
  holds: {
    buzz: {
      note: (h, t) => near(pc(h.at(t).chord.bass), 43),
      make(n, m) {
        const out = holdOut(n, m, 0.2);
        const s1 = new OscillatorNode(n.ctx, { type: 'sawtooth', frequency: 110 }), s2 = new OscillatorNode(n.ctx, { type: 'square', frequency: 220 });
        const band = n.bq('bandpass', 600, 1.6), am = n.gn(0.55), lfo = new OscillatorNode(n.ctx, { frequency: 30 });
        n.link(lfo, n.gn(0.45), am.gain);
        s1.connect(band); n.link(s2, n.gn(0.3), band);
        n.link(band, am, out.input);
        s1.start(0); s2.start(0); lfo.start(0);
        return {
          set(t, p) {
            const s = Math.min(1, p.speed / 5), f = mtof(p.midi);
            out.place(t, Math.min(1, p.amount) * (0.07 + 0.08 * s), p.pan, p.dist);
            s1.frequency.setTargetAtTime(f, t, 0.08); s2.frequency.setTargetAtTime(f * 2, t, 0.08);
            band.frequency.setTargetAtTime(400 + 2400 * s, t, 0.1);
          },
        };
      },
    },
  },
  events: {
    zap: {
      note: (h, t, seed) => h.chordTone(t, 76, seed * 4),
      grid: true,
      play(n, m, t, p) {
        const out = n.gn(Math.min(1.2, 0.4 + p.strength));
        eventOut(n, m, out, p, 0.3);
        const ch = n.o('square', 3800, t, t + 0.1); ch.frequency.exponentialRampToValueAtTime(200, t + 0.07);
        n.link(ch, n.bq('highpass', 400), n.envG(t, 0.07, 0.001, 0.07), out);
        n.link(n.noise(t, 0.03), n.bq('highpass', 2500), n.envG(t, 0.2, 0.0005, 0.025), out);
        const ring = 0.2 + Math.min(0.6, (p.extra || 0) * 0.3);
        tone(n, out, t + 0.01, p.midi, 'plasma', 0.07, 0.002, ring);
      },
    },
  },
});
