// The duel's rules (shared/duel.ts) on plain data, then joined to real bodies (match.ts), then two virtual players
// dueling in Node (sim.ts). Run by scripts/test-ts.mjs (npm test).
import { test, assert, near, done } from '../../dancer/test/check';
import { DUEL, newDuel, duelStep, frozen, untouchable, onBeat, type DuelBody, type DuelEvent, type DuelState } from '../../../shared/duel.ts';
import { Character } from '../../dancer/character';
import { DuelMatch, duelPlane } from '../match';
import { fallbackArena } from '../fallback';
import { stageFor } from '../stages';
import { simulateDuel, makeBrains } from '../sim';
import { DuelBrain, holdFor, jumpHeight } from '../../ai/duel-brain';

const arena = { spawns: [[-2, 0], [2, 0], [-4, 0], [4, 0], [0, 1.1]] as [number, number][], yKill: -2.2, bpm: 120 };
/** a standing body at s: a column for its hurt shape, and a strike reaching `reach` forward when `serial` is set */
const body = (s: number, o: Partial<DuelBody> & { reach?: number } = {}): DuelBody => {
  const f = o.facing ?? 1, reach = o.reach ?? 0;
  return {
    s, y: 0, hurt: [{ ax: s, ay: 0.2, bx: s, by: 1.5, r: 0.18 }],
    hit: reach ? [{ ax: s + f * 0.3, ay: 1.1, bx: s + f * reach, by: 1.1, r: 0.05 }] : [],
    move: reach ? 'strike' : null, serial: 0, moveBeat: null, facing: f, invulnerable: false, blocking: false, ...o,
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
  let t = 0;
  for (; t < 3000; t += 10) {
    seen.push(...duelStep(d, t, [body(-2), body(2, { facing: -1 })], arena));
    if (d.phase === 'countdown') assert(frozen(d, 0) && frozen(d, 1), 'held in the count-in');
  }
  const ks = kinds(seen);
  assert(ks[0] === 'round', `starts a round: ${ks.join(',')}`);
  assert(seen.filter((e) => e.k === 'count').map((e) => (e as { n: number }).n).join() === '3,2,1', 'counts 3, 2, 1');
  assert(ks.includes('go') && d.phase === 'play' && !frozen(d, 0), 'then play');
  const go = seen.indexOf(seen.find((e) => e.k === 'go')!);
  assert(go > 0, 'go after the count');
  return `play from ${d.playFrom} ms`;
});

test('a strike that meets the body hits once; three hits are a KO', () => {
  const { d, t } = playing();
  let ev = duelStep(d, t, [body(-0.6, { reach: 0.9, serial: 5 }), body(0.2, { facing: -1 })], arena);
  const h = ev.find((e) => e.k === 'hit') as Extract<DuelEvent, { k: 'hit' }>;
  assert(h && h.by === 0 && h.target === 1 && h.hits === 1, `a hit: ${kinds(ev)}`);
  assert(h.knock[0] > 0, 'knocked away from the attacker');
  ev = duelStep(d, t + 16, [body(-0.6, { reach: 0.9, serial: 5 }), body(0.2, { facing: -1 })], arena);
  assert(!ev.some((e) => e.k === 'hit'), 'the same attack lands once');
  duelStep(d, t + 300, [body(-0.6, { reach: 0.9, serial: 6 }), body(0.2, { facing: -1 })], arena);
  ev = duelStep(d, t + 600, [body(-0.6, { reach: 0.9, serial: 7 }), body(0.2, { facing: -1 })], arena);
  const ko = ev.find((e) => e.k === 'ko') as Extract<DuelEvent, { k: 'ko' }>;
  assert(ko && ko.target === 1 && ko.by === 0 && ko.how === 'hits' && d.seats[0].kos === 1, `the third is a KO: ${kinds(ev)}`);
  assert(frozen(d, 1) && untouchable(d, 1, t + 600), 'scattered: held and untouchable');
});

test('a KO re-forms at the spawn farthest from the other, then is untouchable for a second', () => {
  const { d, t } = playing();
  for (let k = 0; k < 3; k++) duelStep(d, t + k * 100, [body(3.4, { reach: 0.9, serial: 10 + k }), body(4.2, { facing: -1 })], arena);
  assert(d.seats[1].life === 'scattered', 'KO');
  let at: [number, number] | null = null, ready = -1;
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
  near(h2.knock[0], h1.knock[0] * DUEL.PERFECT_KNOCK, 1e-9, 'double');
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
  assert(d.phase === 'won', 'won');
  const later = duelStep(d, u + DUEL.WON_MS + 10, [body(-0.6), body(0.2, { facing: -1 })], arena);
  assert(later.some((e) => e.k === 'round') && d.round === 2 && d.seats[0].kos === 0 && (d.phase as string) === 'countdown', 'round 2');
  return `round 1 lasted ${(won.ms / 1000).toFixed(1)} s`;
});

// ---------------------------------------------------------------- real bodies
const temple = fallbackArena('temple', stageFor('temple')!);
const forge = fallbackArena('forge', stageFor('forge')!);

test('the fallback arenas: four spawns or more, a kill floor, the solid ledges as walls', () => {
  for (const a of [temple, forge]) {
    assert(a.spawns.length >= 4, `${a.world}: ${a.spawns.length} spawns`);
    assert(a.bounds.yKill < 0, `${a.world} kill floor`);
    assert(((a.plane as { walls?: unknown[] }).walls ?? []).length >= 2, `${a.world} walls`);
  }
  return `temple ${temple.spawns.length} spawns, forge ${forge.spawns.length}, forge kills below ${forge.bounds.yKill}`;
});

test('a real strike from a Character in reach lands and knocks the other along the plane', () => {
  const plane = duelPlane(temple);
  const a = new Character({ seat: 0, plane }), b = new Character({ seat: 1, plane });
  const m = new DuelMatch([a, b], temple, plane, 0, 112);
  let now = 0, beat = 0;
  const step = (n: number, f?: () => void) => {
    for (let i = 0; i < n; i++) {
      now += 1000 / 60; beat = (now * 112) / 60000; f?.();
      a.lookAt = b.root; b.lookAt = a.root;
      a.update(1 / 60, null, { beats: beat, bpm: 112 }); b.update(1 / 60, null, { beats: beat, bpm: 112 });
      m.step(now, beat, 112);
    }
  };
  step(Math.ceil(((DUEL.COUNT_FROM + 1) * 60000 / 112) / (1000 / 60)) + 70);
  assert(m.state.phase === 'play', `in play (${m.state.phase})`);
  a.reset(-3.2); b.reset(-2.6);
  step(2);
  const s0 = b.s;
  a.startMove('strike');
  let hit = false;
  step(40, () => { if (m.events.some((e) => e.k === 'hit')) hit = true; });
  assert(hit || m.history.some((h) => h.e.k === 'hit'), 'the strike landed');
  assert(b.s > s0 + 0.2, `knocked along +s: ${s0.toFixed(2)} → ${b.s.toFixed(2)}`);
  assert(m.state.seats[1].hits === 1, 'one hit');
});

test('jump height: the brain\'s model of the body\'s jump', () => {
  near(jumpHeight(10), 2.0, 0.05, 'the full jump');
  const h = holdFor(1.0);
  near(jumpHeight(h), 1.0, 0.02, 'a held hop');
  // against the body itself: hold the jump that long and see how high it goes
  const plane = duelPlane(temple);
  const c = new Character({ seat: 0, plane });
  c.reset(-3);
  let top = 0, t = 0;
  for (let i = 0; i < 90; i++) { t += 1 / 60; c.update(1 / 60, { jump: i === 0, jumpHeld: t <= h + 1e-9 }, null); top = Math.max(top, c.root[1]); }
  near(top, 1.0, 0.12, 'the body rose about as planned');
  return `hold ${h.toFixed(3)} s for 1 m, rose ${top.toFixed(2)} m`;
});

test('two virtual players finish a round in each arena, deterministically, moving and jumping', () => {
  const out: string[] = [];
  for (const A of [temple, forge]) {
    const r1 = simulateDuel({ arena: A, brains: makeBrains(['aggressive', 'evasive'], [0.7, 0.7], [3, 9]), rounds: 1, seconds: 300 });
    const r2 = simulateDuel({ arena: A, brains: makeBrains(['aggressive', 'evasive'], [0.7, 0.7], [3, 9]), rounds: 1, seconds: 300 });
    assert(r1.rounds.length === 1, `${A.world}: a round finished in ${r1.seconds.toFixed(0)} s`);
    assert(r1.rounds[0].ms === r2.rounds[0].ms && r1.stats.hits === r2.stats.hits, `${A.world}: the same seeds play the same duel`);
    for (const s of r1.seats) assert(s.jumps > 3 && Object.keys(s.moves).length >= 4, `${A.world}: each jumps and uses moves`);
    out.push(`${A.world} ${(r1.rounds[0].ms / 1000).toFixed(0)} s ${r1.rounds[0].kos.join('-')}`);
  }
  return out.join(', ');
});

test('a better player beats a worse one more often than not', () => {
  let good = 0;
  const N = 6;
  for (let k = 0; k < N; k++) {
    const r = simulateDuel({ arena: temple, brains: makeBrains(['aggressive', 'aggressive'], [0.95, 0.2], [11 + k, 31 + k]), rounds: 1, seconds: 400 });
    if (r.rounds[0]?.winner === 0) good++;
  }
  assert(good >= 4, `the good one won ${good} of ${N}`);
  return `${good} of ${N}`;
});

test('the brain holds its stick like a thumb: no flicker frame to frame', () => {
  let flips = 0, frames = 0, prev = 0;
  simulateDuel({
    arena: temple, brains: makeBrains(['showy', 'aggressive'], [0.6, 0.6], [5, 6]), rounds: 1, seconds: 60,
    each: (f) => { const x = f.intents[0].moveX; if (x !== prev && prev !== 0 && x !== 0) flips++; prev = x; frames++; },
  });
  const perMin = flips / (frames / 3600);
  assert(perMin < 90, `${perMin.toFixed(0)} reversals a minute`);
  assert(new DuelBrain().name.startsWith('duel'), 'named');
  return `${perMin.toFixed(0)} stick reversals a minute`;
});

done();
