// The shared body buffers: every dancer's joints (uploaded each frame) and capsules (uploaded when the cast changes),
// a small uniform saying how many dancers there are, and the hand (matter/core/touch.ts). They are one bind group,
// group 3, shared by weft with every shader that includes matter/core/body.wgsl, so a new matter kind reads them
// without binding anything: `joints[d * MAXJ + j]`, `segs[d * SEGS + s]`, `homeOf(home, i, step)`.
import type { Kit, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import bodyShader, { type Bodies, type Touch } from './body.wgsl';
import { LIMITS } from '../../engine/limits';
import { JOINT_FLOATS, MAXJ, type Rig } from '../../skeleton/rig';
import { segmentTable } from './capsules';
import { seatTints, tickSeatTints } from './seats';
import type { Dancer } from '../../dancer/dancer';

const SEG_FLOATS = 16;

export class BodyBuffers {
  readonly joints: StorageBuffer;
  readonly segs: StorageBuffer;
  readonly bodies: UniformBuffer<Bodies>;
  readonly touch: UniformBuffer<Touch>;
  private jointData = new Float32Array(LIMITS.dancers * MAXJ * JOINT_FLOATS);
  private segData = new Float32Array(LIMITS.dancers * LIMITS.capsules * SEG_FLOATS);
  private _bodies = { dancers: 0, floorY: 0, time: 0, seat: new Float32Array(LIMITS.dancers * 4) };
  /** dancers on the GPU this frame */
  count = 0;

  constructor(private kit: Kit) {
    this.joints = kit.storage({ label: 'bodies.joints', size: this.jointData.byteLength });
    this.segs = kit.storage({ label: 'bodies.segs', size: this.segData.byteLength });
    this.bodies = kit.uniforms(bodyShader.structs.Bodies, 'bodies');
    this.touch = kit.uniforms(bodyShader.structs.Touch, 'touch');
    kit.shareGroup(3, bodyShader, { joints: this.joints, segs: this.segs, bodies: this.bodies, touch: this.touch }, 'bodies');
  }

  /** the cast changed: each dancer's capsules, in slot order */
  setRigs(rigs: readonly Rig[]) {
    rigs.slice(0, LIMITS.dancers).forEach((rig, d) => segmentTable(rig, this.segData, d * LIMITS.capsules * SEG_FLOATS));
    this.segs.write(this.segData);
  }

  /** each frame: the dancers' joints up to the GPU (only the slots in use) */
  upload(dancers: readonly Dancer[], time: number) {
    const D = Math.min(dancers.length, LIMITS.dancers);
    for (let d = 0; d < D; d++) this.jointData.set(dancers[d].skeleton.world, d * MAXJ * JOINT_FLOATS);
    if (D) this.kit.queue.writeBuffer(this.joints.gpu, 0, this.jointData.buffer, 0, D * MAXJ * JOINT_FLOATS * 4);
    this.count = D;
    this._bodies.dancers = D;
    this._bodies.time = time;
    // (who each body is, worn in its matter: matter/core/seats.ts)
    this._bodies.seat.set(seatTints());
    tickSeatTints();
    this.bodies.set(this._bodies);
  }
}
