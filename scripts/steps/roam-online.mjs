// The dance online through a mirror (report 20-roam): two pages (each its own headless Chrome, live, not stepped) in
// one room on a room server, seat 1 placed a few metres in front of the hub's gate to the Pool and walking into it on
// the real W key. What each page then says: the room's world, the track, the main view, and where it draws each seat.
//   node scripts/steps/roam-online.mjs [--url http://localhost:5481/energybending/] [--server ws://127.0.0.1:5689/ws]
import { launch } from '../lib/browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const URL0 = opt('url', 'http://localhost:5481/energybending/'), SERVER = opt('server', 'ws://127.0.0.1:5689/ws');
const ROOM = `RM${Math.floor(Math.random() * 900 + 100)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (extra) => {
  const b = await launch({ width: 960, height: 540 });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('  pageerror:', e.message));
  await p.setViewport({ width: 960, height: 540 });
  await p.goto(`${URL0}?jogo=online&room=${ROOM}&world=geode&server=${encodeURIComponent(SERVER)}${extra}`, { timeout: 120000 });
  await p.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.jogo, { timeout: 180000, polling: 200 });
  return { b, p };
};
const say = (p) => p.evaluate(() => {
  const j = window.bend.jogo, st = j.stats(), s = j.state;
  return { roomWorld: s?.world ?? null, phase: st.phase, view: st.world, seats: st.seats.map((x) => ({ world: x.world, root: x.root })), track: window.bend.music?.engine?.mood?.name, crossings: st.crossings };
});
const A = await open('&create');
await wait(1500);
const B = await open('');
try {
  await wait(6000);
  console.log('before  A', JSON.stringify(await say(A.p)));
  console.log('before  B', JSON.stringify(await say(B.p)));
  // seat 1 (page A) a few metres in front of the hub's gate to the Pool, facing it
  await A.p.evaluate(() => {
    const g = window.bend.gates.gates.get('geode.pool');
    const x = g.at[0] + g.n[0] * 3, z = g.at[2] + g.n[2] * 3;
    window.bend.place(0, x, z, Math.atan2(-g.n[0], -g.n[2]));
    window.bend.camera({ yaw: Math.atan2(g.n[0], g.n[2]) });
  });
  await wait(600);
  await A.p.bringToFront();
  await A.p.keyboard.down('KeyW');
  for (let i = 0; i < 30; i++) {
    await wait(200);
    const a = await say(A.p);
    if (a.seats.some((s) => s.world === 'pool')) { console.log(`A through after ${((i + 1) * 0.2).toFixed(1)} s`); break; }
  }
  await wait(700);
  await A.p.keyboard.up('KeyW');
  await wait(2500);
  console.log('after   A', JSON.stringify(await say(A.p)));
  console.log('after   B', JSON.stringify(await say(B.p)));
} finally { await A.b.close(); await B.b.close(); }
