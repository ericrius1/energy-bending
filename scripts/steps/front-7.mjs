// The first ten seconds, captured (docs/reports/7-first-ten-seconds.md): the plain page at one size, frames at fixed
// times after the first frame, the strip at rest and faded, each body chosen, a world chosen, the moment play starts.
// Headless Chrome doesn't put WebGPU into a page screenshot, so each frame reads the canvas back (bend.grab), lays it
// under the page as its background, hides the canvas and screenshots the page: the menu's DOM over the frame it was
// over. Time is the frames stepped at 60 Hz from the first one (the page's own clock); the strip's resting fade runs on
// the wall clock, so that take waits for real.
//   node scripts/steps/front-7.mjs <WxH> [--query class=phone] [--takes times,rest,bodies,world,play] [--url URL] [--out shots/front7]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, adapterName, takeLock } from '../lib/browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const size = argv[0] ?? '1280x800';
const [W, H] = size.split('x').map(Number);
const URL0 = opt('url', 'http://127.0.0.1:5455/energybending/');
const OUT = opt('out', 'shots/front7');
const query = opt('query', '');
const takes = new Set(opt('takes', 'times').split(','));
const tag = `${size}${query ? `-${query.replace(/[=&]/g, '')}` : ''}`;
mkdirSync(OUT, { recursive: true });

const release = await takeLock();
const t0 = Date.now();
const browser = await launch({ width: W, height: H });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  page.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type())) console.log(`  [${m.type()}]`, m.text().slice(0, 300)); });
  const open = async () => {
    const t = Date.now();
    await page.goto(`${URL0}?${[query, 'noautores'].filter(Boolean).join('&')}`, { timeout: 120000 });
    // the loading frame, before anything is compiled
    await page.screenshot({ path: join(OUT, `${tag}-loading.jpg`), type: 'jpeg', quality: 88 });
    await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 50 });
    await page.evaluate(() => { const k = window.bend.kit; k.manual = true; k.renderScale = 1; window.__f0 = k.frameIndex; });
    console.log(`opened in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  };
  /** step to `s` seconds after the first frame (or n frames more), read the canvas back, lay it under the page */
  const shot = async (name, o = {}) => {
    await page.evaluate(async (o) => {
      const b = window.bend, k = b.kit;
      document.body.style.backgroundImage = '';
      document.getElementById('stage').style.visibility = 'visible';
      const n = o.at != null ? Math.max(0, Math.round(o.at * 60) - (k.frameIndex - window.__f0) - 1) : (o.frames ?? 0);
      if (n > 0) await b.step(n);
      const url = await b.grab('image/jpeg', 0.92);
      document.body.style.background = `#050409 url(${url}) center / cover no-repeat`;
      document.getElementById('stage').style.visibility = 'hidden';
    }, o);
    await page.screenshot({ path: join(OUT, `${tag}-${name}.jpg`), type: 'jpeg', quality: 88 });
    console.log(`${tag}-${name}.jpg`);
  };
  await open();
  console.log('adapter:', await adapterName(page));
  if (takes.has('times')) for (const s of [0.3, 1, 3, 10]) await shot(`t${s}`, { at: s });
  if (takes.has('rest')) {
    await page.mouse.move(W * 0.3, H * 0.3); await page.mouse.move(W * 0.32, H * 0.31);
    await new Promise((r) => setTimeout(r, 700));
    await shot('rest', { at: 6 });
    await new Promise((r) => setTimeout(r, 5200));
    await shot('idle', { frames: 1 });
    await page.mouse.move(W * 0.4, H * 0.4);
    await new Promise((r) => setTimeout(r, 900));
  }
  if (takes.has('bodies')) {
    const names = await page.$$eval('.jg-body:nth-child(1) .jg-swatch', (b) => b.map((x) => x.getAttribute('aria-label')));
    await shot('bodies-before', { at: 4 });
    for (const [i, n] of names.entries()) {
      await page.click(`.jg-body:nth-child(1) .jg-swatch:nth-child(${i + 2})`);
      await shot(`body-${n}-0p3`, { frames: 18 });
      await shot(`body-${n}-1p5`, { frames: 72 });
    }
    // the second dancer too
    await page.click('.jg-body:nth-child(2) .jg-swatch:nth-child(5)');
    await shot('body2-ice-1p5', { frames: 90 });
  }
  if (takes.has('world')) {
    await page.click('.jg-world:nth-child(2)');
    await shot('world-pool-2', { frames: 120 });
    await page.click('.jg-world:nth-child(3)');
    await shot('world-temple-3', { frames: 180 });
  }
  if (takes.has('play')) {
    await shot('play-before', { at: 5 });
    await page.keyboard.down('KeyJ'); await page.keyboard.up('KeyJ');
    await new Promise((r) => setTimeout(r, 1500));
    await shot('play-0p1', { frames: 6 });
    await shot('play-1', { frames: 54 });
    await shot('play-3', { frames: 120 });
    await shot('play-8', { frames: 300 });
    console.log('jogo:', JSON.stringify(await page.evaluate(() => { const j = window.bend.jogo; return j ? { phase: j.phase, players: window.bend.players().length, href: location.search } : null; })));
  }
} finally {
  await browser.close();
  release();
  console.log(`held the lock ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
