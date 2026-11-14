// The worlds as the duel's Node harness and tests need them, without a page: each one's duel arena (the arena work's,
// worlds/<id>/arena.ts) and the world as it stands while that arena is shown (`showArena`): its floor (groundAt, with
// the arena's drops open), its solids (the world's own and the arena's pieces) and where it is fallen out of, from the
// same pure layouts the worlds build themselves from, so a duel simulated in Node stands, climbs and falls where the
// page does. The temple, the forge and the pool; the geode's and the redwoods' worlds need their whole layouts, which
// the page builds. (The forge's bobbing floats stand still here: the Node floor has no beat.)
import { stagePlane, type StagePlane } from '../worlds/stage';
import { layoutTemple, solidsOf, STAGE_Z } from '../worlds/temple/layout';
import { layoutForge, groundOf, solidsOfForge } from '../worlds/forge/layout';
import { templeDuel } from '../worlds/temple/arena';
import { forgeDuel } from '../worlds/forge/arena';
import { poolDuel, poolGround } from '../worlds/pool/arena';
import { inDrop, type Arena } from './arena';
import type { WorldLike } from './fallback';

export const NODE_WORLDS = ['temple', 'forge', 'pool'] as const;

export interface NodeWorld extends WorldLike { stage: StagePlane; arena: Arena }

/** a world as the page makes it with its duel arena shown (src/worlds/<id>/<id>.ts), or null */
export function worldFor(id: string): NodeWorld | null {
  switch (id) {
    case 'temple': {
      const L = layoutTemple({ coarse: false }), A = templeDuel().arena;
      return {
        id, room: A.camera?.maxDist ?? 16, arena: A, solids: [...solidsOf(L.stones), ...(A.pieces ?? [])],
        groundAt: (x, z) => {
          if (inDrop(A.plane, A.drops ?? [], x, z)) return -2.6;
          for (const [x0, x1, z0, z1, top] of L.tops) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return top;
          return 0;
        },
        stage: stagePlane({ id: 'court', origin: [0, 0, STAGE_Z], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: L.ledges, spawns: [[-2.0, 0], [2.05, 0]], lens: 19, yaw: 0.14, pitch: 0 }),
      };
    }
    case 'forge': {
      const L = layoutForge({ coarse: false }), A = forgeDuel().arena;
      return {
        id, room: A.camera?.maxDist ?? 24, fallY: -4, arena: A, solids: [...solidsOfForge(L), ...(A.pieces ?? [])],
        // (the forge's own floor, groundOf: the lowest slab under a point, so the crown over the middle is left to the
        // solids, which stand a body on it from above and stop it from the side; the floats stand still here)
        groundAt: (x, z) => groundOf(L, x, z, (_, top) => top, -12),
        stage: stagePlane({ id: 'anvil', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: null, ledges: L.ledges, spawns: [[-2.3, 0], [2.3, 0]], lens: 20 }),
      };
    }
    case 'pool': {
      const A = poolDuel().arena;
      return {
        id, room: A.camera?.maxDist ?? 40, arena: A, solids: A.pieces ?? [], groundAt: poolGround,
        stage: stagePlane({ id: 'pool', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: [], spawns: [[-2.45, 0], [2.45, 0]], lens: 18 }),
      };
    }
  }
  return null;
}

/** a world's first stage plane (the lock's, before the arena) */
export const stageFor = (id: string): StagePlane | null => worldFor(id)?.stage ?? null;
