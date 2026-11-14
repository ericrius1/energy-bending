// The near fade's frame test (worlds/fade.ts reads it; pure, so the duel's Node measure runs it too: duel/camprobe.ts).
// In the duel the camera stands side on to a pair dancing through a dense arena, and a piece between the eye and the
// pair (a beam of selenite at a drop's edge, a low blade, a drum, a gem pillar) can fill a near corner or a share of
// the frame that no yaw, boom or pitch clears (report 14, the second pass). Such a piece dissolves instead, its edges
// kept as a faint line of light so the arena's shape still reads.
//
// A piece is a solid, or several boxes lying side by side as one thing (the blades of a selenite shelf, the drums of a
// column): boxes turned the same way whose bounding box they nearly fill are one piece, so a shelf dissolves whole.
// Each frame a grid of rays through the lens looks for a solid within the near part of the frame (`near` of the way to
// the nearer body, at most `max` m: the duel judge's own yardstick, duel/camspace.ts); each piece it meets has its
// share of the frame and of the frame's four corners. A piece starts to dissolve when it covers `share` of the frame or
// `corner` of the corners (or is about to: the grid reaches a little past the lens and a little deeper than the near
// part), and stays dissolving while any ray still meets it a little further out (`keep`) and for `hold` seconds after:
// hysteresis, so a piece at the edge of the test doesn't flicker. Its strength eases in and out. Never what a body
// stands on, hangs from, or (on its path over the next `ahead` seconds) is about to land on: that comes back quickly
// and stays whole a moment after. The shaders take FRAME_SLOTS pieces (worlds/light.wgsl `Sight.piece`); a piece only
// starts while a slot is free, so none ever loses its slot while dissolved.
import { Solids, distTo } from '../engine/camera';
import { defineParams } from '../engine/params';
import type { Solid } from './solids';

type V3 = [number, number, number];
type Box = Extract<Solid, { kind: 'box' }>;

export const frameParams = defineParams('fadeFrame', {
  /** the frame test at all (the near fade's `on` and `frame` still rule it; only in the duel) */
  on: true,
  /** the near part of the frame: this share of the way to the nearer body, at most `max` m */
  near: 0.6,
  max: 5,
  /** a piece starts to dissolve covering this share of the frame (or of a band round it as wide: coming in), or this
   *  share of its four corners */
  share: 0.03,
  corner: 0.1,
  /** and keeps dissolving while a ray meets it within `keep` × the near part, and `hold` seconds after */
  keep: 1.3,
  hold: 1.0,
  /** a body's feet this near a piece keep it (m), and its path this many seconds on (what it is about to land on);
   *  after a body was on it, it stays whole `rest` seconds more */
  touch: 0.45,
  ahead: 0.9,
  rest: 0.8,
  /** seconds to dissolve, to come back, and to come back under a body (or to free a slot) */
  easeIn: 0.18,
  easeOut: 0.6,
  easeBack: 0.08,
}, {
  near: { min: 0.2, max: 1 },
  max: { min: 1, max: 10 },
  share: { min: 0, max: 0.3 },
  corner: { min: 0, max: 1 },
  keep: { min: 1, max: 2 },
  hold: { min: 0, max: 3 },
  touch: { min: 0, max: 1.5 },
  ahead: { min: 0, max: 2 },
  rest: { min: 0, max: 3 },
  easeIn: { min: 0, max: 2 },
  easeOut: { min: 0, max: 2 },
  easeBack: { min: 0, max: 1 },
});

/** how many pieces the shaders take (worlds/light.wgsl `Sight.piece`) */
export const FRAME_SLOTS = 16;
/** the ray grid, over a frame `WIDE` times the lens's (what lies just outside it is about to come in) */
const COLS = 16, ROWS = 9, WIDE = 1.2;
/** and a little deeper than the near part (as the eye comes in toward the pair, the near part reaches further) */
const AHEAD = 1.15;
/** the body's fall (m/s²) for the path ahead (the duel's characters: dancer/character.ts, about 23 to 40) */
const FALL = 26;
/** boxes side by side are one piece while their bounding box is at most this much bigger than they are */
const PACKED = 1.35;

