// The duel's crossing through a mirror (or any gate), judged without a page: the same rule the page's gates make
// (src/portals/portals.ts travelPhase and `bring`, report 18-wayfinding), as pure numbers, so the Node harness
// (sim.ts), the room server's authority (src/net/duel-authority.ts) and each online page's prediction
// (src/net/duel-client.ts) all decide a crossing the same way:
//   - a body whose middle (its hips) passes an open disc of its world, within CROSS.MARGIN of the rim, crosses: it is
//     carried by the gate's own move (gate.ts `through`), its matter and momentum with it
//   - its partner is brought along: joined (a grip, a swing) by the same move, so the grip keeps its shape; free, by the
//     same move and then out onto the side the crosser came out of, within CROSS.NEAR of the disc (Portals.bring)
//   - no crossing back for a moment: both bodies are exempt for HOLD_HELD / HOLD_FREE seconds, and a body still behind
//     the disc it came out of (reaching back through it) stays exempt for BEHIND_S (report 19: a pair at a mirror went
//     back and forth)
// The world change itself (the arena, its solids, its hazard, the music's clock) is the caller's: `DuelCross` says
// which gate, which face, who, and whether the pair was joined, and `nodeWorld` gives the next world's arena and floor.
//
// The gates: every world's own gate to the geode, the geode's to each world (geode/gates.ts hubGates) and the mirrors
// between the other worlds (portals/mirrors.ts), each pair joined by its `to`. The worlds' own gates to the geode are
// written in each world's class beside its drawing (temple.ts, pool.ts, redwoods.ts), which Node can't import: they
// are copied here (OWN_GATES), and the page checks its open gates against this table (`gateDiff`, online.ts warns).
import { Gate, type GateDef } from '../portals/gate';
import { Rigid, dot, sub, type V3 } from '../portals/rigid';
import { mirrorDefs } from '../portals/mirrors';
import { hubGates } from '../worlds/geode/gates';
import { worldFor, NODE_WORLDS, type NodeWorld } from './stages';
import type { Character } from '../dancer/character';
import type { Link } from './contact';
import { LM } from '../skeleton/landmarks';

export const CROSS = {
  /** a body's middle passes a disc this far past its rim (m): the page's travelPhase margin */
  MARGIN: 0.15,
  /** no crossing back for this long after a crossing (s): joined, free. The page's offline duel holds a free pair
   *  0.6 s (index.ts); the shared rule is 1.5 s either way, long enough for an online page 400 ms away to have heard of
   *  one crossing before the next can come (a pair dancing at a mirror went through it every 0.7 s otherwise) */
  HOLD_HELD: 1.5,
  HOLD_FREE: 1.5,
  /** a body behind the disc it came out of (within BEHIND_M of its plane, the rim and a body's width) is kept from
   *  crossing for this long after (s) */
  BEHIND_S: 4,
  BEHIND_M: 2.5,
  /** a partner brought through free lands this near the far disc (m), and at least MIN in front of it */
  NEAR: 1.6,
  MIN: 0.7,
};

/** a crossing: the duel goes to another world. The shape every side of the duel shares (the server's event, the
 *  harness's record, the page's hook): who passed which gate into which, through which face, and whether the two
 *  were joined (the partner brought by the gate's own move) */
export interface DuelCross {
  /** the body whose middle passed the disc (the other was brought along) */
  seat: number;
  /** the gate passed (in `from`) and the one come out of (in `to`) */
  gate: string;
  partner: string;
  from: string;
  to: string;
  /** in at the gate's front face (out of the partner's front) */
  front: boolean;
  /** where on the disc (its own coordinates, -1 … 1) */
  u: number;
  v: number;
  /** the two were joined: the partner went by the gate's own move */
  held: boolean;
}

/** the gates written beside the worlds' drawing (each world's one gate to the geode): kept equal to temple.ts, pool.ts
 *  and redwoods.ts (the page checks: gateDiff) */
export const OWN_GATES: GateDef[] = [
  { id: 'temple.geode', world: 'temple', at: [-7.6, 1.4, 5.4], normal: [0.8, 0, -0.6], radius: 1.3, to: { world: 'geode', portal: 'geode.temple' } },
  { id: 'pool.geode', world: 'pool', at: [-7.5, 1.35, 4.5], normal: [0.83, 0, -0.55], radius: 1.25, to: { world: 'geode', portal: 'geode.pool' } },
  { id: 'redwoods.geode', world: 'redwoods', at: [-10.03, 1.35, 5.23], normal: [0.885, 0, -0.466], radius: 1.3, to: { world: 'geode', portal: 'geode.redwoods' } },
];

