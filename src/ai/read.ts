// Reading the other dancer, the way a capoeirista does: from the start of a move you know where it will go. A move
// is deterministic from its start event (that is what the network sends), so Character.shapesAt(ev, t) replays its
// hit capsules at any moment; against this body's own hurt shapes that says whether, when and for how long it will
// touch. From that, the answers: a dodge that covers the touch (an evade move is "dodging" from its first frame to
// its last), a block begun just before it (within PARRY_MS: a parry), or a kick of one's own whose capsule meets
// theirs first (a clash: checked before anything else by the rules). All of it uses only the public, pure API of the
// body (Character.shapesAt, capsuleDistance, the move library), so it plans with exactly the geometry the jogo judges.
//
// Also here: each attack's reach, measured once against a standing body by the same replay (how far away a kick
// touches, and how far it only comes near), which is how a generous partner chooses its spacing.
import { Character, capsuleDistance, COMBAT, type Capsule } from '../dancer/character';
import { MOVES, tempoScale } from '../dancer/moves';
import type { StagePlane } from '../engine/camera';
import { bodyAt, durOf, hypotheticalEvent, moveRootAt } from './body';

const STEP = 1 / 120;

/** what an attack will do to a body that stays where it is */
export interface Threat {
  /** seconds after the attack's start: first and last touch of the body (null: it won't touch) */
  first: number | null;
  last: number | null;
  /** its closest pass (m; negative: overlapping) and when */
  min: number;
  at: number;
  /** its dangerous window (s after start) */
  a0: number;
  a1: number;
}

const minDist = (A: readonly Capsule[], B: readonly Capsule[], plane: StagePlane | null) => {
  let m = Infinity;
  for (const a of A) for (const b of B) m = Math.min(m, capsuleDistance(a, b, plane));
  return m;
};

/** an attack (its start event) against a body's hurt shapes, from `from` seconds after its start to the end of its
 *  window */
export function readThreat(ev: Record<string, any>, hurt: readonly Capsule[], plane: StagePlane | null, from = 0): Threat | null {
  const def = MOVES[ev.move];
  if (!def || !def.attack || !def.active || !def.hit) return null;
  const dur = def.dur * tempoScale(ev.bpm || 112), a0 = def.active[0] * dur, a1 = def.active[1] * dur;
  const th: Threat = { first: null, last: null, min: Infinity, at: a0, a0, a1 };
  for (let t = Math.max(a0, from); t <= a1 + 1e-9; t += STEP) {
    const d = minDist(Character.shapesAt(ev, t), hurt, plane);
    if (d < th.min) { th.min = d; th.at = t; }
    if (d <= 0) { if (th.first == null) th.first = t; th.last = t; }
  }
  return th;
}

/** a planned answer: which move, when (seconds after the attack's start), and what it should earn */
export interface Answer { move: string; at: number; kind: 'dodge' | 'clash' | 'parry' | 'near'; dir?: number }

/** the evade moves and how long each is "dodging" (its whole duration) */
export function dodgeWindow(name: string, bpm: number) { return durOf(name, bpm); }

/** can an evade started at `start` (s after the attack's start) cover the touch? */
export function dodgeCovers(name: string, start: number, th: Threat, bpm: number) {
  if (th.first == null) return true;
  // (a margin of two frames: the press lands on the frame after the plan at worst)
  return start <= th.first - 0.035 && start + dodgeWindow(name, bpm) >= th.last! + 0.05;
}

/** will an evade started at `start` (s after the attack's start), travelling `toward`, be judged a dodge? The rules
 *  call it one when the attack touches the body, or crosses where the body would stand, while it is dodging; an
 *  evade that carries the body clear away earns nothing at all. So: follow the evade's root and look for the attack
 *  crossing the standing capsule there while the evade lasts */
