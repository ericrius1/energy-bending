// The skin's stills (report 16-skin): the front on a desktop (1280×720) and a phone (375×812), the duel's lobby, a
// duel's HUD at a busy moment (desktop and phone), the winner's banner, the controls card and the lesson's first
// prompt. Headless Chrome doesn't put WebGPU into a page screenshot, so each capture reads the canvas back
// (bend.grab: the HUD's canvases over it), lays it under the page as its background, hides the canvas, then
// screenshots the page with the DOM (menus, cards, prompts) over it. Stepped by hand at 60 fps, so a before and an
// after of the same step see the same moment.
//   node scripts/steps/skin-16.mjs <outdir> [--url http://localhost:5455/energybending/] [--prefix after] [--only a,b]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, adapterName } from '../lib/browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'shots/skin';
const URL0 = opt('url', 'http://localhost:5455/energybending/');
const PREFIX = opt('prefix', 'shot');
const ONLY = opt('only', '') ? opt('only', '').split(',') : null;
mkdirSync(OUT, { recursive: true });

const DESK = { width: 1280, height: 720, deviceScaleFactor: 1 };
const PHONE = { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const browser = await launch({ width: 1280, height: 720 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fontsReport = null;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  page error:', m.text().slice(0, 300)); });
  const open = async (q, vp = DESK) => {
    await page.setViewport(vp);
    await page.goto(`${URL0}${q ? `?${q}&` : '?'}noautores`, { timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
    await page.evaluate(() => { const k = window.bend.kit; k.manual = true; k.renderScale = 1; });
  };
  const step = (n) => page.evaluate(async (k) => { await window.bend.step(k); }, n);
  /** the canvas read back and put under the page, then the page as it looks */
  const shot = async (name, frames = 1, settle = 700) => {
    if (settle) await wait(settle);
    await page.evaluate(async (n) => {
      document.getElementById('stage').style.visibility = 'visible';
      await window.bend.step(Math.max(0, n - 1));
      const url = await window.bend.grab('image/jpeg', 0.92);
      document.body.style.background = `#050409 url(${url}) center / cover no-repeat`;
      document.getElementById('stage').style.visibility = 'hidden';
      for (const c of document.querySelectorAll('canvas.hud')) c.style.visibility = 'hidden';
    }, frames);
    await page.screenshot({ path: join(OUT, `${PREFIX}-${name}.jpg`), type: 'jpeg', quality: 88 });
    await page.evaluate(() => { for (const c of document.querySelectorAll('canvas.hud')) c.style.visibility = ''; });
    console.log(`${PREFIX}-${name}.jpg`);
  };
  const want = (n) => !ONLY || ONLY.includes(n);
  const fonts = () => page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight} ${f.style}`);
  });

  /** the pointer resting on the strip's edge (its padding), so it never fades to idle while the frames step */
  const holdStrip = async () => {
    const b = await page.$eval('.jg-front', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, h: r.height }; });
    await page.mouse.move(b.x + 5, b.y + b.h / 2);
  };
  if (want('front')) {
    await open('');
    console.log('adapter:', await adapterName(page));
    await page.evaluate(() => window.bend.wake());
    await holdStrip();
    await shot('front', 420);
    fontsReport = await fonts();
    // a world and a body pointed at: their labels show
    await page.focus('.jg-go');
    await page.click('.jg-world:nth-child(3)');
    await shot('front-temple', 30);
  }
  if (want('phone')) {
    await open('', PHONE);
    await page.evaluate(() => window.bend.wake());
    await holdStrip();
    await shot('front-phone', 420);
  }
  const DUEL = 'duel&world=temple&dress=fire,water';
  if (want('lobby')) {
    await open(`${DUEL}&p1=human&p2=human`);
    await shot('lobby', 90);
    await page.keyboard.down('KeyA'); await page.keyboard.up('KeyA');
    await shot('lobby-joined', 4);
  }
  if (want('hud')) {
    // two virtual players from the bell, flow given so the bars and powers show; a busy moment some seconds in
    await open(`${DUEL}&p1=bot&p2=bot&go&set=60&keys=left,right`);
    await step(60 * 9);
    await page.evaluate(() => { window.bend.duel.flow(0, 1); window.bend.duel.flow(1, 0.55); });
    await shot('hud', 60 * 3);
    await page.click('.dh-chip');
    await shot('help', 2);
    await page.keyboard.press('Escape');
  }
  if (want('hudphone')) {
    await open(`${DUEL}&p1=bot&p2=bot&go&set=60&keys=left,right`, PHONE);
    await step(60 * 9);
    await page.evaluate(() => { window.bend.duel.flow(0, 1); window.bend.duel.flow(1, 0.55); });
    await shot('hud-phone', 60 * 3);
  }
  if (want('banner')) {
    await open(`${DUEL}&p1=bot&p2=bot&go&set=12`);
    for (let i = 0; i < 60 && (await page.evaluate(() => window.bend.duel.state.phase)) !== 'done'; i++) await step(30);
    await shot('banner', 75);
  }
  if (want('lesson')) {
    await open(`${DUEL}&p1=human&p2=bot&lesson`);
    await page.keyboard.down('KeyA'); await page.keyboard.up('KeyA');
    await step(60 * 5);
    await shot('lesson', 60, 1200);
  }
  // the HUD's CPU a frame in a duel of two virtual players (flow given, so the bars, powers and keys draw), 600 frames
  // stepped at 60 fps after the first 9 s, at 720p and on a phone (bend.hud.stats: its own timer round its draw)
  if (want('cpu')) {
    for (const [label, vp] of [['720p', DESK], ['phone', PHONE]]) {
      await open(`${DUEL}&p1=bot&p2=bot&go&set=60&keys=left,right`, vp);
      await step(60 * 9);
      const r = await page.evaluate(async () => {
        const B = window.bend;
        B.hud.stats(true);
        const all = [];
        for (let i = 0; i < 40; i++) { B.duel.flow(0, 0.6 + 0.4 * (i % 2)); await B.step(15); all.push(B.hud.stats(true)); }
        const mean = all.reduce((a, s) => a + s.cpuMs, 0) / all.length, worst = Math.max(...all.map((s) => s.cpuMaxMs));
        const base = all.reduce((a, s) => a + s.baseFrames, 0), frames = all.reduce((a, s) => a + s.frames, 0);
        return { mean, worst, base, frames, size: all[0].size, ratio: all[0].ratio };
      });
      console.log(`HUD CPU ${label} (${r.size.join('x')} at ${r.ratio}): ${r.mean.toFixed(3)} ms a frame, worst ${r.worst.toFixed(3)}, base drawn ${r.base} of ${r.frames} frames`);
    }
  }
  if (fontsReport) console.log('fonts loaded:', fontsReport.join(' | ') || '(none: system fonts)');
} finally {
  await browser.close();
}
