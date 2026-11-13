// Smoothness of the remote pose. A 2 Hz sine on one component of a 39-component pose (13 joints x 3),
// lag=200, jitter=80, loss=10 on both clients, sampled by the receiver at 60 Hz. Two runs:
//   A. virtual time: the same conditioner model fed straight into the jitter buffer (PoseBuffer, the code
//      behind Net.remotePose) with a seeded RNG and exact 60 Hz frames, including a 1 s sender outage
//      (a reconnect). Deterministic, so its bounds are strict.
//   B. real time: two Net clients through server.js on port 5380, sender reconnect at 9 s. Wall-clock
//      timing on a loaded machine adds scheduler stalls on top of the conditioner, so B asserts only over
//      frames whose neighbours were not stalled, and reports how many were.
// Asserts no discontinuity (per-frame step and acceleration bounded) and tracking of the source at the
// playback time. Run: node test/smoothness.test.mjs
import assert from 'node:assert/strict';
import { startServer, step, finish } from './helpers.mjs';
import { Net, PoseBuffer } from '../js/net.js';

const COND = { lag: 200, jitter: 80, loss: 10 };
const DIM = 39, AMP = 0.3, HZ = 2, W = 2 * Math.PI * HZ;
const src = tMs => AMP * Math.sin(W * tMs / 1000);                  // component 0, world units, by server time
const SRC_STEP = AMP * W / 60, SRC_ACC = AMP * W * W;                // max per-frame step, max |acc| (u/s^2)
const FRAME = 1000 / 60;

// samples: [{ t, y, err, delay, k (constant component) }] -> metrics; ok(i) selects frames to judge
function analyse(S, ok = () => true) {
  let maxStep = 0, maxAcc = 0, constStep = 0, judged = 0;
  for (let i = 2; i < S.length; i++) {
    if (!ok(i)) continue;
    judged++;
    const d1 = (S[i].t - S[i - 1].t) / 1000, d0 = (S[i - 1].t - S[i - 2].t) / 1000;
    const v1 = (S[i].y - S[i - 1].y) / d1, v0 = (S[i - 1].y - S[i - 2].y) / d0;
    maxStep = Math.max(maxStep, Math.abs(S[i].y - S[i - 1].y) * Math.min(1, (1 / 60) / d1));
    maxAcc = Math.max(maxAcc, Math.abs(v1 - v0) / ((d1 + d0) / 2));
    constStep = Math.max(constStep, Math.abs(S[i].k - S[i - 1].k));
  }
  const e = S.map(x => Math.abs(x.err)).sort((p, q) => p - q);
  const rms = Math.sqrt(S.reduce((a, x) => a + x.err * x.err, 0) / S.length);
  const delays = S.map(x => x.delay);
  return { judged, maxStep, maxAcc, constStep, rms, p95: e[Math.floor(e.length * 0.95)], max: e[e.length - 1], dMin: Math.min(...delays), dMax: Math.max(...delays) };
}
const fmt = (m, label) => `  ${label}
    max step/frame       ${m.maxStep.toFixed(4)}  (${(m.maxStep / SRC_STEP).toFixed(2)} x source ${SRC_STEP.toFixed(4)})
    max |acceleration|   ${m.maxAcc.toFixed(1)} u/s^2  (${(m.maxAcc / SRC_ACC).toFixed(2)} x source ${SRC_ACC.toFixed(1)})
    constant component   max step ${m.constStep.toExponential(1)}
    tracking error       rms ${m.rms.toFixed(4)}, p95 ${m.p95.toFixed(4)}, max ${m.max.toFixed(4)}  (amplitude ${AMP})
    playback delay       ${m.dMin.toFixed(0)}..${m.dMax.toFixed(0)} ms   (${m.judged} frames judged)`;

