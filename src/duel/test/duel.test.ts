// The dance battle: its rules (shared/duel.ts) on plain data, the contact physics (contact.ts) on real bodies free in
// 3D and locked, and two virtual players dancing it in Node (sim.ts), free and locked. Run by scripts/test-ts.mjs.
import { test, assert, near, done } from '../../dancer/test/check';
import { DUEL, newDuel, duelStep, duelLink, duelContact, duelFlingLanded, frozen, onBeat, type DuelBody, type DuelEvent, type DuelState } from '../../../shared/duel.ts';
import { Character, DUEL_PHYS } from '../../dancer/character';
import { Contact, CONTACT, noInput, splitIntent, type ContactEvent, type ContactInput } from '../contact';
import { DuelMatch, duelPlane } from '../match';
import { simulateDuel, makeBrains, nodeArena } from '../sim';
import { DuelBrain, holdFor, jumpHeight } from '../../ai/duel-brain';
import { makeIntent } from '../../input/intent';
import { DuelHud, type HudSeat } from '../hud-state';

const arena = { yKill: -2.2, bpm: 120, setMs: 30000 };
const stand: [DuelBody, DuelBody] = [{ y: 0, grounded: true }, { y: 0, grounded: true }];
const air: [DuelBody, DuelBody] = [{ y: 1, grounded: false }, { y: 1, grounded: false }];
/** a duel in play at t (the count-in run through) */
function playing(): { d: DuelState; t: number } {
  const d = newDuel(0, arena.bpm);
  let t = 0;
  for (; d.phase !== 'play' && t < 10000; t += 16) duelStep(d, t, 16, stand, arena);
  return { d, t };
}
const kinds = (ev: DuelEvent[]) => ev.map((e) => e.k);

// ---------------------------------------------------------------- the rules
test('a set counts in 3, 2, 1, then BEND; the seats are held until then', () => {
  const d = newDuel(0, 120), seen: DuelEvent[] = [];
  for (let t = 0; t < 3000; t += 10) {
    seen.push(...duelStep(d, t, 10, stand, arena));
    if (d.phase === 'intro') assert(frozen(d, 0) && frozen(d, 1), 'held in the count-in');
  }
  assert(kinds(seen)[0] === 'set', `starts a set: ${kinds(seen).join(',')}`);
  assert(seen.filter((e) => e.k === 'count').map((e) => (e as { n: number }).n).join() === '3,2,1', 'counts 3, 2, 1');
  assert(kinds(seen).includes('go') && d.phase === 'play' && !frozen(d, 0), 'then play');
});

test('a combo: each link adds to it and its multiplier; on the beat double, the same link a third time little; banked into style on the ground', () => {
  const { d, t } = playing();
  const v = (kind: Parameters<typeof duelLink>[2], perfect: boolean, u: number) => (duelLink(d, 0, kind, perfect, u).find((e) => e.k === 'link') as Extract<DuelEvent, { k: 'link' }>).value;
  duelStep(d, t, 16, air, arena);
  const a = v('walljump', false, t), b = v('walljump', true, t + 100), c = v('walljump', false, t + 200);
  near(b, a * DUEL.PERFECT_MUL, 1e-9, 'on the beat');
  near(c, a * DUEL.REPEAT, 1e-9, 'a third the same');
  const C = d.seats[0].combo;
  assert(C.n === 3 && C.live && near(C.mult, 1 + 3 * DUEL.MULT_STEP, 1e-9) === undefined, `n ${C.n} mult ${C.mult}`);
  const score = C.score, mult = C.mult;
  // on the ground long enough: banked
  let banked: Extract<DuelEvent, { k: 'combo' }> | null = null;
  for (let u = t + 300; u < t + 300 + DUEL.COMBO_GROUND_MS + 100; u += 16) for (const e of duelStep(d, u, 16, stand, arena)) if (e.k === 'combo') banked = e;
  assert(banked && banked.banked === Math.round(score * mult) && d.seats[0].style === banked.banked, `banked ${banked?.banked}`);
  assert(!d.seats[0].combo.live, 'the combo ended');
  return `three links ${(score).toFixed(1)} × ${mult} → ${banked!.banked} style`;
});

test('leading earns style: a catch, a catch out of the air, a fling the other lands', () => {
  const { d, t } = playing();
  duelLink(d, 0, 'catch', false, t);
  duelLink(d, 1, 'aerial', false, t);
  duelFlingLanded(d, 0);
  assert(d.seats[0].style === DUEL.LEAD_CATCH + DUEL.LEAD_FLING_LANDED, `seat 0 ${d.seats[0].style}`);
  assert(d.seats[1].style === DUEL.LEAD_AERIAL, `seat 1 ${d.seats[1].style}`);
});

