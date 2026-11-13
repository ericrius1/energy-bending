// Building: matter that lands on the beat sets into the world (docs/PLAN.md "Building"). Two halves.
//
// The builder (pure) decides when a move sets a piece and what shape it is. It is a flourish, not a menu: a building
// move that lands perfect sets its piece by itself once the dancer's flow is high (`jogo.autoBuild`), and before that
// a tap of the build button (Intent.interact: G, the d-pad's up, 'use') round the move asks for it. What each body
// builds, and from which move:
//   ice   the cartwheel (aú)           a bridge: an arch of set ice along the cartwheel's path, standing room on top
//   water a spin (or the pirouette)    an ice spire where it turned, rising 2 m
//   gems  a jump that lands (a stomp)  a crystal ledge, 1.1 m over where it landed
//   fire  a spin, macaco or aú         a ring of flame that stands where it turned and lifts whoever is in it
// The piece goes to the rules as `build` (from the move's id: the rules check the move started on the beat and charge
// its flow); every page lays it when the room says `set`.
//
// The pieces (needs the kinds) lay what the room holds in this world: ice through the water kind's set ice (its own
// shards, melting and shattering), gems as a cluster of crystals of light, fire as a standing ring of flame (the jogo's
// glows, heat into the field, an updraft for anyone in it). They are ledges on the locked stage, are melted by fire
// (ice) or doused by water (fire), and shattered by a kick; each of those is a message to the room, so every page sees
// the same.
import type { Character } from '../dancer/character';
import { flatSteps } from '../dancer/play';
import type { Ledge, StagePlane } from '../engine/camera';
import { planeNormal } from '../engine/camera';
import { RULES } from '../../shared/rules.ts';
import type { SetPiece } from '../../shared/protocol.ts';
import type { Builder, BuildAsk, Element, MoveStart, SeatBody } from './jogo';
import type { Glows } from './glow';
import { jogoParams } from './params';

type V3 = [number, number, number];

/** which kind a body builds from which move (null: none) */
export function buildKindFor(el: Element, move: string): string | null {
  switch (el) {
    case 'ice': return move === 'au' ? 'ice' : null;
    case 'water': return move === 'spin' || move === 'pirueta' ? 'ice' : null;
    case 'gems': return move === 'jump' ? 'gems' : null;
    case 'fire': return move === 'spin' || move === 'macaco' || move === 'au' ? 'fire' : null;
    default: return null;
  }
}

const mm = (v: number) => Math.round(v * 1000);

/** the builder: asked by the jogo when a local move starts and when it is done */
export class JogoBuilder implements Builder {
  /** when each seat last tapped the build button (room ms) */
  armedAt = [-1e9, -1e9];
  constructor(private bodies: readonly SeatBody[], private now: () => number, private plane: () => StagePlane | null) {}

  /** a seat tapped the build button */
  arm(seat: number) { this.armedAt[seat] = this.now(); }
  private armed(seat: number, t: number) { return Math.abs(t - this.armedAt[seat]) <= jogoParams.buildArm * 1000; }

  wants(seat: number, ev: MoveStart, flow: number): string | null {
    const kind = buildKindFor(this.bodies[seat].element(), ev.move);
    if (!kind || !ev.perfect) return null;
    if (!this.armed(seat, ev.t) && flow < jogoParams.autoBuild) return null;
    const k = RULES.build.kinds[kind];
    return k ? kind : null;
  }

