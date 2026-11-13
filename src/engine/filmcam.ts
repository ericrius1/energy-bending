// The film's camera (a film's timeline, films/*.json, read by engine/film.ts): keyframes in shot time that the director
// turns into a pose every frame, laid over the game's own camera rig. A key sets any of: where it looks (`around`: the
// pair, a dancer, the stage, a point; with lag and lead room), the orbit round that (`yaw`, `pitch`, `dist`, `height`,
// `orbit` in rad/s), or an explicit path (`eye`, `look`), the lens (`fov` or `mm`), the composition (`frame`: where the
// subject sits on screen), the focus (`focus`: a dancer, the look point, metres), a seeded handheld drift, and the
// mode: `free` (these keys), `lock` (the rig's locked game screen) or `rig` (whatever the rig does: its follow camera,
// its director's shots, its crossing through a gate), blended over `blend` seconds. Values between keys are a
// Catmull-Rom spline with the time warped by each key's `ease` (inOut, in, out, linear, spline: no stop at the key,
// hold: a cut), so a move eases in and out, and several keys make one smooth path. The horizon is level by
// construction: the pose is an eye and a point looked at, and weft's camera has no roll. Pure arithmetic over what the
// scene says each frame (`FilmScene`), stepped with the film's dt: the same keys give the same path.
// docs/extending/film.md says how to add a primitive.

export type V3 = [number, number, number];
export type Ease = 'inOut' | 'in' | 'out' | 'linear' | 'spline' | 'hold';
/** what a camera looks round, or focuses on: the pair (both seats' middle, on the ground), a seat (`d0`, `d1`), the
 *  world's stage (its middle, on its floor), a point in the world; or one of those with a joint and an offset */
export type AnchorName = 'pair' | 'd0' | 'd1' | 'stage';
export type Anchor = AnchorName | V3 | { of: AnchorName; joint?: 'ground' | 'hips' | 'chest' | 'head' | 'hands'; offset?: V3 };
export type CamMode = 'free' | 'lock' | 'rig';

/** a camera key, its time resolved to shot seconds (the film's `at`, bar.beat or seconds, is resolved by film.ts) */
export interface CamKey {
  t: number;
  ease?: Ease;
  /** a cut: every value jumps to this key at its time (and the lag, the lead and the orbit start again), and the
   *  splines on either side don't see each other. A cut inside one shot is a cut within one continuous take: the
   *  dancers, the matter and the music go straight on */
  cut?: boolean;
  mode?: CamMode;
  /** seconds to blend into this key's mode (default 1.1, the rig's own lock ease) */
  blend?: number;
  around?: Anchor;
  /** the orbit (the rig's terms): yaw (rad, 0 = the eye at +z of what it looks at; `yawBase` is added), pitch (rad, up
   *  positive), dist (m), height (m above the anchor it looks at), and orbit (rad/s, integrated) */
  yaw?: number; pitch?: number; dist?: number; height?: number; orbit?: number;
  /** an explicit path instead of the orbit: the eye (a point or an anchor) and what it looks at */
  eye?: V3; look?: Anchor;
  /** the lens: field of view top to bottom (degrees), or a full-frame focal length (mm, 24 mm high) */
  fov?: number; mm?: number;
  /** seconds the anchor lags behind (a camera operator's follow), and seconds of its travel to lead by (lead room) */
  lag?: number; lead?: number;
  /** where the anchor sits on the screen: x, y in -1 … 1 of the half frame (0, 0 the middle; -0.3, 0 a third left) */
  frame?: [number, number];
  /** the focus: an anchor (its chest), 'look' (the point looked at, the rig's own), or metres */
  focus?: Anchor | 'look' | number;
  /** a handheld drift (0 off … 1 a gentle hand … 3 a nervous one) */
  handheld?: number;
}

/** what the camera can ask of the shot each frame (film.ts answers from the page) */
export interface FilmScene {
  /** an anchor's point now (null if it can't be found: a seat not here) */
  anchor(a: AnchorName, joint: string): V3 | null;
  /** the rig's own pose this frame (it runs underneath, locked or following) */
  rig: { eye: V3; look: V3; fov: number; focus: number };
  /** how much of the segment from the point looked at to the eye is clear (0 … 1): the gates' discs, a world's trunks
   *  (the rig's own `clearance`); the boom shortens to it, quickly in and slowly out */
  clear?(from: V3, to: V3): number;
  aspect: number;
}

export interface CamPose { eye: V3; look: V3; fov: number; focus: number; rigW: number }

