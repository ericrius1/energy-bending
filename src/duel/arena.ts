// The duel's arenas: one per world, a 3D play space about 10 to 14 m round, dense with things to climb, kick off, stand on
// and fall from, built from what the world has there (columns, trunks, blades, slabs) and matter added in its own kind
// (broken drums and lintels in the temple, low branches and logs in the redwoods, crystal
// shelves and beams in the geode, stepping stones and ice floes in the Pool). Each world's folder builds its own
// (`<world>/arena.ts`) from the one description it draws the added matter from, and registers it from its index.ts:
// `arenas.register(arena)`, read back with `arenaFor(worldId)`. docs/design/duel.md has the contract.
//
// An arena is data:
//   space   the play space (a circle on the ground and a height): leaving it sideways is a soft wall, falling below
//           yKill is a KO. Every arena has drops: holes in its floor (or gaps between its stones) down past yKill.
//   spawns  3D points a body (re)forms at, spread round the space, each standing on something.
//   pieces  the solids the duel adds (src/worlds/solids.ts boxes and capsules), also in World.solids while the duel is
//           on: their vertical faces are walls in 3D, their tops are ground (`groundUnder` finds them).
//   plane   the stage plane through the space for the 2D lock, its ledges and walls those of the pieces and the world's
//           own stage it crosses (`slicePlane` cuts them from the same solids), with the drops in its floor.
//   camera  the duel camera's range.
// Heights follow the body's reach: a jump is 2 m, a jump and the air jump 3.5 m.
//
// The added matter is drawn only in the duel: `showArena(worldId)` is the switch the duel turns on (`showArena(null)`
// off). While it is on, that world draws its arena's pieces, lists them in `World.solids` (the camera, the near fade,
// the movement's walls), opens its drops (its `groundAt` falls away there; a world whose backdrop draws the floor opens
// it there too), and the arena's rim light (arena-layer.ts) marks the tops a body can stand on and the plane's walls.
import type { Ledge, StagePlane, Wall } from '../engine/camera';
import { box, cylinder, type Solid } from '../worlds/solids';
import type { Hazard } from './hazards';

export type { Wall };
type V3 = [number, number, number];

export interface Arena {
  /** the world id */
  world: string;
  /** the 3D play space: where the duel happens in free movement (a circle on the ground plus a height); leaving it
   *  sideways is a soft wall, falling below yKill is a KO */
  space: { center: V3; radius: number; yKill: number; yTop: number };
  /** where bodies (re)form, in 3D, at least 4, spread out */
  spawns: V3[];
  /** extra climbable and standable geometry the duel adds to the world (also in World.solids while the duel is on) */
  pieces?: Solid[];
  /** the stage plane through the space for the 2D lock, with its ledges and walls */
  plane: StagePlane;
  /** the duel camera's range: as near as it comes, as far as it may stand (in place of the world's room while the duel
   *  is on: at that distance the whole plane's stage is in frame with `lens` or a little wider), the lens it prefers
   *  (degrees, top to bottom), and (beyond the contract) the lowest height the lock is worth framing */
  camera?: { minDist?: number; maxDist?: number; lens?: number; low?: number };
  /** (beyond the contract) the holes in the floor: on the plane from s0 to s1, reaching `behind` and `front` off it */
  drops?: Drop[];
  /** (beyond the contract) the rim light on what can be stood on and slid on, in the world's palette: linear rgb */
  rim?: [number, number, number];
  /** (beyond the contract) the outlines of the tops a body stands on, as closed loops, for an arena whose solids are
   *  rough stand-ins for what is drawn (columns drawn round, stood in for as boxes): the rim light follows these in place of
   *  the solids' own top edges */
  outlines?: V3[][];
  /** (beyond the contract, phase 3) the arena's gentle hazard, nature's own (hazards.ts): the temple's tide, the
   *  redwoods' wind, the Pool's swell, the geode's hum; `hazard.on` its switch */
  hazard?: Hazard;
}

const byWorld = new Map<string, Arena>();

/** the arenas, one per world (each world's index.ts registers its own) */
export const arenas = {
  register(a: Arena): Arena {
    if (byWorld.has(a.world)) throw new Error(`arena for '${a.world}' is registered twice`);
    byWorld.set(a.world, a);
    return a;
  },
  all(): Arena[] { return [...byWorld.values()]; },
  ids(): string[] { return [...byWorld.keys()]; },
};

