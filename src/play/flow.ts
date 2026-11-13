// The session's flow as the dancers live it, from the rules' phases (shared/rules.ts):
//   waiting  a soft ring breathes at the feet of whoever is here (online: until the other seat comes)
//   intro    the dancers re-form at their spawns on the stage (matter rising into them), and the last bar before play
//            counts in on the beat: four ticks, four pulses of light in the middle
//   play     (the jogo)
//   fusion, release   (fusion.ts)
//   finale   its sound once; the last fusion if the tension is high (the rules decide)
//   over     the results, with no text: the shared axé is a count of gems raining into a ring round the dancers, each
//            fusion a larger gem among them, the best streak a ribbon of light winding round the ring. Both pressing
//            ready (jump, strike or kick) starts again: each ready dancer's ring lights
import type { Character } from '../dancer/character';
import { barMs } from '../../shared/rules.ts';
import type { PublicState, Results } from '../../shared/protocol.ts';
import type { JogoEvent, SeatBody } from './jogo';
import type { Glows, RGB } from './glow';
import { COLOURS } from './feel';

type V3 = [number, number, number];

export interface FlowCtx {
  glows: Glows;
  sfx?: (name: string, o: Record<string, unknown>) => void;
  now(): number;
  /** the matter rises into the bodies (show.rise) */
  rise?: (spread: number) => void;
  /** a local seat's body re-forms at its spawn */
  respawn(seat: number, c: Character): void;
  /** the stage the jogo is locked to: the results' ring lies along it (flattened across it, so the side view holds it) */
  plane?(): { right: [number, number, number] } | null;
}

/** how many gems the results rain for an axé (a gem per 40, at least 6, at most 140) */
export const gemsFor = (axe: number) => Math.max(6, Math.min(140, Math.round(axe / 40)));

const GEM_COLS: RGB[] = [[1.3, 0.55, 1.5], [0.5, 0.9, 1.6], [1.6, 0.75, 0.4], [0.6, 1.5, 0.9], [1.5, 1.3, 0.6]];
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

export class Flow {
  private counted = new Set<number>();
  private results: { r: Results; at: number; centre: V3 } | null = null;
  private t = 0;

  constructor(private bodies: readonly SeatBody[], private ctx: FlowCtx) {}

  update(dt: number, st: PublicState | null, events: readonly JogoEvent[]) {
    this.t += dt;
    const now = this.ctx.now(), G = this.ctx.glows;
    for (const e of events) {
      if (e.k !== 'phase') continue;
      if (e.phase === 'intro') {
        this.counted.clear();
        this.results = null;
        for (let s = 0; s < 2; s++) { const c = this.bodies[s]?.character; if (c) this.ctx.respawn(s, c); }
        this.ctx.rise?.(2.2);
      } else if (e.phase === 'finale') this.ctx.sfx?.('finale', {});
      else if (e.phase === 'over' && st?.results) {
        this.results = { r: st.results, at: this.t, centre: this.centre() };
        this.ctx.sfx?.('results', { count: gemsFor(st.results.axe) });
      } else if (e.phase === 'waiting' || e.phase === 'play') this.results = null;
    }
    if (!st) return;
    // waiting: a ring breathes at each dancer's feet
    if (st.phase === 'waiting') {
      for (let s = 0; s < 2; s++) {
        const b = this.bodies[s];
        if (!b || !(st.slots[s]?.present ?? s === 0)) continue;
        const r = b.root();
        G.flat([r[0], r[1] + 0.01, r[2]], 0.5, COLOURS[b.element()], 0.35 + 0.25 * Math.sin(this.t * 2), 'ring');
      }
    }
    // the count-in: the last bar of the intro, a tick and a pulse on each beat
    if (st.phase === 'intro' && st.tEnd != null) {
      const beatLen = barMs(st.music) / 4, left = st.tEnd - now;
      const n = Math.ceil(left / beatLen - 1e-6);
      if (n >= 1 && n <= 4 && !this.counted.has(n)) { this.counted.add(n); this.ctx.sfx?.('count', { count: n, final: n === 1 }); }
      if (n >= 1 && n <= 4) {
        const c = this.centre(), u = 1 - (left / beatLen - (n - 1));
        G.flat([c[0], c[1] - 1.05, c[2]], 0.25 + u * (0.8 + (4 - n) * 0.3), [1.5, 1.35, 1.0], 1.4 * (1 - u) * (1 - u), 'ring');
        for (let k = 0; k < 5 - n; k++) G.dot([c[0] + (k - (4 - n) / 2) * 0.12, c[1] + 0.9, c[2]], 0.025, [1.5, 1.35, 1.0], 1.2, 'gem');
      }
    }
    if (st.phase === 'over' && this.results) this.drawResults(this.results);
  }

