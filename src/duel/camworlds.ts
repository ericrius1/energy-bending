// The duel's four worlds in Node, for the camera's measures (camera.test.ts, camprobe.ts): the temple, the geode and the
// pool as stages.ts has them, and the redwoods from its pure layout as redwoods.ts builds it with the arena shown (the
// lanterns over the space lifted, the drops open, the fallen giant's top to stand on). Node only: the page has the worlds.
import { nodeArena } from './sim';
import { inDrop, type Arena } from './arena';
import type { WorldLike } from './fallback';
import { layoutWoods, solidsOfWoods } from '../worlds/redwoods/layout';
import { HANG, HANG_FLOATS, layoutGarden } from '../worlds/redwoods/garden';
import { layoutStage, liftLanterns, solidsOfStage } from '../worlds/redwoods/stage';
import { redwoodsDuel } from '../worlds/redwoods/arena';
import { stagePlane, toPlane } from '../worlds/stage';

export const CAM_WORLDS = ['temple', 'redwoods', 'geode', 'pool'] as const;

/** a world and its arena in Node, by id */
export function nodeWorld(id: string): { arena: Arena; world: WorldLike } {
  if (id !== 'redwoods') return nodeArena(id);
  const woods = layoutWoods(), stage = layoutStage(woods.trunks), A = redwoodsDuel().arena;
  liftLanterns(woods.lanterns, stage.right);
  for (const l of woods.lanterns) {
    const inside = Math.hypot(l.anchor[0] - A.space.center[0], l.anchor[2] - A.space.center[2]) < A.space.radius + 1;
    if (inside) l.cord = Math.min(l.cord, Math.max(0.6, l.anchor[1] - A.space.yTop));
  }
  const plane = stagePlane({ id: 'clearing', origin: [0, 0, 0], right: stage.right, halfWidth: 5.75, ground: 0, ledges: stage.ledges, spawns: [[-1.2, 0], [1.2, 0]], lens: 22 });
  const log = stage.ledges[0], R = stage.plate[0], cy = log.y - R;
  return {
    arena: A,
    world: {
      id, room: A.camera?.maxDist ?? 16, solids: [...solidsOfStage(stage.pieces), ...solidsOfWoods(woods), ...(A.pieces ?? [])],
      groundAt: (x, z) => {
        if (inDrop(A.plane, A.drops ?? [], x, z)) return -2.6;
        const [px, , across] = toPlane(plane, [x, 0, z]);
        if (px >= log.x0 && px <= log.x1 && Math.abs(across) < R) return Math.max(0, cy + Math.sqrt(R * R - across * across));
        return 0;
      },
    },
  };
}

type P3 = [number, number, number];
/** what stands above (and round) each world's floor that the duel's frame should hold as well as the pair (report 17,
 *  issue 1: "the solarpunk stands above the duel's frame"), as points for the camera's measure (camprobe.ts): a frame
 *  shows a landmark when one of its points is in the lens and not hidden behind a solid. Far things (the sea, the
 *  Pool's shore) are points a long way off at their height over the horizon.
 *  - temple: the colonnade's tops (the lintels and drums over 4.5 m, vines and banners on them), and the sky over the
 *    sea's horizon (the canopy itself hangs out over the sea toward the sun: temple.wgsl CANOPY_Y, never drawn)
 *  - redwoods: the bunting strung from ring tree to ring tree, 7.2 to 8.1 m up (garden.ts)
 *  - geode: the four leaded light wells high on the vault (geode.ts WELLS, WELL_UP: copied here, the page's module is
 *    the GPU's)
 *  - pool: the far garden shore and its glass pavilions, 0 to 3.2° over the horizon all round (pool.wgsl shoreAt)
 *  and in every world `edge`: the stage's edge behind the stage (−z, as the lock looks), 1 to 2.5 m up, where the
 *  worlds stand their landmarks at the bodies' height (phase 5) */
export function landmarksOf(id: string): { name: string; pts: P3[] }[] {
  const { arena, world } = nodeWorld(id), c = arena.space.center, R = arena.space.radius;
  const far = (deg: number, n = 24, dist = 400) => Array.from({ length: n }, (_, k): P3 => {
    const a = (k / n) * Math.PI * 2;
    return [c[0] + Math.sin(a) * dist, dist * Math.tan((deg * Math.PI) / 180), c[2] + Math.cos(a) * dist];
  });
  const edge = { name: 'edge', pts: [-0.6, -0.3, 0, 0.3, 0.6].flatMap((a): P3[] => [1, 2.5].map((y): P3 => [c[0] + Math.sin(a) * R, y, c[2] - Math.cos(a) * R])) };
  if (id === 'temple') {
    const tops: P3[] = [];
    for (const s of world.solids ?? []) {
      const q = s as unknown as { kind: string; c?: P3; h?: P3; a?: P3; b?: P3; r?: number };
      const top: P3 | null = q.kind === 'box' && q.c && q.h ? [q.c[0], q.c[1] + q.h[1], q.c[2]]
        : q.a && q.b ? (q.a[1] > q.b[1] ? [q.a[0], q.a[1] + (q.r ?? 0), q.a[2]] : [q.b[0], q.b[1] + (q.r ?? 0), q.b[2]]) : null;
      if (top && top[1] > 4.5 && Math.hypot(top[0] - c[0], top[2] - c[2]) < R + 4) tops.push([top[0], top[1] - 0.3, top[2]]);
    }
    return [{ name: 'colonnade', pts: tops }, { name: 'sea sky', pts: far(2) }, edge];
  }
  if (id === 'geode') {
    const Rv = 12 + 0.4, el = 0.55;
    const wells = [205, 250, 292, 150].map((deg): P3 => { const a = (deg * Math.PI) / 180; return [Math.cos(a) * Math.cos(el) * Rv, Math.sin(el) * Rv, Math.sin(a) * Math.cos(el) * Rv]; });
    return [{ name: 'wells', pts: wells }, edge];
  }
  if (id === 'redwoods') {
    const woods = layoutWoods(), G = layoutGarden(woods.trunks, 9, redwoodsDuel().runs, false), pts: P3[] = [];
    for (let i = 0; i < G.clearing; i++) {
      const o = i * HANG_FLOATS;
      if (G.data[o + 3] !== HANG.string) continue;
      const a: P3 = [G.data[o], G.data[o + 1], G.data[o + 2]], b: P3 = [G.data[o + 12], G.data[o + 13], G.data[o + 14]], sag = G.data[o + 15];
      for (const t of [0.25, 0.5, 0.75]) pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 4 * sag * t * (1 - t) - 0.2, a[2] + (b[2] - a[2]) * t]);
    }
    return [{ name: 'bunting', pts }, edge];
  }
  if (id === 'pool') return [{ name: 'shore sky', pts: far(1.6) }, edge];
  return [edge];
}
