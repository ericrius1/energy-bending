// Cooperative Flow Surf world engine: Harmonic Flow Rings, Elemental Wake Ribbons & Drafting Reactions
// (Steam Boost, Aurora Surge, Prism Refract), Cyclone Partner Vortexes, Sync Unison detection, 3D spiral
// charge coils, and smooth arena-rim flow guidance. Pure simulation + Glows/Field/Audio callbacks (no DOM).
import type { Character } from '../dancer/character';
import type { Element } from './jogo';
import type { Glows, RGB } from './glow';
import { COLOURS, mixRGB } from './feel';
import { arenaFor } from '../duel/arena';
import type { Track } from './track';

type V3 = [number, number, number];

export interface FlowRing {
  id: number;
  at: V3;
  /** unit horizontal tangent pointing along the circuit */
  dir: [number, number];
  radius: number;
  /** true for temporary vortex rings spawned by charged Cyclone spins */
  vortex?: boolean;
  owner?: number;
  el?: Element;
  life?: number;
  maxLife?: number;
  /** on the runner's track: how far along (m) and right of the middle (m) */
  s?: number;
  l?: number;
  /** a high ring: jumped through */
  high?: boolean;
}

export interface WakeNode {
  p: V3;
  age: number;
  el: Element;
  dissolve: number;
  speed: number;
}

export interface SurfEvent {
  k: 'ring' | 'reaction' | 'unison' | 'vortex' | 'trick' | 'chargeTier';
  seat: number;
  label: string;
  sub?: string;
  gold: boolean;
  points: number;
  combo: number;
  at: V3;
  el: Element;
  tier?: number;
}

export interface SurfCtx {
  glows: Glows;
  world(): string;
  groundAt(x: number, z: number): number;
  /** deposit heat/wet/wind into the GPU atmospheric field */
  deposit?(d: { p: V3; r: number; heat?: number; wet?: number; wind?: V3 }): void;
  /** trigger plasma arcs for Aurora / Prism reactions */
  arc?(a: V3, b: V3, I?: number, frames?: number): void;
  /** ripple world water (pool / temple) */
  ripple?(x: number, z: number, s: number, r: number): void;
  /** play a musical SFX cue */
  sfx?(name: string, at: V3, opts: Record<string, unknown>): void;
  /** feed Flow and Harmony (Tension) into the active Room session */
  award?(seat: number, flow: number, harmony: number, axe: number): void;
}

interface BurstFx {
  t: number;
  life: number;
  draw(u: number): void;
}

const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const wrapPi = (a: number) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

const TRICK_MOVES = new Set([
  'somersault', 'backflip', 'corkscrew', 'cyclone', 'hydro-slip', 'ember-surge', 'surf-carve', 'spin', 'au', 'macaco', 'pirueta',
]);

const TRICK_NAMES: Record<string, string> = {
  somersault: 'SOMERSAULT',
  backflip: 'BACKFLIP',
  corkscrew: 'CORKSCREW 540°',
  cyclone: 'CYCLONE SPIN',
  'hydro-slip': 'HYDRO-SLIP WAVE',
  'ember-surge': 'EMBER DISSOLVE',
  'surf-carve': 'POWER CARVE',
  spin: 'PIROUETTE',
  au: 'AÚ CARTWHEEL',
};

const GOLD: RGB = [1.75, 1.45, 0.65];
const TEAL_HI: RGB = [0.45, 1.55, 1.65];
const WHITE_GOLD: RGB = [1.8, 1.68, 1.28];

/** graceful closed-loop Flow Ring circuit per world, avoiding center obstacles & rim walls */
export function circuitFor(worldId: string, groundAt: (x: number, z: number) => number = () => 0): FlowRing[] {
  const presets: Record<string, { rx: number; rz: number; cx: number; cz: number; heights: number[] }> = {
    geode:    { rx: 4.5, rz: 3.7, cx: 0.0, cz: 0.9, heights: [0.95, 1.45, 1.0, 1.5, 0.95, 1.38] },
    pool:     { rx: 5.1, rz: 4.7, cx: 0.0, cz: 0.0, heights: [1.0, 1.5, 1.05, 1.55, 1.0, 1.4] },
    temple:   { rx: 5.0, rz: 4.6, cx: 0.0, cz: -0.3, heights: [1.0, 1.5, 1.05, 1.55, 1.0, 1.4] },
    redwoods: { rx: 4.7, rz: 4.3, cx: 0.2, cz: 0.2, heights: [0.95, 1.48, 1.0, 1.52, 0.95, 1.4] },
  };
  const cfg = presets[worldId] ?? presets.geode;
  const N = cfg.heights.length;
  const rings: FlowRing[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + 0.35;
    const x = cfg.cx + Math.cos(a) * cfg.rx;
    const z = cfg.cz + Math.sin(a) * cfg.rz;
    const tx = -Math.sin(a) * cfg.rx;
    const tz = Math.cos(a) * cfg.rz;
    const tl = Math.hypot(tx, tz) || 1;
    const gy = groundAt(x, z);
    rings.push({
      id: i,
      at: [x, gy + cfg.heights[i], z],
      dir: [tx / tl, tz / tl],
      radius: 1.38,
    });
  }
  return rings;
}