/** the arena of a world, or null where there is none */
export function arenaFor(worldId: string): Arena | null { return byWorld.get(worldId) ?? null; }

// ---------------------------------------------------------------- the switch

let shown: string | null = null;
const watchers: ((world: string | null) => void)[] = [];

/** the duel shows a world's arena (its pieces, its drops, its rim light), or none (null: the jogo's worlds and the films
 *  as they were) */
export function showArena(world: string | null) {
  if (world === shown) return;
  shown = world;
  for (const w of watchers) w(world);
}
/** whether this world's arena is shown now */
export function arenaShown(world: string) { return shown === world; }
/** the world whose arena is shown, or null */
export function shownArena() { return shown; }
/** be told when the switch changes (a world that has to move something: the redwoods' lanterns) */
export function onArena(fn: (world: string | null) => void) { watchers.push(fn); }

// ---------------------------------------------------------------- drops

/** a hole in the floor while the arena is shown: from s0 to s1 along the plane, from `behind` metres behind it to `front`
 *  in front (toward the lock's camera), `deep` metres down. Its world draws its sides and bottom (or, the Pool, has
 *  nothing there to begin with) and its `groundAt` falls away inside it */
export interface Drop { s0: number; s1: number; behind: number; front: number; deep: number }

/** the plane's coordinates of a world point: s along it, t toward the camera (planeNormal) */
export function planeST(plane: StagePlane, x: number, z: number): [number, number] {
  const dx = x - plane.origin[0], dz = z - plane.origin[2];
  return [dx * plane.right[0] + dz * plane.right[2], -dx * plane.right[2] + dz * plane.right[0]];
}

/** whether (x, z) is over one of the drops */
export function inDrop(plane: StagePlane, drops: readonly Drop[], x: number, z: number) {
  const [s, t] = planeST(plane, x, z);
  return drops.some((d) => s > d.s0 && s < d.s1 && t > -d.behind && t < d.front);
}

/** the drops as a world's light uniform takes them: (s0, -behind, s1, front) each in the plane's coordinates, and the
 *  plane's frame (origin x, z, right x, z); unused or hidden drops are empty */
export function dropsUniform(plane: StagePlane, drops: readonly Drop[], on: boolean, n = 2) {
  const rects: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const d = drops[i];
    rects.push(on && d ? [d.s0, -d.behind, d.s1, d.front] : [0, 0, 0, 0]);
  }
  return { rects, frame: [plane.origin[0], plane.origin[2], plane.right[0], plane.right[2]] as [number, number, number, number] };
}

// ---------------------------------------------------------------- solids: tops and footprints

/** a box's axis nearest up (0, 1, 2) and how upright it is (1: exactly) */
function upAxis(s: Extract<Solid, { kind: 'box' }>): [number, number] {
  const ys = [Math.abs(s.x[1]), Math.abs(s.y[1]), Math.abs(s.z[1])];
  const k = ys.indexOf(Math.max(...ys));
  return [k, ys[k]];
}

/** the top of a solid over (x, z) (its highest point there, for a body to stand on), or -Infinity where it isn't over
 *  that point. Boxes standing square (any turn about up), upright cylinders, and lying capsules (a log, a bough, a
 *  column on its side: the top of its round there); a box tipped more than about 10° has no top a body keeps to */
export function topAt(s: Solid, x: number, z: number, pad = 0.03): number {
  if (s.kind === 'box') {
    const [k, up] = upAxis(s);
    if (up < 0.985) return -Infinity;
    const axes = [s.x, s.y, s.z], px = x - s.c[0], pz = z - s.c[2];
    for (let i = 0; i < 3; i++) {
      if (i === k) continue;
      const a = axes[i], l = Math.hypot(a[0], a[2]) || 1;
      if (Math.abs((px * a[0] + pz * a[2]) / l) > s.h[i] * l + pad) return -Infinity;
    }
    return s.c[1] + s.h[k];
  }
  const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], dz = s.b[2] - s.a[2], L2 = dx * dx + dz * dz;
  // (a leaning capsule, a crystal point, a sloping bough, has no top a body keeps to)
  if (L2 >= 1e-4 && Math.abs(dy) > 0.25 * Math.sqrt(L2)) return -Infinity;
  const u = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (z - s.a[2]) * dz) / L2)) : 0;
  const qx = s.a[0] + dx * u - x, qz = s.a[2] + dz * u - z, d2 = qx * qx + qz * qz;
  if (d2 >= (s.r + pad) * (s.r + pad)) return -Infinity;
  const y = s.a[1] + dy * u;
  // (upright: a flat top at the end, as `cylinder` makes a drum; lying: the round's top)
  if (L2 < 1e-4 && Math.abs(dy) > 1e-3) return Math.max(s.a[1], s.b[1]) + s.r;
  return y + Math.sqrt(Math.max(0, s.r * s.r - d2));
}

