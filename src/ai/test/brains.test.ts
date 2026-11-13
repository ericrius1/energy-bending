// The brains in simulated play (npm test): real Characters, the move library and shared/rules.ts through the
// referee (jogo.ts), at 60 fps on a virtual music clock, on the geode's own stage plane. What they must do:
//   two partners for three minutes, locked and free, fuse more than once, dodge and clash well above being hit, take
//   their tension mainly from exchanges, keep to the 8ths, use at least eight moves each, invert and play low, circle
//   (free) or change sides (locked), never leave the stage or the world, never stall;
//   a "human" that only attacks is answered with dodges; one that stands still is invited, not beaten; a repeated
//   pattern is joined in unison; a director's cues are honoured loosely; reactions are spread like a person's; the
//   teacher's drill climbs with a student who answers and not with one who doesn't; free dancers wander, dance and keep
//   off the stage plane, a roda forms round the jogo, claps together on the beat and one can buy the game; the moves
//   requested from the library are danced once they exist.
import { readFileSync } from 'node:fs';
import type { Motion } from '../../skeleton/clips';
import { Character } from '../../dancer/character';
import { MOVES } from '../../dancer/moves';
import { layoutShelves } from '../../worlds/geode/shelves';
import { stagePlane } from '../../worlds/stage';
import { test, assert, done } from '../../dancer/test/check';
import { PartnerBrain } from '../partner';
import { NpcBrain, rodaOf, rodaSpot } from '../npc';
import { TeacherBrain, StudentBrain } from '../teacher';
import { ClipLibrary, CLIPS } from '../clips';
import { inStrip } from '../behaviours';
import { pressMove, blank } from '../body';
import { simulate } from '../sim';
import { measure, line } from './measure';
import { Rng } from '../brain';
import { registerMove } from '../../dancer/moves';
import { AttackerBrain, PatternBrain, StillBrain } from './scripted';

const load = (name: string): Motion => {
  const meta = JSON.parse(readFileSync(`public/motion/${name}.json`, 'utf8'));
  const bin = readFileSync(`public/motion/${name}.bin`);
  return { ...meta, bin: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) };
};
const plane = stagePlane({ id: 'centre', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: layoutShelves({ caveRadius: 8.5 }).ledges, spawns: [[-2.45, 0], [2.45, 0]] });
const n = (r: Record<string, number>, k: string) => r[k] ?? 0;

// The jogo two partners play, three seeded three-minute sessions on the geode's locked stage and three free on the
// floor: it fuses, the answers beat the hits, the tension comes mainly from exchanges (echoes are seasoning), it keeps
// the 8ths, it is varied, it inverts and uses three levels, free it circles (at least half a turn in every 30 s of
// play), locked it changes sides, it never stalls and nobody leaves the stage or the world
for (const free of [false, true]) test(`two partners, three minutes ${free ? 'free on the floor' : 'locked on the stage'}: the jogo by the numbers`, () => {
  const lines: string[] = [];
  for (const seed of [11, 12, 13]) {
    const r = measure({ plane: free ? null : plane, stage: plane, seats: [new PartnerBrain({ seed }), new PartnerBrain({ seed: seed * 3 + 1 })], seconds: 180 });
    const x = r.xch, good = x.dodge + x.clash + x.parry, levels = r.levels, all = levels.standing + levels.low + levels.inverted;
    lines.push(`seed ${seed}: ${line(r)}`);
    assert(r.fusions >= 2, `seed ${seed}: fusions ${r.fusions}`);
    assert(good >= 2.5 * x.hit && good > 6, `seed ${seed}: dodges+clashes+parries ${good} vs hits ${x.hit}`);
    assert(r.tension.xchShare >= 0.4, `seed ${seed}: tension from exchanges only ${(r.tension.xchShare * 100).toFixed(0)}%`);
    assert(r.onBeat >= 0.8, `seed ${seed}: on the beat ${r.onBeat}`);
    assert(r.distinctEach[0] >= 8 && r.distinctEach[1] >= 8, `seed ${seed}: distinct ${r.distinctEach}`);
    assert(r.inversionsPerMin >= 6, `seed ${seed}: inversions ${r.inversionsPerMin.toFixed(1)}/min`);
    assert(levels.low >= all * 0.15 && levels.inverted >= all * 0.12, `seed ${seed}: levels ${JSON.stringify(levels)}`);
    if (free) assert(r.turned!.min30 >= Math.PI, `seed ${seed}: circled only ${(r.turned!.min30 * 57.3).toFixed(0)}° in some 30 s`);
    else assert(r.sides >= 6, `seed ${seed}: changed sides ${r.sides} times`);
    assert(r.offStage === 0 && r.outOfWorld === 0, `seed ${seed}: off the stage ${r.offStage}, out of the world ${r.outOfWorld} frames`);
    assert(r.stall < 8, `seed ${seed}: stalled ${r.stall.toFixed(1)} s`);
  }
  return '\n      ' + lines.join('\n      ');
});

