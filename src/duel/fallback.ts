// A world's duel arena until the arena work gives it one (arena.ts): its own stage plane, as it is (the ledges the world
// already draws, so a ledge the eye sees is where the feet land), with walls on the sides of its solid ledges (the
// temple's pillars and altar, the forge's anvil), spawns on the floor and on every ledge wide enough to stand on, the
// kill floor a couple of metres under the lowest thing to stand on, and the top well above the highest. Pure.
import type { Ledge, StagePlane } from '../engine/camera';
import type { Arena } from './arena';

/** the contract's wall (docs/design/duel.md: engine/camera.ts gains it); kept structural here until it lands */
export interface WallLike { id: string; s: number; side: 1 | -1; y0: number; y1: number; climb?: boolean }
/** a plane's walls, whatever the plane's type says (the contract's `walls?`) */
export const wallsOf = (p: StagePlane): readonly WallLike[] => (p as StagePlane & { walls?: WallLike[] }).walls ?? [];

/** the walls a stage's solid ledges stand as: each side face of a solid box, facing out */
export function wallsFromLedges(ledges: readonly Ledge[], solidThick = 0.4): WallLike[] {
  const out: WallLike[] = [];
  for (const L of ledges) {
    if (!L.solid) continue;
    const t = L.thick ?? solidThick;
    if (t < 0.5) continue;               // (a thin slab is a platform's edge, not a wall to kick off)
    out.push({ id: `${L.id}.l`, s: L.x0, side: -1, y0: L.y - t, y1: L.y, climb: true });
    out.push({ id: `${L.id}.r`, s: L.x1, side: 1, y0: L.y - t, y1: L.y, climb: true });
  }
  return out;
}

export function fallbackArena(world: string, stage: StagePlane): Arena {
  const tops = stage.ledges.map((L) => L.y);
  const floor = stage.ground ?? Math.min(...tops, 0);
  const high = Math.max(floor, ...tops.map((y, i) => y + (stage.ledges[i].bob ?? 0)));
  // the round's two starts first (the stage's own spawns), then a point on every ledge wide enough, then the floor's ends
  const spawns: [number, number][] = stage.spawns.slice(0, 2).map(([s, y]) => [s, y]);
  for (const L of stage.ledges) if (L.x1 - L.x0 >= 0.8) spawns.push([(L.x0 + L.x1) / 2, L.y]);
  if (stage.ground != null) for (const s of [-1, 1]) spawns.push([s * Math.max(0.5, stage.halfWidth - 1.2), stage.ground]);
  while (spawns.length < 4) spawns.push([(spawns.length % 2 ? 1 : -1) * 1.5, floor]);
  // the duel's own copy of the plane: its walls, and spawns the duel may move (Character re-forms at spawns[seat])
  const plane: StagePlane & { walls: WallLike[] } = {
    ...stage, id: `duel.${stage.id}`, ledges: stage.ledges, spawns: spawns.slice(0, 2).map(([s, y]) => [s, y]),
    walls: [...wallsOf(stage), ...wallsFromLedges(stage.ledges)],
  };
  return {
    world, plane, spawns,
    bounds: { s0: -stage.halfWidth, s1: stage.halfWidth, yKill: (stage.ground != null ? stage.ground : Math.min(...tops)) - 2.2, yTop: high + 3.5 },
  };
}
