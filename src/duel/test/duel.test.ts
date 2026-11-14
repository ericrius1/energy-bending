// The duel's rules (shared/duel.ts) on plain data, then joined to real bodies (match.ts) free in 3D and locked, then
// two virtual players dueling in Node (sim.ts), free and locked. Run by scripts/test-ts.mjs (npm test).
import { test, assert, near, done } from '../../dancer/test/check';
import { DUEL, newDuel, duelStep, duelMove, frozen, untouchable, onBeat, type DuelBody, type DuelEvent, type DuelState } from '../../../shared/duel.ts';
import { Character } from '../../dancer/character';
import { DuelMatch, duelPlane } from '../match';
import { simulateDuel, makeBrains, nodeArena } from '../sim';
import { DuelBrain, holdFor, jumpHeight } from '../../ai/duel-brain';

const arena = { spawns: [[-2, 0, 0], [2, 0, 0], [-4, 0, 0], [4, 0, 0], [0, 1.1, 0]] as [number, number, number][], yKill: -2.2, bpm: 120 };
/** a standing body at x (z 0 unless given): a column for its hurt shape, and a strike reaching `reach` along its facing
 *  (±x) when given */
const body = (x: number, o: Partial<DuelBody> & { reach?: number; facing?: number; y?: number; z?: number } = {}): DuelBody => {
  const f = o.facing ?? 1, reach = o.reach ?? 0, y = o.y ?? 0, z = o.z ?? 0;
  const { reach: _r, facing: _f, y: _y, z: _z, ...rest } = o;
  return {
    p: [x, y, z], fwd: [f, 0], hurt: [{ ax: x, ay: y + 0.2, az: z, bx: x, by: y + 1.5, bz: z, r: 0.18 }],
    hit: reach ? [{ ax: x + f * 0.3, ay: y + 1.1, az: z, bx: x + f * reach, by: y + 1.1, bz: z, r: 0.05 }] : [],
    move: reach ? 'strike' : null, serial: 0, moveBeat: null, invulnerable: false, blocking: false, ...rest,
  };
};
/** a duel already in play at t (the count-in run through) */
function playing(): { d: DuelState; t: number } {
  const d = newDuel(0, arena.bpm);
  let t = 0;
  for (; d.phase !== 'play' && t < 10000; t += 16) duelStep(d, t, [body(-2), body(2, { facing: -1 })], arena);
  return { d, t };
}
const kinds = (ev: DuelEvent[]) => ev.map((e) => e.k);

test('a duel counts in 3, 2, 1, then BEND; the seats are held until then', () => {
  const d = newDuel(0, 120), seen: DuelEvent[] = [];
  for (let t = 0; t < 3000; t += 10) {
    seen.push(...duelStep(d, t, [body(-2), body(2, { facing: -1 })], arena));
    if (d.phase === 'countdown') assert(frozen(d, 0) && frozen(d, 1), 'held in the count-in');
  }
  const ks = kinds(seen);
  assert(ks[0] === 'round', `starts a round: ${ks.join(',')}`);
  assert(seen.filter((e) => e.k === 'count').map((e) => (e as { n: number }).n).join() === '3,2,1', 'counts 3, 2, 1');
  assert(ks.includes('go') && d.phase === 'play' && !frozen(d, 0), 'then play');
  return `play from ${d.playFrom} ms`;
});

test('a strike that meets the body hits once; three hits are a KO', () => {
  const { d, t } = playing();
  let ev = duelStep(d, t, [body(-0.6, { reach: 0.9, serial: 5 }), body(0.2, { facing: -1 })], arena);
  const h = ev.find((e) => e.k === 'hit') as Extract<DuelEvent, { k: 'hit' }>;
  assert(h && h.by === 0 && h.target === 1 && h.hits === 1, `a hit: ${kinds(ev)}`);
  assert(h.knock.dir[0] > 0.99 && h.knock.along > 0, 'knocked away from the attacker');
  ev = duelStep(d, t + 16, [body(-0.6, { reach: 0.9, serial: 5 }), body(0.2, { facing: -1 })], arena);
  assert(!ev.some((e) => e.k === 'hit'), 'the same attack lands once');
  duelStep(d, t + 300, [body(-0.6, { reach: 0.9, serial: 6 }), body(0.2, { facing: -1 })], arena);
  ev = duelStep(d, t + 600, [body(-0.6, { reach: 0.9, serial: 7 }), body(0.2, { facing: -1 })], arena);
  const ko = ev.find((e) => e.k === 'ko') as Extract<DuelEvent, { k: 'ko' }>;
  assert(ko && ko.target === 1 && ko.by === 0 && ko.how === 'hits' && d.seats[0].kos === 1, `the third is a KO: ${kinds(ev)}`);
  assert(frozen(d, 1) && untouchable(d, 1, t + 600), 'scattered: held and untouchable');
});