/** reaction name and color when seat's element drafts across partner's element wake */
export function reactionFor(a: Element, b: Element): { label: string; col: RGB; steam: boolean; arc: boolean } {
  const pair = new Set([a, b]);
  if ((pair.has('fire') && pair.has('water')) || (pair.has('fire') && pair.has('ice'))) {
    return { label: 'STEAM BOOST', col: [1.45, 1.55, 1.65], steam: true, arc: false };
  }
  if (pair.has('plasma') && (pair.has('water') || pair.has('ice'))) {
    return { label: 'AURORA SURGE', col: [0.55, 1.65, 1.45], steam: true, arc: true };
  }
  if (pair.has('gems')) {
    return { label: 'PRISM REFRACT', col: [1.45, 0.95, 1.75], steam: false, arc: true };
  }
  return { label: 'HARMONIC DRAFT', col: GOLD, steam: true, arc: false };
}

export class SurfEngine {
  rings: FlowRing[] = [];
  vortexes: FlowRing[] = [];
  nextRing = 0;
  wakes: [WakeNode[], WakeNode[]] = [[], []];
  events: SurfEvent[] = [];
  score = 0;
  combo = 1;
  comboT = 0;
  ringsCleared = 0;
  reactions = 0;
  unisons = 0;
  tricks = 0;
  private t = 0;
  private worldId = '';
  private wakeClock = [0, 0];
  private reactCool = [0, 0];
  private lastTrick: { t: number; move: string }[] = [{ t: -99, move: '' }, { t: -99, move: '' }];
  private unisonCool = 0;
  private slipstreamAcc = 0;
  private fx: BurstFx[] = [];
  private nextVortexId = 100;

  /** the runner's track (src/play/track.ts): set, the rings stand along it in its lanes, a few high, and each one
   *  passed is laid again somewhere else for the next lap; the rim guidance is off */
  track: Track | null = null;
  private seed = 7;
  missed = 0;

  constructor(private ctx: SurfCtx) {}

  setTrack(t: Track | null) {
    if (t === this.track) return;
    this.track = t;
    this.worldId = '';
  }

  private rand() { this.seed = (this.seed * 16807) % 2147483647; return (this.seed - 1) / 2147483646; }

  /** a ring on the track at s: a lane (left, middle, right; never the same twice in a row for long), low or high */
  private layRing(id: number, s: number, prevL: number | null): FlowRing {
    const T = this.track!;
    const lanes = [-T.half * 0.62, 0, T.half * 0.62];
    let l = lanes[Math.floor(this.rand() * 3)];
    if (prevL != null && l === prevL && this.rand() < 0.6) l = lanes[(lanes.indexOf(l) + 1 + Math.floor(this.rand() * 2)) % 3];
    const high = this.rand() < 0.28;
    const [x, z] = T.point(s, l), F = T.frame(s);
    const g = this.ctx.groundAt(x, z);
    return { id, at: [x, g + (high ? 2.35 : 1.05), z], dir: [F.f[0], F.f[1]], radius: high ? 0.95 : 1.1, s, l, high };
  }

  /** the ring after one is passed: laid again (for the next lap), the next one ahead active */
  private passRing(idx: number) {
    const N = this.rings.length, r = this.rings[idx], prev = this.rings[(idx + N - 1) % N];
    if (this.track && r.s != null) this.rings[idx] = this.layRing(r.id, r.s, prev?.l ?? null);
    this.nextRing = (idx + 1) % N;
  }

  /** reset circuit whenever the active world changes */
  private syncWorld() {
    const w = this.ctx.world();
    if (w !== this.worldId || !this.rings.length) {
      this.worldId = w;
      if (this.track) {
        const T = this.track, N = Math.max(5, Math.round(T.length / 9));
        this.rings = [];
        for (let i = 0; i < N; i++) this.rings.push(this.layRing(i, ((i + 0.5) / N) * T.length, this.rings[i - 1]?.l ?? null));
      } else this.rings = circuitFor(w, (x, z) => this.ctx.groundAt(x, z));
      this.vortexes = [];
      this.wakes = [[], []];
      this.nextRing = 0;
    }
  }

  /** current target Flow Ring (used by partner AI & directional guidance) */
  get activeRing(): FlowRing | null {
    return this.rings[this.nextRing] ?? null;
  }

  /** upcoming ring after activeRing */
  get followingRing(): FlowRing | null {
    return this.rings.length ? this.rings[(this.nextRing + 1) % this.rings.length] : null;
  }

