// The duel's rules (docs/design/duel.md, "Hits, KOs and rounds"): two bodies on one stage plane, three hits scatter
// a body (a KO), so does falling below the arena's kill floor; the body re-forms at the spawn farthest from the other
// and is untouchable for a moment; the first to five KOs wins the round, and the next round counts in again. Pure like
// rules.ts: no clock of its own, no I/O, no body physics. It reads each frame's bodies as plain data (their root and
// their hit and hurt capsules flattened onto the plane, what move they are in and the beat it started on) and returns
// events; whoever owns the bodies (src/duel/match.ts in the page and in Node, a server later) applies them: the
// knockback, the scatter, the re-forming.
//
//   const d = newDuel(nowMs)                       the first step begins round 1 (the bodies placed, the count-in)
//   const ev = duelStep(d, nowMs, [b0, b1], { bpm, spawns, yKill })   each frame, after the bodies moved
//   frozen(d, seat)                                 the seat's controls are held (the countdown, scattered, re-forming)
//   restartDuel(d, nowMs)                           from round 1 again
//
// Hits: a strike's hit capsule meets the other body's hurt capsules. Each attack (a move's serial) lands once. The
// knockback is the move's own (KNOCK) and doubles when the move started on the beat (within PERFECT_MS of an 8th-note
// line: the music is a weapon). A body in its own dodge's i-frames dodges; a body blocking takes a push and no hit;
// two strikes that meet clash (both pushed apart, nobody hit). Each hit costs 1 of HITS_MAX; the third is a KO.
// Times are milliseconds, distances metres in the plane's own coordinates (s along it, y up from its origin).

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
  /** each attack's knockback: along the plane (m/s, away from the attacker), up (m/s), the stagger (s) */
  KNOCK: {
    strike: [4.2, 3.0, 0.24],
    throw: [4.8, 2.6, 0.26],
    martelo: [5.4, 5.6, 0.3],
    'meia-lua': [6.4, 4.2, 0.32],
    armada: [7.2, 4.6, 0.34],
    bencao: [8.4, 2.8, 0.32],
    rasteira: [3.2, 6.8, 0.36],
  } as Record<string, [number, number, number]>,
  KNOCK_DEFAULT: [5, 4, 0.3] as [number, number, number],
} as const;

/** a capsule flattened onto the plane: a segment from (ax, ay) to (bx, by), radius r */
export interface Seg { ax: number; ay: number; bx: number; by: number; r: number }

/** one body this frame, as the rules read it */
export interface DuelBody {
  /** the root (the ground point under the hips), plane coordinates */
  s: number;
  y: number;
  hurt: readonly Seg[];
  hit: readonly Seg[];
  /** the move its hit capsules belong to, and that move's serial (0: none) */
  move: string | null;
  serial: number;
  /** the beat (music clock) the move started on, for the perfect bonus; null: unknown */
  moveBeat: number | null;
  /** which way it faces along the plane */
  facing: 1 | -1;
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
  /** where it re-forms (chosen when the matter starts streaming back) */
  reformAt: [number, number] | null;
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
  /** what the last frames did, for the tests and the probes */
  stats: { hits: number; perfect: number; kos: number; falls: number; blocks: number; dodges: number; clashes: number; rounds: number };
}

export type DuelEvent =
  | { k: 'count'; n: number }
  | { k: 'go'; round: number }
  | { k: 'hit'; by: number; target: number; move: string; perfect: boolean; hits: number; knock: [number, number, number]; at: [number, number] }
  | { k: 'block'; by: number; target: number; move: string; knock: [number, number, number]; at: [number, number] }
  | { k: 'dodge'; by: number; target: number; move: string; at: [number, number] }
  | { k: 'clash'; a: number; b: number; at: [number, number]; knock: [[number, number, number], [number, number, number]] }
  | { k: 'ko'; target: number; by: number; how: 'hits' | 'fall'; kos: [number, number]; at: [number, number]; reformAt: [number, number] }
  /** the matter streams back: the body re-forms at `at` now (and is in play at REFORM_MS) */
  | { k: 'reform'; seat: number; at: [number, number] }
  | { k: 'ready'; seat: number }
  | { k: 'won'; winner: number; round: number; kos: [number, number]; ms: number }
  /** a round's count-in begins: both bodies re-form at their round spawns */
  | { k: 'round'; round: number; at: [[number, number], [number, number]] };

/** what the rules need of the arena */
export interface DuelArena {
  /** [s, y] points to (re)form at, at least 2 (the first two are the round's starts, seat 0 and seat 1) */
  spawns: readonly (readonly [number, number])[];
  /** below this (plane y) is a KO */
  yKill: number;
  /** the music's tempo (the count-in's beat) */
  bpm: number;
}

const seat0 = (): DuelSeat => ({ hits: 0, kos: 0, life: 'alive', since: 0, invulnUntil: 0, lastHitBy: -1, lastHitAt: -1e9, struckBy: [0, 0], reformAt: null });

/** a duel whose first step begins round 1 (a 'round' event places the bodies, then the count-in) */
export function newDuel(now: number, bpm = 112): DuelState {
  return {
    // (as if a round had just been won: the first step starts the next, round 1)
    phase: 'won', round: 0, since: now - DUEL.WON_MS, countMs: countMs(bpm), count: DUEL.COUNT_FROM, playFrom: now, winner: null,
    seats: [seat0(), seat0()], clashed: [0, 0],
    stats: { hits: 0, perfect: 0, kos: 0, falls: 0, blocks: 0, dodges: 0, clashes: 0, rounds: 0 },
  };
}
const countMs = (bpm: number) => Math.max(DUEL.COUNT_MIN_MS, 60000 / Math.max(40, bpm || 112));

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