/** a drum standing from `foot` up to `top` as a solid whose top is its flat top (`cylinder` for a tall one; a squat one,
 *  which a capsule can't hold, as a box of about its girth) */
export function drumSolid(foot: [number, number, number], top: number, r: number): Solid {
  const h = top - foot[1];
  if (h >= 2 * r + 0.02) return cylinder(foot, [foot[0], top, foot[2]], r);
  return box([foot[0], foot[1] + h / 2, foot[2]], [r * 0.86, h / 2, r * 0.86]);
}

/** the ground a body at (x, y, z) in free 3D stands on: the highest top of any solid over (x, z) no higher than a step
 *  above its feet (`step`), else `floor` (the world's groundAt). What the movement needs from the pieces and the world's
 *  own solids to stand on their tops; their vertical faces are its walls */
export function groundUnder(solids: readonly Solid[], x: number, z: number, y: number, floor: number, step = 0.35) {
  let g = floor;
  for (const s of solids) {
    const t = topAt(s, x, z);
    if (t > g && t <= y + step) g = t;
  }
  return g;
}

/** a solid's extent across the stage plane: where it crosses t = 0, the s it spans there, and its bottom and top there;
 *  null where it doesn't cross */
export function crossing(plane: StagePlane, s: Solid): { s0: number; s1: number; y0: number; y1: number } | null {
  if (s.kind === 'box') {
    const [k] = upAxis(s);
    const axes = [s.x, s.y, s.z], hor = [0, 1, 2].filter((i) => i !== k);
    // the footprint's corners in (s, t), and the line t = 0 through them
    const c = planeST(plane, s.c[0], s.c[2]);
    const corners: [number, number][] = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const A = axes[hor[0]], B = axes[hor[1]];
      const x = s.c[0] + A[0] * s.h[hor[0]] * a + B[0] * s.h[hor[1]] * b, z = s.c[2] + A[2] * s.h[hor[0]] * a + B[2] * s.h[hor[1]] * b;
      corners.push(planeST(plane, x, z));
    }
    corners.sort((p, q) => Math.atan2(p[1] - c[1], p[0] - c[0]) - Math.atan2(q[1] - c[1], q[0] - c[0]));
    let s0 = Infinity, s1 = -Infinity;
    for (let i = 0; i < 4; i++) {
      const p = corners[i], q = corners[(i + 1) % 4];
      if ((p[1] <= 0 && q[1] >= 0) || (p[1] >= 0 && q[1] <= 0)) {
        const u = Math.abs(q[1] - p[1]) < 1e-9 ? 0 : -p[1] / (q[1] - p[1]);
        const sx = p[0] + (q[0] - p[0]) * u;
        s0 = Math.min(s0, sx); s1 = Math.max(s1, sx);
      }
    }
    if (!(s1 > s0)) return null;
    const vy = Math.abs(axes[k][1]) * s.h[k];
    return { s0, s1, y0: s.c[1] - vy, y1: s.c[1] + vy };
  }
  const a = planeST(plane, s.a[0], s.a[2]), b = planeST(plane, s.b[0], s.b[2]);
  let s0 = Infinity, s1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const u = i / N, ss = a[0] + (b[0] - a[0]) * u, t = a[1] + (b[1] - a[1]) * u, y = s.a[1] + (s.b[1] - s.a[1]) * u;
    if (Math.abs(t) >= s.r) continue;
    const w = Math.sqrt(s.r * s.r - t * t);
    s0 = Math.min(s0, ss - w); s1 = Math.max(s1, ss + w);
    y0 = Math.min(y0, y - w); y1 = Math.max(y1, y + w);
  }
  if (!(s1 > s0)) return null;
  // (an upright cylinder's ends are flat at its foot and top: `cylinder` pulled the capsule's in by r)
  const upright = Math.hypot(s.b[0] - s.a[0], s.b[2] - s.a[2]) < 1e-3;
  if (upright) { y0 = Math.min(s.a[1], s.b[1]) - s.r; y1 = Math.max(s.a[1], s.b[1]) + s.r; }
  return { s0, s1, y0, y1 };
}