const SCALARS = ['yaw', 'pitch', 'dist', 'height', 'orbit', 'fov', 'lag', 'lead', 'handheld', 'frameX', 'frameY'] as const;
type Scalar = typeof SCALARS[number];
const DEFAULTS: Record<Scalar, number> = { yaw: 0.35, pitch: 0.15, dist: 5.4, height: 1.0, orbit: 0, fov: 38, lag: 0.35, lead: 0, handheld: 0, frameX: 0, frameY: 0 };

export const smooth01 = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
const EASES: Record<Ease, (u: number) => number> = {
  inOut: (u) => u * u * u * (u * (u * 6 - 15) + 10),   // smootherstep: still at both keys
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
  linear: (u) => u,
  spline: (u) => u,
  hold: (u) => (u >= 1 ? 1 : 0),
};
/** Catmull-Rom through v0 v1 v2 v3 at u (0 … 1 between v1 and v2) */
const cr = (v0: number, v1: number, v2: number, v3: number, u: number) => {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * v1 + (-v0 + v2) * u + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 + (-v0 + 3 * v1 - 3 * v2 + v3) * u3);
};
export const fovOfMm = (mm: number) => (2 * Math.atan(12 / mm) * 180) / Math.PI;

/** a seeded generator (mulberry32): the handheld's phases */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Track { t: number[]; v: number[]; e: Ease[] }

export class FilmCamera {
  private tracks = new Map<Scalar, Track>();
  private anchors: { t: number; a: Anchor; e: Ease }[] = [];
  private focuses: { t: number; a: Anchor | 'look' | number; e: Ease }[] = [];
  private eyes: { t: number; a: Anchor; e: Ease }[] = [];
  private looks: { t: number; a: Anchor; e: Ease }[] = [];
  private modes: { t: number; m: CamMode; blend: number }[] = [];
  /** the eased anchor (lag), its velocity (lead), the integrated orbit */
  private S: V3 | null = null;
  private V: V3 = [0, 0, 0];
  private orbitAngle = 0;
  private cuts: number[] = [];
  private lastT: number | null = null;
  private waves: { f: number; p: number }[][] = [];
  /** added to every yaw: the shot's base (the pair side-on, the stage's normal), set once by film.ts */
  yawBase = 0;
  /** the first key's time: before it the anchor isn't lagged (the shot starts with its subject where it is) */
  private firstT = 0;
  private pull = 1;
  /** carry on from another camera's state (the same shot, its keys timed again: a jogo's grid became known) */
  adopt(o: FilmCamera) {
    this.S = o.S ? [...o.S] as V3 : null; this.V = [...o.V] as V3; this.orbitAngle = o.orbitAngle; this.lastT = o.lastT;
    this.yawBase = o.yawBase; this.pull = o.pull;
    return this;
  }

  constructor(keys: CamKey[], seed = 1) {
    const K = [...keys].sort((a, b) => a.t - b.t);
    this.firstT = K[0]?.t ?? 0;
    for (const k of K) {
      const e = k.cut ? 'hold' : k.ease ?? 'inOut';
      if (k.cut) this.cuts.push(k.t);
      const put = (s: Scalar, v: number | undefined) => {
        if (v === undefined) return;
        let tr = this.tracks.get(s);
        if (!tr) this.tracks.set(s, (tr = { t: [], v: [], e: [] }));
        tr.t.push(k.t); tr.v.push(v); tr.e.push(e);
      };
      for (const s of ['yaw', 'pitch', 'dist', 'height', 'orbit', 'lag', 'lead', 'handheld'] as const) put(s, k[s]);
      put('fov', k.fov ?? (k.mm ? fovOfMm(k.mm) : undefined));
      if (k.frame) { put('frameX', k.frame[0]); put('frameY', k.frame[1]); }
      if (k.around !== undefined) this.anchors.push({ t: k.t, a: k.around, e });
      if (k.focus !== undefined) this.focuses.push({ t: k.t, a: k.focus, e });
      if (k.eye !== undefined) this.eyes.push({ t: k.t, a: k.eye, e });
      if (k.look !== undefined) this.looks.push({ t: k.t, a: k.look, e });
      if (k.mode) this.modes.push({ t: k.t, m: k.mode, blend: k.blend ?? (k.cut ? 0 : 1.1) });
    }
    if (!this.anchors.length) this.anchors.push({ t: 0, a: 'pair', e: 'inOut' });
    const r = rng(seed * 7919 + 13);
    // three waves an axis (yaw, pitch, x, y, z) between 0.07 and 0.9 Hz: a breathing hand, never a buzz
    for (let a = 0; a < 5; a++) this.waves.push([0.07, 0.23, 0.61].map((f) => ({ f: f * (0.8 + 0.4 * r()), p: r() * Math.PI * 2 })));
  }

