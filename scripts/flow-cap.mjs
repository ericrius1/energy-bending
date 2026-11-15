// The duel as its own camera sees it, a frame every few seconds through a set, per world (report 18-flow: the before
// and after of the arenas opened and the movement that flows). Two virtual players, stepped by hand at 60 fps.
//   node scripts/flow-cap.mjs <outdir> --url http://localhost:<port>/energybending/ [--world temple,redwoods,geode,pool]
//     [--seed 3] [--every 240] [--n 6] [--from 480] [--size 1280x720]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, takeLock } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const out = argv[0];
const BASE = arg('url', 'http://localhost:5391/energybending/');
const worlds = arg('world', 'temple,redwoods,geode,pool').split(',');
const seed = arg('seed', '3'), every = Number(arg('every', '240')), n = Number(arg('n', '6')), from = Number(arg('from', '480'));
const [W, H] = arg('size', '1280x720').split('x').map(Number);
mkdirSync(out, { recursive: true });

const release = await takeLock();
const browser = await launch({ width: W, height: H });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message));
try {
  for (const w of worlds) {
    await page.goto(`${BASE}?duel&world=${w}&dress=fire,water&p1=bot&p2=bot&seed=${seed}&go&noautores`, { timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('ready') && window.bend?.duel, { timeout: 180000, polling: 200 });
    for (let k = 0; k < n; k++) {
      const png = await page.evaluate(async (f) => { await window.bend.step(f); return window.bend.grab('image/png'); }, k === 0 ? from : every);
      writeFileSync(join(out, `${w}-${k}.png`), Buffer.from(png.split(',')[1], 'base64'));
    }
    console.log(`${w}: ${n} frames`);
  }
} finally {
  await browser.close();
  release();
}
