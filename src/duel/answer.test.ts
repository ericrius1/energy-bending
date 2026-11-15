// The world answering a moment (answer.ts, report 20), checked without a GPU: each pair tier answers more than the last,
// rises fast, holds, and settles to nothing within seconds (the calm between stays calm); the shafts and the aurora come
// with the higher tiers; a fused finale answers whole from its flower; and a world that isn't answering writes none.
import { test, assert, done } from '../dancer/test/check';
import { ANSWER, DuelAnswer } from './answer';
import { Glows } from '../play/glow';
import type { AnswerNow } from '../worlds/answer';
import type { FinaleLook } from './finale';
import type { DuelEvent } from '../../shared/duel.ts';

type V3 = [number, number, number];
const tier = (t: number): DuelEvent => ({ k: 'pairTier', seat: 0, tier: t, name: ['DUET', 'CURRENT', 'MURMURATION', 'AURORA'][t - 1], color: ['#b8f28a', '#7ad0ff', '#c9a8ff', '#e6fff2'][t - 1], n: 20 });

function rig(fin: () => FinaleLook | null = () => null, flower: () => V3 | null = () => null) {
  const G = new Glows(), out: AnswerNow[] = [];
  const A = new DuelAnswer({
    glows: G, light: () => 2, pair: () => [0, 0, 0], eye: () => [0, 2, -8], finale: fin, foot: () => [0, 0, 0], flower,
    write: (a) => out.push(a), seat: (k) => (k ? [0.4, 1.5, 0.7] : [1.7, 0.4, 0.8]),
  });
  return { A, G, out };
}

test('nothing answers until a moment', () => {
  const { A, out } = rig();
  for (let i = 0; i < 60; i++) A.update(1 / 60, [], i / 30);
  assert(out.every((a) => a.world < 0 && a.level === 0), 'answered with no moment');
});

test('each tier answers more than the last, rises in a third of a second and settles to nothing', () => {
  const peaks: number[] = [];
  for (let t = 1; t <= 4; t++) {
    const { A } = rig();
    A.update(1 / 60, [tier(t)], 0);
    let peak = 0, at = 0, gone = -1;
    for (let i = 1; i < 60 * 10; i++) {
      A.update(1 / 60, [], i / 30);
      if (A.level > peak + 1e-6) { peak = A.level; at = i / 60; }
      if (gone < 0 && i > 60 && A.level <= 0.001) gone = i / 60;
    }
    peaks.push(peak);
    assert(at <= ANSWER.RISE_S + 0.05, `tier ${t} peaked at ${at.toFixed(2)} s`);
    assert(gone > 0 && gone < 8, `tier ${t} settled at ${gone.toFixed(2)} s`);
  }
  for (let i = 1; i < 4; i++) assert(peaks[i] > peaks[i - 1], `peaks ${peaks.map((p) => p.toFixed(2)).join(', ')}`);
});

test('the sun breaks through from CURRENT and the aurora opens at AURORA; motes swirl from MURMURATION', () => {
  const at = (t: number) => { const { A, G, out } = rig(); A.update(1 / 60, [tier(t)], 0); for (let i = 0; i < 40; i++) { G.clear(); A.update(1 / 60, [], i / 30); } return { a: out[out.length - 1], motes: G.count }; };
  const d = at(1), c = at(2), m = at(3), a = at(4);
  assert(d.a.shafts === 0 && c.a.shafts > 0 && a.a.shafts > c.a.shafts, 'shafts');
  assert(c.a.aurora === 0 && a.a.aurora === 1, 'aurora');
  assert(d.motes === 0 && m.motes > c.motes && a.motes >= m.motes, `motes ${d.motes}, ${c.motes}, ${m.motes}, ${a.motes}`);
});

test('a fused finale answers whole from its flower, and not one that did not fuse', () => {
  const look = (fused: boolean, u: number): FinaleLook => ({ fused, u, t: u * 2.1, len: 2.1, base: 0, flyer: 1, fuse: 1, bloom: 0 });
  const heart: V3 = [0, 4, 0];
  let L = look(true, 0.8);
  const { A, out } = rig(() => L, () => heart);
  A.update(1 / 60, [], 0);
  const a = out[out.length - 1];
  assert(a.tier === 5 && a.level > 0.95 && a.lamp > 0.5 && a.sun[1] === 4 && a.aurora === 1, JSON.stringify(a));
  L = look(false, 0.8);
  A.update(1 / 60, [], 0);
  assert(out[out.length - 1].level === 0, 'answered a finale that did not fuse');
});

done();
