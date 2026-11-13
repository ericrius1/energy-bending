// The legs of the jogo: where a player's ginga carries the body between moves. Two capoeiristas never stand square
// on a line: the distance between them breathes with the ginga (in on the bar's strong beat, out again), and in a roda
// the pair turns about the centre they share, each stepping round to their own left or right, so the game travels
// round the ring. When an attack is coming the breath comes in further, timed to arrive on the beat it starts from,
// so the kick grows out of the step instead of a shuffle before it.
//
// Locked to the side view, the stage is a line: only the breathing applies, and the pair changes sides by going
// over or round each other (aú, rolê: partner.ts), never by walking past. Free, the stick undoes the camera
// (body.ts stickFor). Speeds stay under the body's turn-to-run threshold (Character faces where it runs above about
// 0.7 m/s), so a player circling keeps facing the other.
import { PHYS } from '../dancer/character';
import type { Other, Sight } from './brain';
import type { Mind } from './mind';
import { jogoAxis, roomBehind } from './behaviours';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** the fastest a circling body moves (m/s): it keeps facing the other below the run's turn */
const FREE_MAX = 0.6;
/** locked, backing away faster than this much of a run turns the body round (Character._face) */
const LOCK_BACK = 0.28;

export interface GingaLegs {
  /** the distance to breathe about (m, root to root) */
  dist: number;
  /** how far the breath goes in and out (m) */
  sway: number;
  /** the beat of the bar (0 … 3) on which the breath is nearest (the strong beat an attack would come on) */
  nearOn: number;
  /** how fast the pair should turn about its centre (rad/s, free view only), signed: + to this dancer's right */
  circle: number;
  /** arrive at this distance by this beat (an attack's line), instead of breathing */
  arrive?: { dist: number; by: number } | null;
  /** where the roda's middle is (world x, z): the pair drifts back toward it */
  home: [number, number];
  /** the world's room (m from its middle) */
  room: number;
}

/** the pair's angular rate (rad/s) the other is giving by its own steps (their velocity across the line) */
function theirTurn(o: Other, tx: number, tz: number, d: number) {
  // (the other steps to its own right with the same sense when it moves along -tangent: both turn the pair one way)
  return d > 0.3 ? (-(o.v[0] * tx + o.v[2] * tz)) / d : 0;
}

/** claim the legs for the ginga between moves: the breathing distance, the circling, the drift home */
export function gingaLegs(s: Sight, m: Mind, o: Other, g: GingaLegs, prio = 0, why = 'ginga') {
  const c = s.self, a = jogoAxis(s, o), bpm = s.bpm;
  const dir = a.dir, d = a.dist;
  // the breath: nearest on `nearOn`, furthest two beats later
  const ph = ((s.beat - g.nearOn) * Math.PI) / 2;
  let want = g.dist - g.sway * Math.cos(ph);
  let vr: number;
  if (g.arrive) {
    // in for the attack, arriving just before its beat (not a burst then a stop: the speed it takes to be there in
    // time), and planted for the last 8th, so the kick doesn't slide on with the step (a move on the ground carries
    // the body's speed)
    const leftB = g.arrive.by - 0.4 - s.beat;
    want = g.arrive.dist;
    if (leftB <= 0) return;
    vr = (d - want) / Math.max(0.2, (leftB * 60) / bpm);
  } else {
    // (the breath's own speed, plus a gentle correction toward it; a dead zone so a body at rest stays at rest)
    const breathV = (g.sway * Math.sin(ph) * Math.PI / 2) * (bpm / 60);
    const err = d - want;
    vr = (Math.abs(err) < 0.08 ? 0 : err * 0.9) - breathV * 0.8;
  }
  // radial (+ toward the other)
  vr = clamp(vr, -0.9, 1.1);
  if (vr < 0 && roomBehind(c, -a.sign) < 0.5) vr = 0;
  let vx = dir[0] * vr, vz = dir[1] * vr;
  if (!c.plane) {
    // circling: this dancer's share of the pair's turn (half, and whatever the other isn't giving)
    const tx = -dir[1], tz = dir[0];   // to this dancer's right as it faces the other
    const want = g.circle * d;
    const theirs = theirTurn(o, tx, tz, d) * d;
    const mine = Math.abs(want) < 1e-3 ? 0 : want / 2 + 0.6 * Math.sign(want) * Math.max(0, Math.abs(want) / 2 - Math.sign(want) * theirs);
    // (coming in for an attack the arc straightens, so the body faces the other square when it kicks)
    const arc = g.arrive ? 0.3 : 1;
    vx += tx * mine * arc; vz += tz * mine * arc;
    // the roda's middle: the pair drifts back to it (and nobody leaves the world)
    const cx = (c.x + o.root[0]) / 2, cz = (c.z + o.root[2]) / 2;
    const hx = g.home[0] - cx, hz = g.home[1] - cz, hd = Math.hypot(hx, hz);
    if (hd > 1) { const k = Math.min(0.3, (hd - 1) * 0.25) / hd; vx += hx * k; vz += hz * k; }
    const r = Math.hypot(c.x, c.z);
    if (r > g.room - 1.6) { const k = Math.min(0.6, (r - (g.room - 1.6)) * 0.8) / r; vx -= c.x * k; vz -= c.z * k; }
    const sp = Math.hypot(vx, vz);
    if (sp > FREE_MAX) { vx *= FREE_MAX / sp; vz *= FREE_MAX / sp; }
  }
  const sp = Math.hypot(vx, vz);
  if (sp < 0.04) return;
  let k = sp / PHYS.runSpeed;
  // (locked, backing off fast turns the body away: keep it under the threshold)
  if (c.plane && vr < 0) k = Math.min(k, LOCK_BACK);
  m.claim({ x: vx / sp, z: vz / sp, k: clamp(k, 0, 0.5), walk: false, prio, why });
}

/** the circling's sense for a pair: the same for both brains (it comes from the shared music clock), changing now and
 *  then on a phrase line (every 16 bars it may turn back the other way, three times in ten) */
export function circleSense(beat: number, seed = 0): 1 | -1 {
  // (seven in ten keep the way they were going: the game travels round the ring, not back and forth)
  let sense = 1;
  for (let p = 1; p <= Math.floor(beat / 64); p++) { const x = Math.sin((p + seed * 7.13) * 12.9898 + 4.1414) * 43758.5453; if (x - Math.floor(x) < 0.3) sense = -sense; }
  return sense as 1 | -1;
}
