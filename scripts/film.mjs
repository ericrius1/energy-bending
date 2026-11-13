// The film tool: a timeline (films/<name>.json) rendered shot by shot in short takes, the score muxed in, no text.
//   node scripts/film.mjs films/<name>.json [--preview] [--shot 3 | --shot s03,s04] [--sheet] [--force]
//        [--url http://127.0.0.1:5435/energybending/] [--port 5436] [--take 10] [--only-take 2] [--hevc] [--av1]
//        [--no-encode] [--out docs/reports/media/film]
//   (anything else as the first argument is the older path, a cut of src/engine/film.ts: scripts/film-cut.mjs)
// Each shot is one page (?film&cut=timeline, src/engine/film-shot.ts) that plays the shot from its first frame; the
// frames from its in-point are read back as YUV 4:2:0 and posted here. A shot is cut into takes (`--take` seconds,
// default 10 master, 20 preview): at each take boundary the page pauses, this releases the shared GPU lock
// (C:/Users/ericr/render-lock), takes it again and lets the page go on, so the lock is held under a minute at a time
// and the page (dancers, particles, the music) lives through the whole shot: a seam is the frame that would have come
// anyway. Each take is captured losslessly (x264 qp 0, yuv420p) and cached under <out>/cache/<quality>/<shot hash>/,
// keyed by the shot, the film's settings and a hash of the build (src/, shared/, index.html, the lockfile); a failed
// or changed take is rendered again alone (its page steps through the frames before it without reading them back).
// After the last frame of a shot (the lock released) the page renders its score offline; the film's score is the
// shots' scores laid end to end on the film's time (each shot's starts a few ms before its cut, the last ring fades
// out after it). Then, with no lock held, the takes are joined and encoded: a high-quality H.264 master and a web
// copy (HEVC or AV1 too with --hevc / --av1), or one preview file. --sheet writes a contact sheet per shot
// (docs/reports/media/6-film-<film>-<shot>-sheet.jpg). docs/extending/film.md is the guide.
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { join, resolve, basename, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { CHROME, gpuFlags, takeLock } from './lib/browser.mjs';

const argv = process.argv.slice(2);
if (!argv[0] || !/\.(json|mjs)$/.test(argv[0])) { await import('./film-cut.mjs'); process.exit(0); }

const VALUED = new Set(['url', 'port', 'take', 'shot', 'out', 'only-take', 'cdp', 'variant']);
const opts = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) pos.push(a);
  else if (VALUED.has(a.slice(2))) opts[a.slice(2)] = argv[++i];
  else opts[a.slice(2)] = true;
}
const FILE = resolve(pos[0]);
const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const URL0 = opts.url ?? 'http://127.0.0.1:5435/energybending/';
const PORT = Number(opts.port ?? 5436);
const OUT = resolve(opts.out ?? join(ROOT, 'docs/reports/media/film'));
const MEDIA = join(ROOT, 'docs/reports/media');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const PREVIEW = !!opts.preview;
const log = (...a) => console.log(`[film ${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------------------------------------------------------------- the timeline
const film = FILE.endsWith('.mjs') ? (await import(pathToFileURL(FILE).href)).default : JSON.parse(readFileSync(FILE, 'utf8'));
const NAME = film.name ?? basename(FILE).replace(/\.(json|mjs)$/, '');
const BPM = film.bpm ?? 112;
const Q = PREVIEW
  ? { label: 'preview', size: [960, 540], fps: 30, every: 2, scale: 1, take: 20 }
  : { label: 'master', size: (film.size ?? '1920x1080').split('x').map(Number), fps: film.fps ?? 60, every: 60 / (film.fps ?? 60), scale: film.scale ?? 1.5, take: 10 };
if (opts.take != null) Q.take = Number(opts.take) || Infinity;
const [W, H] = Q.size;
const shots = film.shots.map((s, n) => normalize(s, n));
const pick = opts.shot ? String(opts.shot).split(',').map((x) => shots.find((s) => s.id === x || String(s.n + 1) === x) ?? fail(`no shot ${x}`)) : shots;
function fail(m) { console.error(m); process.exit(1); }

/** a shot with the film's defaults, its length in seconds and frames, and the page it needs */
function normalize(s0, n) {
  const s = { ...(film.defaults ?? {}), ...s0, set: { ...(film.defaults?.set ?? {}), ...(s0.set ?? {}) } };
  s.n = n;
  s.id = s.id ?? `s${String(n + 1).padStart(2, '0')}`;
  s.bpm = BPM;
  if (s.hour != null) s.set = { ...s.set, redwoods: { ...(s.set.redwoods ?? {}), hour: s.hour, dayGoes: false } };
  s.seconds = s.bars != null ? (s.bars * 4 * 60) / BPM : s.beats != null ? (s.beats * 60) / BPM : s.seconds;
  if (!(s.seconds > 0)) fail(`shot ${s.id}: give it bars, beats or seconds`);
  s.mode = s.mode ?? (s.jogo ? 'jogo' : 'play');
  return s;
}
/** the page a shot plays in (main.ts and src/play read these) */
function pageQuery(s) {
  const q = new URLSearchParams();
  if (s.mode === 'jogo') {
    q.set('jogo', 'script'); q.set('script', 'none');
    const brain = (s.cast ?? []).find((c) => c?.brain);
    if (brain) { q.set('partner', brain.brain); if (brain.seed != null) q.set('seed', String(brain.seed)); }
    if (s.lock === false) q.set('free', '');
  } else { q.set('play', ''); q.set('two', ''); }
  q.set('world', s.world ?? 'redwoods');
  const dress = (s.cast ?? []).map((c) => c?.dress ?? 'fire');
  if (dress.length) q.set('dress', dress.join(','));
  for (const [k, v] of Object.entries(s.query ?? {})) q.set(k, String(v));
  return q.toString().replace(/=(&|$)/g, '$1');
}
/** what the page needs of the shot (no node-only fields) */
const shotForPage = (s) => ({ id: s.id, mode: s.mode, bpm: s.bpm, seconds: s.seconds, from: s.from, preroll: s.preroll, seed: s.seed, hud: s.hud, set: s.set, curves: s.curves, forms: s.forms, cues: s.cues, camera: s.camera, yawBase: s.yawBase, music: s.music, wake: s.wake });

// ---------------------------------------------------------------- the build's hash (part of every take's key)
function hashTree(h, dir) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'test') hashTree(h, p); }
    else if (/\.(ts|wgsl|json|js|mjs|html)$/.test(e.name)) { h.update(relative(ROOT, p)); h.update(readFileSync(p)); }
  }
}
const buildHash = (() => {
  const h = createHash('sha1');
  for (const d of ['src', 'shared']) hashTree(h, join(ROOT, d));
  for (const f of ['index.html', 'package-lock.json']) if (existsSync(join(ROOT, f))) h.update(readFileSync(join(ROOT, f)));
  return h.digest('hex').slice(0, 12);
})();
const shotKey = (s) => createHash('sha1').update(JSON.stringify({ shot: shotForPage(s), q: pageQuery(s), W, H, fps: Q.fps, every: Q.every, scale: Q.scale, take: Q.take, build: buildHash, v: opts.variant ?? '' })).digest('hex').slice(0, 16);

// ---------------------------------------------------------------- the plan: which takes each shot still needs
const takeFrames = Number.isFinite(Q.take) ? Math.round(Q.take * Q.fps) : Infinity;
for (const s of shots) {
  s.frames = Math.round(s.seconds * Q.fps);
  s.takes = Math.max(1, Math.ceil(s.frames / takeFrames));
  s.dir = join(OUT, 'cache', Q.label, `${NAME}-${s.id}-${shotKey(s)}`);
  s.takePath = (k) => join(s.dir, `take-${String(k).padStart(3, '0')}.mkv`);
}
log(`${NAME}: ${shots.length} shots, ${shots.reduce((a, s) => a + s.seconds, 0).toFixed(1)} s, ${Q.label} ${W}x${H} @ ${Q.fps} (scale ${Q.scale}), takes of ${Number.isFinite(takeFrames) ? takeFrames : 'all'} frames, build ${buildHash}`);

// ---------------------------------------------------------------- the browser and the sink
let chrome = null, cdpPort = opts.cdp ?? null;
async function browser() {
  if (cdpPort) return;
  cdpPort = String(9500 + Math.floor(Math.random() * 400));
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'energybending-film-'))}`,
    ...gpuFlags(), `--window-size=${W},${H}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => chrome?.kill());
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${cdpPort}/json/version`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
}
/** a page opened over a bare CDP connection: only Runtime is listened to (the console), never the network, which
 *  would keep every posted frame in the browser's memory */
