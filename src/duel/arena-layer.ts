// The arena's light and its debug lines, a scene layer (engine/scene.ts `sceneLayers`) over whichever world the main
// view shows, drawn only while that world's arena is shown (src/duel/arena.ts `showArena`):
//   the rim light: a faint ribbon in the world's palette round the edge of every top a body can stand on in the space
//     (the arena's pieces and the world's own solids there), round the drops' rims, and, as the 2D lock comes in, along
//     the stage plane's ledges and up its walls, so what can be stood on and slid on reads at a glance. Depth-tested in
//     the glow pass: what is inside the matter is hidden, so it reads as light along the edge the body uses.
//   the debug view (params `arena.debug`, or ?arenaDebug): the arena's data as lines over everything: the plane's ledges
//     (green one-way, yellow solid), walls (cyan; grey if not climbable), its spawns (magenta, a body's height), the kill
//     floor and the ends (red, white), shown as the lock comes in; in 3D the tops a body can stand on (yellow), the
//     spawns, the drops (orange) and the space's circle at the floor and at the kill floor. To check the data against
//     what is drawn.
// Both are built from the arena's data and the solids, so the light is where the physics is. One storage buffer of
// segments, rebuilt when the shown arena changes; two draws (glow phase) in the main view.
import type { Kit, RenderPass } from '@ericrius1/weft';
import shader from './arena-lines.wgsl';
import { sceneLayers, type ScenePhase } from '../engine/scene';
import type { ViewCtx } from '../engine/views';
import type { FrameBuilder } from '../engine/frame';
import { defineParams } from '../engine/params';
import type { Solid } from '../worlds/solids';
import { arenaFor, shownArena } from './arena';
import { arenaSegments, SEG_FLOATS } from './arena-segments';
import { tideAt } from './hazards';


export const arenaParams = defineParams('arena', {
  /** the rim light's strength (× the arena's own colour), and how much it breathes with the beat */
  rim: 1,
  breath: 0.15,
  /** draw the arena's data as lines over everything */
  debug: false,
  /** a rim under the tide is drowned (fades out under the water: 0 draws it as before, for the measure) */
  drown: true,
}, {
  rim: { min: 0, max: 4, label: 'arena rim light' },
  breath: { min: 0, max: 1 },
  debug: { label: 'arena debug lines' },
});

const MAX_SEGS = 8192;

export interface ArenaLayerCtx {
  /** how locked the main view is (0 free … 1 locked): the plane's lines come in with it */
  locked(): number;
  /** a world's solids now (its own and, while the arena is shown, the pieces) */
  solids(world: string): readonly Solid[];
  /** the pieces the near fade dissolves now (worlds/fade.ts NearFade.holes): a rim on one fades with it, unless it is a
   *  top near the pair (report 18) */
  holes?(): Float32Array;
}

class ArenaLayer {
  readonly id = 'duel.arena';
  private buf;
  private u;
  private world: string | null = null;
  private n = { rim: 0, debug: 0 };
  private beat = [0, 0, 0, 0] as [number, number, number, number];
  private rim = [1, 1, 1, 1] as [number, number, number, number];

  constructor(kit: Kit, frame: FrameBuilder, private ctx: ArenaLayerCtx) {
    this.buf = kit.storage({ label: 'arena.lines', size: MAX_SEGS * SEG_FLOATS * 4, usage: ['storage', 'copy-dst'] });
    this.u = kit.uniforms(shader.structs.Look, 'arena.look');
    frame.tick('post', (f) => {
      const w = shownArena();
      if (w !== this.world) this.upload(w);
      if (!w) return;
      this.beat[0] = f.beat.beats - Math.floor(f.beat.beats);
      this.beat[1] = arenaParams.breath;
      this.beat[2] = this.ctx.locked();
      // (the tide's height: a rim under it is drowned, arena-lines.wgsl)
      const H = arenaFor(w)?.hazard;
      this.beat[3] = arenaParams.drown && H?.on && H.kind === 'tide' ? tideAt(H, H.beat) : -1e4;
      this.rim[3] = arenaParams.rim;
      const hole = this.ctx.holes?.();
      this.u.set(hole ? { rim: this.rim, beat: this.beat, hole } : { rim: this.rim, beat: this.beat });
    }, 'the arena rim light');
  }

  private upload(world: string | null) {
    this.world = world;
    const a = world ? arenaFor(world) : null;
    if (!a) { this.n = { rim: 0, debug: 0 }; return; }
    const s = arenaSegments(a, this.ctx.solids(a.world));
    if (s.rim + s.debug > MAX_SEGS) throw new Error(`arena ${world}: ${s.rim + s.debug} line segments (at most ${MAX_SEGS})`);
    this.buf.write(s.data);
    this.n = { rim: s.rim, debug: s.debug };
    const c = a.rim ?? [1, 1, 1];
    this.rim = [c[0], c[1], c[2], arenaParams.rim];
  }

  declareLayer(pass: RenderPass, phase: ScenePhase, view: ViewCtx) {
    if (phase !== 'glow' || view.id !== 'main') return;
    const here = () => view.on() && this.world !== null && this.world === view.world;
    pass.draw(shader, {
      label: 'arena.rim', bind: { segs: this.buf, look: this.u }, count: 6, instances: () => this.n.rim, constants: { RIM: 1 },
      blend: 'add', depthWrite: false, cull: 'none', enabled: () => here() && arenaParams.rim > 0 && this.n.rim > 0,
    });
    pass.draw(shader, {
      label: 'arena.debug', bind: { segs: this.buf, look: this.u }, count: 6, instances: () => this.n.debug, firstInstance: () => this.n.rim,
      constants: { RIM: 0 }, blend: 'add', depthWrite: false, depthCompare: 'always', cull: 'none', enabled: () => here() && arenaParams.debug && this.n.debug > 0,
    });
  }
}

let layer: ArenaLayer | null = null;

/** make the arena's layer (once, before the views' scenes are declared: main.ts) */
export function installArenaLayer(kit: Kit, frame: FrameBuilder, ctx: ArenaLayerCtx, query?: URLSearchParams) {
  if (layer) return layer;
  layer = new ArenaLayer(kit, frame, ctx);
  sceneLayers.register(layer);
  if (query?.has('arenaDebug')) arenaParams.debug = true;
  return layer;
}
