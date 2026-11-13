// dev/test-character.mjs — physics, moves and combat geometry. node dev/test-character.mjs  (exit 1 on failure)
import { Character, PHYS, COMBAT, resolveExchange, foldExchange, capsuleDistance, DEFAULT_PLANE } from '../js/character.js';
import { MOVES, ATTACKS, MOVE_NAMES, tempoScale, registerMove, NP, J as JM, LOCO } from '../js/moves.js';
import { STAGES, stageById, ledgeY } from '../js/stages.js';

let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { const info = fn(); pass++; results.push(`ok    ${name}${info ? '  (' + info + ')' : ''}`); }
  catch (e) { fail++; results.push(`FAIL  ${name}: ${e.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m || ''} expected ${b}, got ${a} (tol ${tol})`);
const I = (o = {}) => Object.assign({ moveX: 0, moveY: 0, moveZ: 0, jump: false, jumpHeld: false, punch: false, kick: false, spin: false, dodge: false, form: false, merge: false, aimX: 0, aimY: 0, aimActive: false }, o);
const BPM = 112;
// run a character: fn(t) -> intent. Returns per-frame log.
function run(c, stage, secs, fn = () => I(), hz = 60, t0 = 0, each) {
  const dt = 1 / hz, n = Math.round(secs * hz), log = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt;
    c.update(dt, fn(t, i), stage, (t + dt) * BPM / 60);
    if (each) each(c, t + dt);
    log.push({ t: t + dt, x: c.root[0], y: c.root[1], z: c.root[2], g: c.grounded });
  }
  return log;
}
const VOID = stageById('void'), RED = stageById('redwoods'), TIDE = stageById('tide'), FORGE = stageById('forge');

// ---------------------------------------------------------------- skeleton parity
const skel = await import('../js/skeleton.js').catch(() => null);
test('J is identical to skeleton.js J', () => { assert(skel, 'skeleton.js did not import'); assert(JSON.stringify(skel.J) === JSON.stringify(JM), 'J differs'); });

// ---------------------------------------------------------------- locked plane (the 2-D game)
test('stands on the ground (Void)', () => {
  const c = new Character({ seat: 0, stage: VOID });
  run(c, VOID, 2);
  assert(c.grounded, 'not grounded'); near(c.y, 0.14, 1e-9, 'y'); near(c.x, -0.38, 1e-9, 'x');
  for (const v of c.pose) assert(Number.isFinite(v), 'NaN in pose');
  const head = c.pose[1] - 0.14;
  assert(head > 0.17 && head < 0.27, 'head height ' + head);
  return `head ${head.toFixed(3)} above the ground`;
});

test('jump apex in range; short hop lower', () => {
  const c = new Character({ stage: VOID }); run(c, VOID, 0.5);
  let maxY = 0;
  run(c, VOID, 1.2, t => I({ jump: t < 1 / 60, jumpHeld: true }), 60, 0, c => { maxY = Math.max(maxY, c.y); });
  const full = maxY - 0.14;
  assert(full > 0.27 && full < 0.33, 'full jump ' + full);
  const d = new Character({ stage: VOID }); run(d, VOID, 0.5);
  let maxH = 0;
  run(d, VOID, 1.2, t => I({ jump: t < 1 / 60, jumpHeld: t < 0.05 }), 60, 0, c => { maxH = Math.max(maxH, c.y); });
  const hop = maxH - 0.14;
  assert(hop < full * 0.6 && hop > 0.05, 'short hop ' + hop);
  assert(d.grounded, 'did not land');
  return `full ${full.toFixed(3)}, short hop ${hop.toFixed(3)}`;
});