test('the shared energy rises only together, ebbs apart; held high while joined it charges the merge', () => {
  const { d, t } = playing();
  duelLink(d, 0, 'walljump', false, t);
  assert(d.energy === 0, 'alone: nothing');
  duelLink(d, 1, 'walljump', false, t);
  assert(d.energy > 0, 'both in a combo: together');
  let u = t, merged = false;
  duelContact(d, true, u);
  for (; u < t + 20000 && !merged; u += 16) for (const e of duelStep(d, u, 16, air, arena)) if (e.k === 'merge') merged = true;
  assert(merged && d.energy > DUEL.MERGE_AT, `merged after ${((u - t) / 1000).toFixed(1)} s joined`);
  const e0 = d.energy;
  duelContact(d, false, u);
  for (let w = u; w < u + 3000; w += 16) duelStep(d, w, 16, stand, arena);
  assert(d.energy < e0, 'apart: it ebbs');
  return `merged after ${((u - t) / 1000).toFixed(1)} s joined`;
});

test('a fall costs a little style and the combo, never a KO: back in a moment', () => {
  const { d, t } = playing();
  d.seats[1].style = 30;
  duelLink(d, 1, 'flip', false, t);
  const ev = duelStep(d, t + 16, 16, [{ y: 0, grounded: true }, { y: -3, grounded: false }], arena);
  assert(ev.some((e) => e.k === 'fall') && d.seats[1].style === 30 - DUEL.FALL_COST && !d.seats[1].combo.live, `fell: ${kinds(ev)}`);
  assert(frozen(d, 1), 'reforming');
  let ready = -1;
  for (let u = t + 32; u < t + 3000 && ready < 0; u += 16) if (duelStep(d, u, 16, stand, arena).some((e) => e.k === 'ready')) ready = u;
  near(ready - (t + 16), DUEL.REFORM_MS, 20, 'back after REFORM_MS');
});

test('a set on the music: play, the finale (fused when the energy peaked high), the higher style wins, the next set', () => {
  const { d, t } = playing();
  d.seats[0].style = 50; d.seats[1].style = 80; d.peak = 0.9;
  const seen: DuelEvent[] = [];
  for (let u = t; u < t + arena.setMs + DUEL.FINALE_MS + DUEL.DONE_MS + 200; u += 50) seen.push(...duelStep(d, u, 50, stand, arena));
  const fin = seen.find((e) => e.k === 'finale') as Extract<DuelEvent, { k: 'finale' }>, dn = seen.find((e) => e.k === 'done') as Extract<DuelEvent, { k: 'done' }>;
  assert(fin && fin.fused, 'the finale fused');
  assert(dn && dn.winner === 1, 'the higher style won');
  assert(seen.filter((e) => e.k === 'set').length === 1 && d.set === 2, 'the next set');
  assert(onBeat(4.5, 120) && !onBeat(4.5 + 0.2, 120), 'the 8th-note window');
});

// ---------------------------------------------------------------- the contact, on real bodies
const T = nodeArena('temple');

/** two Characters on the duel's profile, facing each other `gap` apart, free (or locked), and a Contact */
function pair(gap: number, locked = false) {
  const plane = { ...duelPlane(T.arena), id: 'test', origin: [0, 0, 0] as [number, number, number], right: [1, 0, 0] as [number, number, number], halfWidth: 6, ground: 0, ledges: [], walls: [], spawns: [[-1, 0], [1, 0]] as [number, number][] };
  const terrain = { groundAt: () => 0, solids: [] };
  const a = new Character({ seat: 0, plane: locked ? plane : null, terrain }), b = new Character({ seat: 1, plane: locked ? plane : null, terrain });
  a.setProfile('duel'); b.setProfile('duel');
  if (locked) { a.reset(-gap / 2, 0); b.reset(gap / 2, 0); } else { a.reset(-gap / 2, 0, 0); b.reset(gap / 2, 0, 0); }
  a.lookAt = b.root; b.lookAt = a.root;
  const con = new Contact([a, b]);
  let t = 0;
  const step = (n: number, ins: (i: number) => [ContactInput, ContactInput] = () => [noInput(), noInput()], beatOn = false, its: [Partial<ReturnType<typeof makeIntent>>, Partial<ReturnType<typeof makeIntent>>] = [{}, {}]) => {
    const ev: ContactEvent[] = [];
    for (let i = 0; i < n; i++) {
      t += 1 / 60;
      a.update(1 / 60, its[0], { beats: t * 2, bpm: 120 }); b.update(1 / 60, its[1], { beats: t * 2, bpm: 120 });
      ev.push(...con.step(ins(i), 1 / 60, beatOn));
      con.pose(0); con.pose(1);
    }
    return ev;
  };
  step(20);
  return { a, b, con, step };
}
const grab = (edge: boolean, stick: [number, number] = [0, 0]): ContactInput => ({ ...noInput(), grab: true, grabEdge: edge, stick });

