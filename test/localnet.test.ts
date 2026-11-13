// LocalNet: the partner contract, same-screen sendAs(1), the conditioner, the state's cadence, set pieces in the page.
// Ported from the prototype's test/localnet.test.mjs. Run: node test/localnet.test.ts
import assert from 'node:assert/strict';
import { waitFor, sleep, step, finish } from './helpers.ts';
import { LocalNet, type Partner, type PartnerApi, type PoseSink } from '../src/net/net.ts';
import { nextBar } from '../shared/rules.ts';
import { NLM } from '../shared/protocol.ts';

const newPose = () => ({ p: new Float64Array(NLM * 3), root: [0, 0, 0], yaw: 0 });
const nets: LocalNet[] = [];
try {
  await step('partner: attach, poses through the jitter buffer, moves and exchanges both ways', async () => {
    const seen = { move: [] as any[], xch: [] as any[], state: 0 };
    let api!: PartnerApi;
    const partner: Partner = {
      attach(a) {
        api = a;
        a.on('move', (m) => { seen.move.push(m); if (m.move === 'martelo') a.send({ t: 'xch', id: m.id, res: 'dodge' }); });
        a.on('xch', (m) => seen.xch.push(m));
        a.on('state', () => seen.state++);
      },
      pose(out: PoseSink) {
        for (let i = 0; i < 39; i++) out.p[i] = 0.1 + i / 1000;
        out.p[0] = 0.4 * Math.sin(api.now() / 300);
        out.root[0] = 1.5; out.root[2] = -2; out.yaw = 3.0;
        return { flags: 4, energy: 99, move: ['1-a', 5], world: 'tide' };
      },
    };
    const net = new LocalNet({ stage: 'tide', world: 'w1', partner, lag: 60, jitter: 20, loss: 5 });
    nets.push(net);
    const open = waitFor(net, 'open');
    const info = await net.connect();
    assert.deepEqual(info, { room: 'LOCAL', slot: 0, seat: 0, player: true, stage: 'tide', world: 'w1' });
    await open;
    const out = newPose(), mine = newPose();
    mine.p.fill(0.2); mine.root[0] = -1.5;
    const t0 = performance.now();
    let r: any;
    while (performance.now() - t0 < 700) { net.sendPose(mine); r = net.remotePose(out); await sleep(16); }
    assert.ok(r.ok); assert.equal(r.slot, 1); assert.equal(r.flags, 4); assert.equal(r.energy, 99); assert.deepEqual(r.move, ['1-a', 5]);
    assert.equal(r.world, 'tide');
    assert.ok(Math.abs(out.p[10] - 0.11) < 0.002);
    assert.ok(Math.abs(out.root[0] - 1.5) < 0.002 && Math.abs(out.root[2] + 2) < 0.002);
    assert.ok(Math.abs(out.yaw - 3.0) < 0.001);
    const pp = newPose();
    assert.ok(api.peerPose(pp).ok); assert.ok(Math.abs(pp.p[3] - 0.2) < 0.002); assert.ok(Math.abs(pp.root[0] + 1.5) < 0.002);
    const st = net.state!.phase === 'play' ? net.state! : await waitFor(net, 'state', (s) => s.phase === 'play', 6000);
    assert.equal(st.stage, 'tide'); assert.equal(st.world, 'w1');
    const x = waitFor(net, 'xch');
    const m = net.send({ t: 'move', move: 'martelo', x: 0, y: 0, z: 1, dir: 1, id: '' }) as any;
    assert.match(m.id, /^0-/);
    const res = await x;
    assert.equal(res.id, m.id); assert.equal(res.res, 'dodge'); assert.equal(res.target, 1);
    await sleep(150);
    assert.equal(seen.xch.length, 1); assert.ok(seen.state > 0);
    const back = waitFor(net, 'move');
    await sleep(110);
    api.send({ t: 'move', move: 'au', x: 0.5, y: 0, dir: -1, id: '' });
    assert.equal((await back).from, 1);
  });

  await step('same screen: sendAs(1), seat-1-only messages arrive with to: 1, state at least 1/s, travel', async () => {
    const net = new LocalNet({ stage: 'void' });
    nets.push(net);
    await net.connect();
    await waitFor(net, 'state', (s) => s.phase === 'play', 6000);
    const relayed = waitFor(net, 'move', (m) => m.to === 1 && m.from === 0);
    net.send({ t: 'move', move: 'spin', x: 0, y: 0, dir: 1, id: '' });
    await relayed;
    const unison = waitFor(net, 'ev', (e) => e.k === 'unison');
    net.sendAs(1, { t: 'move', move: 'spin', x: 0.3, y: 0, dir: -1, id: '' });
    assert.equal((await unison).move, 'spin');
    const no = waitFor(net, 'no', (m) => m.to === 1);
    net.sendAs(1, { t: 'move', move: 'au', x: 0, y: 0, dir: 1, id: '' });     // within 100 ms of seat 1's last move
    assert.equal((await no).reason, 'rate');
    const travel = waitFor(net, 'ev', (e) => e.k === 'travel');
    net.sendAs(1, { t: 'travel', world: 'sky', portal: 'p1' });
    assert.equal((await travel).by, 1);
    let n = 0; const off = net.on('state', () => n++);
    await sleep(2300); off();
    assert.ok(n >= 2, `states in 2.3 s: ${n}`);
    assert.equal(net.state!.world, 'sky');
    assert.equal(net.state!.slots[1]!.world, 'sky');
  });

  await step('building in the page: a move on the beat sets a piece; everyone hears it', async () => {
    const net = new LocalNet({ stage: 'geode' });
    nets.push(net);
    const lists = waitFor(net, 'pieces');
    await net.connect();
    assert.deepEqual((await lists).list, []);
    const st = await waitFor(net, 'state', (s) => s.phase === 'play', 6000);
    for (let i = 0; i < 8; i++) { net.send({ t: 'move', move: ['meia-lua', 'armada'][i % 2], x: 0, y: 0, dir: 1, id: '' }); await sleep(110); }
    const ts = nextBar(st.music, net.now() + 200);
    await sleep(ts - net.now() - 20);                                  // a move starting on the bar line, sent just before it
    const m = net.send({ t: 'move', move: 'au', ts, x: 0, y: 0, dir: 1, id: '' }) as any;
    const set = waitFor(net, 'ev', (e) => e.k === 'set');
    await sleep(30);
    net.send({ t: 'build', move: m.id, kind: 'ice', points: [0, 0, 0, 1500, 0, 0], width: 250 });
    const e = await set;
    assert.equal(e.piece.kind, 'ice'); assert.equal(e.piece.by, 0); assert.equal(e.piece.world, 'geode');
    const later = await waitFor(net, 'state', (s) => s.pieces === 1);
    assert.ok(later.piecesRev >= 1);
  });
} catch (e) {
  console.error(e);
} finally {
  for (const n of nets) n.close();
}
finish();
