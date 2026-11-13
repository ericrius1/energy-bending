// The brains in simulated play (npm test): real Characters, the move library and shared/rules.ts through the
// referee (jogo.ts), at 60 fps on a virtual music clock, on the geode's own stage plane. What they must do:
//   two partners for three minutes fill tension and fuse more than once, dodge and clash well above being hit, keep
//   to the 8ths, use at least eight moves each, never leave the stage, never stall;
//   a "human" that only attacks is answered with dodges; one that stands still is invited, not beaten; a repeated
//   pattern is joined in unison; the teacher's drill climbs with a student who answers and not with one who doesn't;
//   free dancers wander, dance and keep off the stage plane, and a roda forms round the jogo.
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
import { simulate, swell, type SimOptions } from '../sim';
import { AttackerBrain, PatternBrain, StillBrain } from './scripted';

const load = (name: string): Motion => {
  const meta = JSON.parse(readFileSync(`public/motion/${name}.json`, 'utf8'));
  const bin = readFileSync(`public/motion/${name}.bin`);
  return { ...meta, bin: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) };
};
const plane = stagePlane({ id: 'centre', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: layoutShelves({ caveRadius: 8.5 }).ledges, spawns: [[-2.45, 0], [2.45, 0]] });
const n = (r: Record<string, number>, k: string) => r[k] ?? 0;

/** a run, with what the checks need gathered along the way */
function run(o: SimOptions) {
  let left = 0, last = 0, gap = 0;
  const r = simulate({
    ...o,
    each: (f) => {
      for (const c of f.bodies.slice(0, 2)) {
        // off the stage: past its walls, or fallen below its floor
        if (Math.abs(c.s) > plane.halfWidth + 0.05 || c.y < -0.5 || c.reforming) left++;
      }
      const moved = f.bodies.slice(0, 2).some((c) => c.move && c.move.t < 1 / 50);
      const ph = f.ref.session.phase, music = (o.music ?? swell)(f.t);
      if (moved || ph === 'intro' || ph === 'waiting' || music.breakdown) last = f.t;
      gap = Math.max(gap, f.t - last);
      o.each?.(f);
    },
  });
  return { ...r, left, gap };
}

test('two partners, three minutes: tension, fusions, exchanges, the beat, variety, the stage', () => {
  const lines: string[] = [];
  for (const seed of [11, 12, 13]) {
    const r = run({ plane, seats: [new PartnerBrain({ seed }), new PartnerBrain({ seed: seed * 3 + 1 })], seconds: 180 });
    const S = r.stats, x = (k: string) => n(S.xch[0], k) + n(S.xch[1], k);
    const good = x('dodge') + x('clash') + x('parry'), onBeat = S.errors.filter((e) => e <= 55).length / S.errors.length;
    lines.push(`seed ${seed}: fusions ${S.fusions}, dodge ${x('dodge')} clash ${x('clash')} parry ${x('parry')} near ${x('near')} hit ${x('hit')}, echo ${S.echoes} unison ${S.unisons}, on the 8ths ${(onBeat * 100).toFixed(0)}%, moves ${S.distinct[0].size}/${S.distinct[1].size} kinds, ${S.moves[0]}/${S.moves[1]} moves, longest stall ${r.gap.toFixed(1)} s`);
    assert(S.fusions >= 2, `seed ${seed}: fusions ${S.fusions}`);
    assert(good >= 2.5 * x('hit') && good > 6, `seed ${seed}: dodges+clashes+parries ${good} vs hits ${x('hit')}`);
    assert(onBeat >= 0.8, `seed ${seed}: on the beat ${onBeat}`);
    assert(S.distinct[0].size >= 8 && S.distinct[1].size >= 8, `seed ${seed}: distinct ${S.distinct[0].size}, ${S.distinct[1].size}`);
    assert(r.left === 0, `seed ${seed}: off the stage for ${r.left} frames`);
    assert(r.gap < 8, `seed ${seed}: stalled ${r.gap.toFixed(1)} s`);
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
  let inside = 0, far = 0, danced = 0, frames = 0, crowd = 0, where = "";
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
        if (Math.hypot(c.x, c.z) > 7.6) far++;
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
  assert(far === 0, `outside the room for ${far} frames`);
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

done();
