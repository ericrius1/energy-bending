// IntentController: a player (or a brain, or a script) dancing through a body. It owns a Character (body physics and
// the move being danced, dancer/character.ts) and a source of Intents (src/input), and each frame:
//   1. reads an Intent (the source's, with any scripted patch over it: bend.intent),
//   2. steps the Character (locked to a StagePlane with its ledges, or free on the world's ground),
//   3. fits the 38-joint rig to the Character's 13 landmarks through the retargeter, with hints for what landmarks
//      can't say (flat or pointed feet, fists and open hands, a curving spine, the head looking at the partner),
//   4. in free mode, cross-fades in motion-matched locomotion (skeleton/locomotion's Mover: real walking and turning
//      from the CMU clips) while the dancer travels at a walk, the procedural ginga, run and moves taking over at rest,
//      at speed and whenever a move plays.
import { quat, vec3, type Vec3 } from 'math';
import type { Controller } from './controller';
import type { FrameCtx } from '../engine/frame';
import { JOINT, Skeleton, type Rig } from '../skeleton/rig';
import { newLandmarkPose } from '../skeleton/landmarks';
import { fitSkeleton, type HandStyle, type PoseHints } from '../skeleton/retarget';
import { Mover } from '../skeleton/locomotion/mover';
import type { Moves } from '../skeleton/locomotion/moves';
import { Character, type Terrain } from './character';
import { ANKLE_H, J, NJ } from './moves';
import { makeIntent, EDGES, type Intent, type IntentSource } from '../input/intent';
import type { StagePlane } from '../engine/camera';
import { defineParams } from '../engine/params';

export const intentParams = defineParams('intent', {
  /** how much of motion-matched walking shows at a walk (0: always procedural) */
  mocapWalk: 1,
  /** the walking band (m/s): mocap fades in above `walkFrom` and out again above `walkTo` (the procedural run) */
  walkFrom: 0.35,
  walkTo: 2.2,
  /** how much the head turns to the partner */
  look: 0.8,
  /** how much the spine curves between the hips and the shoulders */
  curve: 1,
}, {
  mocapWalk: { min: 0, max: 1, label: 'mocap walk' },
  walkTo: { min: 0.5, max: 4, label: 'walk → run (m/s)' },
  look: { min: 0, max: 1 },
  curve: { min: 0, max: 1, label: 'spine curve' },
});

const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
/** moves in which the head goes where the body takes it (it doesn't keep its eyes on the partner) */
const NO_LOOK = new Set(['au', 'macaco', 'role', 'spin', 'armada', 'esquiva', 'rasteira']);

/** a scripted patch over a player's Intent (bend.intent): held fields stay until changed; edges fire once */
export class IntentScript {
  patch: Partial<Intent> = {};
  set(p: Partial<Intent> | null) {
    if (!p) { this.patch = {}; return; }
    Object.assign(this.patch, p);
    for (const k of Object.keys(p) as (keyof Intent)[]) if (p[k] === undefined) delete this.patch[k];
  }
  /** lay the patch over an Intent, then forget its edges */
  apply(it: Intent) {
    Object.assign(it, this.patch);
    for (const e of EDGES) delete this.patch[e];
    return it;
  }
}

const _ic_v = vec3.create();

/** blend two posed skeletons of one rig (rotations slerped joint by joint, the hips' position lerped), then lay the
 *  bones out again from the hips with the rig's own lengths, so nothing stretches */
export function blendSkeletons(a: Skeleton, b: Skeleton, w: number, out: Skeleton) {
  const J = out.rig.joints, n = out.count;
  for (let k = 0; k < n; k++) quat.slerp(out.rot[k], a.rot[k], b.rot[k], w);
  vec3.lerp(out.pos[0], a.pos[0], b.pos[0], w);
  for (let k = 1; k < n; k++) {
    const p = J[k].parent;
    vec3.add(out.pos[k], out.pos[p], vec3.transformQuat(_ic_v, J[k].offset as unknown as Vec3, out.rot[p]));
  }
}