const worlds = new Map<string, NodeWorld | null>();
/** a world as the duel stands in it without a page (stages.ts worldFor), made once */
export function nodeWorld(id: string): NodeWorld | null {
  if (!worlds.has(id)) worlds.set(id, worldFor(id));
  return worlds.get(id)!;
}

/** every gate between the worlds Node knows, as the page opens them */
export function duelGateDefs(ids: readonly string[] = NODE_WORLDS): GateDef[] {
  const has = new Set(ids);
  const hub: GateDef[] = hubGates().map(({ world, at, normal, radius }) => ({ id: `geode.${world}`, world: 'geode', at, normal, radius, to: { world, portal: `${world}.geode` } }));
  const mirrors = mirrorDefs((w, x, z) => nodeWorld(w)?.groundAt(x, z) ?? 0);
  return [...hub, ...OWN_GATES, ...mirrors].filter((d) => has.has(d.world) && has.has(d.to.world));
}

/** the gates, open and paired (pure: no drawing) */
export class Doors {
  readonly gates = new Map<string, Gate>();
  constructor(defs: readonly GateDef[] = duelGateDefs()) {
    for (const d of defs) { const g = new Gate(d); g.open = 1; this.gates.set(d.id, g); }
    for (const d of defs) { const a = this.gates.get(d.id)!, b = this.gates.get(d.to.portal); if (b && a.partner !== b) a.pair(b); }
  }
  get(id: string) { return this.gates.get(id) ?? null; }
  /** the move from world `from` into `to` through gate `id` (null: no such gate between them) */
  through(id: string): Rigid | null { const g = this.gates.get(id); return g?.partner ? g.through : null; }
}
let shared: Doors | null = null;
/** the duel's gates, made once */
export const duelDoors = () => (shared ??= new Doors());

/** the gates a page has open that differ from the table (by id: missing, extra, or moved more than a centimetre) */
export function gateDiff(page: readonly { id: string; world: string; at: ArrayLike<number>; radius: number }[], doors = duelDoors()) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of page) {
    if (!NODE_WORLDS.includes(p.world as never)) continue;
    seen.add(p.id);
    const g = doors.get(p.id);
    if (!g) { out.push(`${p.id}: not in the duel's table`); continue; }
    const d = Math.hypot(p.at[0] - g.at[0], p.at[1] - g.at[1], p.at[2] - g.at[2]);
    if (d > 0.01 || Math.abs(p.radius - g.radius) > 1e-3) out.push(`${p.id}: ${d.toFixed(3)} m off`);
  }
  for (const id of doors.gates.keys()) if (!seen.has(id)) out.push(`${id}: not open on the page`);
  return out;
}

/** a body's middle, what passes a disc: over its root by a standing body's hip height. (The page's gates use the drawn
 *  hips; here the root, which the server and a page's prediction agree on to a millimetre, where the pose's hips, turned
 *  by where each thinks the other is, differ by centimetres: a crossing judged a few ticks apart was put back a moment
 *  later. `poseMiddle` is the pose's hips, for a caller that wants them) */
export const MIDDLE_Y = 0.95;
export function middleOf(c: { root: ArrayLike<number> }): V3 { return [c.root[0], c.root[1] + MIDDLE_Y, c.root[2]]; }
export function poseMiddle(c: { pose: ArrayLike<number> }): V3 {
  const p = c.pose, a = 3 * LM.LH, b = 3 * LM.RH;
  return [(p[a] + p[b]) / 2, (p[a + 1] + p[b + 1]) / 2, (p[a + 2] + p[b + 2]) / 2];
}

/** the turn about up a move makes, in Character.yaw's sense (IntentController.carry's) */
export const yawOfMove = (M: Rigid) => Math.atan2(M.r[2], M.r[8]);
const dir2 = (M: Rigid, v: number[]) => { const d = M.dir([v[0], 0, v[1]]); return [d[0], d[2]]; };