test('double jump works exactly once', () => {
  const c = new Character({ stage: VOID }); run(c, VOID, 0.3);
  let maxY = 0; c.events.length = 0;
  run(c, VOID, 2, t => I({ jump: [0, 0.4, 0.6].some(x => Math.abs(t - x) < 1e-6), jumpHeld: true }), 60, 0, c => { maxY = Math.max(maxY, c.y); });
  const jumps = c.events.filter(e => e.type === 'jump');
  assert(jumps.length === 2 && !jumps[0].air && jumps[1].air, 'jump events ' + JSON.stringify(jumps.map(j => j.air)));
  assert(maxY - 0.14 > 0.42, 'double jump height ' + (maxY - 0.14));
  return `apex ${(maxY - 0.14).toFixed(3)}`;
});

test('passes up through a one-way ledge and lands on it (Redwoods log)', () => {
  const c = new Character({ stage: RED }); c.reset(-0.52, 0.14); run(c, RED, 0.3);
  let wentAbove = false;
  run(c, RED, 1.5, t => I({ jump: t < 0.01, jumpHeld: true }), 60, 0, c => { if (c.y > 0.32) wentAbove = true; });
  assert(wentAbove, 'never rose above'); assert(c.grounded, 'not grounded'); near(c.y, 0.31, 1e-9, 'on the log');
});

test('drops down through a one-way ledge with crouch', () => {
  const c = new Character({ stage: RED }); c.reset(-0.52, 0.31); run(c, RED, 0.3);
  assert(c.grounded && Math.abs(c.y - 0.31) < 1e-9, 'not standing on log');
  run(c, RED, 0.15, () => I({ moveY: -1 }));
  run(c, RED, 1.0);
  near(c.y, 0.14, 1e-9, 'back on the ground');
});

test('cannot pass a solid ledge from below; walls stop at solid sides', () => {
  const slab = { id: 'slab', name: 'test', ground: 0.14, blast: 0.25, ledges: [{ id: 'slab', x0: -0.2, x1: 0.2, y: 0.5, solid: true }], spawns: [[0, 0.14], [0.5, 0.14]] };
  const c = new Character({ stage: slab }); run(c, slab, 0.3);
  let top = 0;
  run(c, slab, 2, t => I({ jump: t < 0.01 || Math.abs(t - 0.3) < 1e-6, jumpHeld: true }), 60, 0, c => { top = Math.max(top, c.y + PHYS.bodyH); });
  assert(top <= 0.5 - 0.06 + 1e-6, 'head went into the slab: ' + top);
  near(c.y, 0.14, 1e-9, 'landed back on the ground');
  // Tide Temple pillar: walking into it from the side
  const d = new Character({ stage: TIDE }); d.reset(0.2, 0.14); run(d, TIDE, 2, () => I({ moveX: 1 }));
  assert(d.x <= 0.46 - PHYS.halfW + 1e-6, 'walked into the pillar: ' + d.x);
  return `head peak ${top.toFixed(3)} under slab bottom 0.44; stopped at ${d.x.toFixed(3)}`;
});

test('rides a bobbing ledge without jitter (Sky Forge)', () => {
  const L = FORGE.ledges.find(l => l.id === 'floatL');
  const c = new Character({ stage: FORGE }); c.reset(-0.65, ledgeY(L, 0)); c.update(1 / 60, I(), FORGE, 1 / 60 * BPM / 60);
  let worst = 0, n = 0;
  run(c, FORGE, 4.4, () => I(), 60, 1 / 60, (c, t) => { n++; assert(c.grounded, 'lost the ledge at ' + t); worst = Math.max(worst, Math.abs(c.y - ledgeY(L, t * BPM / 60))); });
  assert(worst < 1e-9, 'offset from the ledge ' + worst);
  return `${n} frames, max |y - ledgeY| = ${worst.toExponential(1)}`;
});

test('falls into the Sky Forge pit and re-forms at the spawn', () => {
  const c = new Character({ stage: FORGE, seat: 0 }); c.reset(0.5, 0.22); c.events.length = 0;
  run(c, FORGE, 3, t => I({ moveX: t < 0.6 ? 1 : 0 }));
  const ev = c.events.find(e => e.type === 'respawn');
  assert(ev, 'no respawn event');
  near(ev.x, -0.35, 1e-9, 'spawn x'); near(ev.y, 0.22, 1e-9, 'spawn y');
  assert(c.grounded && Math.abs(c.y - 0.22) < 1e-9 && !c.reforming, 'not standing at spawn after re-forming');
});

