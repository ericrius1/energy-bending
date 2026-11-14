// The duel's rules (docs/design/duel.md, "Hits, KOs and rounds", and the owner's correction: still a dance, 3D native,
// the 2D lock an option anywhere, dancing well gives you power). Two bodies in a world's play space: three hits scatter
// a body (a KO), so does falling below the space's kill floor; the body re-forms at the spawn farthest from the other
// and is untouchable for a moment; the first to five KOs wins the round, and the next round counts in again. Dancing
// well builds flow: moves on the beat, varied, and travelling through the world as dance (wall jumps, flips in the
// air, aús); a hit landed builds it, a hit taken costs it (the jogo's flow and streak, shared/rules.ts, with teeth).
// Flow is what phase 2's spells and the super will spend; for now it is the HUD's super meter.
//
// Pure like rules.ts: no clock of its own, no I/O, no body physics. It reads each frame's bodies as plain data (where
// they are, which way they face, their hit and hurt capsules in the world: flattened onto the stage plane by whoever
// reads them when the view is locked, so a locked duel is exactly 2D), what move they are in and the beat it started
// on, and returns events; whoever owns the bodies (src/duel/match.ts in the page and in Node, a server later) does
// what they say: the knockback (a horizontal direction and an upward kick), the scatter, the re-forming.
//
//   const d = newDuel(nowMs)                     the first step begins round 1 (the bodies placed, the count-in)
//   const ev = duelStep(d, nowMs, [b0, b1], { spawns, yKill, bpm })   each frame, after the bodies moved
//   duelMove(d, seat, move, onBeat)              a move a body started (flow); duelTravel(d, seat, 'wall' | 'flip')
//   frozen(d, seat)                              the seat's controls are held (the count-in, scattered, re-forming)
//   restartDuel(d, nowMs)                        from round 1 again
//
// Hits: a strike's hit capsule meets the other body's hurt capsules. Each attack (a move's serial) lands once. The
// knockback is the move's own (KNOCK), away from the attacker, and doubles when the move started on the beat (within
// PERFECT_MS of an 8th-note line: the music is a weapon). A body in its own dodge's i-frames dodges; a body blocking
// toward the attack takes a push and no hit; two strikes that meet clash (both pushed apart). Each hit costs 1 of
// HITS_MAX; the third is a KO. Times in milliseconds, distances in metres, the world's frame (y up).
import { RULES } from './rules.ts';

export const DUEL = {
  HITS_MAX: 3,
  KO_TARGET: 5,
  /** the count-in: 3, 2, 1 (a beat each, never shorter than COUNT_MIN_MS), then BEND and play */
  COUNT_FROM: 3,
  COUNT_MIN_MS: 450,
  /** a KO: the matter blown off for SCATTER_MS, then it streams back and the body has re-formed at REFORM_MS (the
   *  body's own re-forming, Character's PHYS.reformTime 0.9 s, fills the gap), untouchable INVULN_MS more */
  SCATTER_MS: 600,
  REFORM_MS: 1500,
  INVULN_MS: 1000,
  /** the winner's moment before the next round counts in */
  WON_MS: 4000,
  /** on the beat: a move started within this of an 8th-note line */
  PERFECT_MS: 60,
  PERFECT_GRID: 0.5,
  PERFECT_KNOCK: 2,
  /** a fall within this of being hit is the hitter's KO (a fall always scores for the other seat; `by` says who did it) */
  FALL_CREDIT_MS: 4000,
  /** a block takes this much of the knock, and no hit */
  BLOCK_KNOCK: 0.4,
  /** a clash pushes both apart (along, up, stagger s) */
  CLASH_KNOCK: [3.2, 2.2, 0.18] as [number, number, number],
  /** each attack's knockback: along the ground away from the attacker (m/s), up (m/s), the stagger (s) */
  KNOCK: {
    strike: [2.8, 3.0, 0.22],
    throw: [3.0, 2.6, 0.24],
    martelo: [3.2, 4.4, 0.26],
    'meia-lua': [3.6, 3.6, 0.28],
    armada: [4.0, 4.0, 0.3],
    bencao: [4.4, 2.6, 0.28],
    rasteira: [2.2, 5.2, 0.32],
  } as Record<string, [number, number, number]>,
  KNOCK_DEFAULT: [3.6, 3.4, 0.3] as [number, number, number],
  // ---- flow (the jogo's: RULES.moves' flow per move, more on the beat, less for the same move three times running)
  FLOW_MAX: RULES.FLOW_MAX,
  PERFECT_FLOW: RULES.PERFECT_FLOW,
  REPEAT_FLOW: RULES.REPEAT_FLOW,
  /** flow for travelling as dance: a wall jump, a flip (a spin in the air) */
  WALL_FLOW: 5,
  FLIP_FLOW: 4,
  /** a hit landed (times PERFECT_FLOW on the beat), a hit taken (the jogo's cost); a KO taken halves what is left */
  HIT_FLOW: 6,
  HIT_FLOW_COST: RULES.HIT_FLOW_COST,
  /** each perfect move in a row adds STREAK_STEP to the flow's multiplier, up to STREAK_MAX; an off-beat one ends it */
  STREAK_STEP: RULES.STREAK_STEP,
  STREAK_MAX: RULES.STREAK_MAX,
} as const;

