// The Pool's water garden in the duel (garden.wgsl draws it): lily pads in loose clusters in the water near the stones
// and round the far water, lotus flowers standing on some of them, a few giant pads with their rims turned up out in the
// open, and clumps of reeds at the feet of the standing stones and the blocks and in a broken ring round the arena.
// Placed once from the arena's own description (arena.ts), seeded, so it is the same every time; kept off every
// piece's top and out of the middle of the stage's band, where the bodies land and swim most, so it frames the play
// rather than sitting in it. Decoration only: nothing here is solid, the camera and the bodies don't know of it.
import type { Kit } from '@ericrius1/weft';
import { mulberry32 } from 'math/random';
import gardenShader from './garden.wgsl';
import bedShader from './beds.wgsl';
import type { ScenePass } from '../../engine/scene';
import { topAt } from '../../duel/arena';
import { poolDuel, ROCK_FLOATS, ROCK_LOOK } from './arena';

const FLOATS = 8;
/** vertices per instance of each kind (garden.wgsl: a pad's fan and rim, a flower's petals and seed head, a clump;
 *  beds.wgsl: a clump's seven leaves of two halves of three quads, three flowers of a stem and a head) */
const PAD_VERTS = 20 * 3 + 20 * 6, LOTUS_VERTS = 15 * 18 + 18, REED_VERTS = 9 * 4 * 6, BED_VERTS = 7 * 2 * 3 * 6 + 3 * 12;

interface Plants { pads: number[]; lotus: number[]; reeds: number[] }

function plant(coarse: boolean): Plants {
  const rng = mulberry32.create(523);
  const r = () => mulberry32.sample(rng);
  const D = poolDuel(), pieces = D.arena.pieces!;
  const out: Plants = { pads: [], lotus: [], reeds: [] };
  /** clear of every piece by m, and of the stage's middle band */
  const free = (x: number, z: number, m: number, band = true) => {
    if (band && Math.abs(z) < 1.6 && Math.abs(x) < 8.5) return false;
    for (const s of pieces) for (const [dx, dz] of [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]]) if (topAt(s, x + dx, z + dz, 0) > -Infinity) return false;
    return true;
  };
  const pads: [number, number, number][] = [];
  const padOk = (x: number, z: number, R: number) => free(x, z, R + 0.08) && pads.every(([px, pz, pr]) => Math.hypot(px - x, pz - z) > (pr + R) * 0.92);
  const addPad = (x: number, z: number, R: number, rim: number, tint: number) => {
    pads.push([x, z, R]);
    out.pads.push(x, 0, z, r() * Math.PI * 2, R, rim, r(), tint);
  };
  /** a cluster of pads round (cx, cz), with a flower now and then */
  const cluster = (cx: number, cz: number, n: number, flowers: number) => {
    for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
      const a = r() * Math.PI * 2, d = 0.2 + r() * 0.9, R = 0.22 + 0.3 * r();
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!padOk(x, z, R)) continue;
      addPad(x, z, R, 0.012, r());
      if (flowers > 0 && r() < 0.5) { flowers--; out.lotus.push(x + (r() - 0.5) * R * 0.4, 0, z + (r() - 0.5) * R * 0.4, r() * Math.PI, 0.16 + 0.1 * r(), 0, r(), r()); }
      k++;
    }
  };
  // round each piece: a cluster of pads in the water near it (now and then), reeds at the feet of the stones that
  // stand out of the water (the tall ones and the blocks)
  for (let i = 0; i < D.count; i++) {
    const o = i * ROCK_FLOATS, x = D.data[o], z = D.data[o + 2], yaw = D.data[o + 3], w = D.data[o + 4], hgt = D.data[o + 5], dep = D.data[o + 6], ice = D.data[o + 7] > 0.5;
    const top = D.data[o + 1] + hgt, half = Math.max(w, dep) / 2;
    if (r() < 0.55) {
      const a = r() * Math.PI * 2, d = half + 0.6 + r() * 0.8;
      cluster(x + Math.cos(a) * d, z + Math.sin(a) * d, 3 + Math.floor(r() * 4), 2);
    }
    if (!ice && top > 0.7) {
      const clumps = top > 2.5 ? 3 : 2;
      for (let k = 0; k < clumps; k++) {
        // (just off a side of the stone, in the water)
        const side = Math.floor(r() * 4), along = (r() - 0.5) * 0.8;
        const lx = side < 2 ? (side ? 1 : -1) * (w / 2 + 0.12) : along * w, lz = side >= 2 ? (side === 3 ? 1 : -1) * (dep / 2 + 0.12) : along * dep;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
        if (!free(px, pz, 0.05)) continue;
        out.reeds.push(px, 0, pz, 0, 0.8 + 0.7 * r(), 0, r(), r());
      }
    }
  }
  // the far water round the arena: pads and flowers in drifts, giant pads, and the reeds in a broken ring
  const far = coarse ? 22 : 40;
  for (let k = 0; k < far; k++) {
    const a = r() * Math.PI * 2, d = 12.5 + r() * 9;
    cluster(Math.cos(a) * d, Math.sin(a) * d, 4 + Math.floor(r() * 5), 2);
  }
  for (let k = 0; k < (coarse ? 6 : 12); k++) {
    const a = r() * Math.PI * 2, d = 13 + r() * 8, R = 0.8 + 0.4 * r(), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (padOk(x, z, R)) addPad(x, z, R, 0.07, 0.3 * r());
  }
  for (let k = 0; k < (coarse ? 40 : 80); k++) {
    const a = r() * Math.PI * 2, d = 14 + r() * 10, x = Math.cos(a) * d, z = Math.sin(a) * d;
    // (in stands: a few clumps together)
    for (let j = 0; j < 3; j++) out.reeds.push(x + (r() - 0.5) * 1.2, 0, z + (r() - 0.5) * 1.2, 0, 1.0 + 0.9 * r(), 0, r(), r());
  }
  return out;
}