test('in 3D a strike meets only what is in front of it, and knocks along the ground in its direction', () => {
  const { d, t } = playing();
  // facing +x, the other a metre off to the side (z): no touch
  let ev = duelStep(d, t, [body(-0.6, { reach: 0.9, serial: 3 }), body(0.2, { z: 1.0, facing: -1 })], arena);
  assert(!ev.some((e) => e.k === 'hit'), 'beside it: missed');
  // a strike along a diagonal, the other on it: knocked that way
  const a = body(0, { serial: 4 }), s = Math.SQRT1_2;
  a.fwd = [s, s]; a.move = 'strike';
  a.hit = [{ ax: 0.2 * s, ay: 1.1, az: 0.2 * s, bx: 0.9 * s, by: 1.1, bz: 0.9 * s, r: 0.05 }];
  ev = duelStep(d, t + 16, [a, body(0.6 * s * 1.2, { z: 0.6 * s * 1.2, facing: -1 })], arena);
  const h = ev.find((e) => e.k === 'hit') as Extract<DuelEvent, { k: 'hit' }>;
  assert(h, `diagonal hit: ${kinds(ev)}`);
  near(h.knock.dir[0], s, 1e-6, 'x'); near(h.knock.dir[1], s, 1e-6, 'z');
});

test('a KO re-forms at the spawn farthest from the other, then is untouchable for a second', () => {
  const { d, t } = playing();
  for (let k = 0; k < 3; k++) duelStep(d, t + k * 100, [body(3.4, { reach: 0.9, serial: 10 + k }), body(4.2, { facing: -1 })], arena);
  assert(d.seats[1].life === 'scattered', 'KO');
  let at: number[] | null = null, ready = -1;
  for (let u = t + 200; u < t + 4000; u += 16) {
    for (const e of duelStep(d, u, [body(3.4), body(4.2, { facing: -1 })], arena)) {
      if (e.k === 'reform') at = e.at;
      if (e.k === 'ready') ready = u;
    }
  }
  assert(at && at[0] === -4, `farthest from the attacker at 3.4: ${at}`);
  near(ready - (t + 200), DUEL.REFORM_MS, 40, 'back after REFORM_MS');
  const ev = duelStep(d, ready + 200, [body(-4.6, { reach: 0.9, serial: 99 }), body(-4, { facing: -1 })], arena);
  assert(!ev.some((e) => e.k === 'hit'), 'untouchable just after');
  const ev2 = duelStep(d, ready + DUEL.INVULN_MS + 50, [body(-4.6, { reach: 0.9, serial: 100 }), body(-4, { facing: -1 })], arena);
  assert(ev2.some((e) => e.k === 'hit'), 'then it can be hit');
});

test('on the beat the knockback doubles', () => {
  assert(onBeat(4.5, 120) && onBeat(4.5 + 0.1, 120) && !onBeat(4.5 + 0.2, 120), 'the 8th-note window (±60 ms at 120 bpm: ±0.12 beat)');
  const a = playing(), b = playing();
  const h1 = duelStep(a.d, a.t, [body(-0.6, { reach: 0.9, serial: 3, moveBeat: 8.22 }), body(0.2, { facing: -1 })], arena).find((e) => e.k === 'hit') as Extract<DuelEvent, { k: 'hit' }>;
  const h2 = duelStep(b.d, b.t, [body(-0.6, { reach: 0.9, serial: 3, moveBeat: 8.02 }), body(0.2, { facing: -1 })], arena).find((e) => e.k === 'hit') as Extract<DuelEvent, { k: 'hit' }>;
  assert(!h1.perfect && h2.perfect, 'off, then on the beat');
  near(h2.knock.along, h1.knock.along * DUEL.PERFECT_KNOCK, 1e-9, 'double');
});

