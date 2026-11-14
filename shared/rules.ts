// The jogo's rules: one room's session, authoritative on the server (server/) and run in the page by LocalNet for
// local play. It owns flow, tension, streak, axé, the power forms, fusion, the phases and their timers, the music
// clock, where each dancer is (its world), and the set pieces: matter that has set into a world. Clients never send
// a meter's value; they send what happened (a move, an exchange, a build) and these functions decide what it is worth.
//
// Ported from the 2D prototype (sketches/dance-first-2d/shared/rules.js, its DESIGN.md "Jogo rules"). What changed:
// a room has SLOTS dancers, not two: seats 0 and 1 play the jogo, guests (2..7) dance in the same world, their moves
// relayed, with no part in the meters; each dancer has its own world (travel moves one dancer; a seat's travel also
// moves the jogo's world); moves keep every extra field for the replay; building (set pieces) is new.
//
// Every handler and tick() returns events [{ k, ... }]; the transport sends each to everyone as { t: 'ev', ...e }.
// s.changed is set whenever something discrete changed (the transport then sends 'state' and clears it); the
// continuous form drain and fusion's tension fall do not set it. Pure: no clock of its own, no I/O.
import {
  SEATS, SLOTS, NAME_MAX,
  type Phase, type Fusion, type FusionKind, type MusicClock, type PublicState, type Results, type RulesEvent,
  type SetPiece, type XchBody, type XchResult, type MoveRelay, type ClientMsg, type ServerMsg, type MoveMsg, type V3,
} from './protocol.ts';
import { trackFor } from './tracks.ts';

