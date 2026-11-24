// Live Two-Agent Flow Surf WebGPU Playtest & Portfolio Showcase Video Capture (with real live Solarpunk DOM HUD).
//
// Usage:
//   Playtest + 8 keyframe composite screenshots + contact sheet + metrics JSON:
//     node scripts/surf-capture.mjs --mode playtest --out /tmp/surf-playtest
//
//   Portfolio showcase video (1280x720 @ 60fps, H.264 slow ~3.6Mbps, AAC soundtrack, +faststart):
//     node scripts/surf-capture.mjs --mode video --out /tmp/surf-video/film.mp4
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { launch, adapterName } from './lib/browser.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const MODE = opt('mode', 'playtest');
const OUT = resolve(opt('out', MODE === 'video' ? join(ROOT, 'shots/flow-surf-film.mp4') : join(ROOT, 'shots/surf-playtest')));
const PORT = Number(opt('port', '5444'));
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const FPS = Number(opt('fps', '60'));
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

/** start Vite preview serving dist/ and wait until HTTP 200 */
async function startServer(port) {
  const srv = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errLog = '';
  srv.stderr.on('data', (d) => { errLog += d.toString(); });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/energybending/`);
      if (r.ok) return srv;
    } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  srv.kill();
  throw new Error(`vite preview failed to start on port ${port}: ${errLog}`);
}

/** composite one exact stepped frame (WebGPU canvas + live Solarpunk DOM HUD) as PNG buffer */
async function captureCompositePng(page) {
  await page.evaluate(async () => {
    const stage = document.getElementById('stage');
    if (stage) stage.style.visibility = 'visible';
    for (const c of document.querySelectorAll('canvas.hud')) c.style.visibility = '';
    const url = await window.bend.grab('image/png');
    document.body.style.background = `#050409 url(${url}) center / cover no-repeat`;
    if (stage) stage.style.visibility = 'hidden';
    for (const c of document.querySelectorAll('canvas.hud')) c.style.visibility = 'hidden';
  });
  return page.screenshot({ type: 'png' });
}

/** open a fresh 2-agent Flow Surf world page and settle into active surfing */
async function openSurfWorld(browser, url, { world, dress = 'fire,water', seed = 23, settle = 210, hour = null, form0 = false, form1 = false } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const q = new URLSearchParams({
    jogo: 'partner',
    agents: '2',
    world,
    dress,
    seed: String(seed),
    showhud: '',
    noautores: '',
    roda: '0',
    tutorial: '0',
  });
  await page.goto(`${url}?${q.toString().replace(/=(&|$)/g, '$1')}`, { timeout: 120000 });
  await page.waitForFunction(() => document.body.classList.contains('ready') && !!window.bend?.jogo?.surf, { timeout: 120000, polling: 150 });
  await page.evaluate(async (opts) => {
    const k = window.bend.kit;
    k.manual = true;
    k.renderScale = 1;
    window.bend.wake();
    // hide lobby & tutorial overlays; in portfolio video mode also omit redundant portfolio home-row pill
    const sel = opts.hideHome ? '.jg-lobby, .eb-tut, .home-row' : '.jg-lobby, .eb-tut';
    document.querySelectorAll(sel).forEach((e) => e.remove());
    if (opts.hour != null && window.bend.params?.redwoods) {
      window.bend.params.redwoods.hour = opts.hour;
      window.bend.params.redwoods.dayGoes = false;
    }
    await document.fonts.ready;
  }, { hour, hideHome: MODE === 'video' });

  // step past intro count-in so both surfers are gliding freely in live play!
  await page.evaluate(async ({ n, f0, f1 }) => {
    await window.bend.step(n);
    // verify session reached 'play'; if still in intro, step a bit more
    for (let k = 0; k < 6 && window.bend.jogo.phase !== 'play'; k++) await window.bend.step(60);
    // optionally boost starting Flow so Form / Fusion can ignite cinematically
    const S = window.bend.jogo.room?.session?.net?.session;
    if (S) {
      S.flow[0] = Math.max(S.flow[0], 35);
      S.flow[1] = Math.max(S.flow[1], 35);
      if (f0) { S.flow[0] = 96; S.form[0] = 1; }
      if (f1) { S.flow[1] = 96; S.form[1] = 1; }
      S.changed = true;
    }
  }, { n: settle, f0: form0, f1: form1 });
  return { page, errors };
}

