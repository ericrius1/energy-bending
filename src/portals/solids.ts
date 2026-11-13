// The solid things of each world as the camera sees them: the world's own `solids` (src/worlds/solids.ts, the one
// description: capsules and boxes in its own coordinates, built from the same layout it draws from), wrapped once per
// world in the camera's `Solids` (a bounding sphere each). The Pool has none. (The cameras agent first read these from
// each world's layout here; at the integration they moved into the worlds' folders as their `solids`.)
import { Solids } from '../engine/camera';
import type { World } from '../worlds/world';

const made = new WeakMap<World, Solids | null>();

/** a world's solids (null: none) */
export function solidsOf(w: World): Solids | null {
  if (made.has(w)) return made.get(w)!;
  const s = w.solids?.length ? new Solids(w.solids) : null;
  made.set(w, s);
  return s;
}
