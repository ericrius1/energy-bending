// Moves from motion capture: the adapter the prototype defined ({ name, dur, sample(u, out39) }, see moves.ts asMove)
// filled from a CMU clip. A stretch of one dancer of one piece is sampled at progress u, posed on its rig, and read back
// as 13 landmarks (skeleton/landmarks.ts landmarksFromSkeleton) in the frame the clip faced when the stretch began,
// with the root under the hips where they started: so a turn in the clip is a turn of the dancer, and (in place) its
// travel across the floor is left to the physics. Any procedural move can be replaced this way, without touching
// anything else: registerMove(clipMove(...)) under the same name, or a new name the buttons or scripts reach.
import { quat, vec3 } from 'math';
import { Track, type Motion } from '../skeleton/clips';
import { forward, Skeleton } from '../skeleton/rig';
import { landmarksFromSkeleton, newLandmarkPose } from '../skeleton/landmarks';
import type { MoveInput } from './moves';

export interface ClipMoveOptions {
  /** the move's name (how scripts and the mapping reach it) */
  name: string;
  /** the piece and which of its dancers */
  piece: string;
  dancer?: number;
  /** the stretch of the clip (s) */
  from: number;
  to: number;
  /** how long it lasts at 112 bpm (s; default: as long as the stretch) */
  dur?: number;
  /** keep the clip's travel across the floor (false: danced on the spot, the default) */
  travel?: boolean;
  /** anything else a move may say (attack, active, hit, iframes, cancelInto, airOk, evade, style…) */
  extra?: Partial<MoveInput>;
}

const _cm_yaw = quat.create();
const _cm_root = vec3.create();
const _cm_up: [number, number, number] = [0, 1, 0];

/** a sampled move from a stretch of a clip (registerMove it to use it) */
export function clipMove(motion: Motion, o: ClipMoveOptions): MoveInput {
  const piece = motion.pieces.find((p) => p.id === o.piece);
  if (!piece) throw new Error(`clipMove ${o.name}: no piece '${o.piece}' (have ${motion.pieces.map((p) => p.id).join(', ')})`);
  const track = new Track(motion, piece, o.dancer ?? 0);
  const sk = new Skeleton(track.rig);
  const lm = newLandmarkPose();
  const span = o.to - o.from;
  /** the clip posed at time t, as it was captured (the root where it was, unturned) */
  const at = (t: number) => {
    const p = track.sample(t), r = track.rig.joints[0];
    quat.identity(_cm_yaw);
    vec3.set(_cm_root, p[0] + r.offset[0], p[1] + r.offset[1], p[2] + r.offset[2]);
    forward(sk, _cm_root, quat.setAxisAngle(_cm_yaw, _cm_up, 0), p, 3);
  };
  // the frame the stretch starts in: where the hips stand and which way the pelvis faces
  at(o.from);
  landmarksFromSkeleton(sk, lm);
  const yaw0 = lm.yaw, x0 = lm.root[0], z0 = lm.root[2];
  const c = Math.cos(yaw0), s = Math.sin(yaw0);
  return {
    name: o.name,
    dur: o.dur ?? span,
    ...o.extra,
    sample(u: number, out: Float32Array) {
      at(o.from + Math.max(0, Math.min(1, u)) * span);
      landmarksFromSkeleton(sk, lm);
      // from the clip's own frame this instant back to the stretch's starting frame
      const cy = Math.cos(lm.yaw), sy = Math.sin(lm.yaw);
      const ox = o.travel ? lm.root[0] - x0 : 0, oz = o.travel ? lm.root[2] - z0 : 0;
      for (let j = 0; j < 13; j++) {
        // local (this instant) → world offset from this instant's root
        const lx = lm.p[3 * j], ly = lm.p[3 * j + 1], lz = lm.p[3 * j + 2];
        const wx = lx * cy + lz * sy + ox, wz = -lx * sy + lz * cy + oz;
        // world offset → the starting frame
        out[3 * j] = wx * c - wz * s; out[3 * j + 1] = ly; out[3 * j + 2] = wx * s + wz * c;
      }
    },
  };
}

/** the flourish this repo ships as proof of the path: a pirouette from the CMU 'pirouette' clip, danced in place */
export function pirouetteFlourish(motion: Motion): MoveInput | null {
  if (!motion.pieces.some((p) => p.id === 'pirouette')) return null;
  return clipMove(motion, {
    name: 'pirueta', piece: 'pirouette', from: PIROUETTE[0], to: PIROUETTE[1],
    extra: { cancelInto: ['jump', 'meia-lua', 'armada', 'martelo', 'esquiva', 'au'], aimW: 0, style: () => ({ hands: ['open', 'open'], feet: ['auto', 'auto'] }) },
  });
}
/** the stretch of the CMU pirouette used (s): out of its penché onto relevé and two turns, about 720° (so it ends facing the way
 *  it began; measured with a probe of the clip, see docs/reports/1-dancers.md) */
export const PIROUETTE: [number, number] = [2.0, 3.47];
