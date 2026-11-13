// Physics, moves and combat geometry: the 2D prototype's dev/test-character.mjs, ported to TypeScript and metres.
// The prototype's four stages come along as StagePlanes, scaled by K (its world unit in metres) with its ground
// (0.14) at y = 0, and every distance in the checks is scaled the same way.
import { Character, PHYS, COMBAT, resolveExchange, foldExchange, type Capsule, type Terrain } from '../character';
import { MOVES, ATTACKS, tempoScale, registerMove, NP, J, LOCO, FU, BONE } from '../moves';
import { ledgeY, type StagePlane } from '../../engine/camera';
import { makeIntent, type Intent } from '../../input/intent';
import { test, assert, near, done } from './check';

const K = 6.38;
const BPM = 112;
const I = (o: Partial<Intent> = {}): Intent => Object.assign(makeIntent(), o);
const G0 = 0.14;
type ProtoLedge = { id: string; x0: number; x1: number; y: number; solid?: boolean; bob?: number };
const stage = (id: string, ground: number | null, ledges: ProtoLedge[], spawns: [number, number][]): StagePlane => ({
  id, origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 0.89 * K, ground: ground == null ? null : (ground - G0) * K,
  ledges: ledges.map((l) => ({ id: l.id, x0: l.x0 * K, x1: l.x1 * K, y: (l.y - G0) * K, solid: l.solid, bob: l.bob ? l.bob * K : undefined })),
  spawns: spawns.map(([x, y]) => [x * K, (y - G0) * K] as [number, number]),
});
const VOID = stage('void', 0.14, [], [[-0.38, 0.14], [0.38, 0.14]]);
const RED = stage('redwoods', 0.14, [
  { id: 'log', x0: -0.78, x1: -0.26, y: 0.31 }, { id: 'bough', x0: 0.30, x1: 0.74, y: 0.43 }, { id: 'high', x0: -0.20, x1: 0.18, y: 0.62 },
], [[-0.45, 0.14], [0.45, 0.14]]);
const TIDE = stage('tide', 0.14, [
  { id: 'pillarL', x0: -0.72, x1: -0.46, y: 0.35, solid: true }, { id: 'altar', x0: -0.13, x1: 0.13, y: 0.49, solid: true },
  { id: 'pillarR', x0: 0.46, x1: 0.72, y: 0.35, solid: true }, { id: 'lintel', x0: 0.22, x1: 0.40, y: 0.68 },
], [[-0.59, 0.35], [0.59, 0.35]]);
const FORGE = stage('forge', null, [
  { id: 'anvil', x0: -0.58, x1: 0.58, y: 0.22, solid: true }, { id: 'floatL', x0: -0.78, x1: -0.52, y: 0.47, bob: 0.03 },
  { id: 'floatR', x0: 0.52, x1: 0.78, y: 0.47, bob: 0.03 }, { id: 'crown', x0: -0.15, x1: 0.15, y: 0.63, bob: 0.045 },
], [[-0.35, 0.22], [0.35, 0.22]]);
const STAGES = [VOID, RED, TIDE, FORGE];
const DEFAULT_PLANE = { origin: [0, 0, 0] as [number, number, number], right: [1, 0, 0] as [number, number, number] };
const at = (_p: StagePlane, x: number, y = G0) => [x * K, (y - G0) * K] as const;

type Log = { t: number; x: number; y: number; z: number; g: boolean }[];
/** run a character: fn(t) → intent */
function run(c: Character, secs: number, fn: (t: number, i: number) => Intent = () => I(), hz = 60, t0 = 0, each?: (c: Character, t: number) => void): Log {
  const dt = 1 / hz, n = Math.round(secs * hz), log: Log = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt;
    c.update(dt, fn(t, i), ((t + dt) * BPM) / 60);
    if (each) each(c, t + dt);
    log.push({ t: t + dt, x: c.root[0], y: c.root[1], z: c.root[2], g: c.grounded });
  }
  return log;
}
const make = (plane: StagePlane | null, seat = 0, terrain?: Terrain) => new Character({ plane, seat, terrain });

// ---------------------------------------------------------------- the rig's lengths
test('BONE matches the CMU rig shipped in public/motion', () => {
  // (from scripts/mocap.mjs's skeleton 0; if the rig changes, change BONE)
  near(BONE.TH * FU, 0.4127, 2e-3, 'thigh'); near(BONE.SH * FU, 0.4140, 2e-3, 'shin'); near(BONE.UA * FU, 0.2833, 2e-3, 'upper arm');
  return `FU = ${FU.toFixed(3)} m per figure unit`;
});

