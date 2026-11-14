// The online duel (server authoritative: server/duel.ts, src/net/duel-authority.ts, src/net/duel-client.ts). First
// without a network: the codecs, and the authority stepping a whole set from two virtual players' inputs (what a
// tick costs). Then the room server as its own process with two Net clients, each a DuelClient driven by a virtual
// player (src/ai/duel-brain.ts) in real time, as two pages would be, at 0, 80 and 200 ms of lag (the conditioner):
// bytes a second each way, the prediction's error at each acknowledged input and the corrections, catches felt at
// once and whether the server confirmed them, and that both pages got the same events in the same order. Watchers
// and refusals at the end. The duel's code is the game's TypeScript, bundled as the server bundles it.
//   node test/duel.test.ts [seconds per condition, default 14] [--json out.json]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, waitFor, sleep, step, finish } from './helpers.ts';
import { Net } from '../src/net/net.ts';
import { loadDuelEngine } from '../server/duel.ts';
import {
  encodeDuelInputs, decodeDuelInputs, encodeDuelSnap, decodeDuelSnap, DUEL_BTN,
  type DuelHello, type DuelInput, type DuelWelcome,
} from '../shared/protocol.ts';
import { POWERS, POWER, type Matter } from '../shared/powers.ts';

const argv = process.argv.slice(2);
const SECONDS = Number(argv.find((a) => /^\d+$/.test(a)) ?? 14);
const jsonAt = argv.indexOf('--json'), JSON_OUT = jsonAt >= 0 ? argv[jsonAt + 1] : null;
const PORT = 5418, WS = `ws://127.0.0.1:${PORT}/ws`, HTTP = `http://127.0.0.1:${PORT}`;

// the bundle's exports, as loosely as the test uses them
type Any = any;
const M = (await loadDuelEngine(() => {})) as unknown as Record<string, Any>;
assert.ok(M, 'the duel engine bundles');
const { DuelAuthority, DuelClient, DuelBrain, BrainDriver, Scene, duelWorld, inputOf, duelPlane, Character } = M;

const HELLO: DuelHello = { world: 'temple', dress: ['fire', 'water'], matter: ['fire', 'water'], locked: false, setS: 40 };
const report: Record<string, unknown> = {};

/** a virtual player for a seat, seeing the duel through `look` (the bodies and the mirror) */
function brainFor(seat: number, seed: number, look: () => { chars: [Any, Any]; frozen: [boolean, boolean]; link: Any; flown: number | null; powers: Any[] | undefined }, world: Any) {
  const sight = () => {
    const v = look();
    return { frozen: v.frozen, link: v.link ? { holder: v.link.holder, held: v.link.held, age: v.link.age ?? 0 } : null, flown: v.flown, yKill: world.arena.space.yKill, space: world.arena.space, spawns: world.arena.spawns, solids: world.world.solids, groundAt: (x: number, z: number) => world.world.groundAt(x, z), ...(v.powers ? { powers: v.powers } : {}) };
  };
  return new DuelBrain({ style: seat ? 'flyer' : 'lead', skill: 0.75, seed, duel: sight });
}
const powersSight = (pw: Any): Any[] | undefined => pw?.seats?.map((s: Any) => {
  const m = s.matter as Matter;
  return { flow: s.flow, form: 0, ids: POWERS[m].powers, ready: [s.flow >= POWER.COST, s.flow >= POWER.COST], matter: m };
});

