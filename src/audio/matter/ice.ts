// Ice's voice. Ticks: tiny glassy notes on high chord tones (ice settling, a limb tapping it), on the grid when the
// groove runs. A crack when water freezes: frost crackling outward, faster as it spreads, a dull thump under it and
// a glass note as it sets. A shatter: a burst of bright noise and a cascade of glass falling down the chord.
//   ears.event({ kind: 'ice', type: 'tick', x, y, z, strength })
//   ears.event({ kind: 'ice', type: 'crack', x, y, z, strength })     freezing (water turning to ice)
//   ears.event({ kind: 'ice', type: 'shatter', x, y, z, strength })   set ice broken
import { matterVoices, eventOut } from './sounds';
import { tone } from '../synth/tonal';
import { notes } from '../harmony';

matterVoices.register({
  id: 'ice',
  events: {
    tick: {
      note: (h, t, seed) => h.chordTone(t, 88, seed * 6),
      grid: true,
      play(n, m, t, p) {
        const out = n.gn(Math.min(1.2, 0.4 + p.strength));
        eventOut(n, m, out, p, 0.4);
        tone(n, out, t, p.midi, 'ice', 0.12, 0.002, 0.16, 1.2);
        n.link(n.noise(t, 0.006), n.bq('highpass', 6000), n.envG(t, 0.05, 0.0004, 0.004), out);
      },
    },
    crack: {
      note: (h, t, seed) => h.chordTone(t, 79, seed * 4),
      play(n, m, t, p) {
        const out = n.gn(Math.min(1.3, 0.5 + p.strength));
        eventOut(n, m, out, p, 0.35);
        for (let i = 0; i < 9; i++) { // the frost runs outward, accelerating
          const tt = t + 0.28 * (1 - Math.pow(1 - i / 9, 2));
          n.link(n.noise(tt, 0.01), n.bq('bandpass', 2500 + n.r() * 3500, 4), n.envG(tt, 0.2 * (1 - i / 13), 0.0005, 0.006), out);
        }
        n.link(n.noise(t, 0.08), n.bq('lowpass', 350), n.envG(t, 0.3, 0.002, 0.07), out);
        tone(n, out, t + 0.3, p.midi, 'ice', 0.07, 0.003, 0.9);
      },
    },
    shatter: {
      play(n, m, t, p) {
        const out = n.gn(Math.min(1.3, 0.5 + p.strength));
        eventOut(n, m, out, p, 0.45);
        n.link(n.noiseL(t, 0.5), n.bq('highpass', 3500), n.envG(t, 0.28, 0.002, 0.4), out);
        n.link(n.noise(t, 0.06), n.bq('lowpass', 600), n.envG(t, 0.25, 0.002, 0.05), out);
        const ns = notes(p.tones, 84, 8).reverse();
        ns.forEach((mm, i) => tone(n, out, t + 0.01 + i * 0.035 + n.r() * 0.015, mm, 'ice', 0.06 * (1 - i / 11), 0.002, 0.5));
      },
    },
  },
});