// ---------------------------------------------------------------- moves
test('every attack: wind-up >= 150 ms (even at 140 bpm), capsule only inside its active window', () => {
  const out = [];
  for (const name of ATTACKS) {
    const def = MOVES[name];
    const wu = def.dur * tempoScale(140) * def.active[0];
    assert(wu >= 0.15, `${name} wind-up ${wu.toFixed(3)} s at 140 bpm`);
    const c = new Character({ stage: VOID }); run(c, VOID, 0.3);
    assert(c.startMove(name), 'could not start ' + name);
    const m = c.move; let firstHit = null, lastHit = null, t = 0;
    while (c.move === m) {
      c.update(1 / 240, I(), VOID, 1); t += 1 / 240;
      const u = m.t / m.dur, sh = c.hitShapes();
      const inside = u >= def.active[0] && u <= def.active[1];
      assert(sh.length === (inside ? 1 : 0), `${name}: ${sh.length} capsules at u=${u.toFixed(3)}`);
      if (sh.length) { if (firstHit == null) firstHit = m.t; lastHit = m.t; }
    }
    assert(firstHit >= 0.15, `${name} first capsule at ${firstHit}`);
    out.push(`${name} ${Math.round(def.windup * 1000)}ms`);
  }
  return out.join(', ');
});

function compareReplay(c, stage, name, intentFn = () => I(), hz = 60) {
  let worst = 0, n = 0;
  c.events.length = 0;
  assert(c.startMove(name, {}), 'start ' + name);
  const ev = c.events.find(e => e.type === 'move');
  const m = c.move;
  while (c.move === m) {
    c.update(1 / hz, intentFn(), stage, 1);
    if (c.move !== m) break;
    const live = c.hitShapes(), rep = Character.shapesAt(ev, m.t);
    assert(live.length === rep.length, `${name}: live ${live.length} vs replay ${rep.length} at t=${m.t.toFixed(3)}`);
    for (let i = 0; i < live.length; i++) for (const k of ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'r']) { worst = Math.max(worst, Math.abs(live[i][k] - rep[i][k])); n++; }
  }
  return { worst, n };
}
test('shapesAt matches live hitShapes (locked plane, standing and running into the move)', () => {
  let worst = 0;
  for (const name of ATTACKS) {
    const c = new Character({ stage: VOID }); run(c, VOID, 0.3);
    worst = Math.max(worst, compareReplay(c, VOID, name).worst);
    const d = new Character({ stage: VOID }); run(d, VOID, 0.5, () => I({ moveX: 1 }));   // momentum carries into the move
    worst = Math.max(worst, compareReplay(d, VOID, name).worst);
  }
  // aimed strike / throw
  for (const name of ['strike', 'throw']) {
    const c = new Character({ stage: VOID }); run(c, VOID, 0.3, () => I({ aimX: 0.5, aimY: 0.7, aimActive: true }));
    worst = Math.max(worst, compareReplay(c, VOID, name, () => I({ aimX: -0.3, aimY: 0.2, aimActive: true })).worst);
  }
  assert(worst < 2e-4, 'worst difference ' + worst);
  return `worst ${worst.toExponential(2)} world units`;
});
test('shapesAt matches live for air moves (martelo, armada, strike, throw in the air)', () => {
  let worst = 0;
  for (const name of ['martelo', 'armada', 'strike', 'throw']) {
    const c = new Character({ stage: VOID }); run(c, VOID, 0.3);
    run(c, VOID, 0.1, t => I({ jump: t < 0.01, jumpHeld: true, moveX: 1 }));
    assert(!c.grounded, 'not airborne');
    worst = Math.max(worst, compareReplay(c, VOID, name).worst);
  }
  assert(worst < 2e-4, 'worst ' + worst);
  return `worst ${worst.toExponential(2)}`;
});

