// A probe for the wayfinding work (report 18-wayfinding): open the page with a query, run a script in it and print
// what it returns. In the script's scope: `bend`, `step(n)` (frames stepped at 60 fps), `shot(name)` (a still with the
// page's DOM over the canvas, as skin-16.mjs takes them), `key(code[, down])`, `click(selector)`, `mouse(x, y)`,
// `tap(x, y)`, `log(...)`.
//   node scripts/steps/wf-probe.mjs <query> <script.js> [--url http://localhost:5583/energybending/] [--out shots/wf]
//        [--phone]
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, adapterName } from '../lib/browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const Q = argv[0] ?? '', LIB = opt('lib', null), SCRIPT = (LIB ? readFileSync(LIB, 'utf8') + '\n' : '') + readFileSync(argv[1], 'utf8');
const URL0 = opt('url', 'http://localhost:5583/energybending/'), OUT = opt('out', 'shots/wf');
mkdirSync(OUT, { recursive: true });
const PHONE = argv.includes('--phone');
const vp = PHONE ? { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 720, deviceScaleFactor: 1 };
const browser = await launch({ width: 1280, height: 720 });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warn' || t.startsWith('[wf]')) console.log(`  page ${m.type()}:`, t.slice(0, 600)); });
  await page.setViewport(vp);
  const t0 = Date.now();
  await page.goto(`${URL0}${Q ? `?${Q}&` : '?'}noautores`, { timeout: 120000 });
  await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
  console.log('ready in', ((Date.now() - t0) / 1000).toFixed(1), 's; adapter:', await adapterName(page));
  if (!argv.includes('--live')) await page.evaluate(() => { const k = window.bend.kit; k.manual = true; k.renderScale = 1; });
  let n = 0;
  await page.exposeFunction('__shot', async (name) => {
    await page.evaluate(async () => {
      document.getElementById('stage').style.visibility = 'visible';
      const url = await window.bend.grab('image/jpeg', 0.9);
      document.body.style.background = `#050409 url(${url}) center / cover no-repeat`;
      document.getElementById('stage').style.visibility = 'hidden';
      for (const c of document.querySelectorAll('canvas.hud')) c.style.visibility = 'hidden';
    });
    const p = join(OUT, `${name ?? `s${n++}`}.jpg`);
    await page.screenshot({ path: p, type: 'jpeg', quality: 86 });
    await page.evaluate(() => { document.getElementById('stage').style.visibility = 'visible'; for (const c of document.querySelectorAll('canvas.hud')) c.style.visibility = ''; });
    return p;
  });
  await page.exposeFunction('__key', async (code, down) => {
    if (down === undefined || down === null) { await page.keyboard.down(code); await page.keyboard.up(code); } else if (down) await page.keyboard.down(code); else await page.keyboard.up(code);
  });
  await page.exposeFunction('__click', async (sel) => { await page.click(sel); });
  await page.exposeFunction('__mouse', async (x, y) => { await page.mouse.move(x, y); });
  await page.exposeFunction('__tap', async (x, y) => { await page.touchscreen.tap(x, y); });
  const r = await page.evaluate(`(async () => { const bend = window.bend; const step = (n) => bend.step(n); const shot = window.__shot, key = window.__key, click = window.__click, mouse = window.__mouse, tap = window.__tap; const log = (...a) => console.log('[wf]', ...a.map((x) => typeof x === 'string' ? x : JSON.stringify(x))); ${SCRIPT} })()`);
  console.log(JSON.stringify(r, null, 1));
} finally { await browser.close(); }
