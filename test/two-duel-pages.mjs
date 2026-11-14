// Two real browsers, one online duel (?duel&net=ROOM, src/duel/online.ts): the game from a dev server (--url, default
// http://127.0.0.1:5435/energybending/) in two headless Chromes on the real GPU, each playing one seat with a virtual
// player (&bot: its inputs go to the room server like a person's), against the room server on --port (default 5445,
// started here unless --no-server). For each lag in --lags (default 0,80,200 ms; jitter a fifth of it) it opens both
// pages in a fresh room, lets them play --warm seconds, measures --seconds, and reads from inside each page
// bend.duel.net.stats() (bytes a second, prediction error at each acknowledged input, corrections, catches felt and
// confirmed, the delay) and its event log, and the server's /duels (its tick time); it checks both pages' event logs
// agree, saves a low still from each (bend.grab) and writes stats.json into --out. Not part of npm test (a GPU, a dev
// server). Captures run alongside other agents' (no render lock: AGENTS.md).
//   node test/two-duel-pages.mjs --out shots/duel-net --lags 0,80,200 --seconds 20
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, adapterName } from '../scripts/lib/browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(opt('port', 5445)), PAGE = opt('url', 'http://127.0.0.1:5435/energybending/');
const OUT = opt('out', 'shots/duel-net'), SECONDS = Number(opt('seconds', 20)), WARM = Number(opt('warm', 8));
const LAGS = opt('lags', '0,80,200').split(',').map(Number), WORLD = opt('world', 'temple');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

let server = null;
if (!argv.includes('--no-server')) {
  const entry = fileURLToPath(new URL('../server/index.ts', import.meta.url));
  server = spawn(process.execPath, [entry, String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, no) => {
    let log = '';
    const t = setTimeout(() => no(new Error('room server did not start: ' + log)), 20000);
    server.stdout.on('data', (d) => { log += d; if (log.includes('rooms on')) { clearTimeout(t); ok(); } });
    server.stderr.on('data', (d) => { log += d; });
  });
}
const stopServer = () => { if (server && server.exitCode == null) server.kill(); };
process.on('exit', stopServer);

const report = {};
const browsers = [];
try {
  for (const name of ['a', 'b']) browsers.push(await launch({ width: 640, height: 400, extra: ['--enable-webgpu-developer-features'] }));
  for (const lag of LAGS) {
    const room = `N${lag}X${Date.now() % 100}`, cond = lag ? `&lag=${lag}&jitter=${Math.round(lag / 5)}` : '';
    const url = `${PAGE}?duel&net=${room}&world=${WORLD}&dress=fire,water&bot&noautores&nolesson&server=ws://127.0.0.1:${PORT}/ws${cond}`;
    console.log(`\n# lag ${lag} ms: room ${room}`);
    const pages = [];
    for (const [i, browser] of browsers.entries()) {
      const name = 'ab'[i];
      const page = await browser.newPage();
      await page.setViewport({ width: 640, height: 400 });
      page.on('console', (m) => { const t = m.text(); if (/^duel|error|warn/i.test(t)) console.log(`  [${name}] ${m.type()}: ${t.slice(0, 240)}`); });
      page.on('pageerror', (e) => console.log(`  [${name}] pageerror: ${e.message}`));
      await page.goto(url, { timeout: 120000 });
      await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 250 });
      pages.push({ name, page });
      if (!report.adapter) report.adapter = await adapterName(page);
    }
    for (const { page } of pages) await page.evaluate(() => window.bend.wake?.());
    await page0Wait(pages);
    await sleep(WARM * 1000);
    for (const { page } of pages) await page.evaluate(() => window.bend.duel.net.client.resetStats());
    await sleep(SECONDS * 1000);
    const runs = {};
    for (const { name, page } of pages) {
      runs[name] = await page.evaluate(() => {
        const n = window.bend.duel.net, s = n.stats();
        return { ...s, log: n.client.log.slice(), fps: window.bend.stats().fps ?? null, phase: window.bend.duel.state.phase, hudPops: (window.bend.duel.hud()?.pops ?? []).map((p) => p.text) };
      });
    }
    const duels = await (await fetch(`http://127.0.0.1:${PORT}/duels`)).json();
    const srv = duels.duels.find((d) => d.room === room.toUpperCase());
    // the same events on both pages, over the ticks both saw
    const tick = (l) => Number(l.slice(0, l.indexOf(' ')));
    let [la, lb] = [runs.a.log, runs.b.log];
    const from = Math.max(tick(la[0] ?? '0 '), tick(lb[0] ?? '0 '));
    la = la.filter((l) => tick(l) >= from); lb = lb.filter((l) => tick(l) >= from);
    const n = Math.min(la.length, lb.length);
    let same = 0; while (same < n && la[same] === lb[same]) same++;
    for (const [name, r] of Object.entries(runs)) {
      console.log(`[${name}] seat ${r.seat}, ${r.phase}; in ${r.inKBs} KB/s (events ${r.devKBs}), out ${r.outKBs} KB/s; error at the ack rms ${r.err.rmsMm} mm, p50 ${r.err.p50Mm}, p95 ${r.err.p95Mm}, max ${r.err.maxMm} (${r.err.n}); moved by the other or a power ${r.errAfter.n} at most ${r.errAfter.maxMm} mm; corrections ${r.corrections} (${r.perSecond}/s), cuts ${r.cuts}; catches felt ${r.catches.felt} confirmed ${r.catches.confirmed} mutual ${r.catches.mutual} denied ${r.catches.denied}; delay ${r.delay} ms, rtt ${r.rtt} ms, queue ${r.queue}; fps ${r.fps}`);
      delete r.log;
    }
    console.log(`server: a tick ${srv?.tickMs.mean.toFixed(3)} ms mean, ${srv?.tickMs.p99.toFixed(3)} p99, ${srv?.tickMs.max.toFixed(2)} max; ${srv?.sentKBs} KB/s for the room; rewound catches ${srv?.rewound} (${JSON.stringify(srv?.refused)}); events alike ${same} of ${n} (${la.length} / ${lb.length})`);
    report[`lag${lag}`] = { runs, server: srv, events: { same, n, a: la.length, b: lb.length } };
    for (const { name, page } of pages) {
      const png = await page.evaluate(async () => window.bend.grab('image/jpeg', 0.7));
      writeFileSync(join(OUT, `lag${lag}-${name}.jpg`), Buffer.from(png.split(',')[1], 'base64'));
    }
    for (const { page } of pages) await page.close();
  }
  writeFileSync(join(OUT, 'stats.json'), JSON.stringify(report, null, 1));
  console.log(`\nwrote ${join(OUT, 'stats.json')}`);
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  stopServer();
}

/** until both pages' duel runs (the server started its set) */
async function page0Wait(pages) {
  for (const { name, page } of pages) {
    await page.waitForFunction(() => window.bend?.duel?.net?.client?.running === true, { timeout: 30000, polling: 250 }).catch(async () => {
      console.log(`  [${name}] not running: ${JSON.stringify(await page.evaluate(() => window.bend?.duel?.net?.stats?.() ?? null))}`);
    });
  }
}
