// Phase 5's flow (docs/reports/18-flow.md), checked on the bodies alone: a face met at a slant turns the run along it
// rather than stopping it, a low thing run at is hopped onto with the run kept, a tall face still stops a run, a flight
// the contact gives keeps its speed through the air, the space's soft edge turns a run along it rather than stopping it,
// and every arena keeps its ways out clear.
import { Character } from '../../dancer/character';
import { makeIntent, type Intent } from '../../input/intent';
import { box, type Solid } from '../../worlds/solids';
import { test, assert, done } from '../../dancer/test/check';
import { DuelMatch, duelPlane } from '../match';
import { nodeArena } from '../sim';
import { topAt, bottomAt } from '../arena';

const I = (o: Partial<Intent> = {}): Intent => Object.assign(makeIntent(), o);
const body = (solids: Solid[], x = 0, z = 0) => {
  const c = new Character({ seat: 0, plane: null, terrain: { groundAt: () => 0, solids } });
  c.setProfile('duel');
  c.reset(x, undefined, z);
  for (let i = 0; i < 30; i++) c.update(1 / 60, I(), { beats: 0, bpm: 120 });
  return c;
};
const run = (c: Character, secs: number, it: Partial<Intent>, each?: () => void) => {
  for (let i = 0; i < Math.round(secs * 60); i++) { c.update(1 / 60, I(it), { beats: i / 30, bpm: 120 }); each?.(); }
};
const hsp = (c: Character) => Math.hypot(c.v[0], c.v[2]);

test('a wall met at a slant turns the run along it (a glance), not a stop', () => {
  // a long wall along z at x = 2, run at it 35° off square
  const c = body([box([2.5, 1.5, 0], [0.5, 1.5, 10])]);
  run(c, 0.6, { moveX: 0.57, moveZ: 0.82 });
  let least = Infinity;
  run(c, 0.8, { moveX: 0.57, moveZ: 0.82 }, () => { if (c.root[0] > 1.6) least = Math.min(least, hsp(c)); });
  assert(least > 4, `at the wall the run kept ${least.toFixed(2)} m/s`);
  return `along the wall at ${least.toFixed(1)} m/s (top speed ${c.phys.runSpeed})`;
});

test('a low thing run at is hopped onto at a run; a tall one still stops it', () => {
  // (a low block 4 m long: run at, hopped onto, run along)
  const low = body([box([4.6, 0.45, 0], [2, 0.45, 2])]);
  let on = false, slowest = Infinity;
  run(low, 1.4, { moveX: 1 }, () => { if (low.grounded && Math.abs(low.root[1] - 0.9) < 0.05) on = true; if (low.root[0] > 1.5 && low.root[0] < 4) slowest = Math.min(slowest, hsp(low)); });
  assert(on, `stood on its top (at ${low.root.map((v) => v.toFixed(2))})`);
  assert(slowest > 3, `kept the run over it: ${slowest.toFixed(2)} m/s at its slowest`);
  const tall = body([box([3, 1.5, 0], [0.6, 1.5, 2])]);
  run(tall, 1.2, { moveX: 1 });
  assert(tall.root[0] < 2.2 && tall.grounded, `a 3 m block stopped it (at ${tall.root[0].toFixed(2)})`);
  return `over a 0.9 m block at ${slowest.toFixed(1)} m/s at the slowest`;
});

test('a carried flight keeps its speed with the stick let go; a plain jump eases off as before', () => {
  const fly = (carry: boolean) => {
    const c = body([]);
    c.root = [0, 3, 0]; c.v = [10, 6, 0]; c.grounded = false; c.support = null;
    if (carry) c.carry(1.1);
    let x0 = c.root[0];
    run(c, 0.5, {});
    return { d: c.root[0] - x0, v: hsp(c) };
  };
  const a = fly(true), b = fly(false);
  assert(a.v > 9, `carried: ${a.v.toFixed(2)} m/s after half a second`);
  assert(a.d > b.d + 0.4, `carried ${a.d.toFixed(2)} m, not ${b.d.toFixed(2)}`);
  return `half a second: ${a.d.toFixed(1)} m carried, ${b.d.toFixed(1)} m not`;
});

test('the soft edge turns a run along it and keeps most of its speed', () => {
  const { arena, world } = nodeArena('geode');
  const solids: Solid[] = [];
  const chars = [0, 1].map((k) => { const c = new Character({ seat: k, plane: null, terrain: { groundAt: () => 0, solids } }); c.setProfile('duel'); return c; }) as [Character, Character];
  void world;
  const m = new DuelMatch(chars, arena, duelPlane(arena), 0, 112, { solids: () => solids });
  const C = arena.space.center, R = arena.space.radius;
  const c = chars[0];
  c.reset(C[0] + R - 0.3, undefined, C[2]);
  c.grounded = true; c.v = [6, 0, 1];
  let speed = 0;
  for (let i = 0; i < 20; i++) {
    (m as unknown as { softWall(c: Character): number }).softWall(c);
    c.root = [c.root[0] + c.v[0] / 60, c.root[1], c.root[2] + c.v[2] / 60];
    speed = hsp(c);
  }
  const out = Math.hypot(c.root[0] - C[0], c.root[2] - C[2]) - R;
  assert(speed > 4, `kept ${speed.toFixed(2)} of 6.1 m/s`);
  assert(out < 0.6, `${out.toFixed(2)} m past the edge`);
  return `${speed.toFixed(1)} m/s along the edge, at most ${Math.max(0, out).toFixed(2)} m past it`;
});

test('every arena keeps its ways out: clear floor round each exit', () => {
  const lines: string[] = [];
  for (const id of ['temple', 'redwoods', 'geode', 'pool']) {
    const { arena, world } = nodeArena(id);
    assert(arena.exits?.length, `${id}: no exits`);
    for (const e of arena.exits!) {
      const bad = (world.solids ?? []).filter((s) => {
        const blocks = (x: number, z: number) => topAt(s, x, z, 0) > 0.4 && bottomAt(s, x, z) < 2.6;
        for (let a = 0; a < 12; a++) for (const r of [0, e.r * 0.5, e.r]) if (blocks(e.at[0] + Math.cos(a) * r, e.at[2] + Math.sin(a) * r)) return true;
        // (and a lane 3 m deep in front of it, toward the middle, a body and a half wide)
        for (let d = 0; d <= 3; d += 0.25) for (const o of [-0.6, 0, 0.6]) if (blocks(e.at[0] - e.dir[0] * (e.r + d) - e.dir[1] * o, e.at[2] - e.dir[1] * (e.r + d) + e.dir[0] * o)) return true;
        return false;
      });
      assert(!bad.length, `${id} ${e.id}: ${bad.length} solid(s) in its clear zone (${bad.map((s) => (s.kind === "box" ? s.c : s.a).map((v) => v.toFixed(1)).join(" ")).join("; ")})`);
    }
    lines.push(`${id} ${arena.exits!.map((e) => e.id).join(', ')}`);
  }
  return lines.join('; ');
});

done();
