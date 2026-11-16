// The crossing's light (phase 6, report 20-crossing; issue 4 of report 19's): going through a mirror is a moment, so it
// looks like one. At the disc the pair went through, in whichever world the main view is in (the old one while the eye
// is still on its way after them, the new one once it is through; the two discs are one door), for about three seconds:
//   - a ring of light runs out across the glass from its rim and fades (the disc's own ripple and flash are the
//     portals', poked again on the beat the music turns on);
//   - petals blow out of the disc on both sides, sun gold, cream, coral, leaf and the far world's own colour (never the
//     seats' rose and fern), turning and drifting down on the air, and a few motes of light rise;
//   - on the beat the new track comes in (the crossing's chime), the ring runs out again, brighter.
// Glows only (src/play/glow.ts: the duel's list, drawn once in the main view, additive): nothing that hurts, explodes
// or flashes the screen white. Pure but for the glows it fills.
import type { Glows, RGB } from '../play/glow';
import type { Disc, V3 } from './voyage';

/** each world's colour (labels.ts WORLD_CSS, linear-ish) */
const WORLD_RGB: Record<string, RGB> = { geode: [0.62, 0.42, 1.0], pool: [0.3, 0.72, 0.92], temple: [0.25, 0.82, 0.72], redwoods: [0.52, 0.76, 0.36] };
/** the palette (the art bible's): sun gold, cream, coral, leaf green, sky teal */
const PALETTE: RGB[] = [[1.0, 0.78, 0.36], [1.0, 0.94, 0.8], [1.0, 0.55, 0.42], [0.5, 0.86, 0.42], [0.42, 0.85, 0.85]];

interface Petal { p: V3; v: V3; spin: number; a: number; size: number; col: RGB; life: number; age: number; mote: boolean }

/** one crossing's light, at a door (its two discs: `a` in the old world, `b` in the new) */
interface Burst { a: Disc; b: Disc; to: string; age: number; beatAt: number; petals: Petal[] }

const rnd = (s: number) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };

export class CrossFx {
  private bursts: Burst[] = [];
  private n = 0;
  /** how bright (1: as made) */
  gain = 1;

  /** a crossing: the door's two discs (old world's, new world's), the world it leads to, and when (s from now) the
   *  music's beat comes */
  start(a: Disc, b: Disc, to: string, beatIn: number) {
    const petals: Petal[] = [];
    const col = WORLD_RGB[to] ?? PALETTE[0];
    for (let i = 0; i < 44; i++) {
      const s = ++this.n * 1.618 + i;
      const ang = rnd(s) * Math.PI * 2, rr = 0.25 + rnd(s + 1) * 0.85, side = i % 2 ? 1 : -1, mote = i % 6 === 0;
      // (in the disc's own frame: x across, y up, z out of its face; turned into the world when drawn, per world)
      const out = 0.8 + rnd(s + 2) * 1.6;
      petals.push({
        p: [Math.cos(ang) * rr, Math.sin(ang) * rr, 0.05 * side],
        v: [Math.cos(ang) * (0.6 + rnd(s + 3)), Math.sin(ang) * (0.4 + rnd(s + 4) * 0.6) + 0.5, side * out],
        spin: (rnd(s + 5) - 0.5) * 9, a: rnd(s + 6) * 6.28, size: mote ? 0.035 : 0.06 + rnd(s + 7) * 0.05,
        col: i % 5 === 0 ? col : PALETTE[Math.floor(rnd(s + 8) * PALETTE.length)], life: 2.2 + rnd(s + 9) * 1.3, age: 0, mote,
      });
    }
    this.bursts.push({ a, b, to, age: 0, beatAt: beatIn, petals });
    if (this.bursts.length > 3) this.bursts.shift();
  }

