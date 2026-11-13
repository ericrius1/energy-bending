// Live gates between worlds. A gate pairs two discs in two worlds (portals/gate.ts). While a gate is on screen and
// bigger than a few pixels, the world behind it is drawn live, this frame, from the view's camera carried through the
// gate (portals/camera.ts: its near plane laid on the far disc), into a smaller view of its own (a "slot"), and shown
// in the disc (portals/surface.wgsl). Slots are the frame's extra views (LIMITS.views): a few, rendered deepest first
// in the 'gates' stage, so a gate seen through a gate is live one level down; past that a gate shows the last view it
// had, blurred, or a shimmer.
//
// Crossing is one rigid move. A dancer whose middle passes through a disc is carried (portals/carried.ts wraps its
// controller, every joint goes through the move, and each matter kind carries its particles: MatterPasses.carry).
// The camera passing through a disc carries the camera rig (and the main view goes to the other world with it). The
// view was already live, so nothing is hidden: the exposure leans toward the far world's as a gate fills the screen,
// and at the face the two agree. A dancer part way through is drawn in both worlds, each side cut at the door: each
// view's `seen` uniform (engine/seen.wgsl) says, per dancer, whether it is in that view's world, carried how, and
// which side of which plane is drawn.
//
// The API for the game: open(def), close(id), crossed(prev, next, world), pt / dir / quat through a gate, on(event),
// worldOf(dancer) / place(dancer, world), seen(world, dancers) (the dancers as the main view's world sees them, for the
// camera to follow), and travel(event) to apply a crossing the network reported.
import type { Kit, Texture } from '@ericrius1/weft';
import type { FrameBuilder, FrameCtx } from '../engine/frame';
import { makeView, type ViewCtx } from '../engine/views';
import { declareScene, sceneLayers, type SceneLayer, type ScenePhase } from '../engine/scene';
import type { CameraRig } from '../engine/camera';
import type { RenderPass } from '@ericrius1/weft';
import type { World } from '../worlds/world';
import type { MatterPasses } from '../matter/core/kind';
import type { BodyBuffers } from '../matter/core/bodies';
import type { Dancer } from '../dancer/dancer';
import type { PostChain } from '../post/post';
import { JOINT_FLOATS, MAXJ } from '../skeleton/rig';
import { LIMITS } from '../engine/limits';
import { Gate, type GateDef } from './gate';
import { GateCamera, setPose } from './camera';
import { Surfaces, type GateRow } from './surface';
import { Carried } from './carried';
import { Rigid, dot, type Q4, type V3 } from './rigid';
import { portalParams as P } from './params';

/** something passed through a gate. The network sends this as its `travel` message (who, which gate, which face,
 *  when); `travel(e)` applies one that came from elsewhere */
export interface TravelEvent {
  who: 'dancer' | 'camera';
  /** the dancer's slot (-1 for the camera), and its id */
  dancer: number;
  id: string | null;
  /** the gate passed and the one come out of; the worlds left and entered */
  gate: string;
  partner: string;
  from: string;
  to: string;
  /** where on the disc (its own coordinates, -1 … 1) and through which face (true: in at the front) */
  u: number;
  v: number;
  front: boolean;
  /** dance time (s) */
  t: number;
}

export interface PortalsCtx {
  kit: Kit;
  frame: FrameBuilder;
  worlds: readonly World[];
  main: ViewCtx;
  rig: CameraRig;
  bodies: BodyBuffers;
  /** how many extra views the gates may use (LIMITS.views, less any the frame uses otherwise) */
  slots: number;
  /** fetch a world's assets before it is first shown */
  load(world: string): Promise<void>;
  /** the main view went to another world through a gate (the sound retunes) */
  entered?(world: string): void;
  coarse: boolean;
}

/** a live view behind a gate */
interface Slot {
  index: number;
  view: ViewCtx;
  cam: GateCamera;
  active: boolean;
  /** the gate it looks through and the view it is seen from (this frame) */
  gate: Gate | null;
  parent: ViewCtx | null;
  /** the gate it showed last frame (its texture still holds that view) */
  was: Gate | null;
}

