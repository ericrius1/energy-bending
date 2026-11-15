// The gates' draws, per view (portals/surface.wgsl): each view has its own table of the gates in the world it shows
// (a uniform: one value per run, and views differ), filled each frame by the portals; the draws read every slot's
// texture and pick by index. Declared once per view and phase through engine/scene.ts's scene layers: the disc in
// the opaque phase (after every solid thing, so it is hidden by what stands in front of it), the rim, halo, floor
// light and motes in the glow phase. And once, for the main view, the depth of field's window (focus.wgsl,
// `declareFocus`): how far what is seen through each live disc is.
import { Ref, type Kit, type RenderPass, type Texture, type UniformBuffer } from '@ericrius1/weft';
import surfaceShader, { type GateView } from './surface.wgsl';
import focusShader from './focus.wgsl';
import type { ScenePhase } from '../engine/scene';
import type { ViewCtx } from '../engine/views';
import { LIMITS } from '../engine/limits';

/** one row of a view's table, as the CPU fills it */
export interface GateRow {
  /** the order rows are drawn in (smallest first; past LIMITS.gates the rest are left out) */
  key?: number;
  at: number[]; right: number[]; up: number[]; n: number[]; rect: number[]; rim: number[]; look: number[]; info: number[]; pokes: number[][];
  /** the frame's light in this world: the sun (rgb), the sky (w) */
  lite: number[];
}

const RING_SEGS = 96;
/** the frame's vertices per gate (surface.wgsl: 14 tubes of 40 × 6 quads, 7 panes of 5, 40 leaves) */
const FRAME_V = 14 * 40 * 6 * 6 + 7 * 5 * 6 + 40 * 6;

export class Surfaces {
  private tables = new Map<string, { u: UniformBuffer<GateView>; count: number; live: number }>();
  /** motes per gate (fewer on a phone) */
  motes = 96;
  /** how far (m) of the far view's path the disc reports as its distance at the face (the air and the depth of field
   *  read it; see surface.wgsl) */
  face = 1;

  constructor(private kit: Kit, private slots: () => readonly Texture[], private stills: Texture) {}

  /** a view's table (made the first time) */
  table(view: ViewCtx) {
    let t = this.tables.get(view.id);
    if (!t) {
      t = { u: this.kit.uniforms(surfaceShader.structs.GateView, `gates.${view.id}`), count: 0, live: 0 };
      this.tables.set(view.id, t);
    }
    return t;
  }

  /** this frame's gates in a view (rows in drawing order) */
  fill(view: ViewCtx, rows: GateRow[], time: number, clip: readonly number[]) {
    const t = this.table(view), n = Math.min(rows.length, LIMITS.gates);
    t.count = n;
    t.live = rows.slice(0, n).filter((r) => r.n[3] >= 0 && r.info[0] > 0.75).length;
    t.u.set({ g: rows.slice(0, n).map(({ key: _k, ...r }) => r), clip: [...clip], count: n, motes: this.motes, time, face: this.face } as unknown as Parameters<typeof t.u.set>[0]);
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
      pass.draw(surfaceShader, { label: `gates.frame${id}`, vertex: 'vs_frame', fragment: 'fs_frame', bind, count: FRAME_V, instances: () => t.count, cull: 'none', enabled: on });
      pass.draw(surfaceShader, { label: `gates.disc${id}`, vertex: 'vs_disc', fragment: 'fs_disc', bind, count: 6, instances: () => t.count, cull: 'none', enabled: on });
    } else if (phase === 'glow') {
      const glow = { bind, blend: 'add' as const, depthWrite: false, cull: 'none' as const, enabled: on };
      pass.draw(surfaceShader, { ...glow, label: `gates.pool${id}`, vertex: 'vs_pool', fragment: 'fs_pool', count: 6, instances: () => t.count });
      pass.draw(surfaceShader, { ...glow, label: `gates.halo${id}`, vertex: 'vs_halo', fragment: 'fs_halo', count: 6, instances: () => t.count });
      pass.draw(surfaceShader, { ...glow, label: `gates.ring${id}`, vertex: 'vs_ring', fragment: 'fs_ring', count: RING_SEGS * 6, instances: () => t.count * 3 });
      pass.draw(surfaceShader, { ...glow, label: `gates.motes${id}`, vertex: 'vs_motes', fragment: 'fs_motes', count: 6, instances: () => t.count * this.motes });
    }
  }

  /** the depth of field through the gates (focus.wgsl), for one view (the main one): every live gate's rectangle drawn
   *  once more, after the view's scene, into an r16float target that the air reads as a window (PostChain.focusFrom).
   *  `slotFocus`: each slot's view's own translucent focus texture (fire's), or null. Add `pass` to the frame after the
   *  view's scene; `tex` holds something only while `runs()` */
  declareFocus(view: ViewCtx, slotFocus: () => readonly (Texture | null)[], on: () => boolean) {
    const t = this.table(view), kit = this.kit;
    const tex = kit.texture({ label: 'gates.focus', format: 'r16float', size: 'render', scale: view.scale });
    const none = kit.texture({ label: 'gates.focus.none', format: 'r16float', size: [1, 1] });
    const runs = () => on() && view.on() && t.live > 0;
    const slots = this.slots();
    const near = (k: number) => new Ref<Texture>(() => slotFocus()[k] ?? none, `gates.focus.near${k}`);
    const pass = kit.pass({ label: 'gates.focus', color: [{ target: tex, clear: [0, 0, 0, 0] }], enabled: runs });
    pass.draw(focusShader, {
      label: 'gates.focus', vertex: 'vs_disc', fragment: 'fs_focus', count: 6, instances: () => t.count, cull: 'none',
      bind: {
        gates: t.u, slot0: slots[0], slot1: slots[1] ?? slots[0], slot2: slots[2] ?? slots[0], stills: this.stills,
        scene: view.targets.hdr, near0: near(0), near1: near(1), near2: near(2),
      },
    });
    return { tex, pass, runs };
  }
}
