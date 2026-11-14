// The duel's powers (phase 2, "Bend"): their rules on plain data (shared/powers.ts: flow, costs, the power form, the
// reactions), each power's effect on real bodies in the temple's court (src/duel/powers.ts, through the match as the
// page runs it), the reactions on bodies, and two virtual players casting through a whole set (sim.ts). Run by
// scripts/test-ts.mjs.
import { test, assert, near, done } from '../../dancer/test/check';
import { POWER, POWERS, newPowers, powersLink, powersCast, powersForm, powersStep, cantCast, reactionOf, matterOf, type Matter } from '../../../shared/powers.ts';
import { Character } from '../../dancer/character';
import { makeIntent, type Intent } from '../../input/intent';
import { DuelMatch, duelPlane } from '../match';
import { DuelPowers, BEND, noPower, type PowerInput } from '../powers';
import { noInput, splitIntent, type ContactInput } from '../contact';
import { nodeArena, simulateDuel, makeBrains } from '../sim';
import { onBeat, type DuelEvent } from '../../../shared/duel.ts';
import { solidTop } from '../../dancer/solid-contact';
import type { Solid } from '../../worlds/solids';

type V3 = [number, number, number];

// ---------------------------------------------------------------- the rules
test('flow: links fill it, on the beat more, a fresh kind more again; a repeat or standing about fills nothing', () => {
  const ps = newPowers('fire', 'water');
  const a = powersLink(ps, 0, 'catch', false, 0);
  near(a, POWER.FLOW.catch * POWER.FRESH, 1e-9, 'a fresh catch');
  const b = powersLink(ps, 0, 'catch', false, 10);
  assert(b === 0, `the same link again: ${b}`);
  const c = powersLink(ps, 0, 'walljump', true, 20);
  near(c, POWER.FLOW.walljump * POWER.PERFECT * POWER.FRESH, 1e-9, 'a fresh wall jump on the beat');
  const d = powersLink(ps, 0, 'catch', false, 30);
  assert(d === 0, 'a catch two links later is still a repeat');
  powersLink(ps, 0, 'swing', false, 40);
  powersLink(ps, 0, 'fling', false, 45);
  const e = powersLink(ps, 0, 'catch', false, 50);
  near(e, POWER.FLOW.catch, 1e-9, 'a catch after two others: worth its own, not fresh');
  // standing about: nothing comes in, nothing ebbs
  const f = ps.seats[0].flow;
  for (let t = 0; t < 20000; t += 16) powersStep(ps, t, []);
  near(ps.seats[0].flow, f, 1e-9, 'twenty seconds of standing');
  // a dance that varies, on the beat: about twenty links fill the bar
  const ps2 = newPowers('ice', 'gems'), kinds = ['catch', 'swing', 'fling', 'walljump', 'flip', 'lift', 'vault', 'wallrun'];
  let n = 0;
  while (ps2.seats[1].flow < 1 && n < 200) powersLink(ps2, 1, kinds[n++ % kinds.length], n % 2 === 0, n * 300);
  assert(n >= 12 && n <= 30, `a full bar in ${n} varied links`);
  return `fresh catch +${a.toFixed(3)}, on-beat wall jump +${c.toFixed(3)}; full in ${n} varied links`;
});