const ROOT = 0; // the hips: a dancer's middle
const NO_CLIP = [0, 0, 0, 1];
const HIDDEN = [0, 0, 0, -1];
/** colours of the suites a dancer wears (the rim takes them) */
const SUITE_RIM: Record<string, V3> = {
  Violet: [0.75, 0.45, 1.0], Sky: [0.45, 0.75, 1.0], Ember: [1.0, 0.6, 0.25], Forest: [0.4, 1.0, 0.55],
  'Blue lace': [0.55, 0.7, 1.0], Midnight: [0.6, 0.45, 0.9], Dawn: [1.0, 0.65, 0.6], Custom: [0.8, 0.9, 0.7],
};
const CAMERA_RIM: V3 = [1.0, 0.92, 0.75];
/** each world's hue for a gate with nothing live in it */
const WORLD_HUE: Record<string, V3> = { geode: [0.55, 0.4, 1.0], redwoods: [0.55, 0.75, 0.4] };

export class Portals implements SceneLayer {
  readonly id = 'portals';
  readonly gates = new Map<string, Gate>();
  /** the gates' views (they join the frame's views: their worlds update, their culls run) */
  readonly views: ViewCtx[];
  /** the dancer the camera follows through a gate (its slot), or null */
  follow: number | null = null;
  /** the main view's exposure now (the post chain reads it through `exposureOf`) */
  exposure = 1;

  private kit: Kit;
  private slots: Slot[] = [];
  private surfaces: Surfaces;
  private kinds: readonly MatterPasses[] = [];
  private listeners: ((e: TravelEvent) => void)[] = [];
  private homes = new WeakMap<Dancer, string>();
  private roots = new WeakMap<Dancer, V3>();
  private camWas: { p: V3; world: string } | null = null;
  /** the camera's leftover turn after a gate that tilts the world (eased out), and the fly path's carry */
  private residual: Rigid | null = null;
  private residualW = 0;
  private flyCarry = new Rigid();
  private flyFor = '';
  private flyDir = 1;
  private lean = { k: 0, to: '' };
  private leanGate: Gate | null = null;
  private t = 0;
  private seenCache = new WeakMap<Dancer, Float32Array>();

  constructor(private ctx: PortalsCtx) {
    const kit = (this.kit = ctx.kit);
    const S = Math.max(0, Math.min(ctx.slots, LIMITS.views, 3));
    for (let i = 0; i < S; i++) {
      const cam = new GateCamera();
      const slot: Slot = { index: i, view: null!, cam, active: false, gate: null, parent: null, was: null };
      slot.view = makeView(kit, `gate${i}`, { world: ctx.main.world, scale: P.scale, camera: cam, on: () => slot.active });
      this.slots.push(slot);
    }
    this.views = this.slots.map((s) => s.view);
    this.surfaces = new Surfaces(kit, () => this.slotTextures());
    if (ctx.coarse) { this.surfaces.motes = 40; P.live = Math.min(P.live, 1); P.scale = Math.min(P.scale, 0.4); }
    sceneLayers.register(this);
    ctx.frame.tick('travel', (f) => this.travelPhase(f), 'gates: dancers through a door, carried to the other world');
    ctx.frame.tick('gates', (f) => this.gatesPhase(f), 'gates: the camera through a door, the views behind each live gate');
  }

  private slotTextures(): Texture[] {
    if (!this.slots.length) return [this.ctx.main.targets.air];
    return this.slots.map((s) => s.view.targets.air);
  }

  /** declare the gates' own views (each slot's scene and air, deepest first, in the 'gates' stage), once at setup,
   *  after the matter kinds are declared */
  declare(kinds: readonly MatterPasses[], post: PostChain) {
    this.kinds = kinds;
    for (const s of [...this.slots].reverse()) {
      declareScene(s.view, this.ctx.worlds, kinds);
      this.ctx.frame.add('gates', s.view.scene, `gate view ${s.index}`);
      post.declareAir(s.view, this.ctx.worlds, 'gates');
    }
    post.exposureOf = () => this.exposure;
    // every world's own gates (a world lists its side of each pair; the partner world lists the other)
    for (const w of this.ctx.worlds) for (const def of w.portals) this.open({ ...def, world: w.id });
  }

  /** the scene layer (engine/scene.ts): the gates in every view */
  declareLayer(pass: RenderPass, phase: ScenePhase, view: ViewCtx) { this.surfaces.declareLayer(pass, phase, view); }

