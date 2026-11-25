// The runner (src/play/runner.ts), played and filmed headless on the real GPU: a virtual player on the keyboard's
// keys (A D or W S as the view has them, Space for the high rings, a trick now and then) runs beside the partner brain,
// stepped frame by frame, while the smoothness is measured (how hard the player's body turns and slides from frame to
// frame, and the camera's eye). Built page served by vite preview (npm run build first).
//
//   node scripts/run-capture.mjs --mode stills --out shots/run           stills along the run, a sheet, metrics
//   node scripts/run-capture.mjs --mode video --out shots/run/run.mp4 --seconds 30 --size 960x540 --fps 30
//   (&world=…: --world pool; --views chase:0,side:11,chase:21 the view by second)
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { launch, adapterName } from './lib/browser.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const MODE = opt('mode', 'stills');
const OUT = resolve(opt('out', join(ROOT, MODE === 'video' ? 'shots/run/run.mp4' : 'shots/run')));
const PORT = Number(opt('port', '5446'));
const [W, H] = opt('size', '960x540').split('x').map(Number);
const FPS = Number(opt('fps', '30'));
const SECONDS = Number(opt('seconds', MODE === 'video' ? '30' : '16'));
const WORLD = opt('world', 'geode');
const VIEWS = opt('views', 'chase:0,side:11,chase:21').split(',').map((x) => { const [v, t] = x.split(':'); return { v, t: Number(t) }; });
const STILLS = opt('stills', '1,4,7,10,13,15').split(',').map(Number);
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

async function startServer(port) {
  const srv = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/energybending/`)).ok) return srv; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  srv.kill();
  throw new Error('vite preview did not start');
}

/** the canvas and the DOM HUD in one picture */
async function grab(page) {
  await page.evaluate(async () => {
    const stage = document.getElementById('stage');
    if (stage) stage.style.visibility = 'visible';
    const url = await window.bend.grab('image/png', 0.92, 1 / 60);
    document.body.style.background = `#050409 url(${url}) center / cover no-repeat`;
    if (stage) stage.style.visibility = 'hidden';
  });
  return page.screenshot({ type: 'png' });
}