test('the move buttons choose the right moves', () => {
  const pick = (setup, it) => { const c = new Character({ stage: VOID }); run(c, VOID, 0.3); if (setup) setup(c); c.events.length = 0; c.update(1 / 60, I(it), VOID, 1); const e = c.events.find(e => e.type === 'move'); return e && e.move; };
  const dir = 1;  // seat 0 faces +x
  const got = {
    'meia-lua': pick(null, { kick: true }), bencao: pick(null, { kick: true, moveX: dir }), armada: pick(null, { kick: true, moveX: -dir }),
    rasteira: pick(null, { kick: true, moveY: -1 }), martelo: pick(null, { kick: true, moveY: 1 }), strike: pick(null, { punch: true }),
    throw: pick(null, { punch: true, aimActive: true, aimX: 0.8, aimY: 0.2 }), spin: pick(null, { spin: true }), au: pick(null, { spin: true, moveX: 1 }),
    macaco: pick(null, { spin: true, moveY: -1 }), role: pick(null, { dodge: true, moveX: 1 }), esquiva: pick(null, { dodge: true, moveY: -1 }), block: pick(null, { dodge: true, dodgeHeld: true }),
  };
  for (const [want, have] of Object.entries(got)) assert(want === have, `${want}: got ${have}`);
  // air kick
  const c = new Character({ stage: VOID }); run(c, VOID, 0.3); run(c, VOID, 0.15, t => I({ jump: t < 0.01, jumpHeld: true }));
  c.events.length = 0; c.update(1 / 60, I({ kick: true }), VOID, 1);
  assert(c.events.find(e => e.type === 'move')?.move === 'martelo', 'air kick');
  return Object.keys(got).length + ' mappings + air kick';
});

test('strike held turns into the throw; perfect timing on the 16th grid', () => {
  const c = new Character({ stage: VOID }); run(c, VOID, 0.3); c.events.length = 0;
  run(c, VOID, 0.4, t => I({ punch: t < 0.01, punchHeld: true }));
  const names = c.events.filter(e => e.type === 'move').map(e => e.move);
  assert(names.join() === 'strike,throw', names.join());
  // perfect: the offset to the nearest 16th at the substep the move starts. NB with RULES.PERFECT_MS = 90 every
  // moment is within 90 ms of a 16th at 112 bpm (a 16th is 134 ms), so this checks the maths with 40 ms.
  const startAt = B => { const c = new Character({ stage: VOID }), st = 1 / 60 * BPM / 60;
    for (let i = 30; i >= 1; i--) c.update(1 / 60, I(), VOID, B - st * i);
    c.events.length = 0; c.update(1 / 60, I({ kick: true }), VOID, B); return c.events.find(e => e.type === 'move'); };
  const keep = COMBAT.PERFECT_MS; COMBAT.PERFECT_MS = 40;
  const st = 1 / 60 * BPM / 60;
  const e1 = startAt(1.0 + st * 0.75), e2 = startAt(1.125 + st * 0.75);
  COMBAT.PERFECT_MS = keep;
  assert(e1.perfect && !e2.perfect && Math.abs(e1.offMs) <= 1 && Math.abs(Math.abs(e2.offMs) - 67) <= 1, `perfect ${e1.perfect} (${e1.offMs} ms) / ${e2.perfect} (${e2.offMs} ms)`);
  return `on the grid ${e1.offMs} ms, between 16ths ${e2.offMs} ms`;
});