test('a catch: a grab with a hand in reach of the other joins them, the grabber the base; out of reach nothing', () => {
  const far = pair(2.2);
  assert(!far.step(5, (i) => [grab(i === 0), noInput()]).length && !far.con.link, 'out of reach');
  const { con, step } = pair(0.8);
  const ev = step(3, (i) => [grab(i === 0), noInput()]);
  const c = ev.find((e) => e.kind === 'catch');
  assert(c && con.link && con.link.holder === 0 && con.link.held === 1, `caught: ${ev.map((e) => e.kind)}`);
  return `part ${con.link!.part}, rope ${con.link!.rest.toFixed(2)} m`;
});

test('caught out of the air: an aerial, the base the one on the ground', () => {
  const { b, con, step } = pair(0.85);
  // in the air beside the other, its hands at the other's
  b.root[1] = 0.45; b.v = [0, -0.5, 0]; b.grounded = false; b.support = null;
  const ev = step(1, () => [grab(true), noInput()]);
  const c = ev.find((e) => e.kind === 'aerial' || e.kind === 'catch');
  assert(c && c.kind === 'aerial' && con.link, `caught out of the air: ${ev.map((e) => e.kind)}`);
  assert(con.link!.holder === 0 && c!.seat === 0, `the grounded grabber is the base (holder ${con.link!.holder})`);
  return c!.kind;
});

test('the swing: the rope holds the held body at its length; the pump spins it round, harder on the beat; a swing link per arc', () => {
  const run = (beatOn: boolean) => {
    const { b, con, step } = pair(0.8);
    step(2, (i) => [grab(i === 0), noInput()]);
    assert(con.link, 'joined');
    let most = 0, speed = 0, swings = 0;
    const ev = step(90, () => [grab(false, [0, 1]), noInput()], beatOn);
    swings = ev.filter((e) => e.kind === 'swing').length;
    const L = con.link!;
    most = Math.hypot(b.root[0] - con['chars'][0].root[0], b.root[2] - con['chars'][0].root[2]);
    speed = Math.hypot(b.v[0], b.v[1], b.v[2]);
    return { most, speed, swings, rest: L.rest, air: !b.grounded };
  };
  const off = run(false), on = run(true);
  assert(off.air && off.most < off.rest + 0.6, `carried off its feet on the rope (${off.most.toFixed(2)} m out, rope ${off.rest.toFixed(2)})`);
  assert(off.speed > 3 && off.swings >= 1, `swung round (${off.speed.toFixed(1)} m/s, ${off.swings} swings)`);
  assert(on.speed > off.speed, `harder on the beat (${on.speed.toFixed(1)} > ${off.speed.toFixed(1)})`);
  return `${off.speed.toFixed(1)} m/s off the beat, ${on.speed.toFixed(1)} on; ${off.swings} swings in 1.5 s`;
});

test('the fling: let go mid-swing and the held body leaves faster, aimed by the stick; flown until it lands, the flinger credited', () => {
  const { b, con, step } = pair(0.8);
  step(2, (i) => [grab(i === 0), noInput()]);
  step(60, () => [grab(false, [0, 1]), noInput()]);
  const before = Math.hypot(b.v[0], b.v[1], b.v[2]);
  const ev = step(1, () => [{ ...noInput(), stick: [1, 0] }, noInput()]);
  const fl = ev.find((e) => e.kind === 'fling');
  assert(fl && !con.link && ev.some((e) => e.kind === 'flown'), `flung: ${ev.map((e) => e.kind)}`);
  const after = Math.hypot(b.v[0], b.v[1], b.v[2]);
  assert(after > before * 1.2, `faster: ${before.toFixed(1)} → ${after.toFixed(1)} m/s`);
  let landed = false;
  for (let i = 0; i < 240 && !landed; i++) landed = step(1).some((e) => e.kind === 'landed');
  assert(landed, 'landed (the flinger credited)');
  return `${before.toFixed(1)} → ${after.toFixed(1)} m/s`;
});