  // ---------------------------------------------------------------- the API
  /** open a gate (and its partner: given in the same call, already open, or found in the partner world's portals).
   *  It weaves open over `openTime` seconds */
  open(...defs: GateDef[]) {
    const opened: Gate[] = [];
    for (const d of defs) {
      const g = this.gates.get(d.id) ?? new Gate(d);
      g.want = 1;
      this.gates.set(d.id, g);
      opened.push(g);
      void this.ctx.load(d.world);
      void this.ctx.load(d.to.world);
    }
    for (const g of opened) {
      let b = this.gates.get(g.def.to.portal);
      if (!b) {
        const w = this.ctx.worlds.find((x) => x.id === g.def.to.world);
        const def = w?.portals.find((p) => p.id === g.def.to.portal);
        if (def) { b = new Gate({ ...def, world: w!.id }); this.gates.set(b.id, b); }
      }
      if (b && g.partner !== b) g.pair(b);
      if (b) b.want = 1;
    }
    if (this.gates.size > LIMITS.gates) console.warn(`gates: ${this.gates.size} open, more than LIMITS.gates (${LIMITS.gates}); the rest aren't drawn`);
    return opened;
  }

  /** close a gate and its partner (they weave shut, then go) */
  close(id: string) {
    const g = this.gates.get(id);
    if (!g) return;
    g.want = 0;
    if (g.partner) g.partner.want = 0;
  }

  /** the open gate in `world` the segment prev → next passes through, and where: null if none */
  crossed(prev: ArrayLike<number>, next: ArrayLike<number>, world: string, margin = 0) {
    for (const g of this.gates.values()) {
      if (g.world !== world) continue;
      const c = g.crossing(prev, next, margin);
      if (c) return { gate: g, ...c };
    }
    return null;
  }

  /** a point, direction or orientation carried through a gate (from its world into its partner's) */
  pt(gate: string, p: ArrayLike<number>): V3 { return this.must(gate).through.pt(p); }
  dir(gate: string, v: ArrayLike<number>): V3 { return this.must(gate).through.dir(v); }
  quat(gate: string, q: ArrayLike<number>): Q4 { return this.must(gate).through.quat(q); }
  /** the whole move through a gate (a copy) */
  move(gate: string) { return this.must(gate).through.clone(); }

