// The Controller contract: who moves a skeleton. A controller poses a Skeleton's joints (pos and rot, world space)
// each frame; the Dancer then commits them (velocities, the GPU layout). Controllers now:
//   MocapController     a clip of motion capture, placed and turned on the floor (dancer/mocap.ts)
//   LandmarkController  13 landmarks (skeleton/landmarks.ts) fitted onto the rig (dancer/landmark.ts)
//   CameraController    you, through the webcam, as landmarks (dancer/camera.ts)
//   WanderController    motion matching toward random points on the floor (dancer/wander.ts)
// Wave 1 adds IntentController (a player or NPC through body physics and moves), NetController (the remote player,
// on landmarks) and the brains, which wrap an IntentController.
import type { FrameCtx } from '../engine/frame';
import type { Rig, Skeleton } from '../skeleton/rig';

export interface Controller {
  /** a short name for stats and logs ('mocap', 'landmarks', 'camera', 'wander', …) */
  readonly kind: string;
  /** the rig it poses (a dancer's skeleton is made for it) */
  readonly rig: Rig;
  /** pose `out` (its pos and rot) after `dt` seconds of dance time; ctx.t is the dance time now */
  update(dt: number, ctx: FrameCtx, out: Skeleton): void;
}