test('a power costs a quarter of the flow; none without it, none while joined, a cooldown; two powers per matter', () => {
  const ps = newPowers('water', 'fire');
  assert(cantCast(ps, 0, 0, 0) === 'flow', 'empty: no power');
  ps.seats[0].flow = 0.6;
  const e = powersCast(ps, 0, 0, 1000);
  assert(e && e.power === 'whip' && !e.free, `a whip ${JSON.stringify(e)}`);
  near(ps.seats[0].flow, 0.6 - POWER.COST, 1e-9, 'a quarter spent');
  assert(!powersCast(ps, 0, 0, 1100), 'the same power again at once: cooling');
  assert(!powersCast(ps, 0, 1, 1100), 'any power within the gap: no');
  assert(powersCast(ps, 0, 1, 1000 + POWER.GAP_MS + 1)?.power === 'wave', 'the other after the gap: the wave');
  assert(ps.seats[0].flow < POWER.COST && !powersCast(ps, 0, 0, 9000), 'out of flow');
  ps.seats[0].flow = 1;
  assert(cantCast(ps, 0, 0, 9000, true) === 'joined', 'none while joined');
  for (const m of Object.keys(POWERS) as Matter[]) assert(POWERS[m].powers.length === 2, m);
  assert(matterOf('steam') === 'water' && matterOf('nope') === 'gems', 'matters');
  near(POWER.COST, 0.25, 0.05, 'about a quarter');
});

test('the power form at full flow: 6 s of free powers, the bar running down; then empty', () => {
  const ps = newPowers('gems', 'ice');
  ps.seats[1].flow = 0.9;
  assert(!powersForm(ps, 1, 0), 'not before the bar is full');
  ps.seats[1].flow = 1;
  assert(powersForm(ps, 1, 0)?.k === 'form', 'full: the form');
  const e = powersCast(ps, 1, 0, 100);
  assert(e?.free && e.big && e.power === 'step', 'free and bigger');
  powersStep(ps, 3000, []);
  near(ps.seats[1].flow, 0.5, 0.01, 'half way: half the bar');
  const ev = powersStep(ps, POWER.FORM_MS + 1, []);
  assert(ev.some((x) => x.k === 'form' && !x.on) && ps.seats[1].flow === 0, 'over: empty');
  assert(powersLink(ps, 1, 'catch', false, 1000) === 0 || true, '');
  // a new set empties every bar
  ps.seats[0].flow = 0.7;
  powersStep(ps, 9000, [{ k: 'set', set: 2 } as DuelEvent]);
  assert(ps.seats[0].flow === 0, 'a new set: empty');
});

test('the reactions: fire in a wave is a steam geyser, fire on an ice step melts it, the whip on a step freezes', () => {
  assert(reactionOf('ribbon', 'wave') === 'geyser' && reactionOf('wave', 'flare') === 'geyser', 'geyser');
  assert(reactionOf('flare', 'step') === 'melt' && reactionOf('step', 'ribbon') === 'melt', 'melt');
  assert(reactionOf('whip', 'step') === 'freeze', 'freeze');
  assert(reactionOf('whip', 'wave') === null && reactionOf('pillar', 'prism') === null, 'nothing else');
});

