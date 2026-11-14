// ?arena=<world>: a duel arena on its own, to look at and check (before the duel itself exists, and beside it): the world
// shown with its arena's matter on (`showArena`), nobody in it, the camera locked to the arena's plane framing all of
// it from its low point to its top, as far back as the arena's camera range allows (its `maxDist` stands in for the
// world's room here); `&free` leaves the camera free (`bend.camera` turns it round the space). Add &arenaDebug for the
// arena's data as lines over it (arena-layer.ts); `window.arena` shows another world's arena or none, locks or frees.
import type { CameraRig, StagePlane } from '../engine/camera';
import type { Show } from '../dancer/show';
import type { World } from '../worlds/world';
import { arenaFor, arenas, showArena, type Arena } from './arena';
import { arenaParams } from './arena-layer';

export interface ArenaViewCtx {
  query: URLSearchParams;
  show: Show;
  rig: CameraRig;
  worldOf(id: string): World;
  setWorld(id: string): Promise<void>;
}

/** the plane the view locks to: the arena's, its floor put at the lowest height worth framing (the arena's camera
 *  says, or just above the kill floor), so the rig's framing (nobody on it: the whole stage) takes in the drops as well */
function viewPlane(a: Arena): StagePlane {
  return { ...a.plane, ground: a.camera?.low ?? a.space.yKill + 0.6, height: a.space.yTop };
}

export async function arenaView(o: ArenaViewCtx) {
  // nobody on the stage: the arena alone
  o.show.castOverride = () => [];
  const rooms = new Map<World, PropertyDescriptor | undefined>();
  const go = async (id: string | null) => {
    const a = id ? arenaFor(id) : null;
    if (id && !a) throw new Error(`no arena for '${id}' (there are: ${arenas.ids().join(', ')})`);
    // (the arena's camera range in place of the world's room while it is shown)
    for (const [w, d] of rooms) { if (d) Object.defineProperty(w, 'room', d); else delete (w as { room?: number }).room; }
    rooms.clear();
    if (!a) { showArena(null); o.rig.lock(null); return null; }
    await o.setWorld(a.world);
    const w = o.worldOf(a.world);
    if (a.camera?.maxDist) {
      rooms.set(w, Object.getOwnPropertyDescriptor(w, 'room'));
      const room = a.camera.maxDist;
      Object.defineProperty(w, 'room', { get: () => room, configurable: true });
    }
    showArena(a.world);
    o.rig.lock(locked ? viewPlane(a) : null);
    return a;
  };
  let locked = !o.query.has('free');
  const first = o.query.get('arena') || 'geode';
  let shown = first;
  await go(first);
  Object.assign(window, {
    arena: {
      /** show a world's arena (null: none) */
      show: (id: string | null) => { if (id) shown = id; return go(id); },
      debug: (on: boolean) => { arenaParams.debug = on; },
      /** the camera locked to the arena's plane, or free */
      lock: (on: boolean) => { locked = on; const a = arenaFor(shown); o.rig.lock(on && a ? viewPlane(a) : null); },
      ids: () => arenas.ids(),
      /** the arena's pieces, drops and light on or off, the camera as it is (to time what they cost) */
      geometry: (on: boolean) => showArena(on ? shown : null),
    },
  });
  // (keys: `[` and `]` the other worlds' arenas, `\` the debug lines)
  addEventListener('keydown', (e) => {
    const ids = arenas.ids(), now = ids.indexOf(o.rig.plane?.id.replace(/\.duel$/, '') ?? first);
    if (e.key === ']' || e.key === '[') { shown = ids[(now + (e.key === ']' ? 1 : ids.length - 1)) % ids.length]; void go(shown); }
    else if (e.key === '\\') arenaParams.debug = !arenaParams.debug;
  });
}
