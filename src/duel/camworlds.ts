// The duel's four worlds in Node, for the camera's measures (camera.test.ts, camprobe.ts): the temple, the geode and the
// pool as stages.ts has them, and the redwoods from its pure layout as redwoods.ts builds it with the arena shown (the
// lanterns over the space lifted, the drops open, the fallen giant's top to stand on). Node only: the page has the worlds.
import { nodeArena } from './sim';
import { inDrop, type Arena } from './arena';
import type { WorldLike } from './fallback';
import { layoutWoods, solidsOfWoods } from '../worlds/redwoods/layout';
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