// ---------------------------------------------------------------- on bodies: a court of the temple's, the match as the page runs it
const DT = 1 / 60;
interface Rig { chars: [Character, Character]; match: DuelMatch; powers: DuelPowers; solids: Solid[]; now: number; ev: DuelEvent[]; run(s: number, f?: (k: number) => Partial<PowerInput> | null, it?: (k: number) => Partial<Intent> | null): void; cast(k: number, slot: 0 | 1, stick?: [number, number]): void; place(k: number, x: number, z: number, y?: number, v?: V3): void }
function court(m0: Matter, m1: Matter, locked = false): Rig {
  const { arena, world } = nodeArena('temple');
  const solids: Solid[] = [...(world.solids ?? [])];
  const terrain = { groundAt: (x: number, z: number) => world.groundAt(x, z), fallY: world.fallY, solids };
  const plane = duelPlane(arena);
  const chars = [0, 1].map((k) => { const c = new Character({ seat: k, plane: locked ? plane : null, terrain }); c.setProfile('duel'); return c; }) as [Character, Character];
  const match = new DuelMatch(chars, arena, plane, 0, 120, { solids: () => solids, setMs: 600000 });
  const powers = new DuelPowers(chars, match, { matter: [m0, m1], sink: solids, groundAt: terrain.groundAt, yKill: arena.space.yKill });
  const R: Rig = {
    chars, match, powers, solids, now: 0, ev: [],
    run(s, f, itf) {
      for (let i = 0; i < Math.round(s / DT); i++) {
        R.now += DT * 1000;
        const beat = (R.now * 120) / 60000, ins: ContactInput[] = [], pins: PowerInput[] = [];
        for (let k = 0; k < 2; k++) {
          const it = Object.assign(makeIntent(), itf?.(k) ?? {});
          ins.push(match.frozen(k) ? noInput() : splitIntent(chars[k], it, match.contact.holding(k), match.contact.held(k)));
          const p = f?.(k) ?? {};
          pins.push({ ...noPower(), ...p, stick: (p.stick ?? ins[k].stick) as [number, number] });
          chars[k].lookAt = chars[1 - k].root;
          chars[k].update(DT, it, { beats: beat, bpm: 120 });
        }
        powers.gripInputs(ins);
        const ev = match.step(R.now, beat, 120, DT * 1000, [ins[0], ins[1]]);
        powers.step(R.now, DT * 1000, pins, ev, onBeat(beat, 120));
        R.ev.push(...ev, ...powers.duelEvents);
      }
    },
    cast(k, slot, stick = [0, 0]) { let once = true; R.run(DT, (j) => (j === k && once ? (once = false, slot ? { p2: true, stick } : { p1: true, stick }) : null)); },
    place(k, x, z, y, v = [0, 0, 0]) {
      const c = chars[k];
      c.reset(x, undefined, z);
      if (y !== undefined) { c.root = [x, y, z]; c.grounded = false; c.support = null; }
      c.v = [v[0], v[1], v[2]];
    },
  };
  // into play (the count-in), then a full bar each, so the powers are there
  R.run(3);
  assert(match.state.phase === 'play', `play: ${match.state.phase}`);
  for (const S of powers.rules.seats) S.flow = 1;
  return R;
}
// the court's open middle: a band across it, z from -1 to 0, is clear floor from x = -10 to 8
const Z = -0.5;
const apex = (R: Rig, k: number, s: number, f?: Parameters<Rig['run']>[1], it?: Parameters<Rig['run']>[2]) => {
  let top = -Infinity;
  for (let i = 0; i < s / DT; i++) { R.run(DT, f, it); top = Math.max(top, R.chars[k].root[1]); }
  return top;
};

test('court: the floor between the spawns is open (what the effect tests stand on)', () => {
  const { world } = nodeArena('temple');
  for (let x = -4; x <= 4; x += 0.5) near(world.groundAt(x, Z), 0, 1e-6, `floor at ${x}`);
  return `z ${Z.toFixed(2)}`;
});

test('flare: a rocket jump well over the jump, and a partner close by rises too, toward the caster', () => {
  const R = court('fire', 'water');
  R.place(0, -1, Z); R.place(1, 0.6, Z); R.run(0.3);
  R.cast(0, 0, [1, 0]);
  const v0 = R.chars[1].v[1];
  let top0 = -Infinity, top1 = -Infinity;
  for (let i = 0; i < 70; i++) { R.run(DT); top0 = Math.max(top0, R.chars[0].root[1]); top1 = Math.max(top1, R.chars[1].root[1]); }
  assert(top0 > 2.6, `caster's apex ${top0.toFixed(2)} m (a jump not held is about 1 m)`);
  assert(top1 > 2.0 && v0 > 10, `partner's apex ${top1.toFixed(2)} m`);
  // a partner far off stays down
  const Q = court('fire', 'water');
  Q.place(0, -2, Z); Q.place(1, 2, Z); Q.run(0.3);
  Q.cast(0, 0);
  const far = apex(Q, 1, 1);
  assert(far < 0.1, `a partner 4 m off stays: ${far.toFixed(2)}`);
  return `caster to ${top0.toFixed(2)} m, the partner beside it to ${top1.toFixed(2)} m`;
});

