// Two real browsers, one online duel, through the mirrors (report 20-online): the game from a dev server (--url) in
// two headless Chromes on the real GPU against a room server on --port (started here unless --no-server). Seat 1's
// virtual player is replaced by a walker that goes through the mirror of whichever world the duel is in (the temple's
// to the redwoods and back), seat 2's by one that follows seat 1 as its page shows it; a third page watches. For each
// lag in --lags it reads from inside each page bend.duel.net.stats() (the crossings: heard, predicted, brought along,
// put back, the shown world's changes and flip-flops, the error near a crossing), the page's own crossings
// (bend.duel.crossings: how the main view went over), the duel's world and the main view's, checks every page ends in
// the server's world, and saves a still from each page a moment after its first crossing and at the end.
//   node test/two-duel-cross.mjs --url http://127.0.0.1:5487/energybending/ --port 5418 --out shots/duel-cross --lags 0,200 --seconds 25
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, adapterName } from '../scripts/lib/browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(opt('port', 5418)), PAGE = opt('url', 'http://127.0.0.1:5487/energybending/');
const OUT = opt('out', 'shots/duel-cross'), SECONDS = Number(opt('seconds', 25)), WARM = Number(opt('warm', 4));
const LAGS = opt('lags', '0,200').split(',').map(Number), W = Number(opt('width', 1280)), H = Number(opt('height', 720));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

let server = null;
if (!argv.includes('--no-server')) {
  const entry = fileURLToPath(new URL('../server/index.ts', import.meta.url));
  server = spawn(process.execPath, [entry, String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, no) => {
    let log = '';
    const t = setTimeout(() => no(new Error('room server did not start: ' + log)), 30000);
    server.stdout.on('data', (d) => { log += d; if (log.includes('rooms on')) { clearTimeout(t); ok(); } });
    server.stderr.on('data', (d) => { log += d; });
  });
}
const stopServer = () => { if (server && server.exitCode == null) server.kill(); };
process.on('exit', stopServer);

/** in the page: seat k's brain becomes a walker (seat 1: through the mirrors; seat 2: after seat 1) */
async function walker(page, seat) {
  await page.evaluate(async (seat) => {
    const base = '/energybending/';
    const { makeIntent } = await import(`${base}src/input/intent.ts`);
    const { duelDoors } = await import(`${base}src/duel/crossing.ts`);
    const D = duelDoors(), duel = window.bend.duel, c = duel.net.client;
    const route = { temple: 'temple.to.redwoods', redwoods: 'redwoods.to.temple', pool: 'pool.to.temple', geode: 'geode.temple' };
    window.__calm = false;
    const toward = (from, to) => {
      const dx = to[0] - from[0], dz = to[2] - from[2], l = Math.hypot(dx, dz) || 1, wx = dx / l, wz = dz / l;
      // (the stick is the camera's: its yaw is what this page sends, the predicted body's inputYaw)
      const y = c.pred.inputYaw, cs = Math.cos(y), sn = Math.sin(y), it = makeIntent();
      it.moveX = wx * cs - wz * sn; it.moveZ = -(wx * sn + wz * cs);
      return it;
    };
    duel.setBrain(seat, {
      name: seat ? 'follower' : 'wayfarer', body: {},
      think() {
        const me = c.pred.root;
        if (window.__calm) return makeIntent();
        if (seat === 1) { const o = c.shownChars[0].root; return Math.hypot(o[0] - me[0], o[2] - me[2]) > 1.2 ? toward(me, o) : makeIntent(); }
        const g = D.get(route[c.predWorld]);
        const front = [g.at[0] + g.n[0] * 2.2, 0, g.at[2] + g.n[2] * 2.2];
        const side = (me[0] - g.at[0]) * g.n[0] + (me[2] - g.at[2]) * g.n[2], across = Math.abs((me[0] - g.at[0]) * g.n[2] - (me[2] - g.at[2]) * g.n[0]);
        return side > -0.1 && side < 2.6 && across < 0.6 ? toward(me, [g.at[0] - g.n[0] * 2, 0, g.at[2] - g.n[2] * 2]) : toward(me, front);
      },
    });
  }, seat);
}

