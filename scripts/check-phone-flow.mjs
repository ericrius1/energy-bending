// Touch front -> game, then controlled frame pressure -> quality reduction/recovery at a fixed image size.
// The injected delay is a regression check of the controller, not a simulation of an iPhone GPU.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:5492/energybending/';
const out = process.argv[3] ?? 'shots/phone-profile/flow';
mkdirSync(out, { recursive: true });
const browser = await launch({ width: 390, height: 844 });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.bend, { timeout: 240000 });
  await wait(3000);
  await page.screenshot({ path: `${out}/front.png` });
  assert.deepEqual(await page.evaluate(() => bend.stats().errors), [], 'front GPU errors');
  const button = await page.$('.jg-go');
  assert.ok(button, 'front has a start button');
  await button.tap();
  // A resting strip deliberately consumes the first touch to wake its controls.
  await wait(300);
  if (await page.evaluate(() => !document.body.classList.contains('playing'))) await button.tap();
  await page.waitForFunction(() => /duel|jogo|play/.test(location.search) && document.body.classList.contains('playing'), { timeout: 120000 });
  await page.waitForFunction(() => window.bend, { timeout: 240000 });
  await wait(3000);
  const game = await page.evaluate(() => ({ url: location.href, klass: bend.device.klass, errors: bend.stats().errors }));
  assert.equal(game.klass, 'phone');
  assert.match(game.url, /duel|jogo|play/);
  assert.deepEqual(game.errors, []);
  await page.screenshot({ path: `${out}/game.png` });

  if (process.env.FRONT_ONLY === '1') {
    assert.deepEqual(errors, []);
    writeFileSync(`${out}/results.json`, JSON.stringify({ game, errors }, null, 2));
    console.log('touch front/game passed');
  } else {
  // Playable scene without a forced tier. Force a 43 ms CPU workload at the real rAF boundary so the governor
  // sees wall time, while the simulation continues to use its normal bounded dt.
  await page.goto(`${base}?class=phone&baseline&play&two&world=redwoods&dress=fire,water`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.bend, { timeout: 240000 });
  const before = await page.evaluate(() => {
    bend.wake(); bend.kit.profiler.force = false;
    window.__normalFrame = bend.kit.frameCb;
    bend.kit.frameCb = f => { const until = performance.now() + 43; while (performance.now() < until) {} __normalFrame(f); };
    return bend.stats();
  });
  await wait(36000);
  const loaded = await page.evaluate(() => { bend.kit.frameCb = __normalFrame; return bend.stats(); });
  assert.equal(loaded.quality.level, 3, 'sustained pressure reaches fallback');
  assert.equal(loaded.renderScale, 0.85, 'image scale stays fixed');
  assert.deepEqual(loaded.render, before.render, 'image dimensions stay fixed');
  assert.equal(loaded.matter.ice.particles, 15600, 'water density follows the fallback');
  assert.deepEqual(loaded.errors, []);
  await wait(29000);
  const recovered = await page.evaluate(() => bend.stats());
  assert.ok(recovered.quality.level < 3, 'recovers with sustained headroom');
  assert.equal(recovered.renderScale, 0.85);
  assert.deepEqual(recovered.errors, []);
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/results.json`, JSON.stringify({ game, before, loaded, recovered, errors }, null, 2));
  console.log('touch front/game and adaptive quality pressure/recovery passed');
  }
} finally { await browser.close(); }
