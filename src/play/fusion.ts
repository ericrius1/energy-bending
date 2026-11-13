// Fusion: for eight bars the two bodies are one event, then they part. The rules schedule it on a bar line (`fusion`
// { kind, t0, tEnd }) once both dancers hold merge within reach at the top of the tension; this makes it happen:
//
//   gathering  from the moment it is scheduled to its bar line: light drawn out of both bodies toward the middle,
//              the music's drop rising (music.fusion(kind, t0) lands on the same bar)
//   the landing both bodies are dressed in the fusion's flame (fire layers with `params: { fusion, side }`: water and
//              ice step back, gem hearts stay) and drawn through fire's temperature field with the kind's ramp
//              (matter/fire), so the two bodies sum into one luminous shape with two dancers moving inside it; it
//              ignites with a short swell (the field's `pulse`), rings the world's water, and a small soft light burns
//              at the middle (no disc: the jogo's glows write no focus); the field's fusion begins (field.fuse: the two
//              matters' auras wound into a double helix round a vortex at the pair, which fire's flames climb as two
//              strands and steam rises along); the camera stands back (locked: a wider frame; free: it slowly orbits)
//   the eight bars  the kind develops by the bar count (field.fuse's `bar`): the helix tightens toward the fourth bar
//              and opens after it, the column grows (aurora most); a few motes of the kind's colours drift round the
//              strands; storm adds arcs inside the body (its rain is fire's: falling flames in its field)
//   release    on the rules' `release`: the dancers are parted and the one body is let go outward for a beat
//              (RELEASE_MS: the field's bar past 8), then each body's own matter comes back (the loadouts), with a
//              ring of ripples in the world's water and of sparks on the floor, the air pushed outward, music.release()
import type { Dancer } from '../dancer/dancer';
import type { Loadout } from '../matter/core/kind';
import type { CameraRig } from '../engine/camera';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import type { FusionKind } from '../../shared/protocol.ts';
import type { JogoEvent, SeatBody } from './jogo';
import type { Glows, RGB } from './glow';
import { COLOURS } from './feel';
import { jogoParams } from './params';
import type { Fusion as FieldFusion } from '../matter/field/field';

type V3 = [number, number, number];

/** each fusion's palette: the colours of the motes that drift round its strands */
export const FUSION_COLOURS: Record<FusionKind, RGB[]> = {
  steam: [[1.3, 1.25, 1.2], [1.0, 0.9, 1.05], [1.4, 1.1, 0.8]],
  prism: [[1.6, 0.4, 0.4], [1.6, 1.3, 0.3], [0.4, 1.6, 0.6], [0.4, 0.8, 1.7], [1.1, 0.4, 1.7]],
  storm: [[0.6, 0.6, 1.8], [0.9, 0.5, 1.8], [0.4, 1.0, 1.7]],
  aurora: [[0.3, 1.6, 0.8], [0.3, 1.2, 1.5], [0.9, 0.4, 1.6]],
};

/** what fusion needs of the game */
export interface FusionCtx {
  glows: Glows;
  rig: CameraRig;
  dancer(seat: number): Dancer | null;
  /** the field: its fusion (matter/field: the helix of both auras round a vortex, and the steam's look per kind),
   *  and deposits for the landing's and the release's gusts */
  field?: { fuse(f: FieldFusion | null): void; deposit(d: { p: V3; r: number; heat?: number; wet?: number; wind?: V3 }): void } | null;
  /** a seat's dancer's slot in the show (what the field's fusion names) */
  slot?: (seat: number) => number;
  arcs?: { add(a: ArrayLike<number>, b: ArrayLike<number>, I?: number, frames?: number): void } | null;
  music?: { fusion(kind: FusionKind, at?: number): unknown; release(): unknown } | null;
  ripple?: (x: number, z: number, strength: number, radius: number) => void;
  /** dress a dancer (show.setLoadout); null where a page can't (a remote dancer's matter is still this page's) */
  setLoadout?: (seat: number, l: Loadout) => void;
  /** the room's clock (ms) */
  now(): number;
  frame(): number;
}

const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const lerp3 = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

/** how long the release holds the one body as it is let go, before each body's own matter returns (ms) */
const RELEASE_MS = 750;

/** a fusion's dress for one seat: the fusion's flame (its side named, so the field tells the two bodies apart; fire
 *  counts it as a whole dancer's flame whatever its share), and the seat's own matter other than flame kept, at its own
 *  share, on the feet only: water and ice step back to the floor (where the flame boils them thin) and on the release
 *  climb back from there, instead of being made anew and raining in */