test('the lift: held above the base, a jump launches off its hands higher than any jump; a counter spins out', () => {
  const { a, b, con, step } = pair(0.8);
  step(2, (i) => [grab(i === 0), noInput()]);
  // held up above the base's head
  b.root[1] = a.root[1] + 1.7; b.grounded = false; b.support = null; b.v = [0, 0, 0];
  const ev = step(1, () => [grab(false), { ...noInput(), jump: true }]);
  assert(ev.some((e) => e.kind === 'lift') && !con.link, `lift: ${ev.map((e) => e.kind)}`);
  assert(b.v[1] >= CONTACT.LAUNCH - 1 && CONTACT.LAUNCH > DUEL_PHYS.jumpV, `launched at ${b.v[1].toFixed(1)} m/s (a jump is ${DUEL_PHYS.jumpV})`);
  let top = b.root[1];
  for (let i = 0; i < 60; i++) { step(1, undefined, false, [{}, { jumpHeld: true }]); top = Math.max(top, b.root[1]); }
  assert(top - (a.root[1] + 1.7) > jumpHeight(10, DUEL_PHYS), `rose ${(top - a.root[1] - 1.7).toFixed(2)} m over the lift point`);
  const p2 = pair(0.8);
  p2.step(2, (i) => [grab(i === 0), noInput()]);
  const ev2 = p2.step(1, () => [grab(false), { ...noInput(), dodge: true, stick: [0, 1] }]);
  assert(ev2.some((e) => e.kind === 'counter') && !p2.con.link, 'a counter spins out');
});

test('the vault: a body falling onto the other\'s shoulders bounces off them', () => {
  const { a, b, step } = pair(0.8);
  a.root = [b.root[0] + 0.1, b.root[1] + 1.6, b.root[2]]; a.grounded = false; a.support = null; a.v = [0, -3, 0];
  const ev = step(1);
  assert(ev.some((e) => e.kind === 'vault') && a.v[1] > 10, `vault: ${ev.map((e) => e.kind)}, ${a.v[1].toFixed(1)} m/s up`);
});

test('locked: the contact stays in the stage plane', () => {
  const { a, b, con, step } = pair(0.8, true);
  step(2, (i) => [grab(i === 0), noInput()]);
  assert(con.link, 'joined locked');
  step(60, () => [grab(false, [1, 0]), noInput()]);
  step(1, () => [noInput(), noInput()]);
  const n = (c: Character) => Math.abs((c.root[2] - c.plane!.origin[2]));
  assert(n(a) < 0.05 && n(b) < 0.05 && Math.abs(b.v[2]) < 1e-6, `on the plane: ${n(a).toFixed(3)}, ${n(b).toFixed(3)}`);
});

test('the grab is the punch button: taken from the body; a base holding braces, a held body\'s jump is the contact\'s', () => {
  const c = new Character({ seat: 0, plane: null });
  const it = { ...makeIntent(), punch: true, punchHeld: true, moveX: 1, jump: true, jumpHeld: true };
  const ci = splitIntent(c, it, true, false);
  assert(ci.grab && ci.grabEdge && !it.punch && !it.punchHeld, 'the grab');
  assert(it.moveX === 0 && !it.jump && Math.hypot(ci.stick[0], ci.stick[1]) > 0.9, 'braced, the stick the pump');
  const it2 = { ...makeIntent(), jump: true };
  const ci2 = splitIntent(c, it2, false, true);
  assert(ci2.jump && !it2.jump, 'held: the jump the contact\'s');
});

// ---------------------------------------------------------------- the virtual players
test('jump height: the brain\'s model of the body\'s jump (the duel\'s profile)', () => {
  near(jumpHeight(10, DUEL_PHYS), 2.2, 0.06, 'the full jump');
  const h = holdFor(1.0, DUEL_PHYS);
  near(jumpHeight(h, DUEL_PHYS), 1.0, 0.02, 'a held hop');
});