  /** listen for crossings */
  on(fn: (e: TravelEvent) => void) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((x) => x !== fn); }; }

  /** the world a dancer is in */
  worldOf(d: Dancer) { return this.homes.get(d) ?? this.ctx.main.world; }
  /** put a dancer in a world (without carrying it: where it stands is that world's coordinates). null: it goes
   *  with the main view (where every dancer starts) */
  place(d: Dancer, world: string | null) {
    if (world) this.homes.set(d, world); else this.homes.delete(d);
  }

  /** apply a crossing reported from elsewhere (the network's `travel`): the dancer is carried through that gate */
  travel(e: TravelEvent, dancers: readonly Dancer[], t: number) {
    const g = this.gates.get(e.gate), d = dancers[e.dancer];
    if (!g || !g.partner || !d || this.worldOf(d) !== g.world) return false;
    this.carryDancer(d, e.dancer, g, e.u, e.v, e.front, t, false);
    this.ctx.bodies.upload(dancers, t);
    return true;
  }

  /** every dancer as `world` sees it: its joints (carried through the gate it is nearest, for one in another world
   *  joined to this one by an open gate), and their middle. What the camera follows and frames */
  seen(world: string, dancers: readonly Dancer[]) {
    const joints: Float32Array[] = [];
    let x = 0, z = 0;
    for (const d of dancers) {
      const w = this.worldOf(d), J = d.skeleton.world;
      if (w === world) { joints.push(J); x += J[0]; z += J[2]; continue; }
      let best: Gate | null = null, bd = Infinity;
      for (const g of this.gates.values()) {
        if (g.world !== w || !g.partner || g.partner.world !== world || g.open <= 0.3) continue;
        const dd = Math.hypot(J[0] - g.at[0], J[1] - g.at[1], J[2] - g.at[2]);
        if (dd < bd) { bd = dd; best = g; }
      }
      if (!best) continue;
      let out = this.seenCache.get(d);
      if (!out) { out = new Float32Array(J.length); this.seenCache.set(d, out); }
      carryJoints(J, out, best.through, MAXJ);
      joints.push(out); x += out[0]; z += out[2];
    }
    const D = Math.max(1, joints.length);
    return { joints, x: x / D, z: z / D };
  }

  private must(id: string) {
    const g = this.gates.get(id);
    if (!g) throw new Error(`no gate '${id}' (open: ${[...this.gates.keys()].join(', ') || 'none'})`);
    return g;
  }

  private emit(e: TravelEvent) { for (const l of this.listeners) l(e); }

  // ---------------------------------------------------------------- dancers through a door ('travel' phase)
  private travelPhase(f: FrameCtx) {
    let moved = false;
    f.dancers.forEach((d, k) => {
      if (k >= LIMITS.dancers) return;
      const J = d.skeleton.world, now: V3 = [J[ROOT * JOINT_FLOATS], J[ROOT * JOINT_FLOATS + 1], J[ROOT * JOINT_FLOATS + 2]];
      const was = this.roots.get(d);
      this.roots.set(d, now);
      if (!was) return;
      const c = this.crossed(was, now, this.worldOf(d), 0.15);
      if (!c) return;
      this.carryDancer(d, k, c.gate, c.u, c.v, c.front, f.t, true);
      moved = true;
    });
    if (moved) this.ctx.bodies.upload(f.dancers, f.t);
  }

  private carryDancer(d: Dancer, k: number, g: Gate, u: number, v: number, front: boolean, t: number, tell: boolean) {
    const G = g.through, b = g.partner!;
    // the controller keeps posing where it thinks it is; the wrapper carries what it poses
    let c = d.controller instanceof Carried ? d.controller : null;
    if (!c) { c = new Carried(d.controller); d.controller = c; }
    G.mul(c.move, c.move);
    if (c.move.isIdentity(1e-6)) d.controller = c.inner;
    // this frame's joints too (already committed and uploaded), and the next commit's velocities start again
    // from here rather than from the far side of the world
    carryJoints(d.skeleton.world, d.skeleton.world, G, d.skeleton.count);
    d.skeleton.reset();
    this.homes.set(d, b.world);
    const r = this.roots.get(d);
    if (r) G.pt(r, r);
    for (const m of this.kinds) m.carry?.([{ dancer: k, move: G.mat4() }]);
    const suite = String(d.loadout.layers[0]?.params?.suite ?? '');
    const rim = SUITE_RIM[suite] ?? [0.9, 0.8, 1.0];
    for (const x of [g, b]) { x.rim = [...rim] as V3; x.flash = 1; }
    g.poke(u, v, this.t, 1.4);
    if (tell) this.emit({ who: 'dancer', dancer: k, id: d.id, gate: g.id, partner: b.id, from: g.world, to: b.world, u, v, front, t });
  }

  // ---------------------------------------------------------------- the camera, the views ('gates' phase)
  private gatesPhase(f: FrameCtx) {
    const kit = this.kit, cam = kit.camera, main = this.ctx.main, [W, H] = kit.size.render;
    this.t += f.dt;
    this.animate(f.dt);
    this.fly(f.dt);
    // the camera's leftover turn, eased out
    if (this.residual && this.residualW > 1e-3 && !P.fly) {
      this.residualW *= Math.exp(-f.dt / Math.max(0.05, P.settle * 0.4));
      const pose = poseOf(cam), O = this.residual.partial(this.residualW);
      setPoseRigid(cam, O.mul(pose));
    } else this.residual = null;
    cam.update(W, H);
    // ---- the camera through a door
    const eye: V3 = [cam.position[0], cam.position[1], cam.position[2]];
    if (this.camWas && this.camWas.world === main.world) {
      const c = this.crossed(this.camWas.p, eye, main.world);
      if (c) { this.carryCamera(c.gate, c.u, c.v, c.front, f.t); cam.update(W, H); eye[0] = cam.position[0]; eye[1] = cam.position[1]; eye[2] = cam.position[2]; }
    }
    this.camWas = { p: eye, world: main.world };
    // ---- the views behind the gates, and what each view sees of the dancers
    this.assign(W, H);
    this.leanExposure(W, H, f.dt);
    this.see(f.dancers);
    this.tables(W, H);
  }

  /** gates weave open and shut, flashes die away, ripples age; a dancer standing in a disc keeps it rippling */
  private animate(dt: number) {
    for (const [id, g] of this.gates) {
      const k = dt / Math.max(0.05, P.openTime);
      g.open = g.want > g.open ? Math.min(g.want, g.open + k) : Math.max(g.want, g.open - k * 1.5);
      if (g.want === 0 && g.open <= 0) { this.gates.delete(id); continue; }
      g.flash *= Math.exp(-dt * 1.6);
    }
  }

  /** the camera's pose carried through a gate: the rig (or the fly path) and the main view go with it */
  private carryCamera(g: Gate, u: number, v: number, front: boolean, t: number) {
    const G = g.through, b = g.partner!, cam = this.kit.camera, main = this.ctx.main, rig = this.ctx.rig;
    const from = main.world;
    // the dancers who were with the main view stay where they are
    for (const d of this.lastDancers) if (!this.homes.has(d)) this.homes.set(d, from);
    const before = poseOf(cam), after = G.mul(before);
    if (P.fly) G.mul(this.flyCarry, this.flyCarry);
    else {
      // the rig is an orbit (a target, a turn and a tilt round it): carry the target and turn the orbit by the gate's
      // turn about up; what that can't hold (a tilt, a roll) is left as a residual and eased out
      const tg: V3 = [rig.target[0], rig.target[1], rig.target[2]], tg2 = G.pt(tg);
      rig.target[0] = tg2[0]; rig.target[1] = tg2[1]; rig.target[2] = tg2[2];
      rig.height += tg2[1] - tg[1];
      rig.yaw += G.yawTurn().yaw;
      const e2 = after.t, off: V3 = [e2[0] - tg2[0], e2[1] - tg2[1], e2[2] - tg2[2]], len = Math.hypot(...off) || 1;
      rig.pitch = Math.max(-0.15, Math.min(1.5, Math.asin(Math.max(-1, Math.min(1, off[1] / len)))));
      // what the orbit will give next frame, to measure the residual against
      const cp = Math.cos(rig.pitch), ex = tg2[0] + Math.sin(rig.yaw) * cp * len, ey = tg2[1] + Math.sin(rig.pitch) * len, ez = tg2[2] + Math.cos(rig.yaw) * cp * len;
      const predicted = lookPose([ex, ey, ez], tg2);
      this.residual = after.mul(predicted.inverse());
      this.residualW = 1;
    }
    setPoseRigid(cam, after);
    main.world = b.world;
    this.ctx.entered?.(b.world);
    for (const x of [g, b]) { x.rim = [...CAMERA_RIM] as V3; x.flash = 0.7; }
    g.poke(u, v, this.t, 1);
    this.emit({ who: 'camera', dancer: -1, id: null, gate: g.id, partner: b.id, from, to: b.world, u, v, front, t });
  }
  private lastDancers: readonly Dancer[] = [];

  /** ?fly: a straight path through a gate, eye forward along it; it carries itself through like any camera */
  private fly(dt: number) {
    const id = P.fly, cam = this.kit.camera, main = this.ctx.main;
    if (!id) { this.flyFor = ''; return; }
    const g = this.gates.get(id);
    if (!g || !g.partner) return;
    if (this.flyFor !== id) {
      this.flyFor = id; this.flyCarry = new Rigid();
      if (main.world !== g.world) { main.world = g.world; this.ctx.entered?.(g.world); }
      this.camWas = null;
    }
    if (P.flySpeed > 0) {
      P.flyT += this.flyDir * P.flySpeed * 2 * dt;
      if (P.flyT > 1) { P.flyT = 1; this.flyDir = -1; }
      if (P.flyT < -1) { P.flyT = -1; this.flyDir = 1; }
    }
    const R = g.radius, a = (P.flyAngle * Math.PI) / 180, s = -P.flyT * P.flyLength * R;
    // along the path: in at the front (s > 0) and out behind (s < 0), a steep path crossing the disc where it's aimed
    const lp: V3 = [P.flyAcross * R + Math.sin(a) * s, P.flyRise * R, Math.cos(a) * s];
    const pitch = (P.flyPitch * Math.PI) / 180;
    const lf: V3 = [-Math.sin(a) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(a) * Math.cos(pitch)];
    const p = g.frame.pt(lp), fw = g.frame.dir(lf), up = g.frame.dir([0, 1, 0]);
    const pose = lookPoseDir(p, fw, up);
    setPoseRigid(cam, this.flyCarry.mul(pose));
  }

  /** which gates get live views this frame: the biggest on the main screen first, then gates seen through those */
  private assign(W: number, H: number) {
    const main = this.ctx.main;
    for (const s of this.slots) { s.was = s.active ? s.gate : null; s.active = false; s.gate = null; s.parent = null; }
    let next = 0;
    // the main view's gates take up to `live` slots; gates seen through those take what is left
    const take = (parent: ViewCtx, cam: CamLike, world: string, skip: Gate | null, w: number, h: number, cap: number) => {
      const c: { g: Gate; px: number }[] = [];
      for (const g of this.gates.values()) {
        if (g.world !== world || g === skip || !g.partner || g.open <= 0.02) continue;
        const sc = screenOf(g, cam, w, h);
        if (sc.on && sc.px >= P.minPx) c.push({ g, px: sc.px });
      }
      c.sort((a, b) => b.px - a.px);
      const got: Slot[] = [];
      for (const { g } of c) {
        if (next >= cap) break;
        const s = this.slots[next++];
        s.active = true; s.gate = g; s.parent = parent;
        s.view.world = g.partner!.world;
        this.aim(s, cam);
        got.push(s);
      }
      return got;
    };
    const level1 = take(main, this.kit.camera, main.world, null, W, H, Math.min(P.live, this.slots.length));
    if (P.depth >= 2) for (const s of level1) {
      const vw = s.view.view.width, vh = s.view.view.height;
      take(s.view, s.cam, s.view.world, s.gate!.partner, vw / P.scale, vh / P.scale, this.slots.length);
    }
  }

  /** a slot's camera: its parent's carried through the gate, its near plane on the far disc */
  private aim(s: Slot, from: CamLike) {
    const g = s.gate!, b = g.partner!, G = g.through, c = s.cam;
    const eye = G.pt(from.position), fw = G.dir(from.forward), up = G.dir(from.up);
    setPose(c, eye, fw, up);
    c.fovY = from.fovY;
    c.near = 0.05;
    // keep what is on the far side of the partner disc from the eye
    const side = b.side(eye) < 0 ? 1 : -1;
    c.clip = [b.n[0] * side, b.n[1] * side, b.n[2] * side, -dot(b.n, b.at) * side];
    c.update(s.view.view.width, s.view.view.height);
  }

  /** as a gate fills the main view, its exposure leans toward the far world's (they agree at the face) */
  private leanExposure(W: number, H: number, dt: number) {
    const main = this.ctx.main, cam = this.kit.camera, worldOf = (id: string) => this.ctx.worlds.find((w) => w.id === id);
    let best = 0, to = '';
    this.leanGate = null;
    for (const g of this.gates.values()) {
      if (g.world !== main.world || !g.passable) continue;
      const k = coverage(g, cam, W / Math.max(H, 1));
      if (k > best) { best = k; to = g.partner!.world; this.leanGate = g; }
    }
    // symmetric about a half-filled screen, so the far side of a crossing leans by the same amount the other way
    const p = 3, lean = best <= 0 ? 0 : best ** p / (best ** p + (1 - best) ** p);
    this.lean = { k: lean, to };
    const here = worldOf(main.world)?.exposure() ?? 1, there = to ? worldOf(to)?.exposure() ?? here : here;
    const want = here + (there - here) * lean;
    this.exposure += (want - this.exposure) * (1 - Math.exp(-dt / 0.12));
    if (!Number.isFinite(this.exposure) || this.exposure <= 0) this.exposure = want;
  }

  /** each view's `seen`: the dancers in its world, and those part way through a door cut at it, in both worlds */
  private see(dancers: readonly Dancer[]) {
    this.lastDancers = dancers;
    const straddle = dancers.map((d) => {
      const w = this.worldOf(d), J = d.skeleton.world, r: V3 = [J[0], J[1], J[2]];
      for (const g of this.gates.values()) {
        if (g.world !== w || !g.partner || g.open <= 0.02) continue;
        const sd = g.side(r), l = g.local(r);
        if (Math.abs(sd) < 1.35 && Math.hypot(l[0], l[1]) < g.reach + 0.9) return { g, s: sd >= 0 ? 1 : -1 };
      }
      return null;
    });
    const rowsOf = (m: Rigid | null, clip: number[]) => {
      const R = m ? m.rows() : { x: [1, 0, 0, 0], y: [0, 1, 0, 0], z: [0, 0, 1, 0] };
      return { ...R, q: m ? m.rotation() : [0, 0, 0, 1], clip };
    };
    const plane = (g: Gate, s: number) => [g.n[0] * s, g.n[1] * s, g.n[2] * s, -dot(g.n, g.at) * s];
    const views = [this.ctx.main, ...this.slots.filter((s) => s.active).map((s) => s.view)];
    const cover = new Map<ViewCtx, number>();
    for (const s of this.slots) if (s.active && s.parent === this.ctx.main && s.gate === this.leanGate) cover.set(s.view, this.lean.k);
    for (const v of views) {
      const d = Array.from({ length: LIMITS.dancers }, (_, k) => {
        const dn = dancers[k];
        if (!dn) return rowsOf(null, HIDDEN);
        const w = this.worldOf(dn), st = straddle[k];
        if (w === v.world) return rowsOf(null, st ? plane(st.g, st.s) : NO_CLIP);
        if (st && st.g.partner!.world === v.world) return rowsOf(st.g.through, plane(st.g.partner!, st.s));
        return rowsOf(null, HIDDEN);
      });
      const gate = v !== this.ctx.main;
      // a gate's view draws a share of each body, more as the gate fills the screen (all of it at the face)
      const keep = gate ? P.keep + (1 - P.keep) * (cover.get(v) ?? 0) : 1;
      v.seen.set({ d, keep, grow: gate ? Math.pow(keep, -0.4) : 1 } as unknown as Parameters<typeof v.seen.set>[0]);
    }
  }

  /** each view's table of gates: its world's gates, each with where it is on that view's screen and what to show */
  private tables(W: number, H: number) {
    const main = this.ctx.main, worldOf = (id: string) => this.ctx.worlds.find((w) => w.id === id);
    const views: { v: ViewCtx; cam: CamLike; skip: Gate | null; order: number; w: number; h: number; clip: number[] }[] = [
      { v: main, cam: this.kit.camera, skip: null, order: Infinity, w: W, h: H, clip: NO_CLIP },
      ...this.slots.filter((s) => s.active).map((s) => ({ v: s.view, cam: s.cam, skip: s.gate!.partner, order: s.index, w: s.view.view.width, h: s.view.view.height, clip: [...s.cam.clip!] })),
    ];
    for (const { v, cam, skip, order, w, h, clip } of views) {
      const rows: GateRow[] = [];
      for (const g of this.gates.values()) {
        if (g.world !== v.world || g === skip || !g.partner || g.open <= 0) continue;
        const sc = screenOf(g, cam, w, h);
        if (!sc.on) continue;
        // what to show: the slot that looks through it from this view (rendered before this view: a higher index),
        // or the one that showed it last frame, blurred
        let slot = -1, live = 0;
        const s = this.slots.find((x) => x.active && x.gate === g && x.parent === v && x.index < order);
        if (s) { slot = s.index; live = 1; }
        else {
          const old = this.slots.find((x) => x.was === g && (!x.active || x.gate === g));
          if (old) { slot = old.index; live = 0.5; }
        }
        const far = worldOf(g.partner.world);
        const gain = Math.pow(Math.max(1e-3, (far?.exposure() ?? 1) / Math.max(1e-3, this.exposure)), P.match);
        const hue = WORLD_HUE[g.partner.world] ?? [0.6, 0.6, 0.8];
        const floor = worldOf(g.world)?.groundAt(g.at[0], g.at[2]) ?? 0;
        rows.push({
          at: [...g.at, g.radius], right: [...g.right, g.open], up: [...g.up, g.seed], n: [...g.n, slot], rect: sc.rect,
          rim: [...g.rim, g.flash], look: [...hue, gain], info: [live, floor, P.glow, 0],
          pokes: [0, 1, 2, 3].map((i) => { const p = g.pokes[i]; return p ? [p.u, p.v, this.t - p.t, p.s] : [0, 0, 0, 0]; }),
        });
      }
      this.surfaces.fill(v, rows, this.t, clip);
    }
  }

  /** for the hooks and the report: what each slot shows */
  stats() {
    return {
      gates: [...this.gates.values()].map((g) => ({ id: g.id, world: g.world, open: +g.open.toFixed(2), to: g.partner?.id ?? null })),
      slots: this.slots.map((s) => ({ index: s.index, active: s.active, gate: s.gate?.id ?? null, from: s.parent?.id ?? null, world: s.view.world })),
      main: this.ctx.main.world,
      exposure: +this.exposure.toFixed(3),
      lean: { ...this.lean, k: +this.lean.k.toFixed(3) },
    };
  }
}

