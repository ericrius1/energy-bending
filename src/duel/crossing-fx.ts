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
