// An online jogo in two real browsers against a real room server, through the conditioner: each page plays one seat
// (?jogo=online), and the same exchanges are looked at from both sides. Starts the room server (server/index.ts) on
// --port (5412), opens the game (--url) in two headless Chromes on the GPU (two browsers, so neither is a throttled
// background page) with ?jogo=online&room=…&lag=150 (--cond), waits for the room's intro to end, stands the dancers a
// metre apart, then: page a kicks at page b's dancer standing still (a hit), and page b kicks at page a's, who dodges.
// It reads each page's jogo history (what each page judged and what the room told it), the two clocks and the playback
// delay, and grabs both pages a moment after each exchange (<out>/online-<n>-a.jpg, -b.jpg). Live (real time), not
// stepped: this is the network as it is.
//   node scripts/steps/jogo-online.mjs <out> [--url http://127.0.0.1:5392/energybending/] [--cond lag=150] [--port 5412]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, adapterName, takeLock } from '../lib/browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'shots/online';
const PORT = Number(opt('port', 5412)), PAGE = opt('url', 'http://127.0.0.1:5392/energybending/'), COND = opt('cond', 'lag=150');
const ROOM = `J${Date.now() % 100000}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const entry = fileURLToPath(new URL('../../server/index.ts', import.meta.url));
const server = spawn(process.execPath, [entry, String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((ok, no) => {
  let log = '';
  const t = setTimeout(() => no(new Error('room server did not start: ' + log)), 8000);
  server.stdout.on('data', (d) => { log += d; if (log.includes('rooms on')) { clearTimeout(t); ok(); } });
  server.stderr.on('data', (d) => { log += d; });
});
const stopServer = () => { if (server.exitCode == null) server.kill(); };
process.on('exit', stopServer);
console.log(`room server on ${PORT}; room ${ROOM}; conditioner ${COND}`);

const release = await takeLock();
const browsers = [];
const report = { room: ROOM, cond: COND, exchanges: [] };
try {
  const pages = {};
  for (const name of ['a', 'b']) {
    const browser = await launch({ width: 960, height: 600, extra: ['--enable-webgpu-developer-features'] });
    browsers.push(browser);
    const page = await browser.newPage();
    page.on('console', (m) => { const t = m.text(); if (/^jogo:|error/i.test(t) && !/powerPreference/.test(t)) console.log(`  [${name}] ${m.type()}: ${t.slice(0, 300)}`); });
    page.on('pageerror', (e) => console.log(`  [${name}] pageerror: ${e.message}`));
    const url = `${PAGE}?jogo=online&room=${ROOM}${name === 'a' ? '&create' : ''}&world=geode&dress=fire,water&${COND}&noautores&server=ws://127.0.0.1:${PORT}/ws`;
    await page.goto(url, { timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
    console.log(`[${name}] ready`);
    pages[name] = page;
  }
  const { a, b } = pages;
  console.log('adapter:', await adapterName(a));
  const phase = (p) => p.evaluate(() => window.bend.jogo?.phase ?? null);
  for (let i = 0; i < 60 && ((await phase(a)) !== 'play' || (await phase(b)) !== 'play'); i++) await sleep(250);
  console.log(`phases: a ${await phase(a)}, b ${await phase(b)}`);
  // a metre apart (each page stands its own dancer)
  await a.evaluate(() => window.bend.place(0, -0.5, 0));
  await b.evaluate(() => window.bend.place(0, 0.5, 0));
  await sleep(2500);
  const look = async (p) => p.evaluate(() => {
    const J = window.bend.jogo, s = J.room.session;
    return { seat: s.seat, delay: Math.round(J.room.delay()), rtt: Math.round(s.net.rtt), now: Math.round(J.room.now()), tension: J.state?.tension, streak: J.state?.streak,
      seats: J.stats().seats, history: J.history.filter((h) => h.e.k === 'xch').map((h) => ({ t: h.t, res: h.e.res, by: h.e.by, target: h.e.target, mine: h.e.mine, id: h.e.id })),
      other: J.history.filter((h) => h.e.k !== 'xch').map((h) => `${h.e.k}:${h.e.move ?? h.e.reason ?? h.e.phase ?? ''}`).join(' '), travelling: J.stats().travelling, world: window.bend.world ? null : null };
  });
  const grab = async (p, file) => {
    const url = await p.evaluate(async () => window.bend.grab('image/jpeg', 0.9));
    writeFileSync(join(OUT, file), Buffer.from(url.split(',')[1], 'base64'));
  };
  // (a grab steps the page by hand, which stops its live loop: only the last exchange is grabbed, at the end)
  const exchange = async (n, attacker, defender, move, dodge, still = false) => {
    const t0 = Date.now();
    await Promise.all([
      attacker.evaluate((m) => window.bend.move(0, m), move),
      dodge ? (async () => { await sleep(110); await defender.evaluate(() => window.bend.intent(0, { dodge: true, moveY: -1 })); await sleep(500); await defender.evaluate(() => window.bend.intent(0, { moveY: 0 })); })() : null,
    ]);
    if (still) {
      await sleep(Math.max(0, 650 - (Date.now() - t0)));
      await Promise.all([grab(a, `online-${n}-a.jpg`), grab(b, `online-${n}-b.jpg`)]);
      // then a second more of frames by hand on each, so what the room says next is heard
      await sleep(400);
      await Promise.all([a, b].map((p) => p.evaluate(() => window.bend.step(60))));
    } else await sleep(1600);
    const A = await look(a), B = await look(b);
    report.exchanges.push({ n, move, dodge, a: A, b: B });
    console.log(`exchange ${n} (${move}${dodge ? ', dodged' : ''}):`);
    for (const [k, v] of [['a', A], ['b', B]]) console.log(`  page ${k} (seat ${v.seat}): delay ${v.delay} ms, rtt ${v.rtt} ms, tension ${v.tension}, streak ${v.streak}, seats ${JSON.stringify(v.seats)}\n    xch: ${JSON.stringify(v.history)}
    other: ${v.other} travelling ${v.travelling}`);
  };
  await exchange(1, a, b, 'martelo', false);
  await a.evaluate(() => window.bend.place(0, -0.5, 0));
  await b.evaluate(() => window.bend.place(0, 0.5, 0));
  await sleep(2000);
  await exchange(2, b, a, 'martelo', true);
  await a.evaluate(() => window.bend.place(0, -0.5, 0));
  await b.evaluate(() => window.bend.place(0, 0.5, 0));
  await sleep(2000);
  await exchange(3, a, b, 'meia-lua', false, true);
  const clocks = await Promise.all([a, b].map((p) => p.evaluate(() => Math.round(window.bend.jogo.room.now()))));
  report.clockGap = Math.abs(clocks[0] - clocks[1]);
  console.log(`the two pages' room clocks (read one after the other): ${clocks.join(', ')}`);
  writeFileSync(join(OUT, 'online.json'), JSON.stringify(report, null, 1));
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  release();
  stopServer();
}