  /** step the Flow Surf world each frame */
  update(
    dt: number,
    seats: readonly { seat: number; c: Character | null; el: Element; raw: readonly Record<string, unknown>[] }[],
    fused = false,
  ) {
    this.events.length = 0;
    if (!(dt > 0)) return;
    this.t += dt;
    this.syncWorld();

    // decay combo & cooldowns
    if (this.comboT > 0) {
      this.comboT = Math.max(0, this.comboT - dt);
      if (this.comboT === 0) this.combo = 1;
    }
    this.unisonCool = Math.max(0, this.unisonCool - dt);
    for (let i = 0; i < 2; i++) this.reactCool[i] = Math.max(0, this.reactCool[i] - dt);

    // age wake trails & vortex rings
    for (let s = 0; s < 2; s++) {
      const list = this.wakes[s];
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].age += dt;
        if (list[i].age > 2.6) list.splice(i, 1);
      }
    }
    for (let i = this.vortexes.length - 1; i >= 0; i--) {
      const v = this.vortexes[i];
      v.life = (v.life ?? 0) - dt;
      if (v.life <= 0) this.vortexes.splice(i, 1);
    }

    // process each surfer
    for (const s of seats) {
      const c = s.c;
      if (!c) continue;
      c.surfElement = s.el;
      if (c.surfMode && !c.plane && !c.rail) this.guideRim(c, dt);
      this.handleRaw(s.seat, c, s.el, s.raw);
      this.recordWake(s.seat, c, s.el, dt);
      this.checkRings(s.seat, c, s.el, fused);
    }

    // check wake drafting reactions & partner slipstream
    if (seats.length >= 2 && seats[0].c && seats[1].c) {
      this.checkWakeDraft(0, seats[0].c, seats[0].el, seats[1].el);
      this.checkWakeDraft(1, seats[1].c, seats[1].el, seats[0].el);
      this.updateSlipstream(seats[0].c, seats[0].el, seats[1].c, seats[1].el, dt);
    }

    // render all Flow Surf 3D world visuals via existing Glows buffer (zero extra GPU passes)
    this.drawRings();
    this.drawWakes();
    for (const s of seats) if (s.c) this.drawSurferFx(s.c, s.el);
    this.fx = this.fx.filter((f) => {
      const u = (this.t - f.t) / f.life;
      if (u >= 1) return false;
      f.draw(u);
      return true;
    });
  }

  /** smoothly curve surfers along the arena rim so they never slam dead into outer boundaries (leaving portal openings clear) */
  private guideRim(c: Character, dt: number) {
    const A = arenaFor(this.worldId);
    if (!A) return;
    const cx = A.space.center[0], cz = A.space.center[1];
    const rx = c.root[0] - cx, rz = c.root[2] - cz;
    const dist = Math.hypot(rx, rz);
    const softR = Math.max(3.6, A.space.radius - 2.6);
    if (dist < softR) return;
    const fx = Math.sin(c.surfHeading), fz = Math.cos(c.surfHeading);
    // leave mirror exits open when intentionally surfing head-on toward a portal
    if (A.exits) {
      for (const ex of A.exits) {
        const edx = ex.at[0] - c.root[0], edz = ex.at[2] - c.root[2];
        const ed = Math.hypot(edx, edz);
        if (ed < ex.r * 1.15 && (edx * fx + edz * fz) / (ed || 1) > 0.78) return;
      }
    }
    const nx = rx / (dist || 1), nz = rz / (dist || 1);
    const outDot = fx * nx + fz * nz;
    if (outDot <= 0.05) return;
    // choose tangent direction (CCW or CW) matching current heading
    const cross = nx * fz - nz * fx;
    const sign = cross >= 0 ? 1 : -1;
    const tx = -nz * sign - nx * 0.45;
    const tz = nx * sign - nz * 0.45;
    const want = Math.atan2(tx, tz);
    const diff = wrapPi(want - c.surfHeading);
    const urgency = clamp((dist - softR) / 1.8, 0.25, 1.4);
    c.surfHeading = wrapPi(c.surfHeading + clamp(diff, -4.5 * urgency * dt, 4.5 * urgency * dt));
  }

  private handleRaw(seat: number, c: Character, el: Element, raw: readonly Record<string, unknown>[]) {
    for (const ev of raw) {
      if (ev.type === 'chargeTier') {
        const tier = Number(ev.tier ?? 1);
        const at: V3 = [c.root[0], c.root[1] + 0.9, c.root[2]];
        this.ctx.sfx?.('move', at, { move: 'charge', element: el === 'gems' ? 'ice' : el, count: tier, perfect: tier >= 3, vel: 0.72 + tier * 0.08 });
        this.addBurst(0.38, (u) => {
          const col = tier >= 3 ? WHITE_GOLD : mixRGB(COLOURS[el], GOLD, 0.4 + 0.2 * tier);
          this.ctx.glows.flat([c.root[0], c.root[1] + 0.05 + u * 0.85, c.root[2]], 0.35 + u * (0.5 + 0.2 * tier), col, (1.1 + 0.3 * tier) * (1 - u), 'ring');
        });
        this.events.push({
          k: 'chargeTier', seat, label: tier >= 3 ? 'OVERDRIVE CHARGED!' : `TIER ${tier} CHARGED`,
          gold: tier >= 2, points: 0, combo: this.combo, at, el, tier,
        });
      } else if (ev.type === 'vortex') {
        const tier = Number(ev.tier ?? 1);
        const at: V3 = [c.root[0], c.root[1] + 1.05, c.root[2]];
        const yaw = Number(ev.yaw ?? c.surfHeading);
        this.vortexes.push({
          id: this.nextVortexId++,
          at,
          dir: [Math.sin(yaw), Math.cos(yaw)],
          radius: 1.15 + tier * 0.14,
          vortex: true,
          owner: seat,
          el,
          life: 7.5,
          maxLife: 7.5,
        });
        if (this.vortexes.length > 4) this.vortexes.shift();
      } else if (ev.type === 'trick') {
        const mv = String(ev.move ?? 'spin');
        const tier = Number(ev.tier ?? 0);
        const charged = !!ev.charged;
        const at: V3 = [c.root[0], c.root[1] + 1.0, c.root[2]];
        this.tricks++;
        const pts = Math.round((80 + tier * 65) * this.combo);
        this.score += pts;
        this.comboT = Math.max(this.comboT, 5.2);
        this.ctx.award?.(seat, 8 + tier * 4, 4 + tier * 3, pts * 0.25);

        // elemental burst into GPU field on morphs & charged tricks
        if (mv === 'ember-surge' || mv === 'hydro-slip' || charged) {
          const hot = el === 'fire' || el === 'plasma';
          this.ctx.deposit?.({
            p: at, r: 0.75 + tier * 0.15,
            heat: hot ? 1.8 + tier * 0.4 : el === 'ice' ? -1.4 : 0,
            wet: el === 'water' ? 1.8 + tier * 0.4 : el === 'ice' ? 0.5 : 0,
            wind: [Math.sin(c.surfHeading) * 4.5, 2.2 + tier, Math.cos(c.surfHeading) * 4.5],
          });
          if (el === 'water' || el === 'ice') this.ctx.ripple?.(c.root[0], c.root[2], 0.9, 0.7);
          const col = mixRGB(COLOURS[el], GOLD, charged ? 0.35 : 0.1);
          this.addBurst(0.55, (u) => {
            const k = 1 - u;
            this.ctx.glows.flat([at[0], c.root[1] + 0.04, at[2]], 0.3 + u * 1.15, col, 1.1 * k * k, 'ring');
            for (let j = 0; j < 10; j++) {
              const a = j * 2.399 + u * 4;
              const r = 0.25 + u * 0.9;
              this.ctx.glows.dot([at[0] + Math.cos(a) * r, at[1] + Math.sin(a * 1.4) * 0.4 + u * 0.5, at[2] + Math.sin(a) * r], 0.028, col, 1.3 * k, 'spark');
            }
          });
        }

        const nice = TRICK_NAMES[mv] ?? mv.toUpperCase();
        const prefix = tier >= 3 ? 'OVERDRIVE ' : charged ? 'CHARGED ' : '';
        this.events.push({
          k: 'trick', seat, label: `${prefix}${nice}`, sub: `+${pts}`,
          gold: charged || mv === 'hydro-slip' || mv === 'ember-surge' || mv === 'somersault',
          points: pts, combo: this.combo, at, el, tier,
        });

        // check Sync Unison with partner!
        this.lastTrick[seat] = { t: this.t, move: mv };
        const other = this.lastTrick[1 - seat];
        if (this.unisonCool <= 0 && this.t - other.t <= 0.85) {
          this.unisonCool = 1.6;
          this.unisons++;
          this.combo = Math.min(12, this.combo + 1);
          this.comboT = 6.0;
          const uPts = 260 * this.combo;
          this.score += uPts;
          this.ctx.award?.(0, 14, 18, uPts * 0.3);
          this.ctx.award?.(1, 14, 0, 0);
          this.ctx.sfx?.('unison', at, { vel: 0.92 });
          this.addBurst(0.85, (u) => {
            const k = 1 - u;
            this.ctx.glows.flat([c.root[0], c.root[1] + 0.05, c.root[2]], 0.5 + u * 2.4, WHITE_GOLD, 1.5 * k * k, 'ring');
          });
          this.events.push({
            k: 'unison', seat, label: `SYNC UNISON ×${this.combo}`, sub: `+${uPts}`,
            gold: true, points: uPts, combo: this.combo, at, el,
          });
        }
      }
    }
  }

  private recordWake(seat: number, c: Character, el: Element, dt: number) {
    this.wakeClock[seat] += dt;
    const sp = Math.hypot(c.v[0], c.v[2]);
    if (this.wakeClock[seat] < 0.055 || sp < 1.2) return;
    this.wakeClock[seat] = 0;
    const p: V3 = [c.root[0], c.root[1] + 0.35 + (c.airborne ? 0.3 : 0), c.root[2]];
    const list = this.wakes[seat];
    list.push({ p, age: 0, el, dissolve: c.dissolve, speed: sp });
    if (list.length > 34) list.shift();
    // deposit real elemental energy along fast carves & morphs so crossing paths makes real GPU steam!
    if (sp > 3.2 || c.dissolve > 0.2) {
      const hot = el === 'fire' || el === 'plasma';
      const k = 0.55 + c.dissolve * 1.1;
      this.ctx.deposit?.({
        p, r: 0.48 + c.dissolve * 0.28,
        heat: hot ? 0.75 * k : el === 'ice' ? -0.7 * k : 0,
        wet: el === 'water' ? 0.85 * k : el === 'ice' ? 0.25 * k : 0,
      });
    }
  }

  private checkRings(seat: number, c: Character, el: Element, fused: boolean) {
    const px = c.root[0], py = c.root[1] + 0.9, pz = c.root[2];
    const tricking = !!(c.move && TRICK_MOVES.has(c.move.name)) || c.airborne || c.dissolve > 0.25;

    // 1. active Harmonic Flow Ring
    const ring = this.rings[this.nextRing];
    if (ring && this.track && ring.s != null) {
      // (on the track: through the ring's plane, within its lane, at its height; the player running past one leaves it)
      const p = this.track.project(px, pz, ring.s), ds = p.s - ring.s;
      if (seat === 0 && ds > 1.6) {
        // (one far behind is just where the run began: skipped, not missed)
        if (ds < 8) { this.missed++; this.comboT = Math.min(this.comboT, 1.2); }
        this.passRing(this.nextRing);
        return;
      }
    }
    if (ring) {
      const dh = Math.hypot(px - ring.at[0], pz - ring.at[2]);
      const dv = Math.abs(py - ring.at[1]);
      let through = dh <= ring.radius + 0.55 && dv <= ring.radius + 0.45;
      if (this.track && ring.s != null) {
        const p = this.track.project(px, pz, ring.s);
        through = Math.abs(p.s - ring.s) < 0.8 && Math.abs(p.l - (ring.l ?? 0)) < 1.0 && (ring.high ? py > ring.at[1] - 0.85 : dv <= ring.radius + 0.3);
      }
      if (through) {
        this.ringsCleared++;
        this.combo = Math.min(12, this.combo + 1);
        this.comboT = 6.2;
        const mult = (tricking ? 2 : 1) * (fused ? 2 : 1);
        const pts = 140 * mult * this.combo;
        this.score += pts;
        c.giveBoost(tricking ? 3.2 : 2.3, tricking ? 0.9 : 0.65);
        this.ctx.award?.(seat, tricking ? 20 : 14, tricking ? 15 : 10, pts * 0.25);
        this.ctx.sfx?.('move', ring.at, { move: 'ring', element: el === 'gems' ? 'ice' : el, count: this.combo, perfect: tricking, vel: 0.88 });
        this.ctx.ripple?.(ring.at[0], ring.at[2], 0.8, 0.85);
        const at: V3 = [ring.at[0], ring.at[1], ring.at[2]];
        const burstCol = tricking ? WHITE_GOLD : mixRGB(COLOURS[el], GOLD, 0.55);
        this.addBurst(0.75, (u) => {
          const k = 1 - u;
          this.ctx.glows.dot(at, 0.4 + u * 1.4, burstCol, 1.3 * k * k, 'ring');
          this.ctx.glows.flat([at[0], this.ctx.groundAt(at[0], at[2]) + 0.04, at[2]], 0.5 + u * 2.1, GOLD, 1.0 * k * k, 'ring');
          for (let j = 0; j < 14; j++) {
            const a = j * 2.39996 + u * 2.5, rr = 0.35 + u * 1.65;
            this.ctx.glows.dot([at[0] + Math.cos(a) * rr, at[1] + Math.sin(a * 1.7) * rr * 0.55, at[2] + Math.sin(a) * rr], 0.032, j % 2 ? GOLD : COLOURS[el], 1.5 * k, 'spark');
          }
        });
        const mvLabel = c.move && TRICK_NAMES[c.move.name] ? `${TRICK_NAMES[c.move.name]} RING` : tricking ? 'AERIAL FLOW RING' : 'FLOW RING';
        this.events.push({
          k: 'ring', seat, label: `${mvLabel} ×${this.combo}`, sub: `+${pts}`,
          gold: true, points: pts, combo: this.combo, at, el,
        });
        this.passRing(this.nextRing);
      }
    }

    // 2. Partner Cyclone Vortex Rings
    for (let i = this.vortexes.length - 1; i >= 0; i--) {
      const v = this.vortexes[i];
      if (v.owner === seat && (v.maxLife ?? 7.5) - (v.life ?? 0) < 0.7) continue;
      if (Math.hypot(px - v.at[0], pz - v.at[2]) <= v.radius + 0.45 && Math.abs(py - v.at[1]) <= 1.35) {
        const isPartner = v.owner !== seat;
        this.combo = Math.min(12, this.combo + 1);
        this.comboT = 6.0;
        const pts = (isPartner ? 280 : 120) * this.combo;
        this.score += pts;
        c.giveBoost(isPartner ? 3.8 : 2.5, 0.95);
        this.ctx.award?.(seat, 18, isPartner ? 18 : 8, pts * 0.25);
        this.ctx.sfx?.('move', v.at, { move: 'ring', element: el === 'gems' ? 'ice' : el, count: this.combo + 2, perfect: true, vel: 0.92 });
        const at: V3 = [v.at[0], v.at[1], v.at[2]];
        this.addBurst(0.7, (u) => {
          const k = 1 - u;
          this.ctx.glows.dot(at, 0.5 + u * 1.8, TEAL_HI, 1.4 * k * k, 'ring');
        });
        this.events.push({
          k: 'vortex', seat, label: isPartner ? `PARTNER VORTEX BOOST ×${this.combo}` : `CYCLONE BOOST ×${this.combo}`,
          sub: `+${pts}`, gold: true, points: pts, combo: this.combo, at, el,
        });
        this.vortexes.splice(i, 1);
      }
    }
  }

  private checkWakeDraft(seat: number, c: Character, myEl: Element, otherEl: Element) {
    if (this.reactCool[seat] > 0) return;
    const otherWake = this.wakes[1 - seat];
    const px = c.root[0], pz = c.root[2];
    for (let i = otherWake.length - 1; i >= 0; i--) {
      const w = otherWake[i];
      if (w.age < 0.14 || w.age > 2.2) continue;
      if (Math.hypot(px - w.p[0], pz - w.p[2]) < 1.2) {
        this.reactCool[seat] = 1.45;
        this.reactions++;
        this.combo = Math.min(12, this.combo + 1);
        this.comboT = 6.2;
        const pts = 220 * this.combo;
        this.score += pts;
        const rx = reactionFor(myEl, otherEl);
        c.giveBoost(3.35, 0.9);
        this.ctx.award?.(seat, 16, 14, pts * 0.28);
        const at: V3 = [px, c.root[1] + 0.8, pz];
        // real GPU volumetric steam + swirling wind vortex!
        if (rx.steam) {
          this.ctx.deposit?.({ p: at, r: 1.05, heat: 2.3, wet: 2.3, wind: [Math.sin(c.surfHeading) * 3.5, 4.6, Math.cos(c.surfHeading) * 3.5] });
        }
        if (rx.arc) {
          this.ctx.arc?.([w.p[0], w.p[1] + 0.3, w.p[2]], [at[0], at[1] + 0.5, at[2]], 1.4, 8);
        }
        this.ctx.ripple?.(px, pz, 1.0, 0.95);
        this.ctx.sfx?.('move', at, { move: 'steam', element: myEl === 'gems' ? 'ice' : myEl, count: this.combo, perfect: true, vel: 0.9 });
        this.addBurst(0.85, (u) => {
          const k = 1 - u;
          this.ctx.glows.flat([at[0], c.root[1] + 0.05, at[2]], 0.35 + u * 1.9, rx.col, 1.3 * k * k, 'ring');
          for (let j = 0; j < 12; j++) {
            const ang = j * 2.399 + u * 5.2, rr = 0.25 + u * 1.25;
            this.ctx.glows.dot([at[0] + Math.cos(ang) * rr, at[1] + u * 1.25 + Math.sin(j) * 0.2, at[2] + Math.sin(ang) * rr], 0.035, j % 2 ? rx.col : GOLD, 1.4 * k, 'spark');
          }
        });
        this.events.push({
          k: 'reaction', seat, label: `${rx.label} ×${this.combo}`, sub: `+${pts}`,
          gold: true, points: pts, combo: this.combo, at, el: myEl,
        });
        break;
      }
    }
  }

  private updateSlipstream(a: Character, elA: Element, b: Character, elB: Element, dt: number) {
    const dx = b.root[0] - a.root[0], dz = b.root[2] - a.root[2];
    const d = Math.hypot(dx, dz);
    const spA = Math.hypot(a.v[0], a.v[2]), spB = Math.hypot(b.v[0], b.v[2]);
    if (d < 0.7 || d > 4.4 || spA < 2.2 || spB < 2.2) return;
    // gentle co-op Harmony trickle while surfing side by side
    this.slipstreamAcc += dt;
    if (this.slipstreamAcc >= 0.4) {
      this.slipstreamAcc = 0;
      this.ctx.award?.(0, 2.5, 2.5, 5);
      this.ctx.award?.(1, 2.5, 0, 0);
    }
    // subtle iridescent flow filament between co-op surfers
    const G = this.ctx.glows;
    const cA = COLOURS[elA], cB = COLOURS[elB];
    const pA: V3 = [a.root[0], a.root[1] + 0.95, a.root[2]];
    const pB: V3 = [b.root[0], b.root[1] + 0.95, b.root[2]];
    const strength = 0.24 * (1 - Math.abs(d - 2.4) / 2.2);
    if (strength > 0.03) {
      const N = 12;
      let prev = pA;
      for (let i = 1; i <= N; i++) {
        const u = i / N;
        const wave = Math.sin(u * Math.PI) * Math.sin(this.t * 5 + u * 6) * 0.14;
        const cur: V3 = [pA[0] + (pB[0] - pA[0]) * u, pA[1] + (pB[1] - pA[1]) * u + wave, pA[2] + (pB[2] - pA[2]) * u];
        G.seg(prev, cur, 0.012, mixRGB(cA, cB, u), strength, 'soft');
        prev = cur;
      }
    }
  }

  // ---------------------------------------------------------------- 3D world visuals (pure Glows, zero extra GPU passes)
  private drawRings() {
    const G = this.ctx.glows;
    const N = this.rings.length;
    if (!N) return;

    // draw upcoming 3 rings (active bright golden-teal ring, plus next two softer preview rings)
    for (let step = 0; step < Math.min(this.track ? 4 : 3, N); step++) {
      const idx = (this.nextRing + step) % N;
      const r = this.rings[idx];
      const active = step === 0;
      const intensity = active ? 1.75 : step === 1 ? 0.62 : step === 2 ? 0.3 : 0.16;
      const segs = active ? 24 : 16;
      // orient the ring perpendicular to its circuit tangent dir
      const rx = -r.dir[1], rz = r.dir[0];
      const spin = this.t * (active ? 1.5 : 0.6);
      const colMain = active ? GOLD : TEAL_HI;
      const colAlt = active ? TEAL_HI : GOLD;

      let prev: V3 | null = null;
      const rad = r.radius * (active ? 1 + 0.045 * Math.sin(this.t * 4.5) : 0.92);
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * TAU + spin;
        const ca = Math.cos(a) * rad, sa = Math.sin(a) * rad;
        const pt: V3 = [r.at[0] + rx * ca, r.at[1] + sa, r.at[2] + rz * ca];
        if (prev) {
          const blend = 0.5 + 0.5 * Math.sin(a * 2 + this.t * 3);
          G.seg(prev, pt, active ? 0.056 : 0.026, mixRGB(colMain, colAlt, blend * 0.45), intensity, 'soft');
        }
        prev = pt;
      }

      if (active) {
        // radiant counter-rotating inner filigree halo so the active Flow Ring is unmistakable from across the arena
        let prevIn: V3 | null = null;
        const radIn = rad * 0.82;
        for (let i = 0; i <= 18; i++) {
          const a = (i / 18) * TAU - spin * 1.4;
          const ca = Math.cos(a) * radIn, sa = Math.sin(a) * radIn;
          const pt: V3 = [r.at[0] + rx * ca, r.at[1] + sa, r.at[2] + rz * ca];
          if (prevIn) G.seg(prevIn, pt, 0.028, i % 2 ? WHITE_GOLD : TEAL_HI, 1.25, 'soft');
          prevIn = pt;
        }
        // counter-rotating sparkling motes & floor light pool beneath the active Flow Ring
        for (let m = 0; m < 8; m++) {
          const a = (m / 8) * TAU - this.t * 2.2;
          const ca = Math.cos(a) * (rad * 1.12), sa = Math.sin(a) * (rad * 1.12);
          G.dot([r.at[0] + rx * ca, r.at[1] + sa, r.at[2] + rz * ca], 0.055, m % 2 ? WHITE_GOLD : TEAL_HI, 1.85, 'spark');
        }
        const gy = this.ctx.groundAt(r.at[0], r.at[2]);
        G.flat([r.at[0], gy + 0.04, r.at[2]], rad * 1.05, GOLD, 0.78 + 0.24 * Math.sin(this.t * 4), 'ring');
        // flowing guiding comet arc from active ring toward next ring
        const next = this.rings[(idx + 1) % N];
        if (next) {
          const steps = 9;
          for (let k = 1; k < steps; k++) {
            const u = k / steps;
            const pulse = 0.55 + 0.45 * Math.sin(this.t * 6.5 - u * 8);
            const gx = r.at[0] + (next.at[0] - r.at[0]) * u;
            const gy2 = r.at[1] + (next.at[1] - r.at[1]) * u + Math.sin(u * Math.PI) * 0.3;
            const gz = r.at[2] + (next.at[2] - r.at[2]) * u;
            G.dot([gx, gy2, gz], 0.036 + 0.018 * pulse, mixRGB(GOLD, TEAL_HI, u), 0.9 * pulse, 'spark');
          }
        }
      }
    }

    // draw Cyclone Partner Vortex Rings
    for (const v of this.vortexes) {
      const fade = clamp((v.life ?? 0) / 1.5, 0, 1);
      const col = mixRGB(COLOURS[v.el ?? 'fire'], WHITE_GOLD, 0.35);
      const rx = -v.dir[1], rz = v.dir[0];
      const segs = 16;
      let prev: V3 | null = null;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * TAU - this.t * 4.5;
        const ca = Math.cos(a) * v.radius, sa = Math.sin(a) * v.radius;
        const pt: V3 = [v.at[0] + rx * ca, v.at[1] + sa, v.at[2] + rz * ca];
        if (prev) G.seg(prev, pt, 0.028, col, 1.3 * fade, 'soft');
        prev = pt;
      }
      G.dot(v.at, 0.14, WHITE_GOLD, 0.75 * fade, 'spark');
    }
  }

  private drawWakes() {
    const G = this.ctx.glows;
    for (let s = 0; s < 2; s++) {
      const list = this.wakes[s];
      if (list.length < 2) continue;
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        const life = clamp(1 - b.age / 2.4, 0, 1);
        if (life <= 0.02) continue;
        const col = COLOURS[b.el];
        const w = (0.028 + 0.04 * b.dissolve + 0.012 * clamp((b.speed - 3) / 5, 0, 1)) * life;
        const I = (0.72 + 0.95 * b.dissolve) * life * life;
        G.seg(a.p, b.p, w, mixRGB(col, GOLD, b.dissolve * 0.35), I, 'soft');
      }
    }
  }

  /** 3D spiral charge coils & morph aura directly around a charging/dissolving surfer */
  private drawSurferFx(c: Character, el: Element) {
    const G = this.ctx.glows;
    const col = COLOURS[el];
    if (c.charge > 0.04) {
      const ch = c.charge;
      const tier = c.chargeTier;
      const auraCol = tier >= 3 ? WHITE_GOLD : mixRGB(col, GOLD, 0.35 + ch * 0.45);
      // tiered charging floor halo
      G.flat([c.root[0], c.root[1] + 0.04, c.root[2]], 0.45 + ch * 0.48, auraCol, 0.85 + ch * 0.9, 'ring');
      // ascending double helix charge coil swirling around the crouching body
      const coils = 14;
      for (let strand = 0; strand < 2; strand++) {
        let prev: V3 | null = null;
        for (let i = 0; i <= coils; i++) {
          const u = i / coils;
          if (u > ch + 0.12) break;
          const ang = u * TAU * 1.8 + this.t * (6.5 + tier * 2.5) + strand * Math.PI;
          const r = (0.58 - u * 0.24) * (1 - 0.12 * Math.sin(this.t * 14));
          const pt: V3 = [c.root[0] + Math.cos(ang) * r, c.root[1] + 0.12 + u * 1.35, c.root[2] + Math.sin(ang) * r];
          if (prev) G.seg(prev, pt, 0.016 + 0.01 * ch, auraCol, (0.75 + 0.9 * ch) * (1 - 0.25 * u), 'soft');
          prev = pt;
        }
      }
      if (tier >= 2) {
        // golden orbiting tier sparks at waist height
        for (let k = 0; k < tier + 2; k++) {
          const a = (k / (tier + 2)) * TAU - this.t * 5;
          G.dot([c.root[0] + Math.cos(a) * 0.65, c.root[1] + 0.85, c.root[2] + Math.sin(a) * 0.65], 0.032, WHITE_GOLD, 1.6, 'spark');
        }
      }
    }
    if (c.dissolve > 0.12) {
      // luminous comet / hydro-crest sparkles streaming through the dissolved body
      const d = c.dissolve;
      const aura = el === 'water' || el === 'ice' ? TEAL_HI : mixRGB(col, WHITE_GOLD, 0.5);
      for (let k = 0; k < 5; k++) {
        const a = k * 1.256 + this.t * 11;
        const rr = 0.25 + 0.35 * d;
        G.dot([c.root[0] + Math.cos(a) * rr, c.root[1] + 0.55 + Math.sin(a * 1.5) * 0.45, c.root[2] + Math.sin(a) * rr], 0.034, aura, 1.45 * d, 'spark');
      }
    }
  }

  private addBurst(life: number, draw: (u: number) => void) {
    this.fx.push({ t: this.t, life, draw });
  }

  stats() {
    return {
      score: Math.round(this.score),
      combo: this.combo,
      rings: this.ringsCleared,
      reactions: this.reactions,
      unisons: this.unisons,
      tricks: this.tricks,
      nextRing: this.nextRing,
      missed: this.missed,
      vortexes: this.vortexes.length,
    };
  }
}
