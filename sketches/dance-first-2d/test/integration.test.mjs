// Integration test: server.js on port 5380 with two Net clients. Run: node test/integration.test.mjs
import assert from 'node:assert/strict';
import { startServer, waitFor, sleep, step, finish } from './helpers.mjs';
import { Net } from '../js/net.js';
import { barMs } from '../shared/rules.js';

const PORT = 5380, HTTP = `http://127.0.0.1:${PORT}`, WS = `ws://127.0.0.1:${PORT}/ws`;
const srv = await startServer(PORT);
const clients = [];
const net = () => { const n = new Net(WS); clients.push(n); return n; };

try {
  await step('static files, health and refusals', async () => {
    const get = async p => { const r = await fetch(HTTP + p); return [r.status, r.headers.get('cache-control'), await r.text()]; };
    assert.deepEqual((await get('/health')).slice(0, 1).concat((await get('/health'))[2]), [200, 'ok']);
    const [st, cc, body] = await get('/');
    assert.equal(st, 200); assert.equal(cc, 'no-cache'); assert.ok(body.includes('<'));
    assert.equal((await get('/shared/rules.js'))[0], 200);
    assert.equal((await get('/js/net.js'))[0], 200);
    for (const p of ['/server.js', '/package.json', '/package-lock.json', '/test/rules.test.mjs', '/node_modules/ws/package.json', '/.git/config', '/.gitignore'])
      assert.equal((await get(p))[0], 404, p);
    for (const p of ['/..%2f..%2fwindows/win.ini', '/js/..%2f..%2f..%2fx.js', '/%2e%2e/%2e%2e/x.html'])
      assert.ok([403, 404].includes((await get(p))[0]), p);
  });

  const a = net(), b = net();
  let room;
  await step('seat assignment, stage and world', async () => {
    const ra = await a.connect({ room: null, stage: 'redwoods', world: 'grove' });
    assert.match(ra.room, /^[A-HJ-NP-Z]{4}$/);
    assert.equal(ra.seat, 0); assert.equal(ra.stage, 'redwoods'); assert.equal(ra.world, 'grove');
    room = ra.room;
    const peer = waitFor(a, 'peer', m => m.present);
    const rb = await b.connect({ room: room.toLowerCase(), stage: 'void', world: 'other' });
    assert.deepEqual(rb, { room, seat: 1, stage: 'redwoods', world: 'grove' });
    await peer;
    assert.ok(a.connected && b.connected);
    assert.equal((await waitFor(b, 'state')).world, 'grove');
  });

  await step('room full and unknown room errors', async () => {
    await assert.rejects(net().connect({ room }), e => e.code === 'full');
    await assert.rejects(net().connect({ room: 'ZZZZ' }), e => e.code === 'gone');
  });

  await step('time sync on loopback', async () => {
    await sleep(500);
    const d = Math.abs(a.now() - b.now());
    console.log(`      |a.now - b.now| = ${d.toFixed(2)} ms, rtt a ${a.rtt.toFixed(2)} b ${b.rtt.toFixed(2)} ms, jitter ${a.jitter.toFixed(2)} ms`);
    assert.ok(d < 5, `clock difference ${d}`);
    assert.ok(a.rtt < 50);
    assert.ok(Math.abs(a.now() - (performance.timeOrigin + performance.now())) < 5, 'same machine: server clock ~ local clock');
  });

  await step('pose relay: 39 components (13 x 3), flags, energy, move; then a length change resets cleanly', async () => {
    const pose = Array.from({ length: 39 }, (_, i) => i / 100 - 0.1);
    const out = new Float64Array(96);
    assert.equal(b.remotePose(out).ok, false);
    const t0 = performance.now();
    while (performance.now() - t0 < 700) { a.sendPose(pose, 2 | 8, 200, ['0-p', a.now()]); b.remotePose(out); await sleep(16); }
    let r = b.remotePose(out);
    assert.ok(r.ok); assert.equal(r.n, 39); assert.equal(r.flags, 10); assert.equal(r.energy, 200);
    assert.equal(r.move[0], '0-p');
    for (let i = 0; i < 39; i++) assert.ok(Math.abs(out[i] - pose[i]) < 0.002, `component ${i}: ${out[i]}`);
    console.log(`      remote age ${r.age.toFixed(1)} ms, playback delay ${b.delay.toFixed(1)} ms`);
    const pose2 = Array.from({ length: 26 }, (_, i) => 0.5 - i / 100);
    const t1 = performance.now();
    while (performance.now() - t1 < 700) { a.sendPose(pose2, 0, 10, null); b.remotePose(out); await sleep(16); }
    r = b.remotePose(out);
    assert.equal(r.n, 26); assert.equal(r.move, null);
    for (let i = 0; i < 26; i++) assert.ok(Math.abs(out[i] - pose2[i]) < 0.002, `after reset ${i}: ${out[i]}`);
  });

  await step('intro -> play on a bar line', async () => {
    const st = a.state.phase === 'play' ? a.state : await waitFor(a, 'state', m => m.phase === 'play', 8000);
    assert.equal(st.stage, 'redwoods');
    const bar = barMs(st.music), k = (st.sessionEnd - 180000 - st.music.epoch) / bar;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, 'play starts on a bar');
  });

  let n = 0;
  const move = (c, mv, extra = {}) => { const m = { t: 'move', id: `${c.seat}-${++n}`, move: mv, ts: c.now(), x: c.seat ? 0.3 : -0.3, y: 0.14, dir: c.seat ? -1 : 1, perfect: false, ...extra }; c.send(m); return m; };

  await step('move -> xch -> state round trip', async () => {
    const want = `0-${n + 1}`, got = waitFor(b, 'move', m => m.id === want);
    const m = move(a, 'meia-lua', { z: -1.25, dir: [0.6, 0.8], aim: [0.2, 0.3, -0.4] });
    const rel = await got;
    assert.equal(rel.from, 0); assert.equal(rel.move, 'meia-lua');
    assert.deepEqual([rel.x, rel.z, rel.dir, rel.aim], [-0.3, -1.25, [0.6, 0.8], [0.2, 0.3, -0.4]]);
    const xa = waitFor(a, 'xch'), xb = waitFor(b, 'xch'), sa = waitFor(a, 'state', s => s.tension === 10);
    b.send({ t: 'xch', id: m.id, res: 'dodge' });
    const [ra, rb] = await Promise.all([xa, xb]);
    assert.deepEqual(ra, rb);
    assert.equal(ra.by, 0); assert.equal(ra.target, 1); assert.equal(ra.res, 'dodge');
    assert.equal(ra.tension, 10); assert.equal(ra.streak, 1); assert.equal(ra.axe, 22);
    await sa;
  });

  await step('xch rejected from the mover and on a second report', async () => {
    await sleep(120);
    const m = move(a, 'martelo');
    const nothing = waitFor(a, 'xch', null, 400).then(() => 'got', () => 'none');
    a.send({ t: 'xch', id: m.id, res: 'dodge' });                       // from the mover
    assert.equal(await nothing, 'none');
    b.send({ t: 'xch', id: m.id, res: 'hit' });
    const r = await waitFor(a, 'xch');
    assert.equal(r.res, 'hit'); assert.equal(r.streak, 0);
    const again = waitFor(a, 'xch', null, 400).then(() => 'got', () => 'none');
    b.send({ t: 'xch', id: m.id, res: 'dodge' });
    assert.equal(await again, 'none');
  });

  await step('over-rate move rejected with no', async () => {
    await sleep(120);
    const no = waitFor(a, 'no');
    const relayed = [];
    const off = b.on('move', m => relayed.push(m.id));
    move(a, 'strike');
    const m2 = move(a, 'strike');
    const r = await no;
    assert.equal(r.id, m2.id); assert.equal(r.reason, 'rate');
    await sleep(100); off();
    assert.ok(!relayed.includes(m2.id));
  });

  await step('echo and unison events to both', async () => {
    const ev = (c, k) => waitFor(c, 'ev', e => e.k === k);
    await sleep(120);
    let ea = ev(a, 'unison'), eb = ev(b, 'unison');
    const ts = a.now();
    move(a, 'au', { ts });
    move(b, 'au', { ts: ts + 40 });                                       // 40 ms apart: within one 16th
    let [x, y] = await Promise.all([ea, eb]);
    assert.deepEqual(x, y); assert.equal(x.move, 'au');
    await sleep(120);
    ea = ev(a, 'echo'); eb = ev(b, 'echo');
    move(b, 'spin');
    await sleep(400);
    move(a, 'spin');
    [x, y] = await Promise.all([ea, eb]);
    assert.deepEqual(x, y); assert.equal(x.move, 'spin');
  });

  await step('mergeReady and fusion on the next bar line', async () => {
    const ready = waitFor(b, 'ev', e => e.k === 'mergeReady', 6000);
    for (let i = 0; i < 12 && !(a.state?.mergeReady); i++) {
      await sleep(110);
      const m = move(a, 'strike');
      await sleep(10);
      b.send({ t: 'xch', id: m.id, res: 'dodge' });
      await sleep(30);
    }
    await ready;
    const fa = waitFor(a, 'ev', e => e.k === 'fusion'), fb = waitFor(b, 'ev', e => e.k === 'fusion');
    a.send({ t: 'merge', held: true, dist: 0.1 });
    b.send({ t: 'merge', held: true, dist: 0.12 });
    const [f, g] = await Promise.all([fa, fb]);
    assert.deepEqual(f, g);
    assert.equal(f.kind, 'steam');
    const st = a.state, bar = barMs(st.music), k = (f.t0 - st.music.epoch) / bar;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, 'fusion t0 on a bar');
    assert.ok(Math.abs(f.tEnd - f.t0 - 8 * bar) < 1e-3);
    const sf = await waitFor(a, 'state', s => s.phase === 'fusion', 3000);
    assert.equal(sf.fusion.kind, 'steam');
  });

  await step('travel: world changes for the room, ev to both, 1/s per seat', async () => {
    const ea = waitFor(a, 'ev', e => e.k === 'travel'), eb = waitFor(b, 'ev', e => e.k === 'travel');
    const st = waitFor(a, 'state', s => s.world === 'sky');
    b.send({ t: 'travel', world: 'sky', portal: 'arch' });
    const [x, y] = await Promise.all([ea, eb]);
    assert.deepEqual(x, y); assert.deepEqual(x, { t: 'ev', k: 'travel', world: 'sky', portal: 'arch', by: 1 });
    await st;
    const again = waitFor(a, 'ev', e => e.k === 'travel', 400).then(() => 'got', () => 'none');
    b.send({ t: 'travel', world: 'sea', portal: null });
    assert.equal(await again, 'none', 'rate limited');
    assert.equal(a.world, 'sky');
  });

  await step('reconnect with token; events queued while down', async () => {
    const seat = a.seat, token = a.token;
    const peerOff = waitFor(b, 'peer', m => !m.present), peerOn = waitFor(b, 'peer', m => m.present, 5000);
    const reopen = waitFor(a, 'open', null, 5000);
    a.ws.close();                                                        // drop the socket under the client
    await waitFor(a, 'close');
    assert.equal(a.connected, false);
    a.send({ t: 'fx', k: 'queued', v: 7 });
    const fx = waitFor(b, 'fx', m => m.k === 'queued', 5000);
    await peerOff;
    const o = await reopen;
    assert.equal(o.seat, seat); assert.equal(a.token, token);
    await peerOn;
    const f = await fx;
    assert.equal(f.from, 0); assert.equal(f.v, 7);
    assert.equal(a.state.phase, 'fusion', 'session kept through the reconnect');
  });

  await step('malformed and oversized frames drop the client', async () => {
    const raw = () => new Promise((res, rej) => { const w = new WebSocket(WS); w.onopen = () => res(w); w.onerror = rej; });
    const w = await raw();
    const closed = new Promise(r => { w.onclose = e => r(e.code); });
    for (let i = 0; i < 5; i++) w.send('{not json');
    assert.equal(await closed, 1008);
    const w2 = await raw();
    const closed2 = new Promise(r => { w2.onclose = e => r(e.code); });
    const big = waitFor(b, 'fx', m => m.k === 'big');
    a.send({ t: 'fx', k: 'big', pad: 'x'.repeat(7000) });               // under the 8 KB cap: relayed
    assert.equal((await big).pad.length, 7000);
    w2.send(JSON.stringify({ t: 'fx', k: 'x'.repeat(9000) }));
    assert.equal(await closed2, 1009);
  });
} catch {
  // reported by step()
} finally {
  for (const c of clients) c.close();
  await srv.stop();
}
finish();