  /** shape the piece from where the move started and where it ended */
  shape(_seat: number, kind: string, ev: MoveStart, end: V3, c: Character): BuildAsk | null {
    const P = this.plane(), r: V3 = P ? P.right : [Math.sin(ev.yaw), 0, Math.cos(ev.yaw)];
    const dir = P ? (end[0] - ev.x) * r[0] + (end[2] - ev.z) * r[2] >= 0 ? 1 : -1 : 1;
    const floor = c.grounded ? c.root[1] : c.lastGroundY;
    const pts: number[] = [];
    const push = (p: V3) => pts.push(mm(p[0]), mm(p[1]), mm(p[2]));
    if (kind === 'ice' && ev.move === 'au') {
      // an arch over the cartwheel's path, a little past both ends, its top 1 m up (a jump reaches it; it holds a body)
      const a: V3 = [ev.x - r[0] * dir * 0.4, floor, ev.z - r[2] * dir * 0.4], b: V3 = [end[0] + r[0] * dir * 0.6, floor, end[2] + r[2] * dir * 0.6];
      for (let i = 0; i <= 6; i++) {
        const u = i / 6;
        push([a[0] + (b[0] - a[0]) * u, floor + 0.25 + 0.75 * Math.sin(Math.PI * u), a[2] + (b[2] - a[2]) * u]);
      }
      return { kind, points: pts, width: 450 };
    }
    if (kind === 'ice') {
      // a spire where it turned
      for (let i = 0; i <= 3; i++) push([ev.x + 0.03 * Math.sin(i * 2.1), floor + 0.05 + i * 0.7, ev.z + 0.03 * Math.cos(i * 2.1)]);
      return { kind, points: pts, width: 260 };
    }
    if (kind === 'gems') {
      // a ledge 1.1 m over the landing, 1.4 m long along the stage
      const y = c.root[1] + 1.1;
      push([end[0] - r[0] * 0.7, y, end[2] - r[2] * 0.7]);
      push([end[0] + r[0] * 0.7, y, end[2] + r[2] * 0.7]);
      return { kind, points: pts, width: 420 };
    }
    if (kind === 'fire') {
      // a ring round where it turned: the axis from the floor up (the width is the ring's span)
      push([ev.x, floor, ev.z]);
      push([ev.x, floor + 1.6, ev.z]);
      return { kind, points: pts, width: 1100 };
    }
    return null;
  }
}

// ---------------------------------------------------------------- the pieces in the world
/** what the pieces need of the matter kinds (the water kind's set ice), the field and the room */
export interface PiecesCtx {
  /** the water pool's set ice, if a water or ice kind is declared */
  setIce: import('../matter/ice/setice').SetIce | null;
  field: { deposit(d: { p: V3; r: number; heat?: number; wet?: number; wind?: V3 }): void } | null;
  glows: Glows;
  /** the world the jogo shows */
  world(): string;
  /** a melt or shatter from a seat this page plays */
  send(seat: number, msg: { t: 'melt' | 'shatter'; id: string }): void;
  /** the room's clock (ms) */
  now(): number;
}

interface Laid { piece: SetPiece; ice: number; melting: number | null; gone: number | null; sent: Set<string> }

const ICE_COL: [number, number, number] = [0.55, 0.85, 1.2];
const GEM_COLS: [number, number, number][] = [[0.75, 0.45, 1.3], [0.4, 0.8, 1.3], [1.2, 0.55, 0.85], [0.6, 1.2, 0.85]];
const FLAME: [number, number, number] = [1.5, 0.55, 0.14];

export class Pieces {
  private laid = new Map<string, Laid>();
  private t = 0;

  constructor(private ctx: PiecesCtx) {}

  /** every piece of the room (a joiner's whole list, or after travel): lay the ones in this world */
  reset(list: Iterable<SetPiece>) {
    for (const id of [...this.laid.keys()]) this.unlay(id, false);
    for (const p of list) this.lay(p);
  }

  lay(p: SetPiece) {
    if (p.world !== this.ctx.world() || this.laid.has(p.id)) return;
    let ice = 0;
    if (p.kind === 'ice' && this.ctx.setIce) {
      const pts: V3[] = [];
      for (let i = 0; i + 2 < p.points.length; i += 3) pts.push([p.points[i] / 1000, p.points[i + 1] / 1000, p.points[i + 2] / 1000]);
      const age = Math.max(0, (this.ctx.now() - p.t) / 1000);
      ice = this.ctx.setIce.add({ points: pts, width: p.width / 1000, life: p.life > 0 ? Math.max(0.1, p.life / 1000 - age) : 0, seed: hashId(p.id) });
    }
    this.laid.set(p.id, { piece: p, ice, melting: p.melt ?? null, gone: null, sent: new Set() });
  }

  /** the room took a piece away (expired, melted away) or broke it */
  unlay(id: string, shattered: boolean) {
    const L = this.laid.get(id);
    if (!L) return;
    if (L.ice && this.ctx.setIce) { if (shattered) this.ctx.setIce.shatter(L.ice); else this.ctx.setIce.remove(L.ice); }
    if (shattered || L.piece.kind !== 'ice') { L.gone = this.t; L.ice = 0; } else this.laid.delete(id);
  }
  /** the room says a melt began (ice melts; fire is doused) */
  melt(id: string, at: number) { const L = this.laid.get(id); if (L) L.melting = at; }