test('dancing well builds flow: on the beat more, varied more, a hit costs it', () => {
  const on = playing(), off = playing(), same = playing();
  for (const m of ['meia-lua', 'au', 'armada', 'macaco']) { duelMove(on.d, 0, m, true); duelMove(off.d, 0, m, false); }
  for (let i = 0; i < 4; i++) duelMove(same.d, 0, 'meia-lua', true);
  const a = on.d.seats[0].flow, b = off.d.seats[0].flow, c = same.d.seats[0].flow;
  assert(a > b * 1.5, `on the beat ${a.toFixed(1)} > off ${b.toFixed(1)}`);
  assert(a > c, `varied ${a.toFixed(1)} > the same kick four times ${c.toFixed(1)}`);
  assert(on.d.seats[0].streak === 4, 'a streak of four');
  duelStep(on.d, on.t, [body(0.2, { facing: -1 }), body(-0.6, { reach: 0.9, serial: 9 })], arena);
  assert(on.d.seats[0].flow < a && (on.d.seats[0].streak as number) === 0, `hit: flow ${a.toFixed(1)} → ${on.d.seats[0].flow.toFixed(1)}`);
  return `four varied on the beat ${a.toFixed(1)}, off ${b.toFixed(1)}, one kick ×4 ${c.toFixed(1)}`;
});

test('falling below the kill floor is a KO for the other seat (the hitter, if it was hit lately)', () => {
  const { d, t } = playing();
  duelStep(d, t, [body(-0.6, { reach: 0.9, serial: 3 }), body(0.2, { facing: -1 })], arena);
  const ev = duelStep(d, t + 900, [body(-0.6), body(1, { y: -2.5, facing: -1 })], arena);
  const ko = ev.find((e) => e.k === 'ko') as Extract<DuelEvent, { k: 'ko' }>;
  assert(ko && ko.how === 'fall' && ko.by === 0 && d.seats[0].kos === 1, `a fall: ${kinds(ev)}`);
  const { d: d2, t: t2 } = playing();
  const ko2 = duelStep(d2, t2, [body(-0.6, { y: -3 }), body(1, { facing: -1 })], arena).find((e) => e.k === 'ko') as Extract<DuelEvent, { k: 'ko' }>;
  assert(ko2.by === -1 && d2.seats[1].kos === 1, 'nobody pushed it: still the other seat\'s point');
});

test('a block takes a push and no hit; a dodge\'s i-frames pass through; two strikes clash', () => {
  let { d, t } = playing();
  let ev = duelStep(d, t, [body(-0.6, { reach: 0.9, serial: 3 }), body(0.2, { facing: -1, blocking: true })], arena);
  assert(ev.some((e) => e.k === 'block') && d.seats[1].hits === 0, `block: ${kinds(ev)}`);
  ({ d, t } = playing());
  ev = duelStep(d, t, [body(-0.6, { reach: 0.9, serial: 3 }), body(0.2, { facing: -1, invulnerable: true })], arena);
  assert(ev.some((e) => e.k === 'dodge') && d.seats[1].hits === 0, `dodge: ${kinds(ev)}`);
  ({ d, t } = playing());
  ev = duelStep(d, t, [body(-0.6, { reach: 0.9, serial: 3 }), body(0.6, { reach: 0.9, serial: 4, facing: -1 })], arena);
  assert(ev.some((e) => e.k === 'clash') && !ev.some((e) => e.k === 'hit'), `clash: ${kinds(ev)}`);
});

test('five KOs win the round; after a moment the next round counts in from nothing', () => {
  const { d, t } = playing();
  let u = t, serial = 1, won: Extract<DuelEvent, { k: 'won' }> | null = null;
  while (!won && u < t + 120000) {
    for (const e of duelStep(d, u, [body(-0.6, { reach: 0.9, serial: serial++ }), body(0.2, { facing: -1 })], arena)) if (e.k === 'won') won = e;
    u += 250;
  }
  assert(won && won.winner === 0 && won.kos[0] === DUEL.KO_TARGET, 'seat 0 won 5-0');
  const later = duelStep(d, u + DUEL.WON_MS + 10, [body(-0.6), body(0.2, { facing: -1 })], arena);
  assert(later.some((e) => e.k === 'round') && d.round === 2 && d.seats[0].kos === 0 && (d.phase as string) === 'countdown', 'round 2');
  return `round 1 lasted ${(won.ms / 1000).toFixed(1)} s`;
});

// ---------------------------------------------------------------- real bodies
const T = nodeArena('temple'), F = nodeArena('forge');

