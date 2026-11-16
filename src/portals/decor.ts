// What the camera's eye must keep out of round a mirror besides the world's solids (World.solids: the stones, trunks,
// blades and the arena's pieces): the decor that isn't solid for the bodies but fills the lens at a hand's distance
// (report 23, issue 3: on the way round the geode's mirror the eye went through a planter, and through the temple's it
// passed the stained-glass screen at arm's length). Rough shapes from the same pure layouts the worlds draw from, so
// the page and Node (the tests, the camera's measure) agree:
//   - the temple: the stained-glass screens at the court's edge and the banners in the great gate (garden.ts HANG);
//   - the geode: the planters along the great window and the hanging gardens (garden.ts pots), and the room's own shell
//     (the crystal bank and the planted tiers on its wall: the dome, 12.4 m round, its vault 1.45 times as high);
//   - every world: each gate's brass and stained-glass frame round its disc (surface.wgsl vs_frame) and its crown.
// `keepOut` joins them with the world's solids into one clearance (m from the nearest surface, negative inside), and
// `gateCrossed` says whether a step of the eye passes through a gate's disc (the way through a mirror must cross only
// its own). A world agent adding decor round the mirrors should add it here.
import type { Solid } from '../worlds/solids';
import { box, cylinder } from '../worlds/solids';
import { distTo } from '../engine/camera';
import { layoutTemple } from '../worlds/temple/layout';
import { layoutGarden, HANG, HANG_FLOATS } from '../worlds/temple/garden';
import { templeDuel } from '../worlds/temple/arena';
import { layoutGeodeGarden, POT_FLOATS } from '../worlds/geode/garden';
import { geodeDuel } from '../worlds/geode/arena';

type V3 = [number, number, number];

/** a gate as the keep-out needs it: its disc's middle, face, right, up and radius */
export interface GateShape { id?: string; at: ArrayLike<number>; n: ArrayLike<number>; right: ArrayLike<number>; up: ArrayLike<number>; r: number }

const made = new Map<string, Solid[]>();

/** the decor of a world (its own coordinates, its duel arena shown), made once */
export function decorOf(world: string): readonly Solid[] {
  let d = made.get(world);
  if (!d) { d = build(world); made.set(world, d); }
  return d;
}

function build(world: string): Solid[] {
  const out: Solid[] = [];
  try {
    if (world === 'temple') {
      const L = layoutTemple({ coarse: false }), G = layoutGarden(L.stones, false, templeDuel().stones);
      for (let i = 0; i < G.data.length / HANG_FLOATS; i++) {
        const o = i * HANG_FLOATS, kind = G.data[o + 3];
        const at: V3 = [G.data[o], G.data[o + 1], G.data[o + 2]], nx = G.data[o + 4], nz = G.data[o + 5];
        const yaw = Math.atan2(nx, nz);
        if (kind === HANG.screen) {
          // (a panel from the floor to its height, its width across, a hand thick; a little fat: the near plane)
          const h = G.data[o + 6], w = G.data[o + 7];
          out.push(box([at[0], h / 2, at[2]], [w / 2 + 0.05, h / 2, 0.12], yaw));
        } else if (kind === HANG.banner) {
          // (cloth hung from the lintel's edge, `len` down)
          const len = G.data[o + 6], w = G.data[o + 7];
          out.push(box([at[0], at[1] - len / 2, at[2]], [w / 2 + 0.05, len / 2, 0.1], yaw));
        }
      }
    } else if (world === 'geode') {
      const G = layoutGeodeGarden(geodeDuel().decor, 12.4, false);
      for (let i = 0; i < G.potCount; i++) {
        const o = i * POT_FLOATS, foot: V3 = [G.pots[o], G.pots[o + 1], G.pots[o + 2]], R = G.pots[o + 3], H = G.pots[o + 4];
        // (the pot and the ferns over its rim: as high again and a little wider)
        out.push(cylinder(foot, [foot[0], foot[1] + H * 1.9, foot[2]], R + 0.25));
      }
    }
  } catch (e) {
    // (a world's layout that won't build without its page: no decor for it, the solids still hold)
    console.warn(`decor: ${world}`, e);
  }
  return out;
}