  /** the pieces' ledges on a stage plane (its own 2D coordinates): set ice's tops, the crystal ledges */
  ledges(plane: StagePlane | null): Ledge[] {
    if (!plane) return [];
    const out: Ledge[] = [];
    const si = this.ctx.setIce;
    if (si && (!si.world || si.world === this.ctx.world())) out.push(...flatSteps(si.ledgesIn(plane)));
    const n = planeNormal(plane);
    for (const L of this.laid.values()) {
      if (L.piece.kind !== 'gems' || L.gone != null) continue;
      const P = L.piece.points, a: V3 = [P[0] / 1000, P[1] / 1000, P[2] / 1000], b: V3 = [P[3] / 1000, P[4] / 1000, P[5] / 1000];
      const off = (q: V3) => (q[0] - plane.origin[0]) * n[0] + (q[2] - plane.origin[2]) * n[2];
      if (Math.abs(off(a)) > 0.8 || Math.abs(off(b)) > 0.8) continue;
      const s = (q: V3) => (q[0] - plane.origin[0]) * plane.right[0] + (q[2] - plane.origin[2]) * plane.right[2];
      const grow = Math.min(1, (this.ctx.now() - L.piece.t) / 600);
      if (grow < 0.6) continue;
      out.push({ id: `gem.${L.piece.id}`, x0: Math.min(s(a), s(b)), x1: Math.max(s(a), s(b)), y: a[1] - plane.origin[1] });
    }
    return out;
  }

  /** how much rising air a fire ring gives at p (0 … 1) */
  updraftAt(p: V3): number {
    let up = 0;
    for (const L of this.laid.values()) {
      if (L.piece.kind !== 'fire' || L.gone != null) continue;
      const P = L.piece.points, R = L.piece.width / 2000, d = Math.hypot(p[0] - P[0] / 1000, p[2] - P[2] / 1000);
      if (d < R * 1.1 && p[1] < P[1] / 1000 + 3.2) up = Math.max(up, (1 - d / (R * 1.1)) * this.fade(L));
    }
    return up;
  }

  private fade(L: Laid) {
    const now = this.ctx.now();
    const grow = Math.min(1, (now - L.piece.t) / 500);
    const melt = L.melting != null ? Math.max(0, 1 - (now - L.melting) / RULES.build.MELT_MS) : 1;
    const end = Math.min(1, Math.max(0, (L.piece.t + L.piece.life - now) / 1500));
    return grow * melt * end;
  }

  /** each frame: the elements against the pieces (the local dancers melt, douse and shatter them), and their glows */
  update(dt: number, local: { seat: number; c: Character; el: Element }[]) {
    this.t += dt;
    const now = this.ctx.now(), g = this.ctx.glows;
    for (const [id, L] of this.laid) {
      const P = L.piece.points, kind = L.piece.kind;
      if (L.gone != null) {
        // shattered or doused: a burst that fades
        const k = 1 - (this.t - L.gone) / 0.9;
        if (k <= 0) { this.laid.delete(id); continue; }
        for (let i = 0; i + 2 < P.length; i += 3) {
          const s = 1 + (1 - k) * 2.5;
          for (let j = 0; j < 5; j++) g.dot([P[i] / 1000 + Math.sin(j * 2.4 + i) * 0.2 * s, P[i + 1] / 1000 + (1 - k) * 0.6 * Math.cos(j * 1.7), P[i + 2] / 1000 + Math.cos(j * 2.4) * 0.2 * s], 0.04, kind === 'fire' ? FLAME : kind === 'gems' ? GEM_COLS[j % 4] : ICE_COL, 1.4 * k, 'spark');
        }
        continue;
      }
      // the elements
      for (const { seat, c, el } of local) {
        const near = distToPiece(L.piece, [c.root[0], c.root[1] + 0.9, c.root[2]]);
        const R = L.piece.width / 2000;
        if (kind === 'ice' && (el === 'fire' || el === 'plasma') && near < 0.9 + R) {
          if (L.ice && this.ctx.setIce) { const m = c.root; this.ctx.setIce.warm(m[0], m[1] + 0.9, m[2], 1.0, 1, dt); }
          this.once(L, seat, 'melt', id);
        }
        if (kind === 'fire' && (el === 'water' || el === 'ice') && near < R + 0.4) this.once(L, seat, 'melt', id);
        // a kick through it shatters it
        for (const h of c.hitShapes()) {
          const d = Math.min(distToPiece(L.piece, [h.ax, h.ay, h.az]), distToPiece(L.piece, [h.bx, h.by, h.bz]));
          if (d < h.r + R + 0.05 && (kind !== 'fire' || el !== 'fire')) this.once(L, seat, 'shatter', id);
        }
      }
      // a melt the room reported: ice warms until it is gone
      if (L.melting != null && kind === 'ice' && L.ice && this.ctx.setIce) {
        const m = Math.floor(P.length / 6) * 3;
        this.ctx.setIce.warm(P[m] / 1000, P[m + 1] / 1000, P[m + 2] / 1000, L.piece.width / 1000 + 1, 1, dt);
      }
      if (kind === 'gems') this.drawGems(L, now);
      if (kind === 'fire') this.drawFire(L, now, dt);
    }
  }

