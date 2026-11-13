// The self-measuring page's server: measure Energy Bending on a device this PC can't run commands on (a Mac, a phone).
//   node scripts/perf-remote.mjs            build (npm run build), pick a free port in 5440..5449, start the server
//                                           detached (it outlives this command and the session that ran it), map it
//                                           tailnet-only over HTTPS (tailscale serve, never Funnel), print the URL
//   node scripts/perf-remote.mjs --no-build the same with the dist/ already there
//   node scripts/perf-remote.mjs --status   is it running, where, what it has received
//   node scripts/perf-remote.mjs --stop     stop the server and remove its tailscale serve mapping (no other mapping)
//   node scripts/perf-remote.mjs --local [--query baseline] [--suite quick] [--scenes a,b] [--device name]
//                                           run the suite here in headless Chrome through the tailnet URL (takes the
//                                           shared render lock only around the measuring run), and wait for its POST
//   node scripts/perf-remote.mjs --serve <port>   (what the detached process runs: the server itself)
// The server binds 127.0.0.1 only: dist/ at /energybending/, and the sink at POST /energybending/__perf, which writes
// each device's run to docs/reports/perf/<device>[-<variant>]-<date>.json (the device: ?device=, else the tailnet name
// of the machine that posted, from `tailscale whois`, else the browser's platform). Partial runs are written as they
// come (done: false) and replaced by the finished one. GET /energybending/__perf lists what has arrived.
// Its state (port, pid) is in <tmp>/perf-remote-energybending.json, its log in <tmp>/perf-remote-<port>.log.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, createReadStream, readdirSync, openSync, rmSync } from 'node:fs';
import { join, extname, resolve, normalize, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'docs/reports/perf');
const BASE = '/energybending/';
const HOST = 'portal-windows.tail4a295a.ts.net';
const PORTS = [5440, 5441, 5442, 5443, 5444, 5445, 5446, 5447, 5448, 5449];
const STATE = join(tmpdir(), 'perf-remote-energybending.json');
const win = process.platform === 'win32';
const TS = win && existsSync('C:/Program Files/Tailscale/tailscale.exe') ? 'C:/Program Files/Tailscale/tailscale.exe' : 'tailscale';

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const readState = () => { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return null; } };
const ts = (...a) => spawnSync(TS, a, { encoding: 'utf8' });
const urlOf = (port, q = '') => `https://${HOST}:${port}${BASE}?perf=${opt('suite', 'default')}&sink=${encodeURIComponent(`https://${HOST}:${port}${BASE}__perf`)}${q ? `&${q}` : ''}`;

if (opt('serve')) serve(Number(opt('serve')));
else if (flag('stop')) stop();
else if (flag('status')) await status();
else if (flag('local')) await local();
else await start();

// ---------------------------------------------------------------- the server (the detached process)
function serve(port) {
  mkdirSync(OUT, { recursive: true });
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
    '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.task': 'application/octet-stream', '.txt': 'text/plain' };
  const received = [];
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (path === `${BASE}__perf` && req.method === 'POST') return sink(req, res);
    if (path === `${BASE}__perf`) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ received, files: readdirSync(OUT).filter((f) => f.endsWith('.json')) }, null, 1)); }
    if (!path.startsWith(BASE)) { res.statusCode = 302; res.setHeader('location', BASE); return res.end(); }
    let file = normalize(join(DIST, path.slice(BASE.length)));
    if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('cache-control', file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600');
    createReadStream(file).pipe(res);
  });
  function sink(req, res) {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= 32 << 20) chunks.push(c); });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.statusCode = 400; return res.end('not JSON'); }
      const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
      const who = whois(ip);
      const device = slug(body.device || who || body.platform || 'device');
      const date = (body.startedAt ?? new Date().toISOString()).slice(0, 10);
      const name = `${device}${body.variant ? `-${slug(body.variant)}` : ''}-${date}.json`;
      body.received = { at: new Date().toISOString(), from: ip, tailnetName: who, userAgent: req.headers['user-agent'], login: req.headers['tailscale-user-login'] ?? null };
      writeFileSync(join(OUT, name), JSON.stringify(body, null, 1));
      const entry = { at: body.received.at, file: name, done: !!body.done, scenes: body.scenes?.length ?? 0, from: who || ip };
      const prev = received.findIndex((r) => r.file === name);
      if (prev >= 0) received[prev] = entry; else received.push(entry);
      log(`${body.done ? 'DONE' : 'partial'} ${name}: ${entry.scenes} scene(s) from ${entry.from}`);
      res.setHeader('content-type', 'text/plain');
      res.end('ok');
    });
  }
  server.listen(port, '127.0.0.1', () => {
    writeFileSync(STATE, JSON.stringify({ port, pid: process.pid, root: ROOT, started: new Date().toISOString(), url: urlOf(port) }, null, 1));
    log(`perf server on http://127.0.0.1:${port}${BASE} (pid ${process.pid}), dist ${DIST}, results to ${OUT}`);
  });
}