async function openPage(url, onConsole) {
  const v = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') onConsole(m.params.type, m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    else if (m.method === 'Runtime.exceptionThrown') onConsole('error', m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  };
  const send = (method, params, sessionId) => new Promise((ok) => { const i = ++id; waiting.set(i, ok); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const r = await send('Target.createTarget', { url: 'about:blank', width: W, height: H, newWindow: true });
  if (!r.result) throw new Error(`couldn't open a page: ${JSON.stringify(r.error)}`);
  const targetId = r.result.targetId;
  const a = await send('Target.attachToTarget', { targetId, flatten: true });
  const sid = a.result.sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.navigate', { url }, sid);
  return async () => { await send('Target.closeTarget', { targetId }); ws.close(); };
}

/** the current shot's render: what the sink does with what the page posts */
let job = null;
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', '*'); res.end(); return; }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x'), body = Buffer.concat(chunks);
    if (!job) { res.end(); return; }
    job.handle(u.pathname, u.searchParams, body, res).catch((e) => job?.fail(e));
  });
});
await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));

// ---------------------------------------------------------------- the lock
let release = null, heldAt = 0;
const holds = [];
async function lock() { release = await takeLock({ say: log }); heldAt = Date.now(); }
function unlock(what) {
  if (!release) return;
  const s = (Date.now() - heldAt) / 1000;
  holds.push({ what, s });
  log(`lock released after ${s.toFixed(1)} s (${what})`);
  release(); release = null;
}