/** whether a solid has a top a body keeps to (topAt's rule: a box standing square, an upright drum, a lying capsule) */
function flatTop(s: Solid) {
  if (s.kind === 'box') return upAxis(s)[1] >= 0.985;
  const dx = s.b[0] - s.a[0], dz = s.b[2] - s.a[2], L2 = dx * dx + dz * dz;
  return L2 < 1e-4 || Math.abs(s.b[1] - s.a[1]) <= 0.25 * Math.sqrt(L2);
}

/** a group of solids that is one thing on the plane (a stone of many columns, a drum stack, a log of many pieces): its
 *  crossing as one ledge on top (if wide enough: a body stands on it) and a wall at each end (if tall enough) */
export interface PieceGroup { id: string; solids: Solid[]; oneWay?: boolean; climb?: boolean; noTop?: boolean }

/** the ledges and walls a set of groups gives the stage plane where they cross it */
export function slicePlane(plane: StagePlane, groups: readonly PieceGroup[]): { ledges: Ledge[]; walls: Wall[] } {
  const ledges: Ledge[] = [], walls: Wall[] = [];
  for (const g of groups) {
    const cs = g.solids.map((s) => ({ c: crossing(plane, s), flat: flatTop(s) })).filter((c) => !!c.c && c.c.s1 > -plane.halfWidth && c.c.s0 < plane.halfWidth) as { c: NonNullable<ReturnType<typeof crossing>>; flat: boolean }[];
    // (only what lies between the plane's ends: a bough's collar in its trunk past the end is no part of its ledge)
    for (const c of cs) { c.c.s0 = Math.max(c.c.s0, -plane.halfWidth); c.c.s1 = Math.min(c.c.s1, plane.halfWidth); }
    if (!cs.length) continue;
    const s0 = Math.min(...cs.map((c) => c.c.s0)), s1 = Math.max(...cs.map((c) => c.c.s1));
    const y0 = Math.min(...cs.map((c) => c.c.y0)), y1 = Math.max(...cs.map((c) => c.c.y1));
    // (the ledge: what of it has a top a body keeps to, a bough's level run, not its collar or its lifting tip)
    const tops = cs.filter((c) => c.flat);
    if (!g.noTop && tops.length) {
      const t0 = Math.min(...tops.map((c) => c.c.s0)), t1 = Math.max(...tops.map((c) => c.c.s1)), ty = Math.max(...tops.map((c) => c.c.y1));
      const ly0 = Math.min(...tops.map((c) => c.c.y0));
      if (t1 - t0 >= 0.5) ledges.push({ id: g.id, x0: t0, x1: t1, y: ty, ...(g.oneWay ? { thick: Math.min(0.6, ty - ly0) } : { solid: true, thick: ty - y0 }) });
    }
    if (y1 - y0 >= 0.6) walls.push(...sides(g.id, s0, s1, y0, y1, g.climb ?? true));
  }
  return { ledges, walls };
}

// ---------------------------------------------------------------- building the plane

/** the two faces of something standing on the plane from s0 to s1, y0 to y1 (a column, a trunk, a block's sides): the
 *  left face looks toward -s, the right toward +s */
export function sides(id: string, s0: number, s1: number, y0: number, y1: number, climb = true): Wall[] {
  const c = climb ? {} : { climb: false };
  return [{ id: `${id}.l`, s: s0, side: -1, y0, y1, ...c }, { id: `${id}.r`, s: s1, side: 1, y0, y1, ...c }];
}

/** a floor with drops in it: solid ledges from s0 to s1 at y (each `deep` thick, down to the kill floor), with gaps at
 *  each [a, b] of `drops`; the drops' sides are walls (a body that falls in can still kick its way out) */
export function floorWithDrops(id: string, s0: number, s1: number, y: number, deep: number, drops: [number, number][]) {
  const ledges: Ledge[] = [], walls: Wall[] = [];
  const cuts = [...drops].sort((a, b) => a[0] - b[0]);
  let x = s0;
  cuts.forEach(([a, b], k) => {
    if (a > x) ledges.push({ id: `${id}${ledges.length}`, x0: x, x1: a, y, solid: true, thick: deep });
    walls.push({ id: `${id}.drop${k}.l`, s: a, side: 1, y0: y - deep, y1: y }, { id: `${id}.drop${k}.r`, s: b, side: -1, y0: y - deep, y1: y });
    x = b;
  });
  if (s1 > x) ledges.push({ id: `${id}${ledges.length}`, x0: x, x1: s1, y, solid: true, thick: deep });
  return { ledges, walls };
}