// ---------------------------------------------------------------- 2D geometry
function segSeg2(p: [number, number], q: [number, number], r: [number, number], s: [number, number]) {
  const d1x = q[0] - p[0], d1y = q[1] - p[1], d2x = s[0] - r[0], d2y = s[1] - r[1], rx = p[0] - r[0], ry = p[1] - r[1];
  const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
  let u: number, t: number;
  const cl = (x: number) => Math.max(0, Math.min(1, x));
  if (a <= 1e-12 && e <= 1e-12) { u = t = 0; }
  else if (a <= 1e-12) { u = 0; t = cl(f / e); }
  else {
    const c = d1x * rx + d1y * ry;
    if (e <= 1e-12) { t = 0; u = cl(-c / a); }
    else {
      const b = d1x * d2x + d1y * d2y, den = a * e - b * b;
      u = den > 1e-12 ? cl((b * f - c * e) / den) : 0;
      t = (b * u + f) / e;
      if (t < 0) { t = 0; u = cl(-c / a); } else if (t > 1) { t = 1; u = cl((b - c) / a); }
    }
  }
  const cx = p[0] + d1x * u - (r[0] + d2x * t), cy = p[1] + d1y * u - (r[1] + d2y * t);
  return { d: Math.hypot(cx, cy), at: [(p[0] + d1x * u + r[0] + d2x * t) / 2, (p[1] + d1y * u + r[1] + d2y * t) / 2] as [number, number] };
}
/** the closest two sets of capsules come (negative: overlapping), and where */
export function touch(A: readonly Seg[], B: readonly Seg[]) {
  let best = Infinity, at: [number, number] = [0, 0];
  for (const a of A) for (const b of B) {
    const r = segSeg2([a.ax, a.ay], [a.bx, a.by], [b.ax, b.ay], [b.bx, b.by]);
    const d = r.d - a.r - b.r;
    if (d < best) { best = d; at = r.at; }
  }
  return { d: best, at };
}

/** the spawn farthest from a body (height counts a little less: a ledge above is nearer than it looks) */
function farthest(arena: DuelArena, o: DuelBody, seat: number): [number, number] {
  let best: [number, number] = [arena.spawns[seat]?.[0] ?? 0, arena.spawns[seat]?.[1] ?? 0], bd = -1;
  for (const p of arena.spawns) { const dd = Math.hypot(p[0] - o.s, (p[1] - o.y) * 0.6); if (dd > bd) { bd = dd; best = [p[0], p[1]]; } }
  return best;
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
    const sp = (k: number): [number, number] => { const p = arena.spawns[k] ?? [k ? 1.5 : -1.5, 0]; return [p[0], p[1]]; };
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

  const ko = (target: number, by: number, how: 'hits' | 'fall', at: [number, number]) => {
    const S = d.seats[target], O = d.seats[1 - target];
    S.life = 'scattered'; S.since = now; S.hits = DUEL.HITS_MAX;
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
    if (S.life !== 'alive' || b.y >= arena.yKill) continue;
    const credited = S.lastHitBy >= 0 && now - S.lastHitAt <= DUEL.FALL_CREDIT_MS ? S.lastHitBy : -1;
    ko(k, credited, 'fall', [b.s, b.y]);
  }

  // ---- clashes: both strikes live and touching
  const [A, B] = bodies;
  if (A.hit.length && B.hit.length && d.seats[0].life === 'alive' && d.seats[1].life === 'alive' && (d.clashed[0] !== A.serial || d.clashed[1] !== B.serial)) {
    const t = touch(A.hit, B.hit);
    if (t.d <= 0) {
      d.clashed = [A.serial, B.serial];
      // neither lands now
      d.seats[1].struckBy[0] = A.serial; d.seats[0].struckBy[1] = B.serial;
      const C = DUEL.CLASH_KNOCK, away = (k: number) => (Math.sign(bodies[k].s - bodies[1 - k].s) || -bodies[k].facing) as number;
      d.stats.clashes++;
      out.push({ k: 'clash', a: 0, b: 1, at: t.at, knock: [[away(0) * C[0], C[1], C[2]], [away(1) * C[0], C[1], C[2]]] });
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
    // away from the attacker: the way it faces (a strike hits forward), or the way they stand if it faces away
    const dir = att.facing * Math.sign(def.s - att.s) < 0 && Math.abs(def.s - att.s) > 0.25 ? Math.sign(def.s - att.s) : att.facing;
    if (def.blocking && def.facing === -dir) {
      const k: [number, number, number] = [dir * base[0] * DUEL.BLOCK_KNOCK, base[1] * DUEL.BLOCK_KNOCK * 0.5, base[2] * 0.5];
      d.stats.blocks++;
      out.push({ k: 'block', by: a, target: t, move, knock: k, at: c.at });
      continue;
    }
    S.hits += 1; S.lastHitBy = a; S.lastHitAt = now;
    d.stats.hits++; if (perfect) d.stats.perfect++;
    const knock: [number, number, number] = [dir * base[0] * mul, base[1] * (perfect ? 1.4 : 1), base[2] * (perfect ? 1.3 : 1)];
    out.push({ k: 'hit', by: a, target: t, move, perfect, hits: S.hits, knock, at: c.at });
    if (S.hits >= DUEL.HITS_MAX) ko(t, a, 'hits', [def.s, def.y]);
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