export class IntentController implements Controller {
  readonly kind = 'intent';
  readonly character: Character;
  /** where the Intents come from (null: only the script) */
  source: IntentSource | null;
  readonly script = new IntentScript();
  /** the camera's yaw, so a free stick is camera-relative (set by whoever owns the camera) */
  inputYaw = 0;
  /** the partner's head (world), for the eyes; null: look ahead */
  lookAtHead: Vec3 | null = null;
  /** the Intent this frame (after the script), for whoever wants to read it (the camera's look, the lock toggle) */
  intent: Intent = makeIntent();
  /** how much of the motion-matched walk shows now (0..1) */
  mocapW = 0;
  private lm = newLandmarkPose();
  private hints: PoseHints = { ground: 0, ankle: ANKLE_H, feet: ['auto', 'auto'], hands: ['relaxed', 'relaxed'], lookAt: null, look: 0, curve: 1 };
  private mover: Mover | null = null;
  private moverSk: Skeleton | null = null;
  private procSk: Skeleton;
  private moverWarm = false;

  constructor(readonly rig: Rig, o: { seat?: number; source?: IntentSource | null; terrain?: Terrain; plane?: StagePlane | null; moves?: Moves | null; at?: [number, number, number] } = {}) {
    this.character = new Character({ seat: o.seat ?? 0, plane: o.plane ?? null, terrain: o.terrain });
    if (o.at) this.character.reset(o.at[0], o.at[1], o.at[2]);
    this.source = o.source ?? null;
    this.procSk = new Skeleton(rig);
    if (o.moves) {
      const clip = Math.max(0, o.moves.clips.findIndex((c) => c.key === 'walk/0'));
      this.mover = new Mover(o.moves, rig, clip, 20);
      this.moverSk = new Skeleton(rig);
      this.mover.place(this.character.x, this.character.z, this.character.yaw);
    }
  }

