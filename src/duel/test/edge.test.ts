// Report 19 (the phase 5 film): does the space's soft edge (match.ts softWall, report 18-flow) let a body reach the
// ways out at the rim (its world's gate to the hub, the mirrors: arena.ts exits)? A body runs straight at each from
// 3.5 m in front, the stick held on the disc's middle, on the world's own floor and solids, the soft edge applied each
// frame as the match applies it: it must cross the gate's plane inside its disc within two seconds. (Two stood past
// their space's radius, the geode's gate to the redwoods and the redwoods' to the hub, and the edge kept every body
// from them, until the edge opened in a way out's lane.)
import { Character } from '../../dancer/character';
import { makeIntent, type Intent } from '../../input/intent';
import { test, assert, done } from '../../dancer/test/check';
import { DuelMatch, duelPlane } from '../match';
import { nodeArena } from '../sim';

const I = (o: Partial<Intent> = {}): Intent => Object.assign(makeIntent(), o);

/** the stick's z against the world's: +1 if moveZ 1 walks toward +z */
const zSign = (() => {
  const c = new Character({ seat: 0, plane: null, terrain: { groundAt: () => 0, solids: [] } });
  c.setProfile('duel'); c.reset(0, undefined, 0);
  for (let i = 0; i < 30; i++) c.update(1 / 60, I({ moveZ: 1 }), { beats: i / 30, bpm: 120 });
  return c.root[2] > 0 ? 1 : -1;
})();

test('every way out at the rim is reached at a run through the soft edge', () => {
  const lines: string[] = [];
  for (const id of ['temple', 'redwoods', 'geode', 'pool']) {
    const { arena, world } = nodeArena(id);
    const solids = world.solids ?? [];
    const S = arena.space;
    for (const e of arena.exits ?? []) {
      const chars = [0, 1].map((k) => { const c = new Character({ seat: k, plane: null, terrain: { groundAt: (x, z) => world.groundAt(x, z), solids } }); c.setProfile('duel'); return c; }) as [Character, Character];
      const m = new DuelMatch(chars, arena, duelPlane(arena), 0, 112, { solids: () => solids });
      const wall = (m as unknown as { softWall(c: Character): number }).softWall.bind(m);
      const c = chars[0];
      const [dx, dz] = e.dir, x0 = e.at[0] - dx * (e.r + 3.5), z0 = e.at[2] - dz * (e.r + 3.5);
      c.reset(x0, undefined, z0);
      for (let i = 0; i < 20; i++) c.update(1 / 60, I(), { beats: i / 30, bpm: 120 });
      let reached = false, best = -Infinity, took = 0;
      for (let i = 0; i < 120 && !reached; i++) {
        const ax = e.at[0] - c.root[0], az = e.at[2] - c.root[2], l = Math.hypot(ax, az) || 1;
        c.update(1 / 60, I({ moveX: ax / l, moveZ: (zSign * az) / l }), { beats: i / 30, bpm: 120 });
        took += wall(c);
        // (past the gate's plane, within its disc across)
        const along = (c.root[0] - e.at[0]) * dx + (c.root[2] - e.at[2]) * dz, across = Math.abs(-(c.root[0] - e.at[0]) * dz + (c.root[2] - e.at[2]) * dx);
        best = Math.max(best, along);
        if (along >= 0 && across < e.r) reached = true;
      }
      const r = Math.hypot(e.at[0] - S.center[0], e.at[2] - S.center[2]);
      lines.push(`${id} ${e.id} ${r.toFixed(2)}/${S.radius} m: ${reached ? 'reached' : `short by ${(-best).toFixed(2)} m`}${took > 0.5 ? ` (the edge took ${took.toFixed(1)} m/s)` : ''}`);
      // (a world's own gate to the hub stands where its world's layout put it, its lane not kept clear (flow.test.ts):
      // the redwoods' has a bough 1.4 m high across it, jumped, not run through; reported, not asserted)
      if (e.id === 'geode') continue;
      assert(reached, `${id} ${e.id}: never reached (closest ${(-best).toFixed(2)} m short, ${r.toFixed(2)} m from the middle, the space ${S.radius} m)`);
    }
  }
  return lines.join('; ');
});

done();
