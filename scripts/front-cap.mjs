// The front as a film clip (report 17): the film tool takes its frames from the GPU canvas, and the front's strip, the
// lobby and the cards are DOM over it, so a film never shows them. This steps the front page by hand at 60 fps and, for
// each frame, reads the canvas back (bend.grab: the HUD's canvases over it), lays it under the page as its background,
// hides the canvas and screenshots the page with the DOM over it (scripts/steps/skin-16.mjs's still, made a frame at a
// time), then joins the frames into a lossless clip. No sound (a film lays its track under it).
//   node scripts/front-cap.mjs <out.mkv> [--url http://127.0.0.1:5435/energybending/] [--size 1280x720] [--seconds 4]
//        [--settle 420 (frames stepped before the first one kept)] [--query world=geode] [--png (keep the frames)]
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, adapterName } from './lib/browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(argv[0] ?? 'shots/front.mkv');
const URL0 = opt('url', 'http://127.0.0.1:5435/energybending/');
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const FRAMES = Math.round(Number(opt('seconds', '4')) * 60);
const SETTLE = Number(opt('settle', '420'));
const Q = opt('query', '');
const dir = join(dirname(OUT), `${OUT.replace(/^.*[\\/]/, '').replace(/\.\w+$/, '')}-frames`);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const browser = await launch({ width: W, height: H });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(`${URL0}?${Q ? `${Q}&` : ''}noautores`, { timeout: 120000 });
  await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
  await page.evaluate(() => { const k = window.bend.kit; k.manual = true; k.renderScale = 1; });
  console.log('adapter:', await adapterName(page));
  await page.evaluate(() => window.bend.wake());
  await page.evaluate(async () => { await document.fonts.ready; });
  // (the pointer resting on the strip's edge, so it never fades to idle while the frames step)
  const b = await page.$eval('.jg-front', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, h: r.height }; });
  await page.mouse.move(b.x + 5, b.y + b.h / 2);
  await page.evaluate(async (n) => { await window.bend.step(n); }, SETTLE);
  const t0 = Date.now();
  for (let k = 0; k < FRAMES; k++) {
    await page.evaluate(async () => {
      document.getElementById('stage').style.visibility = 'visible';
      for (const c of document.querySelectorAll('canvas.hud')) c.style.visibility = '';
      // (grab steps the frame it reads: one page frame a kept frame)
      const url = await window.bend.grab('image/png');
      document.body.style.background = `#050409 url(${url}) center / cover no-repeat`;
      document.getElementById('stage').style.visibility = 'hidden';
      for (const c of document.querySelectorAll('canvas.hud')) c.style.visibility = 'hidden';
    });
    await page.screenshot({ path: join(dir, `f${String(k).padStart(4, '0')}.png`), type: 'png' });
    if (k % 30 === 0) console.log(`frame ${k}/${FRAMES} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
} finally { await browser.close(); }
const tags = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '60', '-i', join(dir, 'f%04d.png'), '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', ...tags, OUT], { stdio: 'inherit' });
console.log(`${OUT}: ${readdirSync(dir).length} frames, ffmpeg ${r.status}`);
if (!argv.includes('--png')) rmSync(dir, { recursive: true, force: true });
