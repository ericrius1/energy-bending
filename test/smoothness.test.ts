// Smoothness of the remote dancer. A 2 Hz sine of 0.3 m on one landmark coordinate of a 13-landmark pose (as in the
// prototype's test), sampled by the receiver at 60 Hz, under lag 200 / jitter 80 / loss 10 on both clients and under
// lag 40. Two kinds of run:
//   A. virtual time: the conditioner's model fed straight into the jitter buffer (PoseBuffer, the code behind
//      Net.remotePose) with a seeded RNG and exact 60 Hz frames, including a 1 s sender outage (a reconnect).
//      Deterministic, so its bounds are strict. It runs the prototype's buffer ("before": Catmull-Rom chord tangents,
//      no repeated snapshot) and this one ("after"), and the two changes one at a time, and splits the error by what
//      the buffer was doing (between snapshots, across a lost one, past the newest, blending a correction).
//   B. real time: two Net clients through server/index.ts (its own process) on port 5418, a sender reconnect at 9 s.
//      Wall-clock timing on a loaded machine adds scheduler stalls on top of the conditioner, so B judges only frames
//      whose neighbours were not stalled, reports how many were, and prints the machine's CPU load first.
// Also: the yaw spinning through ±π and the root walking stay continuous (no wrap, no snap). Run: node test/smoothness.test.ts
import assert from 'node:assert/strict';
import os from 'node:os';
import { startServer, step, finish, sleep } from './helpers.ts';
import { Net, PoseBuffer, BUFFER_PARAMS, PROTOTYPE_BUFFER, DIM, LOCAL, YAW, type BufferParams, type Conditions } from '../src/net/net.ts';
import { NLM } from '../shared/protocol.ts';

const DIM_LM = NLM * 3, AMP = 0.3, HZ = 2, W = 2 * Math.PI * HZ;
// the moving coordinate, metres, by server time. SIGNAL=mix (for the sweep) uses five sines from 0.4 to 3 Hz instead,
// so the tuning is not fitted to one pure tone
const MIX = [[0.4, 0.12, 0.3], [0.9, 0.08, 1.1], [1.7, 0.05, 2.0], [2.3, 0.035, 0.4], [3.0, 0.025, 2.6]];
const src = process.env.SIGNAL === "mix"
  ? (tMs: number) => MIX.reduce((a, [hz, amp, ph]) => a + amp * Math.sin(2 * Math.PI * hz * tMs / 1000 + ph), 0)
  : (tMs: number) => AMP * Math.sin((W * tMs) / 1000);
const SRC_STEP = (AMP * W) / 60, SRC_ACC = AMP * W * W;                // max per-frame step, max |acceleration| (m/s²)
const FRAME = 1000 / 60;
const J = LOCAL;                                                        // the moving component in the buffer's layout
const K = LOCAL + 5;                                                    // a component that never moves
const mm = (x: number) => Math.round(x * 1000) / 1000;                 // what the wire does to a coordinate

interface Sample { t: number; y: number; err: number; now: number; delay: number; k: number; away: boolean; mode: string; blend: boolean; slow?: boolean }
interface Metrics { judged: number; maxStep: number; maxAcc: number; constStep: number; rms: number; p95: number; max: number; dMin: number; dMax: number; dMean: number; rmsNow: number }

function analyse(S: Sample[], ok: (i: number) => boolean = () => true): Metrics {
  let maxStep = 0, maxAcc = 0, constStep = 0, judged = 0;
  for (let i = 2; i < S.length; i++) {
    if (!ok(i)) continue;
    judged++;
    const d1 = (S[i].t - S[i - 1].t) / 1000, d0 = (S[i - 1].t - S[i - 2].t) / 1000;
    const v1 = (S[i].y - S[i - 1].y) / d1, v0 = (S[i - 1].y - S[i - 2].y) / d0;
    maxStep = Math.max(maxStep, Math.abs(S[i].y - S[i - 1].y) * Math.min(1, 1 / 60 / d1));
    maxAcc = Math.max(maxAcc, Math.abs(v1 - v0) / ((d1 + d0) / 2));
    constStep = Math.max(constStep, Math.abs(S[i].k - S[i - 1].k));
  }
  const e = S.map((x) => Math.abs(x.err)).sort((p, q) => p - q);
  const rms = Math.sqrt(S.reduce((a, x) => a + x.err * x.err, 0) / S.length);
  const rmsNow = Math.sqrt(S.reduce((a, x) => a + (x.y - src(x.now)) ** 2, 0) / S.length);
  const delays = S.map((x) => x.delay);
  return {
    judged, maxStep, maxAcc, constStep, rms, p95: e[Math.floor(e.length * 0.95)], max: e[e.length - 1],
    dMin: Math.min(...delays), dMax: Math.max(...delays), dMean: delays.reduce((a, b) => a + b, 0) / delays.length, rmsNow,
  };
}
const f4 = (x: number) => x.toFixed(4);