  /** each frame: the petals drift (time: the page's, s), and every burst is drawn at the disc of `world` (the main
   *  view's): `a` while it is the old world, `b` once it is the new */
  update(dt: number, glows: Glows, newWorld: (b: { to: string }) => boolean, eye?: ArrayLike<number>) {
    // (nothing of it within a metre or so of the eye: the camera goes through the disc after the pair, and a petal at the
    // lens is a blur over the whole frame)
    const near = (p: ArrayLike<number>) => (eye ? smooth((Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) - 0.7) / 1.3) : 1);
    this.bursts = this.bursts.filter((B) => B.age < 3.6);
    for (const B of this.bursts) {
      B.age += dt;
      const D = newWorld(B) ? B.b : B.a;
      const X = D.right, Y = D.up, Z = D.n, at = D.at;
      const W = (l: ArrayLike<number>): V3 => [at[0] + X[0] * l[0] + Y[0] * l[1] + Z[0] * l[2], at[1] + X[1] * l[0] + Y[1] * l[1] + Z[1] * l[2], at[2] + X[2] * l[0] + Y[2] * l[1] + Z[2] * l[2]];
      const g = this.gain;
      // the ring of light across the glass: once as the pair goes through, again (brighter) on the beat
      const ring = (t: number, I: number) => {
        if (t < 0 || t > 0.9) return;
        const u = t / 0.9, R = D.r * (0.35 + 0.75 * smooth(u)), fade = (1 - u) * (1 - u) * smooth(t / 0.08);
        const n = 28, col: RGB = [1.0, 0.86, 0.55];
        let prev = W([R, 0, 0.02]);
        for (let i = 1; i <= n; i++) {
          const a = (i / n) * Math.PI * 2, p = W([Math.cos(a) * R, Math.sin(a) * R, 0.02]);
          glows.seg(prev, p, 0.035 + 0.03 * (1 - u), col, I * fade * g * near(p));
          prev = p;
        }
      };
      ring(B.age, 1.1);
      ring(B.age - B.beatAt, 1.6);
      // the petals: out of the disc, slowed by the air, drifting down and turning
      for (const P of B.petals) {
        P.age += dt;
        if (P.age > P.life) continue;
        const drag = Math.exp(-dt * 1.6);
        P.v[0] *= drag; P.v[2] *= drag; P.v[1] = P.v[1] * drag - (P.mote ? -0.25 : 0.55) * dt;
        P.p[0] += P.v[0] * dt; P.p[1] += P.v[1] * dt; P.p[2] += P.v[2] * dt;
        P.a += P.spin * dt;
        const base = W(P.p), k = smooth(P.age / 0.12) * (1 - smooth((P.age - P.life + 0.8) / 0.8)) * near(base);
        if (k <= 0.002) continue;
        if (P.mote) { glows.dot(base, P.size, [1.0, 0.9, 0.6], 1.4 * k * g, 'spark'); continue; }
        const ax = Math.cos(P.a), ay = Math.sin(P.a), L = P.size * 2.2;
        const tip = W([P.p[0] + ax * L, P.p[1] + ay * L, P.p[2] + Math.sin(P.a * 0.7) * L * 0.5]);
        glows.petal(base, tip, P.size, P.col, 0.9 * k * g);
      }
    }
  }

  clear() { this.bursts.length = 0; }
}

// ---------------------------------------------------------------- the next world, glimpsed (phase 7, report 24)
// Report 23: "nothing of the next world is seen until the glass": the worlds read as joined by doors, not one land. So
// each open mirror breathes its world out into this one, all the time, seen from across the arena:
//   - its light spills onto the floor in front of it, a soft pool in the far world's colour, and a fainter one further
//     out (the low sun of the temple, the redwoods' green dusk, the Pool's water light, the geode's violet);
//   - the far world's own air drifts out of the glass and wanders a few metres into this one: fireflies out of the
//     redwoods, petals and spray glints out of the temple, rising droplets out of the Pool, crystal sparks out of the
//     geode, turning back toward their door as they fade;
//   - all of it stronger as the pair comes near (the door calling), and on a voyage's mirror most.
// Glows only, a few dozen a mirror.