export const RULES = {
  SESSION_MS: 180000,       // play time (84 bars at 112 bpm; at any tempo the whole bars nearest it: sessionMs)
  INTRO_MIN_MS: 3000,       // intro is at least this long and ends on a bar line
  // Perfect timing: a move starting within PERFECT_MS of a grid line, the grid being PERFECT_GRID 16ths
  // (1 = 16ths, 2 = 8ths, 4 = beats). At 100-124 bpm 16ths are only 121-150 ms apart, so judging against 16ths
  // would make nearly every move perfect; 8th-note lines are also unaffected by the music's swing of odd 16ths. The
  // client judges (it hears the audio); anything on the server that does must use gridError(music, t).
  PERFECT_GRID: 2,
  PERFECT_MS: 55,
  PARRY_MS: 150,            // a block timed within this of impact is a parry (the client judges)
  BPM: 112,                 // the tempo of a world with no track (a world's track sets its own: tempoOf)
  /** the music's mood per stage (or world); unknown ids hash to 0..MOODS-1 */
  STAGE_MOODS: { void: 0, geode: 0, redwoods: 1, tide: 2, forge: 3 } as Record<string, number>,
  MOODS: 4,
  FUSION_BARS: 8,
  RELEASE_BARS: 1,
  FINALE_BARS: 4,
  FINALE_FUSION_MIN: 50,    // tension at the finale for an automatic last fusion
  MERGE_DIST: 0.5,          // metres between the two roots (the prototype's 0.25 world units were a quarter screen)
  FLOW_MAX: 100,
  FORM_ENTER: 30,           // flow needed to enter the power form
  FORM_DRAIN: 6,            // flow per second while in form; the form ends at 0
  HIT_FLOW_COST: 10,        // flow lost by the dancer who was hit
  PERFECT_FLOW: 1.5,        // flow multiplier for a perfect move
  REPEAT_FLOW: 0.25,        // flow multiplier for the third same move running
  PERFECT_AXE: 3,
  TENSION_MAX: 100,
  STREAK_STEP: 0.1,         // axé multiplier 1 + STREAK_STEP * streak, capped at STREAK_MAX
  STREAK_MAX: 3,
  FUSION_AXE: 2,            // axé multiplier during fusion
  MOVE_GAP_MS: 100,         // at most one move per slot per this long
  MOVE_TTL_MS: 4000,        // an attack can be answered (xch), and a move can set a piece, for this long
  TRAVEL_GAP_MS: 1000,      // at most one travel per slot per this long
  NAME_MAX,                 // max length of stage / world / portal / kind ids
  COORD_MAX: 100000,        // |x|, |y|, |z|, aim and velocity components are clamped to this (metres)
  // attack: can be answered with an xch. flow: flow gained. echo: false to leave out of echo/unison.
  moves: {
    'ginga':    { attack: false, flow: 1, echo: false },
    'meia-lua': { attack: true,  flow: 6 },
    'armada':   { attack: true,  flow: 7 },
    'martelo':  { attack: true,  flow: 5 },
    'bencao':   { attack: true,  flow: 5 },
    'rasteira': { attack: true,  flow: 6 },
    'strike':   { attack: true,  flow: 4 },
    'throw':    { attack: true,  flow: 5 },
    'au':       { attack: false, flow: 5 },
    'macaco':   { attack: false, flow: 6 },
    'role':     { attack: false, flow: 4 },
    'esquiva':  { attack: false, flow: 4 },
    'block':    { attack: false, flow: 2 },
    'spin':     { attack: false, flow: 4 },
    'jump':     { attack: false, flow: 2 },
    // flourishes (sampled CMU clips the brains and a player's "spin with the stick up" reach: src/ai/clips.ts, the
    // pirouette in dancer/play.ts) and the clap: no attack, a little flow, relayed online like any move
    'pirueta':  { attack: false, flow: 2 },
    'giro':     { attack: false, flow: 2 },
    'volta':    { attack: false, flow: 2 },
    'saltos':   { attack: false, flow: 2 },
    'voo':      { attack: false, flow: 2 },
    'tour':     { attack: false, flow: 2 },
    'quebra':   { attack: false, flow: 2 },
    'palmas':   { attack: false, flow: 1, echo: false },
    // the partner's low game and inversions (integration 8, procedural in src/dancer/moves.ts), and the bow to end on
    'negativa':  { attack: false, flow: 4 },
    'cocorinha': { attack: false, flow: 3 },
    'compasso':  { attack: true,  flow: 7 },
    'queda-de-rins': { attack: false, flow: 5 },
    'bow':      { attack: false, flow: 1, echo: false },
  } as Record<string, { attack: boolean; flow: number; echo?: boolean }>,
  // Exchange results, reported by the dancer being attacked. streak: true extends the streak, false resets.
  xch: {
    dodge: { tension: 10, axe: 20, streak: true },
    clash: { tension: 8,  axe: 15, streak: true },
    parry: { tension: 8,  axe: 15, streak: true },
    near:  { tension: 4,  axe: 8,  streak: true },
    hit:   { tension: 2,  axe: 2,  streak: false },
  } as Record<XchResult, { tension: number; axe: number; streak: boolean }>,
  echo:   { tension: 6,  axe: 12 },   // same move by both within one bar
  unison: { tension: 12, axe: 25 },   // same move by both within one 16th
  // fusionKinds[form of seat 0][form of seat 1]; seat 0 fire/plasma, seat 1 water/ice
  fusionKinds: [['steam', 'prism'], ['storm', 'aurora']] as FusionKind[][],
  // Building: matter that lands on the beat sets into the world (docs/PLAN.md "Building").
  build: {
    /** a piece is set from a move whose start was within BEAT_MS of a grid line of GRID 16ths (2: 8th notes) */
    GRID: 2,
    BEAT_MS: 70,
    /** flow it costs: kind.cost × (BASE + PER_M × length in metres + PER_W × width in metres) */
    BASE: 4,
    PER_M: 2,
    PER_W: 4,
    MAX_POINTS: 16,
    MAX_LENGTH_M: 16,
    MIN_WIDTH_MM: 20,
    MAX_WIDTH_MM: 3000,
    /** the longest a piece can last (ms) */
    LIFE_MAX: 10 * 60 * 1000,
    /** a melt takes this long, then the piece is gone */
    MELT_MS: 2500,
    /** caps: pieces per world in a room, and per dancer; past either the oldest goes ('expire', reason 'cap') */
    CAP_WORLD: 64,
    CAP_SLOT: 16,
    /** a melt or shatter report per slot at most this often */
    BREAK_GAP_MS: 100,
    /** may guests build? They have no flow to pay with, so no, unless this is true (then it's free for them) */
    GUESTS: false,
    /** the kinds that can set: cost multiplier, default life (ms), and what the elements can do to them */
    kinds: {
      ice:  { cost: 1,    life: 90000,  melts: true,  shatters: true },
      gems: { cost: 1.25, life: 180000, melts: false, shatters: true },
      /** a ring of flame that stands and lifts (water's 'melt' douses it) */
      fire: { cost: 1, life: 30000, melts: true, shatters: true },
    } as Record<string, { cost: number; life: number; melts: boolean; shatters: boolean }>,
  },
};

// ---------------------------------------------------------------- the session
interface Pending { seat: number; move: MoveRelay; at: number }
interface Recent { id: string; move: string; ts: number; matched: boolean }
interface Slot { world: string | null; player: boolean; present: boolean }