export type V3 = [number, number, number];
/** a capsule in the world: a segment from a to b, radius r (Character's Capsule has these fields) */
export interface Seg { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number }

/** one body this frame, as the rules read it */
export interface DuelBody {
  /** the root (the ground point under the hips), world */
  p: V3;
  /** which way it faces, a horizontal unit vector (x, z) */
  fwd: [number, number];
  hurt: readonly Seg[];
  hit: readonly Seg[];
  /** the move its hit capsules belong to, and that move's serial (0: none) */
  move: string | null;
  serial: number;
  /** the beat (music clock) the move started on, for the perfect bonus; null: unknown */
  moveBeat: number | null;
  /** its own i-frames (a dodge, a blink) */
  invulnerable: boolean;
  blocking: boolean;
}

export type Life = 'alive' | 'scattered' | 'reforming';
export interface DuelSeat {
  hits: number;
  kos: number;
  life: Life;
  /** when its life last changed (ms) */
  since: number;
  /** untouchable until (ms) */
  invulnUntil: number;
  lastHitBy: number;
  lastHitAt: number;
  /** the attacker's serial that last landed on it, per attacker (each attack lands once) */
  struckBy: [number, number];
  /** where it re-forms (chosen at the KO) */
  reformAt: V3 | null;
  /** flow 0 … FLOW_MAX: what dancing well has built (phase 2 spends it); its perfect streak; its last two moves */
  flow: number;
  streak: number;
  last: string[];
  /** moves started this round, and how many on the beat (the stats) */
  moves: number;
  perfect: number;
}
export type DuelPhase = 'countdown' | 'play' | 'won';
export interface DuelState {
  phase: DuelPhase;
  round: number;
  /** when the phase began (ms) */
  since: number;
  /** the count-in's beat length (ms) and the number showing (3, 2, 1; 0 once play began) */
  countMs: number;
  count: number;
  /** when play began this round (ms), for the round's clock */
  playFrom: number;
  winner: number | null;
  seats: [DuelSeat, DuelSeat];
  /** the attacks that met in a clash, by seat (each clashes once) */
  clashed: [number, number];
  stats: { hits: number; perfect: number; kos: number; falls: number; blocks: number; dodges: number; clashes: number; rounds: number };
}

/** a knockback: the horizontal direction (unit x, z), along it (m/s), up (m/s), the stagger (s) */
export interface Knock { dir: [number, number]; along: number; up: number; stagger: number }

export type DuelEvent =
  | { k: 'count'; n: number }
  | { k: 'go'; round: number }
  | { k: 'hit'; by: number; target: number; move: string; perfect: boolean; hits: number; knock: Knock; at: V3 }
  | { k: 'block'; by: number; target: number; move: string; knock: Knock; at: V3 }
  | { k: 'dodge'; by: number; target: number; move: string; at: V3 }
  | { k: 'clash'; a: number; b: number; at: V3; knock: [Knock, Knock] }
  | { k: 'ko'; target: number; by: number; how: 'hits' | 'fall'; kos: [number, number]; at: V3; reformAt: V3 }
  /** the matter streams back: the body re-forms at `at` now (and is in play at REFORM_MS) */
  | { k: 'reform'; seat: number; at: V3 }
  | { k: 'ready'; seat: number }
  | { k: 'won'; winner: number; round: number; kos: [number, number]; ms: number }
  /** a round's count-in begins: both bodies re-form at their round spawns */
  | { k: 'round'; round: number; at: [V3, V3] };

/** what the rules need of the arena */
export interface DuelArena {
  /** where bodies (re)form, world, at least 2 (the first two are the round's starts, seat 0 and seat 1) */
  spawns: readonly (readonly [number, number, number])[];
  /** below this (world y) is a KO */
  yKill: number;
  /** the music's tempo (the count-in's beat) */
  bpm: number;
}