/** what each world breathes out: its colours, how its motes move (rise, wander, blink) and their size */
const BREATH: Record<string, { cols: RGB[]; rise: number; wander: number; blink: number; size: number; petal: boolean; shape: 'soft' | 'spark' }> = {
  redwoods: { cols: [[0.75, 1.0, 0.35], [0.95, 0.95, 0.4], [0.5, 0.9, 0.45]], rise: 0.05, wander: 0.5, blink: 1, size: 0.05, petal: false, shape: 'soft' },
  temple: { cols: [[1.0, 0.72, 0.42], [1.0, 0.55, 0.42], [1.0, 0.88, 0.6], [0.42, 0.85, 0.8]], rise: -0.06, wander: 0.35, blink: 0, size: 0.06, petal: true, shape: 'soft' },
  pool: { cols: [[0.55, 0.88, 1.0], [0.8, 0.96, 1.0], [0.35, 0.8, 0.9]], rise: 0.22, wander: 0.18, blink: 0.3, size: 0.04, petal: false, shape: 'spark' },
  geode: { cols: [[0.78, 0.6, 1.0], [1.0, 0.82, 0.5], [0.9, 0.82, 1.0]], rise: 0.1, wander: 0.25, blink: 0.6, size: 0.04, petal: false, shape: 'spark' },
};
/** each world's light (what spills on the floor in front of its door) */
const SPILL: Record<string, RGB> = { redwoods: [0.55, 0.85, 0.35], temple: [1.0, 0.7, 0.38], pool: [0.4, 0.78, 1.0], geode: [0.7, 0.5, 1.0] };

interface Mote { s: number; age: number; life: number }

export class Glimpses {
  /** on (the measure reads it: scripts/cross-measure.mjs counts a door's spill in sight as the next world seen) */
  on = true;
  /** how far off the spill reads (m), for the measure */
  reach = 30;
  gain = 1;
  /** the floor's height under a point (the door's world's) */
  ground: (x: number, z: number) => number = () => 0;
  private motes = new Map<string, Mote[]>();
  private t = 0;
  private n = 0;