  /** the mode a time asks for (the last key at or before it) */
  modeAt(t: number): CamMode { let m: CamMode = 'free'; for (const k of this.modes) if (k.t <= t + 1e-9) m = k.m; return m; }
  /** every change of mode, in order (film.ts locks and unlocks the rig at them) */
  get modeKeys() { return this.modes; }

  private scalar(s: Scalar, t: number) {
    const tr = this.tracks.get(s);
    if (!tr) return DEFAULTS[s];
    const n = tr.t.length;
    if (t <= tr.t[0] || n === 1) return tr.v[0];
    if (t >= tr.t[n - 1]) return tr.v[n - 1];
    let i = 0;
    while (t >= tr.t[i + 1]) i++;
    if (i + 1 >= n) return tr.v[n - 1];
    const u = EASES[tr.e[i + 1]]((t - tr.t[i]) / Math.max(1e-6, tr.t[i + 1] - tr.t[i]));
    // (a spline's neighbours stop at a cut: the move after a cut doesn't bend toward the shot before it)
    const v0 = i > 0 && tr.e[i] !== 'hold' ? tr.v[i - 1] : tr.v[i];
    const v3 = i + 2 < n && tr.e[i + 2] !== 'hold' ? tr.v[i + 2] : tr.v[i + 1];
    return cr(v0, tr.v[i], tr.v[i + 1], v3, u);
  }

  /** a point-valued track (anchors): both ends evaluated now and mixed by the eased time */
  private pointTrack<T>(list: { t: number; a: T; e: Ease }[], t: number, at: (a: T) => V3 | null): V3 | null {
    if (!list.length) return null;
    let i = 0;
    while (i + 1 < list.length && list[i + 1].t <= t) i++;
    const A = at(list[i].a);
    if (i + 1 >= list.length || t <= list[0].t) return A;
    const B = at(list[i + 1].a);
    if (!A || !B) return A ?? B;
    const u = EASES[list[i + 1].e]((t - list[i].t) / Math.max(1e-6, list[i + 1].t - list[i].t));
    return [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u];
  }

  /** the rig's weight (0: these keys, 1: the rig's pose) at t, blending each change of mode over its `blend` */
  private rigWeight(t: number) {
    let w = 0;
    for (const k of this.modes) {
      if (k.t > t) break;
      const want = k.m === 'free' ? 0 : 1, from = w;
      w = from + (want - from) * smooth01((t - k.t) / Math.max(1e-3, k.blend));
    }
    return w;
  }

  private where(a: Anchor, s: FilmScene): V3 | null {
    if (Array.isArray(a)) return [a[0], a[1], a[2]];
    const o = typeof a === 'string' ? { of: a } : a;
    const p = s.anchor(o.of, (o as { joint?: string }).joint ?? 'ground');
    if (!p) return null;
    const off = (o as { offset?: V3 }).offset;
    return off ? [p[0] + off[0], p[1] + off[1], p[2] + off[2]] : p;
  }