test('the landmarks keep the dancer\'s own left at +x (mirrored from the prototype)', () => {
  const p = LOCO.ginga(new Float32Array(NP), 0.5);
  assert(p[3 * J.LS] > 0 && p[3 * J.RS] < 0 && p[3 * J.LH] > 0 && p[3 * J.LA] > 0, 'left at +x');
  const k = MOVES['meia-lua'].pose(0.47, { hand: 1, aim: null, air: false, beat: 0, groove: 1, t: 0 }, new Float32Array(NP));
  assert(k[3 * J.RA + 1] > 1.0, 'meia-lua lifts the right foot high: ' + k[3 * J.RA + 1].toFixed(2));
  return `shoulders at x ${p[3 * J.LS].toFixed(2)} / ${p[3 * J.RS].toFixed(2)} m`;
});

// ---------------------------------------------------------------- locked plane (the 2D game)
test('stands on the ground (Void)', () => {
  const c = make(VOID);
  run(c, 2);
  assert(c.grounded, 'not grounded'); near(c.y, 0, 1e-9, 'y'); near(c.x, -0.38 * K, 1e-9, 'x');
  for (const v of c.pose) assert(Number.isFinite(v), 'NaN in pose');
  const head = c.pose[1];
  assert(head > 1.08 && head < 1.72, 'head height ' + head);
  return `head ${head.toFixed(3)} m above the ground`;
});

test('jump apex about 2 m; short hop lower', () => {
  const c = make(VOID); run(c, 0.5);
  let maxY = 0;
  run(c, 1.2, (t) => I({ jump: t < 1 / 60, jumpHeld: true }), 60, 0, (c) => { maxY = Math.max(maxY, c.y); });
  const full = maxY;
  assert(full > 1.85 && full < 2.15, 'full jump ' + full);
  const d = make(VOID); run(d, 0.5);
  let maxH = 0;
  run(d, 1.2, (t) => I({ jump: t < 1 / 60, jumpHeld: t < 0.05 }), 60, 0, (c) => { maxH = Math.max(maxH, c.y); });
  assert(maxH < full * 0.6 && maxH > 0.3, 'short hop ' + maxH);
  assert(d.grounded, 'did not land');
  return `full ${full.toFixed(2)} m, short hop ${maxH.toFixed(2)} m`;
});

test('double jump works exactly once (about 1.5 m more)', () => {
  const c = make(VOID); run(c, 0.3);
  let maxY = 0; c.events.length = 0;
  run(c, 2, (t) => I({ jump: [0, 0.4, 0.6].some((x) => Math.abs(t - x) < 1e-6), jumpHeld: true }), 60, 0, (c) => { maxY = Math.max(maxY, c.y); });
  const jumps = c.events.filter((e) => e.type === 'jump');
  assert(jumps.length === 2 && !jumps[0].air && jumps[1].air, 'jump events ' + JSON.stringify(jumps.map((j) => j.air)));
  assert(maxY > 3.2, 'double jump height ' + maxY);
  return `apex ${maxY.toFixed(2)} m`;
});

test('passes up through a one-way ledge and lands on it (Redwoods log)', () => {
  const c = make(RED); c.reset(...at(RED, -0.52)); run(c, 0.3);
  let wentAbove = false;
  run(c, 1.5, (t) => I({ jump: t < 0.01, jumpHeld: true }), 60, 0, (c) => { if (c.y > (0.32 - G0) * K) wentAbove = true; });
  assert(wentAbove, 'never rose above'); assert(c.grounded, 'not grounded'); near(c.y, (0.31 - G0) * K, 1e-9, 'on the log');
});

test('drops down through a one-way ledge with crouch', () => {
  const c = make(RED); c.reset(...at(RED, -0.52, 0.31)); run(c, 0.3);
  assert(c.grounded && Math.abs(c.y - (0.31 - G0) * K) < 1e-9, 'not standing on log');
  run(c, 0.15, () => I({ moveY: -1 }));
  run(c, 1.0);
  near(c.y, 0, 1e-9, 'back on the ground');
});

