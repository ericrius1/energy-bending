// The wire between the room server (server/) and the game's clients (src/net/): every message, as one discriminated
// union each way, and the binary pose frame. The server, the client and the tests all import these types, so a
// message changed here is changed everywhere at once (docs/extending/network.md says how to add one).
//
// Two kinds of frame travel on one WebSocket at /ws:
//   text   JSON, one message per frame, reliable and in order: hello, moves, exchanges, builds, the room's state.
//   binary a pose: 13 landmarks, the root and the yaw of one dancer, 20 times a second (encodePose / decodePose).
//          The server stamps the sender's slot into byte 1 and relays it untouched; nothing else reads it.
//
// Units on the wire: times are the server's clock in ms (Net.now()); positions in the binary pose and in set pieces
// are integer millimetres (a world can be tens of metres across, and a millimetre is below what anyone can see);
// angles in radians in JSON and 1/65536 of a turn in the pose.
//
// Pure TypeScript with no imports: it runs in Node (the server strips the types) and in the browser (Vite).

export const PROTOCOL = 3;
/** seats that play the jogo (the rules are written for two) */
export const SEATS = 2;
/** extra dancers in a room: relayed poses and events, no part in the jogo's meters (a world holds eight dancers) */
export const GUESTS = 6;
/** every slot in a room: 0 and 1 are the jogo's seats, 2..7 guests */
export const SLOTS = SEATS + GUESTS;
/** the largest frame the server accepts from a client (bytes); a pose is about 200 */
export const MAX_FRAME = 8192;
/** the longest stage, world, portal or kind id */
export const NAME_MAX = 32;
/** landmarks in a pose (src/skeleton/landmarks.ts LM): 13 × xyz */
export const NLM = 13;

// ---------------------------------------------------------------- shared shapes
export type Phase = 'waiting' | 'intro' | 'play' | 'fusion' | 'release' | 'finale' | 'over';
export type XchResult = 'dodge' | 'clash' | 'parry' | 'near' | 'hit';
export type FusionKind = 'steam' | 'prism' | 'storm' | 'aurora';
export type V3 = [number, number, number];

/** the music's clock: step 0 at `epoch` (server ms), `bpm`, and a mood the music engine picks its colour from */
export interface MusicClock { epoch: number; bpm: number; mood: number }

/** a fusion in progress or scheduled: its kind and the server times it starts and ends (on bar lines) */
export interface Fusion { kind: FusionKind; t0: number; tEnd: number }

/** who is in a slot: the world it dances in (from hello and travel) and whether it plays the jogo */
export interface SlotInfo { world: string | null; player: boolean; present: boolean }

/**
 * A set piece: matter that has set into a world (an ice bridge, a gem spire, a ledge). The server keeps a short list
 * per room; every client draws them. `points` is a short polyline, flat x, y, z in integer millimetres in the world's
 * frame; `width` is millimetres across it; `t` the server time it set; `life` ms until it expires on its own.
 * `melt` is the server time a melt began (it is gone `RULES.build.MELT_MS` later), or absent.
 */
export interface SetPiece {
  id: string;
  kind: string;
  world: string;
  by: number;
  t: number;
  points: number[];
  width: number;
  life: number;
  melt?: number;
}

export interface Results {
  axe: number; fusions: number; bestStreak: number;
  perfect: [number, number]; dodges: [number, number]; distinct: [number, number];
}

/** the room's state, sent on every change and at least once a second */
export interface PublicState {
  phase: Phase;
  tension: number;
  axe: number;
  streak: number;
  flow: [number, number];
  form: [0 | 1, 0 | 1];
  mergeReady: boolean;
  fusion: Fusion | null;
  stage: string;
  /** the jogo's world: where the two seats play (a seat's travel moves it) */
  world: string | null;
  tEnd: number | null;
  results: Results | null;
  music: MusicClock;
  sessionEnd: number | null;
  merge: [boolean, boolean];
  ready: [boolean, boolean];
  bestStreak: number;
  /** every slot (SLOTS long): null when empty */
  slots: (SlotInfo | null)[];
  /** how many set pieces the room holds, and a counter that changes whenever the list does */
  pieces: number;
  piecesRev: number;
}

// ---------------------------------------------------------------- moves
/**
 * The fields a move's replay may need beyond the start event, all optional. The dancers' agent fills them; the
 * server type-checks and clamps the ones named here and relays any other field untouched.
 */