  /** the pose at shot time t (stepped by dt: the lag, the lead and the orbit integrate) */
  update(t: number, dt: number, s: FilmScene): CamPose {
    const g = (k: Scalar) => this.scalar(k, t);
    // what it looks round: the anchor, lagged like an operator's follow, led by its travel
    const raw = this.pointTrack(this.anchors, t, (a) => this.where(a, s)) ?? [0, 0, 0];
    const lag = g('lag');
    // (a cut since the last frame: the operator starts again where the new shot is)
    if (this.lastT !== null && this.cuts.some((c) => c > this.lastT! && c <= t)) { this.S = null; this.V = [0, 0, 0]; this.orbitAngle = 0; }
    this.lastT = t;
    if (!this.S || t <= this.firstT) { this.S = [...raw] as V3; this.V = [0, 0, 0]; }
    const k = lag > 1e-3 ? 1 - Math.exp(-dt / lag) : 1;
    const S = this.S, was: V3 = [S[0], S[1], S[2]];
    for (let i = 0; i < 3; i++) S[i] += (raw[i] - S[i]) * k;
    const kv = 1 - Math.exp(-dt / 0.5);
    for (let i = 0; i < 3; i++) this.V[i] += ((S[i] - was[i]) / Math.max(dt, 1e-4) - this.V[i]) * kv;
    const lead = g('lead');
    const look: V3 = [S[0] + this.V[0] * lead, S[1] + g('height'), S[2] + this.V[2] * lead];
    this.orbitAngle += g('orbit') * dt;
    let eye: V3;
    if (this.eyes.length) {
      eye = this.pointTrack(this.eyes, t, (a) => this.where(a, s)) ?? [0, 2, 6];
      const L = this.pointTrack(this.looks, t, (a) => this.where(a, s));
      if (L) { look[0] = L[0]; look[1] = L[1]; look[2] = L[2]; }
    } else {
      const yaw = g('yaw') + this.yawBase + this.orbitAngle, pitch = g('pitch'), dist = g('dist');
      eye = [look[0] + Math.sin(yaw) * Math.cos(pitch) * dist, look[1] + Math.sin(pitch) * dist, look[2] + Math.cos(yaw) * Math.cos(pitch) * dist];
    }
    let fov = g('fov');
    // the composition: turn so the anchor sits at (fx, fy) on the screen, not in the middle
    const fx = g('frameX'), fy = g('frameY');
    if (fx || fy) {
      const d: V3 = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]], D = Math.hypot(...d) || 1;
      const r: V3 = [-d[2], 0, d[0]], rl = Math.hypot(r[0], r[2]) || 1;
      const ty = Math.tan((fov * Math.PI) / 360), tx = ty * s.aspect;
      const up: V3 = [(-d[0] * d[1]) / D / D, 1 - (d[1] * d[1]) / D / D, (-d[2] * d[1]) / D / D], ul = Math.hypot(...up) || 1;
      for (let i = 0; i < 3; i++) look[i] -= (r[i] / rl) * fx * tx * D + (up[i] / ul) * fy * ty * D;
    }
    // the hand: a slow seeded drift of the aim and the eye (no roll: the horizon stays level)
    const hh = g('handheld');
    if (hh > 0) {
      const w = (a: number) => this.waves[a].reduce((acc, { f, p }, i) => acc + Math.sin(t * f * Math.PI * 2 + p) / (i + 1), 0) / 1.83;
      const d: V3 = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]], D = Math.hypot(...d) || 1;
      const yawJ = w(0) * 0.0045 * hh, pitchJ = w(1) * 0.0032 * hh;
      const c = Math.cos(yawJ), sn = Math.sin(yawJ);
      const nx = d[0] * c - d[2] * sn, nz = d[0] * sn + d[2] * c;
      look[0] = eye[0] + nx; look[2] = eye[2] + nz; look[1] = eye[1] + d[1] + pitchJ * D;
      for (let a = 0; a < 3; a++) eye[a] += w(2 + a) * 0.012 * hh;
    }
    // the focus: on an anchor's chest, on the point looked at, or at a distance
    const focusOf = (a: Anchor | 'look' | number): number | null => {
      if (typeof a === 'number') return a;
      if (a === 'look') return Math.hypot(look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]);
      const p = this.where(typeof a === 'string' ? { of: a, joint: 'chest' } : a, s);
      return p ? Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) : null;
    };
    let focus = Math.hypot(look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]);
    if (this.focuses.length) {
      let i = 0;
      while (i + 1 < this.focuses.length && this.focuses[i + 1].t <= t) i++;
      const A = focusOf(this.focuses[i].a) ?? focus;
      if (i + 1 < this.focuses.length && t > this.focuses[0].t) {
        const B = focusOf(this.focuses[i + 1].a) ?? A;
        focus = A + (B - A) * EASES[this.focuses[i + 1].e]((t - this.focuses[i].t) / Math.max(1e-6, this.focuses[i + 1].t - this.focuses[i].t));
      } else focus = A;
    }
    // the boom shortened to what is clear (never closer than a body's width)
    if (s.clear) {
      const D = Math.hypot(eye[0] - look[0], eye[1] - look[1], eye[2] - look[2]) || 1;
      const want = Math.max(Math.min(1, s.clear(look, eye)), Math.min(1, 0.9 / D));
      this.pull += (want - this.pull) * (1 - Math.exp(-dt * (want < this.pull ? 16 : 1.6)));
      for (let a = 0; a < 3; a++) eye[a] = look[a] + (eye[a] - look[a]) * this.pull;
    }
    // over the rig: its pose (locked, following) weighed in by the mode
    const rw = this.rigWeight(t);
    if (rw > 0) {
      const R = s.rig;
      for (let a = 0; a < 3; a++) { eye[a] += (R.eye[a] - eye[a]) * rw; look[a] += (R.look[a] - look[a]) * rw; }
      fov += (R.fov - fov) * rw;
      focus += (R.focus - focus) * rw;
    }
    return { eye, look, fov, focus, rigW: rw };
  }
}