// ---------------- A. virtual time ----------------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function virtualRun(seed) {
  const rnd = mulberry32(seed), leg = () => COND.lag / 2 + (rnd() * 2 - 1) * COND.jitter / 2;
  const RUN = 14000, OUT0 = 8000, OUT1 = 9000, CLOCK_ERR = 4;      // receiver clock reads 4 ms ahead
  const arrivals = [];
  for (let ts = 0, k = 0; ts < RUN; ts += 50, k++) {
    if (ts >= OUT0 && ts < OUT1) continue;                         // sender away (reconnecting)
    if (rnd() * 100 < COND.loss || rnd() * 100 < COND.loss) continue;   // lost on either leg
    const p = new Array(DIM).fill(250);
    p[0] = Math.round(src(ts) * 1000);
    arrivals.push({ at: ts + leg() + 1 + leg(), ts, p });          // up leg, server, down leg
  }
  arrivals.sort((a, b) => a.at - b.at);
  const buf = new PoseBuffer(1000), out = new Float64Array(96), S = [];
  let ai = 0, firstOk = null;
  for (let t = 0; t < RUN; t += FRAME) {
    const now = t + CLOCK_ERR;
    while (ai < arrivals.length && arrivals[ai].at <= t) { const a = arrivals[ai++]; buf.push(a.ts, a.p, 0, 0, null, now); }
    const r = buf.sample(out, now);
    if (!r.ok) continue;
    firstOk ??= t;
    if (t < firstOk + 3000) continue;                              // warm-up
    S.push({ t, y: out[0], err: out[0] - src(now - buf.delay), delay: buf.delay, k: out[5], away: t >= OUT0 && t < OUT1 + 1500 });
  }
  return { S, reorders: arrivals.filter((a, i) => i && a.ts < arrivals[i - 1].ts).length };
}

// ---------------- B. real time through the server ----------------
async function realRun() {
  const PORT = 5380, WS = `ws://127.0.0.1:${PORT}/ws`, RUN_S = 14, DROP_AT_S = 9;
  const srv = await startServer(PORT);
  const a = new Net(WS, COND), b = new Net(WS, COND);
  const perf = () => performance.now(), yieldLoop = () => new Promise(r => setImmediate(r));
  try {
    const { room } = await a.connect({ room: null, stage: 'void' });
    await b.connect({ room });
    const pose = new Float64Array(DIM).fill(0.25), out = new Float64Array(96), S = [];
    let firstOk = null, dropped = false, back = null;
    a.on('open', () => { if (dropped) back = perf(); });
    const t0 = perf(), dropT = t0 + DROP_AT_S * 1000;
    let next = t0;
    while (perf() - t0 < RUN_S * 1000) {
      const now = perf();
      if (now >= next) {
        next = Math.max(next + FRAME, now + FRAME / 2);             // no catch-up bursts after a stall
        if (!dropped && now >= dropT) { dropped = true; a.ws.close(); }
        pose[0] = src(a.now());
        a.sendPose(pose, 0, 128, null);
        const r0 = perf(), r = b.remotePose(out), t = perf();          // stamp the frame when it was sampled
        if (r.ok) {
          firstOk ??= t;
          if (t >= firstOk + 3000) S.push({ t, slow: t - now > 5, y: out[0], err: out[0] - src(b.now() - b.delay), delay: b.delay, k: out[5], away: t >= dropT && t < (back ?? dropT) + 1500 });
        }
      }
      await yieldLoop();
    }
    return { S, back: back && back - dropT, rtt: [a.rtt, b.rtt], jitter: b.jitter, sync: Math.abs(a.now() - b.now()) };
  } finally {
    a.close(); b.close();
    await srv.stop();
  }
}

