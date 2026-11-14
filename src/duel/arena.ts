// The duel's arenas: per world, the stage plane the duel locks to (with its ledges and walls), where bodies (re)form,
// the bounds (falling below yKill is a KO) and the camera's taste. The contract in docs/design/duel.md, "The arena";
// the arena work fills it per world (arenas.register in each world's own data). Until a world has one, the duel builds
// a fallback from the world's own stage plane (fallback.ts).
//
// (This is the contract's bare registry, written by the duel's own work so the mode runs; the arena work's arena.ts
// replaces it when the two are joined.)
import type { StagePlane } from '../engine/camera';

export interface Arena {
  /** the world id */
  world: string;
  /** the duel's stage plane, with its ledges and walls */
  plane: StagePlane;
  /** [s, y] points to (re)form at, at least 4 */
  spawns: [number, number][];
  /** falling below yKill is a KO */
  bounds: { s0: number; s1: number; yKill: number; yTop: number };
  camera?: { minDist?: number; maxDist?: number; lens?: number };
}

const ARENAS = new Map<string, Arena>();

export const arenas = {
  register(a: Arena) { ARENAS.set(a.world, a); },
  all(): Arena[] { return [...ARENAS.values()]; },
};

export function arenaFor(world: string): Arena | null { return ARENAS.get(world) ?? null; }
