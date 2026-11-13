// Water's voice. Pouring: a rush of band-passed noise that rises with the flow, and bubbles in it, each a short sine
// sweeping up onto a tone of the chord (water is pitched: it sings in key). A splash when water lands: a burst of
// dull noise and a handful of bubbles climbing the chord. A drip: one bright plink onto a high chord tone, on the
// grid when the groove runs.
//   ears.hold({ kind: 'water', type: 'pour', key, x, y, z, amount, speed })   while a body or a stream flows
//   ears.event({ kind: 'water', type: 'splash', x, y, z, strength })          water landing (on the floor, the pool)
//   ears.event({ kind: 'water', type: 'drip', x, y, z, strength })            a drop falling off
import { matterVoices, holdOut, eventOut } from './sounds';
import { mtof } from '../synth/nodes';
import { notes } from '../harmony';
import type { Nodes } from '../synth/nodes';

/** a bubble: a sine that leaps up a fifth onto `midi` and is gone */
function bubble(n: Nodes, dst: AudioNode, t: number, midi: number, peak: number) {
  const f = mtof(midi), s = n.o('sine', f / 1.5, t, t + 0.09);
  s.frequency.exponentialRampToValueAtTime(f, t + 0.025);
  n.link(s, n.envG(t, peak, 0.002, 0.05), dst);
}

matterVoices.register({
  id: 'water',
  holds: {
    pour: {
      note: (h, t) => h.chordTone(t, 72, 0),
      make(n, m) {
        const out = holdOut(n, m, 0.3);
        const src = new AudioBufferSourceNode(n.ctx, { buffer: n.noiseBuf, loop: true });
        const bp = n.bq('bandpass', 900, 0.8), rush = n.gn(0.5);
        n.link(src, bp, n.bq('lowpass', 4200), rush, out.input);
        src.start(0, n.r());
        let last = -1;
        return {
          set(t, p) {
            const a = Math.min(1, p.amount), s = Math.min(1, p.speed / 4);
            out.place(t, a * (0.18 + 0.12 * s), p.pan, p.dist);
            bp.frequency.setTargetAtTime(700 + 1600 * s, t, 0.15);
            // bubbles in the flow, a few a second: more when it pours harder, each on a tone of the chord
            const dt = last < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, t - last));
            last = t;
            if (a > 0.02 && n.r() < dt * (3 + 9 * a)) {
              const ns = notes(p.tones, 72, 6);
              bubble(n, out.input, t + n.r() * dt, ns[Math.floor(n.r() * ns.length)], 0.5);
            }
          },
        };
      },
    },
  },
  events: {
    splash: {
      play(n, m, t, p) {
        const out = n.gn(Math.min(1.3, 0.4 + p.strength));
        eventOut(n, m, out, p, 0.3);
        const lp = n.bq('lowpass', 2800, 0.7);
        n.path(lp.frequency, t, [[0, 2800], [0.3, 600]]);
        n.link(n.noiseL(t, 0.4), lp, n.envG(t, 0.32, 0.004, 0.3), out);
        n.link(n.noiseL(t, 0.1), n.bq('lowpass', 400), n.envG(t, 0.25, 0.002, 0.07), out);
        const ns = notes(p.tones, 76, 5);
        for (let i = 0; i < 3 + Math.floor(p.seed * 3); i++) bubble(n, out, t + 0.03 + i * 0.045 + n.r() * 0.02, ns[(i + Math.floor(p.seed * 5)) % ns.length], 0.12);
      },
    },
    drip: {
      note: (h, t, seed) => h.chordTone(t, 84, seed * 6),
      grid: true,
      play(n, m, t, p) {
        const out = n.gn(Math.min(1.2, 0.5 + p.strength * 0.6));
        eventOut(n, m, out, p, 0.45);
        bubble(n, out, t, p.midi, 0.22);
        n.link(n.o('sine', mtof(p.midi) * 2, t + 0.01, t + 0.15), n.envG(t + 0.01, 0.04, 0.002, 0.1), out);
      },
    },
  },
});
