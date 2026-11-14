// The dance battle: its rules (shared/duel.ts) on plain data, the contact physics (contact.ts) on real bodies free in
// 3D and locked, and two virtual players dancing it in Node (sim.ts), free and locked. Run by scripts/test-ts.mjs.
import { test, assert, near, done } from '../../dancer/test/check';
import { DUEL, newDuel, duelStep, duelLink, duelContact, duelFlingLanded, frozen, onBeat, tierOf, type DuelBody, type DuelEvent, type DuelState } from '../../../shared/duel.ts';
import { Character, DUEL_PHYS, type CharEvent } from '../../dancer/character';
import { Contact, CONTACT, noInput, splitIntent, type ContactEvent, type ContactInput } from '../contact';
import { DuelMatch, duelPlane } from '../match';
import { simulateDuel, makeBrains, nodeArena } from '../sim';
import { DuelBrain, holdFor, jumpHeight } from '../../ai/duel-brain';
import { makeIntent } from '../../input/intent';
import { DuelHud, type HudSeat } from '../hud-state';
import { box } from '../../worlds/solids';

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
  // high and joined: the merge charges, and fires
  d.energy = 0.95;
  let u = t, merged: Extract<DuelEvent, { k: 'merge' }> | null = null;
  duelContact(d, true, u, 1);
  for (; u < t + 20000 && !merged; u += 16) for (const e of duelStep(d, u, 16, air, arena)) if (e.k === 'merge') merged = e;
  assert(merged && merged.energy >= DUEL.MERGE_AT && merged.n === 1, `merged after ${((u - t) / 1000).toFixed(1)} s joined`);
  near(d.energy, merged.energy - DUEL.MERGE_SPEND, 1e-9, 'a merge spends some of the energy');
  const e0 = d.energy;
  duelContact(d, false, u);
  for (let w = u; w < u + 3000; w += 16) duelStep(d, w, 16, stand, arena);
  assert(d.energy < e0, 'apart: it ebbs');
  return `merged after ${((u - t) / 1000).toFixed(1)} s joined`;
});

// ---------------------------------------------------------------- the pacing (report 12: full in 20-40 s, a MERGE every
// 1.5-4 s after, every finale fused)
/** a duel in play `ms` into its set */
function playingAt(ms: number) {
  const p = playing();
  p.d.playFrom = p.t - ms;
  return p;
}
/** a set of SET_MS (duelLink's own default): the pacing tests run inside it */
const long = { ...arena, setMs: DUEL.SET_MS };
const apart = (gap: number): [DuelBody, DuelBody] => [{ y: 0, grounded: true, x: 0, z: 0 }, { y: 0, grounded: true, x: gap, z: 0 }];

test('the energy ebbs faster the further apart the two are, and faster when the pair repeats itself', () => {
  const ebb = (gap: number, stale: boolean) => {
    const { d, t } = playingAt(40000);
    d.energy = 0.8;
    if (stale) d.recent = ['swing', 'fling', 'swing', 'fling', 'swing', 'fling'];
    for (let u = t; u < t + 2000; u += 16) duelStep(d, u, 16, apart(gap), long);
    return 0.8 - d.energy;
  };
  const near1 = ebb(1.5, false), far = ebb(9, false), stale = ebb(1.5, true);
  assert(far > near1 * 2, `far apart ebbs faster (${far.toFixed(3)} vs ${near1.toFixed(3)} in 2 s)`);
  near(far / 2, DUEL.EBB_FAR, 0.002, 'beyond FAR_M: EBB_FAR a second');
  assert(stale > near1 * 1.3, `repeating ebbs faster (${stale.toFixed(3)} vs ${near1.toFixed(3)})`);
  return `in 2 s: ${near1.toFixed(3)} near, ${far.toFixed(3)} far, ${stale.toFixed(3)} near and repeating`;
});

