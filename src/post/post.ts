// The post chain (Gem Dancers', reworked around the frame's depth contract). Per view: the world's surface step on the
// opaque scene (the pool's and the temple's water, the forge's heat), then the light in the air with the glowing
// matter laid over it (air.wgsl). For the main view also: the glow's trails (before the air, so only glowing matter
// leaves them), the lens (depth of field gathered at half resolution, placed by the focus target, focused on the
// dancers the view frames), a bloom chain with a warm, wide halo, and the grade (the tone map, then the world's own
// grade: World.grade) to the canvas, or for a film into a texture brought down to YUV 4:2:0 on the GPU (yuv.wgsl) for
// scripts/film.mjs. A second view can be shown in an inset over the canvas (`inset`).
//
// The depth contract, in one place (air.wgsl says it in full): a view's scene target `hdr` holds the opaque scene and
// in alpha the opaque view distance, written by opaque draws only (engine/scene.ts keeps blended draws off it); its
// `glow` target holds what translucent matter added; translucent kinds may hand over focus textures (MatterPasses
// .focus). Surfaces, reflections and fog read the opaque distance; the depth of field reads the focus target, the
// nearer of the opaque distance and the translucent matter's.
import { Ref, type Kit, type RenderPass, type Texture, type UniformBuffer } from '@ericrius1/weft';
import postShader, { type Post as PostU } from './post.wgsl';
import airShader, { type AirView } from './air.wgsl';
import yuvShader from './yuv.wgsl';
import type { FrameBuilder, FrameCtx, Stage } from '../engine/frame';
import type { ViewCtx } from '../engine/views';
import { focusSources } from '../engine/scene';
import type { Dancer } from '../dancer/dancer';
import type { Grade, World } from '../worlds/world';
import { defineParams, onParams, hex } from '../engine/params';
import { matterKinds } from '../matter/core/kind';
import { JOINT } from '../skeleton/rig';
import { gradeOf, gradeIdentity, PROPOSED_GRADES, type GradeValues } from './grade';
import { budget } from '../engine/perf';

export const postParams = defineParams('post', {
  exposure: 1.08,
  bloom: 0.22,
  threshold: 2,
  bloomRadius: 1.2,
  /** the halo's colour: 1 as its source, more to carry its hue outward (a white-hot flame core blooms orange) */
  bloomSat: 1.6,
  /** how much each wider bloom level adds (1: each as much as the last) */
  bloomWide: 1.15,
  /** the tint the widest levels take: the far halo round a hot core is warm */
  bloomWarm: 0.25,
  trailFx: 0.2,
  decay: 0.75,
  drift: 0.0005,
  /** how far (px) the glow's past is spread each frame: older copies melt into a streak instead of standing apart */
  smear: 2.2,
  vignette: 0.45,
  grain: 0.035,
  aberration: 0.002,
  saturation: 1,
  contrast: 1,
  tonemap: 'ACES',
  dof: true,
  blur: 5,
  /** what the lens focuses on: the dancers the view frames, or (as before) the point the camera looks at */
  focusOn: 'dancers',
  /** how fast the focus follows the dancers (s); a cut, a crossing or a camera jump snaps it */
  focusEase: 0.2,
  /** the most blur (px) either of two dancers at different distances may take: the lens opens less to hold both */
  holdBoth: 1.2,
  /** the proposed grades (src/post/grade.ts) for worlds that set none, to judge them; off: every world as it sets */
  proposals: false,
  /** a test of the focus path (m, 0 off): a stand-in focus texture, a disc of that distance in the middle */
  focusStub: 0,
  /** the highlight shoulder (post.wgsl toneMap): how much, the peak where it starts and where it is whole, and the
   *  peak past which a colour may go white (all white at 4 ×): hot cores keep their hue and structure */
  shoulder: 0.8,
  shoulderFrom: 2,
  shoulderTo: 6,
  whiteFrom: 10,
  /** the bloom's curve: the most one pixel gives the halo (what passes the threshold rolls off toward it), and the
   *  knee as a share of the threshold */
  bloomCap: 3,
  bloomKnee: 0.6,
  /** light behind a water or ice body (when the body says nothing itself): how much shows through, and its tint */
  through: 0.3,
  throughTint: '#8fd0ff',
  /** how much fire's mirror copy on the water is bent by the waves (0: a still mirror) */
  mirrorBend: 1,
  /** the locked view's stage dim, for testing (the camera rig sets PostChain.stage; this adds to it): how much, and
   *  how much darker and softer (px) what lies beyond the stage gets at full dim */
  stageDim: 0,
  stageDarken: 0.45,
  stageSoften: 2.5,
}, {
  exposure: { min: 0.1, max: 4 },
  bloom: { min: 0, max: 2 },
  bloomSat: { min: 0, max: 3 },
  bloomWide: { min: 0.5, max: 2 },
  bloomWarm: { min: 0, max: 1 },
  smear: { min: 0, max: 6 },
  dof: { label: 'depth of field' },
  tonemap: { options: ['ACES', 'AgX'] },
  focusOn: { options: ['dancers', 'look'] },
  focusEase: { min: 0, max: 1 },
  holdBoth: { min: 0.3, max: 5 },
  focusStub: { min: 0, max: 20 },
  shoulder: { min: 0, max: 1 },
  shoulderFrom: { min: 0.2, max: 4 },
  shoulderTo: { min: 0.5, max: 8 },
  whiteFrom: { min: 1, max: 40 },
  bloomCap: { min: 0.2, max: 40 },
  bloomKnee: { min: 0.05, max: 1 },
  through: { min: 0, max: 1, label: 'light through water' },
  mirrorBend: { min: 0, max: 1, label: "fire's reflection bent" },
  stageDim: { min: 0, max: 1, label: 'stage dim (test)' },
  stageDarken: { min: 0, max: 1 },
  stageSoften: { min: 0, max: 8 },
});