test('the same seeds play the same jogo', () => {
  const a = simulate({ plane, seats: [new PartnerBrain({ seed: 5 }), new PartnerBrain({ seed: 6 })], seconds: 40 });
  const b = simulate({ plane, seats: [new PartnerBrain({ seed: 5 }), new PartnerBrain({ seed: 6 })], seconds: 40 });
  assert(JSON.stringify(a.stats.names) === JSON.stringify(b.stats.names) && a.bodies[0].x === b.bodies[0].x, 'runs differ');
  return `${a.stats.moves[0] + a.stats.moves[1]} moves, identical`;
});

test('the presets each play a jogo that fuses', () => {
  const out: string[] = [];
  for (const p of ['calm', 'fierce', 'mirror'] as const) {
    const S = simulate({ plane, seats: [new PartnerBrain({ preset: p, seed: 3 }), new PartnerBrain({ preset: p, seed: 4 })], seconds: 120 }).stats;
    const x = (k: string) => n(S.xch[0], k) + n(S.xch[1], k);
    out.push(`${p}: fusions ${S.fusions}, dodge ${x('dodge')} clash ${x('clash')} parry ${x('parry')} near ${x('near')} hit ${x('hit')}, echo ${S.echoes} unison ${S.unisons}`);
    assert(S.fusions >= 1, `${p}: no fusion`);
  }
  return '\n      ' + out.join('\n      ');
});

test('free on the floor (no plane) the jogo still works', () => {
  const S = simulate({ plane: null, seats: [new PartnerBrain({ seed: 21 }), new PartnerBrain({ seed: 22 })], seconds: 120 }).stats;
  const x = (k: string) => n(S.xch[0], k) + n(S.xch[1], k);
  assert(S.fusions >= 1, 'no fusion free');
  return `fusions ${S.fusions}, dodge ${x('dodge')} clash ${x('clash')} near ${x('near')} hit ${x('hit')}`;
});

test('a "human" that only attacks is answered with dodges', () => {
  const S = simulate({ plane, seats: [new AttackerBrain(), new PartnerBrain({ seed: 31 })], seconds: 120 }).stats;
  const on = S.xch[1], good = n(on, 'dodge') + n(on, 'parry') + n(on, 'clash');
  assert(n(on, 'dodge') > n(on, 'hit') && good >= 2 * n(on, 'hit'), JSON.stringify(on));
  return `${S.moves[0]} attacks: ${JSON.stringify(on)}`;
});

test('a "human" that stands still is invited, not beaten', () => {
  const S = simulate({ plane, seats: [new StillBrain(), new PartnerBrain({ seed: 41 })], seconds: 180 }).stats;
  const on = S.xch[0], attacks = Object.entries(S.names[1]).filter(([k]) => MOVES[k]?.attack).reduce((a, [, v]) => a + v, 0);
  assert(n(on, 'hit') <= 1, `hit ${n(on, 'hit')} times`);
  assert(attacks >= 6 && S.moves[1] >= 20, `only ${attacks} offers, ${S.moves[1]} moves`);
  return `${S.moves[1]} moves, ${attacks} of them offers: ${JSON.stringify(on)} (nothing else came of them)`;
});

test('a pattern the other repeats is joined in unison', () => {
  const S = simulate({ plane, seats: [new PatternBrain('spin'), new PartnerBrain({ seed: 51 })], seconds: 60 }).stats;
  assert(S.unisons >= 2, `unisons ${S.unisons}`);
  return `unisons ${S.unisons}, echoes ${S.echoes}`;
});

test('every move a brain asks for is the move the body starts', () => {
  const names = ['meia-lua', 'armada', 'martelo', 'bencao', 'rasteira', 'strike', 'throw', 'au', 'macaco', 'role', 'esquiva', 'block', 'spin'];
  for (const free of [false, true]) for (const name of names) {
    const c = new Character({ seat: 0, plane: free ? null : plane });
    c.lookAt = free ? [0, 0, 3] : [3, 0, 0];
    for (let i = 0; i < 30; i++) c.update(1 / 60, null, i / 30);
    const it = blank();
    pressMove(c, name, free ? [0, 1] : [1, 0], it);
    c.update(1 / 60, it, 1);
    assert(c.move?.name === name, `${free ? 'free' : 'locked'}: asked ${name}, got ${c.move?.name}`);
  }
  return `${names.length} moves, locked and free`;
});

