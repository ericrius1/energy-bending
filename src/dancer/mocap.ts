// MocapController: a clip of motion capture (skeleton/clips.ts Track) danced at a place on the floor, turned by a
// yaw, `timeOffset` seconds into it (a canon), optionally on the spot (the root keeps its height but not its travel:
// a ring of dancers). Gem Dancers' Performer.
import { quat, vec3 } from 'math';
import type { Controller } from './controller';
import type { FrameCtx } from '../engine/frame';
import { forward, type Skeleton } from '../skeleton/rig';
import type { Track } from '../skeleton/clips';

const _m_yaw = quat.create();
const _m_root = vec3.create();
const _m_up: [number, number, number] = [0, 1, 0];

export class MocapController implements Controller {
  readonly kind = 'mocap';
  x = 0;
  z = 0;
  yaw = 0;
  inPlace = false;
  constructor(public track: Track, public timeOffset = 0) {}
  get rig() { return this.track.rig; }

  update(_dt: number, f: FrameCtx, out: Skeleton) {
    const p = this.track.sample(f.t + this.timeOffset), root = this.track.rig.joints[0];
    quat.setAxisAngle(_m_yaw, _m_up, this.yaw);
    const travel = this.inPlace ? 0 : 1;
    vec3.set(_m_root, p[0] * travel + root.offset[0], p[1] + root.offset[1], p[2] * travel + root.offset[2]);
    vec3.transformQuat(_m_root, _m_root, _m_yaw);
    _m_root[0] += this.x;
    _m_root[2] += this.z;
    forward(out, _m_root, _m_yaw, p, 3);
  }
}
