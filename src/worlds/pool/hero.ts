// The Pool's hero (report 24-sun-built; ../sun-hero.ts the parts, ../sun-hero.wgsl the drawing): the sun window, a moon
// gate standing in the water at the rim behind the stage, where the duel's camera looks past the arch on the middle
// stone (itself dressed as the sun gate: arena.ts ROCK_LOOK), so the two stand one behind the other in its frame. A ring
// of copper gone green on a round ceramic foot, holding a rose of stained glass (a gold sun, coral lotus petals, leaves
// between their tips, sky teal round the rim, all in lead) that the low sun, standing behind it, lights through; copper
// tendrils curling up both sides in whiplash curves, a flowering vine round its lower half, planted urns either side.
// Outside the arena's water (13.5 m from its middle: the stones reach 11.6) and not solid: play and the camera's solids
// are as they were. The edge's arches and fountains leave its sector clear (edge.ts).
import type { Kit } from '@ericrius1/weft';
import { HeroParts, MAT, PROFILE, SunHero, type V3 } from '../sun-hero';

/** where its foot stands, and how big its ring is */
export const POOL_HERO: V3 = [2.5, 0, -13.3];
const RING = 2.3;
const MID = 2.78;

export function poolHero(kit: Kit, coarse: boolean) {
  const H = new HeroParts(5113), [cx, , cz] = POOL_HERO;
  // it faces the water's middle
  const nl = Math.hypot(cx, cz), n: V3 = [-cx / nl, 0, -cz / nl], right: V3 = [n[2], 0, -n[0]];
  const at = (u: number, y: number, out = 0): V3 => [cx + right[0] * u + n[0] * out, y, cz + right[2] * u + n[2] * out];
  H.lathe(POOL_HERO, 1.35, PROFILE.foot);
  H.window(at(0, MID), RING - 0.05, n, 0);
  // the ring, in 32 pieces, and a thinner one just inside it
  const ring = (r: number, k: number, rad: number, mat: number, out = 0) => {
    const pts: V3[] = [];
    for (let j = 0; j <= k; j++) { const a = (j / k) * Math.PI * 2; pts.push(at(Math.cos(a) * r, MID + Math.sin(a) * r, out)); }
    H.path(pts, rad, mat);
  };
  ring(RING + 0.06, 32, 0.12, MAT.copper);
  ring(RING - 0.1, 32, 0.035, MAT.gold, 0.02);
  // the tendrils: from the foot up each side outside the ring, curling in over its shoulders (whiplash curves)
  for (const s of [-1, 1]) {
    const pts: V3[] = [];
    for (let j = 0; j <= 16; j++) {
      const f = j / 16, a = -Math.PI * 0.42 + f * Math.PI * 0.95;
      const r = RING + 0.32 + 0.22 * Math.sin(f * Math.PI * 2.2) * (1 - f);
      pts.push(at(s * Math.cos(a) * r, MID + Math.sin(a) * r, 0.05));
    }
    // (and its curl: a tightening spiral at the end)
    const end = pts[pts.length - 1];
    for (let j = 1; j <= 8; j++) {
      const a = j * 0.75, r = 0.28 * (1 - j / 10);
      pts.push([end[0] + right[0] * s * (-Math.sin(a) * r), end[1] - (1 - Math.cos(a)) * r * 0.9, end[2] + right[2] * s * (-Math.sin(a) * r)]);
    }
    H.path(pts, 0.045, MAT.copper);
    // a vine along the tendril's lower half, flowering
    H.vine(pts.slice(0, 9), coarse ? 0.09 : 0.06, 0.13, 0.2);
    // an urn either side on its own foot, planted, its leaves trailing
    const u = at(s * (RING + 1.35), 0, 0.4);
    H.lathe(u, 0.6, PROFILE.foot);
    H.lathe([u[0], 0.19, u[2]], 1.1, PROFILE.urn);
    for (let k = 0; k < (coarse ? 8 : 16); k++) {
      const b = H.r() * Math.PI * 2;
      H.vine([[u[0] + Math.cos(b) * 0.2, 1.15, u[2] + Math.sin(b) * 0.2], [u[0] + Math.cos(b) * 0.6, 1.15 - 0.55 * H.r(), u[2] + Math.sin(b) * 0.6]], 0.08, 0.13, 0.3);
    }
  }
  // a vine round the ring's lower half
  const low: V3[] = [];
  for (let j = 0; j <= 20; j++) { const a = Math.PI * (1.05 + j / 20 * 0.9); low.push(at(Math.cos(a) * (RING + 0.1), MID + Math.sin(a) * (RING + 0.1), 0.12)); }
  H.vine(low, coarse ? 0.1 : 0.065, 0.12, 0.16);
  return new SunHero(kit, H, 2, coarse, 'pool.hero');
}
