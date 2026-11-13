// LocalNet: partner contract, same-screen sendAs(1), conditioner, state cadence. Run: node test/localnet.test.mjs
import assert from 'node:assert/strict';
import { waitFor, sleep, step, finish } from './helpers.mjs';
import { LocalNet } from '../js/net.js';

const nets = [];
try {
  await step('partner: attach, poses through the jitter buffer, moves and exchanges both ways', async () => {
    const seen = { move: [], xch: [], state: 0 };
    const partner = {
      attach(api) {
        this.api = api;
        api.on('move', m => { seen.move.push(m); if (m.move === 'martelo') api.send({ t: 'xch', id: m.id, res: 'dodge' }); });
        api.on('xch', m => seen.xch.push(m));
        api.on('state', () => seen.state++);
      },
      pose(out) { for (let i = 0; i < 39; i++) out[i] = 0.1 + i / 1000; out[0] = 0.4 * Math.sin(this.api.now() / 300); return { flags: 4, energy: 99, move: ['1-a', 5], n: 39 }; },
    };
    const net = new LocalNet({ stage: 'tide', world: 'w1', partner, lag: 60, jitter: 20, loss: 5 });
    nets.push(net);
    const open = waitFor(net, 'open');
    const info = await net.connect();
    assert.deepEqual(info, { room: 'LOCAL', seat: 0, stage: 'tide', world: 'w1' });
    await open;
    const out = new Float64Array(96);
    const t0 = performance.now();
    let r;
    while (performance.now() - t0 < 600) { net.sendPose(new Array(39).fill(0.2), 0, 0, null); r = net.remotePose(out); await sleep(16); }
    assert.ok(r.ok); assert.equal(r.n, 39); assert.equal(r.flags, 4); assert.equal(r.energy, 99); assert.deepEqual(r.move, ['1-a', 5]);
    assert.ok(Math.abs(out[10] - 0.11) < 0.002);
    const pp = new Float64Array(96);
    assert.equal(partner.api.peerPose(pp).n, 39); assert.ok(Math.abs(pp[3] - 0.2) < 0.002);
    const st = net.state.phase === 'play' ? net.state : await waitFor(net, 'state', s => s.phase === 'play', 6000);
    assert.equal(st.stage, 'tide'); assert.equal(st.world, 'w1');
    const x = waitFor(net, 'xch');
    const m = net.send({ t: 'move', move: 'martelo', x: 0, y: 0, z: 1, dir: 1 });
    assert.match(m.id, /^0-/);
    const res = await x;
    assert.equal(res.id, m.id); assert.equal(res.res, 'dodge'); assert.equal(res.target, 1);
    await sleep(150);
    assert.equal(seen.xch.length, 1); assert.ok(seen.state > 0);
    const back = waitFor(net, 'move');
    await sleep(110);
    partner.api.send({ t: 'move', move: 'au', x: 0.5, y: 0, dir: -1 });
    assert.equal((await back).from, 1);
  });

  await step('same screen: sendAs(1), seat-1-only messages arrive with to: 1, state at least 1/s', async () => {
    const net = new LocalNet({ stage: 'void' });
    nets.push(net);
    await net.connect();
    await waitFor(net, 'state', s => s.phase === 'play', 6000);
    const relayed = waitFor(net, 'move', m => m.to === 1 && m.from === 0);
    net.send({ t: 'move', move: 'spin', x: 0, y: 0, dir: 1 });
    await relayed;
    const unison = waitFor(net, 'ev', e => e.k === 'unison');
    net.sendAs(1, { t: 'move', move: 'spin', x: 0.3, y: 0, dir: -1 });
    assert.equal((await unison).move, 'spin');
    const no = waitFor(net, 'no', m => m.to === 1);
    net.sendAs(1, { t: 'move', move: 'au', x: 0, y: 0, dir: 1 });     // within 100 ms of seat 1's last move
    assert.equal((await no).reason, 'rate');
    const travel = waitFor(net, 'ev', e => e.k === 'travel');
    net.sendAs(1, { t: 'travel', world: 'sky', portal: 'p1' });
    assert.equal((await travel).by, 1);
    let n = 0; const off = net.on('state', () => n++);
    await sleep(2300); off();
    assert.ok(n >= 2, `states in 2.3 s: ${n}`);
    assert.equal(net.state.world, 'sky');
  });
} catch {
  // reported by step()
} finally {
  for (const n of nets) n.close();
}
finish();
