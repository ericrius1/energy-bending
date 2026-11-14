// The worlds' stage planes without a page (for the duel's Node harness and tests): the same layouts and numbers the
// worlds build their stages from (worlds/*/layout.ts are pure), so a duel simulated in Node stands on the ledges the
// page draws. Only the temple, the forge and the pool; the geode's and the redwoods' stages need their whole layouts
// (the crystal shelves, the trunks) and the page builds those itself.
import { stagePlane, type StagePlane } from '../worlds/stage';
import { layoutTemple, STAGE_Z } from '../worlds/temple/layout';
import { layoutForge } from '../worlds/forge/layout';

export const NODE_WORLDS = ['temple', 'forge', 'pool'] as const;

/** a world's first stage plane as the world makes it (src/worlds/<id>/<id>.ts), or null */
export function stageFor(world: string): StagePlane | null {
  switch (world) {
    case 'temple': return stagePlane({ id: 'court', origin: [0, 0, STAGE_Z], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: layoutTemple({ coarse: false }).ledges, spawns: [[-2.0, 0], [2.05, 0]], lens: 19, yaw: 0.14, pitch: 0 });
    case 'forge': return stagePlane({ id: 'anvil', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: null, ledges: layoutForge({ coarse: false }).ledges, spawns: [[-2.3, 0], [2.3, 0]], lens: 20 });
    case 'pool': return stagePlane({ id: 'pool', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: [], spawns: [[-2.45, 0], [2.45, 0]], lens: 18 });
  }
  return null;
}
