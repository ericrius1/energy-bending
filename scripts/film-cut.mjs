// Renders a film of the show (a cut of src/engine/film.ts, the older path; scripts/film.mjs runs this when its first
// argument is not a timeline): node scripts/film.mjs <out dir> [--url http://127.0.0.1:5391/energybending/]
//   [--query 'world=redwoods'] [--cut short|showcase|dream|forest] [--seconds 10] [--fps 60] [--scale 1.5]
//   [--size 1280x720] [--quality share|master] [--port 5398] [--cdp <port>] [--keep] [--encoder nvenc]
// The page (?film) plays its own script (src/engine/film.ts) frame by frame at a fixed step and posts every frame
// here as YUV 4:2:0, straight into ffmpeg; the score's WAV (rendered offline, so it is exactly what the frames show)
// comes last and is muxed in: <out>/energybending.mp4. No titles, no captions, no text of any kind.
// It takes the shared render lock for the whole render (docs/PLAN.md, "Shared habits"). The film's page is opened
// over a bare CDP connection with nothing attached to it: a driver like Puppeteer turns on DevTools' network log,
// which keeps every posted frame in the browser process until it runs out of memory.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CHROME, gpuFlags, takeLock } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const VALUED = new Set(['url', 'query', 'cdp', 'seconds', 'fps', 'scale', 'size', 'port', 'encoder', 'cut', 'quality']);
const opts = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) pos.push(a);
  else if (VALUED.has(a.slice(2))) opts[a.slice(2)] = argv[++i];
  else opts[a.slice(2)] = true;
}
const flag = (k, d) => opts[k] ?? d;
const out = resolve(pos[0] ?? 'docs/reports/media/film');
const URL0 = flag('url', 'http://127.0.0.1:5391/energybending/');
const CDP = flag('cdp', null);
const SECONDS = Number(flag('seconds', 10)), FPS = Number(flag('fps', 60)), SCALE = Number(flag('scale', 1.5));
const [W, H] = flag('size', '1280x720').split('x').map(Number);
const CUT = flag('cut', 'short');
const SHARE = flag('quality', 'share') !== 'master';
const kbps = Math.round(3300 * (W * H) / (1280 * 720));
const FINAL = SHARE ? ['-preset', 'slow', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.15)}k`, '-bufsize', `${kbps * 2}k`] : ['-preset', 'slow', '-crf', '16'];
const AUDIO = SHARE ? '160k' : '320k';
const PORT = Number(flag('port', 5398));
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const CAPTURE = flag('encoder', 'x264') === 'nvenc' ? ['-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'constqp', '-qp', '12']
  : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '15'];
mkdirSync(out, { recursive: true });
const raw = join(out, 'frames.mp4'), wavPath = join(out, 'score.wav'), final = join(out, 'energybending.mp4');

const release = await takeLock();

// ---------------------------------------------------------------- the sink
let enc = null, frames = 0, info = null, t0 = Date.now();
const done = new Promise((resolveDone, fail) => {
  http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', '*'); res.end(); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const path = new URL(req.url, 'http://x').pathname;
      if (path === '/frame') {
        if (!enc) {
          if (body.length !== W * H * 1.5) { fail(new Error(`a frame of ${body.length} bytes: expected ${W}×${H} YUV 4:2:0`)); return; }
          console.log(`frames ${W}×${H} yuv420p @ ${FPS}`);
          const tags = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
          enc = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${W}x${H}`, '-r', String(FPS), ...tags, '-i', '-',
            ...CAPTURE, '-pix_fmt', 'yuv420p', ...tags, raw], { stdio: ['pipe', 'inherit', 'inherit'] });
        }
        enc.stdin.write(body, () => res.end('ok'));
        frames++;
        if (frames % 120 === 0) console.log(`${frames} frames · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      } else if (path === '/audio') { writeFileSync(wavPath, body); res.end('ok'); }
      else if (path === '/error') { res.end(); fail(new Error(`the page: ${body.toString()}`)); }
      else if (path === '/done') { info = JSON.parse(body.toString()); res.end('ok'); enc.stdin.end(); enc.on('close', resolveDone); }
      else res.end();
    });
  }).listen(PORT, '127.0.0.1');
});

// ---------------------------------------------------------------- the browser
let port = CDP, own = null;
if (!port) {
  port = String(9500 + Math.floor(Math.random() * 400));
  own = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'energybending-film-'))}`,
    ...gpuFlags(), `--window-size=${W},${H}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => own.kill());
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
}

/** a page opened over a bare CDP connection, with nothing attached to it */
async function openBare(url) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); waiting.delete(m.id); };
  const send = (method, params) => new Promise((ok) => { const i = ++id; waiting.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
  const r = await send('Target.createTarget', { url, width: W, height: H, newWindow: true });
  if (!r.result) throw new Error(`couldn't open the film's page: ${JSON.stringify(r.error)}`);
  return async () => { await send('Target.closeTarget', { targetId: r.result.targetId }); ws.close(); };
}

const sep = URL0.includes('?') ? '&' : '?';
const extra = opts.query ? `&${opts.query}` : '';
t0 = Date.now();
const closeFilm = await openBare(`${URL0}${sep}film&sink=http://127.0.0.1:${PORT}&seconds=${SECONDS}&fps=${FPS}&scale=${SCALE}&w=${W}&h=${H}&cut=${CUT}${extra}`);
try { await done; } catch (e) { console.error(String(e)); own?.kill(); release(); process.exit(1); }
console.log(`${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s; render ${info.width}×${info.height}`);
await closeFilm();
own?.kill();
release();

// ---------------------------------------------------------------- the sound, muxed in (no titles)
const ff = (args) => new Promise((ok, no) => spawn(FFMPEG, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' }).on('close', (c) => (c ? no(new Error(`ffmpeg ${c}`)) : ok())));
const fadeLen = Math.min(1.4, SECONDS / 6);
await ff(['-i', raw, '-i', wavPath, '-filter_complex',
  `[0:v]fade=t=in:st=0:d=0.6,fade=t=out:st=${SECONDS - fadeLen}:d=${fadeLen}[v];[1:a]afade=t=in:st=0:d=0.3,afade=t=out:st=${SECONDS - fadeLen}:d=${fadeLen}[a]`,
  '-map', '[v]', '-map', '[a]', '-t', String(SECONDS), '-c:v', 'libx264', ...FINAL, '-pix_fmt', 'yuv420p',
  '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-c:a', 'aac', '-b:a', AUDIO, '-movflags', '+faststart', final]);
console.log(`→ ${final}`);
if (existsSync(final) && !opts.keep) rmSync(raw);
process.exit(0);