// ---------------------------------------------------------------- exchanges
const cap = (ax, ay, bx, by, r, az = 0, bz = 0) => ({ ax, ay, az, bx, by, bz, r });
test('resolveExchange: each result in a constructed case', () => {
  const body = [cap(0, 0.2, 0, 0.35, 0.02)];
  const atk = [cap(-0.1, 0.3, 0.01, 0.3, 0.01)];
  const base = { hurt: body, hit: [], stand: cap(0, 0.17, 0, 0.35, 0.013), invulnerable: false, dodging: false, airborne: false, blocking: false, blockAge: Infinity };
  const R = d => resolveExchange(atk, Object.assign({}, base, d));
  const got = {
    hit: R({}), clash: R({ hit: [cap(-0.06, 0.25, -0.06, 0.35, 0.01)] }), parry: R({ blocking: true, blockAge: 0.05 }),
    lateBlock: R({ blocking: true, blockAge: 0.5 }), dodgeIframes: R({ invulnerable: true }),
    dodgeAir: resolveExchange(atk, Object.assign({}, base, { airborne: true, hurt: [cap(0, 0.5, 0, 0.65, 0.02)] })),
    near: resolveExchange([cap(-0.1, 0.3, -0.04, 0.3, 0.01)], base), none: resolveExchange([cap(-0.4, 0.3, -0.3, 0.3, 0.01)], base),
  };
  const want = { hit: 'hit', clash: 'clash', parry: 'parry', lateBlock: 'near', dodgeIframes: 'dodge', dodgeAir: 'dodge', near: 'near', none: null };
  for (const k in want) assert(got[k] === want[k], `${k}: ${got[k]}`);
  // the locked plane flattens depth: a kick passing 0.1 in front of the body in z still hits in 2-D
  const deep = [cap(-0.1, 0.3, 0.01, 0.3, 0.01, 0.1, 0.1)];
  assert(resolveExchange(deep, base, { plane: null }) === null && resolveExchange(deep, base, { plane: DEFAULT_PLANE }) === 'hit', 'plane flattening');
  return Object.entries(got).map(([k, v]) => `${k}=${v}`).join(' ');
});

test('real dancers: kick lands on a stander; i-frames of esquiva give dodge; jumping over a rasteira is a dodge', () => {
  const duel = (atkMove, defAction, gap = 0.16, defAt = 0) => {
    const A = new Character({ stage: VOID, seat: 0 }); A.reset(-gap / 2, 0.14);
    const B = new Character({ stage: VOID, seat: 1 }); B.reset(gap / 2, 0.14);
    A.lookAt = B.root; B.lookAt = A.root;
    for (let i = 0; i < 20; i++) { A.update(1 / 60, I(), VOID, i / 60); B.update(1 / 60, I(), VOID, i / 60); }
    A.events.length = 0; A.startMove(atkMove);
    const ev = A.events.find(e => e.type === 'move');
    let acc = null, t = 0;
    while (A.move) {
      const bi = defAction ? defAction(t) : I();
      A.update(1 / 60, I(), VOID, 1); B.update(1 / 60, bi, VOID, 1); t += 1 / 60;
      if (!A.move) break;
      acc = foldExchange(acc, resolveExchange(Character.shapesAt(ev, A.move.t), B));
      if (acc.final) break;
    }
    void defAt;
    return acc && acc.res;
  };
  const r1 = duel('martelo', null);
  const r2 = duel('martelo', t => I({ dodge: t < 0.02, moveY: -1 }));
  const r3 = duel('rasteira', t => I({ jump: t < 0.02, jumpHeld: true }));
  const r4 = duel('bencao', t => I({ dodge: t > 0.2 && t < 0.217, dodgeHeld: t > 0.2 }));
  assert(r1 === 'hit', 'martelo on a stander: ' + r1);
  assert(r2 === 'dodge', 'martelo vs esquiva: ' + r2);
  assert(r3 === 'dodge', 'rasteira vs jump: ' + r3);
  assert(r4 === 'parry', 'bencao vs a timed block: ' + r4);
  return `stander=${r1}, esquiva=${r2}, jump over sweep=${r3}, timed block=${r4}`;
});

