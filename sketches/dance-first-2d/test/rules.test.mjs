// Unit tests for shared/rules.js (the Jogo session model). Run: node test/rules.test.mjs
import assert from 'node:assert/strict';
import {
  RULES, createSession, tick, onMove, onExchange, onForm, onMerge, onReady, publicState,
  setPresent, route, barMs, nextBar, gridError,
} from '../shared/rules.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('ok  ', name); }
  catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; }
};
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`);

// A session already in play. Returns { s, t } with t the current time.
function playing(stage = 'void') {
  const s = createSession(stage, 0);
  setPresent(s, 0, true, 0);
  setPresent(s, 1, true, 0);
  assert.equal(s.phase, 'intro');
  const t = s.tEnd;
  tick(s, t);
  assert.equal(s.phase, 'play');
  return { s, t };
}
let idn = 0;
const mv = (s, seat, move, t, extra = {}) => onMove(s, seat, { id: `${seat}-${++idn}`, move, ts: t, x: 0, y: 0.2, dir: 1, perfect: false, ...extra }, t);

test('RULES lists every move name with attack and flow', () => {
  const names = ['ginga', 'meia-lua', 'armada', 'martelo', 'bencao', 'rasteira', 'strike', 'throw', 'au', 'macaco', 'role', 'esquiva', 'block', 'spin', 'jump'];
  for (const n of names) {
    assert.ok(RULES.moves[n], n);
    assert.equal(typeof RULES.moves[n].attack, 'boolean', n);
    assert.ok(RULES.moves[n].flow > 0, n);
  }
  assert.deepEqual(Object.keys(RULES.moves).sort(), [...names].sort());
  for (const k of ['SESSION_MS', 'PERFECT_MS', 'PARRY_MS', 'FUSION_BARS', 'FORM_ENTER', 'FORM_DRAIN']) assert.ok(RULES[k] > 0, k);
  assert.equal(RULES.FORM_ENTER, 30); assert.equal(RULES.FORM_DRAIN, 6); assert.equal(RULES.SESSION_MS, 180000);
});

test('perfect timing grid: 8th notes, 55 ms', () => {
  assert.equal(RULES.PERFECT_GRID, 2); assert.equal(RULES.PERFECT_MS, 55);
  const music = { epoch: 1000, bpm: 112, mood: 0 }, eighth = 60000 / 112 / 2;
  near(gridError(music, 1000 + 3 * eighth + 20), 20, 1e-9);
  near(gridError(music, 1000 + 3 * eighth - 30), -30, 1e-9);
  near(gridError(music, 1000 + eighth / 2 - 1), eighth / 2 - 1, 1e-9);     // an odd 16th is far from the grid
  near(gridError(music, 1000 + 60000 / 112 / 4 + 10, 1), 10, 1e-9);         // grid = 1 judges 16ths
});

test('waiting -> intro (>= 3 s, on a bar line) -> play; music clock', () => {
  const s = createSession('redwoods', 1000);
  assert.equal(s.phase, 'waiting');
  assert.deepEqual(publicState(s).music, { epoch: 1000, bpm: 112, mood: 1 });
  setPresent(s, 0, true, 1500);
  assert.equal(s.phase, 'waiting');
  setPresent(s, 1, true, 2000);
  assert.equal(s.phase, 'intro');
  assert.ok(s.tEnd - 2000 >= 3000);
  near(((s.tEnd - 1000) / barMs(s.music)) % 1, 0, 1e-9, 'intro end on bar');
  tick(s, s.tEnd - 1); assert.equal(s.phase, 'intro');
  tick(s, s.tEnd); assert.equal(s.phase, 'play');
  near(s.tEnd - s.sessionEnd, 0); near(s.sessionEnd - nextBar(s.music, 5000), RULES.SESSION_MS, 1e-6);
  const st = publicState(s);
  for (const k of ['phase', 'tension', 'axe', 'streak', 'flow', 'form', 'mergeReady', 'fusion', 'stage', 'tEnd', 'results', 'music']) assert.ok(k in st, k);
  assert.equal(st.stage, 'redwoods');
});

test('moves and xch rejected outside play/fusion/finale', () => {
  const s = createSession('void', 0);
  assert.equal(mv(s, 0, 'strike', 10).reason, 'phase');
  setPresent(s, 0, true, 0); setPresent(s, 1, true, 0);
  assert.equal(mv(s, 0, 'strike', 20).reason, 'phase');               // intro
  const r = route(s, 0, { t: 'move', id: '0-x', move: 'strike', ts: 30, x: 0, y: 0, dir: 1 }, 30);
  assert.deepEqual(r.out[0], [0, { t: 'no', id: '0-x', reason: 'phase' }]);
});

test('flow: per move, more when perfect, less on the third repeat, capped', () => {
  const { s, t } = playing();
  assert.ok(mv(s, 0, 'meia-lua', t).ok);
  near(s.flow[0], 6);
  mv(s, 0, 'meia-lua', t + 200, { perfect: true });
  near(s.flow[0], 6 + 9);
  mv(s, 0, 'meia-lua', t + 400);                                       // third running
  near(s.flow[0], 15 + 6 * RULES.REPEAT_FLOW);
  mv(s, 0, 'armada', t + 600);
  near(s.flow[0], 16.5 + 7);
  assert.equal(s.perfect[0], 1);
  assert.equal(s.axe, RULES.PERFECT_AXE);
  for (let i = 0; i < 40; i++) mv(s, 1, i % 2 ? 'au' : 'macaco', t + 1000 + i * 150);
  assert.equal(s.flow[1], 100);
});

test('move validation: rate limit, id, name, position', () => {
  const { s, t } = playing();
  assert.ok(mv(s, 0, 'strike', t).ok);
  assert.equal(mv(s, 0, 'strike', t + 50).reason, 'rate');
  assert.ok(mv(s, 1, 'strike', t + 50).ok);                            // per seat
  assert.ok(mv(s, 0, 'strike', t + 100).ok);
  assert.equal(onMove(s, 0, { id: '1-z', move: 'strike', x: 0, y: 0, dir: 1 }, t + 300).reason, 'id');
  assert.equal(onMove(s, 0, { id: '0-z', move: 'toString', x: 0, y: 0, dir: 1 }, t + 300).reason, 'move');
  assert.equal(onMove(s, 0, { id: '0-z', move: 'strike', x: NaN, y: 0, dir: 1 }, t + 300).reason, 'bad');
  assert.ok(onMove(s, 0, { id: '0-z', move: 'strike', x: 0, y: 0, dir: -1, aim: [0.3, 0.4] }, t + 300).move.aim);
  assert.equal(onMove(s, 0, { id: '0-z', move: 'strike', x: 0, y: 0, dir: 1 }, t + 500).reason, 'id');  // reused id
});

test('each exchange result: tension, streak, axé multiplier', () => {
  const { s, t } = playing();
  let time = t, axe = 0, streak = 0, tension = 0;
  for (const res of ['dodge', 'clash', 'parry', 'near']) {
    const m = mv(s, 0, 'martelo', time += 200).move;
    const r = onExchange(s, 1, { id: m.id, res }, time + 10);
    assert.ok(r.ok, res);
    streak++; tension += RULES.xch[res].tension; axe += RULES.xch[res].axe * Math.min(3, 1 + 0.1 * streak);
    assert.equal(r.result.streak, streak);
    near(r.result.tension, tension, 1e-9, res);
    assert.equal(r.result.axe, Math.round(axe));
    assert.equal(r.result.by, 0); assert.equal(r.result.target, 1); assert.equal(r.result.res, res);
    assert.ok(Array.isArray(r.result.flow));
  }
  assert.deepEqual([RULES.xch.dodge.tension, RULES.xch.clash.tension, RULES.xch.parry.tension, RULES.xch.near.tension, RULES.xch.hit.tension], [10, 8, 8, 4, 2]);
  assert.equal(s.dodges[1], 1);
  assert.equal(s.bestStreak, 4);
});

test('a hit resets the streak and costs the hit dancer 10 flow', () => {
  const { s, t } = playing();
  for (let i = 0; i < 6; i++) mv(s, 1, i % 2 ? 'au' : 'macaco', t + i * 150);
  const f1 = s.flow[1];
  const a = mv(s, 0, 'strike', t + 1000).move;
  onExchange(s, 1, { id: a.id, res: 'dodge' }, t + 1100);
  assert.equal(s.streak, 1);
  const b = mv(s, 0, 'strike', t + 1200).move;
  const r = onExchange(s, 1, { id: b.id, res: 'hit' }, t + 1300);
  assert.equal(r.result.streak, 0);
  near(s.flow[1], f1 - 10);
  near(s.tension, 12);
  assert.equal(s.bestStreak, 1);
});

test('xch only from the non-mover, once per id, attack moves only, expires after 4 s', () => {
  const { s, t } = playing();
  const a = mv(s, 0, 'rasteira', t).move;
  assert.equal(onExchange(s, 0, { id: a.id, res: 'dodge' }, t + 10).reason, 'seat');
  assert.equal(onExchange(s, 1, { id: a.id, res: 'great' }, t + 10).reason, 'bad');
  assert.ok(onExchange(s, 1, { id: a.id, res: 'near' }, t + 20).ok);
  assert.equal(onExchange(s, 1, { id: a.id, res: 'near' }, t + 30).reason, 'unknown');
  const g = mv(s, 0, 'au', t + 200).move;                              // not an attack
  assert.equal(onExchange(s, 1, { id: g.id, res: 'dodge' }, t + 210).reason, 'unknown');
  const old = mv(s, 0, 'throw', t + 400).move;
  tick(s, t + 400 + RULES.MOVE_TTL_MS + 1);
  assert.equal(onExchange(s, 1, { id: old.id, res: 'dodge' }, t + 4500).reason, 'unknown');
});

test('echo within a bar, unison within a 16th, each move matched once, ginga ignored', () => {
  const { s, t } = playing();
  mv(s, 0, 'au', t);
  const e = mv(s, 1, 'au', t + 1000);
  assert.equal(e.events[0].k, 'echo');
  near(s.tension, RULES.echo.tension);
  assert.equal(mv(s, 1, 'au', t + 1200).events.length, 0);              // seat 0's au already used
  mv(s, 0, 'spin', t + 3000);
  const u = mv(s, 1, 'spin', t + 3000 + 100);                           // 100 ms < one 16th (134 ms)
  assert.equal(u.events[0].k, 'unison');
  near(s.tension, RULES.echo.tension + RULES.unison.tension);
  mv(s, 0, 'jump', t + 5000);
  assert.equal(mv(s, 1, 'jump', t + 5000 + barMs(s.music) + 10).events.length, 0);   // over a bar apart
  mv(s, 0, 'ginga', t + 9000);
  assert.equal(mv(s, 1, 'ginga', t + 9010).events.length, 0);
  assert.equal(RULES.echo.tension, 6); assert.equal(RULES.unison.tension, 12);
});

test('power form: enter needs 30 flow, drains 6/s, ends at 0 with formOff', () => {
  const { s, t } = playing();
  assert.equal(onForm(s, 0, true, t).reason, 'flow');
  let time = t;
  while (s.flow[0] < 30) mv(s, 0, ['meia-lua', 'armada', 'martelo'][idn % 3], time += 150);
  const f = s.flow[0];
  assert.ok(onForm(s, 0, true, time).ok);
  assert.equal(publicState(s).form[0], 1);
  tick(s, time); tick(s, time + 1000);
  near(s.flow[0], f - 6, 1e-9);
  let ev = [];
  for (let k = 1; k <= 20 && s.form[0]; k++) ev = ev.concat(tick(s, time + 1000 + k * 1000));
  assert.equal(s.form[0], 0); assert.equal(s.flow[0], 0);
  assert.deepEqual(ev.find(e => e.k === 'formOff'), { k: 'formOff', seat: 0, reason: 'drain' });
});

function toMergeReady(s, t) {
  let time = t, ev = [];
  while (s.tension < 100) {
    const a = mv(s, 0, 'strike', time += 150).move;
    ev = ev.concat(onExchange(s, 1, { id: a.id, res: 'dodge' }, time).events);
  }
  return { time, ev };
}

test('mergeReady at tension 100', () => {
  const { s, t } = playing();
  const { ev } = toMergeReady(s, t);
  assert.equal(s.tension, 100); assert.equal(s.mergeReady, true);
  assert.equal(ev.filter(e => e.k === 'mergeReady').length, 1);
});

test('fusion: both hold merge within 0.25 -> starts on the next bar, kind from forms, 8 bars, axé x2, tension drains, release', () => {
  const { s, t } = playing();
  let { time } = toMergeReady(s, t);
  assert.equal(onMerge(s, 0, true, 0.2, time).events.length, 0);
  // the smaller of the two reported distances is used (each client sees the other with lag)
  assert.equal(onMerge(s, 1, true, 0.4, time).events[0].k, 'fusion');
  assert.ok(s.fusion, 'fusion scheduled by the closer report');
  const f = s.fusion, bar = barMs(s.music);
  assert.equal(f.kind, 'steam');
  near(((f.t0 - s.music.epoch) / bar) % 1, 0, 1e-9, 't0 on bar');
  assert.ok(f.t0 >= time && f.t0 - time <= bar);
  near(f.tEnd - f.t0, 8 * bar, 1e-6);
  assert.equal(s.phase, 'play');
  tick(s, f.t0);
  assert.equal(s.phase, 'fusion'); assert.equal(s.mergeReady, false); assert.equal(s.fusions, 1);
  tick(s, f.t0 + 4 * bar);
  near(s.tension, 50, 0.01);
  const axe0 = s.axe;
  const a = mv(s, 0, 'strike', f.t0 + 4 * bar).move;
  onExchange(s, 1, { id: a.id, res: 'near' }, f.t0 + 4 * bar + 1);
  near(s.axe - axe0, RULES.xch.near.axe * Math.min(3, 1 + 0.1 * s.streak) * 2, 1e-9);
  near(s.tension, 50, 0.01, 'no tension gain in fusion');
  const ev = tick(s, f.tEnd);
  assert.equal(s.phase, 'release'); assert.equal(s.tension, 0); assert.equal(s.fusion, null);
  assert.equal(ev[0].k, 'release');
  near(s.tEnd - f.tEnd, bar, 1e-6);
  tick(s, s.tEnd);
  assert.equal(s.phase, 'play'); assert.equal(s.tEnd, s.sessionEnd);
});

test('no fusion when apart, not holding, or not mergeReady', () => {
  const { s, t } = playing();
  onMerge(s, 0, true, 0.1, t); onMerge(s, 1, true, 0.1, t);
  assert.equal(s.fusion, null);                                        // not ready
  const { time } = toMergeReady(s, t);
  assert.ok(s.fusion, 'already holding and close when tension reached 100');
  const s2 = playing().s; toMergeReady(s2, t);
  onMerge(s2, 0, true, 0.5, time); onMerge(s2, 1, true, 0.6, time);
  assert.equal(s2.fusion, null);
  onMerge(s2, 1, false, 0.1, time); assert.equal(s2.fusion, null);
});

test('fusion kinds from the two forms', () => {
  const kinds = {};
  for (const [f0, f1] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    const { s, t } = playing();
    const { time } = toMergeReady(s, t);
    s.form = [f0, f1];
    onMerge(s, 0, true, 0.1, time); onMerge(s, 1, true, 0.1, time);
    kinds[`${f0}${f1}`] = s.fusion.kind;
  }
  assert.deepEqual(kinds, { '00': 'steam', '01': 'prism', '10': 'storm', '11': 'aurora' });
});

test('finale: 4 bars, auto fusion at tension >= 50, then over with results; ready x2 restarts', () => {
  const { s, t } = playing();
  let time = t;
  for (let i = 0; i < 6; i++) { const a = mv(s, 0, 'strike', time += 150).move; onExchange(s, 1, { id: a.id, res: 'dodge' }, time); }
  mv(s, 1, 'au', time += 150); mv(s, 1, 'macaco', time += 150);
  assert.equal(s.tension, 60);
  const ev = tick(s, s.sessionEnd);
  assert.equal(s.phase, 'finale');
  assert.equal(ev[0].k, 'fusion'); assert.equal(ev[0].finale, true);
  assert.equal(s.fusion.kind, 'steam');
  near(s.tEnd - s.sessionEnd, 4 * barMs(s.music), 1e-6);
  assert.ok(mv(s, 0, 'armada', s.sessionEnd + 100).ok, 'moves accepted in finale');
  tick(s, s.tEnd);
  assert.equal(s.phase, 'over'); assert.equal(s.tEnd, null);
  const r = publicState(s).results;
  assert.equal(r.fusions, 1); assert.equal(r.bestStreak, 6); assert.equal(r.axe, Math.round(s.axe));
  assert.deepEqual(r.dodges, [0, 6]); assert.deepEqual(r.distinct, [2, 2]); assert.deepEqual(r.perfect, [0, 0]);
  assert.equal(mv(s, 0, 'strike', s.lastTick + 500).reason, 'phase');
  assert.ok(onReady(s, 0, s.lastTick + 1000).ok);
  assert.equal(s.phase, 'over');
  onReady(s, 1, s.lastTick + 1000);
  assert.equal(s.phase, 'intro'); assert.equal(s.axe, 0); assert.equal(s.results, null);
});

test('finale without fusion below 50 tension', () => {
  const { s } = playing();
  tick(s, s.sessionEnd);
  assert.equal(s.phase, 'finale'); assert.equal(s.fusion, null);
  tick(s, s.tEnd); assert.equal(s.phase, 'over'); assert.equal(s.results.fusions, 0);
});

test('fusion running past session end goes release -> finale', () => {
  const { s, t } = playing();
  const late = s.sessionEnd - 3 * barMs(s.music);
  toMergeReady(s, late - 3000);
  onMerge(s, 0, true, 0.1, late); onMerge(s, 1, true, 0.1, late);
  tick(s, s.fusion.t0); tick(s, s.tEnd);
  assert.equal(s.phase, 'release');
  tick(s, s.tEnd);
  assert.equal(s.phase, 'finale');
  assert.equal(s.fusion, null, 'tension drained to 0, so no finale fusion');
});

test('a seat leaving resets to waiting; route relays move to the other seat with events to all', () => {
  const { s, t } = playing();
  mv(s, 0, 'au', t);
  const r = route(s, 1, { t: 'move', id: '1-q', move: 'au', ts: t + 500, x: 0.1, y: 0.2, dir: -1, perfect: true }, t + 500);
  assert.equal(r.out[0][0], 0);
  assert.equal(r.out[0][1].t, 'move'); assert.equal(r.out[0][1].from, 1);
  assert.deepEqual(r.out[1], ['all', { t: 'ev', k: 'echo', move: 'au', ids: [r.out[1][1].ids[0], '1-q'] }]);
  const fx = route(s, 0, { t: 'fx', k: 'spark', a: 1 }, t + 600);
  assert.deepEqual(fx.out, [[1, { t: 'fx', k: 'spark', a: 1, from: 0 }]]);
  setPresent(s, 1, false, t + 700);
  assert.equal(s.phase, 'waiting'); assert.equal(s.tension, 0);
});

test('3D move fields: z defaults to 0, dir as number or [x, z], aim with 2 or 3 components', () => {
  const { s, t } = playing();
  const a = onMove(s, 0, { id: '0-3d1', move: 'armada', ts: t, x: 1.5, y: 0.2, z: -2, dir: [0.6, -0.8], aim: [0.1, 0.2, 0.3] }, t);
  assert.ok(a.ok);
  assert.deepEqual([a.move.x, a.move.y, a.move.z, a.move.dir, a.move.aim], [1.5, 0.2, -2, [0.6, -0.8], [0.1, 0.2, 0.3]]);
  const b = onMove(s, 1, { id: '1-3d1', move: 'au', ts: t, x: 0, y: 0, dir: -0.5, aim: [1, 2] }, t);
  assert.equal(b.move.z, 0); assert.equal(b.move.dir, -0.5); assert.deepEqual(b.move.aim, [1, 2]);
  assert.equal(onMove(s, 0, { id: '0-3d2', move: 'au', x: 0, y: 0, z: 'far', dir: 1 }, t + 200).reason, 'bad');
  assert.equal(onMove(s, 0, { id: '0-3d3', move: 'au', x: 0, y: 0, dir: [1] }, t + 400).reason, 'bad');
  assert.equal(onMove(s, 0, { id: '0-3d4', move: 'au', x: 0, y: 0, dir: 1, aim: [1, 2, 3, 4] }, t + 600).move.aim, undefined);
});

test('world: from createSession, echoed in state; travel in any phase, 1/s per seat, events to all', () => {
  const s = createSession('void', 0, 'garden');
  assert.equal(publicState(s).world, 'garden');
  assert.equal(createSession('void', 0).world, null);
  const r = route(s, 1, { t: 'travel', world: 'redwoods', portal: 'gate-2' }, 100);   // waiting phase
  assert.deepEqual(r.out, [['all', { t: 'ev', k: 'travel', world: 'redwoods', portal: 'gate-2', by: 1 }]]);
  assert.equal(publicState(s).world, 'redwoods'); assert.equal(s.changed, true);
  assert.equal(route(s, 1, { t: 'travel', world: 'tide' }, 900).out.length, 0);      // rate
  assert.equal(route(s, 0, { t: 'travel', world: 'tide' }, 900).out[0][1].portal, null);  // other seat ok
  assert.equal(route(s, 1, { t: 'travel', world: 'x'.repeat(33) }, 2000).out.length, 0);
  assert.equal(route(s, 1, { t: 'travel', portal: 'p' }, 3000).out.length, 0);
  assert.equal(s.world, 'tide');
  const { s: p } = playing();
  setPresent(p, 1, false, 99999);
  assert.equal(p.phase, 'waiting');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