// ---------------------------------------------------------------- helpers
/** joints (Skeleton.world: pos + speed, rotation, velocity + 0 per joint) carried through a rigid move */
function carryJoints(src: Float32Array, out: Float32Array, m: Rigid, n: number) {
  const q = m.rotation(), p: V3 = [0, 0, 0], v: V3 = [0, 0, 0], r: Q4 = [0, 0, 0, 1];
  for (let k = 0; k < n; k++) {
    const o = k * JOINT_FLOATS;
    m.pt([src[o], src[o + 1], src[o + 2]], p);
    m.dir([src[o + 8], src[o + 9], src[o + 10]], v);
    const rr = [src[o + 4], src[o + 5], src[o + 6], src[o + 7]];
    const w = qmulTo(q, rr, r);
    out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2]; out[o + 3] = src[o + 3];
    out[o + 4] = w[0]; out[o + 5] = w[1]; out[o + 6] = w[2]; out[o + 7] = w[3];
    out[o + 8] = v[0]; out[o + 9] = v[1]; out[o + 10] = v[2]; out[o + 11] = src[o + 11];
  }
}
function qmulTo(a: ArrayLike<number>, b: ArrayLike<number>, out: Q4): Q4 {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

type CamLike = { position: ArrayLike<number>; forward: ArrayLike<number>; up: ArrayLike<number>; right: ArrayLike<number>; viewProj: ArrayLike<number>; near: number; fovY: number };

/** a camera's pose as a rigid frame (right, up, back at the eye) */
function poseOf(c: CamLike) {
  return Rigid.frame(c.right, c.up, [-c.forward[0], -c.forward[1], -c.forward[2]], c.position);
}
function setPoseRigid(c: Parameters<typeof setPose>[0], m: Rigid) {
  const r = m.r;
  setPose(c, m.t, [-r[2], -r[5], -r[8]], [r[1], r[4], r[7]]);
}
function lookPoseDir(eye: ArrayLike<number>, fwd: ArrayLike<number>, upHint: ArrayLike<number>) {
  const f = norm3(fwd);
  let rgt = cross3(f, upHint);
  if (Math.hypot(...rgt) < 1e-6) rgt = cross3(f, [0, 0, 1]);
  rgt = norm3(rgt);
  const up = cross3(rgt, f);
  return Rigid.frame(rgt, up, [-f[0], -f[1], -f[2]], eye);
}
function lookPose(eye: ArrayLike<number>, at: ArrayLike<number>) {
  return lookPoseDir(eye, [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]], [0, 1, 0]);
}
const cross3 = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: ArrayLike<number>): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** where a gate's disc is on a camera's screen: whether it is on it, its size (pixels of radius) and its bounds in
 *  ndc (the whole screen when the eye is so near the disc that some of it is behind the near plane) */
