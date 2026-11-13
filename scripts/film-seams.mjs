// The seam check: is splitting a shot into takes invisible? Renders one shot three ways with scripts/film.mjs and
// compares them frame by frame (the luma plane, 8-bit):
//   A  in takes of --take seconds (one page, paused at each boundary while the lock is released and taken again)
//   B  in one take (one page, never paused)
//   C  take --alone (default 1) on its own: a fresh page that steps through everything before it without reading back
// A against B says whether a pause changes anything; C against A's same take says whether a take rendered alone (a
// re-render after a failure) matches. It also measures each seam as a jump: the difference between the frame before
// and the frame after a boundary, against the same difference between neighbours elsewhere in the shot.
//   node scripts/film-seams.mjs [films/test-seam.json] [--shot jogo] [--take 3] [--alone 1] [--preview] [--url …]
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2), opts = {}, pos = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith('--')) pos.push(a); else if (a === '--preview') opts.preview = true; else opts[a.slice(2)] = argv[++i]; }
const FILE = pos[0] ?? 'films/test-seam.json';
const TAKE = Number(opts.take ?? 3), ALONE = Number(opts.alone ?? 1);
const film = JSON.parse(readFileSync(FILE, 'utf8'));
const shot = opts.shot ?? film.shots[0].id ?? 's01';
const quality = opts.preview ? 'preview' : 'master';
const common = [FILE, '--shot', shot, '--no-encode', ...(opts.preview ? ['--preview'] : []), ...(opts.url ? ['--url', opts.url] : [])];
const run = (args) => { const r = spawnSync('node', ['scripts/film.mjs', ...common, ...args], { stdio: 'inherit' }); if (r.status) process.exit(r.status); };
run(['--take', String(TAKE), '--variant', 'seamA']);
run(['--take', '0', '--variant', 'seamB']);
run(['--take', String(TAKE), '--variant', 'seamC', '--only-take', String(ALONE)]);

// the three caches (the newest directory of each variant for this shot)
const cache = resolve('docs/reports/media/film/cache', quality);
const name = film.name ?? FILE.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
const takesIn = (d) => readdirSync(d).filter((f) => /^take-\d+\.mkv$/.test(f)).sort().map((f) => join(d, f));
/** a variant's cache directory (film.mjs names it <film>-<shot>-<variant>-<key>; the newest if several) */
const dirOf = (variant) => {
  const ds = readdirSync(cache).filter((d) => d.startsWith(`${name}-${shot}-${variant}-`)).map((d) => join(cache, d));
  return ds.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
};
const [W, H] = opts.preview ? [960, 540] : (film.size ?? '1920x1080').split('x').map(Number);
const N = W * H;
/** the luma planes of a list of takes, decoded in order: an array of Buffers, one a frame */
function lumas(files) {
  const out = [];
  for (const f of files) {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 2 ** 33 });
    for (let o = 0; o + N <= r.stdout.length; o += N) out.push(r.stdout.subarray(o, o + N));
  }
  return out;
}
const diff = (a, b) => { let s = 0, m = 0, n = 0; for (let i = 0; i < N; i++) { const d = Math.abs(a[i] - b[i]); s += d; if (d > m) m = d; if (d) n++; } return { mean: s / N, max: m, px: n }; };
const A = { t: takesIn(dirOf('seamA')) }, B = { t: takesIn(dirOf('seamB')) }, C = { t: takesIn(dirOf('seamC')) };
const fa = lumas(A.t), fb = lumas(B.t), fc = lumas(C.t);
const per = fa.length / A.t.length > 0 ? Math.round(TAKE * (opts.preview ? 30 : film.fps ?? 60)) : 0;
const report = { film: name, shot, quality, take: TAKE, frames: { A: fa.length, B: fb.length, C: fc.length } };
// A against B, every frame
let worst = { mean: 0, max: 0, px: 0, at: -1 }, same = 0;
for (let i = 0; i < Math.min(fa.length, fb.length); i++) {
  const d = diff(fa[i], fb[i]);
  if (!d.px) same++;
  if (d.mean > worst.mean || (d.mean === worst.mean && d.max > worst.max)) worst = { ...d, at: i };
}
report.takesVsOneTake = { identicalFrames: same, of: Math.min(fa.length, fb.length), worst };
// C against A's take
const off = ALONE * per;
let worstC = { mean: 0, max: 0, px: 0, at: -1 }, sameC = 0;
for (let i = 0; i < fc.length; i++) {
  const d = diff(fc[i], fa[off + i]);
  if (!d.px) sameC++;
  if (d.mean > worstC.mean) worstC = { ...d, at: off + i };
}
report.aloneVsInTakes = { take: ALONE, identicalFrames: sameC, of: fc.length, worst: worstC };
// the seams as jumps: neighbour difference across each boundary against the shot's median neighbour difference
const nb = [];
for (let i = 1; i < fa.length; i++) nb.push(diff(fa[i - 1], fa[i]).mean);
const sorted = [...nb].sort((x, y) => x - y), median = sorted[Math.floor(sorted.length / 2)], p95 = sorted[Math.floor(sorted.length * 0.95)];
report.seams = [];
for (let k = 1; k < A.t.length; k++) {
  const i = k * per;
  if (i < fa.length) report.seams.push({ frame: i, across: +nb[i - 1].toFixed(3), before: +nb[i - 2].toFixed(3), after: +nb[i].toFixed(3) });
}
report.neighbours = { median: +median.toFixed(3), p95: +p95.toFixed(3), max: +sorted[sorted.length - 1].toFixed(3) };
console.log(JSON.stringify(report, null, 1));
writeFileSync(resolve('docs/reports/media/film', `seams-${name}-${shot}-${quality}.json`), JSON.stringify(report, null, 1));