// ---------------------------------------------------------------- a take's capture (lossless, during the render)
function capture(path) {
  mkdirSync(join(path, '..'), { recursive: true });
  const tags = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
  const p = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${W}x${H}`, '-r', String(Q.fps), ...tags, '-i', '-',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', ...tags, '-f', 'matroska', `${path}.part`], { stdio: ['pipe', 'inherit', 'inherit'] });
  const closed = new Promise((ok) => p.on('close', ok));
  return {
    frames: 0,
    write(buf) { this.frames++; return new Promise((ok) => (p.stdin.write(buf) ? ok() : p.stdin.once('drain', ok))); },
    async end() { p.stdin.end(); await closed; renameSync(`${path}.part`, path); },
  };
}

/** render a shot's takes [k0, k1) (and its score if `audio`) in one page */
async function renderShot(s, k0, k1, audio) {
  const start = k0 * takeFrames, end = Math.min(s.frames, k1 * takeFrames);
  const pauses = [];
  for (let k = 1; k < s.takes; k++) if (k * takeFrames < end) pauses.push(k * takeFrames);
  const plan = { fps: Q.fps, every: Q.every, start, end, total: s.frames, pauses, audio, tail: 2.5 };
  mkdirSync(s.dir, { recursive: true });
  const url = `${URL0}?film&cut=timeline&sink=http://127.0.0.1:${PORT}&w=${W}&h=${H}&scale=${Q.scale}&fps=${Q.fps}&noautores&${pageQuery(s)}`;
  const problems = [];
  let cap = null, take = -1, t0 = Date.now(), info = null, close = null;
  const takeOf = (k) => Math.floor(k / takeFrames);
  const finishTake = async () => { if (cap) { const c = cap; cap = null; await c.end(); log(`  take ${take} of ${s.id}: ${c.frames} frames`); } };
  await lock();
  await browser();
  log(`${s.id}: takes ${k0}…${k1 - 1} of ${s.takes} (frames ${start}…${end - 1} of ${s.frames})${audio ? ' and its score' : ''}`);
  let heard = Date.now();
  const done = new Promise((resolveDone, rejectDone) => {
    // (a page that stops talking for three minutes outside a pause has failed: a hung pipeline, a lost device)
    const dog = setInterval(() => { if (release && Date.now() - heard > 180000) reject(new Error(`${s.id}: the page went quiet`)); }, 5000);
    const resolve = () => { clearInterval(dog); resolveDone(); };
    const reject = (e) => { clearInterval(dog); rejectDone(e); };
    job = {
      fail: (e) => reject(e),
      async handle(path, q, body, res) {
        heard = Date.now();
        if (path === '/shot') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ shot: shotForPage(s), plan })); return; }
        if (path === '/frame') {
          const k = Number(q.get('k'));
          if (body.length !== W * H * 1.5) throw new Error(`a frame of ${body.length} bytes: expected ${W}x${H} YUV 4:2:0`);
          if (takeOf(k) !== take || !cap) { await finishTake(); take = takeOf(k); cap = capture(s.takePath(take)); t0 = Date.now(); }
          await cap.write(body);
          res.end('ok');
          return;
        }
        if (path === '/pause') {
          await finishTake();
          unlock(`${s.id} to frame ${q.get('k')}`);
          await lock();
          heard = Date.now();
          res.end('go');
          return;
        }
        if (path === '/end') { await finishTake(); info = JSON.parse(body.toString()); unlock(`${s.id} done`); res.end('ok'); if (!audio) resolve(); return; }
        if (path === '/audio') { writeFileSync(join(s.dir, 'score.wav'), body); res.end('ok'); return; }
        if (path === '/done') { info = JSON.parse(body.toString()); res.end('ok'); resolve(); return; }
        if (path === '/error') { res.end(); reject(new Error(`the page: ${body.toString()}`)); return; }
        res.end();
      },
    };
  });
  close = await openPage(url, (type, text) => {
    if (/^film:/.test(text)) log(`  ${text}`);
    else if (type === 'error' || type === 'warning') problems.push(`[${type}] ${String(text).slice(0, 300)}`);
  });
  try { await done; }
  finally { job = null; await finishTake().catch(() => {}); unlock(`${s.id} (closing)`); await close?.().catch(() => {}); }
  if (info) writeFileSync(join(s.dir, audio ? 'info.json' : `info-${k0}-${k1}.json`), JSON.stringify({ ...info, problems }, null, 1));
  for (const p of problems.slice(0, 8)) log(`  ${p}`);
  return info;
}

