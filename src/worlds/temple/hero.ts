// The Tide Temple's hero (report 24-sun-built; ../sun-hero.ts the parts, ../sun-hero.wgsl the drawing): the sun
// fountain, a round pavilion standing in the sea just past the court's back edge, behind the stage a little right,
// where the duel's camera (which prefers to look past the stage at the world, ARENA_CAM.face) looks most, so it
// has it at the bodies' height in its frame, its dome of leaded glass catching the low sun. A plinth of
// white ceramic stepping down into the sea, eight slender ceramic columns in copper collars under a ring beam of copper
// gone green, a dome of coral lotus petals on sky teal in lead on twelve copper ribs; under it a tiered fountain (a
// basin, a bowl on a stem, a top bowl and its bud), its plume and the water falling from each rim; vines up four of
// the columns and hanging from the beam; planted urns at its foot. Outside the arena (15 m from its middle: the space's
// radius is 11) and past the court's floor, so no body reaches it and the camera's solids are as they were.
import type { Kit } from '@ericrius1/weft';
import { HeroParts, MAT, PROFILE, SunHero, type V3 } from '../sun-hero';
import { STAGE_Z } from './layout';

/** where it stands: behind the stage a little right, past the court's back edge, where the duel camera looks most
 *  (report 24: a point here was in its frame in about four samples of five, over two seeded duels) */
export const TEMPLE_HERO: V3 = [2.8, 0, -15.1];

export function templeHero(kit: Kit, coarse: boolean) {
  const H = new HeroParts(2417), [cx, , cz] = TEMPLE_HERO;
  H.lathe(TEMPLE_HERO, 1, PROFILE.plinth);
  H.lathe(TEMPLE_HERO, 1, PROFILE.dome);
  // the fountain in its middle
  H.lathe(TEMPLE_HERO, 1, PROFILE.basin);
  H.lathe(TEMPLE_HERO, 1, PROFILE.bowl);
  H.lathe(TEMPLE_HERO, 1, PROFILE.top);
  H.jet([cx, 3.08, cz], 0.55);
  H.spill([cx, 2.86, cz], 0.44, 0.62);
  H.spill([cx, 2.22, cz], 0.93, 1.06);
  // eight columns round it, white ceramic in copper collars at the foot and under the capital; a vine up every other one
  const R = 2.78, n = 8;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.2, x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R;
    H.tube([x, 0.75, z], [x, 4.2, z], 0.12, MAT.ceramic);
    H.tube([x, 0.75, z], [x, 0.95, z], 0.17, MAT.copper);
    H.tube([x, 3.88, z], [x, 4.2, z], 0.18, MAT.copper);
    H.tube([x, 2.2, z], [x, 2.28, z], 0.145, MAT.gold);
    if (k % 2 === 0) {
      const path: V3[] = [];
      for (let j = 0; j <= 14; j++) { const y = 0.85 + j * 0.23, w = j * 1.25 + k; path.push([x + Math.cos(w) * 0.15, y, z + Math.sin(w) * 0.15]); }
      H.vine(path, coarse ? 0.09 : 0.06, 0.14, 0.14);
    }
    // (a whiplash bracket from each column out under the beam: an art-nouveau curve of copper, three pieces)
    const o = [Math.cos(a), Math.sin(a)];
    H.path([[x, 3.5, z], [x + o[0] * 0.12, 3.82, z + o[1] * 0.12], [x + o[0] * 0.3, 4.02, z + o[1] * 0.3], [x + o[0] * 0.42, 4.18, z + o[1] * 0.42]], 0.035, MAT.copper);
  }
  for (let k = 0; k < (coarse ? 24 : 48); k++) {
    const a = H.r() * Math.PI * 2, x = cx + Math.cos(a) * 3.27, z = cz + Math.sin(a) * 3.27, len = 0.3 + 1.1 * H.r() * H.r();
    H.vine([[x, 4.2, z], [x + Math.cos(a) * 0.05, 4.2 - len, z + Math.sin(a) * 0.05]], 0.07, 0.12, 0.18);
  }
  // planted urns at the plinth's front steps, toward the court (on the second step, out of the tide's way at its low)
  for (const da of [-0.55, 0.55]) {
    const a = Math.atan2(STAGE_Z - cz, 0 - cx) + da;
    H.lathe([cx + Math.cos(a) * 3.35, 0.02, cz + Math.sin(a) * 3.35], 1.05, PROFILE.urn);
    const ux = cx + Math.cos(a) * 3.35, uz = cz + Math.sin(a) * 3.35;
    for (let k = 0; k < (coarse ? 8 : 16); k++) {
      const b = H.r() * Math.PI * 2;
      H.vine([[ux + Math.cos(b) * 0.2, 0.95, uz + Math.sin(b) * 0.2], [ux + Math.cos(b) * 0.55, 0.95 - 0.5 * H.r(), uz + Math.sin(b) * 0.55]], 0.08, 0.13, 0.3);
    }
  }
  return new SunHero(kit, H, 3, coarse, 'temple.hero');
}
