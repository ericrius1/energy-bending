// The online crossing without a network (crossing.ts, duel-authority.ts, duel-client.ts): the server's authority and
// two pages' clients in one process, joined by a pretend link with a fixed delay each way, stepped on one clock. Seat 1
// walks through the temple's mirror to the Pool, seat 2 follows; the server judges it, each page predicts its own body's
// crossing or is brought along, and both pages end in the Pool with the server. Deterministic and fast (the real
// sockets and the conditioner are test/duel.test.ts's).
import { test, assert, done } from '../dancer/test/check';
import { DuelAuthority } from './duel-authority';
import { DuelClient } from './duel-client';
import { duelDoors } from '../duel/crossing';
import { makeIntent } from '../input/intent';
import { decodeDuelInputs } from '../../shared/protocol.ts';

declare const process: { env: Record<string, string | undefined> };
const DEBUG = !!process.env.CROSS_DEBUG;

function play(oneWay: number, secs: number, back = false, jitter = 0) {
  let now = 1000;
  const A = new DuelAuthority({ world: 'temple', dress: ['fire', 'water'], matter: ['fire', 'water'], locked: false, setS: 120, t0: now });
  const pipe: { at: number; f: () => void }[] = [];
  // (each way `oneWay` ms, and up to `jitter` more for the binary frames, inputs and snapshots, as the conditioner's;
  // the reliable events keep their order)
  let seed = 7, lastText = 0;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const later = (f: () => void, lossy = false) => { const at = lossy ? now + oneWay + rnd() * jitter : (lastText = Math.max(lastText, now + oneWay + rnd() * jitter)); pipe.push({ at, f }); };
  const clients: DuelClient[] = [];
  for (let k = 0; k < 3; k++) {
    const link = { now: () => now, rtt: 2 * oneWay + jitter, jitter, sendBinary: (b: Uint8Array) => { const l = decodeDuelInputs(b)!; later(() => { if (k < 2) A.receive(k, l); }, true); } };
    clients.push(new DuelClient({ welcome: A.welcome(), seat: k < 2 ? k : null, link, plane: null }));
  }
  A.seat(0, true); A.seat(1, true);
  const D = duelDoors();
  // (once to the Pool; or, `back`, there and back between the temple and the redwoods, dry both sides)
  const route: Record<string, string> = back ? { temple: 'temple.to.redwoods', redwoods: 'redwoods.to.temple' } : { temple: 'temple.to.pool' };
  const toward = (from: number[], to: number[]) => { const dx = to[0] - from[0], dz = to[2] - from[2], l = Math.hypot(dx, dz) || 1; const it = makeIntent(); it.moveX = dx / l; it.moveZ = -dz / l; return it; };
  const think = (k: number) => {
    const c = clients[k], me = c.pred!.root;
    if (k === 1) { const o = c.shownChars[0].root; return Math.hypot(o[0] - me[0], o[2] - me[2]) > 1.2 ? toward(me, o) : makeIntent(); }
    const g = D.get(route[c.predWorld] ?? '');
    // (arrived where the route ends: a few steps out from the disc come out of, and stand)
    if (!g) { const o = D.get('pool.to.temple')!, to = [o.at[0] + o.n[0] * 3, 0, o.at[2] + o.n[2] * 3]; return Math.hypot(to[0] - me[0], to[2] - me[2]) > 0.3 ? toward(me, to) : makeIntent(); }
    const front = [g.at[0] + g.n[0] * 2.2, 0, g.at[2] + g.n[2] * 2.2];
    const side = (me[0] - g.at[0]) * g.n[0] + (me[2] - g.at[2]) * g.n[2], across = Math.abs((me[0] - g.at[0]) * g.n[2] - (me[2] - g.at[2]) * g.n[0]);
    return side > -0.1 && side < 2.6 && across < 0.6 ? toward(me, [g.at[0] - g.n[0] * 2, 0, g.at[2] - g.n[2] * 2]) : toward(me, front);
  };
  const shown: string[][] = [[], [], []];
  for (let f = 0; f < secs * 60; f++) {
    now += 1000 / 60;
    while (A.tick < Math.floor((now - A.timeOf(0)) / A.tickMs)) {
      const out = A.step();
      const m = { n: out.n, ev: out.ev, tc: out.tc, pe: out.pe, fx: out.fx, ...(out.x ? { x: out.x } : {}) };
      if (out.ev.length || out.x) for (const c of clients) later(() => c.onEvents(JSON.parse(JSON.stringify(m))));
      if (out.st) { const st = JSON.parse(out.st); for (const c of clients) later(() => c.onState({ n: out.n, ...st })); }
      if (A.tick % 3 === 0) for (let k = 0; k < 3; k++) { const b = A.snapshot(k < 2 ? k : null); later(() => clients[k].onFrame(b), true); }
      if (DEBUG && out.x) console.log('server crossing', JSON.stringify(out.x));
    }
    pipe.sort((a, b) => a.at - b.at);
    while (pipe.length && pipe[0].at <= now) pipe.shift()!.f();
    for (let k = 0; k < 3; k++) {
      const c = clients[k];
      c.update(1000 / 60, k < 2 && c.running ? think(k) : null, 0);
      c.show(1000 / 60);
      for (const x of c.takeCrossings()) shown[k].push(`${x.from}>${x.to} ${x.why}`);
    }
    if (DEBUG && f % 6 === 0 && clients[0].pred) {
      const p = clients[0].pred.root, s = A.chars[0].root;
      console.log(f, clients[0].predWorld, p.map((v) => v.toFixed(2)).join(','), '| server', A.world.id, s.map((v) => v.toFixed(2)).join(','));
    }
  }
  return { A, clients, shown };
}

