// The room server (server/index.ts, as its own process) with real Net clients over WebSockets: health, joining and
// making rooms, seats and guests, the clock, poses (binary, per slot), the jogo's round trips, travel, building and
// what a late joiner is sent, reconnecting, and refusing what is malformed. Ported from the prototype's
// test/integration.test.mjs. Run: node test/integration.test.ts
import assert from 'node:assert/strict';
import { startServer, waitFor, sleep, step, finish } from './helpers.ts';
import { Net } from '../src/net/net.ts';
import { barMs, nextBar } from '../shared/rules.ts';
import { NLM, SLOTS, encodePose } from '../shared/protocol.ts';

const PORT = 5418, HTTP = `http://127.0.0.1:${PORT}`, WS = `ws://127.0.0.1:${PORT}/ws`;
const srv = await startServer(PORT, { ROOM_GRACE_MS: '1500' });   // a closed slot frees after 1.5 s
const clients: Net[] = [];
const net = () => { const n = new Net(WS); clients.push(n); return n; };
const newPose = () => ({ p: new Float64Array(NLM * 3), root: [0, 0, 0], yaw: 0 });

try {
  await step('health, the index line, and 404s', async () => {
    const get = async (p: string) => { const r = await fetch(HTTP + p); return [r.status, await r.text()] as const; };
    assert.deepEqual(await get('/health'), [200, 'ok']);
    // the rooms' line is at /rooms always (at / too when no site is built; with one, / leads to the game)
    const [st, body] = await get('/rooms');
    assert.equal(st, 200); assert.match(body, /protocol 3/);
    assert.equal((await get('/'))[0], 200);
    for (const p of ['/server/index.ts', '/package.json', '/.git/config', '/shared/rules.ts']) assert.equal((await get(p))[0], 404, p);
  });

  const a = net(), b = net();
  let room = '';
  await step('slots, stage and world; the second joiner takes seat 1', async () => {
    const ra = await a.connect({ room: null, stage: 'redwoods', world: 'grove' });
    assert.match(ra.room, /^[A-HJ-NP-Z]{4}$/);
    assert.deepEqual([ra.slot, ra.player, ra.stage, ra.world], [0, true, 'redwoods', 'grove']);
    room = ra.room;
    const peer = waitFor(a, 'peer', (m) => m.present && m.slot === 1);
    const rb = await b.connect({ room: room.toLowerCase(), stage: 'void', world: 'other' });
    assert.deepEqual(rb, { room, slot: 1, seat: 1, player: true, stage: 'redwoods', world: 'other' });
    await peer;
    assert.ok(a.connected && b.connected);
    assert.deepEqual(a.peers(), [1]); assert.deepEqual(b.peers(), [0]);
    const st = await waitFor(b, 'state');
    assert.equal(st.world, 'grove'); assert.equal(st.slots[1].world, 'other');
  });

  const guests: Net[] = [];
  await step('six guests fill the room; then full; a guest when asking for a seat is refused', async () => {
    for (let i = 0; i < SLOTS - 2; i++) {
      const g = net();
      const r = await g.connect({ room });
      assert.equal(r.slot, 2 + i); assert.equal(r.player, false);
      guests.push(g);
    }
    await assert.rejects(net().connect({ room }), (e: any) => e.code === 'full');
    await assert.rejects(net().connect({ room: 'ZZZZ' }), (e: any) => e.code === 'gone');
    const st = await waitFor(a, 'state', (s) => s.slots.every(Boolean));
    assert.equal(st.slots.filter((x: any) => !x.player).length, 6);
    for (const g of guests.slice(1)) g.close();   // their slots free once the grace runs out
    await sleep(100);
  });

  await step('a room made by name (create), and role: player refused when the seats are taken', async () => {
    const c = net(), d = net(), e = net();
    assert.equal((await c.connect({ room: 'DANCE1', create: true })).room, 'DANCE1');
    assert.equal((await d.connect({ room: 'dance1' })).slot, 1);
    await assert.rejects(e.connect({ room: 'DANCE1', role: 'player' }), (x: any) => x.code === 'full');
    c.close(); d.close();
  });

  await step('time sync on loopback', async () => {
    await sleep(500);
    const d = Math.abs(a.now() - b.now());
    console.log(`      |a.now - b.now| = ${d.toFixed(2)} ms, rtt a ${a.rtt.toFixed(2)} b ${b.rtt.toFixed(2)} ms`);
    assert.ok(d < 5, `clock difference ${d}`);
    assert.ok(a.rtt < 50);
    assert.ok(Math.abs(a.now() - (performance.timeOrigin + performance.now())) < 5, 'same machine: server clock ~ local clock');
  });

  await step('poses: binary, to every other slot; flags, energy, world, move; a guest sees both seats', async () => {
    const pose = newPose();
    for (let i = 0; i < 39; i++) pose.p[i] = i / 100 - 0.1;
    pose.root[0] = 12.345; pose.root[2] = -40.5; pose.yaw = -3.1;
    const out = newPose(), g = guests[0], og = newPose();
    assert.equal(b.remotePose(out).ok, false);
    const t0 = performance.now();
    while (performance.now() - t0 < 800) {
      a.sendPose(pose, { flags: 2 | 8, energy: 200, world: 'grove', move: ['0-p', a.now()] });
      b.remotePose(out); g.remotePose(og, 0); await sleep(16);
    }
    const r = b.remotePose(out);
    assert.ok(r.ok); assert.equal(r.slot, 0); assert.equal(r.flags, 10); assert.equal(r.energy, 200); assert.equal(r.world, 'grove');
    assert.equal(r.move![0], '0-p');
    for (let i = 0; i < 39; i++) assert.ok(Math.abs(out.p[i] - pose.p[i]) < 0.002, `component ${i}: ${out.p[i]}`);
    assert.ok(Math.abs(out.root[0] - 12.345) < 0.002 && Math.abs(out.root[2] + 40.5) < 0.002);
    assert.ok(Math.abs(out.yaw + 3.1) < 0.001);
    assert.ok(g.remotePose(og, 0).ok, 'a guest sees seat 0');
    console.log(`      remote age ${r.age!.toFixed(1)} ms, playback delay ${b.delay.toFixed(1)} ms`);
  });

  await step('a pose frame claiming another slot is stamped with the real one', async () => {
    const f = encodePose({ ts: b.now(), pose: newPose(), world: 'grove' });
    f[1] = 5;
    const seen = new Promise<number>((res) => { a.onPose = (fr) => { a.onPose = null; res(fr.slot); }; });
    b.ws!.send(f);
    assert.equal(await seen, 1);
  });

  await step('intro -> play on a bar line', async () => {
    const st = a.state!.phase === 'play' ? a.state! : await waitFor(a, 'state', (m) => m.phase === 'play', 8000);
    const bar = barMs(st.music), k = (st.sessionEnd - 180000 - st.music.epoch) / bar;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, 'play starts on a bar');
  });

  let n = 0;
  const move = (c: Net, mv: string, extra: object = {}) => {
    const m: any = { t: 'move', id: `${c.slot}-${++n}`, move: mv, ts: c.now(), x: c.slot ? 0.3 : -0.3, y: 0.14, dir: c.slot ? -1 : 1, perfect: false, ...extra };
    c.send(m); return m;
  };

  await step('move (with extras) -> xch -> state round trip; the guest sees the move too', async () => {
    const want = `0-${n + 1}`, got = waitFor(b, 'move', (m) => m.id === want), seen = waitFor(guests[0], 'move', (m) => m.id === want);
    const m = move(a, 'meia-lua', { z: -1.25, dir: [0.6, 0.8], aim: [0.2, 0.3, -0.4], yaw: 0.5, aim3: [1, 1.5, 0], hand: 'R', replay: { k: 3 } });
    const rel = await got;
    assert.equal(rel.from, 0); assert.equal(rel.move, 'meia-lua');
    assert.deepEqual([rel.x, rel.z, rel.dir, rel.aim, rel.yaw, rel.aim3, rel.hand, rel.replay], [-0.3, -1.25, [0.6, 0.8], [0.2, 0.3, -0.4], 0.5, [1, 1.5, 0], 'R', { k: 3 }]);
    assert.equal((await seen).from, 0);
    const xa = waitFor(a, 'xch'), xb = waitFor(b, 'xch'), sa = waitFor(a, 'state', (s) => s.tension === 10);
    b.send({ t: 'xch', id: m.id, res: 'dodge' });
    const [ra, rb] = await Promise.all([xa, xb]);
    assert.deepEqual(ra, rb);
    assert.deepEqual([ra.by, ra.target, ra.res, ra.tension, ra.streak, ra.axe], [0, 1, 'dodge', 10, 1, 22]);
    await sa;
  });

  await step('xch rejected from the mover and on a second report', async () => {
    await sleep(120);
    const m = move(a, 'martelo');
    const nothing = waitFor(a, 'xch', null, 400).then(() => 'got', () => 'none');
    a.send({ t: 'xch', id: m.id, res: 'dodge' });
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
    const relayed: string[] = [];
    const off = b.on('move', (m) => relayed.push(m.id));
    move(a, 'strike');
    const m2 = move(a, 'strike');
    const r = await no;
    assert.equal(r.id, m2.id); assert.equal(r.reason, 'rate');
    await sleep(100); off();
    assert.ok(!relayed.includes(m2.id));
  });

  await step('echo and unison events to both', async () => {
    const ev = (c: Net, k: string) => waitFor(c, 'ev', (e) => e.k === k);
    await sleep(120);
    let ea = ev(a, 'unison'), eb = ev(b, 'unison');
    const ts = a.now();
    move(a, 'au', { ts });
    move(b, 'au', { ts: ts + 40 });
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

  let pieceId = '';
  await step('build over the wire: a move on the beat sets an ice bridge; everyone gets the set event', async () => {
    for (let i = 0; i < 6; i++) { await sleep(110); move(a, ['armada', 'meia-lua'][i % 2]); }
    const bar = nextBar(a.state!.music, a.now() + 200);
    await sleep(bar - a.now() - 15);
    const m = move(a, 'au', { ts: bar });
    const sb = waitFor(b, 'ev', (e) => e.k === 'set'), sg = waitFor(guests[0], 'ev', (e) => e.k === 'set');
    a.send({ t: 'build', move: m.id, kind: 'ice', points: [-1000, 0, 0, 0, 400, 0, 1000, 0, 0], width: 300 });
    const [e, eg] = await Promise.all([sb, sg]);
    assert.deepEqual(e, eg);
    assert.equal(e.piece.by, 0); assert.equal(e.piece.world, 'grove'); assert.deepEqual(e.piece.points, [-1000, 0, 0, 0, 400, 0, 1000, 0, 0]);
    pieceId = e.piece.id;
    const no = waitFor(a, 'no', (x) => x.of === 'build');
    a.send({ t: 'build', move: m.id, kind: 'ice', points: [0, 0, 0, 100, 0, 0], width: 300 });
    assert.equal((await no).reason, 'move');
  });

  await step('a late joiner is sent every set piece on joining', async () => {
    const late = net();
    const lists = waitFor(late, 'pieces', null, 3000);
    const r = await late.connect({ room, role: 'guest' });
    assert.equal(r.player, false);
    const l = (await lists).list;
    assert.equal(l.length, 1); assert.equal(l[0].id, pieceId);
    const melted = waitFor(a, 'ev', (e) => e.k === 'melt');
    late.send({ t: 'travel', world: 'grove' });
    await sleep(150);
    late.send({ t: 'melt', id: pieceId });
    assert.equal((await melted).by, r.slot);
    late.close();
  });

  await step('mergeReady and fusion on the next bar line', async () => {
    const ready = waitFor(b, 'ev', (e) => e.k === 'mergeReady', 8000);
    for (let i = 0; i < 14 && !a.state?.mergeReady; i++) {
      await sleep(110);
      const m = move(a, 'strike');
      await sleep(10);
      b.send({ t: 'xch', id: m.id, res: 'dodge' });
      await sleep(30);
    }
    await ready;
    const fa = waitFor(a, 'ev', (e) => e.k === 'fusion'), fb = waitFor(b, 'ev', (e) => e.k === 'fusion');
    a.send({ t: 'merge', held: true, dist: 0.3 });
    b.send({ t: 'merge', held: true, dist: 0.35 });
    const [f, g] = await Promise.all([fa, fb]);
    assert.deepEqual(f, g);
    assert.equal(f.kind, 'steam');
    const st = a.state!, bar = barMs(st.music), k = (f.t0 - st.music.epoch) / bar;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, 'fusion t0 on a bar');
    assert.ok(Math.abs(f.tEnd - f.t0 - 8 * bar) < 1e-3);
    const sf = await waitFor(a, 'state', (s) => s.phase === 'fusion', 3000);
    assert.equal(sf.fusion.kind, 'steam');
  });

  await step('travel: a seat moves the jogo\'s world, ev to all, 1/s per slot', async () => {
    const ea = waitFor(a, 'ev', (e) => e.k === 'travel'), eb = waitFor(b, 'ev', (e) => e.k === 'travel');
    const st = waitFor(a, 'state', (s) => s.world === 'sky');
    b.send({ t: 'travel', world: 'sky', portal: 'arch' });
    const [x, y] = await Promise.all([ea, eb]);
    assert.deepEqual(x, y); assert.deepEqual(x, { t: 'ev', k: 'travel', world: 'sky', portal: 'arch', by: 1 });
    assert.equal((await st).slots[1].world, 'sky');
    assert.equal(b.world, 'sky');
    const again = waitFor(a, 'ev', (e) => e.k === 'travel', 400).then(() => 'got', () => 'none');
    b.send({ t: 'travel', world: 'sea', portal: null });
    assert.equal(await again, 'none', 'rate limited');
  });

  await step('reconnect with token; events queued while down', async () => {
    const slot = a.slot, token = a.token;
    const peerOff = waitFor(b, 'peer', (m) => !m.present && m.slot === slot), peerOn = waitFor(b, 'peer', (m) => m.present && m.slot === slot, 5000);
    const reopen = waitFor(a, 'open', null, 5000);
    a.ws!.close();
    await waitFor(a, 'close');
    assert.equal(a.connected, false);
    a.send({ t: 'fx', k: 'queued', v: 7 });
    const fx = waitFor(b, 'fx', (m) => m.k === 'queued', 5000);
    await peerOff;
    const o = await reopen;
    assert.equal(o.slot, slot); assert.equal(a.token, token);
    await peerOn;
    const f = await fx;
    assert.equal(f.from, 0); assert.equal(f.v, 7);
    assert.equal(a.state!.phase, 'fusion', 'session kept through the reconnect');
  });

  await step('malformed and oversized frames drop the client', async () => {
    const raw = () => new Promise<WebSocket>((res, rej) => { const w = new WebSocket(WS); w.onopen = () => res(w); w.onerror = rej; });
    const w = await raw();
    const closed = new Promise((r) => { w.onclose = (e) => r(e.code); });
    for (let i = 0; i < 5; i++) w.send('{not json');
    assert.equal(await closed, 1008);
    const w3 = await raw();
    const closed3 = new Promise((r) => { w3.onclose = (e) => r(e.code); });
    for (let i = 0; i < 5; i++) w3.send(new Uint8Array([1, 2, 3]));
    assert.equal(await closed3, 1008, 'binary that is not a pose');
    const w2 = await raw();
    const closed2 = new Promise((r) => { w2.onclose = (e) => r(e.code); });
    const big = waitFor(b, 'fx', (m) => m.k === 'big');
    a.send({ t: 'fx', k: 'big', pad: 'x'.repeat(7000) });
    assert.equal((await big).pad.length, 7000);
    w2.send(JSON.stringify({ t: 'fx', k: 'x'.repeat(9000) }));
    assert.equal(await closed2, 1009);
  });
} catch (e) {
  console.error(e);
} finally {
  for (const c of clients) c.close();
  await srv.stop();
}
finish();
