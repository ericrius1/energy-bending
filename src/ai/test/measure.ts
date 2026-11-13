// What a simulated jogo is judged by, measured along the way (for the tests, the probe and the report): the
// referee's numbers, plus the share of tension from exchanges against echoes, the levels danced and the inversions,
// how far the pair turned about each other (free) or how often they changed sides (locked), the longest stall, and
// whether anyone left the stage or the world.
import type { StagePlane } from '../../engine/camera';
import { simulate, swell, type SimOptions } from '../sim';
import { levelOf, inverted } from '../vocabulary';

const n = (r: Record<string, number>, k: string) => r[k] ?? 0;

export interface Session {
  fusions: number;
  xch: Record<string, number>;
  /** tension earned from exchanges, echoes, unisons (nominal) and the exchanges' share */
  tension: { xch: number; echo: number; unison: number; xchShare: number };
  echoes: number;
  unisons: number;
  onBeat: number;
  distinct: number;
  distinctEach: [number, number];
  moves: number;
  inversionsPerMin: number;
  levels: Record<string, number>;
  /** free: the angle (rad) the line between them turned through in all, net, and the least in any 30 s of play */
  turned: { total: number; net: number; min30: number } | null;
  /** locked: how many times they changed sides */
  sides: number;
  stall: number;
  offStage: number;
  outOfWorld: number;
  minutes: number;
  names: [Record<string, number>, Record<string, number>];
}

/** run a session and measure it; `plane` null plays free on the floor (the room's radius is the world) */
export function measure(o: SimOptions & { stagePlane?: StagePlane | null }): Session {
  const music = o.music ?? swell, room = o.room ?? 7, plane = o.plane;
  let last = 0, gap = 0, off = 0, out = 0, side = 0, sides = 0;
  let prevA: number | null = null, total = 0, net = 0, t0 = -1;
  const win: [number, number][] = [];
  const r = simulate({
    ...o,
    each: (f) => {
      const [a, b] = f.bodies;
      const ph = f.ref.session.phase, m = music(f.t);
      for (const c of [a, b]) {
        if (plane && (Math.abs(c.s) > plane.halfWidth + 0.05 || c.y < -0.5 || c.reforming)) off++;
        if (!plane && (Math.hypot(c.x, c.z) > room || c.reforming)) out++;
      }
      const moved = [a, b].some((c) => c.move && c.move.t < 1 / 50);
      if (moved || ph === 'intro' || ph === 'waiting' || m.breakdown) last = f.t;
      gap = Math.max(gap, f.t - last);
      if (ph !== 'intro' && ph !== 'waiting') {
        if (t0 < 0) t0 = f.t;
        if (plane) {
          const sd = Math.sign(a.s - b.s);
          if (side && sd && sd !== side) sides++;
          if (sd) side = sd;
        } else {
          const ang = Math.atan2(b.z - a.z, b.x - a.x);
          if (prevA != null) {
            let d = ang - prevA;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            // (only the smooth turning of two bodies apart: one passing over or through the other flips the line by
            // half a turn in a few frames, which is a crossing, counted as a side change, not circling)
            if (Math.hypot(b.x - a.x, b.z - a.z) > 0.35 && Math.abs(d) < 0.05) { total += Math.abs(d); net += d; }
            else if (Math.abs(d) > 0.5) sides++;
          }
          prevA = ang;
          if (Math.floor((f.t - t0) / 30) >= win.length) win.push([total, f.t]);
        }
      }
      o.each?.(f);
    },
  });
  const S = r.stats, x: Record<string, number> = {};
  for (const k of ['dodge', 'clash', 'parry', 'near', 'hit']) x[k] = n(S.xch[0], k) + n(S.xch[1], k);
  const levels: Record<string, number> = { standing: 0, low: 0, inverted: 0 };
  let inv = 0;
  for (const nm of S.names) for (const [k, v] of Object.entries(nm)) { if (k === 'palmas') continue; levels[levelOf(k)] += v; if (inverted(k)) inv += v; }
  const minutes = (o.seconds - Math.max(0, t0)) / 60;
  let min30 = Infinity;
  for (let i = 0; i + 1 < win.length; i++) min30 = Math.min(min30, win[i + 1][0] - win[i][0]);
  const tf = S.tensionFrom, all = tf.xch + tf.echo + tf.unison;
  return {
    fusions: S.fusions, xch: x, tension: { ...tf, xchShare: all ? tf.xch / all : 0 }, echoes: S.echoes, unisons: S.unisons,
    onBeat: S.errors.filter((e) => e <= 55).length / Math.max(1, S.errors.length),
    distinct: new Set([...S.distinct[0], ...S.distinct[1]]).size, distinctEach: [S.distinct[0].size, S.distinct[1].size],
    moves: S.moves[0] + S.moves[1], inversionsPerMin: inv / Math.max(1e-6, minutes), levels,
    turned: plane ? null : { total, net, min30: Number.isFinite(min30) ? min30 : total },
    sides, stall: gap, offStage: off, outOfWorld: out, minutes, names: S.names,
  };
}

const deg = (r: number) => `${Math.round((r * 180) / Math.PI)}°`;
/** one line of a session */
export function line(s: Session) {
  const x = s.xch;
  return `fusions ${s.fusions}; dodge ${x.dodge} clash ${x.clash} parry ${x.parry} near ${x.near} hit ${x.hit}; `
    + `tension from exchanges ${(s.tension.xchShare * 100).toFixed(0)}% (xch ${s.tension.xch}, echo ${s.tension.echo}, unison ${s.tension.unison}); `
    + `on the 8ths ${(s.onBeat * 100).toFixed(0)}%; ${s.distinct} kinds (${s.distinctEach.join('/')}), ${s.moves} moves; `
    + `inversions ${s.inversionsPerMin.toFixed(1)}/min; levels standing ${s.levels.standing} low ${s.levels.low} inverted ${s.levels.inverted}; `
    + (s.turned ? `circled ${deg(s.turned.total)} (net ${deg(s.turned.net)}, least in any 30 s ${deg(s.turned.min30)}); ` : '') + `sides changed ${s.sides}; `
    + `longest stall ${s.stall.toFixed(1)} s; off the stage ${s.offStage}, out of the world ${s.outOfWorld} frames`;
}