const seat0 = (): DuelSeat => ({
  hits: 0, kos: 0, life: 'alive', since: 0, invulnUntil: 0, lastHitBy: -1, lastHitAt: -1e9, struckBy: [0, 0], reformAt: null,
  flow: 0, streak: 0, last: [], moves: 0, perfect: 0,
});
const countMs = (bpm: number) => Math.max(DUEL.COUNT_MIN_MS, 60000 / Math.max(40, bpm || 112));

/** a duel whose first step begins round 1 (a 'round' event places the bodies, then the count-in) */
export function newDuel(now: number, bpm = 112): DuelState {
  return {
    // (as if a round had just been won: the first step starts the next, round 1)
    phase: 'won', round: 0, since: now - DUEL.WON_MS, countMs: countMs(bpm), count: DUEL.COUNT_FROM, playFrom: now, winner: null,
    seats: [seat0(), seat0()], clashed: [0, 0],
    stats: { hits: 0, perfect: 0, kos: 0, falls: 0, blocks: 0, dodges: 0, clashes: 0, rounds: 0 },
  };
}

/** from round 1 again (the bodies are told by a 'round' event on the next step) */
export function restartDuel(d: DuelState, now: number, bpm = 112) {
  Object.assign(d, { ...newDuel(now, bpm), stats: d.stats });
}

/** the seat's controls are held: the count-in, its matter scattered or re-forming */
export function frozen(d: DuelState, seat: number) {
  if (d.phase === 'countdown') return true;
  return d.seats[seat].life !== 'alive';
}
/** the seat can't be hit now (re-forming, or just re-formed) */
export function untouchable(d: DuelState, seat: number, now: number) {
  const S = d.seats[seat];
  return S.life !== 'alive' || now < S.invulnUntil;
}

/** is a beat (music clock) on the 8th-note grid, within PERFECT_MS at this tempo? */
export function onBeat(beat: number | null, bpm: number) {
  if (beat == null || !Number.isFinite(beat)) return false;
  const g = DUEL.PERFECT_GRID, x = beat / g, off = (x - Math.round(x)) * g;
  return Math.abs((off * 60000) / Math.max(40, bpm)) <= DUEL.PERFECT_MS;
}

// ---------------------------------------------------------------- flow
const addFlow = (S: DuelSeat, v: number) => { S.flow = Math.max(0, Math.min(DUEL.FLOW_MAX, S.flow + v)); };
const streakMul = (S: DuelSeat) => Math.min(DUEL.STREAK_MAX, 1 + DUEL.STREAK_STEP * S.streak);

/** a move a body started (in play): the flow it builds (the jogo's table, on the beat more, the third same move
 *  running less, a streak of perfect moves multiplying it). Returns the flow gained */
export function duelMove(d: DuelState, seat: number, move: string, perfect: boolean): number {
  if (d.phase !== 'play' || d.seats[seat].life !== 'alive') return 0;
  const S = d.seats[seat], def = (RULES.moves as Record<string, { flow: number }>)[move];
  S.moves++;
  if (perfect) { S.perfect++; S.streak++; } else S.streak = 0;
  if (!def) return 0;
  const repeat = S.last.length >= 2 && S.last[0] === move && S.last[1] === move;
  S.last.push(move); if (S.last.length > 2) S.last.shift();
  const gain = def.flow * (perfect ? DUEL.PERFECT_FLOW : 1) * (repeat ? DUEL.REPEAT_FLOW : 1) * streakMul(S);
  addFlow(S, gain);
  return gain;
}
/** travelling as dance: a wall jump, a flip in the air */
export function duelTravel(d: DuelState, seat: number, kind: 'wall' | 'flip'): number {
  if (d.phase !== 'play' || d.seats[seat].life !== 'alive') return 0;
  const S = d.seats[seat], gain = (kind === 'wall' ? DUEL.WALL_FLOW : DUEL.FLIP_FLOW) * streakMul(S);
  addFlow(S, gain);
  return gain;
}

// ---------------------------------------------------------------- 3D geometry
function segSeg(a: Seg, b: Seg) {
  const p1 = [a.ax, a.ay, a.az], q1 = [a.bx, a.by, a.bz], p2 = [b.ax, b.ay, b.az], q2 = [b.bx, b.by, b.bz];
  const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]], d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]], r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const A = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2], E = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2], F = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  const cl = (x: number) => Math.max(0, Math.min(1, x));
  let s: number, t: number;
  if (A <= 1e-12 && E <= 1e-12) { s = t = 0; }
  else if (A <= 1e-12) { s = 0; t = cl(F / E); }
  else {
    const C = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
    if (E <= 1e-12) { t = 0; s = cl(-C / A); }
    else {
      const B = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2], den = A * E - B * B;
      s = den > 1e-12 ? cl((B * F - C * E) / den) : 0;
      t = (B * s + F) / E;
      if (t < 0) { t = 0; s = cl(-C / A); } else if (t > 1) { t = 1; s = cl((B - C) / A); }
    }
  }
  const c1 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s], c2 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return { d: Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]), at: [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2, (c1[2] + c2[2]) / 2] as V3 };
}
/** the closest two sets of capsules come (negative: overlapping), and where */
export function touch(A: readonly Seg[], B: readonly Seg[]) {
  let best = Infinity, at: V3 = [0, 0, 0];
  for (const a of A) for (const b of B) {
    const r = segSeg(a, b), d = r.d - a.r - b.r;
    if (d < best) { best = d; at = r.at; }
  }
  return { d: best, at };
}

