// The engine's decisions, written down by a Recorder (no Web Audio needed): level 0 is still (no drums, no bass, a
// chord every four bars), the groove's levels play their patterns, a drop lands on a bar line at the peak, a fusion
// starts its texture, a mood change waits for the bar line, the same inputs give the same calls, the score's grid
// placement only happens while the groove runs, and matter voices are placed and tuned to the chord.
import { Engine, grooveParams } from '../engine';
import { Recorder } from '../instrument';
import { Score } from '../score';
import { Ears } from '../matter/ears';
import '../matter';
import { originListener } from '../spatial';
import { pc, moodIndex } from '../harmony';
import { CAVE } from '../sound';
import { check, close, say, type Tests } from './check';

/** an engine on a recorder, run at a fixed frame rate for `seconds`, `each` called every frame */
function play(seconds: number, setup?: (e: Engine) => void, each?: (e: Engine, t: number) => void) {
  const rec = new Recorder();
  let now = 0;
  const e = new Engine(rec.instrument, () => now, 0);
  setup?.(e);
  e.begin(0);
  for (let f = 0; f < seconds * 60; f++) { now = f / 60; each?.(e, now); e.tick(now, now + 0.1); }
  return { rec, e };
}
const count = (rec: Recorder, m: string) => rec.calls.filter(([k]) => k === m).length;