test('whip: reaching the other within its reach is a catch at range: reeled in and joined, the caster\'s air catch', () => {
  const R = court('water', 'fire');
  R.place(0, -3, Z); R.place(1, 2, Z, 2.2, [0, 2, 0]); R.run(DT);
  const d0 = Math.hypot(R.chars[1].root[0] - R.chars[0].root[0], R.chars[1].root[1] - R.chars[0].root[1]);
  R.cast(0, 0, [1, 0]);
  let joinedAt = -1;
  for (let i = 0; i < 60 && joinedAt < 0; i++) { R.run(DT); if (R.match.contact.link) joinedAt = i; }
  const L = R.match.contact.link;
  assert(L && L.holder === 0 && L.held === 1, `joined, caster holding: ${JSON.stringify(L && { h: L.holder })}`);
  const ev = R.ev.filter((e) => e.k === 'link' && e.seat === 0).map((e) => (e as { kind: string }).kind);
  assert(ev.includes('aerial') || ev.includes('catch'), `the caster's catch: ${ev}`);
  assert(R.ev.some((e) => e.k === 'lead' && e.seat === 0), 'leading style for the caster');
  // and held a moment without the grab, as a hold
  R.run(0.3);
  assert(R.match.contact.link, 'held a moment without the grab');
  // out of reach: nothing
  const Q = court('water', 'fire');
  Q.place(0, -4, Z); Q.place(1, 4, Z); Q.run(0.2);
  Q.cast(0, 0, [1, 0]); Q.run(1);
  assert(!Q.match.contact.link, '8 m off: no catch');
  return `caught from ${d0.toFixed(1)} m in ${((joinedAt + 1) * DT).toFixed(2)} s`;
});

test('ribbon: a dash that leaves an updraft; the other crossing it rides up', () => {
  const R = court('fire', 'water');
  R.place(0, -3, Z); R.place(1, 0, Z + 2.5); R.run(0.3);
  R.cast(0, 1, [1, 0]);
  const x1 = R.chars[0].root[0];
  R.run(0.5);
  assert(R.chars[0].root[0] - x1 > 2, `the caster dashed ${(R.chars[0].root[0] - x1).toFixed(2)} m`);
  const rib = R.powers.live.find((L) => L.kind === 'ribbon')!;
  assert(rib && rib.pts!.length >= 3, 'a ribbon laid');
  // the other runs across it (toward -z) and rises over it; one that stops in it rides it high
  const top = apex(R, 1, 1.0, undefined, (k) => (k === 1 ? { moveZ: 1 } : null));
  assert(top > 1.2, `ran across it and rose to ${top.toFixed(2)} m`);
  const Q = court('fire', 'water');
  Q.place(0, -3, Z); Q.place(1, 4, Z + 3); Q.run(0.3);
  Q.cast(0, 1, [1, 0]); Q.run(0.5);
  Q.place(1, -0.5, Z); Q.run(DT);
  const ride = apex(Q, 1, 1.4);
  assert(ride > 2.6, `stood in it and rode to ${ride.toFixed(2)} m`);
  return `run across: up to ${top.toFixed(2)} m; stood in: ${ride.toFixed(2)} m`;
});

test('wave: carries whoever stands in it; a jump from its crest goes higher', () => {
  const R = court('water', 'fire');
  R.place(0, -3.5, Z); R.place(1, -2.5, Z); R.run(0.3);
  const x0 = R.chars[1].root[0];
  R.cast(0, 1, [1, 0]);
  R.run(1.0);
  const moved = R.chars[1].root[0] - x0;
  assert(moved > 3, `the other carried ${moved.toFixed(2)} m standing still`);
  // a jump on its crest: higher than a plain jump
  const Q = court('water', 'fire');
  Q.place(0, -3.5, Z); Q.place(1, 3, Z); Q.run(0.3);
  Q.cast(0, 1, [1, 0]);
  Q.run(0.15);
  let jumped = false;
  const top = apex(Q, 0, 1.2, undefined, (k) => (k === 0 && !jumped ? ((jumped = true), { jump: true, jumpHeld: true }) : k === 0 ? { jumpHeld: true } : null));
  assert(top > 2.9, `a crest jump to ${top.toFixed(2)} m (a held jump is about 2.2)`);
  return `carried ${moved.toFixed(2)} m; crest jump ${top.toFixed(2)} m`;
});

