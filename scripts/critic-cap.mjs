// The critic's capture helper: a staged scene, frame by frame, as JPEG stills, an MP4 and a contact sheet.
//   node scripts/critic-cap.mjs scripts/steps/critic-<name>.json [--only a,b] [--url URL] [--prefix 5] [--shots shots/x] [--fps 10]
// (--prefix names the media `<prefix>-…` instead of `3-…`, so a re-shoot doesn't overwrite the critic's; --shots is
// where the frames and timings.jsonl go)
// A file is a list of takes. A take: { name, query?, size?: 'WxH', fps?: 30, seconds, setup?: js, cues?: { "<s>": js },
//   each?: js (run every output frame with `t` in seconds), warm?: frames stepped after setup before frame 0,
//   sheet?: { cols, rows, width }, stills?: [seconds…] (kept full size), timings?: true (profiler over 150 frames at the
//   end), timingsAt?: seconds }. js runs in the page with `bend` (async; `t` too in each).
// Frames go to shots/critic/<name>/f0000.jpg…, the film to docs/reports/media/3-film/<name>.mp4 (git-ignored), the sheet
// to docs/reports/media/3-<name>-sheet.jpg and the stills to docs/reports/media/3-<name>-<s>.jpg. The simulation steps
// at 60 Hz whatever the output rate (bend.grab steps one frame itself). Takes the shared render lock, as shot.mjs does.
import { writeFileSync, mkdirSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, adapterName, takeLock } from './lib/browser.mjs';

const argv = process.argv.slice(2), opts = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) pos.push(a);
  else opts[a.slice(2)] = argv[++i];
}
const takes = JSON.parse(readFileSync(pos[0], 'utf8'));
const only = opts.only ? new Set(opts.only.split(',')) : null;
const BASE = opts.url ?? 'http://[::1]:5396/energybending/';
const MEDIA = 'docs/reports/media';
const PRE = opts.prefix ?? '3', SHOTS = opts.shots ?? 'shots/critic';
mkdirSync(join(MEDIA, `${PRE}-film`), { recursive: true });

const release = await takeLock();
let browser = null, size = null;
const problems = [];
try {
  for (const tk of takes) {
    if (only && !only.has(tk.name)) continue;
    const want = tk.size ?? '1280x800';
    if (want !== size) {
      await browser?.close();
      const [w, h] = want.split('x').map(Number);
      browser = await launch({ width: w, height: h, extra: ['--enable-webgpu-developer-features'] });
      size = want;
    }
    const page = await browser.newPage();
    page.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type())) problems.push(`${tk.name} [${m.type()}] ${m.text().slice(0, 300)}`); });
    page.on('pageerror', (e) => problems.push(`${tk.name} [pageerror] ${e.message}`));
    const url = `${BASE}?${[tk.query, 'noautores'].filter(Boolean).join('&')}`;
    const t0 = Date.now();
    await page.goto(url, { timeout: 120000 });
    await page.waitForFunction(() => document.body.classList.contains('ready'), { timeout: 180000, polling: 200 });
    console.log(`${tk.name}: opened ${url} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    await page.evaluate(async (tk) => {
      const k = window.bend.kit; k.manual = true; k.autoRes = null; k.renderScale = 1;
      if (tk.setup) await new Function('bend', `return (async () => { ${tk.setup} })()`)(window.bend);
      await window.bend.step(Math.max(1, tk.warm ?? 0));
    }, tk);
    const dir = join(SHOTS, tk.name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const fps = Number(opts.fps ?? 0) || (tk.fps ?? 30), n = Math.round(tk.seconds * fps), per = Math.max(1, Math.round(60 / fps));
    const cues = Object.entries(tk.cues ?? {}).map(([s, js]) => [Number(s), js]).sort((a, b) => a[0] - b[0]);
    let ci = 0;
    const t1 = Date.now();
    for (let i = 0; i < n; i++) {
      const t = i / fps, due = [];
      while (ci < cues.length && cues[ci][0] <= t + 1e-6) due.push(cues[ci++][1]);
      const jpg = await page.evaluate(async (due, each, t, per) => {
        const B = window.bend;
        for (const js of due) await new Function('bend', `return (async () => { ${js} })()`)(B);
        if (each) await new Function('bend', 't', `return (async () => { ${each} })()`)(B, t);
        if (per > 1) await B.step(per - 1);
        return B.grab('image/jpeg', 0.93);
      }, due, tk.each ?? null, t, per);
      writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(jpg.split(',')[1], 'base64'));
      if (tk.timingsAt !== undefined && Math.abs(t - tk.timingsAt) < 0.5 / fps) await timings(page, tk.name);
    }
    console.log(`${tk.name}: ${n} frames in ${((Date.now() - t1) / 1000).toFixed(0)} s`);
    if (tk.timings) await timings(page, tk.name);
    const st = await page.evaluate(() => { const s = window.bend.stats(); return { failed: s.failed, errors: s.errors, world: s.world }; });
    if (st.failed || st.errors.length) problems.push(`${tk.name} stats ${JSON.stringify(st)}`);
    await page.close();
    // the film, the sheet, the stills
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'f%04d.jpg'), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', join(MEDIA, `${PRE}-film`, `${tk.name}.mp4`)], { stdio: 'inherit' });
    const sh = tk.sheet ?? { cols: 4, rows: 4, width: 480 };
    const every = Math.max(1, Math.floor(n / (sh.cols * sh.rows)));
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(dir, 'f%04d.jpg'), '-vf', `select='not(mod(n\\,${every}))',scale=${sh.width}:-1,tile=${sh.cols}x${sh.rows}:padding=4:color=white`, '-frames:v', '1', '-q:v', '3', join(MEDIA, `${PRE}-${tk.name}-sheet.jpg`)], { stdio: 'inherit' });
    for (const s of tk.stills ?? []) {
      const f = Math.min(n - 1, Math.round(s * fps));
      copyFileSync(join(dir, `f${String(f).padStart(4, '0')}.jpg`), join(MEDIA, `${PRE}-${tk.name}-${String(s).replace('.', 'p')}.jpg`));
    }
  }
  if (browser) { const p = await browser.newPage(); console.log('adapter:', await adapterName(p)); }
} finally {
  await browser?.close();
  release();
}
console.log(`${problems.length} problem(s)`);
for (const p of problems.slice(0, 40)) console.log('  ' + p);

/** GPU ms per pass over 150 stepped frames, appended to shots/critic/timings.jsonl */
async function timings(page, name) {
  const t = await page.evaluate(async () => {
    const k = window.bend.kit;
    k.profiler.force = true;
    for (let i = 0; i < 150; i++) { k.step(1 / 60); if (i % 5 === 0) await k.device.queue.onSubmittedWorkDone(); await new Promise((r) => setTimeout(r, 4)); }
    await k.device.queue.onSubmittedWorkDone();
    return { passes: [...k.profiler.ms].sort((a, b) => b[1] - a[1]), frame: k.profiler.frameMs, render: [...k.size.render] };
  });
  console.log(`  timings ${name}: gpu frame ${t.frame.toFixed(3)} ms at ${t.render.join('x')}; top: ${t.passes.slice(0, 8).map(([l, v]) => `${l} ${v.toFixed(2)}`).join(', ')}`);
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, 'timings.jsonl'), JSON.stringify({ name, ...t }) + '\n', { flag: 'a' });
}