// ---------------------------------------------------------------- A. virtual time
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

interface Run { S: Sample[]; reorders: number; lost: number; frames: number }
/** one 14 s run: the sender's 20 Hz frames through two conditioned legs into a buffer sampled at 60 Hz */
function virtualRun(seed: number, cond: Conditions, params: Partial<BufferParams>, redundant: number, outage = true): Run {
  const rnd = mulberry32(seed), leg = () => cond.lag / 2 + ((rnd() * 2 - 1) * cond.jitter) / 2;
  const RUN = 14000, OUT0 = outage ? 8000 : Infinity, OUT1 = 9000, CLOCK_ERR = 4;    // the receiver's clock reads 4 ms ahead
  const arrivals: { at: number; ts: number; prev: number[] }[] = [];
  let lost = 0, frames = 0, sent: number[] = [];
  for (let ts = 0; ts < RUN; ts += 50) {
    if (ts >= OUT0 && ts < OUT1) { sent = []; continue; }                 // the sender is away (reconnecting)
    frames++;
    const prev = sent.slice(0, redundant);                                // its last few snapshots, newest first
    sent = [ts, ...sent].slice(0, 3);
    if (rnd() * 100 < cond.loss || rnd() * 100 < cond.loss) { lost++; continue; }   // lost on either leg
    arrivals.push({ at: ts + leg() + 1 + leg(), ts, prev });              // up leg, the server, down leg
  }
  arrivals.sort((a, b) => a.at - b.at);
  const buf = new PoseBuffer(params), out = new Float64Array(DIM), S: Sample[] = [];
  const snap = (ts: number) => { const v = new Float64Array(DIM).fill(0.25); v[J] = mm(src(ts)); return v; };
  const meta = { flags: 0, energy: 0, world: 'w', move: null };
  let ai = 0, firstOk: number | null = null;
  for (let t = 0; t < RUN; t += FRAME) {
    const now = t + CLOCK_ERR;
    while (ai < arrivals.length && arrivals[ai].at <= t) {
      const a = arrivals[ai++];
      for (let i = a.prev.length - 1; i >= 0; i--) buf.push(a.prev[i], snap(a.prev[i]), meta, now, false);
      buf.push(a.ts, snap(a.ts), meta, now);
    }
    const r = buf.sample(out, now);
    if (!r.ok) continue;
    firstOk ??= t;
    if (t < firstOk + 3000) continue;                                     // warm-up
    S.push({ t, now, y: out[J], err: out[J] - src(now - buf.delay), delay: buf.delay, k: out[K], away: t >= OUT0 && t < OUT1 + 1500, mode: buf.mode, blend: buf.blending });
  }
  return { S, reorders: arrivals.filter((a, i) => i && a.ts < arrivals[i - 1].ts).length, lost, frames };
}

/** the error split by what the buffer was doing: share of frames, rms within, and share of the total squared error */
function byMode(S: Sample[]) {
  const total = S.reduce((a, x) => a + x.err * x.err, 0) || 1, out: string[] = [];
  const groups: [string, (x: Sample) => boolean][] = [
    ['between', (x) => x.mode === 'interp' && !x.blend], ['across a loss', (x) => x.mode === 'hole' && !x.blend],
    ['past newest', (x) => x.mode === 'extrap' && !x.blend], ['blending', (x) => x.blend],
  ];
  for (const [name, f] of groups) {
    const g = S.filter(f);
    if (!g.length) continue;
    const se = g.reduce((a, x) => a + x.err * x.err, 0);
    out.push(`${name} ${((100 * g.length) / S.length).toFixed(0)}% of frames, rms ${f4(Math.sqrt(se / g.length))}, ${((100 * se) / total).toFixed(0)}% of error²`);
  }
  return out.join('; ');
}