try {
  console.log(`conditioner: lag ${COND.lag} ms, jitter ${COND.jitter} ms, loss ${COND.loss}% on both clients, each direction; pose ${DIM} components`);
  console.log(`source: component 0 = ${AMP} sin(2pi ${HZ} t)\n`);

  const runs = [1, 2, 3].map(virtualRun);
  const allA = runs.map(r => r.S);
  const mA = analyse(allA[0]), steady = allA.map(S => analyse(S.filter(x => !x.away)));
  const outage = allA.map(S => analyse(S, i => S[i].away || S[i - 1].away));
  console.log(fmt(mA, `A. virtual time, seed 1 (all frames, incl. the 1 s outage); ${runs[0].reorders} reordered arrivals`));
  for (let i = 0; i < 3; i++) console.log(`    seed ${i + 1}: steady step ${(steady[i].maxStep / SRC_STEP).toFixed(2)}x, acc ${(steady[i].maxAcc / SRC_ACC).toFixed(2)}x, rms ${steady[i].rms.toFixed(4)} p95 ${steady[i].p95.toFixed(4)}; outage+recovery step ${(outage[i].maxStep / SRC_STEP).toFixed(2)}x, acc ${(outage[i].maxAcc / SRC_ACC).toFixed(2)}x`);

  await step('A: no discontinuity in steady play (step <= 1.5x, |acc| <= 3x source)', () => {
    for (const m of steady) { assert.ok(m.maxStep <= 1.5 * SRC_STEP, `step ${m.maxStep}`); assert.ok(m.maxAcc <= 3 * SRC_ACC, `acc ${m.maxAcc}`); }
  });
  await step('A: no snap through a 1 s outage and recovery (step <= 1.5x, |acc| <= 6x source)', () => {
    for (const m of outage) { assert.ok(m.maxStep <= 1.5 * SRC_STEP, `step ${m.maxStep}`); assert.ok(m.maxAcc <= 6 * SRC_ACC, `acc ${m.maxAcc}`); }
  });
  // the residual error is loss bursts: ~19% of frames are lost end to end, and a 2-3 frame hole in a
  // fast 2 Hz sine cannot be recovered without data
  await step('A: tracks the source at the playback time (rms < 0.035, p95 < 0.09)', () => {
    for (const m of steady) { assert.ok(m.rms < 0.035, `rms ${m.rms}`); assert.ok(m.p95 < 0.09, `p95 ${m.p95}`); }
  });
  await step('A: constant components stay exactly constant; delay within 80..350 ms', () => {
    for (const S of allA) { const m = analyse(S); assert.ok(m.constStep < 1e-12); assert.ok(m.dMin >= 80 && m.dMax <= 350); }
  });

  const B = await realRun();
  const S = B.S, dts = S.slice(1).map((x, i) => x.t - S[i].t);
  const stalled = i => S[i].t - S[i - 1].t > 25 || S[i - 1].t - S[i - 2].t > 25 || S[i].slow || S[i - 1].slow || S[i - 2].slow;
  const clean = i => !stalled(i);
  const mB = analyse(S, clean), mBall = analyse(S);
  const steadyB = analyse(S.filter(x => !x.away));
  console.log('\n' + fmt(mB, `B. real time through server.js (frames with no stall > 25 ms or slow frame > 5 ms next to them)`));
  console.log(`    frames ${S.length}, frame dt ${Math.min(...dts).toFixed(1)}..${Math.max(...dts).toFixed(1)} ms, ${dts.filter(d => d > 25).length} stalls > 25 ms`);
  console.log(`    all frames incl. stalls: step ${(mBall.maxStep / SRC_STEP).toFixed(2)}x, acc ${(mBall.maxAcc / SRC_ACC).toFixed(2)}x; tracking excl. outage rms ${steadyB.rms.toFixed(4)} p95 ${steadyB.p95.toFixed(4)}`);
  console.log(`    rtt a ${B.rtt[0].toFixed(0)} b ${B.rtt[1].toFixed(0)} ms, receiver jitter ${B.jitter.toFixed(1)} ms, clock |a-b| ${B.sync.toFixed(1)} ms, sender back after ${B.back ? B.back.toFixed(0) + ' ms' : 'NEVER'}`);

  await step('B: sender reconnected', () => assert.ok(B.back));
  await step('B: constant components stay constant; delay within 80..350 ms', () => { assert.ok(mBall.constStep < 1e-9); assert.ok(mBall.dMin >= 80 && mBall.dMax <= 350); });
  if (mB.judged < S.length / 2) {
    // Wall-clock stalls (other processes) dominate: the receiver is not running at 60 Hz and the real
    // pose delay exceeds the 350 ms cap, so B cannot judge the buffer. Run A covers the algorithm.
    console.log(`SKIP B: smoothness/tracking not judged, only ${mB.judged} of ${S.length} frames unstalled (machine too loaded)`);
  } else {
    await step('B: no discontinuity on unstalled frames (step <= 1.5x, |acc| <= 6x source)', () => {
      assert.ok(mB.maxStep <= 1.5 * SRC_STEP, `step ${mB.maxStep}`);
      assert.ok(mB.maxAcc <= 6 * SRC_ACC, `acc ${mB.maxAcc}`);
    });
    // Tracking only means something if the real link matches the conditioner; extra scheduler delay
    // pushes the pose past the 350 ms playback cap and the buffer (correctly) extrapolates and holds.
    const linkOk = Math.max(...B.rtt) <= 1.3 * COND.lag + 20 && B.jitter <= 1.5 * COND.jitter;
    if (linkOk) await step('B: tracks the source (rms < 0.05)', () => assert.ok(steadyB.rms < 0.05, `rms ${steadyB.rms}`));
    else console.log(`SKIP B tracking: measured rtt ${B.rtt.map(x => x.toFixed(0)).join('/')} ms, jitter ${B.jitter.toFixed(0)} ms exceed the conditioner (${COND.lag}/${COND.jitter}): machine too loaded`);
  }
} catch (e) {
  if (!/step|assert/i.test(String(e?.stack))) console.error(e);
}
finish();