/** the view: the eye, its axes, the lens (radians, top to bottom) and the aspect */
export interface FrameView { position: ArrayLike<number>; forward: ArrayLike<number>; right: ArrayLike<number>; up: ArrayLike<number>; fovY: number; aspect: number }
/** a framed body: its middle (the hips), its points (joints: the lowest is its feet), its velocity */
export interface FrameBody { mid: V3; pts: readonly V3[]; vel: V3 }

export interface FramePiece {
  /** what the shaders dissolve: the solid, or the box round the boxes it is made of */
  solid: Solid;
  /** the solids it is made of */
  members: readonly Solid[];
  /** how strongly it is dissolved now (0 … 1) */
  k: number;
  /** dissolving (the hysteresis' state) and how long it holds once nothing meets it */
  on: boolean;
  hold: number;
  /** how long it stays whole yet after a body was on it */
  rest: number;
  /** this frame: its share of the frame and of the corners, and whether a body keeps it */
  cover: number;
  corner: number;
  support: boolean;
}

/** a piece's shape: one solid, or boxes side by side */
interface Group { rep: Solid; shape: Solid; members: Solid[]; vol: number }

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const centre = (s: Solid): V3 => s.kind === 'capsule' ? [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2] : s.c;
const volume = (s: Solid) => s.kind === 'box' ? 8 * s.h[0] * s.h[1] * s.h[2] : Math.PI * s.r * s.r * (Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]) + (4 / 3) * s.r);
const radius = (s: Solid) => s.kind === 'box' ? Math.hypot(...s.h) : Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]) / 2 + s.r;
/** the height of a solid's top */
const topOf = (s: Solid) => s.kind === 'capsule' ? Math.max(s.a[1], s.b[1]) + s.r : s.c[1] + Math.abs(s.x[1] * s.h[0]) + Math.abs(s.y[1] * s.h[1]) + Math.abs(s.z[1] * s.h[2]);
/** how wide a solid is across (m) */
const across = (s: Solid) => s.kind === 'capsule' ? s.r : Math.max(s.h[0], s.h[2]);
/** the same piece in a new list (a growing pillar's solid is a new object each frame, a box while it is short and a
 *  capsule after: duel/arena.ts drumSolid): as wide, standing where it stood */
const same = (a: Solid, b: Solid) => {
  const ca = centre(a), cb = centre(b);
  return Math.hypot(ca[0] - cb[0], ca[2] - cb[2]) < 0.15 && Math.abs(across(a) - across(b)) < 0.2 && Math.abs(ca[1] - cb[1]) < 2.5;
};
/** the box round some boxes turned the same way (in the first one's axes) */
function around(boxes: readonly Box[]): Box {
  const A = boxes[0], ax = [A.x, A.y, A.z], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) for (let k = 0; k < 3; k++) {
    // (the box's extent along axis k: its middle there ± its half sizes along its own axes, projected)
    const m = dot(b.c, ax[k]), e = Math.abs(dot(b.x, ax[k])) * b.h[0] + Math.abs(dot(b.y, ax[k])) * b.h[1] + Math.abs(dot(b.z, ax[k])) * b.h[2];
    lo[k] = Math.min(lo[k], m - e); hi[k] = Math.max(hi[k], m + e);
  }
  const mid = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
  const c: V3 = [0, 1, 2].map((i) => ax[0][i] * mid[0] + ax[1][i] * mid[1] + ax[2][i] * mid[2]) as V3;
  return { kind: 'box', c, x: A.x, y: A.y, z: A.z, h: [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2] };
}
const parallel = (a: Box, b: Box) => Math.abs(dot(a.x, b.x)) > 0.999 && Math.abs(dot(a.y, b.y)) > 0.999;

