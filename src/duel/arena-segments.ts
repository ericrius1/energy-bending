// The arena's lines as data (arena-layer.ts draws them with arena-lines.wgsl): each segment two points and a kind and a
// width, for the rim light round the tops a body can stand on and the drops, the stage plane's ledges and walls (shown as
// the lock comes in), and the debug view. Pure (no GPU), so the tests can count them.
import { planePoint } from '../engine/camera';
import type { Solid } from '../worlds/solids';
import { topAt, type Arena } from './arena';

/** floats a segment takes (two vec4f: a point and its kind, a point and its width) */
export const SEG_FLOATS = 8;
/** kinds (arena-lines.wgsl kindColour); + PLANE: a segment of the stage plane's, shown as the lock comes in */
const K = { oneWay: 0, solid: 1, wall: 2, noClimb: 3, spawn: 4, kill: 5, bounds: 6, body: 7, drop: 8 } as const;
const PLANE = 16;

type V3 = [number, number, number];

/** the edges of the tops of a set of solids where each top ends (an edge shared with a neighbour's top at the same
 *  height, a hex column's beside the next, is left out): what a body can stand on, outlined */
export function topEdges(solids: readonly Solid[], within: (x: number, z: number, y: number) => boolean): [V3, V3][] {
  const out: [V3, V3][] = [];
  const covered = (x: number, z: number, y: number, self: Solid) => solids.some((o) => o !== self && Math.abs(topAt(o, x, z) - y) < 0.08);
  const edge = (s: Solid, p: V3, q: V3, dir: [number, number]) => {
    const m: V3 = [(p[0] + q[0]) / 2, p[1], (p[2] + q[2]) / 2];
    if (!within(m[0], m[2], m[1])) return;
    if (covered(m[0] + dir[0] * 0.07, m[2] + dir[1] * 0.07, m[1] - 0.01, s)) return;
    out.push([p, q]);
  };
  for (const s of solids) {
    if (s.kind === 'box') {
      const ys = [Math.abs(s.x[1]), Math.abs(s.y[1]), Math.abs(s.z[1])], k = ys.indexOf(Math.max(...ys));
      if (ys[k] < 0.985) continue;
      const ax = [s.x, s.y, s.z], hor = [0, 1, 2].filter((i) => i !== k), A = ax[hor[0]], B = ax[hor[1]], ha = s.h[hor[0]], hb = s.h[hor[1]];
      const y = s.c[1] + s.h[k] + 0.01;
      const at = (a: number, b: number): V3 => [s.c[0] + A[0] * ha * a + B[0] * hb * b, y, s.c[2] + A[2] * ha * a + B[2] * hb * b];
      edge(s, at(-1, -1), at(1, -1), [-B[0], -B[2]]);
      edge(s, at(1, -1), at(1, 1), [A[0], A[2]]);
      edge(s, at(1, 1), at(-1, 1), [B[0], B[2]]);
      edge(s, at(-1, 1), at(-1, -1), [-A[0], -A[2]]);
    } else {
      const flat = Math.hypot(s.b[0] - s.a[0], s.b[2] - s.a[2]);
      if (flat < 1e-3) {
        // an upright drum: a ring round its flat top
        const y = Math.max(s.a[1], s.b[1]) + s.r + 0.01, n = 14;
        for (let i = 0; i < n; i++) {
          const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
          edge(s, [s.a[0] + Math.cos(a0) * s.r * 0.97, y, s.a[2] + Math.sin(a0) * s.r * 0.97], [s.a[0] + Math.cos(a1) * s.r * 0.97, y, s.a[2] + Math.sin(a1) * s.r * 0.97], [Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2)]);
        }
      } else if (Math.abs(s.b[1] - s.a[1]) / flat < 0.12) {
        // a lying log: along its top
        const p: V3 = [s.a[0], s.a[1] + s.r + 0.01, s.a[2]], q: V3 = [s.b[0], s.b[1] + s.r + 0.01, s.b[2]];
        if (within((p[0] + q[0]) / 2, (p[2] + q[2]) / 2, (p[1] + q[1]) / 2)) out.push([p, q]);
      }
    }
  }
  return out;
}

/** the segments of an arena: the rim's (first, `rim` of them) then the debug lines'; `solids`: everything solid while it
 *  is shown (the world's own and the pieces) */