test('a link the pair keeps making takes energy away; a new one gives more; a hold fills in its first moments, held on it ebbs', () => {
  const { d, t } = playingAt(40000);
  duelContact(d, true, t, 1);
  d.energy = 0.3;
  const gain = (kind: Parameters<typeof duelLink>[2], seat = 0) => { const e0 = d.energy; duelLink(d, seat, kind, false, t); return d.energy - e0; };
  const first = gain('dash'), second = gain('dash', 1), third = gain('dash');
  assert(first > second && second > 0, `a new kind more than a second (${first.toFixed(4)} > ${second.toFixed(4)})`);
  assert(third < 0, `the third of a kind in the pair's last ${DUEL.RECENT} takes away (${third.toFixed(4)})`);
  // (swings in one hold are one swing going on: neither repeated nor counted again)
  d.recent = []; gain('swing');
  const s2 = gain('swing'), s3 = gain('swing');
  assert(s2 === 0 && s3 === 0, `a hold's swings after its first: nothing (${s2}, ${s3})`);
  // the hold: its first CONTACT_FRESH_MS fill, then nothing
  const { d: h, t: t0 } = playingAt(40000);
  h.energy = 0.3;
  duelContact(h, true, t0, 1);
  let u = t0;
  for (; u < t0 + DUEL.CONTACT_FRESH_MS; u += 16) duelStep(h, u, 16, air, long);
  const fresh = h.energy - 0.3, e1 = h.energy;
  for (; u < t0 + 4000; u += 16) duelStep(h, u, 16, air, long);
  const held = (4000 - DUEL.CONTACT_FRESH_MS) / 1000;
  assert(fresh > 0.03, `the hold's first moments fill (${fresh.toFixed(3)})`);
  near(e1 - h.energy, DUEL.EBB_HELD * held, 0.003, 'held on, it ebbs at EBB_HELD');
});

test('the set builds with its music: the same play early in a set fills less; near the top it is hard won', () => {
  const g = (ms: number, e: number) => { const { d, t } = playingAt(ms); d.energy = e; duelContact(d, true, t, 1); duelLink(d, 0, 'catch', false, t); return d.energy - e; };
  const early = g(0, 0.2), late = g(40000, 0.2), top = g(40000, 0.9);
  near(early / late, DUEL.ARC_FROM, 1e-6, 'at the set\'s start ARC_FROM of it');
  assert(top < late * 0.5, `near the top a link is worth less (${top.toFixed(4)} vs ${late.toFixed(4)})`);
});

test('the merge rests after each: at most one inside MERGE_REST_MS, however long the two stay joined and high', () => {
  const { d, t } = playingAt(20000);
  const at: number[] = [];
  // joined and kept high (as if every link landed): merges only every MERGE_REST_MS and a little
  for (let u = t; u < t + 30000; u += 16) {
    d.energy = 1;
    if (Math.floor((u - t) / 1500) !== Math.floor((u - 16 - t) / 1500)) duelContact(d, false, u);
    else duelContact(d, true, u, 1);
    for (const e of duelStep(d, u, 16, air, long)) if (e.k === 'merge') at.push(u - t);
  }
  assert(at.length >= 1 && at.length <= Math.ceil(30000 / DUEL.MERGE_REST_MS), `merges at ${at.map((x) => (x / 1000).toFixed(1)).join(', ')} s`);
  for (let i = 1; i < at.length; i++) assert(at[i] - at[i - 1] >= DUEL.MERGE_REST_MS, `rested between (${at[i] - at[i - 1]} ms)`);
  // never below MERGE_AT
  const { d: lo, t: t1 } = playingAt(30000);
  duelContact(lo, true, t1, 1);
  let any = false;
  for (let u = t1; u < t1 + 10000; u += 16) { lo.energy = DUEL.MERGE_AT - 0.05; any ||= duelStep(lo, u, 16, air, long).some((e) => e.k === 'merge'); }
  assert(!any, 'no merge below MERGE_AT');
  return `merges at ${at.map((x) => (x / 1000).toFixed(1)).join(', ')} s of 30 s held high`;
});

