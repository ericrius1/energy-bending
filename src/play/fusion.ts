// Fusion: for eight bars the two bodies are one event, then they part. The rules schedule it on a bar line (`fusion`
// { kind, t0, tEnd }) once both dancers hold merge within reach at the top of the tension; this makes it happen:
//
//   gathering  from the moment it is scheduled to its bar line: light drawn out of both bodies toward the middle,
//              the music's drop rising (music.fusion(kind, t0) lands on the same bar)
//   the landing a flash and a ring at the shared centre; the field gets a vortex there (field.vortex('fusion')), so
//              flame, water, steam and spray all start to turn round the pair; each body takes on some of the other's
//              matter (their loadouts mix: a fire dancer burns with water through it, and back), the camera stands back
//              (locked: a wider frame; free: it slowly orbits), and the dancers drift together
//   the eight bars  streams of light pour out of each body, round the shared centre and into the other, coloured from
//              one body into the other through the fusion's own colours; the kind decides what else happens:
//                steam   (fire + water)   heat and wet poured into the middle: a turning column of steam, lifting
//                prism   (fire + ice)     glints of every colour round the spiral, a white core, light split
//                storm   (plasma + water) arcs from the centre to both bodies and through the vortex, falling drops
//                aurora  (plasma + ice)   curtains of green, teal and violet rising round the pair, waving slowly
//   release    on the rules' `release`: the matter goes home (the loadouts back), the vortex off, a ring of ripples in
//              the world's water and of sparks on the air, the air pushed outward, the dancers parted, music.release()
import type { Dancer } from '../dancer/dancer';
import type { Loadout } from '../matter/core/kind';
import type { CameraRig } from '../engine/camera';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import type { FusionKind } from '../../shared/protocol.ts';
import type { JogoEvent, SeatBody } from './jogo';
import type { Glows, RGB } from './glow';
import { COLOURS, mixRGB } from './feel';
import { jogoParams } from './params';

type V3 = [number, number, number];

/** each fusion's palette: the colours its streams pass through on the way from one body to the other */
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
  field?: { vortex(id: string, v: { at: V3; axis?: V3; strength: number; radius: number; inflow?: number; lift?: number; height?: number } | null): void; deposit(d: { p: V3; r: number; heat?: number; wet?: number; wind?: V3 }): void } | null;
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
const SOURCES = [JOINT.Spine1, JOINT.LeftHand, JOINT.RightHand, JOINT.Head, JOINT.LeftFoot, JOINT.RightFoot, JOINT.Hips, JOINT.LeftForeArm, JOINT.RightForeArm, JOINT.LeftLeg, JOINT.RightLeg];