test('the fallback arenas: a space, four spawns or more clear of the solids, a kill floor, the solid ledges as walls', () => {
  for (const { arena: a } of [T, F]) {
    assert(a.spawns.length >= 4, `${a.world}: ${a.spawns.length} spawns`);
    assert(a.space.radius >= 4 && a.space.yKill < 0, `${a.world} space`);
    assert(((a.plane as { walls?: unknown[] }).walls ?? []).length >= 2, `${a.world} walls`);
  }
  return `temple ${T.arena.spawns.length} spawns in ${T.arena.space.radius} m, forge ${F.arena.spawns.length}, forge kills below ${F.arena.space.yKill}`;
});

/** two Characters and a match in play, free or locked, stepped together */
function bodies(locked: boolean) {
  const A = T.arena, plane = duelPlane(A);
  const terrain = { groundAt: T.world.groundAt };
  const a = new Character({ seat: 0, plane: locked ? plane : null, terrain }), b = new Character({ seat: 1, plane: locked ? plane : null, terrain });
  const m = new DuelMatch([a, b], A, plane, 0, 112);
  let now = 0;
  const step = (n: number, f?: () => void) => {
    for (let i = 0; i < n; i++) {
      now += 1000 / 60; const beat = (now * 112) / 60000; f?.();
      a.lookAt = b.root; b.lookAt = a.root;
      a.update(1 / 60, null, { beats: beat, bpm: 112 }); b.update(1 / 60, null, { beats: beat, bpm: 112 });
      m.step(now, beat, 112);
    }
  };
  step(Math.ceil(((DUEL.COUNT_FROM + 1) * 60000 / 112) / (1000 / 60)) + 70);
  return { a, b, m, step };
}

test('a real strike lands free in 3D, and knocks the other away along the ground in its direction', () => {
  const { a, b, m, step } = bodies(false);
  assert(m.state.phase === 'play' && !m.locked, `in play, free (${m.state.phase})`);
  // the two on a diagonal across the court, the attacker facing the other
  a.reset(-3, undefined, -1.5); b.reset(-2.45, undefined, -1.05);
  step(12);
  const x0 = b.root[0], z0 = b.root[2];
  a.startMove('strike');
  let hit: Extract<DuelEvent, { k: 'hit' }> | null = null;
  step(40, () => { for (const e of m.events) if (e.k === 'hit') hit = e; });
  assert(hit, 'the strike landed');
  const h = hit as unknown as Extract<DuelEvent, { k: 'hit' }>;
  const dx = b.root[0] - x0, dz = b.root[2] - z0;
  assert(h.knock.dir[0] > 0.3 && h.knock.dir[1] > 0.3, `knocked along the diagonal: ${h.knock.dir.map((v) => v.toFixed(2))}`);
  assert(dx > 0.2 && dz > 0.1, `moved away: ${dx.toFixed(2)}, ${dz.toFixed(2)}`);
  return `knock ${h.knock.dir.map((v) => v.toFixed(2))} × ${h.knock.along}`;
});

test('a real strike lands locked, along the plane', () => {
  const { a, b, m, step } = bodies(true);
  assert(m.locked, 'locked');
  a.reset(-3.2); b.reset(-2.6);
  step(2);
  const s0 = b.s;
  a.startMove('strike');
  step(40);
  assert(m.history.some((h) => h.e.k === 'hit'), 'the strike landed');
  assert(b.s > s0 + 0.2, `knocked along +s: ${s0.toFixed(2)} → ${b.s.toFixed(2)}`);
});

test('free, a body that leaves the space sideways meets a soft wall', () => {
  const { a, step } = bodies(false);
  const C = T.arena.space.center, R = T.arena.space.radius;
  a.reset(C[0] + R - 0.3, undefined, C[2]);
  let most = 0;
  step(150, () => { most = Math.max(most, Math.hypot(a.root[0] - C[0], a.root[2] - C[2])); a.v = [6, a.v[1], 0]; });
  assert(most < R + 0.9, `held within ${(most - R).toFixed(2)} m past the edge`);
  return `${(most - R).toFixed(2)} m past at most`;
});

test('jump height: the brain\'s model of the body\'s jump', () => {
  near(jumpHeight(10), 2.0, 0.05, 'the full jump');
  const h = holdFor(1.0);
  near(jumpHeight(h), 1.0, 0.02, 'a held hop');
  const c = new Character({ seat: 0, plane: duelPlane(T.arena) });
  c.reset(-3);
  let top = 0, t = 0;
  for (let i = 0; i < 90; i++) { t += 1 / 60; c.update(1 / 60, { jump: i === 0, jumpHeld: t <= h + 1e-9 }, null); top = Math.max(top, c.root[1]); }
  near(top, 1.0, 0.12, 'the body rose about as planned');
  return `hold ${h.toFixed(3)} s for 1 m, rose ${top.toFixed(2)} m`;
});