/** walls on one line facing one way whose spans meet (a pillar's face going on down a drop's side) as one wall, and
 *  walls that lie inside a solid ledge's box or beyond the plane's ends left out */
export function mergeWalls(walls: Wall[], halfWidth = Infinity): Wall[] {
  const out: Wall[] = [];
  for (const w of [...walls].sort((a, b) => a.side - b.side || a.s - b.s || a.y0 - b.y0)) {
    if (Math.abs(w.s) > halfWidth - 0.05) continue;
    const last = out[out.length - 1];
    if (last && last.side === w.side && Math.abs(last.s - w.s) < 0.03 && w.y0 <= last.y1 + 0.05 && (last.climb ?? true) === (w.climb ?? true)) {
      last.y1 = Math.max(last.y1, w.y1);
      last.y0 = Math.min(last.y0, w.y0);
      last.id = `${last.id}+${w.id}`;
    } else out.push({ ...w });
  }
  return out;
}

// ---------------------------------------------------------------- checking one

/** the body's reach (m): a jump, a jump and the air jump, how far across a jump carries at a run */
export const REACH = { jump: 2.0, double: 3.5, across: 3.4 };

/** the standable tops of a set of solids, sampled on a grid (x, z, top): what a body can land on */
export function standPoints(solids: readonly Solid[], step = 0.35) {
  const out: V3[] = [];
  for (const s of solids) {
    let lo: [number, number], hi: [number, number];
    if (s.kind === 'box') {
      const e = Math.hypot(...s.h);
      lo = [s.c[0] - e, s.c[2] - e]; hi = [s.c[0] + e, s.c[2] + e];
    } else {
      lo = [Math.min(s.a[0], s.b[0]) - s.r, Math.min(s.a[2], s.b[2]) - s.r]; hi = [Math.max(s.a[0], s.b[0]) + s.r, Math.max(s.a[2], s.b[2]) + s.r];
    }
    for (let x = lo[0] + step / 2; x < hi[0]; x += step) for (let z = lo[1] + step / 2; z < hi[1]; z += step) {
      const t = topAt(s, x, z);
      // (only where it is this solid's top, not under another solid lying on it)
      if (t > -Infinity && !solids.some((o) => o !== s && topAt(o, x, z) > t + 0.05 && bottomAt(o, x, z) < t + 1.5)) out.push([x, z, t]);
    }
  }
  return out;
}
/** the bottom of a solid under (x, z), or Infinity where it isn't over that point */
export function bottomAt(s: Solid, x: number, z: number) {
  if (topAt(s, x, z) === -Infinity) return Infinity;
  if (s.kind === 'box') { const [k] = upAxis(s); return s.c[1] - Math.abs([s.x, s.y, s.z][k][1]) * s.h[k]; }
  return Math.min(s.a[1], s.b[1]) - s.r;
}

/** what is wrong with an arena (empty: nothing). In 3D: the space's size, the spawns (at least 4, spread, each on
 *  something), every piece's top reachable from the ground by jumps, and something to jump onto or kick off within a
 *  second's run of anywhere. On the plane: its ledges inside its ends and reachable, its walls, a couple of drops.
 *  `ground(x, z)` is the world's floor there (null: none, the Pool's deep water), `solids` everything
 *  solid while the arena is shown (the world's own and the pieces) */