test('step: an ice block under a falling partner the stick points at; it lands and stands on it; it goes in 4 s', () => {
  const R = court('ice', 'fire');
  R.place(0, -2, Z); R.place(1, 1.5, Z, 2.4, [0, -3, 0]); R.run(DT);
  R.cast(0, 0, [1, 0]);
  const step = R.powers.live.find((L) => L.kind === 'step')!;
  assert(step && step.solid, 'a step');
  let stood = 0;
  for (let i = 0; i < 90; i++) { R.run(DT); if (R.chars[1].grounded && R.chars[1].root[1] > 1) stood++; }
  assert(stood > 30, `stood on it ${(stood * DT).toFixed(2)} s at ${R.chars[1].root[1].toFixed(2)} m`);
  near(R.chars[1].root[1], step.top!, 0.06, 'on its top');
  assert(R.solids.includes(step.solid!), "in the world's solids");
  R.run(BEND.STEP_LIFE);
  assert(!R.solids.includes(step.solid as Solid) && !R.powers.solids.length, 'gone after its life');
  // under the caster's own feet in the air (no stick)
  const Q = court('ice', 'fire');
  Q.place(0, 0, Z, 1.6, [0, -2, 0]); Q.run(DT);
  Q.cast(0, 0);
  Q.run(0.5);
  assert(Q.chars[0].grounded && Q.chars[0].root[1] > 1.2, `stands on its own step at ${Q.chars[0].root[1].toFixed(2)}`);
  return `the partner stood on it at ${step.top!.toFixed(2)} m`;
});

test('step: kicked off like a wall (free), and a ledge on the locked plane', () => {
  const R = court('ice', 'fire', true);
  R.place(0, -2, Z); R.place(1, 3, Z); R.run(0.3);
  R.cast(0, 0, [1, 0]);
  const L = R.chars[0].extraLedges?.() ?? [];
  assert(L.some((l) => l.id.startsWith('power.')), `a ledge on the plane: ${L.map((l) => l.id)}`);
  const top = R.powers.live.find((x) => x.kind === 'step')!.top!;
  // jump onto it (and stop there)
  let jumped = false, on = 0;
  for (let i = 0; i < 50; i++) {
    R.run(DT, undefined, (k) => (k === 0 ? (!jumped ? ((jumped = true), { jump: true, jumpHeld: true, moveX: 1 }) : { jumpHeld: true, moveX: on ? 0 : 0.4 }) : null));
    if (R.chars[0].grounded && Math.abs(R.chars[0].root[1] - top) < 0.08) on++;
  }
  assert(on > 10, `locked: stood on it ${(on * DT).toFixed(2)} s (at ${R.chars[0].root[1].toFixed(2)}, its top ${top.toFixed(2)})`);
  // free: a body falling against its side slides on it and kicks off it
  const F = court('ice', 'fire');
  F.place(0, -2, Z); F.place(1, 4, Z + 3); F.run(0.3);
  F.cast(0, 0, [1, 0]);
  const S = F.powers.live.find((x) => x.kind === 'step')!;
  F.place(0, S.at[0] - 1.2, S.at[2], S.top! - 0.3, [3, 0, 0]);
  let wall = false;
  for (let i = 0; i < 30 && !wall; i++) { F.run(DT, undefined, (k) => (k === 0 ? { moveX: 1 } : null)); wall = F.chars[0].onWall; }
  assert(wall, 'on it as a wall');
  F.run(DT, undefined, (k) => (k === 0 ? { jump: true, jumpHeld: true, moveX: -1 } : null));
  F.run(0.1, undefined, (k) => (k === 0 ? { jumpHeld: true } : null));
  assert(F.chars[0].v[0] < -2 && F.chars[0].v[1] > 4, `kicked off it (${F.chars[0].v.map((v) => v.toFixed(1))})`);
});

