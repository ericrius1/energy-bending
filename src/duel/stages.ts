// The worlds as the duel's Node harness and tests need them, without a page: each one's stage plane, its floor
// (groundAt), its solids, its room and where it is fallen out of, from the same pure layouts the worlds build
// themselves from (worlds/*/layout.ts), so a duel simulated in Node stands, climbs and falls where the page does. The
// temple, the forge and the pool; the geode's and the redwoods' need their whole layouts and the page builds those.
// (The forge's bobbing floats stand still here: the Node floor has no beat.)
import { stagePlane, type StagePlane } from '../worlds/stage';
import { layoutTemple, solidsOf, STAGE_Z } from '../worlds/temple/layout';
import { layoutForge, floorAt, solidsOfForge } from '../worlds/forge/layout';
import type { WorldLike } from './fallback';

export const NODE_WORLDS = ['temple', 'forge', 'pool'] as const;

export interface NodeWorld extends WorldLike { stage: StagePlane }

/** a world as the page makes it (src/worlds/<id>/<id>.ts), or null */
export function worldFor(id: string): NodeWorld | null {
  switch (id) {
    case 'temple': {
      const L = layoutTemple({ coarse: false });
      return {
        id, room: 16, solids: solidsOf(L.stones),
        groundAt: (x, z) => { for (const [x0, x1, z0, z1, top] of L.tops) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return top; return 0; },
        stage: stagePlane({ id: 'court', origin: [0, 0, STAGE_Z], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: L.ledges, spawns: [[-2.0, 0], [2.05, 0]], lens: 19, yaw: 0.14, pitch: 0 }),
      };
    }
    case 'forge': {
      const L = layoutForge({ coarse: false });
      return {
        id, room: 24, fallY: -4, solids: solidsOfForge(L),
        groundAt: (x, z) => floorAt(L, x, z, (_s, top) => top, -12),
        stage: stagePlane({ id: 'anvil', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: null, ledges: L.ledges, spawns: [[-2.3, 0], [2.3, 0]], lens: 20 }),
      };
    }
    case 'pool':
      return { id, room: 40, groundAt: () => 0, stage: stagePlane({ id: 'pool', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: [], spawns: [[-2.45, 0], [2.45, 0]], lens: 18 }) };
  }
  return null;
}

/** a world's first stage plane (the lock's) */
export const stageFor = (id: string): StagePlane | null => worldFor(id)?.stage ?? null;