export interface Session {
  stage: string;
  world: string | null;
  music: MusicClock;
  /** per jogo seat: held (connected or within the reconnect grace) */
  present: [boolean, boolean];
  slots: (Slot | null)[];
  lastTick: number;
  phase: Phase;
  tEnd: number | null;
  sessionEnd: number | null;
  tension: number;
  axe: number;
  streak: number;
  bestStreak: number;
  flow: [number, number];
  form: [0 | 1, 0 | 1];
  drainAt: [number, number];
  mergeReady: boolean;
  merge: { held: boolean; dist: number }[];
  fusion: Fusion | null;
  fusionTension: number;
  fusions: number;
  results: Results | null;
  ready: [boolean, boolean];
  pending: Map<string, Pending>;
  /** move ids seen lately (id -> when), so an id can't be used twice */
  used: Map<string, number>;
  /** per slot: the last accepted move, travel, and melt or shatter report (server ms) */
  lastMove: number[];
  lastTravel: number[];
  lastBreak: number[];
  /** moves that may still set a piece: id -> who and when */
  builders: Map<string, { slot: number; ts: number; at: number }>;
  hist: string[][];
  recent: Recent[][];
  perfect: [number, number];
  dodges: [number, number];
  distinct: [Set<string>, Set<string>];
  pieces: SetPiece[];
  piecesRev: number;
  pieceN: number;
  changed: boolean;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const r1 = (x: number) => Math.round(x * 10) / 10;

export const barMs = (music: MusicClock) => (4 * 60000) / music.bpm;
export const stepMs = (music: MusicClock) => 60000 / music.bpm / 4;
export function nextBar(music: MusicClock, t: number) { const b = barMs(music); return music.epoch + Math.ceil((t - music.epoch) / b - 1e-9) * b; }
/** signed ms from server time t to the nearest grid line of `grid` 16ths (RULES.PERFECT_GRID by default) */
export function gridError(music: MusicClock, t: number, grid = RULES.PERFECT_GRID) { const s = stepMs(music) * grid, x = (t - music.epoch) / s; return (x - Math.round(x)) * s; }
/** the music's beat (fractional) at server time t */
export const beatAt = (music: MusicClock, t: number) => ((t - music.epoch) * music.bpm) / 60000;
/** the play time, in whole bars, so the finale starts on a bar line */
export const sessionMs = (music: MusicClock) => Math.round(RULES.SESSION_MS / barMs(music)) * barMs(music);
/** a world's tempo: its track's (shared/tracks.ts), or the rules' */
export const tempoOf = (world: string | null | undefined) => trackFor(world)?.bpm ?? RULES.BPM;

/**
 * The room's world changed (a seat travelled): its music becomes the new world's track, whose bar 1 is the room's next
 * bar line (the new epoch) at the new world's tempo; what was timed on the old grid (the end of play, a fusion, the
 * intro) moves to the new grid's next bar line, so it still lands on one.
 */
export function retempo(s: Session, world: string, now: number) {
  const bpm = tempoOf(world), epoch = Math.round(nextBar(s.music, now));
  const music = { epoch, bpm, mood: s.music.mood };
  const onGrid = (t: number | null) => (t == null || t <= epoch ? t : epoch + Math.ceil((t - epoch) / barMs(music) - 1e-9) * barMs(music));
  s.music = music;
  s.tEnd = onGrid(s.tEnd); s.sessionEnd = onGrid(s.sessionEnd);
  if (s.fusion) { s.fusion.t0 = onGrid(s.fusion.t0)!; s.fusion.tEnd = onGrid(s.fusion.tEnd)!; }
  s.changed = true;
}

function moodFor(stage: string) {
  if (Object.hasOwn(RULES.STAGE_MOODS, stage)) return RULES.STAGE_MOODS[stage];
  let h = 0;
  for (const c of String(stage)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % RULES.MOODS;
}

const name = (x: unknown): string | null => (typeof x === 'string' && x.length > 0 && x.length <= RULES.NAME_MAX ? x : null);
const isSeat = (slot: number) => slot >= 0 && slot < SEATS;
/** how long a used move id is remembered (ids are counters; this only stops a replayed frame) */
const USED_MS = 60000;

/** world (optional) is a free id like stage; it's the jogo's world and where joiners start */
export function createSession(stage: string | null | undefined, nowMs: number, world: string | null = null): Session {
  const st = name(stage) ?? 'void';
  const s = {
    stage: st, world: name(world), music: { epoch: Math.round(nowMs), bpm: tempoOf(name(world) ?? st), mood: moodFor(st) },
    present: [false, false], slots: new Array(SLOTS).fill(null), lastTick: nowMs,
    pieces: [], piecesRev: 0, pieceN: 0, builders: new Map(),
    lastTravel: new Array(SLOTS).fill(-Infinity), lastBreak: new Array(SLOTS).fill(-Infinity),
  } as unknown as Session;
  reset(s);
  return s;
}

/** the jogo starts again (a seat left, or both were ready after 'over'); dancers, worlds and pieces stay */
function reset(s: Session) {
  Object.assign(s, {
    phase: 'waiting', tEnd: null, sessionEnd: null,
    tension: 0, axe: 0, streak: 0, bestStreak: 0, flow: [0, 0], form: [0, 0], drainAt: [0, 0],
    mergeReady: false, merge: [{ held: false, dist: Infinity }, { held: false, dist: Infinity }],
    fusion: null, fusionTension: 0, fusions: 0, results: null, ready: [false, false],
    pending: new Map(), used: new Map(), lastMove: new Array(SLOTS).fill(-Infinity), hist: [[], []], recent: [[], []],
    perfect: [0, 0], dodges: [0, 0], distinct: [new Set(), new Set()], changed: true,
  });
}

const playing = (s: Session) => s.phase === 'play' || s.phase === 'fusion' || s.phase === 'finale';
const fusing = (s: Session) => s.phase === 'fusion' || (s.phase === 'finale' && !!s.fusion);
const axeMult = (s: Session) => (fusing(s) ? RULES.FUSION_AXE : 1);
const kindNow = (s: Session) => RULES.fusionKinds[s.form[0]][s.form[1]];

// Tension rises only outside fusion. Returns events (mergeReady, a scheduled fusion).
function addTension(s: Session, n: number, now: number): RulesEvent[] {
  if (fusing(s)) return [];
  s.tension = Math.min(RULES.TENSION_MAX, s.tension + n);
  const ev: RulesEvent[] = [];
  if (s.tension >= RULES.TENSION_MAX && !s.mergeReady && s.phase === 'play') { s.mergeReady = true; ev.push({ k: 'mergeReady' }); }
  return ev.concat(tryFusion(s, now));
}

function tryFusion(s: Session, now: number): RulesEvent[] {
  if (s.phase !== 'play' || !s.mergeReady || s.fusion) return [];
  const [a, b] = s.merge;
  if (!a.held || !b.held || Math.min(a.dist, b.dist) > RULES.MERGE_DIST) return [];
  const t0 = nextBar(s.music, now);
  if (s.sessionEnd != null && t0 >= s.sessionEnd) return [];     // too late: the finale will fuse instead
  s.fusion = { kind: kindNow(s), t0, tEnd: t0 + RULES.FUSION_BARS * barMs(s.music) };
  s.changed = true;
  return [{ k: 'fusion', ...s.fusion }];
}

function startIntro(s: Session, now: number) {
  s.phase = 'intro'; s.tEnd = nextBar(s.music, now + RULES.INTRO_MIN_MS); s.changed = true;
}

function startFinale(s: Session, t0: number): RulesEvent[] {
  s.phase = 'finale'; s.tEnd = t0 + RULES.FINALE_BARS * barMs(s.music); s.mergeReady = false; s.changed = true;
  if (s.tension >= RULES.FINALE_FUSION_MIN) {
    s.fusion = { kind: kindNow(s), t0, tEnd: s.tEnd };
    s.fusionTension = s.tension; s.fusions++;
    return [{ k: 'fusion', ...s.fusion, finale: true }];
  }
  return [];
}

export function tick(s: Session, now: number): RulesEvent[] {
  s.lastTick = now;
  const ev: RulesEvent[] = [];
  for (const [id, p] of s.pending) if (now - p.at > RULES.MOVE_TTL_MS) s.pending.delete(id);
  for (const [id, b] of s.builders) if (now - b.at > RULES.MOVE_TTL_MS) s.builders.delete(id);
  for (const [id, at] of s.used) if (now - at > USED_MS) s.used.delete(id);
  ev.push(...expirePieces(s, now));
  if (s.phase !== 'waiting' && s.phase !== 'over') {
    for (let i = 0; i < 2; i++) {
      if (!s.form[i]) continue;
      s.flow[i] -= (RULES.FORM_DRAIN * clamp(now - s.drainAt[i], 0, 1000)) / 1000;
      s.drainAt[i] = now;
      if (s.flow[i] <= 0) { s.flow[i] = 0; s.form[i] = 0; s.changed = true; ev.push({ k: 'formOff', seat: i, reason: 'drain' }); }
    }
  }
  const bar = barMs(s.music);
  switch (s.phase) {
    case 'waiting':
      if (s.present[0] && s.present[1]) startIntro(s, now);
      break;
    case 'intro':
      if (now >= s.tEnd!) { s.phase = 'play'; s.sessionEnd = s.tEnd! + sessionMs(s.music); s.tEnd = s.sessionEnd; s.changed = true; }
      break;
    case 'play':
      if (s.fusion && now >= s.fusion.t0) {
        s.phase = 'fusion'; s.tEnd = s.fusion.tEnd; s.mergeReady = false; s.fusionTension = s.tension; s.fusions++; s.changed = true;
      } else if (now >= s.sessionEnd!) ev.push(...startFinale(s, s.sessionEnd!));
      break;
    case 'fusion': {
      const f = s.fusion!;
      s.tension = s.fusionTension * clamp(1 - (now - f.t0) / (f.tEnd - f.t0), 0, 1);
      if (now >= s.tEnd!) {
        s.phase = 'release'; s.tEnd = f.tEnd + RULES.RELEASE_BARS * bar; s.fusion = null; s.tension = 0; s.changed = true;
        ev.push({ k: 'release', kind: f.kind, tEnd: s.tEnd });
      }
      break;
    }
    case 'release':
      if (now >= s.tEnd!) {
        if (s.tEnd! >= s.sessionEnd!) ev.push(...startFinale(s, s.tEnd!));
        else { s.phase = 'play'; s.tEnd = s.sessionEnd; s.changed = true; }
      }
      break;
    case 'finale':
      if (s.fusion) s.tension = s.fusionTension * clamp(1 - (now - s.fusion.t0) / (s.fusion.tEnd - s.fusion.t0), 0, 1);
      if (now >= s.tEnd!) {
        s.phase = 'over'; s.tEnd = null; s.fusion = null; s.form = [0, 0]; s.ready = [false, false]; s.changed = true;
        s.results = {
          axe: Math.round(s.axe), fusions: s.fusions, bestStreak: s.bestStreak,
          perfect: [...s.perfect], dodges: [...s.dodges], distinct: [s.distinct[0].size, s.distinct[1].size],
        };
      }
      break;
    case 'over':
      if (s.ready[0] && s.ready[1]) {
        reset(s);
        if (s.present[0] && s.present[1]) startIntro(s, now);
      }
      break;
  }
  return ev;
}

/**
 * A slot is held (connected, or within its reconnect grace) or released. `world` is where a new dancer starts (the
 * jogo's world if not given). A seat leaving sends the jogo back to waiting; a guest leaving changes nothing else.
 */
export function setPresent(s: Session, slot: number, on: boolean, now: number, world: string | null = null): RulesEvent[] {
  const had = s.slots[slot];
  if (on) {
    if (!had) s.slots[slot] = { world: name(world) ?? s.world ?? s.stage, player: isSeat(slot), present: true };
    else if (had.present) return [];
    else had.present = true;
  } else {
    if (!had) return [];
    s.slots[slot] = null;
  }
  s.changed = true;
  if (!isSeat(slot)) return [];
  s.present[slot] = on;
  if (!on && s.phase !== 'waiting') reset(s);              // partner gone: back to waiting
  return tick(s, now);
}

/** a slot's connection dropped but its grace hasn't run out: it stays in the room, shown as away */
export function setAway(s: Session, slot: number) {
  const x = s.slots[slot];
  if (x && x.present) { x.present = false; s.changed = true; }
}

// ---------------------------------------------------------------- moves
const EXTRA_NUM = ['yaw', 'vx', 'vy', 'vz', 'bpm'] as const;

/**
 * msg: { id, move, ts, x, y, z?, dir, perfect, aim?, ...extras }. dir is a number (sign = facing) or [x, z]; aim has
 * 2 or 3 components. Positions are only type-checked and clamped, never interpreted. The named extras (MoveExtras) are
 * checked the same way and dropped if malformed; any other field is relayed as it came. A guest's move is relayed
 * the same way but scores nothing. On success result.move is the move to relay.
 */
export function onMove(s: Session, slot: number, msg: MoveMsg, now: number):
  { ok: true; move: MoveRelay; events: RulesEvent[] } | { ok: false; reason: string; events: RulesEvent[] } {
  const no = (reason: string) => ({ ok: false as const, reason, events: [] });
  const player = isSeat(slot);
  if (player && !playing(s)) return no('phase');
  if (!msg || typeof msg !== 'object') return no('bad');
  const def = Object.hasOwn(RULES.moves, msg.move) ? RULES.moves[msg.move] : null;
  if (!def) return no('move');
  const id = msg.id;
  if (typeof id !== 'string' || id.length > 32 || !id.startsWith(slot + '-') || s.used.has(id)) return no('id');
  const C = RULES.COORD_MAX, cc = (v: number) => clamp(v, -C, C);
  const pair = (v: unknown, n: number[]) => Array.isArray(v) && n.includes(v.length) && v.every(fin);
  const dirOk = fin(msg.dir) || pair(msg.dir, [2]);
  if (!fin(msg.x) || !fin(msg.y) || (msg.z != null && !fin(msg.z)) || !dirOk) return no('bad');
  if (now - s.lastMove[slot] < RULES.MOVE_GAP_MS) return no('rate');
  s.lastMove[slot] = now;
  s.used.set(id, now);

  // everything the sender put in, then the checked fields over it (unknown fields pass untouched)
  const rest: Record<string, unknown> = { ...msg };
  delete rest.t; delete rest.from;
  const move = {
    ...rest, t: 'move', from: slot,
    id, move: msg.move, ts: fin(msg.ts) ? clamp(msg.ts, now - 1000, now + 100) : now,
    x: cc(msg.x), y: cc(msg.y), z: fin(msg.z) ? cc(msg.z) : 0,
    dir: Array.isArray(msg.dir) ? (msg.dir.map(cc) as [number, number]) : cc(msg.dir), perfect: !!msg.perfect,
  } as MoveRelay;
  delete move.aim;
  if (pair(msg.aim, [2, 3])) move.aim = (msg.aim as number[]).map(cc) as V3;
  for (const k of EXTRA_NUM) { if (k in move && !fin(move[k])) delete move[k]; else if (fin(move[k])) move[k] = cc(move[k]!); }
  if ('aim3' in move) { if (pair(move.aim3, [3])) move.aim3 = move.aim3!.map(cc) as V3; else delete move.aim3; }
  if ('fdir' in move) { if (fin(move.fdir)) move.fdir = Math.sign(move.fdir); else if (pair(move.fdir, [2])) move.fdir = (move.fdir as number[]).map(cc) as [number, number]; else delete move.fdir; }
  if ('air' in move && typeof move.air !== 'boolean') delete move.air;
  if ('hand' in move && move.hand !== 'L' && move.hand !== 'R') delete move.hand;
  if (move.bpm != null && (move.bpm <= 0 || move.bpm > 400)) delete move.bpm;
  s.builders.set(id, { slot, ts: move.ts, at: now });
  if (!player) return { ok: true, move, events: [] };

  // flow
  const h = s.hist[slot], repeat = h.length >= 2 && h[h.length - 1] === move.move && h[h.length - 2] === move.move;
  h.push(move.move); if (h.length > 2) h.shift();
  const gain = def.flow * (move.perfect ? RULES.PERFECT_FLOW : 1) * (repeat ? RULES.REPEAT_FLOW : 1);
  s.flow[slot] = Math.min(RULES.FLOW_MAX, s.flow[slot] + gain);
  s.distinct[slot].add(move.move);
  if (move.perfect) { s.perfect[slot]++; s.axe += RULES.PERFECT_AXE * axeMult(s); }
  if (def.attack) s.pending.set(id, { seat: slot, move, at: now });
  s.changed = true;

  // echo / unison against the other dancer's recent moves
  const ev: RulesEvent[] = [], bar = barMs(s.music), step = stepMs(s.music);
  for (const r of s.recent) while (r.length && move.ts - r[0].ts > bar) r.shift();
  if (def.echo !== false) {
    const other = s.recent[1 - slot], o = other.find((x) => !x.matched && x.move === move.move && Math.abs(x.ts - move.ts) <= bar);
    if (o) {
      o.matched = true;
      const k = Math.abs(o.ts - move.ts) <= step ? 'unison' : 'echo', r = RULES[k];
      s.axe += r.axe * axeMult(s);
      ev.push({ k, move: move.move, ids: slot === 0 ? [id, o.id] : [o.id, id] }, ...addTension(s, r.tension, now));
    } else s.recent[slot].push({ id, move: move.move, ts: move.ts, matched: false });
  }
  return { ok: true, move, events: ev };
}

/** msg: { id, res } from the dancer being attacked. result is the 'xch' body (without t) */
export function onExchange(s: Session, seat: number, msg: { id?: unknown; res?: unknown }, now: number):
  { ok: true; result: XchBody; events: RulesEvent[] } | { ok: false; reason: string; events: RulesEvent[] } {
  const no = (reason: string) => ({ ok: false as const, reason, events: [] });
  if (!isSeat(seat)) return no('seat');
  if (!playing(s)) return no('phase');
  if (!msg || typeof msg.id !== 'string' || !s.pending.has(msg.id)) return no('unknown');
  const p = s.pending.get(msg.id)!;
  if (seat === p.seat) return no('seat');
  const res = msg.res as XchResult;
  const x = typeof res === 'string' && Object.hasOwn(RULES.xch, res) ? RULES.xch[res] : null;
  if (!x) return no('bad');
  s.pending.delete(msg.id);
  if (x.streak) { s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak); }
  else { s.streak = 0; s.flow[seat] = Math.max(0, s.flow[seat] - RULES.HIT_FLOW_COST); }
  if (res === 'dodge') s.dodges[seat]++;
  s.axe += x.axe * Math.min(RULES.STREAK_MAX, 1 + RULES.STREAK_STEP * s.streak) * axeMult(s);
  const ev = addTension(s, x.tension, now);
  s.changed = true;
  const result: XchBody = { id: msg.id, by: p.seat, target: seat, res, tension: r1(s.tension), axe: Math.round(s.axe), streak: s.streak, flow: [r1(s.flow[0]), r1(s.flow[1])] };
  return { ok: true, result, events: ev };
}

export function onForm(s: Session, seat: number, on: boolean, now: number) {
  if (!isSeat(seat) || s.phase === 'waiting' || s.phase === 'over') return { ok: false, reason: 'phase', events: [] as RulesEvent[] };
  if (on) {
    if (s.form[seat]) return { ok: true, events: [] as RulesEvent[] };
    if (s.flow[seat] < RULES.FORM_ENTER) return { ok: false, reason: 'flow', events: [] as RulesEvent[] };
    s.form[seat] = 1; s.drainAt[seat] = now; s.changed = true;
    return { ok: true, events: [] as RulesEvent[] };
  }
  if (!s.form[seat]) return { ok: true, events: [] as RulesEvent[] };
  s.form[seat] = 0; s.changed = true;
  return { ok: true, events: [{ k: 'formOff', seat, reason: 'off' }] as RulesEvent[] };
}

export function onMerge(s: Session, seat: number, held: boolean, dist: unknown, now: number) {
  if (!isSeat(seat)) return { ok: false, events: [] as RulesEvent[] };
  const m = s.merge[seat], d = fin(dist) && dist >= 0 ? dist : Infinity;
  if (m.held !== !!held) s.changed = true;
  m.held = !!held; m.dist = d;
  return { ok: true, events: tryFusion(s, now) };
}

/** a dancer went through a portal: its world changes (a seat's also moves the jogo's world); 1 per second per slot */
export function onTravel(s: Session, slot: number, msg: { world?: unknown; portal?: unknown }, now: number) {
  const world = name(msg?.world), portal = msg?.portal == null ? null : name(msg.portal);
  const no = (reason: string) => ({ ok: false, reason, events: [] as RulesEvent[] });
  const sl = s.slots[slot];
  if (!world || (msg.portal != null && !portal)) return no('bad');
  if (now - s.lastTravel[slot] < RULES.TRAVEL_GAP_MS) return no('rate');
  s.lastTravel[slot] = now;
  if (sl) sl.world = world;
  if (isSeat(slot) && s.world !== world) { s.world = world; if (tempoOf(world) !== s.music.bpm || trackFor(world)) retempo(s, world, now); }
  s.changed = true;
  return { ok: true, events: [{ k: 'travel', world, portal, by: slot }] as RulesEvent[] };
}

export function onReady(s: Session, seat: number, now: number) {
  if (!isSeat(seat) || s.phase !== 'over' || s.ready[seat]) return { ok: false, events: [] as RulesEvent[] };
  s.ready[seat] = true; s.changed = true;
  return { ok: true, events: tick(s, now) };
}

// ---------------------------------------------------------------- building
/** a polyline's length in metres (points in mm, flat xyz) */
export function pieceLength(points: readonly number[]) {
  let L = 0;
  for (let i = 3; i + 2 < points.length; i += 3) L += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2], points[i + 2] - points[i - 1]);
  return L / 1000;
}

