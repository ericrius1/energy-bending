// The post chain (Gem Dancers'): per view the light in the air (air.wgsl, lit as the view's world lights it); then for
// the main view depth of field, trails, a bloom chain of five levels and the grade to the canvas, or for a film the
// grade into a texture brought down to YUV 4:2:0 on the GPU (yuv.wgsl) for scripts/film.mjs. A second view can be
// shown in an inset over the canvas (`inset`).
import type { Kit, RenderPass, Texture, UniformBuffer } from '@ericrius1/weft';
import postShader, { type Post as PostU } from './post.wgsl';
import airShader from './air.wgsl';
import yuvShader from './yuv.wgsl';
import type { FrameBuilder, FrameCtx, Stage } from '../engine/frame';
import type { ViewCtx } from '../engine/views';
import type { World } from '../worlds/world';
import { defineParams, onParams } from '../engine/params';

export const postParams = defineParams('post', {
  exposure: 1.08,
  bloom: 0.22,
  threshold: 2,
  bloomRadius: 1.2,
  trailFx: 0.2,
  decay: 0.75,
  drift: 0.0005,
  vignette: 0.45,
  grain: 0.035,
  aberration: 0.002,
  saturation: 1,
  contrast: 1,
  tonemap: 'ACES',
  dof: true,
  blur: 5,
}, {
  exposure: { min: 0.1, max: 4 },
  bloom: { min: 0, max: 2 },
  dof: { label: 'depth of field' },
  tonemap: { options: ['ACES', 'AgX'] },
});

export class PostChain {
  readonly post: UniformBuffer<PostU>;
  /** the film's YUV planes (null unless filming) */
  readonly planes;
  private _post = { exposure: 1, focus: 4 };
  private filmSize: [number, number] | null;
  /** the depth-of-field pass (main view): a kind's `declarePost` adds draws to it, which land after the lens's own
   *  fullscreen draw, on the focused image (translucent matter the depth of field can't place: steam) */
  readonly lens: RenderPass;
  /** the main view's scene after the air: rgb, and in alpha the view distance (what declarePost draws test against) */
  readonly sceneTex: Texture;

  constructor(private kit: Kit, private frame: FrameBuilder, main: ViewCtx, worlds: readonly World[], o: { film?: [number, number] | null; coarse?: boolean }) {
    this.filmSize = o.film ?? null;
    if (o.coarse) postParams.dof = false;
    this.post = kit.uniforms(postShader.structs.Post, 'post');
    this.upload();
    onParams(postParams, () => this.upload());
    this.declareAir(main, worlds);

    const tex = (label: string, scale = 1) => kit.texture({ label, format: 'rgba16float', size: 'render', scale });
    const lensTex = tex('lens');
    const history = kit.pingpong((i) => tex(`trail${i}`), 'trail');
    const blooms = [0.5, 0.25, 0.125, 0.0625, 0.03125].map((s, i) => tex(`bloom${i}`, s));
    const add = (p: RenderPass) => frame.add('post', p, 'post');
    const lens = kit.pass({ label: 'lens', color: [{ target: lensTex }] });
    lens.fullscreen(postShader, { label: 'lens', fragment: 'fs_dof', bind: { post: this.post, src: main.targets.air } });
    add(lens);
    this.lens = lens;
    this.sceneTex = main.targets.air;
    const trail = kit.pass({ label: 'trail', color: [{ target: history.write }] });
    trail.fullscreen(postShader, { label: 'trail', fragment: 'fs_trail', bind: { post: this.post, src: lensTex, prev: history.read } });
    add(trail);
    for (let i = 0; i < blooms.length; i++) {
      const p = kit.pass({ label: `bloom.down${i}`, color: [{ target: blooms[i] }] });
      p.fullscreen(postShader, { label: `bloom.down${i}`, fragment: 'fs_down', constants: { FIRST: i === 0 ? 1 : 0 }, bind: { post: this.post, src: i === 0 ? history.write : blooms[i - 1] } });
      add(p);
    }
    for (let i = blooms.length - 2; i >= 0; i--) {
      const p = kit.pass({ label: `bloom.up${i}`, color: [{ target: blooms[i], clear: false }] });
      p.fullscreen(postShader, { label: `bloom.up${i}`, fragment: 'fs_up', blend: 'add', bind: { post: this.post, src: blooms[i + 1] } });
      add(p);
    }
    if (!this.filmSize) {
      const out = kit.pass({ label: 'grade', color: [{ target: 'screen' }] });
      out.fullscreen(postShader, { label: 'grade', fragment: 'fs_out', bind: { post: this.post, src: history.write, bloomTex: blooms[0] } });
      frame.add('out', out, 'post');
      this.planes = null;
    } else {
      // a film grades into a texture, brings it down to the film's size as YUV 4:2:0 and reads that back
      const [W, H] = this.filmSize;
      const filmTex = kit.texture({ label: 'film', format: 'rgba8unorm', size: 'render', usage: ['render', 'copy-src', 'sample'] });
      const outFilm = kit.pass({ label: 'grade.film', color: [{ target: filmTex }] });
      outFilm.fullscreen(postShader, { label: 'grade.film', fragment: 'fs_out', bind: { post: this.post, src: history.write, bloomTex: blooms[0] } });
      const yuvU = kit.uniforms(yuvShader.structs.Yuv, 'film.yuv');
      this.planes = kit.storage({ label: 'film.yuv', size: W * H * 1.5, usage: ['storage', 'copy-src'] });
      const toYuv = kit.compute(yuvShader, { label: 'film.yuv', threads: [(W * H * 1.5) / 4], bind: { yuv: yuvU, src: filmTex, planes: this.planes } });
      frame.add('out', outFilm, 'post');
      frame.add('out', toYuv, 'post');
      frame.tick('post', () => { yuvU.set({ size: [W, H], src: [filmTex.width, filmTex.height] }); }, 'post: film size');
    }
    frame.add('end', history.swap, 'post');
  }