/** how many focus textures the air binds (each is one sampled texture in the air's fragment stage) */
export const FOCUS_SLOTS = 3;

/** What a translucent body kind (water, ice) may hand the air besides its focus texture, so a light behind it (fire)
 *  is seen through it the way the body says: `body(view)` on its MatterPasses, an rgba16float texture of any size:
 *    r   the body's view distance (≥ 1e4: no body here; compare against it, never do arithmetic on it)
 *    g   how much of what lies behind it shows through (0 … 1)
 *    b a a screen offset (in the view's uv) to read what lies behind from: its refraction (0, 0: none)
 *  Without one the air takes the body's focus texture as its distance, postParams.through and throughTint, and no
 *  offset (air.wgsl glowSeen). */
export interface BodySource { body?(view: ViewCtx): Texture | null }

/** the kinds whose focus texture is a body's (matter that hides what is behind it) rather than a light's (matter that
 *  adds light into the glow target: fire, plasma). A kind not named here is a light */
export const BODY_KINDS: ReadonlySet<string> = new Set(['water', 'ice']);

/** whether a world lays something over its scene before the air (worlds/light.wgsl worldScene: the pool's water (2),
 *  the temple's tide (3), the forge's heat (4)); keep in step with that switch */
const sceneStep = (w: World | undefined) => !!w && w.light >= 2 && w.light <= 4;