function screenOf(g: Gate, c: CamLike, w: number, h: number) {
  const m = c.viewProj, R = Math.max(g.reach, g.radius * 0.3) * 1.04;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, near = false;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, ca = Math.cos(a) * R, sa = Math.sin(a) * R;
    for (const lift of [-0.06, 0.06]) {
      const px = g.at[0] + g.right[0] * ca + g.up[0] * sa + g.n[0] * lift * g.radius;
      const py = g.at[1] + g.right[1] * ca + g.up[1] * sa + g.n[1] * lift * g.radius;
      const pz = g.at[2] + g.right[2] * ca + g.up[2] * sa + g.n[2] * lift * g.radius;
      const cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
      if (cw < c.near * 2) { near = true; continue; }
      const cx = (m[0] * px + m[4] * py + m[8] * pz + m[12]) / cw, cy = (m[1] * px + m[5] * py + m[9] * pz + m[13]) / cw;
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
    }
  }
  if (near) {
    // some of it is beside or behind the eye: draw it over the whole screen (the shader finds the disc per pixel),
    // as long as the eye is anywhere near it
    const l = g.local(c.position), out = Math.hypot(l[0], l[1]) - g.reach;
    const on = Math.abs(l[2]) < g.radius * 3 && out < g.radius * 3;
    return { on, px: Math.max(w, h), rect: [-1, -1, 1, 1] };
  }
  const on = x1 > -1 && x0 < 1 && y1 > -1 && y0 < 1;
  const px = Math.max((x1 - x0) * w, (y1 - y0) * h) * 0.25;
  const pad = 4 / Math.max(w, h);
  return { on, px, rect: [Math.max(-1, x0 - pad), Math.max(-1, y0 - pad), Math.min(1, x1 + pad), Math.min(1, y1 + pad)] };
}

/** how much of the screen a gate's disc covers (0 … 1), from a grid of rays */
function coverage(g: Gate, c: CamLike, aspect: number) {
  const ty = Math.tan(c.fovY / 2), tx = ty * aspect, N = 12, M = 8;
  const e = c.position, sd = g.side(e);
  let hit = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const x = ((i + 0.5) / N) * 2 - 1, y = ((j + 0.5) / M) * 2 - 1;
    const d = [c.forward[0] + c.right[0] * x * tx + c.up[0] * y * ty, c.forward[1] + c.right[1] * x * tx + c.up[1] * y * ty, c.forward[2] + c.right[2] * x * tx + c.up[2] * y * ty];
    const dn = dot(d, g.n);
    if (Math.abs(dn) < 1e-9) continue;
    const t = -sd / dn;
    if (t <= 0) continue;
    const p = [e[0] + d[0] * t, e[1] + d[1] * t, e[2] + d[2] * t], l = g.local(p);
    if (l[0] * l[0] + l[1] * l[1] <= g.reach * g.reach) hit++;
  }
  return hit / (N * M);
}