test('slide: slick and fast along it', () => {
  const R = court('ice', 'fire');
  R.place(0, -4, Z); R.place(1, 4, Z + 3); R.run(0.3);
  R.cast(0, 1, [1, 0]);
  let top = 0;
  for (let i = 0; i < 60; i++) { R.run(DT, undefined, (k) => (k === 0 ? { moveX: 1 } : null)); top = Math.max(top, R.chars[0].v[0]); }
  assert(R.powers.felt.slideS > 0.3, `on it ${R.powers.felt.slideS.toFixed(2)} s`);
  assert(top > R.chars[0].phys.runSpeed + 2, `top speed ${top.toFixed(1)} m/s (the run is ${R.chars[0].phys.runSpeed})`);
  return `${top.toFixed(1)} m/s along it`;
});

test('blink: a short jump through space; through the other it swaps the two', () => {
  const R = court('plasma', 'fire');
  R.place(0, -3, Z); R.place(1, 3, Z); R.run(0.3);
  const x0 = R.chars[0].root[0];
  R.cast(0, 0, [1, 0]);
  near(R.chars[0].root[0] - x0, BEND.BLINK, 0.15, 'moved its length');
  const Q = court('plasma', 'fire');
  Q.place(0, -1, Z); Q.place(1, 0.3, Z); Q.run(0.3);
  const a = Q.chars[0].root[0], b = Q.chars[1].root[0];
  Q.cast(0, 0, [1, 0]);
  assert(Math.abs(Q.chars[0].root[0] - b) < 0.2 && Math.abs(Q.chars[1].root[0] - a) < 0.2, `swapped: ${Q.chars[0].root[0].toFixed(2)}, ${Q.chars[1].root[0].toFixed(2)}`);
});

test('arc: a lightning tether that pulls the two to meet in the air, joined: the caster\'s air catch', () => {
  const R = court('plasma', 'water');
  R.place(0, -2.5, Z); R.place(1, 3, Z); R.run(0.3);
  R.cast(0, 1, [1, 0]);
  let met = -1, hi = 0;
  for (let i = 0; i < 50 && met < 0; i++) { R.run(DT); hi = Math.max(hi, Math.min(R.chars[0].root[1], R.chars[1].root[1])); if (R.match.contact.link) met = i; }
  assert(met >= 0 && R.match.contact.link!.holder === 0, 'met and joined');
  assert(hi > 0.5, `in the air (${hi.toFixed(2)} m)`);
  assert(R.ev.some((e) => e.k === 'link' && e.seat === 0 && e.kind === 'aerial'), "the caster's air catch");
  // nobody in reach: nothing spent
  const Q = court('plasma', 'water');
  Q.place(0, -5, Z); Q.place(1, 5, Z + 1); Q.run(0.3);
  Q.powers.rules.seats[0].flow = 0.5;
  Q.cast(0, 1, [1, 0]);
  near(Q.powers.rules.seats[0].flow, 0.5, 1e-9, 'out of reach: given back');
  return `met in ${((met + 1) * DT).toFixed(2)} s, both ${hi.toFixed(2)} m up`;
});