/** the planting round the rims of the planters, rafts and blocks (beds.wgsl, report 18): clumps of leaves a stride or
 *  so apart round each top, a hand in from its edge, some with flowers; none where another piece stands on the top (the
 *  arch's pillars on the middle stone). Each clump is in its piece's own frame, so it rides a raft on the swell */
function bedsOf(coarse: boolean): number[] {
  const rng = mulberry32.create(907);
  const r = () => mulberry32.sample(rng);
  const D = poolDuel(), pieces = D.arena.pieces!, out: number[] = [];
  for (let i = 0; i < D.count; i++) {
    const o = i * ROCK_FLOATS, look = D.data[o + 11];
    // (report 24: the standing stones' and the gate's tops are planted too; the pillars' tops are under the lintel)
    if (look === ROCK_LOOK.gatePillar) continue;
    const x = D.data[o], z = D.data[o + 2], yaw = D.data[o + 3], hx = D.data[o + 4] / 2, hz = D.data[o + 6] / 2;
    const top = D.data[o + 1] + D.data[o + 5], rp = Math.min(D.data[o + 10], Math.min(hx, hz) * 0.95);
    const cx = hx - rp, cz = hz - rp;
    // the outline (a rounded rectangle), walked by its length: straight sides and quarter arcs
    const segs: [number, number][] = [[2 * cz, 0], [rp * Math.PI / 2, 1], [2 * cx, 2], [rp * Math.PI / 2, 3], [2 * cz, 4], [rp * Math.PI / 2, 5], [2 * cx, 6], [rp * Math.PI / 2, 7]];
    const perim = segs.reduce((a, s) => a + s[0], 0);
    const at = (s: number): [number, number, number, number] => {
      for (const [len, k] of segs) {
        if (s > len) { s -= len; continue; }
        const q = Math.floor(k / 2), arc = k % 2 === 1, f = s / Math.max(len, 1e-6);
        const corner = [[cx, cz], [-cx, cz], [-cx, -cz], [cx, -cz]][q];
        if (!arc) {
          // (side q runs from corner q-1 to corner q)
          const a = [[cx, -cz], [cx, cz], [-cx, cz], [-cx, -cz]][q], b = corner;
          const n = [[1, 0], [0, 1], [-1, 0], [0, -1]][q];
          return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, n[0], n[1]];
        }
        const ang = (q * Math.PI) / 2 + f * (Math.PI / 2);
        return [corner[0], corner[1], Math.cos(ang), Math.sin(ang)];
      }
      return [cx, 0, 1, 0];
    };
    const every = look === ROCK_LOOK.block ? 0.6 : look === ROCK_LOOK.raft ? 0.42 : 0.36;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (let s = r() * every; s < perim; s += every * (0.75 + 0.5 * r())) {
      if (r() < (coarse ? 0.5 : 0.15)) continue;
      const [ox, oz, nx, nz] = at(s);
      const inset = 0.13 + 0.12 * r();
      const lx = ox + nx * (rp - inset), lz = oz + nz * (rp - inset);
      const wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c;
      // (not where a piece stands on this top)
      if (pieces.some((p) => topAt(p, wx, wz, 0.18) > top + 0.05)) continue;
      const len = (look === ROCK_LOOK.block ? 0.3 : 0.26) + 0.2 * r();
      const flowers = r() < 0.55 ? 1 + Math.floor(r() * 3) : 0;
      out.push(i, lx, lz, Math.atan2(nz, nx), len, flowers, r(), r());
    }
  }
  return out;
}

export class PoolGarden {
  private bufs: { pads: ReturnType<Kit['storage']>; lotus: ReturnType<Kit['storage']>; reeds: ReturnType<Kit['storage']>; beds: ReturnType<Kit['storage']> };
  readonly counts: { pads: number; lotus: number; reeds: number; beds: number };

  /** stones: the stones' live buffer (pool.ts: the rafts where the swell has them), which the beds stand on */
  constructor(kit: Kit, coarse: boolean, private stones: ReturnType<Kit['storage']>) {
    const P = plant(coarse), B = bedsOf(coarse);
    const buf = (label: string, a: number[]) => kit.storage({ label: `pool.garden.${label}`, data: new Float32Array(a.length ? a : new Array(FLOATS).fill(0)), usage: ['storage'] });
    this.bufs = { pads: buf('pads', P.pads), lotus: buf('lotus', P.lotus), reeds: buf('reeds', P.reeds), beds: buf('beds', B) };
    this.counts = { pads: P.pads.length / FLOATS, lotus: P.lotus.length / FLOATS, reeds: P.reeds.length / FLOATS, beds: B.length / FLOATS };
  }

  /** its four draws in the opaque phase, on while `on` (the duel's arena shown) */
  declare(s: ScenePass, on: () => boolean) {
    const d = (label: 'pads' | 'lotus' | 'reeds', vertex: string, count: number) =>
      s.pass.draw(gardenShader, { label: `pool.garden.${label}`, vertex, fragment: 'fs', bind: { plants: this.bufs[label] }, count, instances: this.counts[label], cull: 'none', enabled: () => on() && this.counts[label] > 0 });
    d('pads', 'vs_pad', PAD_VERTS);
    d('lotus', 'vs_lotus', LOTUS_VERTS);
    d('reeds', 'vs_reed', REED_VERTS);
    s.pass.draw(bedShader, { label: 'pool.garden.beds', bind: { stones: this.stones, beds: this.bufs.beds }, count: BED_VERTS, instances: this.counts.beds, cull: 'none', enabled: () => on() && this.counts.beds > 0 });
  }
}
