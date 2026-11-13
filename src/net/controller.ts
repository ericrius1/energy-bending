// NetController: a dancer posed by someone else over the network. Each frame it asks the net for that slot's pose
// (the jitter buffer's smooth playback, src/net/net.ts) and lets the landmark retargeter fit the rig to it, so the
// remote player is just another dancer: same skeleton, same matter, same everything (docs/extending/controller.md).
//
// Until the first pose arrives it stands still where it was placed, in a plain standing pose, rather than fitting
// the rig to zeros. After that, if the poses stop, the buffer itself eases to rest and holds the last one.
import { LandmarkController } from '../dancer/landmark';
import type { Rig } from '../skeleton/rig';
import { LM, newLandmarkPose, type LandmarkPose } from '../skeleton/landmarks';
import type { NetLike, RemoteInfo } from './net';

/** a person standing at ease, 1.7 m tall, in the landmarks' frame (x to their left, y up, z forward; metres) */
export function standingPose(out: LandmarkPose = newLandmarkPose()) {
  const put = (i: number, x: number, y: number, z: number) => { out.p[i * 3] = x; out.p[i * 3 + 1] = y; out.p[i * 3 + 2] = z; };
  put(LM.HEAD, 0, 1.62, 0.02);
  put(LM.LS, 0.19, 1.43, 0); put(LM.RS, -0.19, 1.43, 0);
  put(LM.LE, 0.23, 1.14, -0.02); put(LM.RE, -0.23, 1.14, -0.02);
  put(LM.LW, 0.25, 0.88, 0.03); put(LM.RW, -0.25, 0.88, 0.03);
  put(LM.LH, 0.1, 0.95, 0); put(LM.RH, -0.1, 0.95, 0);
  put(LM.LK, 0.11, 0.52, 0.03); put(LM.RK, -0.11, 0.52, 0.03);
  put(LM.LA, 0.12, 0.09, -0.02); put(LM.RA, -0.12, 0.09, -0.02);
  return out;
}

export class NetController extends LandmarkController {
  readonly kind: string = 'net';
  /** what the last frame got: ok, age (ms since the newest pose), flags, energy, world, move */
  info: RemoteInfo = { ok: false };
  /** a pose has arrived at least once */
  seen = false;

  /** slot: whose pose (null: the net's default, the other jogo seat) */
  constructor(rig: Rig, readonly net: NetLike, public slot: number | null = null, pose: LandmarkPose = standingPose()) {
    super(rig, pose);
    this.source = (p) => {
      this.info = this.net.remotePose(p, this.slot ?? undefined);
      if (this.info.ok) this.seen = true;
    };
  }
}