const LAG200 = { lag: 200, jitter: 80, loss: 10 };
const VARIANTS: { name: string; params: Partial<BufferParams>; redundant: number }[] = [
  { name: 'before (prototype)', params: PROTOTYPE_BUFFER, redundant: 0 },
  { name: '+ repeat 1 snapshot', params: PROTOTYPE_BUFFER, redundant: 1 },
  { name: '+ repeat 2 snapshots', params: PROTOTYPE_BUFFER, redundant: 2 },
  { name: '+ tangents only', params: BUFFER_PARAMS, redundant: 0 },
  { name: 'after', params: BUFFER_PARAMS, redundant: 2 },
];

function suite(cond: Conditions, params: Partial<BufferParams>, redundant: number, seeds = [1, 2, 3], outage = true) {
  const runs = seeds.map((sd) => virtualRun(sd, cond, params, redundant, outage));
  const steady = runs.map((r) => analyse(r.S.filter((x) => !x.away)));
  const outageM = runs.map((r) => analyse(r.S, (i) => r.S[i].away || r.S[i - 1].away));
  const all = runs.flatMap((r) => r.S.filter((x) => !x.away));
  return { runs, steady, outage: outageM, pooled: analyse(all), modes: byMode(all) };
}
const line = (name: string, m: Metrics) =>
  `  ${name.padEnd(22)} rms ${f4(m.rms)}  p95 ${f4(m.p95)}  max ${f4(m.max)}  | step ${(m.maxStep / SRC_STEP).toFixed(2)}x acc ${(m.maxAcc / SRC_ACC).toFixed(2)}x | delay ${m.dMean.toFixed(0)} ms (${m.dMin.toFixed(0)}..${m.dMax.toFixed(0)})`;

// ---------------------------------------------------------------- B. real time through the server
function cpuBusy(ms: number): Promise<number> {
  const snap = () => os.cpus().reduce((a, c) => { const t = c.times; a.idle += t.idle; a.all += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, all: 0 });
  const a = snap();
  return sleep(ms).then(() => { const b = snap(); return 100 * (1 - (b.idle - a.idle) / Math.max(1, b.all - a.all)); });
}

async function realRun(cond: Conditions, buffer: Partial<BufferParams>, redundant: number, port: number) {
  const WS = `ws://127.0.0.1:${port}/ws`, RUN_S = 14, DROP_AT_S = 9;
  const a = new Net(WS, { ...cond, redundant }), b = new Net(WS, { ...cond, buffer });
  const perf = () => performance.now(), yieldLoop = () => new Promise((r) => setImmediate(r));
  try {
    const { room } = await a.connect({ room: null, stage: 'void', world: 'w' });
    await b.connect({ room });
    const pose = { p: new Float64Array(DIM_LM).fill(0.25), root: [0.25, 0.25, 0.25], yaw: 0.25 };
    const out = { p: new Float64Array(DIM_LM), root: [0, 0, 0], yaw: 0 }, S: Sample[] = [];
    let firstOk: number | null = null, dropped = false, back: number | null = null;
    a.on('open', () => { if (dropped) back = perf(); });
    const t0 = perf(), dropT = t0 + DROP_AT_S * 1000;
    let next = t0;
    while (perf() - t0 < RUN_S * 1000) {
      const now = perf();
      if (now >= next) {
        next = Math.max(next + FRAME, now + FRAME / 2);                  // no catch-up bursts after a stall
        if (!dropped && now >= dropT) { dropped = true; a.ws!.close(); }
        pose.p[0] = src(a.now());
        a.sendPose(pose, { world: 'w' });
        const r = b.remotePose(out, 0), t = perf();
        if (r.ok) {
          firstOk ??= t;
          const bn = b.now(), buf = b.buffer(0)!;
          if (t >= firstOk + 3000) S.push({ t, now: bn, slow: t - now > 5, y: out.p[0], err: out.p[0] - src(bn - buf.delay), delay: buf.delay, k: out.p[5], away: t >= dropT && t < (back ?? dropT) + 1500, mode: buf.mode, blend: buf.blending });
        }
      }
      await yieldLoop();
    }
    return { S, back: back != null ? back - dropT : null, rtt: [a.rtt, b.rtt], jitter: b.buffer(0)!.jitter, sync: Math.abs(a.now() - b.now()) };
  } finally {
    a.close(); b.close();
  }
}