/** what a piece of this kind, polyline and width (mm) costs in flow */
export function pieceCost(kind: string, points: readonly number[], width: number) {
  const B = RULES.build, k = B.kinds[kind];
  return k ? k.cost * (B.BASE + B.PER_M * pieceLength(points) + (B.PER_W * width) / 1000) : Infinity;
}

const pieceEnd = (p: SetPiece) => (p.melt != null ? Math.min(p.t + p.life, p.melt + RULES.build.MELT_MS) : p.t + p.life);

function dropPiece(s: Session, i: number) { s.pieces.splice(i, 1); s.piecesRev++; s.changed = true; }

function expirePieces(s: Session, now: number): RulesEvent[] {
  const ev: RulesEvent[] = [];
  for (let i = s.pieces.length - 1; i >= 0; i--) {
    const p = s.pieces[i];
    if (now >= pieceEnd(p)) { dropPiece(s, i); ev.push({ k: 'expire', id: p.id, reason: p.melt != null && p.melt + RULES.build.MELT_MS <= p.t + p.life ? 'melt' : 'life' }); }
  }
  return ev;
}

/**
 * Set a piece of matter into the world. msg: { move, kind, points, width, life? }: `move` is the id of one of this
 * dancer's moves from the last MOVE_TTL_MS (one piece per move), which must have started on the beat (RULES.build.GRID
 * and BEAT_MS); the dancer's flow must pay pieceCost (guests can't build unless RULES.build.GUESTS). The piece sets in
 * the dancer's own world. Past a cap the oldest piece (of that world, or of that dancer) expires.
 */