export interface MoveExtras {
  /** facing at the start (radians; forward is (sin yaw, 0, cos yaw)) */
  yaw?: number;
  /** aim in 3D (metres, world frame, from the root) */
  aim3?: V3;
  /** facing on a locked stage plane (+1 / -1), or a direction on the floor [x, z] */
  fdir?: number | [number, number];
  /** the root's velocity at the start (m/s) */
  vx?: number; vy?: number; vz?: number;
  /** started in the air */
  air?: boolean;
  /** the tempo the move was timed to */
  bpm?: number;
  /** which hand or foot leads: the dancer's own left or right */
  hand?: 'L' | 'R';
}

/** a move as the sender sends it (id is `${slot}-${counter}`; ts the server time it starts) */
export interface MoveMsg extends MoveExtras {
  t: 'move';
  id: string;
  move: string;
  ts?: number;
  x: number; y: number; z?: number;
  /** facing: a number (its sign) or [x, z] */
  dir: number | [number, number];
  perfect?: boolean;
  aim?: [number, number] | V3;
  [extra: string]: unknown;
}

/** a move as it is relayed: sanitised, with the sender's slot */
export interface MoveRelay extends MoveExtras {
  t: 'move';
  from: number;
  id: string;
  move: string;
  ts: number;
  x: number; y: number; z: number;
  dir: number | [number, number];
  perfect: boolean;
  aim?: [number, number] | V3;
  [extra: string]: unknown;
}

// ---------------------------------------------------------------- client to server
export type Role = 'player' | 'guest' | 'any';

export type ClientMsg =
  /** join `room`, or make one (room null: a fresh 4-letter code; `create`: make `room` if it doesn't exist).
   *  `role`: a jogo seat, a guest slot, or whichever is free (seats first). `token` reclaims a slot after a drop. */
  | { t: 'hello'; v: number; room: string | null; create?: boolean; stage?: string; world?: string; token?: string; role?: Role; duel?: DuelHello }
  | { t: 'ping'; c: number }
  | MoveMsg
  /** from the dancer being attacked, about the other seat's move `id` */
  | { t: 'xch'; id: string; res: XchResult }
  | { t: 'form'; on: boolean }
  | { t: 'merge'; held: boolean; dist: number }
  /** cosmetic, relayed to everyone else verbatim */
  | { t: 'fx'; k: string; [extra: string]: unknown }
  | { t: 'ready' }
  /** this dancer went through a portal into `world` */
  | { t: 'travel'; world: string; portal?: string | null }
  /** set matter into the world: from move `move` (on the beat), a polyline in mm, `width` mm, `life` ms */
  | { t: 'build'; move: string; kind: string; points: number[]; width: number; life?: number }
  /** an element is melting (or shattering) a set piece this client can see */
  | { t: 'melt'; id: string }
  | { t: 'shatter'; id: string };

// ---------------------------------------------------------------- server to client
/** `mode`: a duel's hello to a jogo's room or the other way; `duel`: this server cannot run online duels */
export type ErrorCode = 'full' | 'bad' | 'gone' | 'mode' | 'duel';

export type RulesEvent =
  | { k: 'echo' | 'unison'; move: string; ids: [string, string] }
  | { k: 'mergeReady' }
  | ({ k: 'fusion'; finale?: boolean } & Fusion)
  | { k: 'release'; kind: FusionKind; tEnd: number }
  | { k: 'formOff'; seat: number; reason: 'drain' | 'off' }
  | { k: 'travel'; world: string; portal: string | null; by: number }
  | { k: 'set'; piece: SetPiece }
  | { k: 'expire'; id: string; reason: 'life' | 'melt' | 'cap' }
  | { k: 'melt'; id: string; by: number; at: number; tEnd: number }
  | { k: 'shatter'; id: string; by: number };

export interface XchBody {
  id: string; by: number; target: number; res: XchResult; tension: number; axe: number; streak: number; flow: [number, number];
}