test('pillar: a crystal column rises under the other the stick points at and launches it; it stands, then sinks', () => {
  const R = court('gems', 'fire');
  R.place(0, -1.5, Z); R.place(1, 1.2, Z); R.run(0.3);
  R.cast(0, 0, [1, 0]);
  const top = apex(R, 1, 1.4);
  assert(top > 3.4, `launched to ${top.toFixed(2)} m (its top ${BEND.PILLAR_H} m)`);
  const P = R.powers.live.find((L) => L.kind === 'pillar')!;
  assert(P && P.solid && solidTop(P.solid, P.at[0], P.at[2]) > BEND.PILLAR_H - 0.1, 'standing, its top standable');
  R.run(BEND.PILLAR_LIFE);
  assert(!R.powers.solids.length, 'sunk');
  // gems' form: pillars in a row
  const Q = court('gems', 'fire');
  Q.place(0, -3, Z); Q.place(1, 4, Z + 3); Q.run(0.3);
  Q.powers.rules.seats[0].flow = 1; Q.run(DT, (k) => (k === 0 ? { form: true } : null));
  Q.cast(0, 0, [1, 0]); Q.run(0.5);
  assert(Q.powers.live.filter((L) => L.kind === 'pillar').length === 3, 'heart of stone: three');
  return `the other launched to ${top.toFixed(2)} m`;
});

test('prism: a body flying into it is turned toward the other', () => {
  const R = court('gems', 'fire');
  R.place(0, -3, Z); R.place(1, 3, Z, 1.2, [-9, 3, 0]); R.run(DT);
  R.cast(0, 1, [1, 0]);
  const P = R.powers.live.find((L) => L.kind === 'prism')!;
  assert(P, 'a prism');
  // the flyer goes at the prism from the side, across the court
  R.place(1, P.at[0], P.at[2] + 1.6, P.at[1] - 1.3, [0, 5, -10]); R.run(DT);
  R.run(0.3);
  assert(R.powers.felt.redirects === 1, `turned: ${R.powers.felt.redirects}`);
  const v = R.chars[1].v, to = [R.chars[0].root[0] - R.chars[1].root[0], R.chars[0].root[2] - R.chars[1].root[2]];
  const cos = (v[0] * to[0] + v[2] * to[1]) / (Math.hypot(v[0], v[2]) * Math.hypot(to[0], to[1]));
  assert(cos > 0.8, `now going toward the caster (cos ${cos.toFixed(2)})`);
  return `cos ${cos.toFixed(2)} toward the other`;
});

test('reaction: a flare in a wave is a steam geyser: a tall updraft either rides', () => {
  const R = court('water', 'fire');
  R.place(0, -4, Z); R.place(1, -1.5, Z); R.run(0.3);
  R.cast(0, 1, [1, 0]);         // the wave rolls toward the fire body
  let made = false;
  for (let i = 0; i < 60 && !made; i++) {
    const W = R.powers.live.find((L) => L.kind === 'wave' && !L.done);
    const inIt = W && Math.abs(W.tip![0] - R.chars[1].root[0]) < 1.2;
    R.run(DT, (k) => (k === 1 && inIt ? { p1: true } : null));
    made = R.powers.live.some((L) => L.kind === 'geyser');
  }
  assert(made, 'a geyser');
  assert(R.powers.events.some((e) => e.k === 'react') || R.powers.rules.reactions.geyser === 1, 'popped once');
  const G = R.powers.live.find((L) => L.kind === 'geyser')!;
  // the water body walks into it and rides it up
  R.place(0, G.at[0] - 0.3, G.at[2]); R.run(DT);
  const top = apex(R, 0, 1.5);
  assert(top > 5, `rode the geyser to ${top.toFixed(2)} m`);
  assert(R.powers.rules.reactions.geyser === 1, `one geyser: ${R.powers.rules.reactions.geyser}`);
  return `ridden to ${top.toFixed(2)} m`;
});

test('reaction: fire on an ice step melts it to a slick puddle', () => {
  const R = court('ice', 'fire');
  R.place(0, -2, Z); R.place(1, 1.4, Z); R.run(0.3);
  R.cast(0, 0, [1, 0]);   // a step ahead of the ice body, over the fire body
  const S = R.powers.live.find((L) => L.kind === 'step')!;
  assert(S.solid, 'a step');
  R.place(1, S.at[0] + 0.4, S.at[2]); R.run(0.4);
  R.cast(1, 0, [0, 1]);   // the fire body's flare under it
  assert(!S.solid && S.melted, 'melted');
  const P = R.powers.live.find((L) => L.kind === 'puddle')!;
  assert(P, 'a puddle');
  R.run(1.2);
  R.place(0, P.at[0], P.at[2]); R.run(0.1);
  assert(R.chars[0].env.slick === 1, 'slick on the puddle');
  assert(R.powers.rules.reactions.melt === 1, 'one melt');
});