for (const oneWay of [0, 40, 100]) {
  test(`a crossing online at ${2 * oneWay} ms round trip: the server crosses, the crosser predicts it, every page follows`, () => {
    const { A, clients, shown } = play(oneWay, 14);
    assert(A.crossings.length >= 1 && A.world.id === 'pool', `the server crossed (${A.crossings.map((c) => `${c.to} by ${c.seat + 1} @${c.n}`).join(', ')})`);
    const r = clients.map((c) => c.report());
    for (const [k, c] of clients.entries()) {
      assert(!c.lost, `page ${k} lost (${c.lostWhy})`);
      assert(c.world === 'pool' && c.shownWorld === 'pool', `page ${k} in ${c.world}, shows ${c.shownWorld}`);
      assert(shown[k].length === 1, `page ${k} changed world ${shown[k].join('; ')}`);
    }
    assert(r[0].crossings.predicted >= 1 && r[0].crossings.agreed >= 1, `the crosser predicted it (${JSON.stringify(r[0].crossings)})`);
    assert(r[1].crossings.brought >= 1, 'the other was brought along');
    return `${A.crossings.length} crossing; error near it, page 1 p95 ${r[0].crossings.err.p95Mm} mm, page 2 p95 ${r[1].crossings.err.p95Mm} mm; shown ${shown.map((s) => s.join(',')).join(' | ')}`;
  });
}

test('there and back between the temple and the redwoods at 200 ms round trip: each page follows every crossing, few put back', () => {
  const { A, clients, shown } = play(100, 40, true, Number(process.env.CROSS_JITTER ?? 40));
  const r = clients.map((c) => c.report());
  assert(A.crossings.length >= 3, `the server crossed ${A.crossings.length} times`);
  for (const [k, c] of clients.entries()) assert(!c.lost && c.world === A.world.id, `page ${k} in ${c.world} (${c.lostWhy})`);
  if (DEBUG) for (const [k, x] of r.entries()) console.log(k, JSON.stringify(x.crossings), shown[k].join(', '));
  for (const [k, x] of r.entries()) assert(x.crossings.putBack <= 1 && x.crossings.flips <= 1, `page ${k}: ${x.crossings.putBack} put back, ${x.crossings.flips} back and forth`);
  return `${A.crossings.length} crossings (${A.crossings.map((x) => `${x.from}>${x.to} by ${x.seat + 1}`).join(', ')}); predicted ${r[0].crossings.predicted} + ${r[1].crossings.predicted}, put back ${r[0].crossings.putBack} + ${r[1].crossings.putBack}; error near them p95 ${r[0].crossings.err.p95Mm} / ${r[1].crossings.err.p95Mm} mm`;
});

done();
