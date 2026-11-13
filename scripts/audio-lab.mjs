// Listening by measurement: node scripts/audio-lab.mjs [out dir] [--url http://127.0.0.1:5408/energybending/]
//   [--only name,name] [--twice]
// Opens the audio lab page (src/audio/lab, served by the dev server) in headless Chrome, renders every scenario's
// score offline, saves each as a WAV (<out>/<name>.wav, default docs/reports/media/audio, git-ignored) and prints its
// numbers (peak, RMS, crest factor, loudness, clipping, a coarse spectrum), whole and per stretch; all of it also goes
// to <out>/measurements.json. --twice renders `everything` a second time and compares the two files byte for byte
// (the determinism check). No GPU is used (an OfflineAudioContext needs none), so no render lock is taken.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const opts = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) pos.push(a);
  else if (['url', 'only'].includes(a.slice(2))) opts[a.slice(2)] = argv[++i];
  else opts[a.slice(2)] = true;
}
const out = resolve(pos[0] ?? 'docs/reports/media/audio');
const URL0 = opts.url ?? 'http://127.0.0.1:5408/energybending/';
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 0, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') console.log(`  page ${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => console.log(`  page error: ${e.message}`));
await page.goto(`${URL0}src/audio/lab/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.title === 'audio lab: ready', { timeout: 60000 });
const all = await page.evaluate(() => window.lab.scenarios);
const names = opts.only ? opts.only.split(',') : all;

const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);
const results = {};
const row = (name, s) => `${name.padEnd(26)} ${String(s.peakDb).padStart(6)} ${String(s.rmsDb).padStart(6)} ${String(s.crestDb).padStart(5)} ${String(s.lufs).padStart(6)} ${String(s.clipped).padStart(5)}  ${Object.values(s.bands).map((v) => String(v).padStart(6)).join('')}`;
console.log(`${'render / stretch'.padEnd(26)} ${'peak'.padStart(6)} ${'rms'.padStart(6)} ${'crest'.padStart(5)} ${'lufs'.padStart(6)} ${'clip'.padStart(5)}  ${['sub', 'bass', 'mud', 'mid', 'harsh', 'air'].map((b) => b.padStart(6)).join('')}`);
for (const name of names) {
  const t0 = Date.now();
  const r = await page.evaluate((n) => window.lab.render(n), name);
  const bytes = Buffer.from(r.wav, 'base64');
  writeFileSync(join(out, `${name}.wav`), bytes);
  delete r.wav;
  r.sha = sha(bytes);
  r.renderSeconds = (Date.now() - t0) / 1000;
  results[name] = r;
  console.log(row(name, r.stats) + `   (${r.renderSeconds.toFixed(1)} s, loudest 400 ms ${r.loudest.maxRms400Db} dB)`);
  for (const [seg, s] of Object.entries(r.segments)) if (Object.keys(r.segments).length > 1) console.log(row(`  ${seg}`, s));
}
if (opts.twice) {
  const a = await page.evaluate(() => window.lab.render('everything'));
  const b = await page.evaluate(() => window.lab.render('everything'));
  const A = Buffer.from(a.wav, 'base64'), B = Buffer.from(b.wav, 'base64');
  writeFileSync(join(out, 'determinism-a.wav'), A);
  writeFileSync(join(out, 'determinism-b.wav'), B);
  let diff = 0, first = -1;
  for (let i = 44; i < Math.min(A.length, B.length); i += 2) if (A.readInt16LE(i) !== B.readInt16LE(i)) { diff++; if (first < 0) first = i; }
  results.determinism = { a: sha(A), b: sha(B), bytes: A.length, differentSamples: diff, firstDifferenceAt: first < 0 ? null : ((first - 44) / 4 / 48000).toFixed(4) + ' s', census: a.census };
  console.log(`determinism: ${sha(A)} vs ${sha(B)}, ${A.length} bytes, ${diff} samples differ`);
}
writeFileSync(join(out, 'measurements.json'), JSON.stringify(results, null, 1));
await browser.close();
