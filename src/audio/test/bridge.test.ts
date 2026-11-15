// A mirror crossing's music (phase 6, report 20-crossing; Engine.crossTo, the clock's glides, the deck's ramps): the
// new world's track comes in on the next beat, at a phrase of its body (never bar 1), its bar lines on the clock's; the
// tempo is bent across rather than jumped; and the file positions the deck plays (its rate ramps integrated, deck.ts
// segPos) stay with where the clock says each track is, through the bend, to a few milliseconds.
import { Engine } from '../engine';
import { Recorder } from '../instrument';
import { TRACKS, trackPos } from '../track';
import { segPos } from '../deck';
import { entryBar } from '../../duel/sound';
import { check, say, type Tests } from './check';

/** an engine on a track, its clock run to `t` in 25 ms ticks */
function setup(from: string) {
  let now = 0;
  const e = new Engine(new Recorder().instrument, () => now, 0);
  e.setTrack(TRACKS[from], true);
  e.clock.anchor(0.05, 0, 0);
  const steps: { k: number; t: number; gt: number; bpm: number; rel: number }[] = [];
  const run = (t1: number) => {
    for (; now < t1; now += 0.025) {
      e.tick(now, now + 0.12);
    }
  };
  const orig = e.step.bind(e);
  e.step = (rel: number, t: number) => { steps.push({ k: e.clock.step, t, gt: e.clock.gridTime, bpm: e.clock.bpm, rel }); orig(rel, t); };
  return { e, steps, run, at: () => now };
}

const PAIRS: [string, string][] = [['redwoods', 'temple'], ['temple', 'pool'], ['pool', 'redwoods'], ['geode', 'temple']];

export const tests: Tests = {
  'the new track on the next beat, at a phrase of its body, its bar lines on the clock\'s'() {
    for (const [a, b] of PAIRS) {
      const { e, steps, run, at } = setup(a);
      run(7.31);
      const t0 = at(), T = TRACKS[b];
      const bar = entryBar(TRACKS[a], 6, T, 0.6);
      const B = e.crossTo(T, bar)!;
      run(t0 + 6);
      const ev = e.events.find((x) => x.type === 'track' && x.id === b)!;
      check(!!ev, `${a} > ${b}: the track event`);
      const spbOld = 60 / TRACKS[a].bpm;
      check(B.tB - t0 >= 0.19 && B.tB - t0 <= 0.2 + spbOld * 1.25 + 0.12, `${a} > ${b}: in on the next beat at least 0.2 s off (${(B.tB - t0).toFixed(3)} s)`);
      check(Math.abs(ev.t - B.tB) < 0.002, `${a} > ${b}: the event on its beat`);
      check(bar >= T.loop.startBar && bar < T.loop.endBar, `${a} > ${b}: bar ${bar} is in the track's body`);
      // (the beat of the bar there is the clock's: a bar line of the clock is a bar line of the new track)
      const s = steps.find((x) => x.k === B.kB)!;
      check(((s.rel / 4 - e.trackBeat0) % 4 + 4) % 4 === (s.rel / 4) % 4, `${a} > ${b}: bar lines kept`);
      check(Math.abs(e.trackBeat0 % 4) < 1e-9, `${a} > ${b}: trackBeat0 a whole bar`);
      say(`${a} (${TRACKS[a].bpm.toFixed(1)}) > ${b} (${T.bpm.toFixed(1)}): in ${(B.tB - t0).toFixed(2)} s, at bar ${bar + 1}, beat ${(B.nb % 4) + 1}; the old bent to ${(B.rA * 100).toFixed(1)} %, the new in at ${(B.rB * 100).toFixed(1)} %`);
    }
  },

  'the tempo bent across, not jumped; the deck stays with the clock'() {
    for (const [a, b] of PAIRS) {
      const { e, steps, run, at } = setup(a);
      run(9.02);
      const t0 = at(), A = TRACKS[a], T = TRACKS[b];
      const beat0A = e.trackBeat0;
      const B = e.crossTo(T, entryBar(A, 8, T, 0.5))!;
      const first = steps.length;
      run(t0 + 8);
      const S = steps.slice(first);
      let maxStep = 0;
      for (let i = 1; i < S.length; i++) maxStep = Math.max(maxStep, Math.abs(S[i].bpm - S[i - 1].bpm));
      const jumpBefore = Math.abs(A.bpm - T.bpm);
      check(maxStep < jumpBefore * 0.55, `${a} > ${b}: the largest step of tempo ${maxStep.toFixed(2)} bpm (a jump was ${jumpBefore.toFixed(1)})`);
      const end = S[S.length - 1];
      check(Math.abs(end.bpm - T.bpm) < 1e-6, `${a} > ${b}: on the new tempo after`);
      // the old track through its bend (to tB), the new through its ramp (from tB): where the deck has each against where
      // the clock says it is (unswung step times)
      const old = { t0: B.tA, p0: trackPos(A, (S[0].rel) / 4 - beat0A), rate: 1, ramp: { t0: B.tA, t1: B.tB, r0: 1, r1: B.rA } };
      const nu = { t0: B.tB, p0: B.pos, rate: 1, ramp: { t0: B.tB, t1: B.tC, r0: B.rB, r1: 1 } };
      let errOld = 0, errNew = 0;
      for (const s of S) {
        // (the step's own time, unswung)
        const tu = s.gt;
        if (s.k <= B.kB) errOld = Math.max(errOld, Math.abs(segPos(old, tu) - trackPos(A, s.rel / 4 - beat0A)));
        if (s.k >= B.kB && s.k <= B.kC + 32) errNew = Math.max(errNew, Math.abs(segPos(nu, tu) - trackPos(T, s.rel / 4 - e.trackBeat0)));
      }
      check(errOld < 0.012 && errNew < 0.012, `${a} > ${b}: the deck within 12 ms of the clock (old ${(errOld * 1000).toFixed(1)}, new ${(errNew * 1000).toFixed(1)} ms)`);
      say(`${a} > ${b}: the tempo's largest step ${maxStep.toFixed(2)} bpm (was a ${jumpBefore.toFixed(1)} bpm jump), the heard seam ${Math.abs(A.bpm * B.rA - T.bpm * B.rB).toFixed(1)} bpm; the deck against the clock: old ${(errOld * 1000).toFixed(1)} ms, new ${(errNew * 1000).toFixed(1)} ms`);
    }
  },

  'a track the bridge brings is not started again on the bar line'() {
    const { e, run, at } = setup('redwoods');
    run(5.13);
    const t0 = at(), T = TRACKS.temple;
    const B = e.crossTo(T, entryBar(TRACKS.redwoods, 4, T, 0.5))!;
    // (the main view going over a moment later asks for the same track, as Music.retone does)
    e.setTrack(T);
    run(t0 + 6);
    const n = e.events.filter((x) => x.type === 'track' && x.id === 'temple').length;
    check(n === 1, `the temple's track came in ${n} times`);
    check(Math.abs(e.trackBeat0 - (e.trackBeat0 | 0)) < 1e-9 && B.nb >= T.loop.startBar * 4, 'its place kept');
  },
};
