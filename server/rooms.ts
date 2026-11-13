// The room server: rooms of up to SLOTS dancers over one WebSocket each at /ws, and a health check at /health (what
// Railway asks). Two slots in a room play the jogo; the rest are guests who dance in the same world. The rules
// (shared/rules.ts) run here and own every meter; this file is only the transport: who is in which room, relaying,
// timers, the reconnect grace, and refusing what is malformed. The protocol is shared/protocol.ts.
//
// Poses are binary frames the server never decodes: it checks the size and the first byte, writes the sender's slot
// into byte 1 and relays the frame to everyone else in the room. Everything else is JSON through rules.route.
//
// The game itself is a static site served elsewhere; this serves no files.
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { PROTOCOL, SEATS, SLOTS, MAX_FRAME, NAME_MAX, isPose, stampSlot, type ClientMsg, type ServerMsg, type Role } from '../shared/protocol.ts';
import { createSession, tick, setPresent, setAway, route, publicState, piecesOf, type Session, type To } from '../shared/rules.ts';

export const SERVER_PARAMS = {
  /** a dropped slot can be reclaimed with its token for this long (ms) */
  GRACE_MS: 20000,
  MAX_ROOMS: 500,
  /** malformed frames before a client is dropped */
  MAX_BAD: 5,
  /** a socket must say hello within this long */
  HELLO_MS: 10000,
  HEARTBEAT_MS: 15000,
  /** the rules tick (timers, the form drain, set pieces expiring) */
  TICK_MS: 50,
  /** state at least this often, and this often while a power form drains or a fusion runs */
  STATE_EVERY_MS: 1000,
  STATE_DRAIN_MS: 250,
  /** poses a socket may send per second before the rest are dropped (20 Hz is the rate; this allows bursts) */
  POSES_PER_S: 40,
};

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // A-Z without I and O
const now = () => Math.round((performance.timeOrigin + performance.now()) * 10) / 10;

interface Seat { token: string; ws: WebSocket | null; graceTimer: ReturnType<typeof setTimeout> | null }
interface Room { code: string; s: Session; slots: (Seat | null)[]; lastState: number }
interface Conn { room: Room; slot: number }
interface Sock { ws: WebSocket; conn: Conn | null; bad: number; alive: boolean; helloTimer: ReturnType<typeof setTimeout> | null; poses: number; poseWindow: number }

export interface RoomServer { port: number; close(): Promise<void>; rooms(): number }