/** capture one chapter into a lossless .mkv file by piping PNG frames straight into ffmpeg */
async function captureChapter(browser, baseUrl, cfg, outMkv) {
  const { page, errors } = await openSurfWorld(browser, baseUrl, cfg);
  const totalFrames = Math.round(cfg.seconds * FPS);
  const tags = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
  const ff = spawn(FFMPEG, [
    '-y', '-v', 'error',
    '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(FPS), '-i', '-',
    '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', ...tags, outMkv,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const t0 = Date.now();
  const snapshots = [];
  for (let f = 0; f < totalFrames; f++) {
    // trigger requested mid-chapter moments (e.g. Form toggle or Harmony Fusion buildup)
    if (cfg.onFrame) await cfg.onFrame(page, f, totalFrames);
    const png = await captureCompositePng(page);
    if (!ff.stdin.write(png)) await new Promise((ok) => ff.stdin.once('drain', ok));
    if (cfg.saveStillAt && cfg.saveStillAt.includes(f)) {
      snapshots.push({ f, png });
    }
    if (f % 120 === 0 || f === totalFrames - 1) {
      const stats = await page.evaluate(() => window.bend.jogo.surf?.stats?.() ?? {});
      console.log(`  [${cfg.name}] frame ${f + 1}/${totalFrames} (${((Date.now() - t0) / 1000).toFixed(1)}s) surf=${JSON.stringify(stats)}`);
    }
  }
  ff.stdin.end();
  await new Promise((ok, no) => ff.on('close', (c) => (c ? no(new Error(`ffmpeg chapter failed: ${c}`)) : ok())));
  const finalStats = await page.evaluate(() => window.bend.jogo.stats());
  await page.close();
  return { finalStats, errors, snapshots };
}

// ---------------------------------------------------------------- main
const srv = await startServer(PORT);
const baseUrl = `http://127.0.0.1:${PORT}/energybending/`;
const browser = await launch({ width: W, height: H });

try {
  const probePage = await browser.newPage();
  const adapter = await adapterName(probePage);
  await probePage.close();
  console.log(`[surf-capture] mode=${MODE} ${W}x${H}@${FPS} adapter="${adapter}"`);

  if (MODE === 'playtest') {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });

    const worlds = [
      { name: 'geode', world: 'geode', dress: 'fire,water', seed: 17, settle: 230, shots: [0, 75, 165, 255] },
      { name: 'pool', world: 'pool', dress: 'fire,water', seed: 31, settle: 220, form0: true, form1: true, shots: [40, 145] },
      { name: 'redwoods', world: 'redwoods', dress: 'fire,water', seed: 43, settle: 220, hour: 17.4, fuseAt: 90, shots: [30, 170] },
    ];
    const report = { adapter, worlds: [], errors: [] };
    const shotFiles = [];

    for (const w of worlds) {
      const { page, errors } = await openSurfWorld(browser, baseUrl, w);
      const maxF = Math.max(...w.shots) + 1;
      const trace = [];
      for (let f = 0; f < maxF; f++) {
        if (w.fuseAt != null && f === w.fuseAt) {
          await page.evaluate(() => {
            const S = window.bend.jogo.room?.session?.net?.session;
            if (S) { S.tension = 100; S.mergeReady = true; S.changed = true; }
          });
        }
        if (w.shots.includes(f)) {
          const png = await captureCompositePng(page);
          const fname = `${String(shotFiles.length + 1).padStart(2, '0')}-${w.name}-f${f}.png`;
          const full = join(OUT, fname);
          writeFileSync(full, png);
          shotFiles.push(full);
          const snap = await page.evaluate(() => ({
            phase: window.bend.jogo.phase,
            surf: window.bend.jogo.surf?.stats(),
            seats: window.bend.jogo.stats().seats,
            charge0: +(window.bend.show.dancers[0]?.charge ?? 0).toFixed(2),
            dissolve0: +(window.bend.show.dancers[0]?.dissolve ?? 0).toFixed(2),
            dissolve1: +(window.bend.show.dancers[1]?.dissolve ?? 0).toFixed(2),
          }));
          trace.push({ f, file: fname, ...snap });
          console.log(`  shot ${fname}: ${JSON.stringify(snap)}`);
        } else {
          await page.evaluate(() => window.bend.step(1));
        }
      }
      const endStats = await page.evaluate(() => window.bend.jogo.stats());
      report.worlds.push({ name: w.name, endStats, trace });
      report.errors.push(...errors);
      await page.close();
    }

    // build 4x2 contact sheet for instant visual inspection
    const sheet = join(OUT, 'contact-sheet.jpg');
    const args = [];
    for (const f of shotFiles.slice(0, 8)) args.push('-i', f);
    const inputs = shotFiles.slice(0, 8).map((_, i) => `[${i}:v]scale=480:270[v${i}]`).join(';');
    const stack = shotFiles.slice(0, 8).map((_, i) => `[v${i}]`).join('');
    spawnSync(FFMPEG, ['-y', '-v', 'error', ...args, '-filter_complex', `${inputs};${stack}xstack=inputs=8:layout=0_0|w0_0|w0+w1_0|w0+w1+w2_0|0_h0|w0_h0|w0+w1_h0|w0+w1+w2_h0[out]`, '-map', '[out]', '-q:v', '2', sheet], { stdio: 'inherit' });
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`[surf-capture] playtest complete -> ${OUT} (errors: ${report.errors.length})`);
    if (report.errors.length) console.log('  ERRORS:', report.errors);
  } else if (MODE === 'video') {
    const workDir = join(dirname(OUT), 'work-surf-video');
    rmSync(workDir, { recursive: true, force: true });
    mkdirSync(workDir, { recursive: true });
    mkdirSync(dirname(OUT), { recursive: true });

    // 3 seamless chapters (~40 seconds total) showing every Flow Surf mechanic & live Solarpunk HUD!
    const chapters = [
      {
        name: '01-geode-surf',
        world: 'geode',
        dress: 'fire,water',
        seed: 17,
        settle: 210,
        seconds: 14.0,
        saveStillAt: [120, 420, 720],
        onFrame: async (page, f) => {
          // keep Geode chapter focused on vibrant Fire+Water flow, then ignite Plasma & Ice Forms near the end
          if (f === 520) {
            await page.evaluate(() => {
              const S = window.bend.jogo.room?.session?.net?.session;
              if (S) { S.flow[0] = Math.max(S.flow[0], 78); S.flow[1] = Math.max(S.flow[1], 74); S.changed = true; }
            });
          }
        },
      },
      {
        name: '02-temple-morph',
        world: 'temple',
        dress: 'fire,water',
        seed: 31,
        settle: 210,
        seconds: 13.0,
        form0: true,
        form1: true,
        saveStillAt: [180, 480],
        onFrame: async (page, f) => {
          // top up Plasma & Ice Form flow partway through so both shimmer across the sunlit Tide Temple terrace!
          if (f === 320) {
            await page.evaluate(() => {
              const S = window.bend.jogo.room?.session?.net?.session;
              if (S) {
                S.flow[0] = 95; S.flow[1] = 95;
                S.form[0] = 1; S.form[1] = 1;
                S.changed = true;
              }
            });
          }
        },
      },
      {
        name: '03-redwoods-fusion',
        world: 'redwoods',
        dress: 'fire,water',
        seed: 43,
        settle: 210,
        hour: 17.35,
        seconds: 14.0,
        saveStillAt: [150, 420, 690],
        onFrame: async (page, f) => {
          // push Harmony to 100% around 4.5s in -> glowing HOLD F · FUSE! -> soaring Twin-Helix Fusion climax!
          if (f === 270) {
            await page.evaluate(() => {
              const S = window.bend.jogo.room?.session?.net?.session;
              if (S) { S.tension = 100; S.mergeReady = true; S.flow[0] = 88; S.flow[1] = 92; S.changed = true; }
            });
          }
        },
      },
    ];

    const mkvs = [];
    const stillPaths = [];
    for (const ch of chapters) {
      const mkv = join(workDir, `${ch.name}.mkv`);
      const res = await captureChapter(browser, baseUrl, ch, mkv);
      mkvs.push({ path: mkv, dur: ch.seconds });
      for (const s of res.snapshots) {
        const sp = join(workDir, `${ch.name}-f${s.f}.png`);
        writeFileSync(sp, s.png);
        stillPaths.push(sp);
      }
      if (res.errors.length) console.warn(`  [${ch.name}] warnings/errors:`, res.errors.slice(0, 5));
    }

    // crossfade the 3 chapters cleanly (0.5s xfade between chapters) + mux Geode soundtrack from vibrant body section!
    const xfade = 0.5;
    const totalDur = mkvs.reduce((a, m) => a + m.dur, 0) - xfade * (mkvs.length - 1);
    const off1 = mkvs[0].dur - xfade;
    const off2 = off1 + mkvs[1].dur - xfade;
    const musicPath = join(ROOT, 'public/music/geode.m4a');
    if (!existsSync(musicPath)) throw new Error(`Missing soundtrack: ${musicPath}`);

    const tags = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
    const filterComplex = [
      `[0:v][1:v]xfade=transition=fade:duration=${xfade}:offset=${off1.toFixed(3)}[v01]`,
      `[v01][2:v]xfade=transition=fade:duration=${xfade}:offset=${off2.toFixed(3)},fade=t=in:st=0:d=0.6,fade=t=out:st=${(totalDur - 1.2).toFixed(3)}:d=1.2[v]`,
      `[3:a]atrim=start=26.4:duration=${totalDur.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.45,afade=t=out:st=${(totalDur - 1.4).toFixed(3)}:d=1.4,alimiter=limit=0.9[a]`,
    ].join(';');

    console.log(`[surf-capture] encoding final 720p60 showcase (${totalDur.toFixed(1)}s) -> ${OUT}`);
    const enc = spawnSync(FFMPEG, [
      '-y', '-v', 'error',
      '-i', mkvs[0].path, '-i', mkvs[1].path, '-i', mkvs[2].path, '-i', musicPath,
      '-filter_complex', filterComplex,
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-maxrate', '4.2M', '-bufsize', '8.4M',
      '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', String(FPS * 2), ...tags,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart',
      OUT,
    ], { stdio: 'inherit' });
    if (enc.status !== 0) throw new Error(`final ffmpeg encode failed (${enc.status})`);

    // build 4x2 video frame contact sheet for visual verification
    const sheet = join(dirname(OUT), 'film-contact-sheet.jpg');
    spawnSync(FFMPEG, [
      '-y', '-v', 'error', '-i', OUT,
      '-vf', `fps=8/${totalDur.toFixed(2)},scale=480:270,tile=4x2:padding=4:color=black`,
      '-frames:v', '1', '-q:v', '2', sheet,
    ], { stdio: 'inherit' });

    const mb = (statSync(OUT).size / 1e6).toFixed(2);
    console.log(`[surf-capture] DONE -> ${OUT} (${mb} MB, ${totalDur.toFixed(1)}s @ ${W}x${H} ${FPS}fps)`);
    console.log(`[surf-capture] contact sheet -> ${sheet}`);
  }
} finally {
  await browser.close();
  srv.kill();
}