  /** each frame: every open door of the main view's world (its disc, and the world it opens on), how near the pair is
   *  (their middle) and which door is the voyage's */
  update(dt: number, glows: Glows, doors: readonly Disc[], pair: ArrayLike<number>, voyage: string | null, eye?: ArrayLike<number>) {
    this.t += dt;
    if (!this.on) return;
    const near = (p: ArrayLike<number>) => (eye ? smooth((Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) - 0.6) / 1.2) : 1);
    for (const D of doors) {
      const to = D.to ?? 'geode', B = BREATH[to] ?? BREATH.geode, col = SPILL[to] ?? PALETTE[0];
      const X = D.right, Y = D.up, Z = D.n, at = D.at;
      const W = (l: ArrayLike<number>): V3 => [at[0] + X[0] * l[0] + Y[0] * l[1] + Z[0] * l[2], at[1] + X[1] * l[0] + Y[1] * l[1] + Z[1] * l[2], at[2] + X[2] * l[0] + Y[2] * l[1] + Z[2] * l[2]];
      // (the pair near: the door calls; a voyage's door most)
      const d = Math.hypot(pair[0] - at[0], pair[2] - at[2]), call = Math.max(smooth((9 - d) / 6), voyage === D.id ? 1 : 0);
      const I = this.gain * (0.55 + 0.45 * call);
      // the spill on the floor in front of it: a pool by the glass and a fainter one further out, breathing slowly
      const breathe = 0.85 + 0.15 * Math.sin(this.t * 1.3 + at[0]);
      for (const [o, r, k] of [[1.1, 1.5, 0.5], [2.6, 2.6, 0.22]] as const) {
        const p = W([0, 0, o]), g = this.ground(p[0], p[2]);
        // (on the floor, or on the water over it where the door stands in water: the disc's foot)
        glows.flat([p[0], Math.max(g, at[1] - 1.35) + 0.03, p[2]], r, col, k * I * breathe, 'soft');
      }
      // a soft halo in the air just out of the glass, the far world's light in this one's air
      glows.dot(W([0, 0, 0.5]), D.r * 1.1, col, 0.1 * I * breathe);
      // a soft shaft of its light rising over the door, seen from across the arena (where the next world is, before its
      // glass is in reach), fading upward
      const top = W([0, D.r + 0.6, 0.3]);
      for (let j = 0; j < 4; j++) {
        const a: V3 = [top[0], top[1] + j * 1.4, top[2]], b: V3 = [top[0], top[1] + (j + 1) * 1.4, top[2]];
        glows.seg(a, b, 0.32 + 0.12 * j, col, 0.16 * I * breathe * (1 - j / 4.5) * near(a));
      }
      // the far world's air drifting out
      let ms = this.motes.get(D.id);
      if (!ms) { ms = []; this.motes.set(D.id, ms); }
      const want = 26;
      while (ms.length < want) ms.push({ s: ++this.n * 7.31, age: -rnd(this.n) * 6, life: 4.5 + rnd(this.n + 0.5) * 3 });
      for (const m of ms) {
        m.age += dt;
        if (m.age > m.life) { m.s = ++this.n * 7.31; m.age = 0; m.life = 4.5 + rnd(m.s) * 3; }
        if (m.age < 0) continue;
        const u = m.age / m.life, s = m.s;
        // (out of the glass across its face, out along its axis up to 5 m, wandering, rising or settling, and curling
        // back toward the door as it fades)
        const a0 = rnd(s) * 6.28, r0 = Math.sqrt(rnd(s + 1)) * D.r * 0.85;
        const out = (0.3 + 4.6 * rnd(s + 2)) * smooth(u * 1.6) * (1 - 0.35 * u * u);
        const wx = Math.sin(this.t * (0.6 + rnd(s + 3)) + s) * B.wander * (0.3 + u), wy = Math.cos(this.t * (0.5 + rnd(s + 4)) + s * 1.7) * B.wander * 0.5;
        const l: V3 = [Math.cos(a0) * r0 * (1 + 0.8 * u) + wx, Math.sin(a0) * r0 + B.rise * m.age + wy, out];
        const p = W(l);
        const g = this.ground(p[0], p[2]);
        if (p[1] < g + 0.08) p[1] = g + 0.08;
        const blink = B.blink ? 1 - B.blink * (0.5 + 0.5 * Math.sin(this.t * (2 + 3 * rnd(s + 5)) + s * 3)) : 1;
        // (a mote stays a few pixels across however far off: bigger with the eye's distance)
        const far = eye ? Math.max(1, Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) / 6) : 1;
        const k = smooth(u / 0.12) * (1 - smooth((u - 0.7) / 0.3)) * blink * near(p) * I;
        if (k < 0.01) continue;
        const c = B.cols[Math.floor(rnd(s + 6) * B.cols.length)];
        if (B.petal && rnd(s + 7) < 0.6) {
          const ang = this.t * (1 + 2 * rnd(s + 8)) + s, L = B.size * 2.2;
          glows.petal(p, [p[0] + Math.cos(ang) * L * far, p[1] + Math.sin(ang) * L * far, p[2] + Math.sin(ang * 0.7) * L * far * 0.5], B.size * far, c, 0.8 * k);
        } else glows.dot(p, B.size * far * (B.shape === 'spark' ? 1 : 1.4), c, 1.3 * k, B.shape);
      }
    }
    // (doors no longer here: their motes go)
    if (this.motes.size > doors.length + 4) for (const id of [...this.motes.keys()]) if (!doors.some((d) => d.id === id)) this.motes.delete(id);
  }
}