test('two virtual players finish a round in each arena, free and locked, deterministically, moving, jumping and dancing', () => {
  const out: string[] = [];
  for (const { arena: A, world: W } of [T, F]) for (const locked of [false, true]) {
    const run = () => simulateDuel({ arena: A, world: W, locked, brains: makeBrains(['aggressive', 'evasive'], [0.7, 0.7], [3, 9]), rounds: 1, seconds: 400 });
    const r1 = run(), r2 = run();
    const tag = `${A.world} ${locked ? 'locked' : 'free'}`;
    assert(r1.rounds.length === 1, `${tag}: a round finished in ${r1.seconds.toFixed(0)} s`);
    assert(r1.rounds[0].ms === r2.rounds[0].ms && r1.stats.hits === r2.stats.hits, `${tag}: the same seeds play the same duel`);
    for (const s of r1.seats) {
      assert(Object.keys(s.moves).length >= 4, `${tag}: each uses moves (${Object.keys(s.moves).length})`);
      assert(s.flowMax > 30, `${tag}: dancing built flow (${s.flowMax.toFixed(0)})`);
    }
    const jumps = r1.seats.reduce((a, s) => a + s.jumps + s.airJumps + s.wallJumps, 0);
    assert(jumps >= 4, `${tag}: they jump (${jumps})`);
    out.push(`${tag} ${(r1.rounds[0].ms / 1000).toFixed(0)} s ${r1.rounds[0].kos.join('-')}`);
  }
  return out.join(', ');
});

test('free, the virtual players dance between exchanges: flourishes on the beat, and a fight in 3D (not on a line)', () => {
  const r = simulateDuel({ arena: T.arena, world: T.world, brains: makeBrains(['showy', 'aggressive'], [0.7, 0.7], [4, 12]), rounds: 1, seconds: 300 });
  const fl = ['au', 'macaco', 'spin'].reduce((a, k) => a + (r.seats[0].moves[k] ?? 0) + (r.seats[1].moves[k] ?? 0), 0);
  assert(fl >= 6, `${fl} flourishes`);
  let zs = 0;
  const C = T.arena.space.center;
  simulateDuel({ arena: T.arena, world: T.world, brains: makeBrains(['showy', 'aggressive'], [0.7, 0.7], [4, 12]), rounds: 1, seconds: 60, each: (f) => { zs = Math.max(zs, Math.abs(f.bodies[0].root[2] - C[2]), Math.abs(f.bodies[1].root[2] - C[2])); } });
  assert(zs > 1.0, `off the stage's line: ${zs.toFixed(2)} m`);
  return `${fl} flourishes; ${zs.toFixed(1)} m off the line`;
});

test('a better player beats a worse one more often than not', () => {
  let good = 0;
  const N = 6;
  for (let k = 0; k < N; k++) {
    const r = simulateDuel({ arena: T.arena, world: T.world, brains: makeBrains(['aggressive', 'aggressive'], [0.95, 0.2], [11 + k, 31 + k]), rounds: 1, seconds: 400 });
    if (r.rounds[0]?.winner === 0) good++;
  }
  assert(good >= 4, `the good one won ${good} of ${N}`);
  return `${good} of ${N}`;
});

test('the brain holds its stick like a thumb: no flicker frame to frame', () => {
  let flips = 0, frames = 0, prev = '0,0';
  simulateDuel({
    arena: T.arena, world: T.world, brains: makeBrains(['showy', 'aggressive'], [0.6, 0.6], [5, 6]), rounds: 1, seconds: 60,
    each: (f) => { const s = `${f.intents[0].moveX},${f.intents[0].moveZ}`; if (s !== prev && prev !== '0,0' && s !== '0,0') flips++; prev = s; frames++; },
  });
  const perMin = flips / (frames / 3600);
  assert(perMin < 200, `${perMin.toFixed(0)} changes a minute`);
  assert(new DuelBrain().name.startsWith('duel'), 'named');
  return `${perMin.toFixed(0)} stick changes a minute (eight-way, moving to moving)`;
});

done();