test('cannot pass a solid ledge from below; walls stop at solid sides', () => {
  const slab = stage('slab', 0.14, [{ id: 'slab', x0: -0.2, x1: 0.2, y: 0.5, solid: true }], [[0, 0.14], [0.5, 0.14]]);
  const c = make(slab); run(c, 0.3);
  let top = 0;
  run(c, 2, (t) => I({ jump: t < 0.01 || Math.abs(t - 0.3) < 1e-6, jumpHeld: true }), 60, 0, (c) => { top = Math.max(top, c.y + PHYS.bodyH); });
  const bottom = (0.5 - G0) * K - PHYS.solidThick;
  assert(top <= bottom + 1e-6, 'head went into the slab: ' + top);
  near(c.y, 0, 1e-9, 'landed back on the ground');
  const d = make(TIDE); d.reset(0.2 * K, 0); run(d, 2, () => I({ moveX: 1 }));
  assert(d.x <= 0.46 * K - PHYS.halfW + 1e-6, 'walked into the pillar: ' + d.x);
  return `head peak ${top.toFixed(2)} under slab bottom ${bottom.toFixed(2)}; stopped at ${d.x.toFixed(2)}`;
});

test('rides a bobbing ledge without jitter (Sky Forge)', () => {
  const L = FORGE.ledges.find((l) => l.id === 'floatL')!;
  const c = make(FORGE); c.reset(-0.65 * K, ledgeY(L, 0)); c.update(1 / 60, I(), ((1 / 60) * BPM) / 60);
  let worst = 0, n = 0;
  run(c, 4.4, () => I(), 60, 1 / 60, (c, t) => { n++; assert(c.grounded, 'lost the ledge at ' + t); worst = Math.max(worst, Math.abs(c.y - ledgeY(L, (t * BPM) / 60))); });
  assert(worst < 1e-9, 'offset from the ledge ' + worst);
  return `${n} frames, max |y - ledgeY| = ${worst.toExponential(1)}`;
});

test('extra ledges from a callback can be stood on (set ice)', () => {
  const c = make(VOID); c.reset(0, 0); run(c, 0.3);
  c.extraLedges = () => [{ id: 'ice', x0: -1, x1: 1, y: 1.2 }];
  run(c, 1.5, (t) => I({ jump: t < 0.01, jumpHeld: true }));
  assert(c.grounded && Math.abs(c.y - 1.2) < 1e-9 && c.support?.id === 'ice', 'on the ice: ' + c.y);
});

test('falls into the Sky Forge pit and re-forms at the spawn', () => {
  const c = make(FORGE, 0); c.reset(...at(FORGE, 0.5, 0.22)); c.events.length = 0;
  run(c, 3, (t) => I({ moveX: t < 0.6 ? 1 : 0 }));
  const ev = c.events.find((e) => e.type === 'respawn');
  assert(ev, 'no respawn event');
  near(ev.x as number, -0.35 * K, 1e-9, 'spawn x'); near(ev.y as number, (0.22 - G0) * K, 1e-9, 'spawn y');
  assert(c.grounded && Math.abs(c.y - (0.22 - G0) * K) < 1e-9 && !c.reforming, 'not standing at spawn after re-forming');
});

// ---------------------------------------------------------------- moves
test('every attack: wind-up >= 150 ms (even at 140 bpm), capsule only inside its active window', () => {
  const out: string[] = [];
  for (const name of ATTACKS) {
    const def = MOVES[name];
    const wu = def.dur * tempoScale(140) * def.active![0];
    assert(wu >= 0.15, `${name} wind-up ${wu.toFixed(3)} s at 140 bpm`);
    const c = make(VOID); run(c, 0.3);
    assert(c.startMove(name), 'could not start ' + name);
    const m = c.move!; let firstHit: number | null = null;
    while (c.move === m) {
      c.update(1 / 240, I(), 1);
      const u = m.t / m.dur, sh = c.hitShapes();
      const inside = u >= def.active![0] && u <= def.active![1];
      assert(sh.length === (inside ? 1 : 0), `${name}: ${sh.length} capsules at u=${u.toFixed(3)}`);
      if (sh.length && firstHit == null) firstHit = m.t;
    }
    assert(firstHit! >= 0.15, `${name} first capsule at ${firstHit}`);
    out.push(`${name} ${Math.round(def.windup * 1000)}ms`);
  }
  return out.join(', ');
});