/** which rays of the grid fall inside the lens, and which in the frame's corners (the judge's: the outer 2/9 across,
 *  the outer 2/5 up and down) */
const INSIDE: boolean[] = [], CORNER: boolean[] = [];
for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
  const xn = ((i + 0.5) / COLS * 2 - 1) * WIDE, yn = (1 - (j + 0.5) / ROWS * 2) * WIDE, u = (xn + 1) / 2, v = (1 - yn) / 2;
  const inside = Math.abs(xn) <= 1 && Math.abs(yn) <= 1;
  INSIDE.push(inside);
  CORNER.push(inside && (u < 2 / 9 || u > 7 / 9) && (v < 2 / 5 || v > 3 / 5));
}
const NINSIDE = INSIDE.filter(Boolean).length, NCORNER = CORNER.filter(Boolean).length;

export class FrameFade {
  /** the pieces dissolving, coming back or resting, by their first solid */
  readonly pieces = new Map<Solid, FramePiece>();
  /** how far from the eye the nearer body stands less its reach (m): nothing further than this dissolves (the shaders'
   *  guard: whatever stands at the pair's own depth stays, whatever the test found) */
  far = 0;
  /** the near part's reach this frame (m) */
  reach = 0;
  private list: readonly Solid[] | null = null;
  private sub: { key: string; solids: Solids; index: number[] } | null = null;
  /** each solid's piece (kept across lists: the world's and the arena's solids are the same objects in each) */
  private groups = new WeakMap<Solid, Group>();