const whoisCache = new Map();
function whois(ip) {
  if (!ip || ip.startsWith('127.') || ip === '::1') return '';
  if (whoisCache.has(ip)) return whoisCache.get(ip);
  let name = '';
  try {
    const j = JSON.parse(execFileSync(TS, ['whois', '--json', ip.replace(/^::ffff:/, '')], { encoding: 'utf8', timeout: 5000 }));
    name = (j.Node?.ComputedName || j.Node?.Hostinfo?.Hostname || j.Node?.Name || '').split('.')[0];
  } catch { /* not a tailnet address */ }
  whoisCache.set(ip, name);
  return name;
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'device';

// ---------------------------------------------------------------- start, stop, status
function listening(port) {
  return new Promise((r) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); r(true); });
    s.once('error', () => r(false));
    setTimeout(() => { s.destroy(); r(false); }, 800);
  });
}
function mapped() {
  const out = ts('serve', 'status').stdout ?? '';
  return new Set([...out.matchAll(/ts\.net:(\d+)/g)].map((m) => Number(m[1])));
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

async function start() {
  const st = readState();
  if (st && alive(st.pid) && await listening(st.port)) {
    console.log(`already running (pid ${st.pid}) on port ${st.port}. Stop it first (--stop) to rebuild.`);
    return printUrl(st.port);
  }
  if (!flag('no-build')) {
    console.log('building (npm run build)…');
    const b = spawnSync(win ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: win });
    if (b.status !== 0) { console.error('the build failed'); process.exit(1); }
  }
  if (!existsSync(join(DIST, 'index.html'))) { console.error('no dist/index.html: build first'); process.exit(1); }
  const taken = mapped();
  let port = null;
  for (const p of PORTS) if (!taken.has(p) && !(await listening(p))) { port = p; break; }
  if (!port) { console.error(`no free port in 5440..5449 (serve mappings: ${[...taken].filter((p) => p >= 5440 && p <= 5449).join(', ')})`); process.exit(1); }
  const log = join(tmpdir(), `perf-remote-${port}.log`);
  const node = process.execPath, script = fileURLToPath(import.meta.url);
  if (win) {
    // (through WMI, so the server is no child of this shell: a session's job object ends its children with it)
    const cmd = `cmd /c ""${node}" "${script}" --serve ${port} >> "${log}" 2>&1"`;
    const ps = `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${cmd.replace(/'/g, "''")}'; CurrentDirectory = '${ROOT.replace(/'/g, "''")}' }; $r.ReturnValue`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
    if (r.status !== 0 || r.stdout.trim() !== '0') { console.error('could not start the server:', r.stdout, r.stderr); process.exit(1); }
  } else {
    const { spawn } = await import('node:child_process');
    const fd = openSync(log, 'a');
    spawn(node, [script, '--serve', String(port)], { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd] }).unref();
  }
  for (let i = 0; i < 40 && !(await listening(port)); i++) await new Promise((r) => setTimeout(r, 250));
  if (!(await listening(port))) { console.error(`the server didn't come up: see ${log}`); process.exit(1); }
  const m = ts('serve', '--bg', `--https=${port}`, `http://127.0.0.1:${port}`);
  if (m.status !== 0) { console.error('tailscale serve failed:', m.stdout, m.stderr); process.exit(1); }
  console.log(`server up on 127.0.0.1:${port} (log ${log}); mapped tailnet-only: https://${HOST}:${port}`);
  printUrl(port);
}

