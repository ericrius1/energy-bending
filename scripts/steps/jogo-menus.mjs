// The jogo's screens, captured: the front of the game over the show (each mode), the lobby before a jogo on one screen
// (empty, then with a keyboard joined), and the room's code while an online jogo waits. Headless Chrome doesn't put
// WebGPU into a page screenshot, so each capture reads the canvas back (bend.grab), lays it under the page as its
// background, and then screenshots the page with the menus over it.
//   node scripts/steps/jogo-menus.mjs <outdir> [--url http://127.0.0.1:5392/energybending/]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, adapterName, takeLock } from '../lib/browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--url') ?? 'shots/menus';
const URL0 = opt('url', 'http://127.0.0.1:5392/energybending/');
mkdirSync(OUT, { recursive: true });

const release = await takeLock();
const browser = await launch({ width: 1280, height: 800 });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  page error:', m.text().slice(0, 300)); });
  const open = async (q) => {
    await page.goto(`${URL0}${q ? `?${q}&` : '?'}noautores`, { timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
    await page.evaluate(() => { const k = window.bend.kit; k.manual = true; k.renderScale = 1; });
  };
  /** the canvas read back and put under the page, then the page as it looks */
  const shot = async (name, frames = 1) => {
    await page.evaluate(async (n) => {
      document.body.style.backgroundImage = '';
      document.getElementById('stage').style.visibility = 'visible';
      await window.bend.step(n);
      const url = await window.bend.grab('image/jpeg', 0.92);
      document.body.style.background = `#050409 url(${url}) center / cover no-repeat`;
      document.getElementById('stage').style.visibility = 'hidden';
    }, frames);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(`${name}.png`);
  };
  await open('');
  console.log('adapter:', await adapterName(page));
  await page.evaluate(() => window.bend.wake());
  await shot('front', 420);
  await page.click('.jg-mode:nth-child(3)');
  await shot('front-online');
  await page.click('.jg-mode:nth-child(4)');
  await shot('front-solo');
  await page.click('.jg-mode:nth-child(2)');
  await page.click('.jg-world:nth-child(2)');
  await page.click('.jg-body:nth-child(1) .jg-swatch:nth-child(5)');
  await shot('front-partner-pool-plasma');
  await open('jogo=same&world=geode&dress=fire,water');
  await shot('lobby', 60);
  await page.keyboard.down('KeyJ'); await page.keyboard.up('KeyJ');
  await shot('lobby-joined', 2);
  await open('jogo=online&room=GEMS&create&world=geode&server=ws://127.0.0.1:5412/ws');
  await shot('online-waiting', 120);
} finally {
  await browser.close();
  release();
}
