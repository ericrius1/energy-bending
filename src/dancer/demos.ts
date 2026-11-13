// Demos for two contracts, behind debug flags (they replace the programme's cast; the programme still rises and
// shatters them):
//   ?landmarks  a mocap dancer, and beside it a second dancer driven only by 13 landmarks read back from the first
//               (landmarksFromSkeleton → LandmarkController): the round trip through the light description.
//   ?wander     dancers walking to random points on the floor on motion matching (WanderController).
import type { CastFn } from './show';
import { Dancer } from './dancer';
import { MocapController } from './mocap';
import { LandmarkController } from './landmark';
import { WanderController, movesOf } from './wander';
import { Track, type Motion } from '../skeleton/clips';
import { landmarksFromSkeleton } from '../skeleton/landmarks';
import { gemsLoadout } from '../matter/core/kind';

/** the round trip: dancer 0 on mocap, dancer 1 on dancer 0's landmarks, `apart` metres to its right */
export function landmarksDemo(apart = 1.8): CastFn {
  return (p, show) => {
    const motion = show.motion;
    const piece = motion.pieces.find((x) => x.id === (p.piece === 'ensemble' || p.ring ? 'indian' : p.piece)) ?? motion.pieces[0];
    const src = new MocapController(new Track(motion, piece, 0));
    src.x = -apart / 2;
    const a = new Dancer('mocap', src, gemsLoadout(p.suites[0]));
    const lm = new LandmarkController(src.rig);
    lm.source = (pose) => {
      landmarksFromSkeleton(a.skeleton, pose);
      pose.root[0] += apart;
    };
    return [a, new Dancer('landmarks', lm, gemsLoadout(p.suites[1 % p.suites.length] === p.suites[0] ? 'Ember' : p.suites[1 % p.suites.length]))];
  };
}

/** n dancers wandering the floor (the travelling dances are needed: pass them once loaded) */
export function wanderDemo(motion: Motion, travel: Motion | null, n = 2): CastFn {
  const moves = movesOf(motion, travel);
  const styles = ['modern', 'latin', 'folk'];
  return (p) => Array.from({ length: n }, (_, k) => {
    const c = new WanderController(moves, styles[k % styles.length], 11 + k);
    c.place((k - (n - 1) / 2) * 1.6, 0, 0);
    c.cx = 0; c.cz = 0;
    return new Dancer(`wander.${k}`, c, gemsLoadout(p.suites[k % p.suites.length]));
  });
}