export function fusionLoadout(own: Loadout, side: 0 | 1): Loadout {
  const kept = own.layers.filter((l) => l.kind !== 'fire' && l.kind !== 'plasma').map((l) => ({ ...l, parts: ['feet' as const] }));
  return { layers: [{ kind: 'fire', share: 0.001, params: { fusion: 1, side } }, ...kept] };
}

export class Fusion {
  /** scheduled or running: its kind and room times */
  kind: FusionKind | null = null;
  t0 = 0;
  tEnd = 0;
  /** the release: when it began (room ms), until a bar later */
  releasedAt: number | null = null;
  private landed = false;
  private wore: (Loadout | null)[] = [null, null];
  private dressed = false;
  private centre: V3 = [0, 1, 0];
  private floorY = 0;
  private orbit = 0;
  /** the kind just released (its body is let go in its own look) */
  private lastKind: FusionKind = 'steam';
  /** 0 … 1: how much the fusion holds the scene now (the light, the camera) */
  weight = 0;

  constructor(private bodies: readonly SeatBody[], private ctx: FusionCtx) {}

  /** in a fusion's eight bars (or its gathering) */
  get active() { return this.kind != null; }

  event(e: JogoEvent) {
    if (e.k === 'fusion') {
      this.kind = e.kind; this.t0 = e.t0; this.tEnd = e.tEnd; this.landed = false; this.releasedAt = null;
      this.ctx.music?.fusion(e.kind, e.t0);
    } else if (e.k === 'release') this.release();
    else if (e.k === 'phase' && (e.phase === 'over' || e.phase === 'waiting') && this.kind) this.release();
  }

  /** each frame */
  update(dt: number) {
    const now = this.ctx.now(), G = this.ctx.glows;
    const a = this.bodies[0]?.chest(), b = this.bodies[1]?.chest();
    if (a && b) this.centre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const ra = this.bodies[0]?.root(), rb = this.bodies[1]?.root();
    if (ra && rb) this.floorY = Math.min(ra[1], rb[1]);
    const C = this.centre;
    const want = this.kind && now >= this.t0 ? 1 : 0;
    this.weight += (want - this.weight) * (1 - Math.exp(-dt * (want ? 1.2 : 0.8)));
    // the release: the one body let go for a beat, then the matter home; a ring of sparks on the floor
    if (this.releasedAt != null) {
      const ms = now - this.releasedAt, u = ms / 1600;
      if (ms < RELEASE_MS && this.dressed) this.fuseField(this.lastKind, 8 + 0.6 * ms / RELEASE_MS, 1 - ms / RELEASE_MS, 0);
      else if (this.dressed) this.undress();
      if (u >= 1) this.releasedAt = null;
      else for (let j = 0; j < 40; j++) {
        const ang = (j / 40) * Math.PI * 2, R = 0.3 + u * 3.2, k = (1 - u) * (1 - u);
        G.dot([C[0] + Math.cos(ang) * R, this.floorY + 0.05 + Math.sin(u * 6 + j) * 0.03, C[2] + Math.sin(ang) * R], 0.03, j % 2 ? COLOURS[this.el(0)] : COLOURS[this.el(1)], 1.4 * k, 'spark');
      }
    }
    if (!this.kind || !a || !b) return;
    const kind = this.kind;
    if (now < this.t0) { this.gather(now, a, b); return; }
    if (!this.landed) this.land();
    const u = Math.min(1, (now - this.t0) / Math.max(1, this.tEnd - this.t0));
    const env = smooth(u / 0.05);
    this.fuseField(kind, 8 * u, env * Math.max(this.weight, 0.35), Math.exp(-Math.max(0, now - this.flashAt) / 380));
    this.motes(now, u);
    this.kindFrame(kind, u);
  }