  private once(L: Laid, seat: number, what: 'melt' | 'shatter', id: string) {
    const key = `${what}.${seat}`;
    if (L.sent.has(key) || (what === 'melt' && L.melting != null)) return;
    const k = RULES.build.kinds[L.piece.kind];
    if (!k || (what === 'melt' ? !k.melts : !k.shatters)) return;
    L.sent.add(key);
    this.ctx.send(seat, { t: what, id });
  }

  /** a crystal ledge: tall gems of light along it, grown in from the middle, with a bright top edge */
  private drawGems(L: Laid, now: number) {
    const P = L.piece.points, g = this.ctx.glows;
    const a: V3 = [P[0] / 1000, P[1] / 1000, P[2] / 1000], b: V3 = [P[3] / 1000, P[4] / 1000, P[5] / 1000];
    const grow = Math.min(1, (now - L.piece.t) / 600), f = this.fade(L);
    const n = 9, seed = hashId(L.piece.id);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), from = Math.abs(u - 0.5) * 2;
      const k = Math.max(0, Math.min(1, (grow - from * 0.6) / 0.4));
      if (k <= 0) continue;
      const h = (0.12 + 0.1 * frac(seed * 0.37 + i * 0.61)) * k;
      const x = a[0] + (b[0] - a[0]) * u, z = a[2] + (b[2] - a[2]) * u, y = a[1];
      g.seg([x, y - h * 0.6, z], [x, y + h * 0.4, z], h * 0.55, GEM_COLS[(seed + i) % 4], 0.9 * f, 'gem');
    }
    g.seg([a[0], a[1], a[2]], [b[0], b[1], b[2]], 0.02, [0.9, 0.85, 1.3], 0.9 * grow * f, 'soft');
  }

  /** a ring of flame: tongues round the ring, climbing and flickering, heat into the field */
  private drawFire(L: Laid, now: number, dt: number) {
    const P = L.piece.points, g = this.ctx.glows, f = this.fade(L);
    if (f <= 0.01) return;
    const c: V3 = [P[0] / 1000, P[1] / 1000, P[2] / 1000], R = L.piece.width / 2000, t = now / 1000, seed = hashId(L.piece.id);
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + seed;
      const fl = 0.5 + 0.5 * Math.sin(t * 9 + i * 2.7) * Math.sin(t * 5.3 + i * 1.3);
      const h = (0.35 + 0.35 * fl) * f;
      const x = c[0] + Math.cos(a) * R, z = c[2] + Math.sin(a) * R;
      g.seg([x, c[1] + 0.02, z], [x, c[1] + h, z], 0.07, FLAME, 0.7 * f, 'soft');
      g.dot([x, c[1] + h + 0.08 * fl, z], 0.035, [1.6, 0.9, 0.35], 0.8 * f * fl, 'spark');
    }
    g.flat([c[0], c[1], c[2]], R, [1.2, 0.4, 0.1], 0.6 * f, 'ring');
    // heat into the field (the air lifts, water near it steams)
    this.ctx.field?.deposit({ p: [c[0], c[1] + 0.6, c[2]], r: R, heat: 0.9 * f, wind: [0, 2.4 * f, 0] });
    void dt;
  }

  stats() { return { pieces: this.laid.size }; }
}

/** the nearest distance from x to a piece's polyline (m) */
export function distToPiece(p: SetPiece, x: V3) {
  const P = p.points;
  let best = Infinity;
  for (let i = 0; i + 5 < P.length; i += 3) {
    const a: V3 = [P[i] / 1000, P[i + 1] / 1000, P[i + 2] / 1000], b: V3 = [P[i + 3] / 1000, P[i + 4] / 1000, P[i + 5] / 1000];
    const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1e-9;
    const t = Math.max(0, Math.min(1, ((x[0] - a[0]) * ab[0] + (x[1] - a[1]) * ab[1] + (x[2] - a[2]) * ab[2]) / l2));
    best = Math.min(best, Math.hypot(x[0] - a[0] - ab[0] * t, x[1] - a[1] - ab[1] * t, x[2] - a[2] - ab[2] * t));
  }
  return best;
}

const frac = (x: number) => x - Math.floor(x);

/** a seed from a room piece's id, so every client grows the same shards and crystals */
export function hashId(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 1_000_000 + 1;
}