export function startRooms({ port = 5417, host = '127.0.0.1', log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a) } = {}): Promise<RoomServer> {
  const P = SERVER_PARAMS;
  const rooms = new Map<string, Room>();
  const socks = new Map<WebSocket, Sock>();

  function newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
      if (!rooms.has(c)) return c;
    }
  }

  const sendRaw = (ws: WebSocket | null | undefined, data: string | Buffer) => { if (ws && ws.readyState === 1) ws.send(data); };
  const send = (ws: WebSocket | null | undefined, msg: ServerMsg) => sendRaw(ws, JSON.stringify(msg));
  const others = (room: Room, i: number) => room.slots.flatMap((s, j) => (j !== i && s?.ws ? [s.ws] : []));
  const toAll = (room: Room, data: string) => { for (const seat of room.slots) sendRaw(seat?.ws, data); };

  function broadcastState(room: Room) {
    room.lastState = now();
    room.s.changed = false;
    toAll(room, JSON.stringify({ t: 'state', ...publicState(room.s) } satisfies ServerMsg));
  }

  function deliver(room: Room, from: number, out: [To, ServerMsg][]) {
    for (const [to, msg] of out) {
      const data = JSON.stringify(msg);
      if (to === 'all') toAll(room, data);
      else if (to === 'others') for (const ws of others(room, from)) sendRaw(ws, data);
      else sendRaw(room.slots[to]?.ws, data);
    }
  }
  const evOut = (events: object[]): [To, ServerMsg][] => events.map((e) => ['all', { t: 'ev', ...e } as ServerMsg]);

  function hello(sock: Sock, msg: Extract<ClientMsg, { t: 'hello' }>) {
    const { ws } = sock;
    const badName = (x: unknown) => x != null && (typeof x !== 'string' || x.length > NAME_MAX);
    const roomOk = msg.room == null || (typeof msg.room === 'string' && /^[A-Za-z0-9]{3,8}$/.test(msg.room));
    const role: Role = msg.role === 'player' || msg.role === 'guest' ? msg.role : 'any';
    if (msg.v !== PROTOCOL || !roomOk || badName(msg.stage) || badName(msg.world)) return send(ws, { t: 'error', code: 'bad' });
    let room: Room | undefined, slot = -1;
    const code = msg.room?.toUpperCase();
    if (code) room = rooms.get(code);
    if (!room) {
      if (code && !msg.create) return send(ws, { t: 'error', code: 'gone' });
      if (rooms.size >= P.MAX_ROOMS) return send(ws, { t: 'error', code: 'full' });
      room = { code: code ?? newCode(), s: createSession(msg.stage || 'void', now(), msg.world || null), slots: new Array(SLOTS).fill(null), lastState: 0 };
      rooms.set(room.code, room);
      log('room', room.code, room.s.stage, 'created;', rooms.size, 'rooms');
    } else if (typeof msg.token === 'string') slot = room.slots.findIndex((s) => s?.token === msg.token);
    let seat: Seat;
    if (slot >= 0) {                                       // reclaim
      seat = room.slots[slot]!;
      if (seat.graceTimer) clearTimeout(seat.graceTimer);
      seat.graceTimer = null;
      if (seat.ws && seat.ws !== ws) { const old = socks.get(seat.ws); if (old) old.conn = null; seat.ws.close(4000, 'replaced'); }
    } else {
      const free = (a: number, b: number) => { for (let i = a; i < b; i++) if (!room!.slots[i]) return i; return -1; };
      if (role !== 'guest') slot = free(0, SEATS);
      if (slot < 0 && role !== 'player') slot = free(SEATS, SLOTS);
      if (slot < 0) return send(ws, { t: 'error', code: 'full' });
      seat = room.slots[slot] = { token: crypto.randomBytes(12).toString('base64url'), ws: null, graceTimer: null };
    }
    seat.ws = ws;
    sock.conn = { room, slot };
    if (sock.helloTimer) clearTimeout(sock.helloTimer);
    const t = now(), s = room.s, player = slot < SEATS;
    deliver(room, slot, evOut(setPresent(s, slot, true, t, msg.world ?? null)));
    send(ws, { t: 'joined', room: room.code, slot, seat: slot, player, stage: s.stage, world: s.slots[slot]?.world ?? s.world, token: seat.token, now: t });
    send(ws, { t: 'pieces', list: piecesOf(s) });
    for (let j = 0; j < SLOTS; j++) if (j !== slot && room.slots[j]?.ws) send(ws, { t: 'peer', slot: j, present: true, player: j < SEATS });
    for (const o of others(room, slot)) send(o, { t: 'peer', slot, present: true, player });
    broadcastState(room);
  }

  function dropped(sock: Sock) {
    const c = sock.conn;
    if (!c) return;
    sock.conn = null;
    const { room, slot } = c, seat = room.slots[slot];
    if (!seat || seat.ws !== sock.ws) return;
    seat.ws = null;
    for (const o of others(room, slot)) send(o, { t: 'peer', slot, present: false, player: slot < SEATS });
    setAway(room.s, slot);
    seat.graceTimer = setTimeout(() => {
      if (room.slots[slot] !== seat || seat.ws) return;
      room.slots[slot] = null;
      const ev = setPresent(room.s, slot, false, now());
      if (room.slots.every((x) => !x)) { rooms.delete(room.code); log('room', room.code, 'deleted;', rooms.size, 'rooms'); }
      else { deliver(room, slot, evOut(ev)); broadcastState(room); }
    }, P.GRACE_MS);
  }

  function onMessage(sock: Sock, data: RawData, isBinary: boolean) {
    const { ws } = sock;
    if (isBinary) {
      const b = data as Buffer;
      const c = sock.conn;
      if (!Buffer.isBuffer(b) || !isPose(b)) { if (++sock.bad >= P.MAX_BAD) ws.close(1008, 'malformed'); return; }
      if (!c) return;
      const t = performance.now();
      if (t - sock.poseWindow > 1000) { sock.poseWindow = t; sock.poses = 0; }
      if (++sock.poses > P.POSES_PER_S) return;
      stampSlot(b, c.slot);
      for (const o of others(c.room, c.slot)) sendRaw(o, b);
      return;
    }
    let msg: ClientMsg | null;
    try { msg = JSON.parse(data.toString()); } catch { msg = null; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
      if (++sock.bad >= P.MAX_BAD) ws.close(1008, 'malformed');
      return;
    }
    if (msg.t === 'ping') return send(ws, { t: 'pong', c: msg.c, s: now() });
    if (msg.t === 'hello') return sock.conn ? undefined : hello(sock, msg);
    const c = sock.conn;
    if (!c) return;
    const r = route(c.room.s, c.slot, msg, now());
    deliver(c.room, c.slot, r.out);
    if (c.room.s.changed) broadcastState(c.room);
  }

  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' }); res.end('ok'); return; }
    if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(`Energy Bending rooms (protocol ${PROTOCOL}, WebSocket at /ws); ${rooms.size} rooms\n`); return; }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_FRAME });

  wss.on('connection', (ws) => {
    const sock: Sock = { ws, conn: null, bad: 0, alive: true, helloTimer: null, poses: 0, poseWindow: 0 };
    socks.set(ws, sock);
    sock.helloTimer = setTimeout(() => { if (!sock.conn) ws.close(1008, 'no hello'); }, P.HELLO_MS);
    ws.on('pong', () => { sock.alive = true; });
    ws.on('message', (data, isBinary) => onMessage(sock, data, isBinary));
    ws.on('close', () => { if (sock.helloTimer) clearTimeout(sock.helloTimer); dropped(sock); socks.delete(ws); });
    ws.on('error', () => {});
  });

  const heartbeat = setInterval(() => {
    for (const sock of socks.values()) {
      if (!sock.alive) { sock.ws.terminate(); continue; }
      sock.alive = false;
      sock.ws.ping();
    }
  }, P.HEARTBEAT_MS);

  const ticker = setInterval(() => {
    const t = now();
    for (const room of rooms.values()) {
      const s = room.s;
      deliver(room, -1, evOut(tick(s, t)));
      const every = s.form.some(Boolean) || s.phase === 'fusion' ? P.STATE_DRAIN_MS : P.STATE_EVERY_MS;
      if (s.changed || t - room.lastState >= every) broadcastState(room);
    }
  }, P.TICK_MS);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const bound = typeof addr === 'object' && addr ? addr.port : port;
      log(`Energy Bending rooms on http://${host}:${bound} (ws /ws, health /health)`);
      resolve({
        port: bound,
        rooms: () => rooms.size,
        close: () => new Promise<void>((done) => {
          clearInterval(heartbeat); clearInterval(ticker);
          for (const room of rooms.values()) for (const s of room.slots) if (s?.graceTimer) clearTimeout(s.graceTimer);
          for (const ws of wss.clients) ws.terminate();
          wss.close();
          server.close(() => done());
        }),
      });
    });
  });
}