function compareReplay(c: Character, name: string, intentFn = () => I(), hz = 60) {
  let worst = 0, n = 0;
  c.events.length = 0;
  assert(c.startMove(name, {}), 'start ' + name);
  const ev = c.events.find((e) => e.type === 'move')!;
  const m = c.move!;
  while (c.move === m) {
    c.update(1 / hz, intentFn(), 1);
    if (c.move !== m) break;
    const live = c.hitShapes(), rep = Character.shapesAt(ev, m.t);
    assert(live.length === rep.length, `${name}: live ${live.length} vs replay ${rep.length} at t=${m.t.toFixed(3)}`);
    for (let i = 0; i < live.length; i++) for (const k of ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'r'] as const) { worst = Math.max(worst, Math.abs(live[i][k] - rep[i][k])); n++; }
  }
  return { worst, n };
}
test('shapesAt matches live hitShapes (locked plane, standing and running into the move)', () => {
  let worst = 0;
  for (const name of ATTACKS) {
    const c = make(VOID); run(c, 0.3);
    worst = Math.max(worst, compareReplay(c, name).worst);
    const d = make(VOID); run(d, 0.5, () => I({ moveX: 1 }));   // momentum carries into the move
    worst = Math.max(worst, compareReplay(d, name).worst);
  }
  for (const name of ['strike', 'throw']) {
    const c = make(VOID); run(c, 0.3, () => I({ aimX: 0.5, aimY: 0.7, aimActive: true }));
    worst = Math.max(worst, compareReplay(c, name, () => I({ aimX: -0.3, aimY: 0.2, aimActive: true })).worst);
  }
  assert(worst < 1.3e-3, 'worst difference ' + worst);
  return `worst ${worst.toExponential(2)} m`;
});
test('shapesAt matches live for air moves (martelo, armada, strike, throw in the air)', () => {
  let worst = 0;
  for (const name of ['martelo', 'armada', 'strike', 'throw']) {
    const c = make(VOID); run(c, 0.3);
    run(c, 0.1, (t) => I({ jump: t < 0.01, jumpHeld: true, moveX: 1 }));
    assert(!c.grounded, 'not airborne');
    worst = Math.max(worst, compareReplay(c, name).worst);
  }
  assert(worst < 1.3e-3, 'worst ' + worst);
  return `worst ${worst.toExponential(2)} m`;
});

test('the move buttons choose the right moves', () => {
  const pick = (it: Partial<Intent>) => { const c = make(VOID); run(c, 0.3); c.events.length = 0; c.update(1 / 60, I(it), 1); const e = c.events.find((e) => e.type === 'move'); return e && e.move; };
  const dir = 1;  // seat 0 faces +s
  const got: Record<string, unknown> = {
    'meia-lua': pick({ kick: true }), bencao: pick({ kick: true, moveX: dir }), armada: pick({ kick: true, moveX: -dir }),
    rasteira: pick({ kick: true, moveY: -1 }), martelo: pick({ kick: true, moveY: 1 }), strike: pick({ punch: true }),
    throw: pick({ punch: true, aimActive: true, aimX: 0.8, aimY: 0.2 }), spin: pick({ spin: true }), au: pick({ spin: true, moveX: 1 }),
    macaco: pick({ spin: true, moveY: -1 }), role: pick({ dodge: true, moveX: 1 }), esquiva: pick({ dodge: true, moveY: -1 }), block: pick({ dodge: true, dodgeHeld: true }),
  };
  for (const [want, have] of Object.entries(got)) assert(want === have, `${want}: got ${have}`);
  const c = make(VOID); run(c, 0.3); run(c, 0.15, (t) => I({ jump: t < 0.01, jumpHeld: true }));
  c.events.length = 0; c.update(1 / 60, I({ kick: true }), 1);
  assert(c.events.find((e) => e.type === 'move')?.move === 'martelo', 'air kick');
  return Object.keys(got).length + ' mappings + air kick';
});

test('strike held turns into the throw; perfect timing on the 16th grid', () => {
  const c = make(VOID); run(c, 0.3); c.events.length = 0;
  run(c, 0.4, (t) => I({ punch: t < 0.01, punchHeld: true }));
  const names = c.events.filter((e) => e.type === 'move').map((e) => e.move);
  assert(names.join() === 'strike,throw', names.join());
  // (with PERFECT_MS = 90 every moment is within 90 ms of a 16th at 112 bpm, so this checks the maths with 40 ms)
  const startAt = (B: number) => { const c = make(VOID), st = ((1 / 60) * BPM) / 60;
    for (let i = 30; i >= 1; i--) c.update(1 / 60, I(), B - st * i);
    c.events.length = 0; c.update(1 / 60, I({ kick: true }), B); return c.events.find((e) => e.type === 'move')!; };
  const keep = COMBAT.PERFECT_MS; COMBAT.PERFECT_MS = 40;
  const st = ((1 / 60) * BPM) / 60;
  const e1 = startAt(1.0 + st * 0.75), e2 = startAt(1.125 + st * 0.75);
  COMBAT.PERFECT_MS = keep;
  assert(e1.perfect && !e2.perfect && Math.abs(e1.offMs as number) <= 1 && Math.abs(Math.abs(e2.offMs as number) - 67) <= 1, `perfect ${e1.perfect} (${e1.offMs} ms) / ${e2.perfect} (${e2.offMs} ms)`);
  return `on the grid ${e1.offMs} ms, between 16ths ${e2.offMs} ms`;
});