export class PostChain {
  readonly post: UniformBuffer<PostU>;
  /** the film's YUV planes (null unless filming) */
  readonly planes;
  private _post = { exposure: 1, focus: 4, blur: 5, stage: [0, 0, 0, 0] };
  /** the stage dim on screen now (eased toward what is asked) */
  private stageNow = 0;
  private filmSize: [number, number] | null;
  /** the depth-of-field composite (main view): a kind's `declarePost` adds draws to it, which land after the lens's
   *  own fullscreen draw, on the focused image (translucent matter the depth of field can't place: steam) */
  readonly lens: RenderPass;
  /** the main view's scene after the air: rgb, and in alpha the opaque view distance (what declarePost draws test
   *  against) */
  readonly sceneTex: Texture;
  /** the main view's focus target (r16float): the distance the depth of field places each pixel at */
  readonly focusTex: Texture;
  /** the points the main view frames: each dancer's hips and head where this view sees it (engine/seen.wgsl, filled
   *  by src/portals: a dancer in this world where it stands, one half way through a gate carried by the gate's move,
   *  nothing beyond a door), as [x, y, z] in the view's world */
  framed: (view: ViewCtx, dancers: readonly Dancer[]) => [number, number, number][] = (view, dancers) => {
    const out: [number, number, number][] = [];
    const seen = view.seen.get('d') as { x: number[]; y: number[]; z: number[]; clip: number[] }[] | undefined;
    dancers.forEach((d, i) => {
      const s = seen?.[i], J = d.skeleton.world;
      for (const j of [JOINT.Hips, JOINT.Head]) {
        const o = j * 12, x = J[o], y = J[o + 1], z = J[o + 2];
        if (!s) { if (d.world === view.world || d.world === '') out.push([x, y, z]); continue; }
        const p: [number, number, number] = [
          s.x[0] * x + s.x[1] * y + s.x[2] * z + s.x[3], s.y[0] * x + s.y[1] * y + s.y[2] * z + s.y[3], s.z[0] * x + s.z[1] * y + s.z[2] * z + s.z[3]];
        if (s.clip[0] * p[0] + s.clip[1] * p[1] + s.clip[2] * p[2] + s.clip[3] >= 0) out.push(p);
      }
    });
    return out;
  };
  private emptyFocus: Texture;
  /** a stand-in for a body texture (none handed over) and for a gate view's glow when its glow pass is skipped */
  private emptyRgba: Texture;
  private extraFocus = new Map<ViewCtx, (() => Texture | null)[]>();
  /** the locked view's stage dim, set by the camera rig each frame (default 0: no change): `dim` 0 … 1, eased with
   *  the lock (CameraRig.locked × a taste), `at` the stage's focus plane's distance from the eye (m; 0: the lens's focus
   *  distance). What lies beyond the plane darkens and softens a little (postParams.stageDarken, stageSoften) */
  stage = { dim: 0, at: 0 };
  /** add a focus source to a view besides its kinds' (a gate's disc: the far view's focus distance where the disc is,
   *  in an r16float texture of any size, ≥ 1e4 where there is nothing). It takes one of the FOCUS_SLOTS and counts as
   *  a light's (it hides nothing behind it) */
  focusFrom(view: ViewCtx, source: () => Texture | null) {
    const list = this.extraFocus.get(view) ?? [];
    list.push(source);
    this.extraFocus.set(view, list);
  }
  private stub: { tex: Texture; pass: RenderPass } | null = null;