  /** lock to a stage plane (the dancer eases onto it) or free (null); the source's controls follow */
  /** carried through a gate (src/portals): the body physics goes on in the new world, at the carried point, moving the
   *  carried way, turned by the gate's turn about up (a gate that tilts the world tilts nothing here: the body stays
   *  upright and keeps its speed) */
  carry(m: Float32Array) {
    const c = this.character, r = c.root, v = c.v;
    const x = r[0], y = r[1], z = r[2];
    c.root = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    c.v = [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
    c.yaw += Math.atan2(m[8], m[10]);
  }

  setPlane(p: StagePlane | null) {
    this.character.setPlane(p);
    if (this.source) this.source.mode = p ? 'locked' : 'free';
  }
  get locked() { return !!this.character.plane; }

  update(dt: number, f: FrameCtx, out: Skeleton) {
    const c = this.character;
    const it = this.source ? this.source.update(dt) : makeIntent();
    this.intent = this.script.apply(it);
    c.inputYaw = this.inputYaw;
    c.bpm = f.beat.bpm;
    c.update(dt, this.intent, f.beat.beats);
    this.pose(out);
    this.blendMocap(dt, out);
  }

  /** the Character's landmarks onto the rig (the procedural pose) */
  pose(out: Skeleton) {
    const c = this.character, P = c.pose, lm = this.lm;
    // the frame: the root on the floor under the hips, facing the way the pelvis faces
    const hx = (P[3 * J.LH] + P[3 * J.RH]) / 2, hz = (P[3 * J.LH + 2] + P[3 * J.RH + 2]) / 2;
    const sx = P[3 * J.LH] - P[3 * J.RH], sz = P[3 * J.LH + 2] - P[3 * J.RH + 2];
    // forward is side × up (up is +y): (sz, 0, -sx)… for a left at +x facing +z: side (1,0,0) → forward (0,0,1)
    const yaw = Math.hypot(sx, sz) > 1e-4 ? Math.atan2(-sz, sx) : c.yaw;
    lm.yaw = yaw;
    vec3.set(lm.root, hx, c.root[1], hz);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (let j = 0; j < NJ; j++) {
      const x = P[3 * j] - hx, y = P[3 * j + 1] - c.root[1], z = P[3 * j + 2] - hz;
      lm.p[3 * j] = x * cy - z * sy; lm.p[3 * j + 1] = y; lm.p[3 * j + 2] = x * sy + z * cy;
    }
    const h = this.hints, st = c.style, m = c.move;
    h.ground = c.grounded ? c.root[1] : c.lastGroundY;
    h.feet = st.feet ?? ['auto', 'auto'];
    const hands: [HandStyle, HandStyle] = st.hands ?? ['relaxed', 'relaxed'];
    h.hands = hands;
    h.lookAt = this.lookAtHead;
    h.look = this.lookAtHead && !(m && NO_LOOK.has(m.name)) && c.reformT < 0 ? intentParams.look : 0;
    h.curve = intentParams.curve;
    fitSkeleton(lm, out, 0, h);
    // standing, nothing goes through the floor (the rig's foot is a little longer than the landmarks know)
    if (c.grounded) {
      const R = out.pos, low = Math.min(R[JOINT.LeftToeBase][1], R[JOINT.RightToeBase][1], R[JOINT.LeftToeBaseEnd][1], R[JOINT.RightToeBaseEnd][1]) - 0.012;
      if (low < h.ground!) { const d = h.ground! - low; for (let k = 0; k < out.count; k++) R[k][1] += d; }
    }
  }

  /** free mode, at a walk: motion-matched locomotion, cross-faded in over the procedural pose */
  private blendMocap(dt: number, out: Skeleton) {
    const c = this.character, mv = this.mover;
    if (!mv || !this.moverSk) return;
    const speed = Math.hypot(c.v[0], c.v[2]);
    const P = intentParams;
    const free = !c.plane && c.grounded && !c.move && c.stagger <= 0 && c.reformT < 0 && c.camW < 0.5;
    const band = smooth((speed - P.walkFrom) / 0.35) * (1 - smooth((speed - P.walkTo) / 0.8));
    const want = free ? band * P.mocapWalk : 0;
    this.mocapW += (want - this.mocapW) * (1 - Math.exp(-dt * (want > this.mocapW ? 5 : 9)));
    if (this.mocapW < 1e-3 && want === 0) {
      this.mocapW = 0;
      // kept where the body is, so it starts from there when it's wanted
      if (this.moverWarm || Math.hypot(mv.x - c.x, mv.z - c.z) > 0.01) { mv.place(c.x, c.z, c.yaw); this.moverWarm = false; }
      return;
    }
    this.moverWarm = true;
    // asked to go where the body is going, facing its way, at its speed
    mv.goalX = c.x + c.v[0] * 0.8; mv.goalZ = c.z + c.v[2] * 0.8;
    mv.face = c.yaw;
    mv.arrive = 0.05;
    mv.maxSpeed = Math.max(0.4, speed * 1.05);
    mv.energy = 0.35;
    mv.update(dt, this.moverSk);
    // the clip's body, put over the physics' root (the physics owns where the dancer is)
    const S = this.moverSk.pos, dx = c.x - S[0][0], dz = c.z - S[0][2], dy = c.root[1];
    for (let k = 0; k < this.moverSk.count; k++) { S[k][0] += dx; S[k][1] += dy; S[k][2] += dz; }
    mv.x += dx; mv.z += dz; mv.sx += dx; mv.sz += dz;
    // blend: the procedural pose is in `out` now
    for (let k = 0; k < out.count; k++) { vec3.copy(this.procSk.pos[k], out.pos[k]); quat.copy(this.procSk.rot[k], out.rot[k]); }
    blendSkeletons(this.procSk, this.moverSk, this.mocapW, out);
  }

  /** start a move by name now (bend.move): the library's, or a registered clip */
  move(name: string, opts?: Parameters<Character['startMove']>[1]) {
    return this.character.startMove(name, opts);
  }
}