/** the spawn farthest from a body (height counts a little less: a ledge above is nearer than it looks) */
function farthest(arena: DuelArena, o: DuelBody, seat: number): V3 {
  const f = arena.spawns[seat] ?? [0, 0, 0];
  let best: V3 = [f[0], f[1], f[2]], bd = -1;
  for (const p of arena.spawns) {
    const dd = Math.hypot(p[0] - o.p[0], (p[1] - o.p[1]) * 0.6, p[2] - o.p[2]);
    if (dd > bd) { bd = dd; best = [p[0], p[1], p[2]]; }
  }
  return best;
}
/** the horizontal unit direction from a to b, or `or` when they stand on each other */
function away(a: V3, b: V3, or: [number, number]): [number, number] {
  const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz);
  return l > 1e-3 ? [dx / l, dz / l] : or;
}

// ---------------------------------------------------------------- the frame
/** one frame of the duel, after the bodies moved: the clock's phases, falls, clashes, hits. Returns what happened */
export function duelStep(d: DuelState, now: number, bodies: readonly [DuelBody, DuelBody], arena: DuelArena): DuelEvent[] {
  const out: DuelEvent[] = [];
  // ---- the round's clock
  if (d.phase === 'won' && now - d.since >= DUEL.WON_MS) {
    d.round += 1; d.phase = 'countdown'; d.since = now; d.countMs = countMs(arena.bpm); d.count = DUEL.COUNT_FROM; d.winner = null;
    d.seats = [seat0(), seat0()]; d.clashed = [0, 0];
    for (const S of d.seats) { S.since = now; S.struckBy = [bodies[0].serial, bodies[1].serial]; }
    const sp = (k: number): V3 => { const p = arena.spawns[k] ?? [k ? 1.5 : -1.5, 0, 0]; return [p[0], p[1], p[2]]; };
    out.push({ k: 'round', round: d.round, at: [sp(0), sp(1)] });
    out.push({ k: 'count', n: d.count });
  }
  if (d.phase === 'countdown') {
    const n = DUEL.COUNT_FROM - Math.floor((now - d.since) / d.countMs);
    if (n <= 0) {
      d.phase = 'play'; d.since = now; d.playFrom = now; d.count = 0;
      // (an attack begun in the count-in can't land after it)
      for (const S of d.seats) S.struckBy = [bodies[0].serial, bodies[1].serial];
      out.push({ k: 'go', round: d.round });
    } else if (n !== d.count) { d.count = n; out.push({ k: 'count', n }); }
  }
  // ---- each seat's life: scattered → re-forming → back
  for (let k = 0; k < 2; k++) {
    const S = d.seats[k];
    if (S.life === 'scattered' && now - S.since >= DUEL.SCATTER_MS) {
      const at = S.reformAt ?? farthest(arena, bodies[1 - k], k);
      S.life = 'reforming'; S.reformAt = at;
      out.push({ k: 'reform', seat: k, at });
    } else if (S.life === 'reforming' && now - S.since >= DUEL.REFORM_MS) {
      S.life = 'alive'; S.since = now; S.invulnUntil = now + DUEL.INVULN_MS; S.hits = 0; S.reformAt = null;
      S.struckBy = [bodies[0].serial, bodies[1].serial];
      out.push({ k: 'ready', seat: k });
    }
  }
  if (d.phase !== 'play') return out;

  const ko = (target: number, by: number, how: 'hits' | 'fall', at: V3) => {
    const S = d.seats[target], O = d.seats[1 - target];
    S.life = 'scattered'; S.since = now; S.hits = DUEL.HITS_MAX; S.streak = 0;
    S.flow = S.flow / 2;
    // where it will re-form: the spawn farthest from the other body now (chosen at once, so a body that falls out and
    // re-forms by itself, Character's own fall-out, goes there too)
    S.reformAt = farthest(arena, bodies[1 - target], target);
    O.kos += 1;
    d.stats.kos++; if (how === 'fall') d.stats.falls++;
    out.push({ k: 'ko', target, by, how, kos: [d.seats[0].kos, d.seats[1].kos], at, reformAt: S.reformAt });
  };

  // ---- falls
  for (let k = 0; k < 2; k++) {
    const S = d.seats[k], b = bodies[k];
    if (S.life !== 'alive' || b.p[1] >= arena.yKill) continue;
    const credited = S.lastHitBy >= 0 && now - S.lastHitAt <= DUEL.FALL_CREDIT_MS ? S.lastHitBy : -1;
    ko(k, credited, 'fall', [b.p[0], b.p[1], b.p[2]]);
  }

  // ---- clashes: both strikes live and touching
  const [A, B] = bodies;
  if (A.hit.length && B.hit.length && d.seats[0].life === 'alive' && d.seats[1].life === 'alive' && (d.clashed[0] !== A.serial || d.clashed[1] !== B.serial)) {
    const t = touch(A.hit, B.hit);
    if (t.d <= 0) {
      d.clashed = [A.serial, B.serial];
      // neither lands now
      d.seats[1].struckBy[0] = A.serial; d.seats[0].struckBy[1] = B.serial;
      const C = DUEL.CLASH_KNOCK;
      const kn = (k: number): Knock => ({ dir: away(bodies[1 - k].p, bodies[k].p, [-bodies[k].fwd[0], -bodies[k].fwd[1]]), along: C[0], up: C[1], stagger: C[2] });
      d.stats.clashes++;
      out.push({ k: 'clash', a: 0, b: 1, at: t.at, knock: [kn(0), kn(1)] });
    }
  }

  // ---- hits
  for (let a = 0; a < 2; a++) {
    const t = 1 - a, att = bodies[a], def = bodies[t], S = d.seats[t];
    if (!att.hit.length || !att.serial || d.seats[a].life !== 'alive') continue;
    if (S.struckBy[a] === att.serial || S.life !== 'alive') continue;
    const c = touch(att.hit, def.hurt);
    if (c.d > 0) continue;
    const move = att.move ?? 'strike';
    if (now < S.invulnUntil) continue;            // just re-formed: it passes through
    S.struckBy[a] = att.serial;
    if (def.invulnerable) { d.stats.dodges++; out.push({ k: 'dodge', by: a, target: t, move, at: c.at }); continue; }
    const base = DUEL.KNOCK[move] ?? DUEL.KNOCK_DEFAULT;
    const perfect = onBeat(att.moveBeat, arena.bpm);
    const mul = perfect ? DUEL.PERFECT_KNOCK : 1;
    // away from the attacker: along the way it faces (a strike hits forward), or the way they stand when it lands
    // from behind or beside
    const line = away(att.p, def.p, att.fwd);
    const dir: [number, number] = line[0] * att.fwd[0] + line[1] * att.fwd[1] > 0.2 ? att.fwd : line;
    if (def.blocking && def.fwd[0] * dir[0] + def.fwd[1] * dir[1] < -0.2) {
      d.stats.blocks++;
      out.push({ k: 'block', by: a, target: t, move, knock: { dir, along: base[0] * DUEL.BLOCK_KNOCK, up: base[1] * DUEL.BLOCK_KNOCK * 0.5, stagger: base[2] * 0.5 }, at: c.at });
      continue;
    }
    S.hits += 1; S.lastHitBy = a; S.lastHitAt = now;
    d.stats.hits++; if (perfect) d.stats.perfect++;
    addFlow(d.seats[a], DUEL.HIT_FLOW * (perfect ? DUEL.PERFECT_FLOW : 1));
    addFlow(S, -DUEL.HIT_FLOW_COST); S.streak = 0;
    const knock: Knock = { dir, along: base[0] * mul, up: base[1] * (perfect ? 1.25 : 1), stagger: base[2] };
    out.push({ k: 'hit', by: a, target: t, move, perfect, hits: S.hits, knock, at: c.at });
    if (S.hits >= DUEL.HITS_MAX) ko(t, a, 'hits', [def.p[0], def.p[1], def.p[2]]);
  }

  // ---- the round won
  const w = d.seats[0].kos >= DUEL.KO_TARGET ? 0 : d.seats[1].kos >= DUEL.KO_TARGET ? 1 : -1;
  if (w >= 0) {
    d.phase = 'won'; d.winner = w; d.stats.rounds++;
    out.push({ k: 'won', winner: w, round: d.round, kos: [d.seats[0].kos, d.seats[1].kos], ms: now - d.playFrom });
    d.since = now;
  }
  return out;
}