// ---------------------------------------------------------------- exchanges
const cap = (ax: number, ay: number, bx: number, by: number, r: number, az = 0, bz = 0): Capsule => ({ ax: ax * K, ay: ay * K, az: az * K, bx: bx * K, by: by * K, bz: bz * K, r: r * K });
test('resolveExchange: each result in a constructed case', () => {
  const body = [cap(0, 0.2, 0, 0.35, 0.02)];
  const atk = [cap(-0.1, 0.3, 0.01, 0.3, 0.01)];
  const base = { hurt: body, hit: [] as Capsule[], stand: cap(0, 0.17, 0, 0.35, 0.013), invulnerable: false, dodging: false, airborne: false, blocking: false, blockAge: Infinity };
  const R = (d: Partial<typeof base>) => resolveExchange(atk, Object.assign({}, base, d));
  const got: Record<string, unknown> = {
    hit: R({}), clash: R({ hit: [cap(-0.06, 0.25, -0.06, 0.35, 0.01)] }), parry: R({ blocking: true, blockAge: 0.05 }),
    lateBlock: R({ blocking: true, blockAge: 0.5 }), dodgeIframes: R({ invulnerable: true }),
    dodgeAir: resolveExchange(atk, Object.assign({}, base, { airborne: true, hurt: [cap(0, 0.5, 0, 0.65, 0.02)] })),
    near: resolveExchange([cap(-0.1, 0.3, -0.04, 0.3, 0.01)], base), none: resolveExchange([cap(-0.4, 0.3, -0.3, 0.3, 0.01)], base),
  };
  const want: Record<string, unknown> = { hit: 'hit', clash: 'clash', parry: 'parry', lateBlock: 'near', dodgeIframes: 'dodge', dodgeAir: 'dodge', near: 'near', none: null };
  for (const k in want) assert(got[k] === want[k], `${k}: ${got[k]}`);
  // the locked plane flattens depth: a kick passing 0.64 m in front of the body still hits in 2D
  const deep = [cap(-0.1, 0.3, 0.01, 0.3, 0.01, 0.1, 0.1)];
  assert(resolveExchange(deep, base, { plane: null }) === null && resolveExchange(deep, base, { plane: DEFAULT_PLANE }) === 'hit', 'plane flattening');
  return Object.entries(got).map(([k, v]) => `${k}=${v}`).join(' ');
});

test('real dancers: kick lands on a stander; esquiva dodges; jumping a rasteira dodges; a timed block parries', () => {
  const duel = (atkMove: string, defAction: ((t: number) => Intent) | null, gap = 0.16 * K) => {
    const A = make(VOID, 0); A.reset(-gap / 2, 0);
    const B = make(VOID, 1); B.reset(gap / 2, 0);
    A.lookAt = B.root; B.lookAt = A.root;
    for (let i = 0; i < 20; i++) { A.update(1 / 60, I(), i / 60); B.update(1 / 60, I(), i / 60); A.lookAt = B.root; B.lookAt = A.root; }
    A.events.length = 0; A.startMove(atkMove);
    const ev = A.events.find((e) => e.type === 'move')!;
    let acc: ReturnType<typeof foldExchange> | null = null, t = 0;
    while (A.move) {
      const bi = defAction ? defAction(t) : I();
      A.update(1 / 60, I(), 1); B.update(1 / 60, bi, 1); t += 1 / 60;
      if (!A.move) break;
      acc = foldExchange(acc, resolveExchange(Character.shapesAt(ev, A.move.t), B));
      if (acc.final) break;
    }
    return acc && acc.res;
  };
  const r1 = duel('martelo', null);
  const r2 = duel('martelo', (t) => I({ dodge: t < 0.02, moveY: -1 }));
  const r3 = duel('rasteira', (t) => I({ jump: t < 0.02, jumpHeld: true }));
  // (the block raised 0.15 s before the push lands: the CMU body's longer thigh meets it a little later than the prototype's)
  const r4 = duel('bencao', (t) => I({ dodge: t > 0.25 && t < 0.267, dodgeHeld: t > 0.25 }));
  assert(r1 === 'hit', 'martelo on a stander: ' + r1);
  assert(r2 === 'dodge', 'martelo vs esquiva: ' + r2);
  assert(r3 === 'dodge', 'rasteira vs jump: ' + r3);
  assert(r4 === 'parry', 'bencao vs a timed block: ' + r4);
  return `stander=${r1}, esquiva=${r2}, jump over sweep=${r3}, timed block=${r4}`;
});