  /** each frame: the view, the world's solids (null: none), the framed bodies; `on` false eases everything back */
  update(dt: number, view: FrameView, solids: Solids | null, bodies: readonly FrameBody[], on: boolean) {
    const P = frameParams, list = solids?.list ?? null;
    if (list !== this.list) this.remap(list);
    for (const p of this.pieces.values()) { p.cover = 0; p.corner = 0; p.support = false; }
    const want = new Set<FramePiece>(), met = new Set<FramePiece>();
    const E: V3 = [view.position[0], view.position[1], view.position[2]];
    let dNear = Infinity;
    for (const b of bodies) dNear = Math.min(dNear, Math.hypot(b.mid[0] - E[0], b.mid[1] - E[1], b.mid[2] - E[2]));
    this.reach = Number.isFinite(dNear) ? Math.min(P.max, dNear * P.near) : 0;
    this.far = Number.isFinite(dNear) ? Math.max(0, dNear - 0.6) : 0;
    if (on && P.on && solids && list && bodies.length && this.reach > 0.05) {
      const reach = this.reach, L = reach * P.keep, sub = this.near(solids, E, L);
      if (sub) {
        // per piece: rays inside the lens (and in its corners) and outside it, within the near part; any within `keep`
        const hits = new Map<Group, { strict: number; corner: number; early: number }>();
        // (the grid spans a frame `WIDE` times the lens: the rays outside the lens find what is about to come in, so it
        // has begun to dissolve by the time it does)
        const f = view.forward, r = view.right, u = view.up, ty = Math.tan(view.fovY / 2), tx = ty * view.aspect;
        for (let j = 0, q = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++, q++) {
          const xn = ((i + 0.5) / COLS * 2 - 1) * WIDE, yn = (1 - (j + 0.5) / ROWS * 2) * WIDE, x = xn * tx, y = yn * ty;
          let dx = f[0] + r[0] * x + u[0] * y, dy = f[1] + r[1] * x + u[1] * y, dz = f[2] + r[2] * x + u[2] * y;
          const l = Math.hypot(dx, dy, dz) || 1;
          dx /= l; dy /= l; dz /= l;
          let hit = -1;
          const t = sub.solids.sweep(E, [E[0] + dx * L, E[1] + dy * L, E[2] + dz * L], 0.03, (k) => { hit = k; });
          if (hit < 0 || t >= 1) continue;
          const g = this.groups.get(list[sub.index[hit]]);
          if (!g) continue;
          let h = hits.get(g);
          if (!h) hits.set(g, (h = { strict: 0, corner: 0, early: 0 }));
          if (t * L > reach * AHEAD) continue;
          if (!INSIDE[q]) { h.early++; continue; }
          h.strict++;
          if (CORNER[q]) h.corner++;
        }
        // (the most covering first: a new piece starts only while a slot is free)
        let busy = 0;
        for (const p of this.pieces.values()) if (p.on || p.k > 0) busy++;
        const order = [...hits].sort((a, b) => b[1].strict + b[1].corner + b[1].early - a[1].strict - a[1].corner - a[1].early);
        for (const [g, h] of order) {
          let p = this.pieces.get(g.rep);
          const cover = h.strict / NINSIDE, corners = h.corner / NCORNER, coming = h.early / NINSIDE;
          const support = this.supports(g.members, bodies);
          const start = cover >= P.share || corners >= P.corner || coming >= P.share;
          if (!p) {
            if (support || !start || busy >= FRAME_SLOTS) continue;
            p = { solid: g.shape, members: g.members, k: 0, on: false, hold: 0, rest: 0, cover: 0, corner: 0, support: false };
            this.pieces.set(g.rep, p);
          }
          if (!p.on && p.k <= 0 && start && !support && p.rest <= 0) { if (busy >= FRAME_SLOTS) continue; busy++; }
          p.cover = cover; p.corner = corners; p.support = support;
          met.add(p);
          if (!support && p.rest <= 0 && (start || p.on)) want.add(p);
        }
      }
    }
    // (a piece dissolving or coming back that no ray met this frame: is a body on it now?)
    for (const p of this.pieces.values()) if (!met.has(p)) p.support = this.supports(p.members, bodies);
    // (while the slots are nearly all taken, what is coming back comes back quickly, to free its slot)
    let taken = 0;
    for (const p of this.pieces.values()) if (p.on || p.k > 0) taken++;
    const crowded = taken >= FRAME_SLOTS - 1;
    for (const [s, p] of this.pieces) {
      // (once a body has been on it, it rests whole a moment before it may dissolve again: no flicker under a body that
      // hovers at the edge of the touch)
      if (p.support) p.rest = P.rest;
      else p.rest = Math.max(0, p.rest - dt);
      if (want.has(p)) { p.on = true; p.hold = P.hold; }
      else if (p.support || !on) p.on = false;
      else if (p.on && (p.hold -= dt) <= 0) p.on = false;
      const goal = p.on ? 1 : 0, tau = p.support || (!p.on && (p.rest > 0 || crowded)) ? P.easeBack : p.on ? P.easeIn : P.easeOut;
      p.k = tau <= 0 ? goal : p.k + (goal - p.k) * (1 - Math.exp(-dt / tau));
      if (Math.abs(p.k - goal) < 2e-3) p.k = goal;
      if (!p.on && p.k <= 0 && p.rest <= 0) this.pieces.delete(s);
    }
  }

  /** how strongly a solid is dissolved (0 … 1): its piece's, or the same piece's in another list (a growing pillar) */
  strengthOf(s: Solid | null | undefined): number {
    if (!s) return 0;
    const p = this.pieces.get(this.groups.get(s)?.rep ?? s);
    if (p) return p.k;
    for (const [rep, q] of this.pieces) if (same(rep, s)) return q.k;
    return 0;
  }

  /** the pieces dissolving now, the strongest first (at most n) */
  top(n = FRAME_SLOTS): FramePiece[] {
    const out: FramePiece[] = [];
    for (const p of this.pieces.values()) if (p.k > 0.002) out.push(p);
    return out.sort((a, b) => b.k - a.k).slice(0, n);
  }