export function onBuild(s: Session, slot: number, msg: { move?: unknown; kind?: unknown; points?: unknown; width?: unknown; life?: unknown }, now: number):
  { ok: true; piece: SetPiece; events: RulesEvent[] } | { ok: false; reason: string; events: RulesEvent[] } {
  const B = RULES.build, no = (reason: string) => ({ ok: false as const, reason, events: [] });
  const player = isSeat(slot);
  if (!player && !B.GUESTS) return no('guest');
  if (player && !playing(s)) return no('phase');
  const kind = typeof msg.kind === 'string' && Object.hasOwn(B.kinds, msg.kind) ? msg.kind : null;
  if (!kind) return no('kind');
  const from = typeof msg.move === 'string' ? s.builders.get(msg.move) : undefined;
  if (!from || from.slot !== slot) return no('move');
  if (Math.abs(gridError(s.music, from.ts, B.GRID)) > B.BEAT_MS) return no('beat');
  const pts = msg.points, C = RULES.COORD_MAX * 1000;
  if (!Array.isArray(pts) || pts.length < 3 || pts.length % 3 || pts.length > 3 * B.MAX_POINTS || !pts.every((v) => fin(v) && Math.abs(v) <= C)) return no('bad');
  const points = pts.map(Math.round);
  if (!fin(msg.width)) return no('bad');
  const width = clamp(Math.round(msg.width), B.MIN_WIDTH_MM, B.MAX_WIDTH_MM);
  if (pieceLength(points) > B.MAX_LENGTH_M) return no('long');
  const cost = player ? pieceCost(kind, points, width) : 0;
  if (player && s.flow[slot] < cost) return no('flow');
  const life = clamp(fin(msg.life) ? Math.round(msg.life) : B.kinds[kind].life, 1000, B.LIFE_MAX);
  s.builders.delete(msg.move as string);
  if (player) s.flow[slot] -= cost;
  const world = s.slots[slot]?.world ?? s.world ?? s.stage;
  const piece: SetPiece = { id: `p${++s.pieceN}`, kind, world, by: slot, t: Math.round(now), points, width, life };
  const ev: RulesEvent[] = [];
  // caps: the oldest goes first (pieces are kept in the order they set)
  const over = (pred: (p: SetPiece) => boolean, cap: number) => {
    let n = s.pieces.filter(pred).length;
    for (let i = 0; i < s.pieces.length && n >= cap; ) {
      if (pred(s.pieces[i])) { ev.push({ k: 'expire', id: s.pieces[i].id, reason: 'cap' }); dropPiece(s, i); n--; } else i++;
    }
  };
  over((p) => p.world === world, B.CAP_WORLD);
  over((p) => p.by === slot, B.CAP_SLOT);
  s.pieces.push(piece);
  s.piecesRev++;
  s.changed = true;
  ev.push({ k: 'set', piece });
  return { ok: true, piece, events: ev };
}