const motion = load('motion'), travel = load('travel');
const clips = new ClipLibrary(motion, travel);

test('the clip table: every stretch bakes, grooves loop on the spot, flourishes are moves', () => {
  for (const d of CLIPS) {
    if (d.role === 'groove') {
      const g = clips.grooves.get(d.name)!;
      assert(g, d.name);
      const p = new Float32Array(39);
      let drift = 0;
      for (let b = 0; b < 32; b += 0.25) { g.sample(b, 112, p); drift = Math.max(drift, Math.hypot((p[21] + p[24]) / 2, (p[23] + p[26]) / 2)); }
      assert(drift < 0.6, `${d.name}: hips wander ${drift.toFixed(2)} m from the spot`);
    } else assert(MOVES[d.name]?.sampled, `${d.name} is not a sampled move`);
  }
  return `${clips.grooves.size} grooves, ${clips.flourishes.length} flourishes (${clips.flourishes.join(', ')})`;
});

test('free dancers wander, dance and keep off the stage plane; a roda rings the jogo', () => {
  let inside = 0, far = 0, danced = 0, frames = 0, crowd = 0, where = "", farAt = "";
  const trail: string[] = [];
  const walked = [0, 0, 0, 0, 0], at: number[][] = [];
  const npcs = [
    { brain: new NpcBrain({ seed: 1, clips, name: 'a' }), at: [-2, 4] as [number, number] },
    { brain: new NpcBrain({ seed: 2, clips, name: 'b', params: { energy: 0.9 } }), at: [3, -4] as [number, number] },
    { brain: new NpcBrain({ seed: 3, clips, roda: rodaOf(3)[0] }), at: [-5, 3] as [number, number] },
    { brain: new NpcBrain({ seed: 4, clips, roda: rodaOf(3)[1] }), at: [0, 5] as [number, number] },
    { brain: new NpcBrain({ seed: 5, clips, roda: rodaOf(3)[2] }), at: [5, 3] as [number, number] },
  ];
  const r = simulate({
    plane, seats: [new PartnerBrain({ seed: 61 }), new PartnerBrain({ seed: 62 })], npcs, seconds: 120, room: 7.4,
    each: (f) => {
      frames++;
      f.bodies.slice(2).forEach((c, k) => {
        if (inStrip(plane, c.x, c.z, 1.0)) { inside++; if (!where) where = `npc ${k} at (${c.x.toFixed(2)}, ${c.z.toFixed(2)}) t ${f.t.toFixed(1)} ${(npcs[k].brain as NpcBrain).mode}`; }
        if (Math.hypot(c.x, c.z) > 7.6) { far++; if (!farAt) farAt = `npc ${k} (${(npcs[k].brain as NpcBrain).mode}, ${c.move?.name ?? "-"}) at ${Math.hypot(c.x, c.z).toFixed(2)} m, t ${f.t.toFixed(1)}`; }
        if (at[k]) walked[k] += Math.hypot(c.x - at[k][0], c.z - at[k][1]);
        at[k] = [c.x, c.z];
      });
      if (npcs.some((x) => x.brain.body.clipW > 0.5)) danced++;
      const B = f.bodies.slice(2);
      if (B.some((a, i) => B.some((b, j) => j > i && Math.hypot(a.x - b.x, a.z - b.z) < 0.4))) crowd++;
      if (frames % 300 === 0) trail.push(`${f.bodies[5].x.toFixed(1)},${f.bodies[5].z.toFixed(1)}`);
    },
  });
  const ring = [0, 1, 2].map((k) => { const c = r.bodies[4 + k], p = rodaSpot(plane, rodaOf(3)[k], 0, 7.4); return Math.hypot(c.x - p[0], c.z - p[1]); });
  const moves = r.drivers.slice(2).map((d) => (d!.brain as NpcBrain).mind.mine.length);
  assert(inside === 0, `in the strip for ${inside} frames (first: ${where})`);
  assert(crowd < frames * 0.03, `two free dancers within 0.4 m for ${crowd} frames`);
  assert(far === 0, `outside the room for ${far} frames (first: ${farAt})`);
  assert(walked[0] > 4 && walked[1] > 4, `wandered ${walked.map((w) => w.toFixed(1))}`);
  assert(danced > frames * 0.2, `a groove clip showed ${((danced / frames) * 100).toFixed(0)}% of the time`);
  assert(ring.every((d) => d < 1.6), `the ring: ${ring.map((d) => d.toFixed(2))} m from its places (${trail.join(" ")})`);
  return `two within 0.4 m ${((crowd / frames) * 100).toFixed(1)}% of frames; walked ${walked.map((w) => w.toFixed(0)).join(', ')} m; a clip grooving ${((danced / frames) * 100).toFixed(0)}% of frames; ring places within ${Math.max(...ring).toFixed(2)} m (the jogo's middle moves, so do they); moves ${moves.join(', ')}`;
});