export function dodgeHolds(me: Character, name: string, start: number, toward: [number, number], ev: Record<string, any>, th: Threat, bpm: number, plane: StagePlane | null): boolean {
  const dur = durOf(name, bpm);
  const dir = plane ? (toward[0] * plane.right[0] + toward[1] * plane.right[2] < 0 ? -1 : 1) : 1;
  const myEv = hypotheticalEvent(me, name, bpm, dir);
  if (!plane) { myEv.fdir = [toward[0], toward[1]]; myEv.yaw = Math.atan2(toward[0], toward[1]); }
  const y = me.grounded ? me.root[1] : me.lastGroundY;
  for (let t = Math.max(th.a0, start); t <= Math.min(th.a1, start + dur) + 1e-9; t += STEP) {
    const r = moveRootAt(myEv, t - start);
    const stand: Capsule = { ax: r[0], ay: y + 0.2, az: r[2], bx: r[0], by: y + 1.35, bz: r[2], r: 0.22 };
    if (minDist(Character.shapesAt(ev, t), [stand], plane) <= 0) return true;
  }
  return false;
}

/** the window of block starts that parry (blocking at the first touch, begun within PARRY_MS of it) */
export function parryWindow(th: Threat, bpm: number): [number, number] | null {
  if (th.first == null) return null;
  const dur = durOf('block', bpm);
  // blocking from u 0.04 to 0.45 of the block; a parry if the block is younger than PARRY_MS at the touch
  const lo = th.first - Math.min(COMBAT.PARRY_MS / 1000 - 0.012, 0.45 * dur), hi = th.first - 0.04 * dur - 0.035;
  return hi > lo ? [lo, hi] : null;
}

/** when would a kick of my own, started at `start` (s after their start), meet theirs? (null: it doesn't, or it
 *  would touch their body first, which is a hit, not a clash) */
export function clashAt(me: Character, mine: string, start: number, ev: Record<string, any>, th: Threat, bpm: number, plane: StagePlane | null, dir: number): number | null {
  const def = MOVES[mine];
  if (!def || !def.active || !def.hit) return null;
  const dur = def.dur * tempoScale(bpm), m0 = start + def.active[0] * dur, m1 = start + def.active[1] * dur;
  const myEv = hypotheticalEvent(me, mine, bpm, dir);
  const end = Math.min(th.a1, m1, (th.first ?? Infinity) - 0.04);
  let run = 0;
  for (let t = Math.max(th.a0, m0); t <= end + 1e-9; t += STEP) {
    const mineCaps = Character.shapesAt(myEv, t - start);
    if (!mineCaps.length) continue;
    // their body, where their move has carried it
    if (minDist(mineCaps, [bodyAt(moveRootAt(ev, t))], plane) <= 0 && minDist(mineCaps, Character.shapesAt(ev, t), plane) > 0) return null;
    // (overlapping for three samples running: a clash that a frame's slip would miss isn't one)
    if (minDist(mineCaps, Character.shapesAt(ev, t), plane) <= -0.02) { if (++run >= 3) return t; } else run = 0;
  }
  return null;
}

// ---------------------------------------------------------------- reach
/** how an attack meets a body standing `d` metres away along the facing: the closest its capsule comes (m) */
export interface Reach { touch: [number, number] | null; near: number }
const reachCache = new Map<string, Reach>();
const TEST_PLANE: StagePlane = { id: 'ai.reach', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 20, ground: 0, ledges: [], spawns: [[0, 0], [1, 0]] };

/** an attack's reach against a standing, ginga-ing body: the distances (m, root to root) at which it touches, and
 *  the furthest at which it still comes near (within COMBAT.NEAR). Measured once per move by the real replay */
export function reachOf(name: string): Reach {
  const hit = reachCache.get(name);
  if (hit) return hit;
  const r: Reach = { touch: null, near: 0 };
  const def = MOVES[name];
  if (def?.attack) {
    const a = new Character({ seat: 0, plane: TEST_PLANE, x: 0 });
    for (let i = 0; i < 20; i++) a.update(1 / 60, null, i / 30);
    for (let d = 0.4; d <= 4.0001; d += 0.05) {
      const b = new Character({ seat: 1, plane: TEST_PLANE, x: d });
      for (let i = 0; i < 20; i++) b.update(1 / 60, null, i / 30);
      const ev = hypotheticalEvent(a, name, 112, 1);
      const th = readThreat(ev, b.hurtShapes(), TEST_PLANE);
      if (!th) break;
      if (th.first != null) r.touch = r.touch ? [r.touch[0], d] : [d, d];
      else if (th.min <= COMBAT.NEAR) r.near = d;
    }
    if (r.touch && r.near < r.touch[1]) r.near = r.touch[1];
  }
  reachCache.set(name, r);
  return r;
}