  constructor(private kit: Kit, private frame: FrameBuilder, private main: ViewCtx, worlds: readonly World[], o: { film?: [number, number] | null; coarse?: boolean }) {
    this.filmSize = o.film ?? null;
    if (!budget().dof) postParams.dof = false;
    this.post = kit.uniforms(postShader.structs.Post, 'post');
    this.grade = gradeIdentity();
    this.upload();
    onParams(postParams, () => this.upload());

    const tex = (label: string, scale = 1, format: GPUTextureFormat = 'rgba16float') => kit.texture({ label, format, size: 'render', scale });
    // (a focus slot with no texture reads 0, which the air takes as "nothing here")
    this.emptyFocus = kit.texture({ label: 'focus.none', format: 'r16float', size: [1, 1] });
    this.emptyRgba = kit.texture({ label: 'air.none', format: 'rgba16float', size: [1, 1] });
    this.focusTex = tex('focus', 1, 'r16float');
    const add = (p: RenderPass, stage: Stage = 'post') => frame.add(stage, p, 'post');

    // the glow's trails (main view), before its air
    const trails = kit.pingpong((i) => tex(`glow.trail${i}`), 'glow.trail');
    const trail = kit.pass({ label: 'glow.trail', color: [{ target: trails.write }] });
    trail.fullscreen(postShader, { label: 'glow.trail', fragment: 'fs_glowtrail', bind: { post: this.post, src: main.targets.glow, prev: trails.read } });
    add(trail, 'air');
    this.declareAir(main, worlds, 'air', trails.write);
    this.stubFocus(worlds);

    // the lens: down to half (colour, nearest distance), the gather there, the composite at full resolution
    const half = tex('lens.half', 0.5), blurred = tex('lens.blur', 0.5), lensTex = tex('lens');
    // (the stage dim softens with the gather even when the depth of field is off)
    const dofOn = () => (postParams.dof && postParams.blur > 0) || (this.stageNow > 0 && postParams.stageSoften > 0);
    const down = kit.pass({ label: 'lens.down', color: [{ target: half }], enabled: dofOn });
    down.fullscreen(postShader, { label: 'lens.down', fragment: 'fs_lensdown', bind: { post: this.post, src: main.targets.air, focusTex: this.focusTex } });
    add(down);
    const gather = kit.pass({ label: 'lens.gather', color: [{ target: blurred }], enabled: dofOn });
    gather.fullscreen(postShader, { label: 'lens.gather', fragment: 'fs_lensgather', bind: { post: this.post, src: half } });
    add(gather);
    const lens = kit.pass({ label: 'lens', color: [{ target: lensTex }] });
    lens.fullscreen(postShader, { label: 'lens', fragment: 'fs_dof', bind: { post: this.post, src: main.targets.air, focusTex: this.focusTex, blurTex: blurred } });
    add(lens);
    this.lens = lens;
    this.sceneTex = main.targets.air;

    const blooms = [0.5, 0.25, 0.125, 0.0625, 0.03125].map((s, i) => tex(`bloom${i}`, s));
    for (let i = 0; i < blooms.length; i++) {
      const p = kit.pass({ label: `bloom.down${i}`, color: [{ target: blooms[i] }] });
      p.fullscreen(postShader, { label: `bloom.down${i}`, fragment: 'fs_down', constants: { FIRST: i === 0 ? 1 : 0 }, bind: { post: this.post, src: i === 0 ? lensTex : blooms[i - 1] } });
      add(p);
    }
    for (let i = blooms.length - 2; i >= 0; i--) {
      const p = kit.pass({ label: `bloom.up${i}`, color: [{ target: blooms[i], clear: false }] });
      // (the two widest steps take the warm tint)
      p.fullscreen(postShader, { label: `bloom.up${i}`, fragment: 'fs_up', blend: 'add', constants: { WIDE: i >= 2 ? 1 : 0 }, bind: { post: this.post, src: blooms[i + 1] } });
      add(p);
    }
    if (!this.filmSize) {
      const out = kit.pass({ label: 'grade', color: [{ target: 'screen' }] });
      out.fullscreen(postShader, { label: 'grade', fragment: 'fs_out', bind: { post: this.post, src: lensTex, bloomTex: blooms[0] } });
      frame.add('out', out, 'post');
      this.planes = null;
    } else {
      // a film grades into a texture, brings it down to the film's size as YUV 4:2:0 and reads that back
      const [W, H] = this.filmSize;
      const filmTex = kit.texture({ label: 'film', format: 'rgba8unorm', size: 'render', usage: ['render', 'copy-src', 'sample'] });
      const outFilm = kit.pass({ label: 'grade.film', color: [{ target: filmTex }] });
      outFilm.fullscreen(postShader, { label: 'grade.film', fragment: 'fs_out', bind: { post: this.post, src: lensTex, bloomTex: blooms[0] } });
      const yuvU = kit.uniforms(yuvShader.structs.Yuv, 'film.yuv');
      this.planes = kit.storage({ label: 'film.yuv', size: W * H * 1.5, usage: ['storage', 'copy-src'] });
      const toYuv = kit.compute(yuvShader, { label: 'film.yuv', threads: [(W * H * 1.5) / 4], bind: { yuv: yuvU, src: filmTex, planes: this.planes } });
      frame.add('out', outFilm, 'post');
      frame.add('out', toYuv, 'post');
      frame.tick('post', () => { yuvU.set({ size: [W, H], src: [filmTex.width, filmTex.height] }); }, 'post: film size');
    }
    frame.add('end', trails.swap, 'post');
  }

  /** the main view's exposure (× postParams.exposure): its world's own, unless something leans it (src/portals: as a
   *  gate fills the screen the exposure leans toward the far world's) */
  exposureOf: (world: World) => number = (w) => w.exposure();

