// Production WebGPU/touch regression smoke test. Chrome's mobile viewport and optional-feature removal exercise
// compatibility paths; they do not emulate WebKit, an iPhone GPU or thermal throttling.
// node scripts/check-phone.mjs [base] [output]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5492/energybending/';
const out = process.argv[3] ?? 'shots/phone-profile/check';
mkdirSync(out, { recursive: true });
const browser = await launch({ width: 390, height: 844 });
const results = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  for (const scenario of [
    { name: 'phone-minimum', klass: 'phone', minimal: true, level: 0 },
    { name: 'phone-fallback', klass: 'phone', minimal: false, level: 3 },
    { name: 'laptop', klass: 'laptop', minimal: false, level: 0 },
    { name: 'desktop', klass: 'desktop', minimal: false, level: 0 },
  ].filter(s => !process.env.PHONE_CASE || process.env.PHONE_CASE === s.name)) {
    console.log(`checking ${scenario.name}`);
    const page = await browser.newPage();
    const issues = [];
    page.on('pageerror', e => issues.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') issues.push(m.text()); });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    if (scenario.minimal) {
      await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.7258.77 Mobile/15E148 Safari/604.1');
      await page.evaluateOnNewDocument(() => {
        const request = GPUAdapter.prototype.requestDevice;
        GPUAdapter.prototype.requestDevice = function (options) { return request.call(this, { ...options, requiredFeatures: [] }); };
      });
    }
    await page.goto(`${base}?baseline&class=${scenario.klass}&quality=${scenario.level}&play&two&dress=fire,water`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.bend, { timeout: 240000 });
    console.log(`${scenario.name}: ready`);
    await page.evaluate(() => { bend.kit.profiler.force = false; bend.wake(); });
    const cases = [];
    for (const world of ['geode', 'temple', 'pool', 'redwoods']) {
      await page.evaluate(async w => {
        await bend.world(w);
        for (const d of bend.show.dancers) bend.gates.place(d, w);
        bend.place(0, -0.6, 0.4, Math.PI / 2); bend.place(1, 0.6, 0.4, -Math.PI / 2);
        bend.intent(0, { moveX: 0.4 });
        await bend.kit.ready();
      }, world);
      await wait(2200);
      for (const dress of [['fire', 'water'], ['plasma', 'ice'], ['gems', 'mosaic']]) {
        await page.evaluate(names => { names.forEach((n, i) => bend.dress(i, n)); }, dress);
        await wait(1600);
        const state = await page.evaluate(() => ({ ...bend.stats(), memory: bend.kit.memory(), features: [...bend.kit.features], pipelines: bend.kit.pipelines.length }));
        assert.equal(state.failed, 0, `${scenario.name}/${world}/${dress}: pipelines`);
        assert.deepEqual(state.errors, [], `${scenario.name}/${world}/${dress}: GPU errors`);
        cases.push({ world, dress, render: state.render, memory: state.memory, matter: state.matter, quality: state.quality, pipelines: state.pipelines });
      }
    }
    // Rotation and a very narrow viewport exercise all dynamically sized render targets and portal still copies.
    for (const [width, height] of [[844, 390], [320, 568], [390, 844]]) {
      await page.setViewport({ width, height, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      await wait(1800);
      assert.deepEqual(await page.evaluate(() => bend.stats().errors), [], `${scenario.name}: resize ${width}x${height}`);
    }
    if (scenario.name === 'phone-minimum') {
      const features = await page.evaluate(() => [...bend.kit.features]);
      // Recent Chrome exposes the core feature-level marker even when requiredFeatures is empty.
      assert.deepEqual(features.filter(f => f !== 'core-features-and-limits'), [], 'no optional WebGPU features');
      assert.equal(await page.evaluate(() => bend.device.webkit), true, 'iPhone UA selects serial compilation');
      // Explicit synthetic diagnostics: verify the production banner without needing a real rendering failure.
      await page.evaluate(() => {
        window.__diagnosticClicks = 0;
        document.addEventListener('pointerdown', () => __diagnosticClicks++);
        for (let i = 1; i <= 3; i++) bend.kit.errors.set(`qa-${i}`, { kind: 'test', label: `Synthetic QA ${i}`, message: `Screenshot test ${i}: details remain readable on a phone. <not markup>` });
        bend.kit.overlay.errorsChanged();
      });
      await page.tap('.weft-err-summary');
      assert.match(await page.$eval('.weft-err', e => e.textContent), /Synthetic QA 3/);
      assert.equal(await page.evaluate(() => __diagnosticClicks), 0, 'diagnostics do not trigger game touch input');
      assert.equal(await page.evaluate(() => bend.kit.overlay.open), false, 'details do not enable expensive profiling');
      assert.equal(await page.$eval('.weft-err', e => e.scrollWidth <= e.clientWidth), true, 'details wrap');
      await page.screenshot({ path: `${out}/touch-errors.png` });
      await page.tap('.weft-err [data-copy]');
      await page.waitForFunction(() => document.querySelector('.weft-err [data-copy]').textContent === 'Copied');
      await page.tap('.weft-err [data-dismiss]');
      assert.equal(await page.$('.weft-err'), null, 'close works by touch');
      await page.evaluate(() => { bend.kit.errors.clear(); bend.kit.overlay.errorsChanged(); });
    }
    assert.deepEqual(issues, [], `${scenario.name}: browser errors`);
    results.push({ scenario, cases, issues });
    console.log(`${scenario.name}: ${cases.length} world/material cases, rotation, narrow viewport passed`);
    await page.close();
  }
  writeFileSync(`${out}/results.json`, JSON.stringify({ base, results }, null, 2));
} finally {
  await browser.close();
}