  /** whether a body is on the piece (its feet at it, a hand or a foot at its top: standing, hanging from its edge, its
   *  middle against it), or its path over the next moments meets it (what it is about to land on). (A hand or a knee
   *  brushing a wall's side lower down is not: a body kicking off a beam beside the eye still sees it dissolve) */
  private supports(members: readonly Solid[], bodies: readonly FrameBody[]) {
    const P = frameParams;
    for (const s of members) {
      const top = topOf(s);
      for (const b of bodies) {
        let feet = b.pts[0] ?? b.mid;
        for (const p of b.pts) {
          if (p[1] < feet[1]) feet = p;
          if (p[1] > top - 0.35 && distTo(s, p) < P.touch * 0.6) return true;
        }
        if (distTo(s, feet) < P.touch || distTo(s, b.mid) < P.touch * 0.7) return true;
        // its path: the feet carried on by its velocity and falling (a body standing still: where it stands)
        const v = b.vel;
        if (Math.hypot(v[0], v[1], v[2]) < 0.3) continue;
        for (let t = 0.05; t <= P.ahead + 1e-6; t += 0.05) {
          const q: V3 = [feet[0] + v[0] * t, feet[1] + v[1] * t - 0.5 * FALL * t * t, feet[2] + v[2] * t];
          if (distTo(s, q) < 0.35) return true;
          if (q[1] < feet[1] - 3) break;
        }
      }
    }
    return false;
  }

  /** the solids whose bounds come within reach of the eye, as their own space (kept while the set is the same) */
  private near(solids: Solids, E: V3, reach: number) {
    const B = solids.bounds, index: number[] = [];
    for (let i = 0; i < solids.list.length; i++) {
      const o = i * 4;
      if (Math.hypot(E[0] - B[o], E[1] - B[o + 1], E[2] - B[o + 2]) - B[o + 3] <= reach + 0.05) index.push(i);
    }
    if (!index.length) return null;
    const key = index.join(',');
    if (this.sub?.key !== key) this.sub = { key, index, solids: new Solids(index.map((i) => solids.list[i])) };
    return this.sub;
  }

  /** a new list of solids (the arena shown, a power's piece come or gone): its new solids put into pieces, and each
   *  piece dissolving found again in it, or dropped */
  private remap(list: readonly Solid[] | null) {
    this.list = list;
    this.sub = null;
    if (list) this.group(list.filter((s) => !this.groups.has(s)));
    const members = list ? new Set(list) : null;
    for (const [rep, p] of [...this.pieces]) {
      if (members?.has(rep)) continue;
      this.pieces.delete(rep);
      const again = list?.find((x) => same(rep, x) && !this.pieces.has(this.groups.get(x)!.rep));
      if (again) {
        const g = this.groups.get(again)!;
        p.solid = g.shape; p.members = g.members;
        this.pieces.set(g.rep, p);
      }
    }
  }

  /** solids into pieces: a box joins a piece of boxes turned the same way while their bounding box stays packed */
  private group(fresh: readonly Solid[]) {
    const made: Group[] = [];
    for (const s of fresh) {
      let joined = false;
      if (s.kind === 'box') {
        const c = s.c, R = radius(s), v = volume(s);
        for (const g of made) {
          if (g.shape.kind !== 'box' || g.rep.kind !== 'box' || !parallel(g.rep, s)) continue;
          const gc = g.shape.c;
          if (Math.hypot(c[0] - gc[0], c[1] - gc[1], c[2] - gc[2]) > R + radius(g.shape) + 0.1) continue;
          const shape = around([...(g.members as Box[]), s]);
          if (volume(shape) > PACKED * (g.vol + v)) continue;
          g.members.push(s); g.shape = shape; g.vol += v;
          this.groups.set(s, g);
          joined = true;
          break;
        }
      }
      if (joined) continue;
      const g: Group = { rep: s, shape: s, members: [s], vol: volume(s) };
      made.push(g);
      this.groups.set(s, g);
    }
  }
}