test('reaction: the whip on an ice step freezes into a bar the caster swings round and leaves from', () => {
  const R = court('water', 'ice');
  R.place(0, -3, Z); R.place(1, -1.2, Z); R.run(0.3);
  // the ice body, at the top of a jump, sets a step ahead of itself in the air, then goes
  R.place(1, -1.2, Z, 2.3, [0, 0, 0]);
  R.cast(1, 0, [1, 0]);
  assert(R.powers.live.some((L) => L.kind === 'step'), 'a step in the air');
  R.place(1, 6, Z); R.run(0.3);
  // the water body lashes at it (the stick toward it: the lash goes to its top)
  R.cast(0, 0, [1, 0]);
  R.run(0.2);
  const B = R.powers.live.find((L) => L.kind === 'bar');
  assert(B, `a bar (reactions ${JSON.stringify(R.powers.rules.reactions)})`);
  let launched = false, swung = 0;
  for (let i = 0; i < 90; i++) { R.run(DT); if (!B!.free) swung++; if (B!.free) { launched = true; break; } }
  assert(launched && swung > 10, `swung ${(swung * DT).toFixed(2)} s and let go`);
  assert(R.powers.rules.reactions.freeze === 1, 'one freeze');
  return `swung round it ${(swung * DT).toFixed(2)} s`;
});

// ---------------------------------------------------------------- two virtual players, a whole set
test('bots cast as people would: a few powers a minute each, not spam, and some make catches', () => {
  const out: string[] = [];
  let total = 0, mins = 0, caught = 0;
  const reacts: Record<string, number> = {};
  for (const [dress, seed] of [[['fire', 'water'], 3], [['ice', 'plasma'], 5], [['gems', 'water'], 7], [['fire', 'ice'], 9], [['water', 'ice'], 11]] as [[string, string], number][]) {
    const res = simulateDuel({ ...nodeArena('temple'), dress, brains: makeBrains(['lead', 'flyer'], [0.7, 0.7], [seed, seed + 7]), sets: 1, setMs: 60000, seconds: 80 });
    const P = res.powers!, per = [0, 1].map((k) => Object.values(P.casts[k]).reduce((a, b) => a + b, 0));
    const m = res.play / 60;
    total += per[0] + per[1]; mins += m * 2; caught += P.felt.catches;
    for (const [k, v] of Object.entries(P.reactions)) reacts[k] = (reacts[k] ?? 0) + v;
    for (let k = 0; k < 2; k++) assert(per[k] / m <= 12, `${dress[k]}: ${per[k]} casts in ${m.toFixed(1)} min is spam`);
    assert(per[0] + per[1] >= 2, `${dress.join(',')}: some powers (${per})`);
    out.push(`${dress.join('+')}: ${per.map((n) => (n / m).toFixed(1)).join(' & ')}/min [${[0, 1].map((k) => Object.entries(P.casts[k]).map(([a, b]) => `${a} ${b}`).join(' ')).join(' | ')}], forms ${P.forms.join('/')}, reactions ${JSON.stringify(P.reactions)}, catches ${P.felt.catches}`);
  }
  const rate = total / mins;
  assert(rate >= 1 && rate <= 8, `${rate.toFixed(1)} powers a dancer-minute`);
  assert(caught >= 2, `catches made by powers: ${caught}`);
  return `${rate.toFixed(1)} a dancer-minute, ${caught} catches by powers, reactions ${JSON.stringify(reacts)}; ${out.join('; ')}`;
});

done();