test('the teacher climbs with a student who answers, and waits for one who does not', () => {
  const T = new TeacherBrain({ seed: 2 });
  simulate({ plane, seats: [new StudentBrain({ seed: 3 }), T], seconds: 180 });
  const ok = T.log.filter((x) => x.answered).length;
  assert(T.level >= 2, `level ${T.level} after ${T.log.length} calls`);
  assert(ok >= T.log.length * 0.6, `${ok} of ${T.log.length} answered`);
  const T2 = new TeacherBrain({ seed: 2 });
  simulate({ plane, seats: [new StillBrain(), T2], seconds: 90 });
  assert(T2.level === 0 && T2.log.length >= 4 && T2.log.every((x) => !x.answered && x.call.length === 1), `still student: level ${T2.level}, ${T2.log.length} calls`);
  return `with a student: ${T.log.length} calls, ${ok} answered, level ${T.level} (${T.log.slice(-3).map((x) => x.call.join('+')).join(' / ')}); with nobody answering: ${T2.log.length} calls, level ${T2.level}`;
});

test('the first lesson: a meia-lua and the esquiva, each answered twice, then done', () => {
  const T = new TeacherBrain({ seed: 2, lesson: 'first' });
  simulate({ plane, seats: [new StudentBrain({ seed: 3 }), T], seconds: 90 });
  const answered = T.log.filter((x) => x.answered).map((x) => x.call.join('+'));
  assert(T.done, `not done after 90 s: ${T.log.length} calls, answered ${answered.join(', ')}`);
  assert(T.log.every((x) => x.call.length === 1 && ['meia-lua', 'esquiva'].includes(x.call[0])), `called ${T.log.map((x) => x.call.join('+')).join(', ')}`);
  assert(answered.join(',') === 'meia-lua,meia-lua,esquiva,esquiva', `answered ${answered.join(', ')}`);
  const T2 = new TeacherBrain({ seed: 2, lesson: 'first' });
  simulate({ plane, seats: [new StillBrain(), T2], seconds: 40 });
  assert(!T2.done && T2.log.every((x) => !x.answered && x.call[0] === 'meia-lua'), `still student: done ${T2.done}, ${T2.log.map((x) => x.call[0]).join(', ')}`);
  return `with a student: ${T.log.length} calls (${T.log.map((x) => `${x.call[0]}${x.answered ? '' : ' (let pass)'}`).join(', ')}), done; nobody answering: ${T2.log.length} calls of the meia-lua`;
});

test('reactions are spread like a person\'s: log-normal about the median, no impossibly quick ones', () => {
  const r = new Rng(5), xs = Array.from({ length: 4000 }, () => r.reaction(0.22)).sort((a, b) => a - b);
  const q = (p: number) => xs[Math.floor(p * (xs.length - 1))];
  assert(Math.abs(q(0.5) - 0.22) < 0.015, `median ${q(0.5).toFixed(3)}`);
  assert(q(0) >= 0.22 * 0.65 - 1e-9 && q(0.9) > 0.22 * 1.25 && q(0.99) > 0.22 * 1.6, `spread ${q(0).toFixed(3)} … ${q(0.9).toFixed(3)} … ${q(0.99).toFixed(3)}`);
  return `10% ${q(0.1).toFixed(3)} s, median ${q(0.5).toFixed(3)} s, 90% ${q(0.9).toFixed(3)} s, 99% ${q(0.99).toFixed(3)} s`;
});