export type ServerMsg =
  /** `slot` is this client's place in the room (0..SLOTS-1); `seat` is the same number (the prototype's name);
   *  `player` says whether it is a jogo seat */
  | { t: 'joined'; room: string; slot: number; seat: number; player: boolean; stage: string; world: string | null; token: string; now: number; duel?: DuelWelcome }
  | { t: 'error'; code: ErrorCode; why?: string }
  /** someone came or went; `slot` says who */
  | { t: 'peer'; slot: number; present: boolean; player: boolean }
  | { t: 'pong'; c: number; s: number }
  | ({ t: 'state' } & PublicState)
  | MoveRelay
  | { t: 'no'; id?: string; reason: string; of?: string }
  | ({ t: 'xch' } & XchBody)
  | ({ t: 'ev' } & RulesEvent)
  | { t: 'fx'; from: number; k: string; [extra: string]: unknown }
  /** every set piece in the room: sent once on joining (and on rejoining), then kept up to date by events */
  | { t: 'pieces'; list: SetPiece[] }
  /** an online duel's events of one tick, in order, the same to everyone in the room (DuelTickEvents) */
  | ({ t: 'dev' } & DuelTickEvents)
  /** an online duel's room: who sits, and whether the set is running (sent on every change) */
  | ({ t: 'droom' } & DuelRoomState)
  /** an online duel's rules' state and powers' state, sent whenever they change (the fast numbers ride the snapshots) */
  | ({ t: 'dst' } & DuelSlowState);

export type ServerType = ServerMsg['t'];
export type MsgOf<T extends ServerType> = Extract<ServerMsg, { t: T }>;

// ---------------------------------------------------------------- the binary pose
/**
 * A pose on the wire: what one dancer looks like at one instant. `p` is the 13 landmarks in the dancer's frame
 * (metres; see src/skeleton/landmarks.ts), `root` where that frame's origin is in the world, `yaw` which way it faces.
 */
export interface PoseLike { p: ArrayLike<number>; root: ArrayLike<number>; yaw: number }

/** an earlier snapshot repeated in a pose frame (so a lost frame costs nothing) */
export interface PrevSnap { ts: number; root: V3; yaw: number; p: Float64Array }

/** a decoded pose frame */
export interface PoseFrame {
  slot: number;
  flags: number;
  ts: number;
  root: V3;
  yaw: number;
  energy: number;
  /** the world this dancer is in ('' when the sender didn't say) */
  world: string;
  /** 39 floats, metres */
  p: Float64Array;
  /** the sender's previous snapshots, newest first (0 to MAX_PREV of them) */
  prev: PrevSnap[];
  /** the move in progress: [move id, its start time] */
  move: [string, number] | null;
}

/** pose flag bits the game uses (bits 0..11); the codec owns bits 12..15 */
export const POSE = {
  DODGING: 1, AIRBORNE: 2, BLOCKING: 4, FACING_LEFT: 8, STAGGERED: 16,
  /** the dancer jumped somewhere new (a portal): don't interpolate from where it was */
  TELEPORT: 1 << 12,
  /** codec: a world id follows the landmarks */
  HAS_WORLD: 1 << 13,
  /** codec: a move id and start time follow */
  HAS_MOVE: 1 << 14,
  /** codec: earlier snapshots follow (a count, then each) */
  HAS_PREV: 1 << 15,
  /** the bits the game may set */
  GAME: 0x0fff,
} as const;

const POSE_MAGIC = 0x50;          // 'P'
const HEAD = 28;                  // magic, slot, flags, ts, root, yaw, energy, spare
const BODY = NLM * 3 * 2;         // 39 × int16 millimetres
const PREV = 2 + 6 + 2 + BODY;    // dt (0.1 ms), root delta (int16 mm), yaw, landmarks
/** the most earlier snapshots one frame repeats */
export const MAX_PREV = 3;
const I16 = 32767;
const TURN = 65536 / (2 * Math.PI);
const enc = new TextEncoder();
const dec = new TextDecoder();

const mm16 = (m: number) => Math.max(-I16, Math.min(I16, Math.round((Number.isFinite(m) ? m : 0) * 1000)));
const mm32 = (m: number) => Math.max(-2147483647, Math.min(2147483647, Math.round((Number.isFinite(m) ? m : 0) * 1000)));
const turn16 = (a: number) => (Math.round((Number.isFinite(a) ? a : 0) * TURN) % 65536 + 65536) % 65536;
const fromTurn = (u: number) => { const a = u / TURN; return a > Math.PI ? a - 2 * Math.PI : a; };

/** the size of an encoded pose with `prev` earlier snapshots, a world id and a move */
export function poseBytes(prev = 0, world = '', move: string | null = null) {
  return HEAD + BODY + (prev ? 1 + prev * PREV : 0) + (world ? 1 + enc.encode(world).length : 0) + (move != null ? 1 + enc.encode(move).length + 8 : 0);
}

