// Every .svg in a folder as a .jpg (headless Chrome): the flow measure's top-down maps of the arenas (report 18-flow).
//   node scripts/svg-shot.mjs <svg dir> <out dir> <prefix> <suffix>  → <out>/<prefix><name><suffix>.jpg
import puppeteer from 'puppeteer-core';
import { CHROME } from './lib/browser.mjs';
import fs from 'node:fs';

const [dir, outDir, prefix = '', suffix = ''] = process.argv.slice(2);
const b = await puppeteer.launch({ headless: true, executablePath: CHROME });
const p = await b.newPage();
await p.setViewport({ width: 720, height: 760 });
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
  await p.setContent(`<html><body style="margin:0">${fs.readFileSync(`${dir}/${f}`, 'utf8')}</body></html>`);
  await p.screenshot({ path: `${outDir}/${prefix}${f.replace('.svg', '')}${suffix}.jpg`, type: 'jpeg', quality: 85 });
}
await b.close();
