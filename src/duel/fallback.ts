// A world's duel arena until the arena work gives it one (arena.ts), built from what the world already has: the play
// space a circle round its stage's middle (as far as its room allows, at most 7.5 m), the kill floor a couple of metres
// under the lowest thing to stand on (above the world's own fall-out, where it has one: the forge), spawns where the
// stage puts its players and round the space wherever the floor stands clear of the world's solids, and the stage plane
// as it is (the ledges the world already draws) with walls on the sides of its solid ledges, for the lock. Pure.
import { distTo, planePoint, type Ledge, type StagePlane } from '../engine/camera';
import type { Solid } from '../worlds/solids';
import type { Arena } from './arena';

type V3 = [number, number, number];

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

/** what the fallback reads of a world */
export interface WorldLike {
  id: string;
  groundAt(x: number, z: number): number;
  room?: number;
  fallY?: number;
  solids?: readonly Solid[];
}

export function fallbackArena(w: WorldLike, stage: StagePlane): Arena {
  const tops = stage.ledges.map((L) => L.y);
  const floor = stage.ground ?? Math.min(...tops, 0);
  const o = stage.origin;
  const center: V3 = [o[0], o[1] + floor, o[2]];
  const radius = Math.min(7.5, Math.max(4, (w.room ?? 8) * 0.6));
  const lowest = stage.ground ?? Math.min(...tops);
  const yKill = o[1] + (w.fallY != null ? Math.max(w.fallY + 1, lowest - 2.5) : lowest - 2.2);
  const high = Math.max(floor, ...stage.ledges.map((L) => L.y + (L.bob ?? 0)));
  // spawns: the stage's own two first (the round's starts), then round the space where the floor stands clear
  const clear = (p: V3) => !(w.solids ?? []).some((s) => distTo(s, [p[0], p[1] + 1.0, p[2]]) < 0.55);
  const spawns: V3[] = stage.spawns.slice(0, 2).map(([s, y]) => { const p = planePoint(stage, s, y); return [p[0], w.groundAt(p[0], p[2]), p[2]] as V3; });
  for (let i = 0; i < 12 && spawns.length < 8; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.3, r = radius * (i % 2 ? 0.45 : 0.62);
    const x = center[0] + Math.cos(a) * r, z = center[2] + Math.sin(a) * r, y = w.groundAt(x, z);
    const p: V3 = [x, y, z];
    if (y > yKill + 1 && y < center[1] + 2.5 && clear(p) && spawns.every((q) => Math.hypot(q[0] - x, q[2] - z) > 1.6)) spawns.push(p);
  }
  for (const L of stage.ledges) if (spawns.length < 4 && L.x1 - L.x0 >= 0.8) spawns.push(planePoint(stage, (L.x0 + L.x1) / 2, L.y));
  // the duel's own copy of the plane: its walls, and spawns the duel may move (Character re-forms at spawns[seat])
  const plane: StagePlane & { walls: WallLike[] } = {
    ...stage, id: `duel.${stage.id}`, spawns: stage.spawns.slice(0, 2).map(([s, y]) => [s, y]),
    walls: [...wallsOf(stage), ...wallsFromLedges(stage.ledges)],
  };
  return { world: w.id, space: { center, radius, yKill, yTop: o[1] + high + 4 }, spawns, plane };
}