const report = {};
const browsers = [];
try {
  for (let i = 0; i < 3; i++) browsers.push(await launch({ width: W, height: H }));
  for (const lag of LAGS) {
    const room = `C${lag}X${Date.now() % 100}`, cond = lag ? `&lag=${lag}&jitter=${Math.round(lag / 5)}` : '';
    const url = `${PAGE}?duel&net=${room}&world=temple&dress=fire,water&bot&noautores&nolesson&set=90&server=ws://127.0.0.1:${PORT}/ws${cond}`;
    console.log(`\n# lag ${lag} ms: room ${room}`);
    const pages = [];
    for (const [i, browser] of browsers.entries()) {
      const name = ['a', 'b', 'w'][i];
      const page = await browser.newPage();
      await page.setViewport({ width: W, height: H });
      page.on('console', (m) => { const t = m.text(); if (/^duel|error|warn/i.test(t) || m.type() === 'error') console.log(`  [${name}] ${m.type()}: ${t.slice(0, 240)}`); });
      page.on('pageerror', (e) => console.log(`  [${name}] pageerror: ${e.message}`));
      // (the watcher without &bot: a page with no seat)
      await page.goto(i === 2 ? url.replace('&bot', '') : url, { timeout: 120000 });
      await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 250 });
      pages.push({ name, page });
      if (!report.adapter) report.adapter = await adapterName(page);
    }
    for (const { page } of pages) await page.evaluate(() => window.bend.wake?.());
    for (const { name, page } of pages) await page.waitForFunction(() => window.bend?.duel?.net?.client?.running === true, { timeout: 40000, polling: 250 }).catch(() => console.log(`  [${name}] not running`));
    await walker(pages[0].page, 0); await walker(pages[1].page, 1);
    await sleep(WARM * 1000);
    const firstShot = new Set();
    const t0 = Date.now();
    while (Date.now() - t0 < SECONDS * 1000) {
      await sleep(250);
      for (const { page } of pages) await page.evaluate(() => window.bend.wake?.());
      if (process.env.CROSS_DEBUG) console.log("   ticks", (await Promise.all(pages.map(({ page }) => page.evaluate(() => { const c = window.bend.duel.net.client; return `${c.stats.ticks} ${c.predWorld}/${c.shownWorld} ${window.bend.duel.state.phase}`; })))).join(" | "));
      for (const { name, page } of pages) {
        if (firstShot.has(name)) continue;
        const n = await page.evaluate(() => window.bend.duel.crossings.length);
        if (n > 0) {
          firstShot.add(name);
          await sleep(900);
          // (a grab steps the page by hand and leaves its loop stopped: started again after)
          const png = await page.evaluate(async () => { const k = window.bend.kit, url = await window.bend.grab('image/jpeg', 0.8); k.manual = false; k.lastNow = 0; k.loop(k.frameCb); return url; });
          writeFileSync(join(OUT, `lag${lag}-${name}-crossed.jpg`), Buffer.from(png.split(',')[1], 'base64'));
        }
      }
    }
    for (const { page } of pages.slice(0, 2)) await page.evaluate(() => { window.__calm = true; });
    // (the pages kept awake: a page with no thumbs on it sleeps its frames after a while, a watcher's too)
    for (let i = 0; i < (3000 + lag * 4) / 250; i++) { await sleep(250); for (const { page } of pages) await page.evaluate(() => window.bend.wake?.()); }
    const runs = {};
    for (const { name, page } of pages) {
      const raf = await page.evaluate(() => new Promise((ok) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 500) requestAnimationFrame(f); else ok(n); }; requestAnimationFrame(f); }));
      const ticks = await page.evaluate(async () => { const c = window.bend.duel.net.client, a = c.stats.ticks; await new Promise((r) => setTimeout(r, 500)); return c.stats.ticks - a; });
      console.log(`  [${name}] ${raf} frames, ${ticks} input ticks in 500 ms`);
      runs[name] = await page.evaluate(() => {
        const d = window.bend.duel, s = d.net.stats();
        let probe = null;
        try { const c = d.net.client, was = c.shownWorld; c.update(16, null, 0); c.show(16); probe = { errs: [...(window.bend.kit?.errors?.values?.() ?? [])].map((e) => e.message.slice(0, 500)), was, now: c.shownWorld, q: c.takeCrossings?.().length ?? null, ahead: c.aheadSince, shownAt: c.shownAt }; } catch (e) { probe = String(e.stack).slice(0, 400); }
        return { probe, seat: s.seat, crossings: s.crossings, err: s.err, corrections: s.corrections, cuts: s.cuts, page: d.crossings.map((x) => ({ ...x })), duelWorld: d.world, view: window.bend.gates?.rigWorld ?? null, fps: window.bend.stats?.().fps ?? null, phase: d.state.phase };
      });
    }
    const duels = await (await fetch(`http://127.0.0.1:${PORT}/duels`)).json();
    const srv = duels.duels.find((d) => d.room === room.toUpperCase());
    for (const [name, r] of Object.entries(runs)) {
      const x = r.crossings;
      console.log(`[${name}] seat ${r.seat}: heard ${x.server}, predicted ${x.predicted} (agreed ${x.agreed}), brought ${x.brought}, put back ${x.putBack}; shown changed ${x.shown}, flip-flops ${x.flips}; client ${x.world}/pred ${x.predWorld}/shown ${x.shownWorld}${x.lost ? ` LOST ${x.lost}` : ''}; the page's duel in ${r.duelWorld}, main view ${r.view}; error near a crossing p50 ${x.err.p50Mm} p95 ${x.err.p95Mm} max ${x.err.maxMm} mm (${x.err.n}); all acks p95 ${r.err.p95Mm}; corrections ${r.corrections}, cuts ${r.cuts}; the page's crossings ${r.page.map((c) => `${c.from}>${c.to} ${c.how ?? '?'}`).join(', ')}; probe ${JSON.stringify(r.probe)}`);
    }
    console.log(`server: ${srv?.crossings?.length} crossings (${(srv?.crossings ?? []).map((c) => `${c.from}>${c.to}@${c.n}`).join(', ')}), now in ${srv?.world}; a tick ${srv?.tickMs.mean.toFixed(3)} ms mean, ${srv?.tickMs.p99.toFixed(3)} p99`);
    const ok = Object.values(runs).every((r) => r.crossings.world === srv?.world && r.crossings.shownWorld === srv?.world && r.duelWorld === srv?.world && !r.crossings.lost);
    console.log(ok ? 'every page in the server\'s world' : 'NOT every page in the server\'s world');
    report[`lag${lag}`] = { runs, server: srv, ok };
    for (const { name, page } of pages) {
      const png = await page.evaluate(async () => window.bend.grab('image/jpeg', 0.8));
      writeFileSync(join(OUT, `lag${lag}-${name}-end.jpg`), Buffer.from(png.split(',')[1], 'base64'));
    }
    for (const { page } of pages) await page.close();
  }
  writeFileSync(join(OUT, 'stats.json'), JSON.stringify(report, null, 1));
  console.log(`\nwrote ${join(OUT, 'stats.json')}`);
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  stopServer();
}
