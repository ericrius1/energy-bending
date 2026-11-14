// The HUD's front door. `hud` is the one HUD (whoever runs a mode imports it and calls `hud.set(state)` each frame,
// before the frame is submitted: any tick will do); `installHud` (main.ts) lays it over the stage, draws it once a
// frame as the frame is submitted (a CPU step at the head of the 'out' stage, so every tick's `set` is in), runs the
// demo (`?hud=demo`) or the jogo's beat (`?hud=beat`), and joins it to the captures:
//   bend.grab     the HUD's canvases drawn over the frame read back (`compose`, engine/hooks.ts)
//   a film        the HUD flattened, uploaded into a texture and drawn over the graded frame before it becomes YUV
//                 (`overlay`, called by post/post.ts in the film's grade pass; overlay.wgsl)
// `?hud=0` (or `bend.hud.visible = false`) hides it on screen and in every capture; a film shot's `"hud": false`
// does the same (engine/film-shot.ts). The hooks: `bend.hud` (set, visible, jogoBeat, demo, startDemo, stats, state).
import type { Kit, RenderPass, Texture } from '@ericrius1/weft';
import type { FrameBuilder } from '../engine/frame';
import type { Dancer } from '../dancer/dancer';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import overlayShader from './overlay.wgsl';
import { Hud } from './hud';
import { HudDemo } from './demo';
import { JogoBeat } from './jogo';
import type { HudState } from './state';

export type { HudState, HudPlayer, HudPop, HudCombo, HudLink, HudShared, HudSet, HudBeat, HudMode, PopKind, LinkKind } from './state';
export { emptyHud, emptyCombo, screenOf, LINK_KINDS } from './state';

/** the one HUD */
export const hud = new Hud();

export interface HudCtx {
  kit: Kit;
  frame: FrameBuilder;
  /** the WebGPU canvas it lies over */
  stage: HTMLCanvasElement;
  query: URLSearchParams;
  film: boolean;
  /** the dancers (the demo's tags ride the first two framed ones) */
  dancers: () => readonly Dancer[];
}

/** the matter a dancer mostly wears */
const matterOf = (d: Dancer) => {
  const ls = d.loadout?.layers ?? [];
  let best = ls[0];
  for (const l of ls) if ((l.share ?? 0) > (best?.share ?? 0)) best = l;
  return best?.kind ?? 'gems';
};

export function installHud(c: HudCtx) {
  const q = c.query.get('hud');
  if (q === '0' || q === 'off') hud.visible = false;
  let demo: HudDemo | null = q === 'demo' || q === 'demo2' ? new HudDemo() : null;
  const jogo = new JogoBeat();
  let jogoBeat = q === 'beat';
  // the pixel ratio to draw at: the device's (at least the canvas's own), or a film's render scale
  hud.mount(c.stage, () => {
    const w = c.stage.clientWidth || innerWidth;
    if (c.film) return Math.max(1, c.kit.size.render[0] / w);
    return Math.min(3, Math.max(globalThis.devicePixelRatio || 1, c.kit.size.canvas[0] / w));
  });

  let dt = 1 / 60;
  c.frame.tick('post', (f) => {
    dt = f.dt;
    if (demo) {
      const ds = c.dancers().filter((d) => d.framed).slice(0, 2);
      const at = (d: Dancer, j: number) => d.skeleton.world.subarray(j * JOINT_FLOATS, j * JOINT_FLOATS + 3);
      const heads = ds.map((d) => at(d, JOINT.Head));
      const hands = ds.map((d) => [at(d, JOINT.LeftHand), at(d, JOINT.RightHand)]);
      hud.set(demo.update({ dt: f.dt, beat: f.beat, heads, hands, matters: ds.map(matterOf), viewProj: c.kit.camera.viewProj }));
      return;
    }
    const s = jogo.update(jogoBeat, (globalThis as { bend?: { jogo?: Parameters<JogoBeat['update']>[1] } }).bend?.jogo);
    if (s) hud.set(s);
  }, 'hud: the demo, the jogo\'s beat');

  // drawn as the frame is submitted (after every tick's set); filming, uploaded for the composite over the grade
  let tex: Texture | null = null;
  c.frame.add('out', c.kit.action(() => {
    hud.frame(dt);
    if (tex && hud.drawn) {
      const t0 = performance.now();
      tex.writeImage(hud.flatten(tex.width, tex.height), { premultiply: true });
      hud.account(performance.now() - t0);
    }
  }, 'hud'), 'hud');

  /** the film's grade pass calls this: the HUD drawn over the graded frame */
  const overlay = (pass: RenderPass) => {
    tex = c.kit.texture({ label: 'hud', format: 'rgba8unorm', size: 'render', usage: ['sample', 'copy-dst', 'render'] });
    pass.fullscreen(overlayShader, { label: 'hud', fragment: 'fs_hud', bind: { hudTex: tex }, blend: 'premultiplied', enabled: () => hud.drawn });
  };

  const api = {
    hud,
    set: (s: HudState) => hud.set(s),
    get state() { return hud.current; },
    get visible() { return hud.visible; },
    set visible(v: boolean) { hud.visible = v; },
    /** the jogo's beat indicator (mode 'jogo'), off by default */
    get jogoBeat() { return jogoBeat; },
    set jogoBeat(v: boolean) { jogoBeat = v; },
    get demo() { return demo; },
    /** run the demo state from now (false stops it and clears the HUD) */
    startDemo(on = true) { demo = on ? new HudDemo() : null; if (!on) hud.set({ ...hud.current, mode: 'none' }); return demo; },
    stats: (reset = false) => hud.stats(reset),
  };
  return { hud, api, overlay, compose: (g: CanvasRenderingContext2D, w: number, h: number) => hud.compose(g, w, h) };
}
