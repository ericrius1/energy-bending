// Steam's voice (steam is made by the reactions, where water meets heat). A hiss: bright noise high up, brighter when
// it moves fast, its level how much steam there is. A puff: a short burst of it (water hitting fire).
//   ears.hold({ kind: 'steam', type: 'hiss', key, x, y, z, amount, speed })
//   ears.event({ kind: 'steam', type: 'puff', x, y, z, strength })
import { matterVoices, holdOut, eventOut } from './sounds';

matterVoices.register({
  id: 'steam',
  holds: {
    hiss: {
      make(n, m) {
        const out = holdOut(n, m, 0.35);
        const src = new AudioBufferSourceNode(n.ctx, { buffer: n.noiseBuf, loop: true });
        const hp = n.bq('highpass', 3200, 0.6), lp = n.bq('lowpass', 9000, 0.5);
        n.link(src, hp, lp, out.input);
        src.start(0, n.r());
        return {
          set(t, p) {
            const s = Math.min(1, p.speed / 4);
            out.place(t, Math.min(1, p.amount) * (0.06 + 0.05 * s), p.pan, p.dist);
            hp.frequency.setTargetAtTime(2800 + 2200 * s, t, 0.15);
          },
        };
      },
    },
  },
  events: {
    puff: {
      play(n, m, t, p) {
        const out = n.gn(Math.min(1.2, 0.4 + p.strength));
        eventOut(n, m, out, p, 0.4);
        const bp = n.bq('bandpass', 6000, 0.7);
        n.path(bp.frequency, t, [[0, 7500], [0.5, 2500]]);
        n.link(n.noiseL(t, 0.6), n.bq('highpass', 2000), bp, n.envG(t, 0.3, 0.02, 0.5), out);
      },
    },
  },
});
