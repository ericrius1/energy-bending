// The gates' draws, per view (portals/surface.wgsl): each view has its own table of the gates in the world it shows
// (a uniform: one value per run, and views differ), filled each frame by the portals; the draws read every slot's
// texture and pick by index. Declared once per view and phase through engine/scene.ts's scene layers: the disc in
// the opaque phase (after every solid thing, so it is hidden by what stands in front of it), the rim, halo, floor
// light and motes in the glow phase.
import type { Kit, RenderPass, Texture, UniformBuffer } from '@ericrius1/weft';
import surfaceShader, { type GateView } from './surface.wgsl';
import type { ScenePhase } from '../engine/scene';
import type { ViewCtx } from '../engine/views';
import { LIMITS } from '../engine/limits';

/** one row of a view's table, as the CPU fills it */
export interface GateRow {
  /** the order rows are drawn in (smallest first; past LIMITS.gates the rest are left out) */
  key?: number;
  at: number[]; right: number[]; up: number[]; n: number[]; rect: number[]; rim: number[]; look: number[]; info: number[]; pokes: number[][];
}

const RING_SEGS = 96;

export class Surfaces {
  private tables = new Map<string, { u: UniformBuffer<GateView>; count: number }>();
  /** motes per gate (fewer on a phone) */
  motes = 96;

  constructor(private kit: Kit, private slots: () => readonly Texture[], private stills: Texture) {}

  /** a view's table (made the first time) */
  table(view: ViewCtx) {
    let t = this.tables.get(view.id);
    if (!t) {
      t = { u: this.kit.uniforms(surfaceShader.structs.GateView, `gates.${view.id}`), count: 0 };
      this.tables.set(view.id, t);
    }
    return t;
  }

  /** this frame's gates in a view (rows in drawing order) */
  fill(view: ViewCtx, rows: GateRow[], time: number, clip: readonly number[]) {
    const t = this.table(view), n = Math.min(rows.length, LIMITS.gates);
    t.count = n;
    t.u.set({ g: rows.slice(0, n).map(({ key: _k, ...r }) => r), clip: [...clip], count: n, motes: this.motes, time } as unknown as Parameters<typeof t.u.set>[0]);
  }

  declareLayer(pass: RenderPass, phase: ScenePhase, view: ViewCtx) {
    const t = this.table(view), id = view.id === 'main' ? '' : `.${view.id}`;
    const tex = () => this.slots();
    const bind = {
      gates: t.u,
      slot0: tex()[0], slot1: tex()[1] ?? tex()[0], slot2: tex()[2] ?? tex()[0], stills: this.stills,
    };
    const on = () => view.on() && t.count > 0;
    if (phase === 'opaque') {
      pass.draw(surfaceShader, { label: `gates.disc${id}`, vertex: 'vs_disc', fragment: 'fs_disc', bind, count: 6, instances: () => t.count, cull: 'none', enabled: on });
    } else if (phase === 'glow') {
      const glow = { bind, blend: 'add' as const, depthWrite: false, cull: 'none' as const, enabled: on };
      pass.draw(surfaceShader, { ...glow, label: `gates.pool${id}`, vertex: 'vs_pool', fragment: 'fs_pool', count: 6, instances: () => t.count });
      pass.draw(surfaceShader, { ...glow, label: `gates.halo${id}`, vertex: 'vs_halo', fragment: 'fs_halo', count: 6, instances: () => t.count });
      pass.draw(surfaceShader, { ...glow, label: `gates.ring${id}`, vertex: 'vs_ring', fragment: 'fs_ring', count: RING_SEGS * 6, instances: () => t.count * 3 });
      pass.draw(surfaceShader, { ...glow, label: `gates.motes${id}`, vertex: 'vs_motes', fragment: 'fs_motes', count: 6, instances: () => t.count * this.motes });
    }
  }
}