export interface PoseOut {
  ts: number;
  pose: PoseLike;
  flags?: number;
  energy?: number;
  world?: string;
  /** earlier snapshots to repeat, newest first (those over 6.5 s old, or past MAX_PREV, are left out) */
  prev?: { ts: number; pose: PoseLike }[] | null;
  move?: [string, number] | null;
}

/**
 * One pose into a binary frame: little-endian, 106 bytes, plus 1 + 88 per earlier snapshot, plus the world id and
 * the move when given. Landmarks are int16 mm in the dancer's frame (+-32 m), the root int32 mm in the world (+-2,000 km),
 * the yaw a uint16 fraction of a turn, ts a float64 (server ms to 0.1 ms). An earlier snapshot is its time before
 * this one (0.1 ms), its root's offset from this root (int16 mm) and its own yaw and landmarks.
 */
export function encodePose(o: PoseOut): Uint8Array {
  const world = o.world ? enc.encode(o.world.slice(0, NAME_MAX)) : null;
  const moveId = o.move ? enc.encode(String(o.move[0]).slice(0, NAME_MAX)) : null;
  const ts10 = Math.round(o.ts * 10);
  const prevs = (o.prev ?? []).filter((q) => { const d = ts10 - Math.round(q.ts * 10); return d > 0 && d < 65000; }).slice(0, MAX_PREV);
  const n = HEAD + BODY + (prevs.length ? 1 + prevs.length * PREV : 0) + (world ? 1 + world.length : 0) + (moveId ? 1 + moveId.length + 8 : 0);
  const buf = new Uint8Array(n), v = new DataView(buf.buffer);
  const flags = ((o.flags ?? 0) & POSE.GAME) | ((o.flags ?? 0) & POSE.TELEPORT)
    | (prevs.length ? POSE.HAS_PREV : 0) | (world ? POSE.HAS_WORLD : 0) | (moveId ? POSE.HAS_MOVE : 0);
  const { pose } = o;
  v.setUint8(0, POSE_MAGIC); v.setUint8(1, 255); v.setUint16(2, flags, true);
  v.setFloat64(4, ts10 / 10, true);
  for (let i = 0; i < 3; i++) v.setInt32(12 + i * 4, mm32(pose.root[i]), true);
  v.setUint16(24, turn16(pose.yaw), true);
  v.setUint8(26, Math.max(0, Math.min(255, Math.round(o.energy ?? 0))));
  let at = HEAD;
  for (let j = 0; j < NLM * 3; j++, at += 2) v.setInt16(at, mm16(pose.p[j]), true);
  if (prevs.length) {
    v.setUint8(at++, prevs.length);
    for (const pr of prevs) {
      const q = pr.pose;
      v.setUint16(at, ts10 - Math.round(pr.ts * 10), true); at += 2;
      for (let i = 0; i < 3; i++, at += 2) v.setInt16(at, Math.max(-I16, Math.min(I16, mm32(q.root[i]) - mm32(pose.root[i]))), true);
      v.setUint16(at, turn16(q.yaw), true); at += 2;
      for (let j = 0; j < NLM * 3; j++, at += 2) v.setInt16(at, mm16(q.p[j]), true);
    }
  }
  if (world) { v.setUint8(at++, world.length); buf.set(world, at); at += world.length; }
  if (moveId) {
    v.setUint8(at++, moveId.length); buf.set(moveId, at); at += moveId.length;
    v.setFloat64(at, Number(o.move![1]) || 0, true); at += 8;
  }
  return buf;
}

/** is this a pose frame of a plausible size? (what the server checks before relaying) */
export function isPose(b: Uint8Array) { return b.length >= HEAD + BODY && b.length <= 640 && b[0] === POSE_MAGIC; }

/** the server's one write into a pose: who sent it */
export function stampSlot(b: Uint8Array, slot: number) { b[1] = slot; }