// ---------------------------------------------------------------- robustness
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
test('no NaNs over a 60 s random-intent soak on every stage (locked and free)', () => {
  let frames = 0, moves = 0, respawns = 0;
  for (const st of STAGES) for (const mode of ['locked', 'free']) {
    const r = rng(st.id.length * 977 + (mode === 'free' ? 7 : 0));
    const c = new Character({ stage: st, seat: 0, plane: mode === 'free' ? null : DEFAULT_PLANE });
    c.env = { updraft: 0, slick: 0, carryX: 0, blink: false };
    let it = I();
    for (let i = 0; i < 3600; i++) {
      if (i % 6 === 0) it = I({ moveX: r() * 2 - 1, moveY: r() < 0.15 ? -1 : r() < 0.1 ? 1 : 0, moveZ: r() * 2 - 1, jump: r() < 0.08, jumpHeld: r() < 0.6,
        punch: r() < 0.04, kick: r() < 0.04, spin: r() < 0.03, dodge: r() < 0.03, dodgeHeld: r() < 0.3, punchHeld: r() < 0.2, aimX: r() * 2 - 1, aimY: r() * 2 - 1, aimActive: r() < 0.5 });
      else it = Object.assign({}, it, { jump: false, punch: false, kick: false, spin: false, dodge: false });
      if (i % 600 === 300) c.env = { updraft: r(), slick: r(), carryX: (r() - 0.5) * 0.3, blink: r() < 0.5 };
      if (i % 900 === 450) c.applyKnock((r() - 0.5) * 2, r() * 1.5, 0.4);
      const dt = 1 / 60 * (0.5 + r());
      c.update(dt, it, st, i / 60 * BPM / 60);
      for (let k = 0; k < NP; k++) if (!Number.isFinite(c.pose[k]) || !Number.isFinite(c.vel[k])) throw new Error(`${st.id}/${mode}: NaN at frame ${i}`);
      for (const s of c.hitShapes().concat(c.hurtShapes())) for (const v of Object.values(s)) if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('NaN capsule');
      assert(Math.abs(c.pose[1] - c.root[1]) < 0.5 && Math.abs(c.pose[0] - c.root[0]) < 0.5, `${st.id}/${mode}: head far from root at frame ${i}`);
      frames++;
    }
    moves += c.serial; respawns += 0;
  }
  return `${frames} frames, ${moves} moves`;
});

test('frame-rate independence: same input script at 30, 60 and 144 Hz', () => {
  const script = t => I({ moveX: t < 0.5 ? 1 : t >= 1 && t < 1.5 ? 1 : 0, jump: t >= 1 && t < 1 + 1e-6 + 1 / 150, jumpHeld: t >= 1 && t < 1.5, kick: t >= 2 && t < 2 + 1 / 150 });
  const ends = [], paths = [];
  for (const hz of [30, 60, 144]) {
    const c = new Character({ stage: RED }); c.reset(-0.1, 0.14);
    let jumped = false;
    const log = run(c, RED, 3, (t, i) => { const it = script(t); if (it.jump) { if (jumped) it.jump = false; jumped = true; } if (it.kick && c._k) it.kick = false; if (it.kick) c._k = true; return it; }, hz);
    ends.push([c.x, c.y]); paths.push(log);
  }
  const d = Math.max(Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]), Math.hypot(ends[2][0] - ends[1][0], ends[2][1] - ends[1][1]));
  // also compare the peak of the jump
  const peak = p => Math.max(...p.map(q => q.y));
  const dp = Math.max(Math.abs(peak(paths[0]) - peak(paths[1])), Math.abs(peak(paths[2]) - peak(paths[1])));
  assert(d < 0.006, 'end positions differ by ' + d);
  assert(dp < 0.006, 'jump peaks differ by ' + dp);
  return `end positions within ${d.toExponential(1)}, jump peaks within ${dp.toExponential(1)} world units`;
});