/** a Character carried by a rigid move (a gate's): where it is, how it moves, which way it faces, its pose, its move
 *  under way, its floors and walls. A standing gate turns only about up, so up stays up */
export function carryBody(c: Character, M: Rigid) {
  const C = c as unknown as Record<string, unknown>;
  const dy = yawOfMove(M);
  c.root = M.pt(c.root);
  c.v = M.dir(c.v);
  c.yaw += dy;
  for (const key of ['pose', '_prev'] as const) {
    const P = C[key] as Float32Array | undefined;
    if (!P) continue;
    for (let j = 0; j < P.length; j += 3) { const p = M.pt([P[j], P[j + 1], P[j + 2]]); P[j] = p[0]; P[j + 1] = p[1]; P[j + 2] = p[2]; }
  }
  for (let j = 0; j < c.vel.length; j += 3) { const v = M.dir([c.vel[j], c.vel[j + 1], c.vel[j + 2]]); c.vel[j] = v[0]; c.vel[j + 1] = v[1]; c.vel[j + 2] = v[2]; }
  // (heights: the floors it stood on, raised or lowered by the gate's rise; a standing gate turns only about up)
  c.lastGroundY += M.t[1]; c.groundY += M.t[1];
  if (Array.isArray(C.dashV)) C.dashV = M.dir(C.dashV as V3);
  for (const k of ['wallN', 'wallNearN', 'wallLastN', 'lockN', 'faceN']) if (Array.isArray(C[k])) C[k] = dir2(M, C[k] as number[]);
  if (Array.isArray(C.home)) C.home = M.pt(C.home as V3);
  if (Array.isArray(C.aimPos)) C.aimPos = M.pt(C.aimPos as V3);
  if (Array.isArray(C.aimVel)) C.aimVel = M.dir(C.aimVel as V3);
  c.support = null;
  const m = c.move;
  if (m) {
    m.p0 = M.pt(m.p0); m.v0 = M.dir(m.v0); m.yaw += dy;
    m.f = dir2(M, m.f) as [number, number];
    m.aimW = M.dir(m.aimW); m.aimN = M.dir(m.aimN);
  }
}

/** a joined pair's link carried with them (its contact point, the flown centre and its velocity) */
export function carryLink(L: Link | null, M: Rigid) {
  if (!L) return;
  L.at = M.pt(L.at); L.c = M.pt(L.c); L.v = M.dir(L.v);
}

/** the move that brings a partner through gate `g` behind one who crossed it: joined, the gate's own; free, the gate's
 *  then out onto the side the crosser came out of (`front`), within CROSS.NEAR of the far disc (Portals.bring) */
export function bringMove(g: Gate, mid: ArrayLike<number>, front: boolean, rigid: boolean): Rigid {
  const b = g.partner!, G = g.through;
  if (rigid) return G;
  const p = G.pt(mid), rel = sub(p, b.at), s = dot(rel, b.n), sg = front ? 1 : -1;
  const want = sg * Math.min(Math.max(Math.abs(s), CROSS.MIN), CROSS.NEAR);
  const across = dot(rel, b.right), lim = b.radius * 0.7, dx = Math.max(-lim, Math.min(lim, across)) - across;
  const T = Rigid.frame([1, 0, 0], [0, 1, 0], [0, 0, 1], [b.n[0] * (want - s) + b.right[0] * dx, b.n[1] * (want - s) + b.right[1] * dx, b.n[2] * (want - s) + b.right[2] * dx]);
  return T.mul(G);
}

/** the judge's state (the client saves it with each predicted input, to replay from) */
export interface JudgeState { t: number; last: (V3 | null)[]; exempt: number[]; behind: { gate: string; until: number } | null }

/** who crosses: each body's last point strictly off a disc's plane, and the exemptions after a crossing */
export class CrossJudge {
  t = 0;
  last: (V3 | null)[] = [null, null];
  exempt = [-1, -1];
  behind: { gate: string; until: number } | null = null;
  /** the crossings held back (a body through a disc while exempt), the last few */
  readonly held: { t: number; k: number; gate: string }[] = [];
  constructor(readonly doors: Doors = duelDoors()) {}