// ---------------------------------------------------------------- robustness
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
test('no NaNs over a 60 s random-intent soak on every stage (locked and free)', () => {
  let frames = 0, moves = 0;
  for (const st of STAGES) for (const mode of ['locked', 'free']) {
    const r = rng(st.id.length * 977 + (mode === 'free' ? 7 : 0));
    const c = make(mode === 'free' ? null : st, 0);
    let it = I();
    for (let i = 0; i < 3600; i++) {
      if (i % 6 === 0) it = I({ moveX: r() * 2 - 1, moveY: r() < 0.15 ? -1 : r() < 0.1 ? 1 : 0, moveZ: r() * 2 - 1, jump: r() < 0.08, jumpHeld: r() < 0.6,
        punch: r() < 0.04, kick: r() < 0.04, spin: r() < 0.03, dodge: r() < 0.03, dodgeHeld: r() < 0.3, punchHeld: r() < 0.2, aimX: r() * 2 - 1, aimY: r() * 2 - 1, aimActive: r() < 0.5 });
      else it = Object.assign({}, it, { jump: false, punch: false, kick: false, spin: false, dodge: false });
      if (i % 600 === 300) c.env = { updraft: r(), slick: r(), carryX: (r() - 0.5) * 0.3 * K, blink: r() < 0.5 };
      if (i % 900 === 450) c.applyKnock((r() - 0.5) * 2 * K, r() * 1.5 * K, 0.4);
      const dt = (1 / 60) * (0.5 + r());
      c.update(dt, it, ((i / 60) * BPM) / 60);
      for (let k = 0; k < NP; k++) if (!Number.isFinite(c.pose[k]) || !Number.isFinite(c.vel[k])) throw new Error(`${st.id}/${mode}: NaN at frame ${i}`);
      for (const s of c.hitShapes().concat(c.hurtShapes())) for (const v of Object.values(s)) if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('NaN capsule');
      assert(Math.abs(c.pose[1] - c.root[1]) < 0.5 * K && Math.abs(c.pose[0] - c.root[0]) < 0.5 * K, `${st.id}/${mode}: head far from root at frame ${i}`);
      frames++;
    }
    moves += c.serial;
  }
  return `${frames} frames, ${moves} moves`;
});

test('frame-rate independence: same input script at 30, 60 and 144 Hz', () => {
  const script = (t: number) => I({ moveX: t < 0.5 ? 1 : t >= 1 && t < 1.5 ? 1 : 0, jump: t >= 1 && t < 1 + 1e-6 + 1 / 150, jumpHeld: t >= 1 && t < 1.5, kick: t >= 2 && t < 2 + 1 / 150 });
  const ends: number[][] = [], paths: Log[] = [];
  for (const hz of [30, 60, 144]) {
    const c = make(RED); c.reset(-0.1 * K, 0);
    let jumped = false, kicked = false;
    const log = run(c, 3, (t) => { const it = script(t); if (it.jump) { if (jumped) it.jump = false; jumped = true; } if (it.kick) { if (kicked) it.kick = false; kicked = true; } return it; }, hz);
    ends.push([c.x, c.y]); paths.push(log);
  }
  const d = Math.max(Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]), Math.hypot(ends[2][0] - ends[1][0], ends[2][1] - ends[1][1]));
  const peak = (p: Log) => Math.max(...p.map((q) => q.y));
  const dp = Math.max(Math.abs(peak(paths[0]) - peak(paths[1])), Math.abs(peak(paths[2]) - peak(paths[1])));
  assert(d < 0.006 * K, 'end positions differ by ' + d);
  assert(dp < 0.006 * K, 'jump peaks differ by ' + dp);
  return `end positions within ${d.toExponential(1)}, jump peaks within ${dp.toExponential(1)} m`;
});