/** a binary frame back into a pose, or null if it isn't one */
export function decodePose(b: Uint8Array): PoseFrame | null {
  if (!isPose(b)) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const flags = v.getUint16(2, true), ts = v.getFloat64(4, true);
  if (!Number.isFinite(ts)) return null;
  const root: V3 = [v.getInt32(12, true) / 1000, v.getInt32(16, true) / 1000, v.getInt32(20, true) / 1000];
  const p = new Float64Array(NLM * 3);
  let at = HEAD;
  for (let j = 0; j < NLM * 3; j++, at += 2) p[j] = v.getInt16(at, true) / 1000;
  const prev: PrevSnap[] = [];
  let world = '', move: PoseFrame['move'] = null;
  try {
    if (flags & POSE.HAS_PREV) {
      const count = v.getUint8(at++);
      if (count < 1 || count > MAX_PREV) return null;
      for (let c = 0; c < count; c++) {
        const dt = v.getUint16(at, true); at += 2;
        const pr: V3 = [0, 0, 0];
        for (let i = 0; i < 3; i++, at += 2) pr[i] = root[i] + v.getInt16(at, true) / 1000;
        const yaw = fromTurn(v.getUint16(at, true)); at += 2;
        const pp = new Float64Array(NLM * 3);
        for (let j = 0; j < NLM * 3; j++, at += 2) pp[j] = v.getInt16(at, true) / 1000;
        prev.push({ ts: (Math.round(ts * 10) - dt) / 10, root: pr, yaw, p: pp });
      }
    }
    if (flags & POSE.HAS_WORLD) { const n = v.getUint8(at++); world = dec.decode(b.subarray(at, at + n)); at += n; }
    if (flags & POSE.HAS_MOVE) {
      const n = v.getUint8(at++); const id = dec.decode(b.subarray(at, at + n)); at += n;
      move = [id, v.getFloat64(at, true)]; at += 8;
    }
  } catch { return null; }        // ran off the end: a truncated frame
  if (at !== b.length) return null;   // short (a string cut off) or with bytes nobody wrote
  return { slot: b[1], flags: flags & (POSE.GAME | POSE.TELEPORT), ts, root, yaw: fromTurn(v.getUint16(24, true)), energy: b[26], world, p, prev, move };
}

// ---------------------------------------------------------------- the duel online (server authoritative)
/**
 * An online duel (docs/extending/network.md, "The duel online"): the room server steps the duel itself, the bodies,
 * the contact, the powers and the rules, at DUEL_NET.TICK_HZ. Each client sends its Intents as numbered inputs
 * (binary 'I' frames, each repeating the last few, so a lost frame costs nothing), the server consumes one per seat
 * per tick and sends every client a snapshot (binary 'S' frames) at SNAP_HZ: both bodies as pose frames (the codec
 * above) with their velocities, which input of the receiver's it has applied (`ack`), and a JSON tail with the rules'
 * state, the link and the powers' effects; and each tick's events as one text message ('dev'), reliable and the same
 * for everyone. Seats 0 and 1 play; slots 2 to 7 watch.
 */
export const DUEL_NET = {
  /** the server's step and the clients' own (one input a tick) */
  TICK_HZ: 60,
  /** snapshots a second (every TICK_HZ / SNAP_HZ ticks) */
  SNAP_HZ: 20,
  /** earlier inputs each input frame repeats */
  REDUNDANT: 3,
  /** inputs waiting at the server for a seat, at most (past it the oldest are merged away: a client running fast) */
  QUEUE_MAX: 10,
  /** how far back the server judges a catch as the catcher saw it (ms), and how far the other may have gone since
   *  (m, from the catcher's hands: the catch's rope then pulls it in) */
  REWIND_MS: 600,
  REWIND_M: 2.2,
};

/** what the first to join a duel's room says it is (the rest are told it in DuelWelcome) */
export interface DuelHello {
  world: string;
  /** each seat's dress (the ?dress= presets) and the matter its powers are (the dress's biggest layer) */
  dress: [string, string];
  matter: [string, string];
  /** locked to the arena's stage plane (&lock), else free in 3D */
  locked: boolean;
  /** a set's length (s) */
  setS?: number;
}
/** a duel's room as the joiner is told it: its hello, the tick's length, when tick 0 was (server ms), the music */
export interface DuelWelcome extends DuelHello {
  setMs: number;
  tickMs: number;
  t0: number;
  music: MusicClock;
}
/** who sits in a duel's room, and the set: `running` once both seats have come (the match then goes on its own clock) */
export interface DuelRoomState { seats: [boolean, boolean]; watchers: number; running: boolean; tick: number }
/** a tick's events (the duel's rules', the contact's, the powers' rules' and their effects' moments), as the server
 *  made them; the client types them (src/net/duel-client.ts) */
export interface DuelTickEvents { n: number; ev?: unknown[]; tc?: unknown[]; pe?: unknown[]; fx?: unknown[] }