  save(): JudgeState { return { t: this.t, last: this.last.map((p) => (p ? [p[0], p[1], p[2]] : null)), exempt: [...this.exempt], behind: this.behind ? { ...this.behind } : null }; }
  load(s: JudgeState) { this.t = s.t; this.last = s.last.map((p) => (p ? [p[0], p[1], p[2]] as V3 : null)); this.exempt = [...s.exempt]; this.behind = s.behind ? { ...s.behind } : null; }
  /** forget where the bodies were (they were moved some other way: a correction, a reform) */
  forget(k?: number) { if (k == null) this.last = [null, null]; else this.last[k] = null; }

  /** body k's middle this step, in `world`: the disc it passed (and where, which face), or null. `dt` (s) is the step */
  body(k: number, world: string, mid: V3): { gate: Gate; u: number; v: number; front: boolean } | null {
    const hit = this.judge(k, world, mid);
    // (then, for the steps after: a body behind the disc it came out of, reaching back through it, is held back; the
    // page's duel does this after its gates judged the frame, so a body walking back through crosses once the hold is up)
    const B = !hit && this.behind && this.behind.until > this.t ? this.doors.get(this.behind.gate) : null;
    if (B && B.world === world) {
      const dx = mid[0] - B.at[0], dz = mid[2] - B.at[2], s = dx * B.n[0] + dz * B.n[2];
      if (s < 0 && s > -CROSS.BEHIND_M && Math.abs(dx * B.n[2] - dz * B.n[0]) < B.radius + 0.6) this.exempt[k] = Math.max(this.exempt[k], this.t + 0.1);
    }
    return hit;
  }
  private judge(k: number, world: string, mid: V3): { gate: Gate; u: number; v: number; front: boolean } | null {
    if (this.exempt[k] > this.t) {
      // (a crossing held back: counted, with why, for the measures)
      const was = this.last[k];
      if (was) for (const g of this.doors.gates.values()) if (g.world === world && g.crossing(was, mid, CROSS.MARGIN)) { this.held.push({ t: +this.t.toFixed(3), k, gate: g.id }); if (this.held.length > 40) this.held.shift(); break; }
      this.last[k] = [mid[0], mid[1], mid[2]];
      return null;
    }
    const was = this.last[k];
    let onFace = false;
    for (const g of this.doors.gates.values()) if (g.world === world && g.onFace(mid)) { onFace = true; break; }
    if (!was || !onFace) this.last[k] = [mid[0], mid[1], mid[2]];
    if (!was) return null;
    for (const g of this.doors.gates.values()) {
      if (g.world !== world) continue;
      const c = g.crossing(was, mid, CROSS.MARGIN);
      if (c) { this.last[k] = [mid[0], mid[1], mid[2]]; return { gate: g, ...c }; }
    }
    return null;
  }

  /** after the duel crossed: neither body crosses back for a moment, nor while behind the disc it came out of */
  after(c: Pick<DuelCross, 'partner' | 'held'>) {
    const hold = c.held ? CROSS.HOLD_HELD : CROSS.HOLD_FREE;
    this.exempt = [this.t + hold, this.t + hold];
    this.behind = { gate: c.partner, until: this.t + CROSS.BEHIND_S };
    this.last = [null, null];
  }
}

/** a step's crossing for the pair, judged and made: the first body whose middle passed a disc is carried by the gate,
 *  its partner brought along (joined: by the same move, the link with them), the judge told. The world change is the
 *  caller's. `dt` (s) moves the judge's clock */
export function crossPair(chars: readonly [Character, Character], world: string, judge: CrossJudge, dt: number, link: Link | null): DuelCross | null {
  judge.t += dt;
  let hit: { k: number; gate: Gate; u: number; v: number; front: boolean } | null = null;
  for (let k = 0; k < 2; k++) {
    const c = judge.body(k, world, middleOf(chars[k]));
    if (c && !hit) hit = { k, ...c };
  }
  if (!hit || !hit.gate.partner) return null;
  const g = hit.gate, b = g.partner!, held = !!link;
  const o = 1 - hit.k, partnerMid = middleOf(chars[o]);
  carryBody(chars[hit.k], g.through);
  carryBody(chars[o], bringMove(g, partnerMid, hit.front, held));
  carryLink(link, g.through);
  const out: DuelCross = { seat: hit.k, gate: g.id, partner: b.id, from: g.world, to: b.world, front: hit.front, u: +hit.u.toFixed(3), v: +hit.v.toFixed(3), held };
  judge.after(out);
  return out;
}