export const tests: Tests = {
  'level 0 is Gem Dancers: no drums, no bass, a chord every four bars'() {
    grooveParams.level = 0;
    const { rec, e } = play(20);
    for (const m of ['kick', 'clap', 'hat', 'bass', 'berimbau', 'voice']) check(count(rec, m) === 0, `${m} at level 0: ${count(rec, m)}`);
    const pads = count(rec, 'pad'), bars = 20 / (e.stepDur * 16);
    say(`level 0: ${pads} chord changes in ${bars.toFixed(1)} bars (20 s of Ember)`);
    check(pads >= 2 && pads <= Math.ceil(bars / 4) + 1, 'a chord every four bars');
    grooveParams.level = -1;
  },
  'the groove plays its levels'() {
    for (const L of [1, 2, 3, 4]) {
      grooveParams.level = L;
      const { rec, e } = play(10);
      const bars = 10 / (e.stepDur * 16);
      const kicks = count(rec, 'kick') / bars, hats = count(rec, 'hat') / bars, bass = count(rec, 'bass') / bars;
      say(`level ${L}: ${kicks.toFixed(1)} kicks, ${hats.toFixed(1)} hats, ${bass.toFixed(1)} bass notes a bar`);
      check(L === 1 ? kicks > 1.5 && kicks < 2.5 : kicks >= 3.5, `kicks at ${L}`);
    }
    grooveParams.level = -1;
  },
  'the level follows intensity, up at once and down after two quiet bars'() {
    grooveParams.level = -1;
    let at3 = -1, back = -1;
    play(16, undefined, (e, t) => {
      e.intensity = t < 6 ? 0.6 : 0;
      if (at3 < 0 && e.level === 3) at3 = t;
      if (at3 > 0 && back < 0 && t > 6 && e.level === 0) back = t;
    });
    check(at3 >= 0 && at3 < 1.2, `up to 3 within half a bar (${at3})`);
    check(back > 6, `back to 0 after letting go (${back})`);
  },
  'a drop lands on a beat at the peak; a fusion starts its texture'() {
    grooveParams.level = 2;
    let dropAt = -1;
    const { rec, e } = play(12, undefined, (e, t) => { if (t >= 2 && dropAt < 0) { dropAt = t; e.drop(); } if (t >= 8 && t < 8.02) e.fusion('prism'); });
    check(count(rec, 'suck') === 2 && count(rec, 'riser') === 2, 'two sucks and risers');
    check(count(rec, 'impact') === 2, 'two impacts');
    check(count(rec, 'fusionOn') === 1 && count(rec, 'fusionStep') > 10, 'the fusion plays');
    const imp = rec.calls.find(([k]) => k === 'impact')![1][0] as number;
    close(e.clock.beatError(imp, 4), 0, 0.5, 'the drop is on a beat');
    grooveParams.level = -1;
  },
  'a mood change waits for the bar line; the tempo glides'() {
    grooveParams.level = 2;
    const { rec, e } = play(8, undefined, (e, t) => { if (t >= 3 && t < 3.02) e.setPlace(moodIndex('Midnight'), { water: 16000, cave: 0.1, hearth: 0, depth: 0.45, forest: 1 }, CAVE, 1); });
    const t = rec.calls.find(([k]) => k === 'room')![1][0] as number;
    check(t > 3, 'after the call');
    const bars = e.events.filter((v) => v.type === 'bar').map((v) => v.t);
    check(bars.some((b) => Math.abs(b - t) < 1e-9), 'on a bar line');
    check(e.mood.name === 'Midnight', 'Midnight');
    close(e.clock.bpm, 100, 3, 'gliding to its tempo (6 % a step)');
    grooveParams.level = -1;
  },
  'the same inputs give the same calls'() {
    const run = () => {
      grooveParams.level = 3;
      const { rec } = play(10, undefined, (e, t) => { if (t > 4 && t < 4.02) e.drop(); e.tension = Math.min(1, t / 10); });
      grooveParams.level = -1;
      return JSON.stringify(rec.calls);
    };
    const a = run(), b = run();
    check(a === b, 'two runs differ');
    say(`10 s at level 3 with a drop and rising tension: ${JSON.parse(a).length} calls, identical twice`);
  },
  'stones go on the grid only while the groove runs'() {
    for (const L of [0, 2]) {
      grooveParams.level = L;
      const rec = new Recorder();
      let now = 0;
      const e = new Engine(rec.instrument, () => now, 0);
      const s = new Score(rec.instrument, e.harmony, e, originListener);
      e.begin(0);
      for (let f = 0; f < 600; f++) { now = f / 60; e.tick(now, now + 0.1); s.place(now + 0.003); }
      say(`level ${L}: ${s.placed.snapped} placed on the grid, ${s.placed.free} free (frame-time events, window ${s.stoneWindow * 1000} ms)`);
      check(L === 0 ? s.placed.snapped + s.placed.free === 0 : s.placed.snapped > 0, 'grid only in the groove');
    }
    grooveParams.level = -1;
  },
  'matter voices are placed and tuned'() {
    grooveParams.level = 2;
    const rec = new Recorder();
    let now = 0;
    const e = new Engine(rec.instrument, () => now, 0);
    const s = new Score(rec.instrument, e.harmony, e, originListener);
    const ears = new Ears(rec.instrument, e.harmony, s, originListener, () => now);
    e.begin(0);
    for (let f = 0; f < 300; f++) {
      now = f / 60; e.tick(now, now + 0.1);
      ears.hold({ kind: 'fire', type: 'roar', key: 'd0', x: 2, y: 1, z: 0, amount: 0.8, speed: 3 });
      if (f % 20 === 0) ears.event({ kind: 'water', type: 'drip', x: -3, y: 1, z: -2, strength: 0.5 });
      if (f % 30 === 0) ears.event({ kind: 'ice', type: 'tick', x: 0, y: 1, z: -20, strength: 0.5 });
      if (f === 100) ears.event({ kind: 'nope', type: 'x', x: 0, y: 0, z: 0, strength: 1 });
      ears.flush();
    }
    for (let f = 0; f < 3; f++) ears.flush(); // the roar lets go
    const ms = rec.calls.filter(([k]) => k === 'matter');
    for (const [, a] of ms) {
      const [t, kind, , p] = a as [number, string, string, { midi: number; tones: number[]; pan: number; dist: number }];
      check(p.tones.includes(pc(p.midi)), `${kind} at ${t}: ${p.midi} not a chord tone`);
    }
    const drip = ms.find(([, a]) => a[1] === 'water')![1][3] as { pan: number }, tick = ms.find(([, a]) => a[1] === 'ice')![1][3] as { dist: number };
    check(drip.pan < -0.2, 'the drip is to the left');
    check(tick.dist > 0.5, 'the far tick is distant');
    const holds = rec.calls.filter(([k]) => k === 'hold');
    check((holds[holds.length - 1][1][3] as { amount: number }).amount === 0, 'the roar is let go');
    grooveParams.level = -1;
  },
};
