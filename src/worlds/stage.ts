// Stage planes as data, for every world: a vertical plane the view can lock to, with ledges in its own coordinates
// (x along `right` from `origin`, y up, metres). The body physics reads them; each world draws its ledges from the same
// description it builds the data from, so a ledge the eye can see is where the feet land. Ledges that move do so by
// `ledgeY(ledge, beat)` and the temple's water by its `tideY(beat)`: physics and drawing call the same function with the
// same beat (FrameCtx.beat.beats), so they agree.
// The types and `ledgeY` live in engine/camera.ts (the rig and the dancers' physics read them too); they are
// re-exported here so a world imports everything about stages from one place. How far back the locked camera may stand
// comes from the world's `room`; a stage may prefer its own lens.
import { ledgeY, planeNormal, type Ledge, type StagePlane } from '../engine/camera';

export { ledgeY };
export type { Ledge, StagePlane };
type V3 = [number, number, number];

/** what a world says about a stage; the rest of a StagePlane follows from it */
export interface StageDef {
  id: string;
  origin: V3;
  /** horizontal; normalised here. The camera stands on the side of right × up */
  right: V3;
  halfWidth: number;
  ground: number | null;
  ledges: Ledge[];
  spawns: [number, number][];
  /** how much of the plane above the ground the camera frames when nobody is on it (default: the highest ledge + 1.4) */
  height?: number;
  /** the lens the locked camera prefers here (degrees; default camera.lockLens) */
  lens?: number;
}

export function stagePlane(d: StageDef): StagePlane {
  const l = Math.hypot(d.right[0], d.right[2]) || 1;
  const right: V3 = [d.right[0] / l, 0, d.right[2] / l];
  const top = Math.max(0, ...d.ledges.map((x) => x.y + (x.bob ?? 0)));
  return {
    id: d.id, origin: d.origin, right, halfWidth: d.halfWidth, height: d.height ?? Math.max(3, top + 1.4),
    ground: d.ground, ledges: d.ledges, spawns: d.spawns, lens: d.lens,
  };
}

/** a point on the plane (plane x, y) in the world */
export function onPlane(p: StagePlane, x: number, y: number): V3 {
  return [p.origin[0] + p.right[0] * x, p.origin[1] + y, p.origin[2] + p.right[2] * x];
}

/** a world point in the plane's coordinates: x along it, y up, and how far in front of it (along the normal) */
export function toPlane(p: StagePlane, w: V3): [number, number, number] {
  const dx = w[0] - p.origin[0], dz = w[2] - p.origin[2], n = planeNormal(p);
  return [dx * p.right[0] + dz * p.right[2], w[1] - p.origin[1], dx * n[0] + dz * n[2]];
}

/** the spawns as world points, for World.spawns */
export function spawnsOf(p: StagePlane): V3[] {
  return p.spawns.map(([x, y]) => onPlane(p, x, y));
}