// ---------------------------------------------------------------- the plane and free 3D
test('a rotated, offset plane reproduces the default 2D motion exactly', () => {
  const a = 0.6, plane: StagePlane = { ...RED, origin: [0.2 * K, 0, -0.3 * K], right: [Math.cos(a), 0, Math.sin(a)] };
  const script = (t: number) => I({ moveX: t < 0.8 ? 1 : t < 1.4 ? -1 : 0, jump: Math.abs(t - 0.5) < 1e-6, jumpHeld: t < 0.8, kick: Math.abs(t - 2) < 1e-6 });
  const A = make(RED); A.reset(-0.1 * K, 0);
  const B = make(plane); B.reset(-0.1 * K, 0);
  let worst = 0;
  for (let i = 0; i < 180; i++) {
    const t = i / 60;
    A.update(1 / 60, script(t), t); B.update(1 / 60, script(t), t);
    worst = Math.max(worst, Math.abs(A.s - B.s), Math.abs(A.y - B.y));
    const off = (B.root[0] - plane.origin[0]) * -plane.right[2] + (B.root[2] - plane.origin[2]) * plane.right[0];
    assert(Math.abs(off) < 1e-9, 'left the plane by ' + off);
  }
  assert(worst < 1e-6, 'differs by ' + worst);
  return `max difference ${worst.toExponential(1)} m`;
});

test('locking eases a free dancer onto the plane; it ends on the plane, inside the walls', () => {
  const c = make(null); c.reset(9, 0, 2.5); run(c, 0.3);
  c.setPlane(VOID);
  const s0 = c.root.slice();
  run(c, 0.05);
  const moved = Math.hypot(c.root[0] - s0[0], c.root[2] - s0[2]);
  assert(moved < 1.5, 'snapped: moved ' + moved);
  run(c, 2.5);
  near(c.root[2], 0, 1e-3, 'on the plane');
  assert(Math.abs(c.root[0]) <= VOID.halfWidth - PHYS.wallMargin + 1e-6, 'inside the walls: ' + c.root[0]);
  c.setPlane(null); run(c, 0.5, () => I({ moveZ: 1 }));
  assert(c.root[2] < -0.5, 'free again: walks off the plane');
  return `moved ${moved.toFixed(2)} m in the first 50 ms`;
});

test('free movement: walks in depth, yaw follows travel, lands on groundAt', () => {
  const terrain: Terrain = { groundAt: (_x, z) => 0.05 * Math.max(0, -z - 0.3 * K) };
  const c = make(null, 0, terrain); c.reset(0, 0, 0);
  run(c, 1.0, () => I({ moveZ: 1 }));
  assert(c.z < -0.4 * K, 'did not walk into the screen: z=' + c.z);
  near(Math.abs(c.yaw), Math.PI, 0.05, 'yaw toward -z');
  near(c.y, terrain.groundAt(c.x, c.z), 0.005 * K, 'on the slope');
  run(c, 1.0, () => I({ moveX: 1 }));
  near(c.yaw, Math.PI / 2, 0.05, 'yaw toward +x');
  const d = make(null); d.reset(0, 0, 0); d.inputYaw = Math.PI / 2;
  run(d, 0.6, () => I({ moveZ: 1 }));
  assert(d.x < -0.2 * K && Math.abs(d.z) < 0.02 * K, `camera-relative: x ${d.x}, z ${d.z}`);
  const w = make(null); w.reset(0, 0, 0); run(w, 1, () => I({ moveX: 1, walk: true }));
  near(Math.hypot(w.v[0], w.v[2]), PHYS.walkSpeed, 0.01, 'walk speed');
  return `z ${c.z.toFixed(2)}, yaw ${c.yaw.toFixed(2)}; run ${PHYS.runSpeed} m/s, walk ${PHYS.walkSpeed} m/s`;
});

test('free movement: moves replay identically via shapesAt (any yaw, running)', () => {
  let worst = 0;
  for (const name of ATTACKS) {
    const c = make(null); c.reset(0.1 * K, 0, 0.2 * K);
    run(c, 0.5, () => I({ moveX: 0.6, moveZ: -0.8 }));
    worst = Math.max(worst, compareReplay(c, name, () => I({ moveX: 0.6, moveZ: -0.8 })).worst);
  }
  assert(worst < 1.3e-3, 'worst ' + worst);
  return `worst ${worst.toExponential(2)} m`;
});

test('sampled (motion capture) moves plug in without code changes', () => {
  const sample = (u: number, out: Float32Array) => { LOCO.ginga(out, u * 4); for (let j = 0; j < 13; j++) out[3 * j + 1] += 0.6 * Math.sin(Math.PI * u); };
  const m = registerMove({ name: 'mocap-test', dur: 0.5, sample, attack: true, active: [0.4, 0.6], hit: { a: 'RK', b: 'RA', r: 0.12 } });
  assert(MOVES['mocap-test'] === m && m.sampled, 'not registered');
  const c = make(VOID); run(c, 0.3);
  assert(c.startMove('mocap-test'), 'did not start');
  let any = 0; while (c.move) { c.update(1 / 60, I(), 1); any += c.hitShapes().length; }
  assert(any > 0, 'no hit shapes');
  delete MOVES['mocap-test'];
  return `${any} active frames`;
});

