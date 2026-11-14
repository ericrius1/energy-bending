// The worlds as the duel's Node harness and tests need them, without a page: each one's duel arena (the arena work's,
// worlds/<id>/arena.ts) and the world as it stands while that arena is shown (`showArena`): its floor (groundAt, with
// the arena's drops open), its solids (the world's own and the arena's pieces) and where it is fallen out of, from the
// same pure layouts the worlds build themselves from, so a duel simulated in Node stands, climbs and falls where the
// page does. The temple, the geode (its shelves and the crowns round its gates: geode.ts's own layout), the redwoods (the
// wood's own layout, its stage, the fallen giant's round top) and the pool.
import { stagePlane, type StagePlane } from '../worlds/stage';
import { layoutTemple, solidsOf, STAGE_Z } from '../worlds/temple/layout';
import { templeDuel } from '../worlds/temple/arena';
import { layoutShelves, solidsOfShelves } from '../worlds/geode/shelves';
import { hubGates } from '../worlds/geode/gates';
import { geodeDuel } from '../worlds/geode/arena';
import { poolDuel, poolGround } from '../worlds/pool/arena';
import { layoutWoods, solidsOfWoods } from '../worlds/redwoods/layout';
import { layoutStage, solidsOfStage } from '../worlds/redwoods/stage';
import { redwoodsDuel } from '../worlds/redwoods/arena';
import { toPlane } from '../worlds/stage';
import { inDrop, type Arena } from './arena';
import { waterFloor } from './hazards';
import type { WorldLike } from './fallback';

export const NODE_WORLDS = ['temple', 'geode', 'redwoods', 'pool'] as const;

export interface NodeWorld extends WorldLike { stage: StagePlane; arena: Arena }

/** a world as the page makes it with its duel arena shown (src/worlds/<id>/<id>.ts), or null */
export function worldFor(id: string): NodeWorld | null {
  switch (id) {
    case 'temple': {
      const L = layoutTemple({ coarse: false }), A = templeDuel().arena;
      return {
        id, room: A.camera?.maxDist ?? 16, arena: A, solids: [...solidsOf(L.stones), ...(A.pieces ?? [])],
        groundAt: (x, z) => {
          // (and the tide over it, a floor to float on: hazards.ts)
          const w = waterFloor(A.hazard, x, z);
          if (inDrop(A.plane, A.drops ?? [], x, z)) return Math.max(-2.6, w);
          for (const [x0, x1, z0, z1, top] of L.tops) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return Math.max(top, w);
          return Math.max(0, w);
        },
        stage: stagePlane({ id: 'court', origin: [0, 0, STAGE_Z], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: L.ledges, spawns: [[-2.0, 0], [2.05, 0]], lens: 19, yaw: 0.14, pitch: 0 }),
      };
    }
    case 'geode': {
      // (geode.ts: the shelves grown with the gates' crowns, the agate, the arena's drops 2.4 m down)
      const S = layoutShelves({ caveRadius: 12, gates: hubGates() }), A = geodeDuel().arena;
      return {
        id, room: A.camera?.maxDist ?? 7.4, arena: A, solids: [...solidsOfShelves(S.blades, S.points), ...(A.pieces ?? [])],
        groundAt: (x, z) => (inDrop(A.plane, A.drops ?? [], x, z) ? -2.4 : 0),
        stage: stagePlane({ id: 'centre', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: S.ledges, spawns: [[-2.2, 0], [2.2, 0]], lens: 24 }),
      };
    }
    case 'redwoods': {
      // (redwoods.ts: the meadow, the fallen giant's round top along the stage, the arena's drops 2.6 m down)
      const woods = layoutWoods(), S = layoutStage(woods.trunks), A = redwoodsDuel().arena;
      const stage = stagePlane({ id: 'clearing', origin: [0, 0, 0], right: S.right, halfWidth: 5.75, ground: 0, ledges: S.ledges, spawns: [[-1.2, 0], [1.2, 0]], lens: 22 });
      const log = S.ledges[0], R = S.plate[0], cy = log.y - R;
      return {
        id, room: A.camera?.maxDist ?? 9.6, arena: A, solids: [...solidsOfStage(S.pieces), ...solidsOfWoods(woods), ...(A.pieces ?? [])],
        groundAt: (x, z) => {
          if (inDrop(A.plane, A.drops ?? [], x, z)) return -2.6;
          const [px, , across] = toPlane(stage, [x, 0, z]);
          if (px >= log.x0 && px <= log.x1 && Math.abs(across) < R) return Math.max(0, cy + Math.sqrt(R * R - across * across));
          return 0;
        },
        stage,
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