/** the rules' state (shared/duel.ts DuelState without its stats and the numbers that change every tick, which the
 *  snapshots carry as `e`) and the powers' rules' state, at tick `n` */
export interface DuelSlowState { n: number; d?: unknown; pw?: unknown; full?: boolean }

/** a seat's thumbs for one tick */
export interface DuelInput {
  seq: number;
  /** the sticks (-1 … 1) and the cartwheel's way (auDir: -1, 0, 1) */
  mx: number; my: number; mz: number; au: number;
  /** DUEL_BTN bits */
  b: number;
  /** the camera's yaw (a free stick is camera-relative) */
  yaw: number;
  /** the bending hand's aim (-1 … 1) */
  ax: number; ay: number;
  /** the server tick (fractional) the sender's screen showed the other body at: a catch is judged there */
  view: number;
}
export const DUEL_BTN = {
  jump: 1, jumpHeld: 2, punch: 4, punchHeld: 8, kick: 16, spin: 32, dodge: 64, dodgeHeld: 128, dash: 256,
  power1: 512, power2: 1024, form: 2048, walk: 4096, aimActive: 8192, flick: 16384,
} as const;

/** the flags a duel body's pose frame carries (the game's bits, beside POSE's) */
export const DUEL_FLAG = {
  AIRBORNE: POSE.AIRBORNE, FACING_LEFT: POSE.FACING_LEFT,
  ON_WALL: 32, HELD: 64, HOLDING: 128, REFORMING: 256, DASHING: 512,
  /** moved by something other than its own thumbs this tick (held, carried or launched by a power, the finale): a
   *  client shows its own body from the server's while this is set */
  CARRIED: 1024,
  /** frozen: the count-in, reforming, the finale (no input reaches the body) */
  FROZEN: 2048,
  /** moved by the other or a power since the last snapshot (a vault off its head, a wave, a catch's rope): its own
   *  player's prediction couldn't know (corrected, and counted apart) */
  PUSHED: 16,
} as const;

/** one body in a snapshot: a pose frame (landmarks in the body's frame, root, yaw, flags, its move) and its motion */
export interface DuelBodySnap {
  seat: number;
  ts: number;
  root: V3;
  yaw: number;
  /** 39 floats, metres, in the body's frame (x its left, y up, z forward: see Character.yaw) */
  p: Float64Array;
  flags: number;
  move: [string, number] | null;
  v: V3;
  /** the height of the ground it last stood on (m), and the retargeter's hints (feet and hands: two bits each) */
  lgy: number;
  style: number;
  /** how hard the body moves (Character.energy, 0 … 1) */
  energy: number;
}
export interface DuelSnap {
  tick: number;
  /** the tick's server time (ms) */
  ts: number;
  /** the receiver's last input applied (seq), or -1 */
  ack: number;
  bodies: DuelBodySnap[];
  /** the JSON tail: the rules' state, the link, the powers (src/net/duel-authority.ts says what) */
  x: Record<string, unknown>;
}

const IN_MAGIC = 0x49;   // 'I'
const SNAP_MAGIC = 0x53; // 'S'
const IN_SIZE = 16;
const i8 = (x: number) => Math.max(-127, Math.min(127, Math.round((Number.isFinite(x) ? x : 0) * 127)));

