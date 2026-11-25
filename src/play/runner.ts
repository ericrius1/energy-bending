// The Dance as a runner (open 3D, the default): both dancers run on their own round a loop laid through the world
// (track.ts), side by side, and the player only slides across it (A D, the arrows, a stick, a thumb) and quickens or
// slows; Space jumps the moment it is pressed (again in the air: a somersault), the trick buttons play the Flow Surf
// tricks on the run. Flow Rings stand along the track in its lanes, some high enough to jump through (surf.ts).
//
// Two views, V (Tab, the View button, the touch pad's lock) between them: behind the pair (the chase, the way a lane
// game is seen), or from the side, the pair running across the screen. The camera is this module's own (a pose for
// the rig, CameraRig.pose), led by the track and not by the bodies, so it turns as smoothly as the loop does and a
// slide across never swings it; a change of view swings it round the pair in about a second.
//
// Before this the dance's movement fought the player: the stick read relative to a camera that turned with the body,
// the soft edge and the rim guidance turned the body back, and the solids pushed it, all at once, and the bodies
// jittered. On the track nothing steers a body but its stick (Character.rail).
//
// The partner (and both seats with &agents=2) is a RunnerBrain: the Flow Surf partner's tricks and its mirrored
// tricks (Sync Unison), with its own line: alongside the player, through the active ring when the player leaves it,
// jumping the high ones.
import type { FrameBuilder, FrameCtx } from '../engine/frame';
import type { CameraRig } from '../engine/camera';
import type { Character, Rail } from '../dancer/character';
import type { Intent } from '../input/intent';
import type { World } from '../worlds/world';
import type { SurfEngine, FlowRing } from './surf';
import type { Brain, PartnerView } from './partner';
import { Track, trackFor } from './track';
import { LOOPS } from './loops';
import { showCamToast } from '../duel/help';

type V3 = [number, number, number];
export type RunView = 'chase' | 'side';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** the run's numbers */
export const RUN = {
  /** metres a beat at the cruise (one stride cycle a beat: the feet on the eighths); clamped to [min, max] m/s */
  perBeat: 3.2, min: 5.2, max: 7.4,
  /** across at a full stick (m/s) */
  slide: 5.2,
  /** how far either side of the middle (m) */
  half: 1.8,
  chase: { back: 6.0, up: 2.55, look: 1.0, fov: 58 },
  side: { dist: 7.4, up: 1.55, look: 1.0, lead: 1.1, fov: 44 },
  /** a change of view (s) */
  swing: 1.0,
};

export interface RunnerCtx {
  frame: FrameBuilder;
  rig: CameraRig;
  world: () => World;
  /** each seat's body (null: none yet) */
  chars: () => readonly (Character | null)[];
  /** the music's tempo now */
  bpm: () => number;
  surf: SurfEngine | null;
  /** is the runner on (the open 3D dance, not the side lock, not a film) */
  on: () => boolean;
}

/** the world the runner runs in when asked for one without a loop (the geode's hall: the dance goes out to the pool) */
export const runWorld = (asked: string) => (LOOPS[asked] ? asked : 'pool');

export class Runner {
  track: Track | null = null;
  view: RunView = 'chase';
  /** set on the frame the view changed (the tutorial reads it) */
  toggled = false;
  private trackWorld = '';
  /** the camera's place on the track (s unwrapped, l), its height, the view's blend (0 chase … 1 side) */
  private cs = 0; private cl = 0; private cy = 0; private blend = 0; private camInit = false;
  /** the camera's frame this frame (the steering reads the stick through it) */
  private camF: [number, number] = [0, 1];
  readonly rail: Rail;

  constructor(private ctx: RunnerCtx) {
    const self = this;
    this.rail = {
      at: (x, z) => self.track ? self.track.at(x, z) : { f: [0, 1], r: [1, 0], yaw: 0, l: 0 },
      get half() { return self.track?.half ?? RUN.half; },
      get speed() { return clamp((ctx.bpm() / 60) * RUN.perBeat, RUN.min, RUN.max); },
      slide: RUN.slide,
      steer: (c, it) => self.steer(c, it),
      respawn: (c) => self.respawn(c),
    };
    ctx.frame.tick('travel', () => this.sync(), 'runner: the track for this world, the bodies on it');
    ctx.frame.tick('camera', (f: FrameCtx) => this.camera(f.dt), 'runner: the chase or the side camera');
  }