try {
  await step('codecs: inputs and snapshots round trip', () => {
    const list: DuelInput[] = [0, 1, 2, 3].map((i) => ({ seq: 1000 + i, mx: 0.5, my: -1, mz: 0.25, au: -1, b: DUEL_BTN.jump | DUEL_BTN.punchHeld, yaw: 1.2, ax: 0.3, ay: -0.2, view: 912.5 + i }));
    const f = encodeDuelInputs(list);
    assert.equal(f.length, 6 + 4 * 16);
    const back = decodeDuelInputs(f)!;
    assert.equal(back.length, 4); assert.equal(back[3].seq, 1003); assert.equal(back[0].b, DUEL_BTN.jump | DUEL_BTN.punchHeld);
    assert.ok(Math.abs(back[0].mx - 0.5) < 0.01 && Math.abs(back[0].yaw - 1.2) < 1e-3 && back[0].au === -1 && Math.abs(back[2].view - 914.5) < 1e-3);
    const p = new Float64Array(39).map((_, i) => (i % 7) * 0.1 - 0.3);
    const body = { seat: 1, ts: 123456.5, root: [1.5, 0.25, -3] as [number, number, number], yaw: -2, p, flags: 64 | 2, move: ['spin', 0.12] as [string, number], v: [3.2, -1, 0.5] as [number, number, number], lgy: 0.25, style: 0x31, energy: 0.5 };
    const s = encodeDuelSnap({ tick: 77, ts: 123456.5, ack: 41, bodies: [body, { ...body, seat: 0, move: null }] }, '{"a":1}');
    const d = decodeDuelSnap(s)!;
    assert.equal(d.tick, 77); assert.equal(d.ack, 41); assert.equal(d.bodies.length, 2); assert.deepEqual(d.x, { a: 1 });
    assert.deepEqual(d.bodies[0].move, ['spin', 0.12]); assert.equal(d.bodies[1].move, null);
    assert.ok(Math.abs(d.bodies[0].v[0] - 3.2) < 0.01 && Math.abs(d.bodies[0].p[5] - p[5]) < 0.001 && d.bodies[0].flags === (64 | 2) && d.bodies[0].style === 0x31);
    assert.equal(decodeDuelSnap(s.subarray(0, s.length - 1)), null);
    report.snapBytes = s.length;
  });

  await step('the authority plays a whole set from two virtual players\' inputs (what a tick costs)', () => {
    const A = new DuelAuthority({ ...HELLO, setS: 20, t0: 0 });
    const W = duelWorld('temple');
    const scene = new Scene();
    scene.bodies = [0, 1].map((k) => ({ id: `seat.${k}`, seat: k, character: A.chars[k] }));
    const stage = { plane: null, stage: duelPlane(W.arena), terrain: { groundAt: (x: number, z: number) => W.world.groundAt(x, z) }, gates: [], room: W.arena.space.radius, solids: W.world.solids };
    const drivers = [0, 1].map((k) => new BrainDriver(brainFor(k, 11 + k, () => ({ chars: A.chars, frozen: [A.match.frozen(0), A.match.frozen(1)], link: A.match.contact.link, flown: A.match.contact.flown?.flyer ?? null, powers: A.powers.sight() }), W), scene.bodies[k], scene, () => stage));
    A.seat(0, true); A.seat(1, true);
    const seq = [0, 0], kinds: Record<string, number> = {};
    let done = null as Any;
    for (let i = 0; i < 60 * 40 && !done; i++) {
      scene.update({ t: A.now / 1000, dt: 1 / 60, beat: (A.now * A.bpm) / 60000, bpm: A.bpm, music: { level: 0.7, breakdown: false }, rules: null });
      for (let k = 0; k < 2; k++) { const it = drivers[k].think(); A.chars[k].flourish = null; A.receive(k, [inputOf(it, seq[k]++, 0, A.tick)]); }
      const out = A.step();
      for (const e of out.ev) { if (e.k === 'link') kinds[e.kind] = (kinds[e.kind] ?? 0) + 1; if (e.k === 'done') done = e; }
      if (i % 3 === 0) A.snapshot(0);
    }
    assert.ok(done, 'the set ended');
    assert.ok((kinds.catch ?? 0) + (kinds.aerial ?? 0) > 2, `catches: ${JSON.stringify(kinds)}`);
    const st = A.stats();
    console.log(`     a 20 s set in ${A.tick} ticks: links ${JSON.stringify(kinds)}; style ${done.style.join('-')}; a tick ${st.tickMs.mean.toFixed(3)} ms mean, ${st.tickMs.p99.toFixed(3)} p99, ${st.tickMs.max.toFixed(2)} max`);
    report.authority = { ticks: A.tick, links: kinds, tickMs: st.tickMs };
    assert.ok(st.tickMs.p99 < 4, 'a tick under 4 ms (p99)');
  });

  const srv = await startServer(PORT, { ROOM_GRACE_MS: '1500' });
  try {
    await step('the server has the duel engine (/duels)', async () => {
      const r = await (await fetch(HTTP + '/duels')).json();
      assert.equal(r.engine, true);
    });

    for (const lag of [0, 80, 200]) {
      await step(`two virtual players in one room at ${lag} ms of lag: prediction, catches, the same events`, async () => {
        const jitter = lag ? lag / 5 : 0;
        const room = `D${lag}X${Date.now() % 1000}`;
        const nets = [new Net(WS, { lag, jitter }), new Net(WS, { lag, jitter })];
        // (the events and the state are taken from the first, before the client is made: none is missed)
        const clients: Any[] = [null, null], early: [string, Any][][] = [[], []];
        nets.forEach((n, k) => {
          n.on('dev' as Any, (m: Any) => (clients[k] ? clients[k].onEvents(m, JSON.stringify(m).length) : early[k].push(['dev', m])));
          n.on('dst' as Any, (m: Any) => (clients[k] ? clients[k].onState(m, JSON.stringify(m).length) : early[k].push(['dst', m])));
        });
        const infos = [];
        for (const n of nets) infos.push(await n.connect({ room, create: true, duel: HELLO }));
        assert.deepEqual(infos.map((i) => i.slot), [0, 1]);
        const W = duelWorld('temple');
        nets.forEach((n, k) => {
          const welcome = n.duel as DuelWelcome;
          assert.ok(welcome && welcome.world === 'temple');
          const terrain = { groundAt: (x: number, z: number) => W.world.groundAt(x, z), fallY: W.world.fallY, get solids() { return [...W.world.solids, ...c.solids]; } };
          const c = new DuelClient({ welcome, seat: k, link: n, terrain, plane: null, arena: W.arena });
          n.onFrame = (b) => c.onFrame(b);
          for (const [t, m] of early[k]) { if (t === 'dev') c.onEvents(m); else c.onState(m); }
          clients[k] = c;
        });
        // each page's virtual player sees what its page shows: its own body predicted, the other as played back
        const players = clients.map((c, k) => {
          const scene = new Scene();
          const bodies = [0, 1].map((j) => ({ id: `seat.${j}`, seat: j, character: j === k ? c.pred : c.shownChars[j] }));
          scene.bodies = bodies;
          const stage = { plane: null, stage: duelPlane(W.arena), terrain: { groundAt: (x: number, z: number) => W.world.groundAt(x, z) }, gates: [], room: W.arena.space.radius, solids: W.world.solids };
          const look = () => ({ chars: [bodies[0].character, bodies[1].character] as [Any, Any], frozen: [0, 1].map((j) => !!((c.newest[j]?.flags ?? 0) & 2048)) as [boolean, boolean], link: c.link, flown: c.flown?.flyer ?? null, powers: powersSight(c.powers) });
          return { scene, driver: new BrainDriver(brainFor(k, 31 + k + lag, look, W), bodies[k], scene, () => stage) };
        });
        let last = performance.now(), frames = 0;
        const run = async (ms: number) => {
          const end = performance.now() + ms;
          while (performance.now() < end) {
            const t = performance.now(), dt = Math.min(100, t - last); last = t; frames++;
            for (let k = 0; k < 2; k++) {
              const c = clients[k], P = players[k];
              P.scene.update({ t: c.now() / 1000, dt: dt / 1000, beat: c.beat(), bpm: c.w.music.bpm, music: { level: 0.7, breakdown: false }, rules: null });
              const it = c.running ? P.driver.think() : null;
              c.pred.flourish = null;
              c.update(dt, it, 0);
              c.show(dt);
            }
            await sleep(4);
          }
        };
        await run(4000);                       // the count-in and a few seconds of play
        for (const c of clients) c.resetStats();
        const t0 = performance.now();
        await run(SECONDS * 1000);
        const secs = (performance.now() - t0) / 1000;
        const duel = (await (await fetch(HTTP + '/duels')).json()).duels.find((d: Any) => d.room === room.toUpperCase());
        const reps = clients.map((c) => c.report());
        await sleep(400 + lag * 2);            // the last events in flight
        // the same events, in the same order, on both pages
        const tickOf = (l: string) => Number(l.slice(0, l.indexOf(' ')));
        let [la, lb] = clients.map((c) => c.log as string[]);
        const from = Math.max(tickOf(la[0]), tickOf(lb[0]));
        la = la.filter((l) => tickOf(l) >= from); lb = lb.filter((l) => tickOf(l) >= from);
        const n = Math.min(la.length, lb.length);
        assert.ok(n > 10, `events: ${la.length}, ${lb.length}`);
        for (let i = 0; i < n; i++) assert.equal(la[i], lb[i], `event ${i} differs`);
        assert.ok(Math.abs(la.length - lb.length) <= 3, `both pages got them all (${la.length}, ${lb.length})`);
        for (const [k, r] of reps.entries()) {
          console.log(`     page ${k}: in ${r.inKBs} KB/s (events ${r.devKBs}), out ${r.outKBs} KB/s; snapshots ${(r.snaps / secs).toFixed(1)}/s; prediction error at the ack: rms ${r.err.rmsMm} mm, p50 ${r.err.p50Mm}, p95 ${r.err.p95Mm}, max ${r.err.maxMm} (${r.err.n}; moved by the other or a power: ${r.errAfter.n}, at most ${r.errAfter.maxMm} mm); corrections ${r.corrections} (${r.perSecond}/s), cuts ${r.cuts}; catches felt ${r.catches.felt}, confirmed ${r.catches.confirmed}, both at once ${r.catches.mutual}, denied ${r.catches.denied}; delay ${r.delay} ms, queue ${r.queue}`);
        }
        console.log(`     server: a tick ${duel.tickMs.mean.toFixed(3)} ms mean, ${duel.tickMs.p99.toFixed(3)} p99, ${duel.tickMs.max.toFixed(2)} max; sent ${duel.sentKBs} KB/s for the room (snapshot ${duel.snapBytes} B); queues ${JSON.stringify(duel.seats)}, seated ${JSON.stringify(duel.seated)}; catches judged where the catcher saw them ${duel.rewound} (not: ${JSON.stringify(duel.refused)}); ${n} events alike on both pages; ${frames} frames`);
        report[`lag${lag}`] = { pages: reps, server: duel, events: n, seconds: +secs.toFixed(1) };
        assert.ok(reps.every((r) => r.snaps / secs > 15), 'snapshots arrive near 20 Hz');
        assert.ok(reps.every((r) => r.inKBs < 16 && r.outKBs < 6), 'bytes within budget');
        if (lag === 0) assert.ok(reps.every((r) => r.err.p95Mm < 60), 'at no lag the prediction is close');
        for (const nn of nets) nn.close();
      });
    }

    await step('a third joins as a watcher; a jogo hello to a duel room is refused; an online world the server lacks is refused', async () => {
      const room = `W${Date.now() % 10000}`;
      const a = new Net(WS), b = new Net(WS), w = new Net(WS);
      await a.connect({ room, create: true, duel: HELLO });
      await b.connect({ room, create: true, duel: { ...HELLO, world: 'pool' } });
      const wi = await w.connect({ room, create: true, duel: HELLO });
      assert.equal(wi.slot, 2); assert.equal(wi.player, false);
      assert.equal((w.duel as DuelWelcome).world, 'temple', 'the room\'s world wins');
      const snap = await new Promise<Uint8Array>((ok) => { w.onFrame = ok; });
      const d = decodeDuelSnap(snap)!;
      assert.equal(d.ack, -1); assert.equal(d.bodies.length, 2); assert.equal((d.x as Any).k, undefined);
      await assert.rejects(new Net(WS).connect({ room }), (e: Any) => e.code === 'mode');
      await assert.rejects(new Net(WS).connect({ room: 'ZQXJ', create: true, duel: { ...HELLO, world: 'redwoods' } }), (e: Any) => e.code === 'duel');
      const dr = await waitFor(a, 'droom', null, 3000).catch(() => null);
      void dr;
      for (const n of [a, b, w]) n.close();
    });

    await step('a seat that drops comes back to its body with its token', async () => {
      const room = `R${Date.now() % 10000}`;
      const a = new Net(WS), b = new Net(WS);
      await a.connect({ room, create: true, duel: HELLO });
      await b.connect({ room, create: true, duel: HELLO });
      const tok = b.token;
      (b as Any).ws.close();                 // a drop (not a close: Net reconnects with its token)
      const back = await waitFor(b, 'open', null, 5000);
      assert.equal(back.slot, 1); assert.equal(b.token, tok);
      a.close(); b.close();
    });
  } finally { await srv.stop(); }
} finally {
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
}
void Character;
finish();