/** an element melts (`how` 'melt') or shatters a piece; reported by any dancer in the piece's world */
export function onBreak(s: Session, slot: number, how: 'melt' | 'shatter', msg: { id?: unknown }, now: number): { ok: boolean; reason?: string; events: RulesEvent[] } {
  const B = RULES.build, no = (reason: string) => ({ ok: false, reason, events: [] as RulesEvent[] });
  const sl = s.slots[slot];
  const i = s.pieces.findIndex((p) => p.id === msg?.id);
  if (i < 0) return no('unknown');
  const p = s.pieces[i], kind = B.kinds[p.kind];
  if (sl && sl.world !== p.world) return no('world');
  if (now - s.lastBreak[slot] < B.BREAK_GAP_MS) return no('rate');
  if (how === 'melt' ? !kind?.melts || p.melt != null : !kind?.shatters) return no('kind');
  s.lastBreak[slot] = now;
  if (how === 'shatter') { dropPiece(s, i); return { ok: true, events: [{ k: 'shatter', id: p.id, by: slot }] as RulesEvent[] }; }
  p.melt = Math.round(now); s.piecesRev++; s.changed = true;
  return { ok: true, events: [{ k: 'melt', id: p.id, by: slot, at: p.melt, tEnd: pieceEnd(p) }] as RulesEvent[] };
}