export function arenaSegments(a: Arena, solids: readonly Solid[]) {
  const P = a.plane, S = a.space, rim: number[] = [], dbg: number[] = [];
  const at = (s: number, y: number): V3 => planePoint(P, s, y);
  const seg = (out: number[], p: V3, q: V3, kind: number, width: number) => out.push(...p, kind, ...q, width);
  const RW = 0.1, DW = 0.04;
  // the tops in the space a body can stand on (above the floor, below the top, inside the space)
  const within = (x: number, z: number, y: number) => y > 0.3 && y < S.yTop - 1 && Math.hypot(x - S.center[0], z - S.center[2]) < S.radius + 1.5;
  const withinLow = (x: number, z: number, y: number) => y > S.yKill + 0.5 && y < S.yTop - 1 && Math.hypot(x - S.center[0], z - S.center[2]) < S.radius + 1.5;
  for (const [p, q] of topEdges(solids, a.plane.ground === null && !(a.drops?.length) ? withinLow : within)) { seg(rim, p, q, K.solid, RW); seg(dbg, p, q, K.solid, DW * 0.7); }
  // the drops' rims
  for (const d of a.drops ?? []) {
    const n: [number, number] = [-P.right[2], P.right[0]];
    const c = (s: number, t: number): V3 => { const p = planePoint(P, s, 0.012); return [p[0] + n[0] * t, p[1], p[2] + n[1] * t]; };
    const ring: V3[] = [c(d.s0, -d.behind), c(d.s1, -d.behind), c(d.s1, d.front), c(d.s0, d.front)];
    for (let i = 0; i < 4; i++) { seg(rim, ring[i], ring[(i + 1) % 4], K.solid, RW); seg(dbg, ring[i], ring[(i + 1) % 4], K.drop, DW); }
  }
  // the stage plane's ledges and walls, as the lock comes in
  for (const l of P.ledges) if (l.y > 0.6) seg(rim, at(l.x0, l.y + 0.012), at(l.x1, l.y + 0.012), (l.solid ? K.solid : K.oneWay) + PLANE, RW);
  for (const w of P.walls ?? []) {
    if (w.climb === false) continue;
    // (a drop's side in a floor the backdrop draws has no depth to hide the ribbon behind: lit only from the floor up)
    const y0 = w.id.includes('drop') ? Math.max(w.y0, 0) : w.y0;
    if (w.y1 - y0 > 0.2) seg(rim, at(w.s, y0), at(w.s, w.y1), K.wall + PLANE, RW * 0.8);
  }
  // the debug lines: the plane (crisp, shown as the lock comes in), its kill floor and ends
  for (const l of P.ledges) {
    seg(dbg, at(l.x0, l.y), at(l.x1, l.y), (l.solid ? K.solid : K.oneWay) + PLANE, DW);
    if (l.solid) seg(dbg, at(l.x0, l.y - (l.thick ?? 0.4)), at(l.x1, l.y - (l.thick ?? 0.4)), K.solid + PLANE, DW * 0.4);
    if (l.bob) seg(dbg, at(l.x0, l.y + l.bob), at(l.x1, l.y + l.bob), (l.solid ? K.solid : K.oneWay) + PLANE, DW * 0.4);
  }
  for (const w of P.walls ?? []) {
    const kind = (w.climb === false ? K.noClimb : K.wall) + PLANE, m = (w.y0 + w.y1) / 2;
    seg(dbg, at(w.s, w.y0), at(w.s, w.y1), kind, DW);
    seg(dbg, at(w.s, m), at(w.s + w.side * 0.25, m), kind, DW);
  }
  for (const [s, y] of P.spawns) { seg(dbg, at(s - 0.3, y), at(s + 0.3, y), K.spawn + PLANE, DW * 1.5); seg(dbg, at(s, y), at(s, y + 1.7), K.body + PLANE, DW * 1.5); }
  const H = P.halfWidth;
  seg(dbg, at(-H, S.yKill), at(H, S.yKill), K.kill + PLANE, DW * 1.5);
  seg(dbg, at(-H, S.yTop), at(H, S.yTop), K.bounds + PLANE, DW);
  for (const s of [-H, H]) seg(dbg, at(s, S.yKill), at(s, S.yTop), K.bounds + PLANE, DW);
  // in 3D: the spawns (a cross and a body's height), the space at the floor and at the kill floor
  for (const p of a.spawns) {
    seg(dbg, [p[0] - 0.3, p[1] + 0.02, p[2]], [p[0] + 0.3, p[1] + 0.02, p[2]], K.spawn, DW * 1.5);
    seg(dbg, [p[0], p[1] + 0.02, p[2] - 0.3], [p[0], p[1] + 0.02, p[2] + 0.3], K.spawn, DW * 1.5);
    seg(dbg, p, [p[0], p[1] + 1.7, p[2]], K.body, DW * 1.5);
  }
  const n = 48;
  for (const [y, kind] of [[0.02, K.bounds], [S.yKill, K.kill]] as const) for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, c = S.center, R = S.radius;
    seg(dbg, [c[0] + Math.cos(a0) * R, y, c[2] + Math.sin(a0) * R], [c[0] + Math.cos(a1) * R, y, c[2] + Math.sin(a1) * R], kind, DW);
  }
  return { data: new Float32Array([...rim, ...dbg]), rim: rim.length / SEG_FLOATS, debug: dbg.length / SEG_FLOATS };
}