// ---------------------------------------------------------------- render what's missing
const t0 = Date.now();
for (const s of pick) {
  if (opts.force) rmSync(s.dir, { recursive: true, force: true });
  const only = opts['only-take'] != null ? Number(opts['only-take']) : null;
  const missing = [];
  for (let k = 0; k < s.takes; k++) if ((only == null || k === only) && (!existsSync(s.takePath(k)) || only != null)) missing.push(k);
  const needScore = only == null && !existsSync(join(s.dir, 'score.wav'));
  if (!missing.length && !needScore) { log(`${s.id}: cached`); continue; }
  if (!missing.length) { await renderShot(s, s.takes, s.takes, true); continue; }   // the score alone: every frame stepped, none read back
  const k0 = missing[0], k1 = missing[missing.length - 1] + 1;
  await renderShot(s, k0, k1, needScore && k1 === s.takes);
  if (needScore && k1 !== s.takes) await renderShot(s, s.takes, s.takes, true);
}
const renderS = (Date.now() - t0) / 1000;
server.close();
chrome?.kill();
log(`rendered in ${renderS.toFixed(0)} s; lock holds: ${holds.map((h) => h.s.toFixed(0)).join(', ') || 'none'} s (longest ${Math.max(0, ...holds.map((h) => h.s)).toFixed(1)} s)`);
if (opts['no-encode'] || opts['only-take'] != null) process.exit(0);