test('a director\'s cues are honoured loosely: circle left, an armada on 3.1, a pause, an aú', () => {
  const A = new PartnerBrain({ seed: 1 }), B = new PartnerBrain({ seed: 2 });
  const origin = 16, dir = { origin, cues: [
    { at: '1.1', bars: 2, circle: 'left' as const },
    { at: '3.1', offer: 'armada' },
    { at: '3.1', bars: 2, answer: 'low' as const },
    { at: '5.1', bars: 1, pause: true },
    { at: '6.1', move: 'au' },
  ] };
  let left = 0, frames = 0;
  simulate({ plane: null, stage: plane, seats: [A, B], seconds: 24, directions: { 'seat.1': dir }, each: (f) => {
    const [a, b] = f.bodies;
    if (f.beat > origin + 1 && f.beat < origin + 8) {
      const dx = a.x - b.x, dz = a.z - b.z, l = Math.hypot(dx, dz) || 1;
      left += (b.v[0] * (dz / l) + b.v[2] * (-dx / l)) * (1 / 60); frames++;
    }
  } });
  const mine = B.mind.mine, armada = mine.find((x) => x.name === 'armada' && x.beat > origin + 6 && x.beat < origin + 12);
  const own = mine.filter((x) => x.beat > origin + 16.5 && x.beat < origin + 19.5 && !x.why.startsWith('answer') && !x.why.startsWith('counter'));
  const au = mine.find((x) => x.name === 'au' && Math.abs(x.beat - (origin + 20)) < 1.5);
  assert(left > 0.25, `stepped ${left.toFixed(2)} m to its left over the two bars`);
  assert(!!armada && Math.abs(armada.beat - (origin + 8)) <= 2, `armada at ${armada?.beat.toFixed(2)} (cue ${origin + 8})`);
  assert(own.length === 0, `moves of its own in the pause: ${own.map((x) => `${x.name}@${x.beat.toFixed(1)} (${x.why})`).join(', ')}`);
  assert(!!au, `no aú near beat ${origin + 20}: ${mine.filter((x) => x.beat > origin + 18).map((x) => `${x.name}@${x.beat.toFixed(1)}`).join(' ')}`);
  return `${left.toFixed(2)} m to its left in two bars; armada on ${armada!.beat.toFixed(2)} (cue ${origin + 8}); nothing of its own in the pause; aú on ${au!.beat.toFixed(2)} (cue ${origin + 20})`;
});

test('the roda claps together on the beat, cheers a dodge, and one of them can buy the game', () => {
  const ring = rodaOf(4), at = [[-5, 3], [-2, 5], [2, 5], [5, 3]] as [number, number][];
  const npcs = ring.map((p, k) => ({ brain: new NpcBrain({ seed: 300 + k, clips, roda: p, params: { energy: 0.5, clap: 0.5 } }), at: at[k] }));
  const meets = new Map<number, number>();
  let off = 0, claps = 0, cheers = 0, bought = false;
  const seen = npcs.map(() => -Infinity);
  simulate({ plane, seats: [new PartnerBrain({ seed: 71 }), new PartnerBrain({ seed: 72 })], npcs, seconds: 75, room: 7.4, each: (f) => {
    npcs.forEach((x, k) => {
      const t = x.brain.body.clapAt;
      if (t !== seen[k]) {
        seen[k] = t; claps++;
        const b = (t * 112) / 60, nb = Math.round(b);
        if (Math.abs(b - nb) > 0.08) off++;
        meets.set(nb, (meets.get(nb) ?? 0) + 1);
      }
    });
    if (Math.abs(f.t - 50) < 1 / 120) npcs[0].brain.buy([f.bodies[1].x, f.bodies[1].z - 1.2]);
    if (npcs[0].brain.bought) bought = true;
  } });
  for (const x of npcs) cheers += x.brain.mind.mine.filter((m) => m.why === 'cheer').length;
  const together = [...meets.values()].filter((v) => v >= 2).length;
  assert(claps >= 60, `only ${claps} claps`);
  assert(off <= claps * 0.05, `${off} of ${claps} claps off the beat`);
  assert(together >= claps * 0.25, `${together} beats with two or more clapping`);
  assert(cheers >= 1, 'nobody cheered');
  assert(bought, 'the buyer never reached the roda');
  return `${claps} claps, ${claps - off} on the beat (±0.08), ${together} beats clapped by two or more; ${cheers} cheers; the buyer walked in`;
});

test('the moves requested from the library are danced once they exist', () => {
  // stand-ins for the requests (src/dancer will make the real ones), registered under the requested names
  const like = (name: string, as: string, extra: Record<string, unknown> = {}) => { if (!MOVES[name]) registerMove({ ...(MOVES[as] as any), ...extra, name }); };
  like('negativa', 'esquiva'); like('cocorinha', 'esquiva'); like('queda-de-rins', 'macaco'); like('compasso', 'armada');
  const used = new Set<string>();
  for (const seed of [81, 82]) {
    const S = simulate({ plane, seats: [new PartnerBrain({ seed }), new PartnerBrain({ seed: seed + 1 })], seconds: 120 }).stats;
    for (const nm of S.names) for (const k of Object.keys(nm)) if (['negativa', 'cocorinha', 'queda-de-rins', 'compasso'].includes(k)) used.add(k);
  }
  assert(used.size >= 3, `used ${[...used].join(', ') || 'none'}`);
  return `danced ${[...used].join(', ')}`;
});

done();