  /** a view's air: one draw per world, each enabled while the view shows that world (air.wgsl says what each step
   *  is for). In the 'air' stage (the main view, the inset): the world's surface step and air on the opaque scene, in
   *  'surface', copied back over the scene, so the water bodies composited at the start of 'air' (matter/water)
   *  refract the finished world; then the merge (the opaque scene with the bodies in it) and the air over that, so the
   *  pool mirrors the bodies. A gate's view (stage 'gates', before the scene that shows it) has no water bodies: the
   *  air alone. `glow`: what to lay over the scene (the main view's trails; by default the view's glow target) */
  declareAir(view: ViewCtx, worlds: readonly World[], stage: Stage = 'air', glow?: Texture | Ref<Texture>) {
    const main = view === this.main, own = stage === 'air', id = main ? '' : `.${view.id}`;
    const vw = main ? undefined : view.view, kit = this.kit;
    const sources = focusSources(view);
    // the slots are filled each frame from the kinds that hand over a texture now (water and ice share one pool and
    // one surface: only the pool's primary kind returns it), so a kind that returns null takes no slot
    let warned = false;
    // each slot is a body's (water, ice) or a light's (fire, a gate disc's far view): the air tells them apart
    const textures = () => {
      const t: { tex: Texture; body: boolean }[] = [];
      for (const m of sources) { const x = m.focus?.(view); if (x) t.push({ tex: x, body: BODY_KINDS.has(m.id) }); }
      for (const f of this.extraFocus.get(view) ?? []) { const x = f(); if (x) t.push({ tex: x, body: false }); }
      if (main && this.stub && postParams.focusStub > 0) t.splice(FOCUS_SLOTS - 1, 0, { tex: this.stub.tex, body: false });
      if (t.length > FOCUS_SLOTS && !warned) { warned = true; console.warn(`post: ${t.length} focus textures in view ${view.id}, more than FOCUS_SLOTS (${FOCUS_SLOTS}); the rest are left out`); }
      return t;
    };
    const slot = (k: number) => new Ref<Texture>(() => textures()[k]?.tex ?? this.emptyFocus, `focus${k}${id}`);
    // the first body kind that says more about itself (BodySource), else the stand-in
    const bodyOf = () => { for (const m of sources) { const b = (m as BodySource).body?.(view); if (b) return b; } return null; };
    const bodyTex = new Ref<Texture>(() => bodyOf() ?? this.emptyRgba, `air.body${id}`);
    const airv = kit.uniforms(airShader.structs.AirView, `air.view${id}`);
    const vals: AirView = { bodies: 0, hasBody: 0, through: 0, bend: 0, tint: [1, 1, 1, 0] };
    this.frame.tick('post', () => {
      const t = textures(), P = postParams, c = hex(P.throughTint);
      vals.bodies = t.slice(0, FOCUS_SLOTS).reduce((m, x, k) => m | (x.body ? 1 << k : 0), 0);
      vals.hasBody = bodyOf() ? 1 : 0;
      vals.through = P.through;
      vals.bend = P.mirrorBend;
      vals.tint = [c[0], c[1], c[2], 0];
      airv.set(vals);
    }, `post: the air of view ${view.id}`);
    // a gate's view: its glow pass runs only when something in it can glow (a dancer seen there, or a draw of the
    // world's or the gates' own), else the air reads a cleared stand-in (0.1 ms an empty view: an MSAA clear and
    // resolve). Only a gate's: the main view's glow target also takes fire's composite
    if (stage === 'gates' && !glow) {
      const was = view.glow.enabled;
      const runs = () => (typeof was === 'function' ? was() : was) && this.glows(view);
      view.glow.enabled = runs;
      glow = new Ref<Texture>(() => (this.glows(view) ? view.targets.glow : this.emptyRgba), `air.glow${id}`);
    }
    const perWorld = (pass: RenderPass, label: string, fragment: string, bind: Record<string, unknown>) => {
      for (const w of worlds) {
        pass.fullscreen(airShader, { label: `${label}.${w.id}${id}`, fragment, bind, constants: { WORLD: w.light }, enabled: () => view.world === w.id });
      }
    };
    // (an entry reads only some of these, but weft's reflection counts the module's bindings for each: bind them all,
    // never the pass's own target)
    const common = { glow: glow ?? view.targets.glow, focus0: slot(0), focus1: slot(1), focus2: slot(2), airv, bodyTex };
    let src: Texture | Ref<Texture> = view.targets.hdr;
    if (own) {
      // only where the world has a scene step: elsewhere the steps would give back what they were given, and the air
      // (which may march its light through the fog, the redwoods') would run twice
      const step = () => view.on() && sceneStep(worlds.find((w) => w.id === view.world));
      const tex = (label: string) => kit.texture({ label: `${label}${id}`, format: 'rgba16float', size: 'render', scale: view.scale });
      const opaque = tex('opaque'), merged = tex('merged');
      this.frame.add('surface', Object.assign(kit.copy(view.targets.hdr, opaque, `opaque.copy${id}`), { enabled: step }), 'post');
      const surface = kit.pass({ label: `surface${id}`, color: [{ target: view.targets.air }], view: vw, enabled: step });
      perWorld(surface, 'surface', 'fs_surface', { ...common, src: view.targets.hdr, opaque, surfaced: opaque });
      this.frame.add('surface', surface, 'post');
      this.frame.add('surface', Object.assign(kit.copy(view.targets.air, view.targets.hdr, `surface.copy${id}`), { enabled: step }), 'post');
      const merge = kit.pass({ label: `merge${id}`, color: [{ target: merged }], view: vw, enabled: step });
      perWorld(merge, 'merge', 'fs_merge', { ...common, src: view.targets.hdr, opaque, surfaced: view.targets.air });
      this.frame.add('air', merge, 'post');
      src = new Ref<Texture>(() => (step() ? merged : view.targets.hdr), `air.src${id}`);
    }
    const color = main ? [{ target: view.targets.air }, { target: this.focusTex }] : [{ target: view.targets.air }];
    const pass = kit.pass({ label: main ? 'air' : `air.${view.id}`, color, view: vw, enabled: view.on });
    perWorld(pass, 'air', main ? 'fs_main' : 'fs', { ...common, src, opaque: src, surfaced: src });
    this.frame.add(stage, pass, 'post');
  }