  /** the main view's exposure (× postParams.exposure): its world's own, unless something leans it (src/portals: as a
   *  gate fills the screen the exposure leans toward the far world's) */
  exposureOf: (world: World) => number = (w) => w.exposure();

  /** a view's air pass: one draw per world, each enabled while the view shows that world (a gate's view puts it in
   *  the 'gates' stage, before the scene that shows it) */
  declareAir(view: ViewCtx, worlds: readonly World[], stage: Stage = 'air') {
    const pass = this.kit.pass({ label: view.id === 'main' ? 'air' : `air.${view.id}`, color: [{ target: view.targets.air }], view: view.id === 'main' ? undefined : view.view, enabled: view.on });
    for (const w of worlds) {
      pass.fullscreen(airShader, { label: `air.${w.id}${view.id === 'main' ? '' : `.${view.id}`}`, bind: { src: view.targets.hdr }, constants: { WORLD: w.light }, enabled: () => view.world === w.id });
    }
    this.frame.add(stage, pass, 'post');
  }

  /** show a view in a corner of the canvas: `rect` gives [x, y, w, h] as fractions of the canvas */
  inset(view: ViewCtx, rect: () => [number, number, number, number]) {
    const pass = this.kit.pass({
      label: `inset.${view.id}`, color: [{ target: 'screen', clear: false }], enabled: view.on,
      viewport: () => { const [w, h] = this.kit.size.canvas, r = rect(); return [r[0] * w, r[1] * h, r[2] * w, r[3] * h, 0, 1]; },
    });
    pass.fullscreen(postShader, { label: `inset.${view.id}`, fragment: 'fs_inset', bind: { post: this.post, src: view.targets.air } });
    this.frame.add('out', pass, 'post');
  }

  private upload() {
    const P = postParams;
    this.post.set({
      exposure: P.exposure, bloom: P.bloom, threshold: P.threshold, radius: P.bloomRadius, trail: P.trailFx, decay: P.decay, drift: P.drift,
      vignette: P.vignette, grain: P.grain, aberration: P.aberration, saturation: P.saturation, contrast: P.contrast, tonemap: P.tonemap === 'AgX' ? 1 : 0,
      blur: P.dof ? P.blur : 0,
    });
  }

  /** each frame: the exposure the main view's world wants, and the focus on what the camera looks at */
  update(_f: FrameCtx, world: World, focus: number) {
    this._post.exposure = postParams.exposure * this.exposureOf(world);
    this._post.focus = focus;
    this.post.set(this._post);
  }

  /** a film's frame: read back the YUV planes (one buffer reused frame after frame) */
  private filmRead: GPUBuffer | null = null;
  private filmOut: Uint8Array<ArrayBuffer> | null = null;
  async grabYuv() {
    if (!this.planes || !this.filmSize) throw new Error('grabYuv: not filming (?film)');
    const bytes = this.filmSize[0] * this.filmSize[1] * 1.5;
    if (!this.filmRead) {
      this.filmRead = this.kit.device.createBuffer({ label: 'film.read', size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      this.filmOut = new Uint8Array(bytes);
    }
    const enc = this.kit.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.planes.gpu, 0, this.filmRead, 0, bytes);
    this.kit.queue.submit([enc.finish()]);
    await this.filmRead.mapAsync(GPUMapMode.READ);
    this.filmOut!.set(new Uint8Array(this.filmRead.getMappedRange()));
    this.filmRead.unmap();
    return this.filmOut!;
  }
}

export type { Texture };