// ---------------------------------------------------------------- the plane and free 3-D
test('a rotated, offset plane reproduces the default 2-D motion exactly', () => {
  const a = 0.6, plane = { origin: [0.2, 0, -0.3], right: [Math.cos(a), 0, Math.sin(a)] };
  const script = t => I({ moveX: t < 0.8 ? 1 : t < 1.4 ? -1 : 0, jump: Math.abs(t - 0.5) < 1e-6, jumpHeld: t < 0.8, kick: Math.abs(t - 2) < 1e-6 });
  const A = new Character({ stage: RED }); A.reset(-0.1, 0.14);
  const B = new Character({ stage: RED, plane }); B.reset(-0.1, 0.14);
  let worst = 0;
  for (let i = 0; i < 180; i++) {
    const t = i / 60;
    A.update(1 / 60, script(t), RED, t); B.update(1 / 60, script(t), RED, t);
    worst = Math.max(worst, Math.abs(A.s - B.s), Math.abs(A.y - B.y));
    const off = (B.root[0] - plane.origin[0]) * -plane.right[2] + (B.root[2] - plane.origin[2]) * plane.right[0];
    assert(Math.abs(off) < 1e-9, 'left the plane by ' + off);
  }
  assert(worst < 1e-9, 'differs by ' + worst);
  return `max difference ${worst.toExponential(1)}`;
});

test('free movement: walks in depth, yaw follows travel, lands on heightAt', () => {
  const st = Object.assign({}, VOID, { heightAt: (x, z) => 0.14 + 0.05 * Math.max(0, -z - 0.3) });
  const c = new Character({ stage: st, plane: null }); c.reset(0, 0.14, 0);
  run(c, st, 1.0, () => I({ moveZ: 1 }));
  assert(c.z < -0.4, 'did not walk into the screen: z=' + c.z);
  near(Math.abs(c.yaw), Math.PI, 0.05, 'yaw toward -z');
  near(c.y, st.heightAt(c.x, c.z), 0.005, 'on the slope');
  run(c, st, 1.0, () => I({ moveX: 1 }));
  near(c.yaw, Math.PI / 2, 0.05, 'yaw toward +x');
  // camera-relative input: camera yaw pi/2 (looking along -x), stick up walks along -x
  const d = new Character({ stage: VOID, plane: null }); d.reset(0, 0.14, 0); d.inputYaw = Math.PI / 2;
  run(d, VOID, 0.6, () => I({ moveZ: 1 }));
  assert(d.x < -0.2 && Math.abs(d.z) < 0.02, `camera-relative: x ${d.x}, z ${d.z}`);
  return `z ${c.z.toFixed(2)}, yaw ${c.yaw.toFixed(2)}`;
});

test('free movement: moves replay identically via shapesAt (any yaw, running)', () => {
  let worst = 0;
  for (const name of ATTACKS) {
    const c = new Character({ stage: VOID, plane: null }); c.reset(0.1, 0.14, 0.2);
    run(c, VOID, 0.5, () => I({ moveX: 0.6, moveZ: -0.8 }));
    worst = Math.max(worst, compareReplay(c, VOID, name, () => I({ moveX: 0.6, moveZ: -0.8 })).worst);
  }
  assert(worst < 2e-4, 'worst ' + worst);
  return `worst ${worst.toExponential(2)}`;
});

test('sampled (motion capture) moves plug in without code changes', () => {
  const sample = (u, out) => { LOCO.ginga(out, u * 4); for (let j = 0; j < 13; j++) out[3 * j + 1] += 0.1 * Math.sin(Math.PI * u); };
  const m = registerMove({ name: 'mocap-test', dur: 0.5, sample, attack: true, active: [0.4, 0.6], hit: { a: 'RK', b: 'RA', r: 0.05 } });
  assert(MOVES['mocap-test'] === m && m.sampled, 'not registered');
  const c = new Character({ stage: VOID }); run(c, VOID, 0.3);
  assert(c.startMove('mocap-test'), 'did not start');
  let any = 0; while (c.move) { c.update(1 / 60, I(), VOID, 1); any += c.hitShapes().length; }
  assert(any > 0, 'no hit shapes');
  delete MOVES['mocap-test'];
  return `${any} active frames`;
});

