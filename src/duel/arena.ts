// The duel's arenas (docs/design/duel.md, "The arena", as the owner corrected it): per world, a 3D play space (a circle
// on the ground and a height: leaving it sideways meets a soft wall, falling below yKill is a KO), the spawns bodies
// (re)form at, the pieces the duel adds to climb and kick off, and the stage plane through the space for the 2D lock
// (with its ledges and walls). The arena work fills it per world (arenas.register in each world's own data); until a
// world has one, the duel builds a fallback from the world's own stage, floor and solids (fallback.ts).
//
// (This is the contract's bare registry, written by the duel's own work so the mode runs; the arena work's arena.ts
// replaces it when the two are joined.)
import type { StagePlane } from '../engine/camera';
import type { Solid } from '../worlds/solids';

export interface Arena {
  /** the world id */
  world: string;
  /** the 3D play space: leaving it sideways is a soft wall, falling below yKill is a KO */
  space: { center: [number, number, number]; radius: number; yKill: number; yTop: number };
  /** where bodies (re)form, in 3D, at least 4, spread out (the first two: the round's starts, seat 1 and seat 2) */
  spawns: [number, number, number][];
  /** extra climbable and standable geometry the duel adds to the world (also in World.solids while the duel is on) */
  pieces?: Solid[];
  /** the stage plane through the space for the 2D lock, with its ledges and walls */
  plane: StagePlane;
  camera?: { minDist?: number; maxDist?: number; lens?: number };
}

const ARENAS = new Map<string, Arena>();

export const arenas = {
  register(a: Arena) { ARENAS.set(a.world, a); },
  all(): Arena[] { return [...ARENAS.values()]; },
};

export function arenaFor(world: string): Arena | null { return ARENAS.get(world) ?? null; }
