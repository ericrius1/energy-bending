// The online duel's prediction without a network (duel-authority.ts, duel-client.ts; report 22): the server's authority
// and two pages' clients in one process, joined by a pretend link with a fixed delay each way, stepped on one clock, each
// seat played by a virtual player (src/ai/duel-brain.ts) as test/duel.test.ts plays them over real sockets. What each
// page predicted for its own body at every acknowledged input is compared with where the server had it. Deterministic,
// so a prediction that leaves the server's rule shows here at once, without the machine's load in the numbers:
//   - a flung body's flight (Character.flightT, set by the contact at the server only) in the kit
//   - the beat, the other's place (lookAt) and the frozen count-in or reform, on the tick the server steps the input
//   - a hold the holder lets go of ends on that tick
//   - ticks the server stepped without an input (a page that stalled) stepped again here, those it told of at a snapshot
//     (`r`) and those found between two acks (regap)
import { test, assert, done } from '../dancer/test/check';
import { DuelAuthority, duelWorld } from './duel-authority';
import { DuelClient } from './duel-client';
import { DuelBrain } from '../ai/duel-brain';
import { BrainDriver } from '../ai/driver';
import { Scene } from '../ai/scene';
import { duelPlane } from '../duel/match';
import { decodeDuelInputs } from '../../shared/protocol.ts';
import { POWERS, POWER, type Matter } from '../../shared/powers.ts';

type Any = any;

/** `secs` of a 40 s set in the temple, seats played by virtual players (seeded); `stall`: page 0 stops for that many
 *  frames every 3 s, then catches up in one long frame */
function play(seed: number, oneWay: number, secs: number, stall = 0) {
  let now = 1000;
  const A = new DuelAuthority({ world: 'temple', dress: ['fire', 'water'], matter: ['fire', 'water'], locked: false, setS: 40, t0: now });
  const W = duelWorld('temple')!;
  const pipe: { at: number; f: () => void }[] = [];
  const later = (f: () => void) => pipe.push({ at: now + oneWay, f });
  const clients: DuelClient[] = [0, 1].map((k) => new DuelClient({
    welcome: A.welcome(), seat: k, plane: null,
    link: { now: () => now, rtt: 2 * oneWay, jitter: 0, sendBinary: (b: Uint8Array) => { const l = decodeDuelInputs(b)!; later(() => A.receive(k, l)); } },
  }));
  A.seat(0, true); A.seat(1, true);
  const powersSight = (pw: Any) => pw?.seats?.map((s: Any) => ({ flow: s.flow, form: 0, ids: POWERS[s.matter as Matter].powers, ready: [s.flow >= POWER.COST, s.flow >= POWER.COST], matter: s.matter }));
  const players = clients.map((c, k) => {
    const scene = new Scene();
    const bodies = [0, 1].map((j) => ({ id: `seat.${j}`, seat: j, character: j === k ? c.pred! : c.shownChars[j] }));
    (scene as Any).bodies = bodies;
    const stage = { plane: null, stage: duelPlane(W.arena), terrain: { groundAt: (x: number, z: number) => W.world.groundAt(x, z) }, gates: [], room: W.arena.space.radius, solids: W.world.solids };
    const sight = () => ({
      frozen: [0, 1].map((j) => !!((c.newest[j]?.flags ?? 0) & 2048)), link: c.link ? { holder: c.link.holder, held: c.link.held, age: c.link.age ?? 0 } : null,
      flown: c.flown?.flyer ?? null, yKill: W.arena.space.yKill, space: W.arena.space, spawns: W.arena.spawns, solids: W.world.solids,
      groundAt: (x: number, z: number) => W.world.groundAt(x, z), powers: powersSight(c.powers),
    });
    const brain = new DuelBrain({ style: k ? 'flyer' : 'lead', skill: 0.75, seed: seed + k, duel: sight as Any });
    return { scene, driver: new BrainDriver(brain, bodies[k] as Any, scene as Any, () => stage as Any) };
  });
  for (let f = 0; f < secs * 60; f++) {
    now += 1000 / 60;
    if (f === 4 * 60) for (const c of clients) c.resetStats();
    while (A.tick < Math.floor((now - A.timeOf(0)) / A.tickMs)) {
      const out = A.step();
      const m = { n: out.n, ev: out.ev, tc: out.tc, pe: out.pe, fx: out.fx, ...(out.x ? { x: out.x } : {}) };
      if (out.ev.length || out.x) for (const c of clients) later(() => c.onEvents(JSON.parse(JSON.stringify(m))));
      if (out.st) { const st = JSON.parse(out.st); for (const c of clients) later(() => c.onState({ n: out.n, ...st })); }
      if (A.tick % 3 === 0) for (let k = 0; k < 2; k++) { const b = A.snapshot(k); later(() => clients[k].onFrame(b)); }
    }
    pipe.sort((a, b) => a.at - b.at);
    while (pipe.length && pipe[0].at <= now) pipe.shift()!.f();
    for (let k = 0; k < 2; k++) {
      const c = clients[k], P = players[k], ph = f % 180;
      if (k === 0 && stall && ph >= 90 && ph < 90 + stall) continue;
      const dt = k === 0 && stall && ph === 90 + stall ? ((stall + 1) * 1000) / 60 : 1000 / 60;
      P.scene.update({ t: c.now() / 1000, dt: dt / 1000, beat: c.beat(), bpm: c.w.music.bpm, music: { level: 0.7, breakdown: false }, rules: null } as Any);
      const it = c.running ? P.driver.think() : null;
      c.pred!.flourish = null;
      c.update(dt, it, 0);
      c.show(dt);
    }
  }
  return { A, reports: clients.map((c) => c.report()) };
}

const line = (r: ReturnType<DuelClient['report']>) => `p50 ${r.err.p50Mm} / p95 ${r.err.p95Mm} / max ${r.err.maxMm} mm (${r.err.n} acks, ${r.corrections} corrections)`;

for (const seed of [31, 61, 71]) {
  test(`virtual players at 0 ms, seed ${seed}: each page's own body where the server has it (p95 under 20 mm)`, () => {
    const { reports } = play(seed, 0, 18);
    for (const r of reports) assert(r.err.n > 50 && r.err.p95Mm < 20, `page ${r.seat}: ${line(r)}`);
    return reports.map((r) => `page ${r.seat} ${line(r)}`).join('; ');
  });
}
test('virtual players at 80 ms round trip, seed 31: the same (p95 under 20 mm)', () => {
  const { reports } = play(31, 40, 18);
  for (const r of reports) assert(r.err.n > 50 && r.err.p95Mm < 20, `page ${r.seat}: ${line(r)}`);
  return reports.map((r) => `page ${r.seat} ${line(r)}`).join('; ');
});
test('a page that stalls 12 frames every 3 s: the ticks the server stepped without its inputs are stepped again (p95 under 20 mm, max under 150)', () => {
  const { A, reports } = play(61, 0, 18, 12);
  const starved = A.stats().seats[0].starved;
  assert(starved > 30, `the server starved seat 1 (${starved} ticks)`);
  for (const r of reports) assert(r.err.n > 50 && r.err.p95Mm < 20 && r.err.maxMm < 150, `page ${r.seat}: ${line(r)}`);
  return `${starved} ticks starved; ` + reports.map((r) => `page ${r.seat} ${line(r)}`).join('; ');
});

done();
