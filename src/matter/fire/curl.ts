// The tongues' curl (curl.wgsl): a velocity grid round each fire dancer, following its hips, that measures the
// flames' flow and pushes it to curl (vorticity confinement). Four computes in the 'sim' stage before the flames' step
// (scatter, resolve, vorticity, confine); the flames' step reads the push (sim.wgsl). Up to CURL_GRIDS (4) fire
// dancers get a grid, 32 × 64 × 32 cells of 5 cm (16 × 32 × 16 of 10 cm on `coarse`); `fireParams.curl` 0 turns it
// off (the flames then move as they did before it).
import type { Kit, StorageBuffer, UniformBuffer } from '@ericrius1/weft';
import curlShader, { type Curl } from './curl.wgsl';
import type { FrameBuilder, FrameCtx } from '../../engine/frame';
import { LIMITS } from '../../engine/limits';
import { JOINT, JOINT_FLOATS } from '../../skeleton/rig';

const GRIDS = 4;

export class CurlGrids {
  readonly curl: UniformBuffer<Curl>;
  /** the push per cell (xyz, m/s²), read by the flames' step */
  readonly force: StorageBuffer;
  private dims: [number, number, number];
  private cell: number;
  private grids = 0;
  private u = {} as Curl;

  constructor(kit: Kit, frame: FrameBuilder, coarse: boolean, o: { flames: StorageBuffer; homes: StorageBuffer; count: () => number; on: () => boolean }) {
    this.dims = coarse ? [16, 32, 16] : [32, 64, 32];
    this.cell = coarse ? 0.1 : 0.05;
    const cells = this.dims[0] * this.dims[1] * this.dims[2] * GRIDS;
    this.curl = kit.uniforms(curlShader.structs.Curl, 'fire.curl');
    const acc = kit.storage({ label: 'fire.curl.acc', size: cells * 16, usage: ['storage', 'copy-dst'] });
    this.force = kit.storage({ label: 'fire.curl.vel', size: cells * 16, usage: ['storage', 'copy-dst'] });
    const omega = kit.storage({ label: 'fire.curl.omega', size: cells * 16, usage: ['storage'] });
    acc.write(new Int32Array(cells * 4));
    this.force.write(new Float32Array(cells * 4));
    const bind = { curl: this.curl, homes: o.homes, flames: o.flames, acc, vel: this.force, omega };
    const on = () => o.on() && this.grids > 0 && o.count() > 0;
    const n = () => [Math.max(1, this.grids * this.dims[0] * this.dims[1] * this.dims[2])] as [number];
    frame.add('sim', kit.compute(curlShader, { label: 'fire.curl.scatter', entry: 'scatter', bind, threads: () => [Math.max(1, o.count())], enabled: on }), 'fire');
    frame.add('sim', kit.compute(curlShader, { label: 'fire.curl.resolve', entry: 'resolve', bind, threads: n, enabled: on }), 'fire');
    frame.add('sim', kit.compute(curlShader, { label: 'fire.curl.vorticity', entry: 'vorticity', bind, threads: n, enabled: on }), 'fire');
    frame.add('sim', kit.compute(curlShader, { label: 'fire.curl.confine', entry: 'confine', bind, threads: n, enabled: on }), 'fire');
  }

  /** each fire dancer's box, centred on its hips (x, z) and from 1.25 m under them; the grids' uniform */
  update(f: FrameCtx, dancers: readonly number[], count: number, strength: number, maxForce: number) {
    const [dx, dy, dz] = this.dims, h = this.cell;
    const boxes: number[][] = [], grid = new Array(LIMITS.dancers).fill(-1);
    for (const d of dancers) {
      const dn = f.dancers[d];
      if (!dn || boxes.length >= GRIDS) continue;
      const w = dn.skeleton.world, k = JOINT.Hips * JOINT_FLOATS;
      grid[d] = boxes.length;
      boxes.push([w[k] - dx * h / 2, w[k + 1] - 1.25, w[k + 2] - dz * h / 2, h]);
    }
    this.grids = strength > 0 ? boxes.length : 0;
    while (boxes.length < GRIDS) boxes.push([0, 0, 0, h]);
    const u = this.u;
    u.boxes = boxes as Curl['boxes'];
    u.grid = [grid.slice(0, 4), grid.slice(4, 8)] as unknown as Curl['grid'];
    u.dims = [dx, dy, dz, 0];
    u.grids = this.grids; u.count = count; u.strength = strength; u.maxForce = maxForce;
    this.curl.set(u);
  }

  /** whether any grid runs this frame */
  get live() { return this.grids > 0; }
}
