// The one harmony: every mood's chords, the notes handed to the stones, the melody's pool and snapping, transposing
// to a piece's key, and the sound effects' choice of pitch (every main note of every move is a tone of its chord).
import { MOODS, Harmony, notes, near, pc, transposed } from '../harmony';
import { moveNotes } from '../synth/jogo';
import { MOVES, type SfxCall } from '../instrument';
import { check, type Tests } from './check';

export const tests: Tests = {
  'every pad voice is a tone of its chord (or its ninth, a colour)'() {
    for (const m of MOODS) for (const c of m.chords) {
      for (const p of c.pad) check(c.tones.includes(pc(p)) || pc(p) === pc(c.bass + 2), `${m.name} ${c.name}: pad ${p} not in ${c.tones}`);
      check(c.tones.includes(pc(c.bass)), `${m.name} ${c.name}: the bass is the root`);
    }
  },
  'near and notes'() {
    check(near(9, 50) === 45 && near(9, 52) === 57, 'near picks the closer octave');
    check(notes([0, 4, 7], 60, 4).join() === '60,64,67,72', 'notes');
  },
  'stones ring chord tones, in every mood, transposed or not'() {
    for (let i = 0; i < MOODS.length; i++) for (const tr of [0, -4, 5]) {
      const h = new Harmony(); h.setMood(i, tr);
      for (let c = 0; c < 4; c++) {
        h.setChord(c, c * 2);
        for (let s = 0; s < 10; s++) {
          const m = h.chordTone(c * 2 + 0.5, h.root, s);
          check(h.at(c * 2 + 0.5).chord.tones.includes(pc(m)), `${MOODS[i].name}+${tr} chord ${c}: ${m}`);
          check(m >= h.root && m < h.root + 24, 'in the stones\' register');
        }
      }
    }
  },
  'the chord at a time comes from the log (set ahead of time)'() {
    const h = new Harmony(0);
    h.setChord(0, 0); h.setChord(1, 2); h.setChord(2, 4);
    check(h.at(1).chord.name === 'Am' && h.at(3).chord.name === 'F' && h.at(9).chord.name === 'C', 'log lookup');
  },
  'the melody pool is the pentatonic; snapping lands on the chord'() {
    for (let i = 0; i < MOODS.length; i++) {
      const h = new Harmony(i);
      h.setChord(1, 0);
      for (const n of h.pool) check(h.mood.pent.includes(pc(n)), 'pool in the scale');
      for (let k = 0; k < h.pool.length; k++) {
        const s = h.snapToChord(k);
        check(Math.abs(s - k) <= 3, 'snaps nearby');
        check(h.chord.tones.includes(pc(h.pool[s])) || s === k, `${MOODS[i].name}: ${h.pool[s]}`);
      }
      for (let s = 0; s < 10; s++) check(h.mood.pent.includes(pc(h.scale(s, 1))), 'scale');
    }
  },
  'transposing to a piece\'s key moves the root within a tritone'() {
    const h = new Harmony(0); // Ember, A
    for (const key of [53, 50, 55, 52, 48, 57]) {
      const d = h.transposeFor(key);
      check(Math.abs(d) <= 6, 'within a tritone');
      const m = transposed(MOODS[0], d);
      check(pc(m.pent[0]) === pc(key), `root ${m.pent[0]} for key ${key}`);
    }
  },
  'every move sound sings chord tones'() {
    for (const m of MOODS) for (const ch of m.chords) for (const move of MOVES) for (let k = 0; k < 6; k++) {
      const c: SfxCall = { name: 'move', el: 'fire', perfect: false, pan: 0, dist: 0, vel: 0.8, H: { chord: ch, mood: m }, stepDur: 0.13, move };
      for (const n of moveNotes(c, k)) check(ch.tones.includes(pc(n)), `${m.name} ${ch.name} ${move}: ${n}`);
    }
  },
};