/** two loadouts mixed: `a` with `k` of `b`'s kinds worked through it (each layer's share scaled) */
export function mixLoadout(a: Loadout, b: Loadout, k: number): Loadout {
  const ta = a.layers.reduce((s, l) => s + l.share, 0) || 1, tb = b.layers.reduce((s, l) => s + l.share, 0) || 1;
  const layers = a.layers.map((l) => ({ ...l, share: (l.share / ta) * (1 - k) }));
  for (const l of b.layers) {
    if (l.kind === 'gems') continue;      // gems keep their own suite to their own dancer
    layers.push({ ...l, share: (l.share / tb) * k });
  }
  return { layers: layers.filter((l) => l.share > 0.001) };
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
  private mixed = 0;
  private centre: V3 = [0, 1, 0];
  private orbit = 0;
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
    const C = this.centre;
    const want = this.kind && now >= this.t0 ? 1 : 0;
    this.weight += (want - this.weight) * (1 - Math.exp(-dt * (want ? 1.2 : 0.8)));
    // the release's ring
    if (this.releasedAt != null) {
      const u = (now - this.releasedAt) / 1600;
      if (u >= 1) this.releasedAt = null;
      else for (let j = 0; j < 40; j++) {
        const ang = (j / 40) * Math.PI * 2, R = 0.3 + u * 3.2, k = (1 - u) * (1 - u);
        G.dot([C[0] + Math.cos(ang) * R, C[1] - 0.9 + Math.sin(u * 6 + j) * 0.05, C[2] + Math.sin(ang) * R], 0.03, j % 2 ? COLOURS[this.el(0)] : COLOURS[this.el(1)], 1.8 * k, 'spark');
      }
    }
    if (!this.kind || !a || !b) return;
    const kind = this.kind;
    if (now < this.t0) { this.gather(now, a, b); return; }
    if (!this.landed) this.land();
    const u = Math.min(1, (now - this.t0) / Math.max(1, this.tEnd - this.t0));
    // halfway: the bodies at their most mixed
    if (u > 0.4 && this.mixed < 2) this.mix(0.5, 2);
    const strength = jogoParams.vortex * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, u * 1.4)));
    this.ctx.field?.vortex('fusion', { at: [C[0], C[1] - 0.2, C[2]], axis: [0, 1, 0], strength, radius: 0.9, inflow: 0.8, lift: kind === 'steam' ? 1.6 : 0.7, height: 1.6 });
    this.streams(now, u, a, b);
    this.kindFrame(kind, now, u, dt);
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

  private land() {
    this.landed = true;
    const C = this.centre;
    this.mix(0.32, 1);
    // a flash and a ring where they meet, and the air thrown up
    this.ctx.field?.deposit({ p: C, r: 0.8, wind: [0, 4, 0] });
    this.flashAt = this.ctx.now();
  }
  private flashAt = -1e9;

  /** each body takes on k of the other's matter */
  private mix(k: number, step: number) {
    this.mixed = step;
    const set = this.ctx.setLoadout, A = this.ctx.dancer(0), B = this.ctx.dancer(1);
    if (!set || !A || !B) return;
    this.wore[0] ??= A.loadout; this.wore[1] ??= B.loadout;
    set(0, mixLoadout(this.wore[0], this.wore[1], k));
    set(1, mixLoadout(this.wore[1], this.wore[0], k));
  }

  /** the streams: light out of each body, round the shared centre, into the other */
  private streams(now: number, u: number, a: V3, b: V3) {
    const G = this.ctx.glows, C = this.centre, pal = FUSION_COLOURS[this.kind!];
    const A = this.ctx.dancer(0), B = this.ctx.dancer(1);
    const t = now / 1000, N = 180;
    const env = smooth(u / 0.08) * (1 - smooth((u - 0.9) / 0.1));
    // the landing's flash
    const fl = (now - this.flashAt) / 900;
    if (fl < 1) { G.dot(C, 0.3 + fl * 1.4, [1.6, 1.5, 1.4], 2.5 * (1 - fl) * (1 - fl), 'soft'); G.flat([C[0], C[1] - 1.0, C[2]], 0.3 + fl * 2.6, mixRGB(COLOURS[this.el(0)], COLOURS[this.el(1)], 0.5), 1.6 * (1 - fl), 'ring'); }
    for (let i = 0; i < N; i++) {
      const from = i % 2, src = from ? B : A, dst = from ? A : B;
      const j = SOURCES[i % SOURCES.length];
      const S = jointAt(src, j) ?? (from ? b : a), D = jointAt(dst, SOURCES[(i * 7) % SOURCES.length]) ?? (from ? a : b);
      const sp = 0.16 + 0.05 * hash(i);
      const s = (t * sp + hash(i * 3.1)) % 1;
      // out of one body, round the centre twice, into the other: the radius swells in the middle
      const base = lerp3(S, D, smooth(s));
      const ang = hash(i * 1.7) * 6.283 + t * (1.2 + 0.6 * hash(i)) + s * 12.566 * (from ? -1 : 1);
      const R = (0.55 + 0.75 * hash(i * 5.3)) * Math.sin(Math.PI * s);
      const p: V3 = [base[0] + (C[0] - base[0]) * 0.5 * Math.sin(Math.PI * s) + Math.cos(ang) * R, base[1] + Math.sin(Math.PI * s) * (0.15 + 0.4 * hash(i * 2.2)), base[2] + (C[2] - base[2]) * 0.5 * Math.sin(Math.PI * s) + Math.sin(ang) * R];
      const cA = COLOURS[this.el(from)], cB = COLOURS[this.el(1 - from)], mid = pal[i % pal.length];
      const col = s < 0.5 ? mixRGB(cA, mid, smooth(s * 2)) : mixRGB(mid, cB, smooth(s * 2 - 1));
      // a short streak along its way round, so the streams read as flowing, not as a cloud of points
      const q: V3 = [p[0] - Math.sin(ang) * 0.06 * (from ? -1 : 1), p[1], p[2] + Math.cos(ang) * 0.06 * (from ? -1 : 1)];
      G.seg(q, p, 0.014 + 0.01 * hash(i * 9), col, 1.1 * env * Math.sin(Math.PI * s), 'soft');
    }
    // the shared centre burns quietly
    G.dot(C, 0.16, mixRGB(pal[0], [1.4, 1.4, 1.4], 0.5), 0.8 * env, 'soft');
  }

  /** what each kind adds */
  private kindFrame(kind: FusionKind, now: number, u: number, dt: number) {
    const G = this.ctx.glows, C = this.centre, F = this.ctx.field, t = now / 1000, fr = this.ctx.frame();
    const env = smooth(u / 0.08) * (1 - smooth((u - 0.9) / 0.1));
    void dt;
    if (kind === 'steam') {
      // heat and wet poured into the middle: the field makes steam, the vortex turns and lifts it
      F?.deposit({ p: [C[0], C[1] - 0.4, C[2]], r: 0.6, heat: 1.2 * env, wet: 1.2 * env, wind: [0, 2.2, 0] });
    } else if (kind === 'prism') {
      // glints of every colour on the spiral, a white core: light split
      const pal = FUSION_COLOURS.prism;
      for (let i = 0; i < 60; i++) {
        const ang = i * 0.7 + t * 1.6, h = ((i * 0.037 + t * 0.15) % 1) * 2.4 - 0.6, R = 0.5 + 0.25 * Math.sin(i + t);
        G.seg([C[0] + Math.cos(ang) * R, C[1] + h - 0.05, C[2] + Math.sin(ang) * R], [C[0] + Math.cos(ang) * R, C[1] + h + 0.05, C[2] + Math.sin(ang) * R], 0.03, pal[i % pal.length], 1.4 * env, 'gem');
      }
      G.seg([C[0], C[1] - 0.9, C[2]], [C[0], C[1] + 1.2, C[2]], 0.05, [1.6, 1.6, 1.6], 0.9 * env, 'soft');
      F?.deposit({ p: C, r: 0.5, heat: 0.4 * env, wet: 0.2 * env });
    } else if (kind === 'storm') {
      // arcs from the centre to both bodies and through the vortex; drops falling round it
      if (fr % 3 === 0) {
        const A = this.ctx.dancer(0), B = this.ctx.dancer(1);
        const ha = jointAt(A, (fr >> 2) & 1 ? JOINT.LeftHand : JOINT.RightHand), hb = jointAt(B, (fr >> 3) & 1 ? JOINT.LeftHand : JOINT.RightHand);
        if (ha) this.ctx.arcs?.add(C, ha, 1.2 * env, 2);
        if (hb) this.ctx.arcs?.add(C, hb, 1.2 * env, 2);
        const ang = hash(fr) * 6.283;
        this.ctx.arcs?.add(C, [C[0] + Math.cos(ang) * 1.1, C[1] + 0.8 * (hash(fr + 1) - 0.3), C[2] + Math.sin(ang) * 1.1], 0.9 * env, 2);
      }
      for (let i = 0; i < 50; i++) {
        const ang = i * 2.39, R = 0.6 + 1.0 * hash(i * 4.1), y = 2.4 - (((t * (1.6 + hash(i)) + hash(i * 7)) % 1) * 3.2);
        G.seg([C[0] + Math.cos(ang) * R, C[1] + y, C[2] + Math.sin(ang) * R], [C[0] + Math.cos(ang) * R, C[1] + y - 0.12, C[2] + Math.sin(ang) * R], 0.008, [0.5, 0.75, 1.6], 1.2 * env, 'soft');
      }
      F?.deposit({ p: C, r: 0.5, wet: 0.8 * env, heat: 0.5 * env, wind: [0, 1.5, 0] });
    } else if (kind === 'aurora') {
      // curtains rising round the pair, waving
      const pal = FUSION_COLOURS.aurora;
      for (let c = 0; c < 9; c++) {
        const ang0 = (c / 9) * Math.PI * 2 + t * 0.15;
        for (let k = 0; k < 10; k++) {
          const ang = ang0 + k * 0.05 + Math.sin(t * 0.7 + c + k * 0.3) * 0.08, R = 1.5 + 0.2 * Math.sin(t + c);
          const y0 = C[1] - 0.6 + Math.sin(t * 0.9 + c * 1.3 + k * 0.2) * 0.15;
          G.seg([C[0] + Math.cos(ang) * R, y0, C[2] + Math.sin(ang) * R], [C[0] + Math.cos(ang) * R, y0 + 1.8 + 0.4 * Math.sin(t + k), C[2] + Math.sin(ang) * R], 0.05, pal[(c + (k >> 2)) % pal.length], 0.18 * env, 'soft');
        }
      }
      F?.deposit({ p: C, r: 0.6, heat: -0.6 * env, wind: [0, 1.0, 0] });
    }
  }

  /** the matter returns, the vortex stops, a ring of ripples and sparks, the dancers part */
  release() {
    if (!this.kind) return;
    this.kind = null;
    this.landed = false;
    this.releasedAt = this.ctx.now();
    this.ctx.field?.vortex('fusion', null);
    this.ctx.music?.release();
    const set = this.ctx.setLoadout;
    for (let s = 0; s < 2; s++) { const w = this.wore[s]; if (set && w) set(s, w); this.wore[s] = null; }
    this.mixed = 0;
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

  stats() { return { kind: this.kind, weight: +this.weight.toFixed(2), mixed: this.mixed }; }
}

function jointAt(d: Dancer | null, j: number): V3 | null {
  if (!d) return null;
  const W = d.skeleton.world, o = j * JOINT_FLOATS;
  return [W[o], W[o + 1], W[o + 2]];
}
const hash = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