  /** whether anything can glow in a view this frame (asked once per frame and view, kept). The signal "anything
   *  here?": a dancer the view sees (its `seen` uniform, filled by the portals: a dancer in another world is hidden),
   *  since every kind's glow draws are a dancer's matter; or a glow draw that is no kind's (a world's motes, the
   *  gates' halos and rings: told by the label's first word, which is the kind's id) that is on and has something to
   *  draw. A kind could say more (MatterPasses.glows?(view): sparks left behind by a dancer who has gone): none does
   *  yet, so a kind's glow draws are taken to need one of its dancers in the view */
  private glowSeen = new Map<ViewCtx, { at: number; v: boolean }>();
  glows(view: ViewCtx): boolean {
    const at = this.kit.frameIndex, c = this.glowSeen.get(view);
    if (c && c.at === at) return c.v;
    const v = this.anythingGlows(view);
    this.glowSeen.set(view, { at, v });
    return v;
  }
  private anythingGlows(view: ViewCtx): boolean {
    const seen = view.seen.get('d') as { clip: number[] }[] | undefined;
    if (!seen || seen.some((s) => s.clip[3] >= 0 || s.clip[0] !== 0 || s.clip[1] !== 0 || s.clip[2] !== 0)) return true;
    const kinds = new Set(matterKinds.ids());
    for (const d of view.glow.draws) {
      if (!('shader' in d)) return true;
      if (kinds.has(d.label.split('.')[0])) continue;
      const e = d.enabled;
      if (typeof e === 'function' ? !e() : !e) continue;
      const n = (d.opts as { instances?: number | (() => number) }).instances;
      if (n !== undefined && (typeof n === 'function' ? n() : n) <= 0) continue;
      return true;
    }
    return false;
  }

