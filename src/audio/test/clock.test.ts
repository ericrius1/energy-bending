// The music's clock against a fake clock: the grid, the swing, beat errors, the quantiser's window, a free tempo's
// glide, and following a shared clock (exact to well under 0.1 ms once locked, slewed at most 2 ms a step after a
// drift, re-phased after a jump).
import { MusicClock, SLEW } from '../clock';
import { check, close, say, type Tests } from './check';

/** run the scheduler from t0 to t1 in 25 ms ticks (as the live timer does), collecting [absolute step, time] */
function run(c: MusicClock, t0: number, t1: number, each?: (t: number) => void) {
  const out: [number, number][] = [];
  for (let t = t0; t < t1; t += 0.025) {
    each?.(t);
    c.advance(t, t + 0.12, { step: (_rel, at) => out.push([c.step, at]) });
  }
  return out;
}

export const tests: Tests = {
  'grid and swing'() {
    const c = new MusicClock(120, 1);
    c.swing = 0.1;
    const steps = run(c, 1, 3);
    const sd = 60 / 120 / 4;
    for (const [k, t] of steps) close(t, 1 + k * sd + (k % 2 ? 0.1 * sd : 0), 1e-9, `step ${k}`);
    check(steps.length >= 16, 'two seconds is sixteen 16ths at 120');
  },
  'beat error and beat info'() {
    const c = new MusicClock(100, 0);
    c.swing = 0.16;
    const sd = 60 / 100 / 4;
    close(c.beatError(4 * sd * 3, 4), 0, 1e-9, 'on a beat');
    close(c.beatError(4 * sd * 3 + 0.01, 4), 10, 1e-6, '10 ms late');
    close(c.beatError(sd * (1 + 0.16), 1), 0, 1e-6, 'an odd 16th is heard swung');
    close(c.beatError(sd, 1), -0.16 * sd * 1000, 1e-6, 'unswung is early against the swung 16th');
    const bi = c.beatInfo(sd * 5.5);
    check(bi.s16 === 5 && bi.bar === 0, `s16 ${bi.s16}`);
    close(bi.nextBeatTime, sd * 8, 1e-9, 'next beat');
    close(bi.nextBarTime, sd * 16, 1e-9, 'next bar');
    close(c.beatAt(sd * 4 * 7), 7, 1e-9, 'beatAt');
  },
  'quantise: ahead within the window, behind within the forgiveness, free otherwise'() {
    const c = new MusicClock(120, 0);
    c.swing = 0;
    const sd = 0.125;
    let q = c.quantise(sd * 3 - 0.03, 0.045);
    check(q.snapped && Math.abs(q.t - sd * 3) < 1e-9, 'waits 30 ms for the next 16th');
    q = c.quantise(sd * 3 - 0.06, 0.045);
    check(!q.snapped && q.t === sd * 3 - 0.06, '60 ms early is free');
    q = c.quantise(sd * 3 + 0.008, 0.045, 0.012);
    check(q.snapped && q.t === sd * 3 + 0.008, '8 ms late is already on it');
    // a uniform spread of events: the share put on the grid and the mean wait, for windows 0 … 90 ms
    for (const w of [0, 0.02, 0.03, 0.045, 0.06, 0.09]) {
      let snapped = 0, wait = 0, N = 4000;
      for (let i = 0; i < N; i++) { const t = 1 + (i / N) * sd * 8, r = c.quantise(t, w, 0.012); if (r.snapped) { snapped++; wait += r.t - t; } }
      say(`window ${(w * 1000).toFixed(0).padStart(2)} ms at 120 bpm: ${(100 * snapped / N).toFixed(0)} % on the grid, mean wait ${(1000 * wait / Math.max(1, snapped)).toFixed(1)} ms`);
    }
  },
  'free tempo glides 6 % a step'() {
    const c = new MusicClock(112, 0);
    c.targetBpm = 100;
    run(c, 0, 4);
    say(`112 → 100 bpm: ${c.bpm.toFixed(2)} after 4 s`);
    run(c, 4, 10);
    close(c.bpm, 100, 0.3, 'after 10 s (12 × 0.94^67 = 0.19 left)');
  },
  'shared clock: locked within 0.1 ms, slewed at most 2 ms a step, jumps when far'() {
    const c = new MusicClock(120, 0);
    let offset = 10.0; // server s − local s
    const epoch = 5000, bpm = 120, sd = 60 / bpm / 4;
    c.syncTo({ epoch, bpm });
    const measure = (t: number) => c.measure(t + offset, t, 0.025);
    // lock
    let steps = run(c, 0, 4, measure);
    const errs = (s: [number, number][]) => s.map(([k, t]) => (t + offset) - (epoch / 1000 + k * sd) - ((k % 2) ? c.swing * sd : 0));
    const locked = errs(steps.slice(-16));
    const worst = Math.max(...locked.map(Math.abs));
    say(`locked: worst error over the last bar ${(worst * 1000).toFixed(4)} ms, jumps ${c.jumps}`);
    check(worst < 0.0001, `locked to within 0.1 ms (${worst * 1000} ms)`);
    // the measured offset drifts by 6 ms: the grid follows, never more than SLEW a step
    offset += 0.006;
    steps = run(c, 4, 9, measure);
    let prevOff: number | null = null, maxStep = 0;
    for (const e of errs(steps)) { if (prevOff != null) maxStep = Math.max(maxStep, Math.abs(e - prevOff)); prevOff = e; }
    const after = Math.max(...errs(steps.slice(-16)).map(Math.abs));
    say(`after a 6 ms drift: largest change a step ${(maxStep * 1000).toFixed(3)} ms (limit ${SLEW * 1000}), settled to ${(after * 1000).toFixed(4)} ms`);
    check(maxStep <= SLEW + 1e-9, 'slew limit');
    check(after < 0.0001, 'settled');
    // a jump of a second: re-phased at once
    const j = c.jumps;
    offset += 1;
    steps = run(c, 9, 11, measure);
    check(c.jumps === j + 1, 'one jump');
    check(Math.max(...errs(steps.slice(-8)).map(Math.abs)) < 0.0001, 'on the new phase');
  },
};