/** the geode's shell, the crystal bank and the planted tiers on it: how far inside it p is (m; negative past it) */
function geodeShell(p: ArrayLike<number>) {
  const R = 12.4, q = Math.hypot(p[0], p[1] / 1.45, p[2]);
  // (the crystal bank stands about 0.9 m out from the wall at its foot, the tiers' rail and planting 0.6 m)
  return R - q - (p[1] < 3.3 ? 0.9 : 0.6);
}

/** a gate's frame as a ring of capsules round its disc, and its crown over it */
export function frameSolids(g: GateShape): Solid[] {
  const out: Solid[] = [], R = g.r + 0.12, n = 14;
  const at = (a: number, rr = R): V3 => [
    g.at[0] + (g.right[0] * Math.cos(a) + g.up[0] * Math.sin(a)) * rr,
    g.at[1] + (g.right[1] * Math.cos(a) + g.up[1] * Math.sin(a)) * rr,
    g.at[2] + (g.right[2] * Math.cos(a) + g.up[2] * Math.sin(a)) * rr,
  ];
  for (let i = 0; i < n; i++) out.push({ kind: 'capsule', a: at((i / n) * Math.PI * 2), b: at(((i + 1) / n) * Math.PI * 2), r: 0.16 });
  const top = at(Math.PI / 2, g.r + 0.45);
  out.push({ kind: 'capsule', a: top, b: top, r: 0.38 });
  return out;
}

/** one clearance over a world's solids, its decor, its shell and its gates' frames */
export function keepOut(world: string, solids: readonly Solid[] | undefined, gates: readonly GateShape[]) {
  const list: Solid[] = [...(solids ?? []), ...decorOf(world), ...gates.flatMap(frameSolids)];
  // (a bounding sphere each, so a far solid costs one distance)
  const B = list.map((s) => {
    if (s.kind === 'capsule') {
      const c: V3 = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2];
      return [c, Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]) / 2 + s.r] as const;
    }
    return [s.c, Math.hypot(s.h[0], s.h[1], s.h[2])] as const;
  });
  const shell = world === 'geode' ? geodeShell : null;
  return {
    list,
    /** m from the nearest surface (negative inside one) */
    clear(p: ArrayLike<number>) {
      const P: V3 = [p[0], p[1], p[2]];
      let d = shell ? shell(P) : Infinity;
      for (let i = 0; i < list.length; i++) {
        const [c, r] = B[i], lo = Math.hypot(P[0] - c[0], P[1] - c[1], P[2] - c[2]) - r;
        if (lo >= d) continue;
        d = Math.min(d, distTo(list[i], P));
      }
      return d;
    },
  };
}

/** the gate whose disc the step a → b passes through (inside its radius and a margin), or null */
export function gateCrossed(a: ArrayLike<number>, b: ArrayLike<number>, gates: readonly GateShape[], margin = 0.25): GateShape | null {
  for (const g of gates) {
    const sa = (a[0] - g.at[0]) * g.n[0] + (a[1] - g.at[1]) * g.n[1] + (a[2] - g.at[2]) * g.n[2];
    const sb = (b[0] - g.at[0]) * g.n[0] + (b[1] - g.at[1]) * g.n[1] + (b[2] - g.at[2]) * g.n[2];
    if ((sa > 0) === (sb > 0) || sa === sb) continue;
    const k = sa / (sa - sb), p = [a[0] + (b[0] - a[0]) * k - g.at[0], a[1] + (b[1] - a[1]) * k - g.at[1], a[2] + (b[2] - a[2]) * k - g.at[2]];
    const x = p[0] * g.right[0] + p[1] * g.right[1] + p[2] * g.right[2], y = p[0] * g.up[0] + p[1] * g.up[1] + p[2] * g.up[2];
    if (Math.hypot(x, y) <= g.r + margin) return g;
  }
  return null;
}