test('two virtual players dance a set in the temple and the geode, free and locked, deterministically: catches, swings, flings, combos', () => {
  const out: string[] = [];
  for (const w of ['temple', 'geode']) for (const locked of [false, true]) {
    const { arena: A, world: W } = nodeArena(w);
    const run = () => simulateDuel({ arena: A, world: W, locked, brains: makeBrains(['lead', 'flyer'], [0.7, 0.7], [3, 9]), sets: 1, setMs: 30000, seconds: 60 });
    const r1 = run(), r2 = run();
    const tag = `${w} ${locked ? 'locked' : 'free'}`;
    assert(r1.sets.length === 1, `${tag}: a set finished`);
    assert(r1.sets[0].style[0] === r2.sets[0].style[0] && r1.stats.links === r2.stats.links, `${tag}: the same seeds dance the same set`);
    const S = r1.stats;
    assert(S.catches + S.aerials >= 4 && S.flings >= 2 && S.swings >= 2, `${tag}: contact (${S.catches} catches, ${S.aerials} aerial, ${S.swings} swings, ${S.flings} flings)`);
    assert(r1.seats.every((s) => s.combos >= 2), `${tag}: combos`);
    assert(S.falls <= 6, `${tag}: few falls (${S.falls})`);
    out.push(`${tag} ${S.catches + S.aerials} catches, ${S.flings} flings, longest combo ${Math.max(r1.seats[0].longest, r1.seats[1].longest)}`);
  }
  return out.join('; ');
});

test('the brain holds its stick like a thumb: no flicker frame to frame', () => {
  let flips = 0, frames = 0, prev = '0,0';
  simulateDuel({
    arena: T.arena, world: T.world, brains: makeBrains(['flyer', 'lead'], [0.6, 0.6], [5, 6]), sets: 1, setMs: 30000, seconds: 40,
    each: (f) => { const s = `${f.intents[0].moveX},${f.intents[0].moveZ}`; if (s !== prev && prev !== '0,0' && s !== '0,0') flips++; prev = s; frames++; },
  });
  const perMin = flips / (frames / 3600);
  assert(perMin < 240, `${perMin.toFixed(0)} changes a minute`);
  assert(new DuelBrain({ style: 'base' }).name === 'duel-base', 'named');
  return `${perMin.toFixed(0)} stick changes a minute`;
});

void DuelMatch;
test('the HUD state (v2 with its optional fields): beats aligned with links, the combo ended and cashed, lead, best, pop ids, a fling direction', () => {
  const { d, t } = playing();
  const hud = new DuelHud();
  const seats: HudSeat[] = [0, 1].map((k) => ({ name: `P${k + 1}`, matter: 'fire', screen: [0.3 + 0.4 * k, 0.5], dash: 1, holding: false, held: false }));
  const ev = [...duelLink(d, 0, 'catch', true, t), ...duelLink(d, 0, 'swing', false, t + 100), ...duelLink(d, 0, 'fling', true, t + 200)];
  const touches: ContactEvent[] = [{ kind: 'fling', seat: 0, other: 1, perfect: true, at: [0, 1, 0], v: [5, 0, 0] }];
  hud.events(ev, touches, seats, [0.5, 0.5], (p) => [0.5 + p[0] * 0.05, 0.5 - p[1] * 0.05]);
  let st = hud.build(d, t + 200, 1 / 60, seats, 0, 120, 60000, { on: false });
  const P = st.players[0];
  assert(P.combo.n === 3 && P.combo.beats?.join() === 'true,false,true', `beats aligned (${P.combo.links} / ${P.combo.beats})`);
  assert(P.lead === 1 && st.players[1].lead === 0 && P.best === 3, `lead ${P.lead}, best ${P.best}`);
  const fl = st.pops.find((p) => p.kind === 'fling');
  assert(!!fl?.id && !!fl.dir && fl.dir[0] > 0.99, `a fling pop with an id and its direction (${fl?.dir})`);
  assert(new Set(st.pops.map((p) => p.id)).size === st.pops.length, 'pop ids differ');
  // the combo ends on the ground: cashed for one frame
  let end: DuelEvent[] = [];
  for (let k = 1; k < 200 && !end.some((e) => e.k === 'combo'); k++) end = duelStep(d, t + 200 + k * 16, 16, stand, arena);
  hud.events(end, [], seats, null);
  st = hud.build(d, t + 3400, 1 / 60, seats, 0, 120, 60000, { on: false });
  assert(st.players[0].combo.ended === 'cashed' && (st.players[0].combo.cashed ?? 0) > 0, `cashed (${JSON.stringify(st.players[0].combo)})`);
  st = hud.build(d, t + 3416, 1 / 60, seats, 0, 120, 60000, { on: false });
  assert(st.players[0].combo.ended === undefined, 'ended only on that frame');
});

done();