test('element hooks: updraft floats higher, slick slides further, carryX carries, blink teleports', () => {
  const apex = (env: Partial<Character['env']>) => { const c = make(VOID); run(c, 0.3); Object.assign(c.env, env); let m = 0; run(c, 1.5, (t) => I({ jump: t < 0.01, jumpHeld: true }), 60, 0, (c) => { m = Math.max(m, c.y); }); return m; };
  const a0 = apex({}), a1 = apex({ updraft: 1 });
  assert(a1 > a0 * 1.25 && a1 < a0 * 1.8, `updraft ${a1} vs ${a0}`);
  const slide = (env: Partial<Character['env']>) => { const c = make(VOID); c.reset(-0.6 * K, 0); Object.assign(c.env, env); run(c, 0.6, () => I({ moveX: 1 })); const x = c.x; run(c, 1); return c.x - x; };
  const s0 = slide({}), s1 = slide({ slick: 1 });
  assert(s1 > s0 * 2, `slick ${s1} vs ${s0}`);
  const c = make(VOID); run(c, 0.3); const x0 = c.x; c.env.carryX = 0.2 * K; run(c, 1); assert(c.x - x0 > 0.15 * K, 'carry ' + (c.x - x0));
  const b = make(VOID); run(b, 0.3); b.env.blink = true; b.events.length = 0; const bx = b.x;
  b.update(1 / 60, I({ dodge: true, moveX: 1 }), 1);
  const ev = b.events.find((e) => e.type === 'blink');
  assert(ev && b.x - bx > 0.2 * K && b.invulnerable, 'blink ' + (b.x - bx));
  return `apex ${a0.toFixed(2)} → ${a1.toFixed(2)} m, slide ${s0.toFixed(2)} → ${s1.toFixed(2)} m`;
});

test('knockback staggers, events and serialize', () => {
  const c = make(VOID); run(c, 0.5);
  c.applyKnock(-0.8 * K, 0.6 * K, 0.5);
  assert(c.staggered && c.airborne && (c.flags & 16) && (c.flags & 2), 'flags ' + c.flags);
  run(c, 1.5);
  assert(!c.staggered && c.grounded, 'did not recover');
  const s = c.serialize();
  assert(s.p.length === 26 && s.p3.length === 39 && Number.isInteger(s.f) && s.e >= 0 && s.e <= 255, 'serialize shape');
  const steps = c.events.filter((e) => e.type === 'step').length;
  run(c, 2.2);
  const steps2 = c.events.filter((e) => e.type === 'step').length;
  assert(steps2 > steps, 'ginga steps produce footfalls');
  return `${steps2 - steps} ginga footfalls in 2.2 s`;
});

test('camera body: the real limbs drive the figure (in its own frame) and the hit shape rides them', () => {
  const c = make(VOID); run(c, 0.3);
  const limbs = LOCO.ginga(new Float32Array(NP), 0);
  const hy = (limbs[3 * J.LH + 1] + limbs[3 * J.RH + 1]) / 2;
  for (let j = 0; j < 13; j++) limbs[3 * j + 1] -= hy;           // about the hips
  limbs[3 * J.RW] = -0.9; limbs[3 * J.RW + 1] = 0.7; limbs[3 * J.RW + 2] = 0;   // the right hand far out to its side
  for (let i = 0; i < 40; i++) c.update(1 / 60, I({ limbs, hasLegs: false }), 1);
  const P = c.pose, hx = (P[3 * J.LH] + P[3 * J.RH]) / 2, hz = (P[3 * J.LH + 2] + P[3 * J.RH + 2]) / 2;
  // the dancer's right, in the world, is (-cos yaw, 0, sin yaw)
  const out = (P[3 * J.RW] - hx) * -Math.cos(c.yaw) + (P[3 * J.RW + 2] - hz) * Math.sin(c.yaw);
  near(out, 0.9, 0.06, 'hand out to the dancer\'s right');
  c.update(1 / 60, I({ punch: true, limb: 'RW', limbs, hasLegs: false }), 1);
  const sh = c.hitShapes();
  assert(sh.length === 1 && Math.abs(sh[0].bx - c.pose[3 * J.RW]) < 1e-9, 'hit shape not on the real limb');
  return 'hand and capsule follow the camera body';
});

done();