// ---------------------------------------------------------------- the runs
const only = process.argv[2];            // 'virtual' or 'real' runs one half; 'sweep' prints a tuning table and stops
if (only === 'sweep') {
  for (const cond of [LAG200, { lag: 40, jitter: 10, loss: 0 }, { lag: 40, jitter: 10, loss: 2 }]) {
    console.log(`lag ${cond.lag} / jitter ${cond.jitter} / loss ${cond.loss}`);
    for (const LEAD of [1.5, 2]) for (const BEND_MS of [0, 40, 60, 100]) for (const EXTRAP_MS of [80, 120]) for (const red of [2]) {
      const r = suite(cond, { ...BUFFER_PARAMS, LEAD, BEND_MS, EXTRAP_MS }, red);
      const worst = r.steady.reduce((a, m) => (m.maxStep > a.maxStep ? m : a));
      console.log(line(`L${LEAD} B${BEND_MS} E${EXTRAP_MS} R${red}`, { ...r.pooled, maxStep: worst.maxStep }));
    }
  }
  process.exit(0);
}
try {
  if (only !== 'real') {
    console.log(`source: one landmark coordinate = ${AMP} sin(2pi ${HZ} t) m (peak speed ${(AMP * W).toFixed(2)} m/s); pose ${DIM} floats`);
    console.log('A. virtual time, 3 seeds x 14 s, warm-up 3 s, steady frames (outside the 1 s outage and 1.5 s after it)\n');
    const table: Record<string, ReturnType<typeof suite>> = {};
    for (const cond of [{ lag: 200, jitter: 0, loss: 0 }, { lag: 200, jitter: 80, loss: 0 }, { lag: 200, jitter: 0, loss: 10 }, LAG200, { lag: 40, jitter: 10, loss: 0 }, { lag: 40, jitter: 10, loss: 2 }]) {
      console.log(`lag ${cond.lag} / jitter ${cond.jitter} / loss ${cond.loss}`);
      for (const v of VARIANTS) {
        const r = suite(cond, v.params, v.redundant);
        table[`${cond.lag}/${cond.jitter}/${cond.loss} ${v.name}`] = r;
        console.log(line(v.name, r.pooled));
        if (v.name === 'before (prototype)' || v.name === 'after') console.log(`  ${''.padEnd(22)} ${r.modes}`);
      }
      console.log('');
    }
    const before = table['200/80/10 before (prototype)'], after = table['200/80/10 after'];
    const r0 = after.runs[0];
    console.log(`  lag 200/80/10, seed 1: ${r0.lost} of ${r0.frames} frames lost end to end (${((100 * r0.lost) / r0.frames).toFixed(1)}%), ${r0.reorders} reordered`);
    for (let i = 0; i < 3; i++) console.log(`  seed ${i + 1} after: outage+recovery step ${(after.outage[i].maxStep / SRC_STEP).toFixed(2)}x acc ${(after.outage[i].maxAcc / SRC_ACC).toFixed(2)}x; before: step ${(before.outage[i].maxStep / SRC_STEP).toFixed(2)}x acc ${(before.outage[i].maxAcc / SRC_ACC).toFixed(2)}x`);

    // The prototype's own bounds still hold for its buffer (they were loosened twice to get there) ...
    await step('before: the prototype buffer meets its own loosened bound (rms < 0.035, p95 < 0.09)', () => {
      for (const m of before.steady) { assert.ok(m.rms < 0.035, `rms ${m.rms}`); assert.ok(m.p95 < 0.09, `p95 ${m.p95}`); }
    });
    // ... and the new one meets bounds three times tighter
    await step('after: no discontinuity in steady play (step <= 1.3x, |acc| <= 2.5x source) at lag 200 / jitter 80 / loss 10', () => {
      for (const m of after.steady) { assert.ok(m.maxStep <= 1.3 * SRC_STEP, `step ${m.maxStep}`); assert.ok(m.maxAcc <= 2.5 * SRC_ACC, `acc ${m.maxAcc}`); }
    });
    await step('after: no snap through a 1 s outage and recovery (step <= 1.5x, |acc| <= 6x source)', () => {
      for (const m of after.outage) { assert.ok(m.maxStep <= 1.5 * SRC_STEP, `step ${m.maxStep}`); assert.ok(m.maxAcc <= 6 * SRC_ACC, `acc ${m.maxAcc}`); }
    });
    await step('after: tracks the source at the playback time (rms < 0.008 each seed, p95 < 0.006) at lag 200 / jitter 80 / loss 10', () => {
      for (const m of after.steady) { assert.ok(m.rms < 0.008, `rms ${m.rms}`); assert.ok(m.p95 < 0.006, `p95 ${m.p95}`); }
    });
    await step('after: correct at lag 40 / jitter 10 (rms < 0.002 m, delay under 170 ms)', () => {
      for (const m of table['40/10/0 after'].steady) { assert.ok(m.rms < 0.002, `rms ${m.rms}`); assert.ok(m.dMax < 170, `delay ${m.dMax}`); }
    });
    await step('constant components stay exactly constant; delay within 80..350 ms', () => {
      for (const S of after.runs.map((r) => r.S)) { const m = analyse(S); assert.ok(m.constStep < 1e-12); assert.ok(m.dMin >= 80 && m.dMax <= 350); }
    });

    await step('yaw spinning through ±π and the root walking: continuous, the short way round', () => {
      const buf = new PoseBuffer(), out = new Float64Array(DIM), rnd = mulberry32(9);
      const yawAt = (t: number) => (t / 1000) * 5, xAt = (t: number) => (t / 1000) * 1.4;   // 5 rad/s, 1.4 m/s
      const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
      const arr: { at: number; ts: number }[] = [];
      for (let ts = 0; ts < 6000; ts += 50) if (rnd() > 0.19) arr.push({ at: ts + 200 + (rnd() * 2 - 1) * 80, ts });
      arr.sort((a, b) => a.at - b.at);
      let ai = 0, lastYaw: number | null = null, lastX: number | null = null, maxDy = 0, maxDx = 0, maxErr = 0;
      for (let t = 0; t < 6000; t += FRAME) {
        while (ai < arr.length && arr[ai].at <= t) {
          const { ts } = arr[ai++], v = new Float64Array(DIM);
          v[YAW] = wrap(yawAt(ts)); v[0] = xAt(ts);
          buf.push(ts, v, { flags: 0, energy: 0, world: 'w', move: null }, t);
        }
        if (!buf.sample(out, t).ok) continue;
        if (lastYaw != null && t > 1500) { maxDy = Math.max(maxDy, Math.abs(wrap(out[YAW] - lastYaw))); maxDx = Math.max(maxDx, Math.abs(out[0] - lastX!)); maxErr = Math.max(maxErr, Math.abs(wrap(out[YAW] - yawAt(t - buf.delay)))); }
        lastYaw = out[YAW]; lastX = out[0];
        assert.ok(out[YAW] > -Math.PI - 1e-9 && out[YAW] <= Math.PI + 1e-9);
      }
      console.log(`      yaw step per frame max ${maxDy.toFixed(4)} rad (source ${(5 / 60).toFixed(4)}), root step ${maxDx.toFixed(4)} m (source ${(1.4 / 60).toFixed(4)}), yaw error max ${maxErr.toFixed(4)} rad`);
      assert.ok(maxDy < 1.5 * (5 / 60), 'no wrap the long way');
      assert.ok(maxDx < 1.5 * (1.4 / 60));
      assert.ok(maxErr < 0.08, 'within 4.6 degrees, with a fifth of the frames lost and none repeated');
    });

    await step('a new world, a teleport or a jump is a cut, not a slide', () => {
      const buf = new PoseBuffer(), out = new Float64Array(DIM), m = (world: string, flags = 0) => ({ flags, energy: 0, world, move: null });
      const at = (x: number) => { const v = new Float64Array(DIM); v[0] = x; return v; };
      for (let ts = 0; ts <= 500; ts += 50) buf.push(ts, at(0), m('a'), ts + 100);
      buf.sample(out, 600);
      buf.push(550, at(20), m('b'), 650);                                 // a portal: 20 m away in another world
      buf.push(500, at(0), m('a'), 651);                                  // a late frame from before it: ignored
      for (let t = 660; t < 1200; t += FRAME) buf.sample(out, t);
      assert.equal(out[0], 20); assert.equal(buf.cuts, 1);
      buf.push(1100, at(21), m('b', 1 << 12), 1150);                      // TELEPORT flag
      buf.push(1150, at(30), m('b'), 1250);                               // a 9 m jump in 50 ms
      for (let t = 1200; t < 1800; t += FRAME) buf.sample(out, t);
      assert.equal(buf.cuts, 3); assert.equal(out[0], 30);
    });
  }

  if (only !== 'virtual') {
    const busy = await cpuBusy(2000);
    console.log(`\nB. real time through server/index.ts. CPU busy over the 2 s before: ${busy.toFixed(0)}% of ${os.cpus().length} logical cores`);
    const PORT = 5418, srv = await startServer(PORT);
    try {
      for (const v of [VARIANTS[0], VARIANTS[VARIANTS.length - 1]]) {
        const B = await realRun(LAG200, v.params, v.redundant, PORT);
        const S = B.S, dts = S.slice(1).map((x, i) => x.t - S[i].t);
        const stalledIn = (X: Sample[]) => (i: number) => X[i].t - X[i - 1].t > 25 || X[i - 1].t - X[i - 2].t > 25 || !!X[i].slow || !!X[i - 1].slow || !!X[i - 2].slow;
        const SS = S.filter((x) => !x.away), st = stalledIn(S), sst = stalledIn(SS);
        // judged: frames with no stall next to them; the steady figures leave out the outage and the 1.5 s after it
        const mB = analyse(S, (i) => !st(i)), mBall = analyse(S), steadyB = analyse(SS, (i) => !sst(i));
        console.log(`  ${v.name}: frames ${S.length}, frame dt ${Math.min(...dts).toFixed(1)}..${Math.max(...dts).toFixed(1)} ms, ${dts.filter((d) => d > 25).length} stalls > 25 ms, ${mB.judged} frames judged`);
        console.log(line('  steady, unstalled', steadyB));
        console.log(line('  incl. the outage', mB));
        console.log(`    all frames incl. stalls: step ${(mBall.maxStep / SRC_STEP).toFixed(2)}x, acc ${(mBall.maxAcc / SRC_ACC).toFixed(2)}x; ${byMode(S.filter((x) => !x.away))}`);
        console.log(`    rtt a ${B.rtt[0].toFixed(0)} b ${B.rtt[1].toFixed(0)} ms, receiver jitter ${B.jitter.toFixed(1)} ms, clock |a-b| ${B.sync.toFixed(1)} ms, sender back after ${B.back != null ? B.back.toFixed(0) + ' ms' : 'NEVER'}`);
        if (v.name !== 'after') continue;
        await step('B: sender reconnected', () => assert.ok(B.back != null));
        await step('B: constant components stay constant; delay within 80..350 ms', () => { assert.ok(mBall.constStep < 1e-9); assert.ok(mBall.dMin >= 80 && mBall.dMax <= 350); });
        if (mB.judged < S.length / 2) {
          console.log(`SKIP B: not judged, only ${mB.judged} of ${S.length} frames unstalled (machine too loaded: ${busy.toFixed(0)}% busy)`);
        } else {
          await step('B: no discontinuity on unstalled frames (step <= 1.5x, |acc| <= 6x source)', () => {
            assert.ok(mB.maxStep <= 1.5 * SRC_STEP, `step ${mB.maxStep}`);
            assert.ok(mB.maxAcc <= 6 * SRC_ACC, `acc ${mB.maxAcc}`);
          });
          const linkOk = Math.max(...B.rtt) <= 1.3 * LAG200.lag + 20 && B.jitter <= 1.5 * LAG200.jitter;
          if (linkOk) await step('B: tracks the source in real time (rms < 0.02)', () => assert.ok(steadyB.rms < 0.02, `rms ${steadyB.rms}`));
          else console.log(`SKIP B tracking: measured rtt ${B.rtt.map((x) => x.toFixed(0)).join('/')} ms, jitter ${B.jitter.toFixed(0)} ms exceed the conditioner: machine too loaded`);
        }
      }
    } finally {
      await srv.stop();
    }
  }
} catch (e) {
  console.error(e);
}
finish();
