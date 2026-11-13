// Dance First server: static site + two-player rooms over WebSocket at /ws (protocol in DESIGN.md).
// Usage: node server.js [port]    (PORT env wins, and then it binds 0.0.0.0 for Railway)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createSession, tick, setPresent, route, publicState } from './shared/rules.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || Number(process.argv[2]) || 5372;
const host = process.env.PORT ? '0.0.0.0' : '127.0.0.1';

const SEATS = 2;              // seats per room (the Jogo rules themselves assume two)
const GRACE_MS = 20000;       // a dropped seat can be reclaimed with its token for this long
const MAX_ROOMS = 500;
const MAX_FRAME = 8192;
const MAX_BAD = 5;            // malformed frames before we drop the client
const HELLO_MS = 10000;       // a socket must say hello within this long
const HEARTBEAT_MS = 15000;
const TICK_MS = 50;
const STATE_EVERY_MS = 1000;   // at least this often
const STATE_DRAIN_MS = 250;    // this often while a power form drains flow

const now = () => Math.round((performance.timeOrigin + performance.now()) * 10) / 10;
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- static files ----------
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm' };
const hidden = new Set(['server.js', 'package.json', 'package-lock.json', 'railway.json', 'test', 'node_modules']);

function serveStatic(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
  if (p === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' }); res.end('ok'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  if (p.endsWith('/')) p += 'index.html';
  const parts = p.split(/[\\/]+/).filter(Boolean);
  const file = path.resolve(root, ...parts);
  const notFound = () => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); };
  if (p.includes('\0') || !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  if (parts.some(s => s.startsWith('.')) || hidden.has(parts[0]) || !types[path.extname(file).toLowerCase()]) return notFound();
  fs.readFile(file, (err, data) => {
    if (err) return notFound();
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

// ---------- rooms ----------
// room: { code, s (rules session), seats: (seat|null)[SEATS], lastState }
// seat: { token, ws|null, graceTimer }
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // A-Z without I and O

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

const sendRaw = (ws, s) => { if (ws && ws.readyState === 1) ws.send(s); };
const send = (ws, msg) => sendRaw(ws, JSON.stringify(msg));
const seatWs = (room, i) => room.seats[i]?.ws;
const others = (room, i) => room.seats.map((s, j) => (j !== i ? s?.ws : null)).filter(Boolean);
const toAll = (room, s) => { for (const seat of room.seats) sendRaw(seat?.ws, s); };

function broadcastState(room) {
  room.lastState = now();
  room.s.changed = false;
  const s = JSON.stringify({ t: 'state', ...publicState(room.s) });
  toAll(room, s);
}

function deliver(room, out) {
  for (const [to, msg] of out) {
    const s = JSON.stringify(msg);
    if (to === 'all') toAll(room, s);
    else sendRaw(seatWs(room, to), s);
  }
}

const evOut = events => events.map(e => ['all', { t: 'ev', ...e }]);

function hello(ws, msg) {
  const badName = x => x != null && (typeof x !== 'string' || x.length > 32);
  if (msg.v !== 2 || (msg.room != null && (typeof msg.room !== 'string' || msg.room.length > 8)) || badName(msg.stage) || badName(msg.world))
    return send(ws, { t: 'error', code: 'bad' });
  let room, seatIdx = -1;
  if (msg.room == null) {
    if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', code: 'full' });
    room = { code: newCode(), s: createSession(msg.stage || 'void', now(), msg.world || null), seats: new Array(SEATS).fill(null), lastState: 0 };
    rooms.set(room.code, room);
    log('room', room.code, room.s.stage, 'created;', rooms.size, 'rooms');
  } else {
    room = rooms.get(msg.room.toUpperCase());
    if (!room) return send(ws, { t: 'error', code: 'gone' });
    if (typeof msg.token === 'string') seatIdx = room.seats.findIndex(s => s && s.token === msg.token);
  }
  let seat;
  if (seatIdx >= 0) {                                   // reclaim
    seat = room.seats[seatIdx];
    clearTimeout(seat.graceTimer); seat.graceTimer = null;
    if (seat.ws && seat.ws !== ws) { seat.ws.df = null; seat.ws.close(4000, 'replaced'); }
  } else {
    seatIdx = room.seats.findIndex(s => !s);
    if (seatIdx < 0) return send(ws, { t: 'error', code: 'full' });
    seat = room.seats[seatIdx] = { token: crypto.randomBytes(12).toString('base64url'), ws: null, graceTimer: null };
  }
  seat.ws = ws;
  ws.df = { room, seat: seatIdx };
  clearTimeout(ws.helloTimer);
  const t = now();
  send(ws, { t: 'joined', room: room.code, seat: seatIdx, stage: room.s.stage, world: room.s.world, token: seat.token, now: t });
  const peers = others(room, seatIdx);
  send(ws, { t: 'peer', present: peers.length > 0 });
  for (const o of peers) send(o, { t: 'peer', present: true });
  deliver(room, evOut(setPresent(room.s, seatIdx, true, t)));
  broadcastState(room);
}

function dropped(ws) {
  const d = ws.df;
  if (!d) return;
  ws.df = null;
  const { room, seat: i } = d, seat = room.seats[i];
  if (!seat || seat.ws !== ws) return;
  seat.ws = null;
  for (const o of others(room, i)) send(o, { t: 'peer', present: false });
  seat.graceTimer = setTimeout(() => {
    if (room.seats[i] !== seat || seat.ws) return;
    room.seats[i] = null;
    const ev = setPresent(room.s, i, false, now());
    if (room.seats.every(x => !x)) { rooms.delete(room.code); log('room', room.code, 'deleted;', rooms.size, 'rooms'); }
    else { deliver(room, evOut(ev)); broadcastState(room); }
  }, GRACE_MS);
}

function onMessage(ws, data, isBinary) {
  let msg;
  try { msg = isBinary ? null : JSON.parse(data.toString()); } catch { msg = null; }
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
    if (++ws.bad >= MAX_BAD) ws.close(1008, 'malformed');
    return;
  }
  if (msg.t === 'ping') return send(ws, { t: 'pong', c: msg.c, s: now() });
  if (msg.t === 'hello') return ws.df ? undefined : hello(ws, msg);
  const d = ws.df;
  if (!d) return;
  const { room, seat } = d;
  if (msg.t === 'pose') { const s = data.toString(); for (const o of others(room, seat)) sendRaw(o, s); return; }
  const r = route(room.s, seat, msg, now());
  deliver(room, r.out);
  if (room.s.changed) broadcastState(room);
}

// ---------- wiring ----------
const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_FRAME });

wss.on('connection', ws => {
  ws.bad = 0; ws.alive = true; ws.df = null;
  ws.helloTimer = setTimeout(() => { if (!ws.df) ws.close(1008, 'no hello'); }, HELLO_MS);
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data, isBinary) => onMessage(ws, data, isBinary));
  ws.on('close', () => { clearTimeout(ws.helloTimer); dropped(ws); });
  ws.on('error', () => {});
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

const ticker = setInterval(() => {
  const t = now();
  for (const room of rooms.values()) {
    const s = room.s;
    deliver(room, evOut(tick(s, t)));
    const every = s.form.some(Boolean) || s.phase === 'fusion' ? STATE_DRAIN_MS : STATE_EVERY_MS;
    if (s.changed || t - room.lastState >= every) broadcastState(room);
  }
}, TICK_MS);

server.listen(port, host, () => log(`Dance First on http://${host}:${port} (ws /ws)`));

function shutdown() {
  clearInterval(heartbeat); clearInterval(ticker);
  for (const ws of wss.clients) ws.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