  /** postParams.focusStub: a stand-in focus texture (a disc of that distance in the middle of the frame, half
   *  resolution), to try the focus path before any kind hands one over */
  private stubFocus(_worlds: readonly World[]) {
    const tex = this.kit.texture({ label: 'focus.stub', format: 'r16float', size: 'render', scale: 0.5 });
    const pass = this.kit.pass({ label: 'focus.stub', color: [{ target: tex, clear: [0, 0, 0, 0] }], enabled: () => postParams.focusStub > 0 });
    pass.fullscreen(postShader, { label: 'focus.stub', fragment: 'fs_focusstub', bind: { post: this.post } });
    this.frame.add('scene', pass, 'post');
    this.stub = { tex, pass };
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
      smear: P.smear, bloomSat: P.bloomSat, wide: P.bloomWide, stub: P.focusStub,
      warm: [1 + 0.25 * P.bloomWarm, 1 - 0.1 * P.bloomWarm, 1 - 0.45 * P.bloomWarm, 0],
      shoulder: [P.shoulder, P.shoulderFrom, Math.max(P.shoulderTo, P.shoulderFrom + 0.05), P.whiteFrom],
      bloomCurve: [P.bloomCap, P.bloomKnee, 0, 0],
    });
  }

  // ---------------------------------------------------------------- each frame
  /** the grade on screen now (eased toward the world's) */
  private grade: GradeValues;
  private lastWorld = '';
  private lastEye: [number, number, number] = [0, 0, 0];
  private focusNow = -1;

  /** each frame: the exposure the main view's world wants, its grade, and the focus on the dancers it frames (`look`:
   *  the distance to what the camera looks at, used when it frames nobody) */
  update(f: FrameCtx, world: World, look: number) {
    const cam = this.kit.camera, P = postParams;
    const eye = cam.position;
    const jump = Math.hypot(eye[0] - this.lastEye[0], eye[1] - this.lastEye[1], eye[2] - this.lastEye[2]) > 1.5;
    const cut = jump || world.id !== this.lastWorld || this.focusNow < 0;
    this.lastEye = [eye[0], eye[1], eye[2]];
    this.lastWorld = world.id;

    // the grade: the world's own (or the proposal while judging them), eased so a crossing doesn't pop
    const want: Grade | null = world.grade ?? (P.proposals ? PROPOSED_GRADES[world.id] ?? null : null);
    this.grade = gradeOf(want, 1 - Math.exp(-Math.max(f.dt, 0) / 0.5));

    // the focus: the dancers this view frames (hips and head, in front of the eye), at the distance that holds the
    // nearest and the farthest equally sharp; the lens opens less if that leaves either softer than holdBoth px
    const fwd = cam.forward;
    let near = Infinity, far = 0;
    for (const [x, y, z] of P.focusOn === 'dancers' ? this.framed(this.main, f.dancers) : []) {
      const d = (x - eye[0]) * fwd[0] + (y - eye[1]) * fwd[1] + (z - eye[2]) * fwd[2];
      if (d < 0.3 || !this.onScreen(x, y, z)) continue;
      near = Math.min(near, d); far = Math.max(far, d);
    }
    let target = look, blur = P.dof ? P.blur : 0;
    if (far > 0) {
      target = (2 * near * far) / (near + far);
      const both = blur * (far - near) / (near + far);
      if (both > P.holdBoth) blur *= P.holdBoth / both;
    }
    if (cut || P.focusEase <= 0 || P.focusOn === 'look') this.focusNow = target;
    else this.focusNow += (target - this.focusNow) * (1 - Math.exp(-f.dt / P.focusEase));
    this.blurNow = cut ? blur : this.blurNow + (blur - this.blurNow) * (1 - Math.exp(-f.dt / Math.max(P.focusEase, 1e-3)));

    // the stage dim: what the rig asks for (plus the test parameter), eased so the lock doesn't pop it
    const dimWant = Math.min(1, Math.max(0, this.stage.dim + P.stageDim));
    this.stageNow += (dimWant - this.stageNow) * (1 - Math.exp(-Math.max(f.dt, 0) / 0.4));
    if (Math.abs(dimWant - this.stageNow) < 1e-3) this.stageNow = dimWant;
    const at = this.stage.at > 0 ? this.stage.at : this.focusNow;

    this._post.exposure = P.exposure * this.exposureOf(world);
    this._post.focus = this.focusNow;
    this._post.blur = this.blurNow;
    this._post.stage = [this.stageNow, at, P.stageDarken, P.stageSoften];
    this.post.set({ ...this._post, ...this.grade.uniform });
  }
  private blurNow = 0;

  /** a world point inside the frame (a little margin round it) */
  private onScreen(x: number, y: number, z: number) {
    const m = this.kit.camera.viewProj;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 1e-3) return false;
    const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    return Math.abs(px) < 1.1 && Math.abs(py) < 1.1;
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