test('element hooks: updraft floats higher, slick slides further, carryX carries, blink teleports', () => {
  const apex = env => { const c = new Character({ stage: VOID }); run(c, VOID, 0.3); c.env = env; let m = 0; run(c, VOID, 1.5, t => I({ jump: t < 0.01, jumpHeld: true }), 60, 0, c => { m = Math.max(m, c.y); }); return m - 0.14; };
  const a0 = apex({}), a1 = apex({ updraft: 1 });
  assert(a1 > a0 * 1.25 && a1 < a0 * 1.8, `updraft ${a1} vs ${a0}`);
  const slide = env => { const c = new Character({ stage: VOID }); c.reset(-0.6, 0.14); c.env = env; run(c, VOID, 0.6, () => I({ moveX: 1 })); const x = c.x; run(c, VOID, 1); return c.x - x; };
  const s0 = slide({}), s1 = slide({ slick: 1 });
  assert(s1 > s0 * 2, `slick ${s1} vs ${s0}`);
  const c = new Character({ stage: VOID }); run(c, VOID, 0.3); const x0 = c.x; c.env = { carryX: 0.2 }; run(c, VOID, 1); assert(c.x - x0 > 0.15, 'carry ' + (c.x - x0));
  const b = new Character({ stage: VOID }); run(b, VOID, 0.3); b.env = { blink: true }; b.events.length = 0; const bx = b.x;
  b.update(1 / 60, I({ dodge: true, moveX: 1 }), VOID, 1);
  const ev = b.events.find(e => e.type === 'blink');
  assert(ev && b.x - bx > 0.2 && b.invulnerable, 'blink ' + (b.x - bx));
  return `apex ${a0.toFixed(3)} -> ${a1.toFixed(3)}, slide ${s0.toFixed(3)} -> ${s1.toFixed(3)}`;
});

test('knockback staggers, events and serialize', () => {
  const c = new Character({ stage: VOID }); run(c, VOID, 0.5);
  c.applyKnock(-0.8, 0.6, 0.5);
  assert(c.staggered && c.airborne && (c.flags & 16) && (c.flags & 2), 'flags ' + c.flags);
  run(c, VOID, 1.5);
  assert(!c.staggered && c.grounded, 'did not recover');
  const s = c.serialize();
  assert(s.p.length === 26 && s.p3.length === 39 && Number.isInteger(s.f) && s.e >= 0 && s.e <= 255, 'serialize shape');
  const steps = c.events.filter(e => e.type === 'step').length;
  run(c, VOID, 2.2);
  const steps2 = c.events.filter(e => e.type === 'step').length;
  assert(steps2 > steps, 'ginga steps produce footfalls');
  return `${steps2 - steps} ginga footfalls in 2.2 s`;
});

test('camera override: the real limb drives the figure and rides the hit shape', () => {
  const c = new Character({ stage: VOID }); run(c, VOID, 0.3);
  const p3 = new Float32Array(39); LOCO.ginga(p3, 0);
  for (let j = 0; j < 13; j++) p3[3 * j + 1] -= 0.3;             // hip-centred
  p3[3 * 6] = 0.4; p3[3 * 6 + 1] = 0.3; p3[3 * 6 + 2] = 0;         // right hand far out to the side
  for (let i = 0; i < 40; i++) { c.setPoseFromCamera(null, { pose3: p3, hasLegs: false }); c.update(1 / 60, I(), VOID, 1); }
  const hx = c.pose[3 * 6] - (c.pose[3 * 7] + c.pose[3 * 8]) / 2;
  near(hx, 0.4 * PHYS.scale, 0.01, 'hand x relative to the hips');
  c.setPoseFromCamera(null, { pose3: p3, hasLegs: false });
  c.update(1 / 60, I({ punch: true, limb: 'RW' }), VOID, 1);
  const sh = c.hitShapes();
  assert(sh.length === 1 && Math.abs(sh[0].bx - c.pose[3 * 6]) < 1e-9, 'hit shape not on the real limb');
  return 'hand and capsule follow the camera';
});

for (const r of results) console.log(r);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