// ---------------------------------------------------------------- join and encode (no lock held)
const ff = (args) => new Promise((ok, no) => spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' }).on('close', (c) => (c ? no(new Error(`ffmpeg ${c}: ${args.join(' ')}`)) : ok())));
const work = join(OUT, 'work', `${NAME}-${Q.label}`);
mkdirSync(work, { recursive: true });
const list = (files) => files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
// each shot's takes, joined without re-encoding
for (const s of pick) {
  const lf = join(work, `${s.id}.txt`);
  writeFileSync(lf, list([...Array(s.takes).keys()].map((k) => s.takePath(k))));
  s.joined = join(work, `${s.id}.mkv`);
  await ff(['-f', 'concat', '-safe', '0', '-i', lf, '-c', 'copy', s.joined]);
  s.info = existsSync(join(s.dir, 'info.json')) ? JSON.parse(readFileSync(join(s.dir, 'info.json'), 'utf8')) : null;
}
const T = pick.reduce((a, s) => a + s.frames / Q.fps, 0);
const lf = join(work, 'film.txt');
writeFileSync(lf, list(pick.map((s) => s.joined)));
const picture = join(work, 'picture.mkv');
await ff(['-f', 'concat', '-safe', '0', '-i', lf, '-c', 'copy', picture]);

// the score: each shot's laid under its frames, starting a hair before its cut, the one before ringing out after it
const XIN = 0.04, XOUT = film.ringOut ?? 0.45;
const ains = [], parts = [];
let at = 0;
pick.forEach((s, j) => {
  const len = s.frames / Q.fps, wav = join(s.dir, 'score.wav');
  if (s.info && existsSync(wav)) {
    const pre = j ? XIN : 0, post = j < pick.length - 1 ? XOUT : 2;
    const a0 = Math.max(0, s.info.inTime - pre), dur = len + pre + post;
    ains.push('-i', wav);
    const n = ains.length / 2 - 1;
    parts.push(`[${n}:a]atrim=start=${a0.toFixed(4)}:duration=${dur.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${Math.max(pre, 0.005).toFixed(3)},afade=t=out:st=${(len + pre).toFixed(4)}:d=${post.toFixed(3)},adelay=${Math.round(Math.max(0, at - pre) * 1000)}:all=1[a${n}]`);
  } else log(`${s.id}: no score (silence under it)`);
  at += len;
});
const score = join(work, 'score.wav');
if (parts.length) await ff([...ains, '-filter_complex', `${parts.join(';')};${parts.map((_, n) => `[a${n}]`).join('')}amix=inputs=${parts.length}:normalize=0:dropout_transition=0,atrim=duration=${T.toFixed(4)}[a]`, '-map', '[a]', '-c:a', 'pcm_s16le', '-ar', '48000', score]);
else await ff(['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`, '-t', T.toFixed(3), score]);

// fades at the film's ends, then the encodes
const fi = film.fadeIn ?? 0.6, fo = film.fadeOut ?? 1.4;
const vf = `fade=t=in:st=0:d=${fi},fade=t=out:st=${(T - fo).toFixed(3)}:d=${fo}`, af = `afade=t=in:st=0:d=${Math.min(fi, 0.3)},afade=t=out:st=${(T - fo).toFixed(3)}:d=${fo}`;
const tags = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
const outs = [];
const encode = async (file, video, audio, extraVf = '') => {
  const e0 = Date.now();
  await ff(['-i', picture, '-i', score, '-filter_complex', `[0:v]${vf}${extraVf}[v];[1:a]${af}[a]`, '-map', '[v]', '-map', '[a]', '-t', T.toFixed(3), ...video, '-pix_fmt', 'yuv420p', ...tags, ...audio, '-movflags', '+faststart', file]);
  const s = (Date.now() - e0) / 1000;
  outs.push({ file, s, mb: statSync(file).size / 1e6 });
  log(`→ ${relative(ROOT, file)} (${(statSync(file).size / 1e6).toFixed(1)} MB, ${s.toFixed(0)} s to encode)`);
};
const sel = opts.shot ? `-${pick.map((s) => s.id).join('-')}` : '';
if (PREVIEW) await encode(join(OUT, `${NAME}${sel}-preview.mp4`), ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20'], ['-c:a', 'aac', '-b:a', '192k']);
else {
  // the master: x264 slow at crf 14 (visually lossless for this footage), high profile, 2 s GOP; AAC 320k
  await encode(join(OUT, `${NAME}${sel}-master.mp4`), ['-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-profile:v', 'high', '-g', String(Q.fps * 2), '-tune', 'film'], ['-c:a', 'aac', '-b:a', '320k']);
  // the web copy: 1080p at crf 21 capped at 10 Mb/s, AAC 192k
  await encode(join(OUT, `${NAME}${sel}-web.mp4`), ['-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-maxrate', '10M', '-bufsize', '20M', '-profile:v', 'high', '-g', String(Q.fps * 2)], ['-c:a', 'aac', '-b:a', '192k']);
  if (opts.hevc) await encode(join(OUT, `${NAME}${sel}-hevc.mp4`), ['-c:v', 'libx265', '-preset', 'slow', '-crf', '18', '-tag:v', 'hvc1', '-x265-params', 'log-level=error'], ['-c:a', 'aac', '-b:a', '256k']);
  if (opts.av1) await encode(join(OUT, `${NAME}${sel}-av1.mp4`), ['-c:v', 'libsvtav1', '-preset', '5', '-crf', '26'], ['-c:a', 'aac', '-b:a', '256k']);
}

// ---------------------------------------------------------------- contact sheets
if (opts.sheet) {
  for (const s of pick) {
    const n = 12, every = Math.max(1, Math.floor(s.frames / n));
    const file = join(MEDIA, `6-film-${NAME}-${s.id}${PREVIEW ? '' : '-master'}-sheet.jpg`);
    await ff(['-i', s.joined, '-vf', `select='not(mod(n\\,${every}))',scale=480:-1,tile=4x3:padding=4:color=white`, '-frames:v', '1', '-q:v', '3', file]);
    log(`sheet ${relative(ROOT, file)}`);
  }
}
writeFileSync(join(work, 'run.json'), JSON.stringify({ film: NAME, quality: Q.label, size: [W, H], fps: Q.fps, scale: Q.scale, build: buildHash, renderS, holds, outs, shots: pick.map((s) => ({ id: s.id, seconds: s.seconds, frames: s.frames, takes: s.takes, dir: relative(ROOT, s.dir), info: s.info })) }, null, 1));
process.exit(0);