/** inputs into an input frame (consecutive seqs, oldest first): 6 bytes, then 16 an input */
export function encodeDuelInputs(list: readonly DuelInput[]): Uint8Array {
  const n = Math.min(255, list.length), buf = new Uint8Array(6 + n * IN_SIZE), v = new DataView(buf.buffer);
  v.setUint8(0, IN_MAGIC); v.setUint8(1, n); v.setUint32(2, n ? list[0].seq >>> 0 : 0, true);
  for (let i = 0; i < n; i++) {
    const x = list[i], at = 6 + i * IN_SIZE;
    v.setInt8(at, i8(x.mx)); v.setInt8(at + 1, i8(x.my)); v.setInt8(at + 2, i8(x.mz)); v.setInt8(at + 3, Math.sign(x.au || 0));
    v.setUint16(at + 4, x.b & 0xffff, true); v.setUint16(at + 6, turn16(x.yaw), true);
    v.setFloat32(at + 8, Number.isFinite(x.view) ? x.view : 0, true);
    v.setInt8(at + 12, i8(x.ax)); v.setInt8(at + 13, i8(x.ay));
  }
  return buf;
}
export const isDuelInputs = (b: Uint8Array) => b.length >= 6 && b[0] === IN_MAGIC && b.length === 6 + b[1] * IN_SIZE;
/** an input frame back into inputs, or null */
export function decodeDuelInputs(b: Uint8Array): DuelInput[] | null {
  if (!isDuelInputs(b)) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), n = b[1], seq0 = v.getUint32(2, true), out: DuelInput[] = [];
  for (let i = 0; i < n; i++) {
    const at = 6 + i * IN_SIZE, view = v.getFloat32(at + 8, true);
    out.push({
      seq: seq0 + i, mx: v.getInt8(at) / 127, my: v.getInt8(at + 1) / 127, mz: v.getInt8(at + 2) / 127, au: Math.sign(v.getInt8(at + 3)),
      b: v.getUint16(at + 4, true), yaw: fromTurn(v.getUint16(at + 6, true)), view: Number.isFinite(view) ? view : 0,
      ax: v.getInt8(at + 12) / 127, ay: v.getInt8(at + 13) / 127,
    });
  }
  return out;
}

const cm16 = (x: number) => Math.max(-I16, Math.min(I16, Math.round((Number.isFinite(x) ? x : 0) * 100)));
/** a snapshot into its frame: 19 bytes of header, each body (its pose frame, then velocity cm/s, last ground mm off
 *  the root, style), then the JSON tail (already a string: the server shares it between receivers) */
export function encodeDuelSnap(s: Omit<DuelSnap, 'x'>, tail: string): Uint8Array {
  const poses = s.bodies.map((b) => encodePose({ ts: b.ts, pose: b, flags: b.flags, move: b.move, energy: b.energy * 255 }));
  const json = enc.encode(tail);
  const n = 19 + poses.reduce((a, p) => a + 3 + p.length + 9, 0) + 4 + json.length;
  const buf = new Uint8Array(n), v = new DataView(buf.buffer);
  v.setUint8(0, SNAP_MAGIC); v.setUint8(1, 1);
  v.setUint32(2, s.tick >>> 0, true); v.setInt32(6, s.ack | 0, true); v.setFloat64(10, s.ts, true);
  v.setUint8(18, poses.length);
  let at = 19;
  s.bodies.forEach((b, i) => {
    const P = poses[i];
    v.setUint8(at, b.seat); v.setUint16(at + 1, P.length, true); at += 3;
    buf.set(P, at); at += P.length;
    for (let k = 0; k < 3; k++, at += 2) v.setInt16(at, cm16(b.v[k]), true);
    v.setInt16(at, mm16(b.lgy - b.root[1]), true); at += 2;
    v.setUint8(at++, b.style & 255);
  });
  v.setUint32(at, json.length, true); at += 4;
  buf.set(json, at);
  return buf;
}
export const isDuelSnap = (b: Uint8Array) => b.length >= 23 && b[0] === SNAP_MAGIC;
/** a snapshot frame back, or null */
export function decodeDuelSnap(b: Uint8Array): DuelSnap | null {
  if (!isDuelSnap(b)) return null;
  try {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const tick = v.getUint32(2, true), ack = v.getInt32(6, true), ts = v.getFloat64(10, true), nb = v.getUint8(18);
    let at = 19;
    const bodies: DuelBodySnap[] = [];
    for (let i = 0; i < nb; i++) {
      const seat = v.getUint8(at), len = v.getUint16(at + 1, true); at += 3;
      const f = decodePose(b.subarray(at, at + len)); at += len;
      if (!f) return null;
      const vel: V3 = [v.getInt16(at, true) / 100, v.getInt16(at + 2, true) / 100, v.getInt16(at + 4, true) / 100]; at += 6;
      const lgy = f.root[1] + v.getInt16(at, true) / 1000; at += 2;
      const style = v.getUint8(at++);
      bodies.push({ seat, ts: f.ts, root: f.root, yaw: f.yaw, p: f.p, flags: f.flags, move: f.move, v: vel, lgy, style, energy: f.energy / 255 });
    }
    const jl = v.getUint32(at, true); at += 4;
    if (at + jl !== b.length) return null;
    const x = jl ? JSON.parse(dec.decode(b.subarray(at, at + jl))) : {};
    return { tick, ack, ts, bodies, x: x && typeof x === 'object' ? x : {} };
  } catch { return null; }
}