function printUrl(port) {
  console.log(`\nOpen on the other device (Chrome with WebGPU, or Safari 26+):\n  ${urlOf(port)}\n`);
  console.log(`Quick suite (about 2.5 min):\n  ${urlOf(port).replace('perf=default', 'perf=quick')}\n`);
  console.log(`Results land in ${OUT}; see what arrived: https://${HOST}:${port}${BASE}__perf`);
  console.log(`Stop: node scripts/perf-remote.mjs --stop   (stops the server, then: tailscale serve --https=${port} off)`);
}

function stop() {
  const st = readState();
  if (!st) { console.log('not running (no state file)'); return; }
  if (alive(st.pid)) { try { process.kill(st.pid); console.log(`stopped pid ${st.pid}`); } catch (e) { console.log(`could not stop pid ${st.pid}: ${e.message}`); } }
  if (win && alive(st.pid)) spawnSync('taskkill', ['/PID', String(st.pid), '/T', '/F']);
  const off = ts('serve', `--https=${st.port}`, 'off');
  console.log(off.status === 0 ? `removed the serve mapping for :${st.port}` : `tailscale serve --https=${st.port} off: ${off.stderr || off.stdout}`);
  rmSync(STATE, { force: true });
}

async function status() {
  const st = readState();
  if (!st) { console.log('not running'); return; }
  console.log(`pid ${st.pid} ${alive(st.pid) ? 'alive' : 'gone'}, port ${st.port} ${await listening(st.port) ? 'listening' : 'not listening'}, mapped: ${mapped().has(st.port)}`);
  printUrl(st.port);
  try { const r = await fetch(`http://127.0.0.1:${st.port}${BASE}__perf`); console.log(await r.text()); } catch { /* down */ }
}

// ---------------------------------------------------------------- a run here, in headless Chrome
async function local() {
  const st = readState();
  if (!st || !(await listening(st.port))) { console.error('the server is not running: node scripts/perf-remote.mjs first'); process.exit(1); }
  const { launch, adapterName, takeLock } = await import('./lib/browser.mjs');
  const extra = [opt('query'), opt('scenes') && `perfscenes=${opt('scenes')}`, `device=${opt('device', 'portal-windows-headless')}`].filter(Boolean).join('&');
  const url = urlOf(st.port, extra);
  const t0 = Date.now();
  const release = await takeLock();
  console.log(`render lock taken; opening ${url}`);
  const browser = await launch({ width: 1280, height: 800, extra: ['--enable-webgpu-developer-features'] });
  try {
    const page = await browser.newPage();
    page.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type())) console.log(`  page ${m.type()}: ${m.text().slice(0, 300)}`); });
    page.on('pageerror', (e) => console.log('  pageerror:', e.message));
    await page.goto(url, { timeout: 120000 });
    let lastSay = '';
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await page.evaluate(() => ({ done: document.body.dataset.perf === 'done', say: document.querySelector('#perf > div')?.textContent ?? '' })).catch(() => ({ done: false, say: '(navigating)' }));
      if (s.say !== lastSay) { console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)} s  ${s.say}`); lastSay = s.say; }
      if (s.done) break;
      if (Date.now() - t0 > 30 * 60e3) throw new Error('the suite took over 30 minutes');
    }
    console.log('adapter:', await adapterName(page));
    console.log(await page.evaluate(() => document.querySelector('#perf')?.innerText ?? ''));
  } finally {
    await browser.close();
    release();
    console.log(`render lock released after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}