  /** the loop for the world shown (laid once per world), and every body on it while the runner is on */
  private sync() {
    const on = this.ctx.on(), w = this.ctx.world();
    if (on && w.id !== this.trackWorld) {
      this.trackWorld = w.id;
      this.track = trackFor(w.id, RUN.half);
      this.camInit = false;
      if (this.track) console.info(`runner: ${w.id} loop, mean radius ${this.track.R.toFixed(2)} m, lap ${this.track.length.toFixed(1)} m`);
      else console.info(`runner: ${w.id} has no loop`);
    }
    for (const c of this.ctx.chars()) if (c) c.rail = on && this.track ? this.rail : null;
    if (on) this.regroup();
    this.ctx.surf?.setTrack(on ? this.track : null);
  }

  toggle() {
    this.view = this.view === 'chase' ? 'side' : 'chase';
    this.toggled = true;
    showCamToast(this.view === 'side' ? 'Side view · V to run behind them' : 'Behind the runners · V for the side view');
  }

  /** the stick, as the view shows it: across the track and along it */
  private steer(c: Character, it: Intent): { lat: number; push: number; target?: number } {
    if (it.railTarget != null) return { lat: 0, push: it.railPush ?? 0, target: it.railTarget };
    const T = this.track;
    if (!T) return { lat: 0, push: 0 };
    // (the arrow keys give the camera's look rate in open 3D: on the track they steer as A D W S do)
    const mx = Math.abs(it.moveX) > 0.05 ? it.moveX : clamp(it.camX, -1, 1);
    const mz = Math.abs(it.moveZ) > 0.05 ? it.moveZ : clamp(it.camY / 0.65, -1, 1);
    const F = T.at(c.root[0], c.root[2]);
    const cf = this.camF, cr: [number, number] = [cf[1], -cf[0]];
    const wx = cr[0] * mx + cf[0] * mz, wz = cr[1] * mx + cf[1] * mz;
    return { lat: wx * F.r[0] + wz * F.r[1], push: wx * F.f[0] + wz * F.f[1] };
  }

  /** the other way: the keys (moveX, moveZ) that slide body c across (+ right) and push it along, in this view */
  stickFor(c: Character, lat: number, push = 0): { moveX: number; moveZ: number } {
    const T = this.track;
    if (!T) return { moveX: lat, moveZ: push };
    const F = T.at(c.root[0], c.root[2]), cf = this.camF, cr: [number, number] = [cf[1], -cf[0]];
    const wx = F.r[0] * lat + F.f[0] * push, wz = F.r[1] * lat + F.f[1] * push;
    return { moveX: wx * cr[0] + wz * cr[1], moveZ: wx * cf[0] + wz * cf[1] };
  }

  /** a body re-forms beside the other one (the partner beside the player, the player where it stands), in its own lane */
  private respawn(c: Character): [number, number] {
    const T = this.track!;
    const lead = this.ctx.chars()[0];
    const from = c.seat && lead && lead !== c ? lead : c;
    const s = T.project(from.root[0], from.root[2], this.cs).s + (c.seat ? -0.5 : 0);
    return T.point(s, c.seat ? 1.1 : -1.1);
  }

  /** a partner left far behind (or far ahead: a re-form, a stumble) re-forms beside the player */
  private regroup() {
    const T = this.track, [a, b] = this.ctx.chars();
    if (!T || !a || !b || a.reformT >= 0 || b.reformT >= 0) return;
    const sa = T.project(a.root[0], a.root[2], this.cs).s, sb = T.project(b.root[0], b.root[2], sa).s;
    if (Math.abs(sa - sb) > 16) b.spawn();
  }