  /** the field's fusion for this frame: the helix tightens toward the fourth bar and opens after it, opens wide on the
   *  release; aurora's is taller and turns at half time */
  private fuseField(kind: FusionKind, bar: number, amount: number, pulse: number) {
    const sa = this.ctx.slot?.(0) ?? 0, sb = this.ctx.slot?.(1) ?? 1;
    if (sa < 0 || sb < 0) return;
    const C = this.centre, aurora = kind === 'aurora';
    const k = bar <= 4 ? smooth(bar / 4) : bar <= 8 ? 1 - 0.45 * smooth((bar - 4) / 4) : 0.55 - 0.55 * smooth((bar - 8) / 0.6);
    const half = aurora ? 1.45 : 1.05;
    const strength = jogoParams.vortex * (0.6 + 0.4 * k) / 2;
    // the strands wind round both bodies (half their distance apart and a little more), so the helix holds the pair
    const a = this.bodies[0]?.chest(), b = this.bodies[1]?.chest();
    const apart = a && b ? Math.hypot(a[0] - b[0], a[2] - b[2]) / 2 : 0.2;
    // (a wider helix winds fewer turns a metre, so its strands keep their slope and read as a helix, not as rings)
    const radius = Math.max(0.62 - 0.2 * k, apart + 0.34 - 0.1 * k) + (bar > 8 ? 0.6 * (bar - 8) : 0);
    this.ctx.field?.fuse({
      dancers: [sa, sb], kind, amount, strength, bar, pulse, floorY: this.floorY,
      at: [C[0], this.floorY + half + 0.05, C[2]], height: half,
      radius, tightness: (0.42 + 0.5 * k) * Math.min(1, 0.5 / radius), speed: aurora ? 0.38 : 0.75,
      width: 0.14,
    });
  }

  /** in the 'camera' phase, after the follow camera is aimed: stand back while it holds, and in the free view turn
   *  slowly round the pair */
  camera(dt: number) {
    const rig = this.ctx.rig;
    rig.framePad = jogoParams.fusionPad * smooth(this.weight);
    if (rig.follow && this.weight > 0.01) {
      this.orbit += dt * jogoParams.fusionOrbit * this.weight;
      rig.follow = { ...rig.follow, yaw: rig.follow.yaw + this.orbit, spread: (rig.follow.spread ?? 0) + 1.6 * this.weight };
    } else if (this.weight <= 0.01) this.orbit *= Math.exp(-dt);
  }

  private el(seat: number) { return this.bodies[seat]?.element() ?? 'gems'; }

  /** before the bar line: light drawn out of both bodies to the middle */
  private gather(now: number, a: V3, b: V3) {
    const G = this.ctx.glows, C = this.centre;
    const k = smooth(1 - (this.t0 - now) / 2200);
    for (let s = 0; s < 2; s++) {
      const from = s ? b : a, col = COLOURS[this.el(s)];
      for (let i = 0; i < 18; i++) {
        const ph = ((now / 700 + i / 18) % 1), p = lerp3(from, C, ph);
        const ang = i * 2.39 + now / 300;
        G.dot([p[0] + Math.cos(ang) * 0.25 * (1 - ph), p[1] + Math.sin(ang) * 0.2 * (1 - ph), p[2] + Math.sin(ang) * 0.25 * (1 - ph)], 0.025, col, 1.4 * k * ph, 'spark');
      }
    }
    G.dot(C, 0.08 + 0.12 * k, [1.5, 1.4, 1.3], 1.2 * k, 'soft');
  }

  /** the landing: both bodies become the fusion's flame, the air thrown up, the water rung */
  private land() {
    this.landed = true;
    const C = this.centre;
    this.dress();
    this.ctx.field?.deposit({ p: C, r: 0.8, wind: [0, 4, 0] });
    this.ctx.ripple?.(C[0], C[2], 0.9, 0.9);
    this.flashAt = this.ctx.now();
  }
  private flashAt = -1e9;

  /** both bodies into the fusion's flame (what each wore kept for the release) */
  private dress() {
    const set = this.ctx.setLoadout, A = this.ctx.dancer(0), B = this.ctx.dancer(1);
    if (!set || !A || !B) return;
    this.wore[0] ??= A.loadout; this.wore[1] ??= B.loadout;
    set(0, fusionLoadout(this.wore[0], 0));
    set(1, fusionLoadout(this.wore[1], 1));
    this.dressed = true;
  }

  /** each body's own matter back, the field's fusion over */
  private undress() {
    const set = this.ctx.setLoadout;
    for (let s = 0; s < 2; s++) { const w = this.wore[s]; if (set && w) set(s, w); this.wore[s] = null; }
    this.dressed = false;
    this.ctx.field?.fuse(null);
  }

