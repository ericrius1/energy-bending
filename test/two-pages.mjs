// Two real browsers, one room: the ?net demo proved end to end. Starts the room server (server/index.ts) on --port
// (5417), opens the game from the dev server (--url, default http://127.0.0.1:5407/energybending/) in two headless
// Chromes on the real GPU (two browsers, not two tabs, so neither is a throttled background page), each with
// ?net=ROOM and the conditioner from --cond (default lag=200&jitter=80&loss=10), wakes both, lets them dance in real
// time, then reads window.bendNet.stats() from inside each page (delay, jitter, round trip, pose error, acceleration
// of the remote dancer against the sender's own) and saves a still from each (bend.grab) into --out.
// Takes the shared render lock around the GPU work (AGENTS.md). Not part of npm test (it needs a GPU and a dev server).
//   node test/two-pages.mjs --out shots/net --cond 'lag=200&jitter=80&loss=10' --seconds 20
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, adapterName, takeLock } from '../scripts/lib/browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(opt('port', 5417)), PAGE = opt('url', 'http://localhost:5407/energybending/'), COND = opt('cond', 'lag=200&jitter=80&loss=10');
const OUT = opt('out', 'shots/net'), SECONDS = Number(opt('seconds', 20)), WARM = Number(opt('warm', 8)), ROOM = opt('room', `T${Date.now() % 100000}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// the room server, as its own process
const entry = fileURLToPath(new URL('../server/index.ts', import.meta.url));
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
try {
  const pages = [];
  for (const name of ['a', 'b']) {
    const browser = await launch({ width: 960, height: 600, extra: ['--enable-webgpu-developer-features'] });
    browsers.push(browser);
    const page = await browser.newPage();
    page.on('console', (m) => { const t = m.text(); if (/^net:|error|warn/i.test(t)) console.log(`  [${name}] ${m.type()}: ${t.slice(0, 300)}`); });
    page.on('pageerror', (e) => console.log(`  [${name}] pageerror: ${e.message}`));
    const url = `${PAGE}?net=${ROOM}&${COND}&noautores&server=ws://127.0.0.1:${PORT}/ws`;
    await page.goto(url, { timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
    console.log(`[${name}] ready: ${url}`);
    pages.push({ name, page });
  }
  console.log('adapter:', await adapterName(pages[0].page));
  for (const { page } of pages) await page.evaluate(() => window.bend.wake());
  await sleep(WARM * 1000);
  for (const { page } of pages) await page.evaluate(() => window.bendNet.probe.reset());
  await sleep(SECONDS * 1000);
  const report = {};
  for (const { name, page } of pages) {
    const st = await page.evaluate(() => {
      const s = window.bendNet.stats();
      const k = window.bend.kit;
      return { ...s, fps: window.bend.stats().fps ?? null, frame: k.frameIndex };
    });
    report[name] = st;
    const e = st.poseErrMm, a = st.accel;
    console.log(`[${name}] slot ${st.slot} sees slot ${st.other} (seen ${st.seen}); delay ${st.delay?.toFixed(0)} ms, transit ${st.transit?.toFixed(0)} ms, jitter ${st.jitter?.toFixed(1)} ms, rtt ${st.rtt?.toFixed(0)} ms, cuts ${st.cuts}`);
    console.log(`[${name}]   pose error at the true instants: ${e.n} samples, rms ${e.rms.toFixed(1)} mm, p95 ${e.p95.toFixed(1)} mm, max ${e.max.toFixed(1)} mm`);
    console.log(`[${name}]   landmark acceleration p99: remote ${a.remoteP99?.toFixed(1)} m/s², local ${a.localP99?.toFixed(1)} m/s² (max ${a.remoteMax?.toFixed(1)} / ${a.localMax?.toFixed(1)}) over ${a.frames} frames; phase ${st.phase}`);
    console.log(`[${name}]   clip ${st.clip.toFixed(2)} s; worst errors ${st.worst.map((w) => `${w.mm.toFixed(0)} mm @${w.clipT.toFixed(2)}`).join(', ')}; worst accelerations ${st.worstAcc.map((w) => `${w.acc.toFixed(0)} @${w.clipT.toFixed(2)}`).join(', ')}`);
  }
  // the same side-on view on both pages (the director's own angle can put one partner behind the other)
  for (const { page } of pages) await page.evaluate(() => window.bend.camera({ yaw: 1.35, pitch: 0.12, dist: 4.6 }));
  await sleep(1500);
  for (const { name, page } of pages) {
    const png = await page.evaluate(async () => { window.bend.kit.manual = true; return window.bend.grab('image/png'); });
    writeFileSync(join(OUT, `page-${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
    console.log(`[${name}] still: ${join(OUT, `page-${name}.png`)}`);
  }
  writeFileSync(join(OUT, 'stats.json'), JSON.stringify({ room: ROOM, cond: COND, seconds: SECONDS, warm: WARM, report }, null, 1));
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  release();
  stopServer();
}