export function checkArena(a: Arena, ground: (x: number, z: number) => number | null, solids: readonly Solid[]): string[] {
  const out: string[] = [], S = a.space, P = a.plane, W = P.walls ?? [];
  const tag = a.world;
  if (S.radius < 9.5 || S.radius > 14.5) out.push(`${tag}: space radius ${S.radius} (10 to 14 wanted)`);
  // the spawns
  if (a.spawns.length < 4) out.push(`${tag}: ${a.spawns.length} spawns (at least 4)`);
  for (const p of a.spawns) {
    const f = ground(p[0], p[2]);
    const g = groundUnder(solids, p[0], p[2], p[1], f ?? -Infinity, 0.05);
    if (Math.abs(g - p[1]) > 0.06) out.push(`${tag}: spawn [${p.map((v) => v.toFixed(2))}] stands on nothing (ground there ${g.toFixed(2)})`);
    if (Math.hypot(p[0] - S.center[0], p[2] - S.center[2]) > S.radius) out.push(`${tag}: spawn [${p}] is outside the space`);
  }
  let near = Infinity;
  for (let i = 0; i < a.spawns.length; i++) for (let j = i + 1; j < a.spawns.length; j++) near = Math.min(near, Math.hypot(a.spawns[i][0] - a.spawns[j][0], a.spawns[i][1] - a.spawns[j][1], a.spawns[i][2] - a.spawns[j][2]));
  if (near < 3) out.push(`${tag}: two spawns only ${near.toFixed(1)} m apart`);
  // the pieces inside the space
  for (const s of a.pieces ?? []) {
    const c = s.kind === 'box' ? s.c : s.a;
    if (Math.hypot(c[0] - S.center[0], c[2] - S.center[2]) > S.radius + 2.5) out.push(`${tag}: a piece at [${c.map((v) => v.toFixed(1))}] is outside the space`);
  }
  // reachable: from the floor, up by at most a jump and the air jump, across at most what a jump carries
  const tops = standPoints(solids).filter(([x, z, t]) => Math.hypot(x - S.center[0], z - S.center[2]) < S.radius + 1 && t < S.yTop);
  const floorPts: V3[] = [];
  for (let x = -S.radius; x <= S.radius; x += 0.5) for (let z = -S.radius; z <= S.radius; z += 0.5) {
    if (Math.hypot(x, z) > S.radius) continue;
    const X = S.center[0] + x, Z = S.center[2] + z, f = ground(X, Z);
    if (f !== null && f > S.yKill && !solids.some((s) => topAt(s, X, Z) > f + 0.05 && bottomAt(s, X, Z) < f + 1.5)) floorPts.push([X, Z, f]);
  }
  const all = [...floorPts, ...tops];
  const reached = new Uint8Array(all.length);
  const queue: number[] = [];
  const start = floorPts.length ? floorPts.map((_, i) => i) : all.map((p, i) => [p, i] as const).filter(([p]) => a.spawns.some((s) => Math.hypot(s[0] - p[0], s[2] - p[1]) < 0.4 && Math.abs(s[1] - p[2]) < 0.1)).map(([, i]) => i);
  for (const i of start) { reached[i] = 1; queue.push(i); }
  // (a grid of cells for the neighbour search)
  const cell = new Map<string, number[]>(), key = (x: number, z: number) => `${Math.floor(x / 3.5)},${Math.floor(z / 3.5)}`;
  all.forEach((p, i) => { const k = key(p[0], p[1]); (cell.get(k) ?? cell.set(k, []).get(k)!).push(i); });
  while (queue.length) {
    const i = queue.pop()!, p = all[i], cx = Math.floor(p[0] / 3.5), cz = Math.floor(p[1] / 3.5);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const j of cell.get(`${cx + dx},${cz + dz}`) ?? []) {
      if (reached[j]) continue;
      const q = all[j];
      if (q[2] - p[2] <= REACH.double && Math.hypot(q[0] - p[0], q[1] - p[1]) <= REACH.across) { reached[j] = 1; queue.push(j); }
    }
  }
  const missed = tops.filter((_, i) => !reached[floorPts.length + i] && _[2] > -50);
  if (missed.length > tops.length * 0.02) out.push(`${tag}: ${missed.length} of ${tops.length} standable points can't be reached by jumps (e.g. [${missed[0].map((v) => v.toFixed(1))}])`);
  // dense: from any point a body stands on (below the space's top tier), something to jump onto (a top higher by more
  // than half a metre) or kick off (a side at body height) within a second's run (4 m)
  const stands = [...floorPts, ...tops.filter((_, i) => reached[floorPts.length + i])].filter((p) => p[2] < S.yTop - 3.5);
  const spans = solids.map((s) => {
    const c = s.kind === 'box' ? s.c : [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2];
    const e = s.kind === 'box' ? Math.hypot(s.h[0], s.h[1], s.h[2]) : s.r + Math.hypot(s.b[0] - s.a[0], s.b[2] - s.a[2]) / 2;
    const lo = s.kind === 'box' ? s.c[1] - e : Math.min(s.a[1], s.b[1]) - s.r, hi = s.kind === 'box' ? s.c[1] + e : Math.max(s.a[1], s.b[1]) + s.r;
    return { x: c[0], z: c[2], e, lo, hi };
  });
  let lonely = 0;
  for (const p of stands) {
    const ok = spans.some((q) => Math.hypot(q.x - p[0], q.z - p[1]) - q.e < 4 && q.hi > p[2] + 0.5 && q.lo < p[2] + 1.4);
    if (!ok) lonely++;
  }
  if (lonely > stands.length * 0.05) out.push(`${tag}: ${lonely} of ${stands.length} places a body stands have nothing to jump onto or kick off within 4 m`);
  // the plane
  const L = P.ledges, eps = 1e-6;
  for (const l of L) {
    if (l.x0 < -P.halfWidth - eps || l.x1 > P.halfWidth + eps) out.push(`${tag}: ledge ${l.id} (${l.x0.toFixed(2)}..${l.x1.toFixed(2)}) leaves the plane`);
    if (l.x1 - l.x0 < 0.5) out.push(`${tag}: ledge ${l.id} is only ${(l.x1 - l.x0).toFixed(2)} m wide`);
  }
  for (const w of W) {
    if (!(w.y1 > w.y0)) out.push(`${tag}: wall ${w.id} spans ${w.y0}..${w.y1}`);
    if (Math.abs(w.s) > P.halfWidth + eps) out.push(`${tag}: wall ${w.id} at ${w.s} leaves the plane`);
  }
  const ids = new Set<string>();
  for (const x of [...L, ...W]) { if (ids.has(x.id)) out.push(`${tag}: id ${x.id} twice`); ids.add(x.id); }
  for (const [s, y] of P.spawns) if (!((P.ground !== null && Math.abs(y - P.ground) < 0.02) || L.some((l) => s >= l.x0 - 0.05 && s <= l.x1 + 0.05 && Math.abs(l.y - y) < 0.02))) out.push(`${tag}: the plane's spawn [${s}, ${y}] stands on nothing`);
  const floors = L.filter((l) => l.y <= 0.6);
  let gaps = 0;
  if (P.ground === null) for (let s = -P.halfWidth + 0.25; s < P.halfWidth - 0.25; s += 0.05) if (!floors.some((l) => s >= l.x0 && s <= l.x1)) { gaps++; s += 0.5; }
  if (gaps < 2) out.push(`${tag}: ${gaps} drop(s) in the plane's floor (a couple wanted)`);
  const lowest = Math.min(...floors.map((l) => l.y), P.ground ?? Infinity);
  if (!(S.yKill < lowest - 0.8)) out.push(`${tag}: the kill floor ${S.yKill} is not below the plane's lowest floor ${lowest}`);
  const from = floors.map((l) => ({ x0: l.x0, x1: l.x1, y: l.y - (l.bob ?? 0) }));
  const seen = new Set<Ledge>(floors);
  for (let grew = true; grew;) {
    grew = false;
    for (const l of L) {
      if (seen.has(l)) continue;
      if (from.some((f) => l.y + (l.bob ?? 0) - f.y <= REACH.double && Math.max(l.x0 - f.x1, f.x0 - l.x1, 0) <= REACH.across)) { seen.add(l); from.push({ x0: l.x0, x1: l.x1, y: l.y - (l.bob ?? 0) }); grew = true; }
    }
  }
  for (const l of L) if (!seen.has(l)) out.push(`${tag}: plane ledge ${l.id} at ${l.y.toFixed(2)} can't be reached by jumps`);
  return out;
}

/** one line about an arena: its space, pieces, the plane's walls, platforms and spawns */
export function describeArena(a: Arena) {
  const L = a.plane.ledges, W = a.plane.walls ?? [];
  const up = L.filter((l) => l.y > 0.6);
  const top = Math.max(...L.map((l) => l.y));
  return `${a.world}: a space ${(a.space.radius * 2).toFixed(0)} m across (kill floor ${a.space.yKill}, top ${a.space.yTop}), ${a.pieces?.length ?? 0} piece solids, ` +
    `${a.spawns.length} spawns; its lock plane ${(a.plane.halfWidth * 2).toFixed(1)} m wide with ${W.length} walls (+ its 2 ends), ` +
    `${up.length} platforms (${up.map((l) => l.y.toFixed(1)).sort((p, q) => +p - +q).join(', ')}; top ${top.toFixed(1)}), ${a.drops?.length ?? 0} drops`;
}