  /** a few motes of the kind's colours drifting round the strands (the stars in the references), soft and small; and
   *  the landing's light at the middle (soft: it writes no focus, so it cuts nothing) */
  private motes(now: number, u: number) {
    const G = this.ctx.glows, C = this.centre, pal = FUSION_COLOURS[this.kind!], t = now / 1000;
    const env = smooth(u / 0.08) * (1 - smooth((u - 0.92) / 0.08));
    const fl = (now - this.flashAt) / 600;
    if (fl < 1) G.dot(C, 0.22 + fl * 0.35, [1.4, 1.35, 1.3], 1.3 * (1 - fl) * (1 - fl), 'soft');
    const N = this.kind === 'storm' ? 70 : 46, tall = this.kind === 'aurora' ? 3.6 : 2.4;
    for (let i = 0; i < N; i++) {
      const ang = hash(i * 3.3) * 6.283 + t * (0.25 + 0.3 * hash(i * 1.9)) * (i % 2 ? 1 : -1);
      const R = 0.5 + 0.9 * hash(i * 5.1), y = this.floorY + 0.2 + ((hash(i * 7.7) + t * 0.05 * (1 + hash(i))) % 1) * tall;
      const tw = 0.5 + 0.5 * Math.sin(t * (2 + 3 * hash(i * 2.1)) + i);
      G.dot([C[0] + Math.cos(ang) * R, y, C[2] + Math.sin(ang) * R], 0.012, pal[i % pal.length], 0.9 * env * tw * tw, 'spark');
    }
  }

  /** storm's arcs, inside the body: between the two bodies' hands, from its middle to a hand, from the floor to a head */
  private kindFrame(kind: FusionKind, u: number) {
    const C = this.centre, fr = this.ctx.frame();
    const env = smooth(u / 0.08) * (1 - smooth((u - 0.9) / 0.1));
    if (kind !== 'storm' || fr % 4 !== 0 || hash(fr * 0.37) > 0.6) return;
    const A = this.ctx.dancer(0), B = this.ctx.dancer(1);
    const ha = jointAt(A, (fr >> 2) & 1 ? JOINT.LeftHand : JOINT.RightHand), hb = jointAt(B, (fr >> 3) & 1 ? JOINT.LeftHand : JOINT.RightHand);
    if ((fr >> 4) & 1) { if (ha && hb) this.ctx.arcs?.add(ha, hb, 0.9 * env, 2); }
    else if (ha) this.ctx.arcs?.add(C, ha, 0.8 * env, 2);
    const hd = jointAt((fr >> 5) & 1 ? A : B, JOINT.Head);
    if (hd && hash(fr + 3) < 0.4) this.ctx.arcs?.add([C[0], this.floorY + 0.15, C[2]], hd, 0.7 * env, 2);
  }

  /** the vortex stops, the dancers part, the one body is let go for a beat (then the matter returns: update) */
  release() {
    if (!this.kind) return;
    this.lastKind = this.kind;
    this.kind = null;
    this.landed = false;
    this.releasedAt = this.ctx.now();
    this.ctx.music?.release();
    // (a release before the landing: nothing was dressed, nothing to let go)
    if (!this.dressed) this.ctx.field?.fuse(null);
    const C = this.centre;
    for (let j = 0; j < 8; j++) {
      const ang = (j / 8) * Math.PI * 2;
      this.ctx.ripple?.(C[0] + Math.cos(ang) * 0.6, C[2] + Math.sin(ang) * 0.6, 0.8, 0.5);
      this.ctx.field?.deposit({ p: [C[0] + Math.cos(ang) * 0.5, C[1] - 0.3, C[2] + Math.sin(ang) * 0.5], r: 0.5, wind: [Math.cos(ang) * 6, 1, Math.sin(ang) * 6] });
    }
    this.ctx.ripple?.(C[0], C[2], 1.2, 1.2);
    // the dancers part
    for (let s = 0; s < 2; s++) {
      const c = this.bodies[s]?.character, r = this.bodies[s]?.root();
      if (!c || !r) continue;
      const dx = r[0] - C[0], dz = r[2] - C[2], l = Math.hypot(dx, dz) || 1, sgn = s ? 1 : -1;
      c.applyKnock(l > 0.05 ? (dx / l) * 2.4 : sgn * 2.4, 2.4, 0.12, l > 0.05 ? (dz / l) * 2.4 : 0);
    }
  }

  stats() { return { kind: this.kind, weight: +this.weight.toFixed(2), dressed: this.dressed }; }
}

function jointAt(d: Dancer | null, j: number): V3 | null {
  if (!d) return null;
  const W = d.skeleton.world, o = j * JOINT_FLOATS;
  return [W[o], W[o + 1], W[o + 2]];
}
const hash = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