// ---------------------------------------------------------------- what everyone sees
export function publicState(s: Session): PublicState {
  return {
    phase: s.phase, tension: r1(s.tension), axe: Math.round(s.axe), streak: s.streak, flow: [r1(s.flow[0]), r1(s.flow[1])], form: [s.form[0], s.form[1]],
    mergeReady: s.mergeReady, fusion: s.fusion ? { ...s.fusion } : null, stage: s.stage, world: s.world, tEnd: s.tEnd, results: s.results,
    music: { ...s.music },
    sessionEnd: s.sessionEnd, merge: [s.merge[0].held, s.merge[1].held], ready: [s.ready[0], s.ready[1]], bestStreak: s.bestStreak,
    slots: s.slots.map((x) => (x ? { world: x.world, player: x.player, present: x.present } : null)),
    pieces: s.pieces.length, piecesRev: s.piecesRev,
  };
}

/** a copy of the room's set pieces (what a joiner is sent) */
export const piecesOf = (s: Session): SetPiece[] => s.pieces.map((p) => ({ ...p, points: [...p.points] }));

/** where a message goes: one slot, everyone, or everyone but the sender */
export type To = number | 'all' | 'others';

/** One client message through the rules -> what to send to whom. Poses are relayed by the transport, not here. */
export function route(s: Session, slot: number, msg: ClientMsg, now: number): { out: [To, ServerMsg][]; changed: boolean } {
  const out: [To, ServerMsg][] = [];
  const evs = (list: RulesEvent[]) => { for (const e of list) out.push(['all', { t: 'ev', ...e }]); };
  switch (msg.t) {
    case 'move': {
      const r = onMove(s, slot, msg, now);
      if (r.ok) out.push(['others', r.move]);
      else out.push([slot, { t: 'no', id: msg.id, reason: r.reason }]);
      evs(r.events);
      break;
    }
    case 'xch': {
      const r = onExchange(s, slot, msg, now);
      if (r.ok) out.push(['all', { t: 'xch', ...r.result }]);
      evs(r.events);
      break;
    }
    case 'form': evs(onForm(s, slot, !!msg.on, now).events); break;
    case 'merge': evs(onMerge(s, slot, !!msg.held, msg.dist, now).events); break;
    case 'ready': evs(onReady(s, slot, now).events); break;
    case 'travel': evs(onTravel(s, slot, msg, now).events); break;
    case 'build': {
      const r = onBuild(s, slot, msg, now);
      if (!r.ok) out.push([slot, { t: 'no', of: 'build', id: typeof msg.move === 'string' ? msg.move : undefined, reason: r.reason }]);
      evs(r.events);
      break;
    }
    case 'melt': case 'shatter': {
      const r = onBreak(s, slot, msg.t, msg, now);
      if (!r.ok) out.push([slot, { t: 'no', of: msg.t, id: typeof msg.id === 'string' ? msg.id : undefined, reason: r.reason ?? 'bad' }]);
      evs(r.events);
      break;
    }
    case 'fx': out.push(['others', { ...msg, t: 'fx', from: slot }]); break;
  }
  return { out, changed: s.changed };
}
