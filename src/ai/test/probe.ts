// A probe of the brains in simulated play (not a test: it prints what it measures, for tuning and the report). Run:
//   node scripts/steps/brains-sim.mjs [two|attacker|still|pattern|free] [seconds] [presetA] [presetB] [seed]
import { layoutShelves } from '../../worlds/geode/shelves';
import { stagePlane } from '../../worlds/stage';
import { PartnerBrain, type PresetName } from '../partner';
import { simulate } from '../sim';
import type { Brain } from '../brain';
import { reachOf } from '../read';
import { ATTACKS } from '../body';
import { MOVES } from '../../dancer/moves';
import { AttackerBrain, PatternBrain, PresserBrain, StillBrain, summary } from './scripted';
import { measure, line } from './measure';

declare const process: { argv: string[] };
const [mode = 'two', secs = '180', pa = 'playful', pb = 'playful', seed = '11'] = process.argv.slice(2).filter((x) => !x.startsWith('-'));
const plane = stagePlane({ id: 'centre', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: layoutShelves({ caveRadius: 8.5 }).ledges, spawns: [[-2.45, 0], [2.45, 0]] });
const human: Brain = mode === 'attacker' ? new AttackerBrain() : mode === 'still' ? new StillBrain() : mode === 'pattern' ? new PatternBrain('spin') : new PartnerBrain({ preset: pa as PresetName, seed: Number(seed) });
if (mode === 'reach') {
  for (const n of ATTACKS) { const r = reachOf(n); console.log(n.padEnd(9), 'touch', r.touch?.map((x) => x.toFixed(2)).join('-'), 'near to', r.near.toFixed(2), 'windup', MOVES[n].windup.toFixed(2), 'active', MOVES[n].active!.map((u) => (u * MOVES[n].dur).toFixed(2)).join('-')); }
  throw 0;
}
if (mode === 'diary') {
  // two partners, printing every second: where they stand, the pair's angle, what each decided
  const A = new PartnerBrain({ seed: Number(seed) }), B = new PartnerBrain({ seed: Number(seed) * 3 + 1 });
  const free = process.argv.includes('-f');
  let shown = [0, 0];
  simulate({ plane: free ? null : plane, stage: plane, seats: [process.argv.includes('-s') ? new StillBrain() : process.argv.includes('-p') ? new PresserBrain() : A, B], seconds: Number(secs), each: (f) => {
    if (Math.abs(f.t % 1) > 1 / 120) return;
    const [a, b] = f.bodies;
    console.log(`${f.t.toFixed(0).padStart(3)}s b${f.beat.toFixed(1)} ${f.ref.session.phase} T${f.ref.session.tension.toFixed(0)} d ${Math.hypot(a.x - b.x, a.z - b.z).toFixed(2)} ang ${(Math.atan2(b.z - a.z, b.x - a.x) * 57.3).toFixed(0)} A(${a.x.toFixed(1)},${a.z.toFixed(1)}) ${a.move?.name ?? ''} B(${b.x.toFixed(1)},${b.z.toFixed(1)}) ${b.move?.name ?? ''}`);
    [A, B].forEach((br, k) => { for (const l of br.diary.slice(shown[k] >= br.diary.length ? br.diary.length : 0)) if (!l.startsWith('#')) console.log(`      ${k ? 'B' : 'A'}: ${l}`); });
    shown = [A.diary.length, B.diary.length];
    A.diary.length = 0; B.diary.length = 0; shown = [0, 0];
  } });
  throw 0;
}
if (mode === 'why') {
  // every exchange, with the reason the attacker had for the attack (offer, counter, echo …) and what the attacked was doing
  const br = [new PartnerBrain({ seed: Number(seed) }), new PartnerBrain({ seed: Number(seed) * 3 + 1 })];
  const tally: Record<string, Record<string, number>> = {};
  const logs: string[][] = [[], []];
  br.forEach((b, k) => { b.reader.log = (x) => { logs[k].push(x); if (logs[k].length > 4) logs[k].shift(); }; });
  simulate({ plane: process.argv.includes('-f') ? null : plane, stage: plane, seats: [process.argv.includes('-s') ? new StillBrain() : br[0], br[1]], seconds: Number(secs), each: (f) => {
    if (f.ref.onXch) return;
    f.ref.onXch = (target, res) => {
      const by = 1 - target, mv = br[by].mind.mine[br[by].mind.mine.length - 1], d = f.bodies[target];
      const why = (mv?.why ?? '?').replace(/ \(.*\)/, '');
      (tally[why] ??= {})[res] = (tally[why][res] ?? 0) + 1;
      if (res === 'hit') console.log(`${mv?.name} (${mv?.why}) hit seat ${target} in ${d.move?.name ?? 'ginga'} ${d.move ? (d.move.t / d.move.dur).toFixed(2) : ''}\n    ${logs[target].join('\n    ')}`);
    };
  } });
  console.log(JSON.stringify(tally));
  throw 0;
}
if (mode === 'measure') {
  // the report's numbers: three seeded three-minute sessions locked on the geode's stage and three free on the floor
  for (const free of [false, true]) for (const sd of [11, 12, 13]) {
    const s = measure({ plane: free ? null : plane, stage: plane, seats: [new PartnerBrain({ preset: pa as PresetName, seed: sd }), new PartnerBrain({ preset: pb as PresetName, seed: sd * 3 + 1 })], seconds: Number(secs) });
    console.log(`${free ? 'free  ' : 'locked'} seed ${sd}: ${line(s)}`);
  }
  for (const [nm, h] of [['attacker', new AttackerBrain()], ['still', new StillBrain()], ['presser', new PresserBrain()]] as const) {
    const s = measure({ plane: null, stage: plane, seats: [h, new PartnerBrain({ seed: 31 })], seconds: 120 });
    console.log(`free vs ${nm}: ${line(s)}`);
  }
  throw 0;
}
const t0 = Date.now();
const B = new PartnerBrain({ preset: pb as PresetName, seed: Number(seed) * 3 + 1 });
if (process.argv.includes('-a')) { B.reader.log = (m) => console.log('B ' + m); if (human instanceof PartnerBrain) human.reader.log = (m) => console.log('A ' + m); }
const verbose = process.argv.includes('-v');
let last = -1, lastPhase = '';
const r = simulate({ plane: mode === 'free' ? null : plane, stage: plane, seats: [human, B], seconds: Number(secs),
  each: (f) => {
    const S = f.ref.session;
    if (!f.ref.onAttack && process.argv.includes('-a')) f.ref.onAttack = (sa, id, res, d) => console.log(`  ATTACK by ${sa} ${id} ${f.ref.session.lastTick / 1000} -> ${res} at d ${d.toFixed(2)}`);
    for (const e of f.ref.events) if ((verbose || process.argv.includes('-a')) && e.k !== 'mergeReady') console.log(`  ${f.t.toFixed(2)} ev ${e.k} ${'move' in e ? (e as any).move : ''}`);
    if (S.phase !== lastPhase) { lastPhase = S.phase; if (verbose) console.log(`${f.t.toFixed(1)} phase ${S.phase}`); }
    const tr = process.argv.find((x) => x.startsWith('-t='))?.slice(3).split('-').map(Number);
    if (tr && f.t >= tr[0] && f.t <= tr[1]) console.log(`    ${f.t.toFixed(3)} b${f.beat.toFixed(3)} A ${f.bodies[0].move?.name ?? '-'} ${(f.bodies[0].move ? f.bodies[0].move.t : 0).toFixed(2)} s${f.bodies[0].s.toFixed(2)} ${f.bodies[0].flags} | B ${f.bodies[1].move?.name ?? '-'} ${(f.bodies[1].move ? f.bodies[1].move.t : 0).toFixed(2)} s${f.bodies[1].s.toFixed(2)} ${f.bodies[1].flags} blk ${f.bodies[1].blocking} it ${JSON.stringify(f.intents[1] ? { d: f.intents[1].dodge, dh: f.intents[1].dodgeHeld, mx: +f.intents[1].moveX.toFixed(2), my: f.intents[1].moveY } : null)}`);
    if (process.argv.includes('-m') && Math.abs(f.t % 2) < 1 / 120) { for (const [k, br] of [['A', human], ['B', B]] as const) if (br instanceof PartnerBrain) console.log(`   ${k} ${f.t.toFixed(1)} presses ${br.mind.presses.map((p) => p.move + '@' + p.line.toFixed(1) + '/' + p.why).join(' ')} intend ${JSON.stringify((br as any).intend)} myOffer ${(br as any).myOffer.toFixed(1)} theirs ${(br as any).theirAttack.toFixed(1)} beat ${f.beat.toFixed(1)} resp ${br.responsive.toFixed(2)}`); }
    const sec = Math.floor(f.t / 5);
    if (verbose && sec !== last) { last = sec; console.log(`${f.t.toFixed(0)}s ${S.phase} tension ${S.tension.toFixed(0)} moves ${f.ref.stats.moves.join('/')} d ${Math.abs(f.bodies[0].x - f.bodies[1].x).toFixed(2)} s ${f.bodies[0].s.toFixed(1)},${f.bodies[1].s.toFixed(1)}`); }
  } });
console.log(summary(r.stats), `\n(${((Date.now() - t0) / 1000).toFixed(1)} s to simulate ${secs} s)`);
