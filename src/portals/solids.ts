// The solid things of each world as the camera sees them: the world's own `solids` (src/worlds/solids.ts, the one
// description: capsules and boxes in its own coordinates, built from the same layout it draws from), wrapped once per
// world in the camera's `Solids` (a bounding sphere each). The Pool has none. (The cameras agent first read these from
// each world's layout here; at the integration they moved into the worlds' folders as their `solids`.)
import { Solids } from '../engine/camera';
import type { World } from '../worlds/world';
import type { Solid } from '../worlds/solids';

const made = new WeakMap<readonly Solid[], Solids>();

/** a world's solids (null: none). Wrapped once per list: a world whose list changes (the duel's arena matter, shown
 *  and hidden: src/duel/arena.ts) hands over another array, and that one is wrapped once in its turn */
export function solidsOf(w: World): Solids | null {
  const list = w.solids;
  if (!list?.length) return null;
  let s = made.get(list);
  if (!s) { s = new Solids(list); made.set(list, s); }
  return s;
}