  private camera(dt: number) {
    const rig = this.ctx.rig, T = this.track;
    this.toggled = false;
    if (!this.ctx.on() || !T) { if (this.camInit) { rig.pose = null; this.camInit = false; } return; }
    const cs = this.ctx.chars().filter((c): c is Character => !!c);
    if (!cs.length) return;
    // where the pair is on the track (the player weighed more)
    let s = 0, l = 0, y = 0, wsum = 0;
    cs.forEach((c, i) => {
      const w = i === 0 ? 0.62 : 0.38, p = T.project(c.root[0], c.root[2], this.cs);
      const g = c.groundY ?? c.root[1];
      s += p.s * w; l += p.l * w; y += (g + Math.max(0, c.root[1] - g) * 0.35) * w; wsum += w;
    });
    s /= wsum; l /= wsum; y /= wsum;
    if (!this.camInit) { this.cs = s; this.cl = l; this.cy = y; this.blend = this.view === 'side' ? 1 : 0; this.camInit = true; }
    this.cs += (s - this.cs) * (1 - Math.exp(-dt * 12));
    this.cl += (l * 0.55 - this.cl) * (1 - Math.exp(-dt * 2.5));
    this.cy += (y - this.cy) * (1 - Math.exp(-dt * 4));
    const want = this.view === 'side' ? 1 : 0;
    const step = dt / RUN.swing;
    this.blend = want > this.blend ? Math.min(want, this.blend + step) : Math.max(want, this.blend - step);
    const b = smooth(this.blend);

    // the pair's point, and the two poses about it as (angle, distance, height) round it, swung between
    const F = T.frame(this.cs);
    const [px, pz] = T.point(this.cs, this.cl);
    const C = RUN.chase, S = RUN.side;
    // chase: behind along the loop itself (so the eye stays in the world on a tight loop)
    const [ex, ez] = T.point(this.cs - C.back, this.cl);
    const chaseAng = Math.atan2(ex - px, ez - pz), chaseDist = Math.hypot(ex - px, ez - pz);
    // side: out past the loop, looking in across it at the pair (the world's middle behind them: the mirrors, the
    // temple's island; from inside the loop a mirror stood between the eye and the pair now and then), a little ahead.
    // Running anticlockwise, the pair crosses the screen left to right
    const out: [number, number] = [F.p[0] - T.cx, F.p[1] - T.cz];
    const ol = Math.hypot(out[0], out[1]) || 1;
    const sideAng = Math.atan2(out[0] / ol, out[1] / ol);
    const ang = chaseAng + wrapPi(sideAng - chaseAng) * b;
    const dist = chaseDist + (S.dist - chaseDist) * b;
    const up = C.up + (S.up - C.up) * b;
    const lead = S.lead * b;
    const ax = px + F.f[0] * lead, az = pz + F.f[1] * lead;
    const eye: V3 = [ax + Math.sin(ang) * dist, this.cy + up, az + Math.cos(ang) * dist];
    // the look: straight on through the pair (the chase looks past them, along their way; the side at them)
    const lookY = this.cy + C.look + (S.look - C.look) * b;
    const tx = ax - eye[0], tz = az - eye[2], tl = Math.hypot(tx, tz) || 1;
    const past = 4.0 * (1 - b);
    const look: V3 = [ax + (tx / tl) * past, lookY - 0.25 * (1 - b), az + (tz / tl) * past];
    rig.pose = { eye, look, fov: C.fov + (S.fov - C.fov) * b };
    this.camF = [tx / tl, tz / tl];
  }
}

export interface RunnerBrainCtx {
  track: () => Track | null;
  ring: () => FlowRing | null;
}

/** the partner on the track: the Flow Surf partner's tricks, and its own line (alongside, through the ring the player
 *  leaves, over the high ones) */
export class RunnerBrain implements Brain {
  private lane = 1;
  private jumpT = 0;
  private t = 0;
  constructor(private ctx: RunnerBrainCtx, private tricks: Brain | null, private seed = 3) {}

  think(v: PartnerView): Intent {
    const it = this.tricks ? this.tricks.think(v) : ({} as Intent);
    const T = this.ctx.track();
    const dt = Math.min(Math.max(v.dt, 0), 0.1);
    this.t += dt;
    it.moveX = 0; it.moveZ = 0;
    // (its own jumps only: a held jump from the surf partner would wait for a charge that the track doesn't have)
    it.jump = false; it.jumpHeld = false;
    if (!T) return it;
    const me = v.me, my = T.project(me.root[0], me.root[2]);
    const them = T.project(v.them.root[0], v.them.root[2], my.s);
    // alongside: the side of the player with more room
    if (Math.abs(them.l) > 0.6) this.lane = them.l > 0 ? -1 : 1;
    let target = clamp(them.l + this.lane * 1.25, -T.half, T.half);
    if (Math.abs(target - them.l) < 0.9) target = clamp(them.l - this.lane * 1.25, -T.half, T.half);
    const ring = this.ctx.ring();
    if (ring && ring.s != null) {
      const ahead = T.project(ring.at[0], ring.at[2], my.s).s - my.s;
      const theirs = Math.abs((ring.l ?? 0) - them.l) < 0.9;
      // through it when the player isn't going to be, or when it's high (the show of the two over it together)
      if (ahead > 0 && ahead < 13 && (!theirs || ring.high)) target = ring.l ?? 0;
      if (ring.high && ahead > 1.4 && ahead < 2.6 && Math.abs(my.l - (ring.l ?? 0)) < 1.1 && me.grounded) this.jumpT = 0.12;
    }
    it.railTarget = target;
    // keep level with the player (half a metre behind, so the player leads): up to three times a player's push to
    // catch up, so a partner held up by a trick is back beside the player in a couple of seconds
    it.railPush = clamp((them.s - 0.5 - my.s) * 0.6, -1.5, 3);
    if (this.jumpT > 0) { it.jump = this.jumpT > 0.1; it.jumpHeld = true; this.jumpT -= dt; }
    void this.seed;
    return it;
  }
}