  private centre(): V3 {
    const a = this.bodies[0]?.chest(), b = this.bodies[1]?.chest();
    if (a && b) return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    return a ?? b ?? [0, 1, 0];
  }

  /** gems falling into a ring and staying there, twinkling; fusions as larger gems; the best streak as a ribbon */
  private drawResults(R: { r: Results; at: number; centre: V3 }) {
    const G = this.ctx.glows, age = this.t - R.at, C = R.centre, floor = C[1] - 1.05;
    const n = gemsFor(R.r.axe), big = Math.min(8, R.r.fusions), ring = 1.5;
    // round the ring: along the stage, and a third as deep across it
    const rt = this.ctx.plane?.()?.right ?? [1, 0, 0], nt = [-rt[2], 0, rt[0]];
    const round = (ang: number, r: number, y: number): V3 => [C[0] + (rt[0] * Math.cos(ang) + nt[0] * Math.sin(ang) * 0.35) * r, y, C[2] + (rt[2] * Math.cos(ang) + nt[2] * Math.sin(ang) * 0.35) * r];
    const total = n + big;
    for (let i = 0; i < total; i++) {
      const isBig = i >= n, k = isBig ? i - n : i;
      // where it lands: round the ring, the big ones at even places among the small
      const ang = isBig ? (k / Math.max(1, big)) * Math.PI * 2 + 0.3 : (i / n) * Math.PI * 2 * 2.618;
      const rr = ring + (isBig ? 0 : (hash(i) - 0.5) * 0.35);
      const delay = isBig ? 2.6 + k * 0.4 : (i / n) * 3.2, fall = 0.9;
      const u = (age - delay) / fall;
      if (u < 0) continue;
      const land = Math.min(1, u);
      const y = floor + 0.06 + (1 - land * land) * 4.5 + (land >= 1 ? 0.03 * Math.sin(this.t * 2 + i) : 0);
      const s = (isBig ? 0.08 : 0.06) * (1 + 0.5 * Math.exp(-(u - 1) * 6) * (u >= 1 ? 1 : 0));
      const col = isBig ? [1.6, 1.4, 0.9] as RGB : GEM_COLS[i % GEM_COLS.length];
      const tw = land >= 1 ? 0.75 + 0.35 * Math.sin(this.t * (3 + hash(i * 3) * 4) + i) : 1;
      const p: V3 = round(ang, rr, y);
      G.seg([p[0], p[1] - s * 0.5, p[2]], [p[0], p[1] + s * 0.5, p[2]], s * 0.6, col, (isBig ? 0.85 : 1.1) * tw, 'gem');
      if (u < 1) G.seg([p[0], p[1] + s, p[2]], [p[0], p[1] + s + 0.35, p[2]], s * 0.25, col, 0.3, 'soft');
      else if (u < 1.3) G.flat([p[0], floor + 0.01, p[2]], 0.05 + (u - 1) * 0.8, col, 1.2 * (1.3 - u) / 0.3, 'ring');
    }
    // the best streak: a ribbon winding up round the ring, as many turns' worth as the streak was long
    const L = smooth((age - 1.2) / 2.5) * Math.min(1, R.r.bestStreak / 16);
    const turns = 1.5, steps = 90;
    let prev: V3 | null = null;
    for (let i = 0; i <= steps * L; i++) {
      const u = i / steps, ang = u * Math.PI * 2 * turns - Math.PI / 2;
      const p: V3 = round(ang, ring + 0.3, floor + 0.15 + u * 1.6);
      if (prev) G.seg(prev, p, 0.01, [1.5, 1.3, 0.8], 0.55, 'soft');
      prev = p;
    }
  }
}

const hash = (n: number) => { const x = Math.sin(n * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };
