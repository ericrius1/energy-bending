// Unit tests for what the 3D game added to the rules (shared/rules.ts): guests beside the jogo's two seats, a world
// per dancer, the move's extra fields for the replay, and building (set pieces). Run: node test/room.test.ts
import assert from 'node:assert/strict';
import {
  RULES, createSession, tick, onMove as onMoveT, onForm, onMerge, publicState, setPresent, route as routeT,
  nextBar, gridError, onBuild, onBreak, pieceCost, piecesOf, type Session,
} from '../shared/rules.ts';
import { SEATS, SLOTS } from '../shared/protocol.ts';

const onMove = onMoveT as (s: Session, slot: number, msg: any, now: number) => any;
const route = routeT as (s: Session, slot: number, msg: any, now: number) => { out: any[]; changed: boolean };

let passed = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); passed++; console.log('ok  ', name); }
  catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; }
};
const near = (a: number, b: number, eps = 1e-6, msg?: string) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`);

function playing(stage = 'void'): { s: Session; t: number } {
  const s = createSession(stage, 0);
  setPresent(s, 0, true, 0);
  setPresent(s, 1, true, 0);
  const t = s.tEnd!;
  tick(s, t);
  assert.equal(s.phase, 'play');
  return { s, t };
}
let idn = 0;
const mv = (s: Session, seat: number, move: string, t: number, extra: object = {}) =>
  onMove(s, seat, { id: `${seat}-${++idn}`, move, ts: t, x: 0, y: 0.2, dir: 1, perfect: false, ...extra }, t);

test('guests: up to six more dancers, relayed, outside the meters; a guest leaving changes nothing', () => {
  const { s, t } = playing();
  assert.equal(SLOTS, 8); assert.equal(SEATS, 2);
  for (let g = SEATS; g < SLOTS; g++) setPresent(s, g, true, t, 'redwoods');
  assert.equal(publicState(s).slots.filter(Boolean).length, 8);
  assert.deepEqual(publicState(s).slots[3], { world: 'redwoods', player: false, present: true });
  assert.deepEqual(publicState(s).slots[0], { world: 'void', player: true, present: true });
  const flow = [...s.flow], axe = s.axe;
  const r = route(s, 4, { t: 'move', id: '4-1', move: 'armada', ts: t, x: 1, y: 0, dir: 1, perfect: true }, t);
  assert.equal(r.out.length, 1);
  assert.equal(r.out[0][0], 'others'); assert.equal(r.out[0][1].from, 4);
  assert.deepEqual(s.flow, flow); assert.equal(s.axe, axe);
  assert.equal(s.pending.size, 0, "a guest's attack can't be answered");
  assert.equal(route(s, 4, { t: 'move', id: '0-9', move: 'au', x: 0, y: 0, dir: 1 }, t + 500).out[0][1].reason, 'id');
  assert.equal(route(s, 5, { t: 'xch', id: 'x', res: 'dodge' }, t).out.length, 0);
  assert.equal(onForm(s, 5, true, t).ok, false);
  assert.equal(onMerge(s, 5, true, 0, t).ok, false);
  setPresent(s, 4, false, t + 100);
  assert.equal(s.phase, 'play', 'the jogo carries on');
  assert.equal(publicState(s).slots[4], null);
  setPresent(s, 1, false, t + 200);
  assert.equal(s.phase, 'waiting', 'a seat leaving does stop it');
  assert.ok(publicState(s).slots[2], 'guests stay');
});

test('guests move in any phase; seats only in play', () => {
  const s = createSession('void', 0);
  setPresent(s, 2, true, 0);
  assert.ok(onMove(s, 2, { id: '2-1', move: 'spin', x: 0, y: 0, dir: 1 }, 10).ok);
  setPresent(s, 0, true, 0);
  assert.equal(onMove(s, 0, { id: '0-1', move: 'spin', x: 0, y: 0, dir: 1 }, 10).reason, 'phase');
});

test('move extras: typed fields checked and clamped, unknown fields relayed untouched', () => {
  const { s, t } = playing();
  const r = onMove(s, 0, {
    t: 'move', id: '0-x1', move: 'martelo', ts: t, x: 1, y: 0, z: 2, dir: [0, 1],
    yaw: 1.25, aim3: [0.1, 1.2, 0.5], fdir: -3, vx: 1.5, vy: 0, vz: -2, air: true, bpm: 112, hand: 'L',
    style: { swing: 0.3 }, seed: 42, from: 7,
  }, t);
  assert.ok(r.ok);
  const m = r.move;
  assert.equal(m.t, 'move'); assert.equal(m.from, 0, 'the sender cannot claim another slot');
  assert.deepEqual([m.yaw, m.aim3, m.fdir, m.vx, m.vy, m.vz, m.air, m.bpm, m.hand], [1.25, [0.1, 1.2, 0.5], -1, 1.5, 0, -2, true, 112, 'L']);
  assert.deepEqual(m.style, { swing: 0.3 }); assert.equal(m.seed, 42);
  const bad = onMove(s, 1, { id: '1-x2', move: 'au', ts: t, x: 0, y: 0, dir: 1, yaw: 'north', aim3: [1, 2], fdir: [1], vx: NaN, air: 1, bpm: -5, hand: 'left' }, t).move;
  for (const k of ['yaw', 'aim3', 'fdir', 'vx', 'air', 'bpm', 'hand']) assert.ok(!(k in bad), k);
});

test('worlds per dancer: hello places it, travel moves one dancer; a seat also moves the jogo', () => {
  const s = createSession('geode', 0, 'geode');
  setPresent(s, 0, true, 0); setPresent(s, 1, true, 0); setPresent(s, 2, true, 0, 'redwoods');
  assert.deepEqual(publicState(s).slots.slice(0, 3).map((x) => x!.world), ['geode', 'geode', 'redwoods']);
  route(s, 2, { t: 'travel', world: 'tide', portal: 'p' }, 100);
  assert.equal(publicState(s).slots[2]!.world, 'tide'); assert.equal(s.world, 'geode', "a guest doesn't move the jogo");
  route(s, 1, { t: 'travel', world: 'redwoods' }, 100);
  assert.equal(s.world, 'redwoods'); assert.equal(publicState(s).slots[1]!.world, 'redwoods'); assert.equal(publicState(s).slots[0]!.world, 'geode');
});

// a session in play with seat 0 holding plenty of flow; onBeat(id) makes a move of seat 0's on a bar line
function builder() {
  const { s, t } = playing();
  let time = nextBar(s.music, t + 10);
  for (let i = 0; i < 12; i++) mv(s, 0, ['meia-lua', 'armada', 'martelo'][i % 3], time += 150);
  const on = nextBar(s.music, time + 200);
  return { s, t: on, onBeat: (id: string) => onMove(s, 0, { id, move: 'au', ts: on, x: 0, y: 0, dir: 1 }, on) };
}
const line = (x0: number, len: number) => [x0, 0, 0, x0 + len, 0, 0];

test("build: a move on the beat with flow to pay sets a piece in the dancer's world", () => {
  const { s, t, onBeat } = builder();
  assert.ok(onBeat('0-b1').ok);
  const flow = s.flow[0], cost = pieceCost('ice', line(0, 2000), 300);
  near(cost, 1 * (4 + 2 * 2 + 4 * 0.3), 1e-9);
  const r: any = onBuild(s, 0, { move: '0-b1', kind: 'ice', points: line(0, 2000), width: 300 }, t + 30);
  assert.ok(r.ok, r.reason);
  near(s.flow[0], flow - cost, 1e-9);
  assert.deepEqual(r.piece, { id: 'p1', kind: 'ice', world: 'void', by: 0, t: Math.round(t + 30), points: line(0, 2000), width: 300, life: RULES.build.kinds.ice.life });
  assert.deepEqual(r.events.at(-1), { k: 'set', piece: r.piece });
  assert.equal(publicState(s).pieces, 1);
  assert.deepEqual(piecesOf(s), [r.piece]);
  assert.equal((onBuild(s, 0, { move: '0-b1', kind: 'ice', points: line(0, 100), width: 300 }, t + 40) as any).reason, 'move', 'one piece per move');
});

test('build refusals: off the beat, no flow, guest, bad shapes, unknown kind or move', () => {
  const { s, t } = builder();
  const why = (m: object, at = t + 20) => (onBuild(s, 0, m, at) as any).reason;
  assert.ok(onMove(s, 0, { id: '0-off', move: 'spin', ts: t + 140, x: 0, y: 0, dir: 1 }, t + 140).ok);
  assert.ok(Math.abs(gridError(s.music, t + 140, RULES.build.GRID)) > RULES.build.BEAT_MS);
  assert.equal(why({ move: '0-off', kind: 'ice', points: line(0, 1000), width: 200 }, t + 160), 'beat');
  const ok = onMove(s, 0, { id: '0-ok2', move: 'au', ts: t, x: 0, y: 0, dir: 1 }, t + 300);
  assert.ok(ok.ok, ok.reason);
  const w = (m: object) => why({ move: '0-ok2', ...m }, t + 320);
  assert.equal(w({ kind: 'lava', points: line(0, 1000), width: 200 }), 'kind');
  assert.equal(why({ move: '0-nope', kind: 'ice', points: line(0, 1000), width: 200 }), 'move');
  assert.equal(w({ kind: 'ice', points: [0, 0], width: 200 }), 'bad');
  assert.equal(w({ kind: 'ice', points: new Array(3 * 17).fill(0), width: 200 }), 'bad');
  assert.equal(w({ kind: 'ice', points: line(0, 1000), width: 'wide' }), 'bad');
  assert.equal(w({ kind: 'ice', points: line(0, 17000), width: 200 }), 'long');
  s.flow[0] = 1;
  assert.equal(w({ kind: 'ice', points: line(0, 1000), width: 200 }), 'flow');
  setPresent(s, 3, true, t);
  onMove(s, 3, { id: '3-1', move: 'au', ts: t, x: 0, y: 0, dir: 1 }, t);
  assert.equal((onBuild(s, 3, { move: '3-1', kind: 'ice', points: line(0, 1000), width: 200 }, t + 10) as any).reason, 'guest');
  const r = route(s, 0, { t: 'build', move: '0-ok2', kind: 'ice', points: line(0, 1000), width: 200 }, t + 320);
  assert.deepEqual(r.out[0], [0, { t: 'no', of: 'build', id: '0-ok2', reason: 'flow' }]);
});

test('set pieces expire on their own, melt (ice only) and shatter; a cap drops the oldest', () => {
  const { s, t, onBeat } = builder();
  onBeat('0-a');
  const a: any = onBuild(s, 0, { move: '0-a', kind: 'ice', points: line(0, 500), width: 100, life: 5000 }, t);
  assert.ok(a.ok);
  const ev = tick(s, t + 5001);
  assert.deepEqual(ev.find((e) => e.k === 'expire'), { k: 'expire', id: a.piece.id, reason: 'life' });
  assert.equal(s.pieces.length, 0);
  const t2 = nextBar(s.music, t + 6000);
  onMove(s, 0, { id: '0-b', move: 'spin', ts: t2, x: 0, y: 0, dir: 1 }, t2);
  const b: any = onBuild(s, 0, { move: '0-b', kind: 'ice', points: line(0, 500), width: 100 }, t2);
  assert.ok(b.ok, b.reason);
  setPresent(s, 2, true, t2, 'elsewhere');
  assert.equal(onBreak(s, 2, 'melt', { id: b.piece.id }, t2 + 10).reason, 'world', 'only from the same world');
  const m = onBreak(s, 1, 'melt', { id: b.piece.id }, t2 + 10);
  assert.ok(m.ok);
  assert.deepEqual(m.events[0], { k: 'melt', id: b.piece.id, by: 1, at: Math.round(t2 + 10), tEnd: Math.round(t2 + 10) + RULES.build.MELT_MS });
  assert.equal(onBreak(s, 0, 'melt', { id: b.piece.id }, t2 + 200).reason, 'kind', 'already melting');
  assert.deepEqual(tick(s, Math.round(t2 + 10) + RULES.build.MELT_MS).find((e) => e.k === 'expire'), { k: 'expire', id: b.piece.id, reason: 'melt' });
  const t3 = nextBar(s.music, t2 + 6000);
  onMove(s, 0, { id: '0-c', move: 'au', ts: t3, x: 0, y: 0, dir: 1 }, t3);
  s.flow[0] = 100;
  const c: any = onBuild(s, 0, { move: '0-c', kind: 'gems', points: [0, 0, 0, 0, 2000, 0], width: 400 }, t3);
  assert.ok(c.ok, c.reason);
  assert.equal(onBreak(s, 1, 'melt', { id: c.piece.id }, t3 + 10).reason, 'kind', "gems don't melt");
  assert.deepEqual(onBreak(s, 1, 'shatter', { id: c.piece.id }, t3 + 200).events, [{ k: 'shatter', id: c.piece.id, by: 1 }]);
  assert.equal(s.pieces.length, 0);
  // the cap per dancer: past it, the oldest goes
  let time = t3 + 4000;
  const ids: string[] = [];
  for (let i = 0; i < RULES.build.CAP_SLOT + 2; i++) {
    time = nextBar(s.music, time + 10);
    s.flow[0] = 100;
    onMove(s, 0, { id: `0-cap${i}`, move: i % 2 ? 'au' : 'spin', ts: time, x: 0, y: 0, dir: 1 }, time);
    const r: any = onBuild(s, 0, { move: `0-cap${i}`, kind: 'ice', points: line(i * 1000, 500), width: 100 }, time);
    assert.ok(r.ok, r.reason);
    ids.push(r.piece.id);
    if (i >= RULES.build.CAP_SLOT) assert.deepEqual(r.events[0], { k: 'expire', id: ids[i - RULES.build.CAP_SLOT], reason: 'cap' });
  }
  assert.equal(s.pieces.length, RULES.build.CAP_SLOT);
  assert.ok(publicState(s).piecesRev > 0);
});

test('pieces outlive the jogo: a seat leaving resets the meters, not the world', () => {
  const { s, t, onBeat } = builder();
  onBeat('0-k');
  assert.ok(onBuild(s, 0, { move: '0-k', kind: 'gems', points: line(0, 500), width: 100 }, t).ok);
  setPresent(s, 1, false, t + 10);
  assert.equal(s.phase, 'waiting'); assert.equal(s.pieces.length, 1);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