const URL0 = opt('url', null);
const srv = URL0 ? null : await startServer(PORT);
const BASE = URL0 ?? `http://127.0.0.1:${PORT}/energybending/`;
const browser = await launch({ width: W, height: H });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error') errors.push(t); else if (t.startsWith('runner:')) console.log(`  ${t}`); });
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  console.log(`[run-capture] ${MODE} ${W}x${H}@${FPS} ${SECONDS}s ${WORLD} adapter="${await adapterName(page)}"`);
  await page.goto(`${BASE}?jogo=partner&world=${WORLD}&dress=fire,water&showhud&noautores&roda=0&tutorial=0&mute=1`, { timeout: 120000 });
  await page.waitForFunction(() => document.body.classList.contains('ready') && !!window.bend?.jogo?.runner, { timeout: 120000, polling: 200 });
  await page.evaluate(async () => {
    const b = window.bend;
    b.kit.manual = true; b.kit.renderScale = 1; b.wake();
    document.querySelectorAll('.jg-lobby, .eb-tut, .home-row').forEach((e) => e.remove());
    await document.fonts.ready;
    // (a person joins on the keyboard, as from the front: the room starts, the HUD and the YOU tell come up; the keys are
    // then the driver's, through bend.intent)
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true }));
    dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', key: 'a', bubbles: true }));
    await b.step(30, 1 / 60);
    if (!b.jogo.phase) await b.jogo.start();
    await b.step(150, 1 / 60);
    for (let k = 0; k < 8 && b.jogo.phase !== 'play'; k++) await b.step(60, 1 / 60);
    // (the player on the keys: as a person would, full presses with a dead band, the view's own keys)
    const st = { t: 0, trickAt: 3.2, lastLat: 0, jumpCool: 0, view: null, log: [] };
    window.__drive = (dt, views) => {
      st.t += dt;
      const R = b.jogo.runner, c = b.show.dancers[0]?.controller?.character;
      if (!R || !c || !R.track) return;
      const want = views.filter((v) => v.t <= st.t).pop()?.v ?? 'chase';
      if (want !== R.view) R.toggle();
      const T = R.track, me = T.project(c.root[0], c.root[2]);
      const ring = b.jogo.surf?.activeRing;
      let target = Math.sin(st.t * 0.55) * 1.3;
      let ahead = 99;
      if (ring && ring.s != null) {
        ahead = T.project(ring.at[0], ring.at[2], me.s).s - me.s;
        if (ahead > -0.5 && ahead < 18) target = ring.l ?? 0;
      }
      const e = target - c.railL;
      const lat = Math.abs(e) > 0.28 ? Math.sign(e) : 0;
      const k = R.stickFor(c, lat, st.t % 9 > 6 ? 1 : 0);
      const q = (v) => (Math.abs(v) > 0.5 ? Math.sign(v) : 0);
      const patch = { moveX: q(k.moveX), moveZ: q(k.moveZ) };
      st.jumpCool -= dt;
      if (ring?.high && ahead > 1.0 && ahead < 2.4 && Math.abs(c.railL - (ring.l ?? 0)) < 0.9 && c.grounded && st.jumpCool <= 0) { patch.jump = true; patch.jumpHeld = true; st.jumpCool = 0.6; st.airAt = st.t + 0.32; }
      else patch.jumpHeld = st.jumpCool > 0.3;
      if (st.airAt && st.t >= st.airAt) { if (Math.random() < 0.5) { patch.jump = true; } st.airAt = 0; }
      if (st.t >= st.trickAt && c.grounded) { const r = Math.random(); if (r < 0.45) patch.punch = true; else if (r < 0.75) patch.dodge = true; else patch.kick = true; st.trickAt = st.t + 2.4 + Math.random() * 2; }
      b.intent(0, patch);
    };
    window.__probe = () => {
      const c = b.show.dancers[0]?.controller?.character, p = b.show.dancers[1]?.controller?.character;
      const e = b.kit.camera.position;
      const T = b.jogo.runner.track, F = T ? T.at(c.root[0], c.root[2]) : null;
      return { x: c.root[0], z: c.root[2], y: c.root[1], yaw: c.yaw, l: c.railL, fl: F?.l ?? 0, sp: c.railSp, mv: c.move?.name ?? '', g: c.grounded, ref: c.reformT, px: p?.root[0], pz: p?.root[2], ex: e[0], ey: e[1], ez: e[2], view: b.jogo.runner.view };
    };
  });

  const N = Math.round(SECONDS * FPS), dt = 1 / FPS;
  const sub = Math.max(1, Math.round(60 / FPS));
  const probes = [];
  let ff = null;
  if (MODE === 'video') {
    mkdirSync(dirname(OUT), { recursive: true });
    ff = spawn(FFMPEG, ['-y', '-v', 'error', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(FPS), '-i', '-',
      '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  } else mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  const stillFiles = [];
  for (let f = 0; f < N; f++) {
    // (bend.grab steps the frame it grabs: a grabbed frame's last step is the grab's own, so the take runs in real time)
    const grabbing = !!ff || STILLS.some((s) => Math.round(s * FPS) === f);
    for (let k = 0; k < sub; k++) {
      const last = grabbing && k === sub - 1;
      if (!last) await page.evaluate(async (d, v) => { window.__drive(d, v); await window.bend.step(1, d); }, dt / sub, VIEWS);
      else {
        await page.evaluate((d, v) => window.__drive(d, v), dt / sub, VIEWS);
        const png = await grab(page);
        if (ff) { if (!ff.stdin.write(png)) await new Promise((ok) => ff.stdin.once('drain', ok)); }
        else {
          const file = join(OUT, `run-${WORLD}-${String(f).padStart(4, '0')}.png`);
          writeFileSync(file, png);
          stillFiles.push(file);
        }
      }
      probes.push(await page.evaluate(() => window.__probe()));
    }
    if (f % (FPS * 5) === 0) console.log(`  frame ${f}/${N} ${((Date.now() - t0) / 1000).toFixed(0)}s surf=${JSON.stringify(await page.evaluate(() => window.bend.jogo.surf?.stats()))}`);
  }
  if (ff) { ff.stdin.end(); await new Promise((ok) => ff.on('close', ok)); }

  // smoothness: the player's turn rate and its change, the slide's acceleration, the eye's acceleration (60 Hz steps)
  const h = 1 / 60, m = [];
  for (let i = 2; i < probes.length; i++) {
    const a = probes[i - 2], b = probes[i - 1], c = probes[i];
    const w1 = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) / h, w2 = Math.atan2(Math.sin(c.yaw - b.yaw), Math.cos(c.yaw - b.yaw)) / h;
    const ax = (c.x - 2 * b.x + a.x) / (h * h), az = (c.z - 2 * b.z + a.z) / (h * h);
    const ex = (c.ex - 2 * b.ex + a.ex) / (h * h), ez = (c.ez - 2 * b.ez + a.ez) / (h * h), ey = (c.ey - 2 * b.ey + a.ey) / (h * h);
    m.push({ turn: Math.abs(w2), turnJerk: Math.abs(w2 - w1) / h, acc: Math.hypot(ax, az), eyeAcc: Math.hypot(ex, ey, ez), sp: c.sp, view: c.view });
  }
  const pct = (k, p) => { const v = m.map((x) => x[k]).sort((x, y) => x - y); return +v[Math.floor(p * (v.length - 1))].toFixed(2); };
  const stats = await page.evaluate(() => window.bend.jogo.stats());
  const report = {
    adapter: await adapterName(page), world: WORLD, frames: probes.length, errors: errors.slice(0, 10),
    turn: { p50: pct('turn', 0.5), p99: pct('turn', 0.99), max: pct('turn', 1) },
    turnJerk: { p50: pct('turnJerk', 0.5), p99: pct('turnJerk', 0.99) },
    bodyAcc: { p50: pct('acc', 0.5), p99: pct('acc', 0.99), max: pct('acc', 1) },
    eyeAcc: { p50: pct('eyeAcc', 0.5), p99: pct('eyeAcc', 0.99), max: pct('eyeAcc', 1) },
    speed: { p50: pct('sp', 0.5) },
    surf: stats.surf, phase: stats.phase,
  };
  console.log(JSON.stringify(report, null, 1));
  const dir = MODE === 'video' ? dirname(OUT) : OUT;
  writeFileSync(join(dir, `report-${WORLD}.json`), JSON.stringify({ report, probes }, null, 1));
  if (stillFiles.length) {
    const sheet = join(OUT, `sheet-${WORLD}.jpg`), n = stillFiles.length, cols = Math.min(3, n);
    const args = stillFiles.flatMap((f) => ['-i', f]);
    const inputs = stillFiles.map((_, i) => `[${i}:v]scale=640:360[v${i}]`).join(';');
    const lay = stillFiles.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => 'w0').join('+') : '0'}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+') : '0'}`).join('|');
    spawnSync(FFMPEG, ['-y', '-v', 'error', ...args, '-filter_complex', `${inputs};${stillFiles.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${n}:layout=${lay}[o]`, '-map', '[o]', '-q:v', '3', sheet], { stdio: 'inherit' });
    console.log(`[run-capture] sheet ${sheet}`);
  }
  if (ff && existsSync(OUT)) console.log(`[run-capture] ${OUT} ${(statSync(OUT).size / 1e6).toFixed(1)} MB`);
} finally {
  await browser.close();
  srv?.kill();
}