test('the fusion is earned: a set that merged and held its energy at FUSE_AT for FUSE_HOLD_MS; a high peak alone is not enough', () => {
  const finale = (setup: (d: DuelState, t: number) => void) => {
    const { d, t } = playing();
    setup(d, t);
    let fin: Extract<DuelEvent, { k: 'finale' }> | null = null;
    for (let u = t; u < t + arena.setMs + 500 && !fin; u += 50) for (const e of duelStep(d, u, 50, stand, arena)) if (e.k === 'finale') fin = e;
    return fin!;
  };
  // the pool's set in report 12: a peak of 0.84, no merge (it fused then)
  assert(!finale((d) => { d.peak = 0.84; }).fused, 'a peak of 0.84 and no merge: no fusion');
  // a touch of the top: peak 1, a merge, but under the top for most of it
  assert(!finale((d) => { d.peak = 1; d.merges = 1; d.highBest = DUEL.FUSE_HOLD_MS - 500; }).fused, 'the top touched, not held: no fusion');
  assert(!finale((d) => { d.peak = 1; d.highBest = DUEL.FUSE_HOLD_MS + 2000; }).fused, 'held high but never merged: no fusion');
  assert(finale((d) => { d.merges = 1; d.highBest = DUEL.FUSE_HOLD_MS; }).fused, 'merged and held high: the fusion');
  // the stretch is timed by duelStep: energy held at the top FUSE_HOLD_MS
  const { d, t } = playingAt(30000);
  for (let u = t; u < t + DUEL.FUSE_HOLD_MS + 100; u += 16) { d.energy = 0.95; duelStep(d, u, 16, apart(1), long); }
  assert(d.highBest >= DUEL.FUSE_HOLD_MS, `timed: ${d.highBest} ms at the top`);
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

test('a set on the music: play, the finale (fused when it was earned), the higher style wins, the next set', () => {
  const { d, t } = playing();
  d.seats[0].style = 50; d.seats[1].style = 80; d.peak = 0.95; d.merges = 1; d.highBest = DUEL.FUSE_HOLD_MS;
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
  // (being flung is not the flown body's move: its link comes when it lands the flight)
  assert(fl && !con.link && con.flown?.flyer === 1 && !ev.some((e) => e.kind === 'flown'), `flung: ${ev.map((e) => e.kind)}`);
  const after = Math.hypot(b.v[0], b.v[1], b.v[2]);
  assert(after > before * 1.2, `faster: ${before.toFixed(1)} → ${after.toFixed(1)} m/s`);
  let end: ContactEvent[] = [];
  for (let i = 0; i < 240 && !end.some((e) => e.kind === 'landed'); i++) end = step(1);
  const landed = end.find((e) => e.kind === 'landed'), own = end.find((e) => e.kind === 'flown');
  assert(landed && landed.seat === 0 && landed.how === 'feet', `landed (the flinger credited): ${end.map((e) => e.kind)}`);
  assert(own && own.seat === 1, 'and the flown body\'s own link for landing it');
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

test('two virtual players dance a set in the temple and the geode (free and locked) and the pool (locked), deterministically: catches, swings, flings, combos', () => {
  const out: string[] = [];
  for (const [w, locked] of [['temple', false], ['temple', true], ['geode', false], ['geode', true], ['pool', true]] as const) {
    const { arena: A, world: W } = nodeArena(w);
    const run = () => simulateDuel({ arena: A, world: W, locked, brains: makeBrains(['lead', 'flyer'], [0.7, 0.7], [3, 9]), sets: 1, setMs: 30000, seconds: 60 });
    const r1 = run(), r2 = run();
    const tag = `${w} ${locked ? 'locked' : 'free'}`;
    assert(r1.sets.length === 1, `${tag}: a set finished`);
    assert(r1.sets[0].style[0] === r2.sets[0].style[0] && r1.stats.links === r2.stats.links, `${tag}: the same seeds dance the same set`);
    const S = r1.stats;
    // (the pool is wide and its players meet less: report 12 and the pacing measures)
    const [nc, nf, ns] = w === 'pool' ? [2, 1, 0] : [4, 2, 2];
    assert(S.catches + S.aerials >= nc && S.flings >= nf && S.swings >= ns, `${tag}: contact (${S.catches} catches, ${S.aerials} aerial, ${S.swings} swings, ${S.flings} flings)`);
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

// ---------------------------------------------------------------- combos: the held body, the flown body, tiers
test('report 12\'s bug: a body dragged along a solid\'s face, pushing into it, starts a wall run each time it meets it; held (env.held) never', () => {
  const run = (held: boolean) => {
    const wall = box([1, 2, 0], [0.5, 2, 4]); // its face at x = 0.5, looking toward -x
    const c = new Character({ seat: 0, plane: null, terrain: { groundAt: () => 0, solids: [wall] } });
    c.setProfile('duel');
    c.reset(0, 0, -2);
    let runs = 0, walls = 0;
    for (let i = 0; i < 40; i++) {
      // the contact carries it: each frame put back in the air, fast along the face, touching it every other frame
      // (swung on and off it), the stick into it
      c.root = [0.5 - c.phys.bodyR - (i % 2 ? 0.3 : 0.005), 1.2, -2 + i * 0.1]; c.grounded = false; c.support = null; c.v = [0.4, 0, 6];
      c.env.held = held;
      c.update(1 / 60, { ...makeIntent(), moveX: 1 }, { beats: i / 30, bpm: 120 });
      for (const e of c.events) if (e.type === 'wall') { walls++; if (e.run) runs++; }
      c.events = [];
    }
    return { runs, walls };
  };
  const free = run(false), held = run(true);
  assert(free.runs >= 5, `free, it wall-runs each time it meets the face (${free.runs} in 40 frames): the bug's mechanism`);
  assert(held.walls === 0, `held, no wall slide or run at all (${held.walls})`);
  return `${free.runs} wall runs in 40 frames free, ${held.walls} held`;
});

test('a held body makes no links of its own (DuelMatch): its wall runs and dashes while carried are not its combo; the holder\'s are', () => {
  const plane = duelPlane(T.arena);
  const terrain = { groundAt: () => 0, solids: [] };
  const chars = [0, 1].map((k) => { const c = new Character({ seat: k, plane: null, terrain }); c.setProfile('duel'); return c; }) as [Character, Character];
  const m = new DuelMatch(chars, T.arena, plane, 0, 120);
  let now = 0;
  const frame = (ins: [ContactInput, ContactInput], body?: CharEvent[][]) => {
    now += 1000 / 60;
    for (const c of chars) c.update(1 / 60, makeIntent(), { beats: (now / 1000) * 2, bpm: 120 });
    if (body) for (let k = 0; k < 2; k++) chars[k].events.push(...body[k]);
    return m.step(now, (now / 1000) * 2, 120, 1000 / 60, ins);
  };
  for (let i = 0; i < 400 && m.state.phase !== 'play'; i++) frame([noInput(), noInput()]);
  assert(m.state.phase === 'play', 'in play');
  chars[0].reset(-0.4, 0, 0); chars[1].reset(0.4, 0, 0);
  chars[0].lookAt = chars[1].root; chars[1].lookAt = chars[0].root;
  for (let i = 0; i < 3; i++) frame([noInput(), noInput()]);
  for (let i = 0; i < 4 && !m.contact.link; i++) frame([grab(i === 0), noInput()]);
  assert(m.contact.link?.held === 1, 'seat 1 held');
  const links: Extract<DuelEvent, { k: 'link' }>[] = [];
  for (let i = 0; i < 20; i++) {
    const ev = frame([grab(false, [0, 1]), noInput()], [[{ type: 'dash' }], [{ type: 'wall', run: true }, { type: 'dash' }]]);
    for (const e of ev) if (e.k === 'link') links.push(e);
    if (!m.contact.link) break;
  }
  assert(chars[1].env.held === !!m.contact.link, 'the held body is told (Character.env.held)');
  const mine = links.filter((e) => e.seat === 1);
  assert(!mine.some((e) => e.kind === 'wallrun' || e.kind === 'dash'), `none of the held body's own (${mine.map((e) => e.kind)})`);
  assert(links.some((e) => e.seat === 0 && e.kind === 'dash'), 'the holder\'s own still count');
  return `holder ${links.filter((e) => e.seat === 0).length} links, held ${mine.length}`;
});

test('a combo banks once its dancer has been held more than HELD_BANK_BEATS beats', () => {
  const { d, t } = playing();
  duelLink(d, 1, 'walljump', false, t); duelLink(d, 1, 'dash', false, t + 50);
  duelContact(d, true, t + 100, 1);
  let banked: Extract<DuelEvent, { k: 'combo' }> | null = null, at = 0;
  for (let u = t + 100; u < t + 3000 && !banked; u += 16) for (const e of duelStep(d, u, 16, air, arena)) if (e.k === 'combo') { banked = e; at = u; }
  const beat = 60000 / arena.bpm;
  assert(banked && banked.why === 'held' && banked.seat === 1 && banked.banked > 0, `banked held (${JSON.stringify(banked)})`);
  near(at - (t + 100), DUEL.HELD_BANK_BEATS * beat, 20, 'after HELD_BANK_BEATS');
  // the holder's combo goes on
  const { d: e, t: t2 } = playing();
  duelLink(e, 0, 'catch', false, t2);
  duelContact(e, true, t2, 1);
  for (let u = t2; u < t2 + 1500; u += 16) duelStep(e, u, 16, stand, arena);
  assert(e.seats[0].combo.live, 'the holder\'s combo is live');
  return `banked after ${((at - t - 100) / beat).toFixed(2)} beats held`;
});

test('past ×4, tiers: a word and a colour at 12, 18, 26, 36 varied links (repeats don\'t climb), worth more banked', () => {
  const { d, t } = playing();
  const kinds = ['walljump', 'dash', 'flip', 'kick', 'au', 'wallrun'] as const;
  const tiers: Extract<DuelEvent, { k: 'tier' }>[] = [];
  for (let i = 0; i < 20; i++) for (const e of duelLink(d, 0, kinds[i % kinds.length], false, t + i * 100)) if (e.k === 'tier') tiers.push(e);
  assert(tiers.length === 2 && tiers[0].n === 12 && tiers[0].name === DUEL.TIERS[0].name && tiers[1].n === 18 && tiers[1].tier === 2, `tiers at ${tiers.map((x) => `${x.name} ${x.n}`)}`);
  assert(d.seats[0].combo.tier === 2 && tierOf(35) === 3 && tierOf(36) === 4 && tierOf(11) === 0, 'tierOf');
  // the same link over and over: the count climbs, the tier doesn't
  const { d: r, t: t2 } = playing();
  let rep = 0;
  for (let i = 0; i < 30; i++) rep += duelLink(r, 0, 'dash', false, t2 + i * 100).filter((e) => e.k === 'tier').length;
  assert(rep === 0 && r.seats[0].combo.n === 30, `30 dashes: no tier (${rep})`);
  // banked with the bonus
  const C = d.seats[0].combo, want = Math.round(C.score * C.mult * (1 + DUEL.TIER_BONUS * 2));
  let got = -1;
  for (let u = t + 2500; u < t + 2500 + DUEL.COMBO_IDLE_MS + 100 && got < 0; u += 16) for (const e of duelStep(d, u, 16, air, arena)) if (e.k === 'combo') got = e.banked;
  assert(got === want, `banked ${got}, want ${want}`);
  return tiers.map((x) => `${x.name} at ${x.n}`).join(', ');
});

test('the HUD\'s pops: one SWING a hold counting up in place (its id kept); no more than a few new words a second', () => {
  const { d, t } = playing();
  const hud = new DuelHud();
  const seats: HudSeat[] = [0, 1].map((k) => ({ name: `P${k + 1}`, matter: 'fire', screen: [0.3 + 0.4 * k, 0.5], dash: 1, holding: false, held: false }));
  const T0: ContactEvent = { kind: 'catch', seat: 0, other: 1, perfect: false, at: [0, 1, 0] };
  const sw = (n: number): ContactEvent => ({ kind: 'swing', seat: 0, other: 1, perfect: false, at: [0, 1, 0], n });
  hud.events([], [T0], seats, [0.5, 0.5]); hud.build(d, t, 0.3, seats, 0, 120, 60000, { on: true });
  const ids: number[] = [], texts: string[] = [];
  for (let n = 1; n <= 4; n++) {
    hud.events([], [sw(n)], seats, [0.5, 0.5]);
    const st = hud.build(d, t + n * 500, 0.5, seats, 0, 120, 60000, { on: true });
    const p = st.pops.find((q) => q.kind === 'swing')!;
    ids.push(p.id!); texts.push(p.text);
  }
  assert(new Set(ids).size === 1, `one SWING pop (${ids})`);
  assert(texts.join() === 'SWING,SWING ×2,SWING ×3,SWING ×4', texts.join());
  // a new hold: a new SWING
  hud.events([], [{ ...T0, kind: 'fling' }, T0, sw(1)], seats, [0.5, 0.5]);
  const st2 = hud.build(d, t + 3000, 0.016, seats, 0, 120, 60000, { on: true });
  assert(st2.pops.some((q) => q.kind === 'swing' && q.id !== ids[0]), 'a new hold, a new SWING');
  // a burst: twelve named moves inside a second; the set's own words (MERGE) still show
  const h2 = new DuelHud(), born = new Set<number>();
  const burst: ContactEvent[] = [];
  for (let i = 0; i < 12; i++) burst.push({ kind: (['catch', 'fling', 'lift', 'vault', 'counter', 'swing'] as const)[i % 6], seat: i % 2, other: 1 - i % 2, perfect: i % 3 === 0, at: [0, 1, 0], n: 1 });
  let merge = false;
  for (let i = 0; i < 12; i++) {
    h2.events(i === 6 ? [{ k: 'merge', energy: 0.9, n: 1 }] : [], [burst[i]], seats, [0.5, 0.5]);
    const st = h2.build(d, t + i * 80, 0.08, seats, 0, 120, 60000, { on: true });
    for (const p of st.pops) if (p.kind !== 'merge') born.add(p.id!); else merge = true;
  }
  assert(born.size <= 4 && merge, `${born.size} new words (not the set's) in ~1 s of twelve moves; MERGE shown ${merge}`);
  return `SWING ×4 in one pop; ${born.size} words for twelve moves in a second`;
});

test('the pacing, played: virtual players over seeds in the temple and the pool, free and locked: the merge late and rare, the fusion earned, no wall-run bursts, a few words a second', () => {
  const out: string[] = [];
  let sets = 0, fused = 0, mergedSets = 0, firstMin = Infinity, popsMax = 0, mergesMax = 0;
  for (const w of ['temple', 'pool']) for (const locked of [false, true]) for (const [pair, seed] of [[['lead', 'flyer'], 11], [['lead', 'lead'], 23]] as const) {
    const { arena: A, world: W } = nodeArena(w);
    const runs: number[][] = [[], []];
    const r = simulateDuel({
      arena: A, world: W, locked, brains: makeBrains([pair[0], pair[1]], [0.7, 0.7], [seed, seed + 7]), sets: 1, setMs: 60000, seconds: 75,
      each: (f) => { for (const e of f.events) if (e.k === 'link' && e.kind === 'wallrun') runs[e.seat].push(f.t); },
    });
    const S = r.sets[0], M = r.merges[0];
    assert(S, `${w} ${locked ? 'locked' : 'free'} ${pair}: a set finished`);
    sets++; fused += S.fused ? 1 : 0; popsMax = Math.max(popsMax, r.pops.max); mergesMax = Math.max(mergesMax, M.length);
    if (M.length) { mergedSets++; firstMin = Math.min(firstMin, M[0]); }
    assert(!S.fused || (S.merges > 0 && S.high >= DUEL.FUSE_HOLD_MS / 1000), `fused only when earned (${S.merges} merges, ${S.high} s high)`);
    for (const x of runs) for (let i = 1; i < x.length; i++) assert(x[i] - x[i - 1] > 0.5, `${w}: two wall runs ${(x[i] - x[i - 1]).toFixed(2)} s apart (the held-body bug)`);
    out.push(`${w[0]}${locked ? 'L' : 'F'} ${pair[0][0]}${pair[1][0]}: ${M.length ? M.map((x) => x.toFixed(0)).join('/') : '-'}${S.fused ? ' F' : ''}`);
  }
  assert(firstMin >= 18, `the first MERGE no sooner than 30% into a set (${firstMin.toFixed(1)} s)`);
  assert(mergesMax <= 4, `MERGE at most ${mergesMax} a minute`);
  assert(fused <= sets / 2, `the fusion is the set's event, not its habit (${fused} of ${sets})`);
  assert(popsMax <= 5, `at most ${popsMax} new words in a second`);
  return `${mergedSets} of ${sets} sets merged, the first at ${firstMin.toFixed(1)} s at the soonest; ${fused} fused; pops ≤ ${popsMax}/s; merges (s): ${out.join(', ')}`;
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
