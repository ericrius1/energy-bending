// LandmarkController: drives the 38-joint rig from 13 landmarks (skeleton/landmarks.ts), through the retargeter
// (skeleton/retarget.ts). Whatever supplies the landmarks (a procedural move, the network, the webcam, or a
// skeleton read back with landmarksFromSkeleton) writes them into `pose` before the dancers update. With `ground`
// it keeps the feet on the floor (eased, so a jump still leaves it), for sources that don't know where the floor is.
import type { Controller } from './controller';
import type { FrameCtx } from '../engine/frame';
import type { Rig, Skeleton } from '../skeleton/rig';
import { vec3 } from 'math';
import { newLandmarkPose, type LandmarkPose } from '../skeleton/landmarks';
import { fitSkeleton, lowestFoot } from '../skeleton/retarget';

export class LandmarkController implements Controller {
  readonly kind: string = 'landmarks';
  /** the landmarks to fit this frame (write into it, or replace it) */
  pose: LandmarkPose;
  /** keep the lowest foot this far above the floor (null: the hips go exactly where the landmarks say) */
  ground: number | null = null;
  /** called before each fit: fill `pose` here if it's pulled rather than pushed */
  source: ((pose: LandmarkPose, f: FrameCtx) => void) | null = null;
  private lift = 0.95;

  constructor(readonly rig: Rig, pose: LandmarkPose = newLandmarkPose()) { this.pose = pose; }

  update(dt: number, f: FrameCtx, out: Skeleton) {
    this.source?.(this.pose, f);
    if (this.ground === null) { fitSkeleton(this.pose, out, 0); return; }
    fitSkeleton(this.pose, out, 0);
    const low = lowestFoot(out) - this.pose.root[1];
    this.lift += (this.ground - low - this.lift) * Math.min(1, dt * 4);
    for (let k = 0; k < out.count; k++) out.pos[k][1] += this.lift;
  }

  /** stand somewhere (the landmarks' frame moves there) */
  place(x: number, z: number, yaw: number) { vec3.set(this.pose.root, x, 0, z); this.pose.yaw = yaw; }
}
