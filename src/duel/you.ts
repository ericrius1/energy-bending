// Which one is me (report 18-you; the owner: "took me a bit to figure out which character i was controlling"). Before,
// everything that told the bodies apart was symmetric: each wore its seat's colour (seat.ts), each had a "P1" or "P2"
// tag, each a panel, and the camera stood a little behind seat 1 whoever played it. Nothing said which seat was the
// player's, so the first seconds were a guess. This says it, from the first second and all through play, on the page's
// own seats only (`seats`: a local duel's human seats, both of them for two at one screen; online, this page's seat;
// none in a film or for a watcher):
//   the opening   as a set begins (a few seconds, the count-in and a breath of play; shorter on later sets): a shaft of
//                 soft sunlight on your body, a sunlit disc at your feet, a ring of your colour rising up you on each
//                 count, your marker large; the HUD's tag reads YOU (or, two at one screen, P1 · W A S D: each seat's
//                 device) large and lit, and your panel lights in your colour; the camera stands a little more behind you
//   the answer    your first press after a set begins: a ring of your colour opens on the floor round you and rises, the
//                 marker flashes, the panel and the tag pulse
//   all through   a small marker over your head (a petal of your colour standing on its point, a gold heart at the
//                 point, held at a steady size on screen) and a soft ring of your colour round your feet; the tag YOU;
//                 your panel's rim in your colour. Nothing on the other body (its tag dims a little)
// The world's part is drawn after the moments' light, outside the ranges `keepOff` dims (fx.ts), so it never fights the
// bloom or a catch's frames; it fades in the finale's duet (the bloom is both of yours). Pure (glows are a list): you.test.ts.
import type { Glows, RGB } from '../play/glow';
import { seatRGB, SEAT_NAME } from './seat';

type V3 = [number, number, number];

export const YOU = {
  /** the opening's length (s from the set's start: the count-in is about 2 s), the later sets' */
  intro: 4.5, introLater: 2.2,
  /** the marker over the head: its foot this far over the head's top (m at the reference distance), its height and
   *  half width (m), how bright; in the opening this much larger; the reference distance (m) its sizes are for: nearer
   *  or further, it keeps its size on screen (within `scale`) */
  marker: { over: 0.2, len: 0.24, w: 0.085, I: 1.15, intro: 1.9, ref: 9, scale: [0.75, 1.6] as [number, number] },
  /** the ring round the feet: radius, its strength, in the opening */
  ring: { R: 0.48, I: 0.68, intro: 1.05 },
  /** the opening's shaft of sunlight on the body (strength), and the disc at the feet */
  shaft: 0.24, disc: 0.5,
  /** the first press's answer (s), and the camera's extra turn behind you in the opening (rad) */
  pulse: 0.9, favour: 0.2,
};
/** sunlight, as the moments use it (fx.ts SUNLIT_RGB.glint and pollen) */
const SUN: RGB = [1.85, 1.6, 1.1], GOLD: RGB = [1.75, 1.32, 0.48];

/** what the tell reads of the duel each frame */
export interface YouCtx {
  glows: Glows;
  /** the head's top, the root (the feet) and the ground's height under it; null: no body */
  head(k: number): V3 | null;
  root(k: number): V3;
  ground(x: number, z: number): number;
  eye(): V3 | null;
  /** this frame the seat's own device (or online, what this page sent) pressed something */
  pressed(k: number): boolean;
  /** 0 … 1: away (held in the finale's duet): the tell fades. (A body reforming keeps it: the marker shows where you
   *  come back, and a set's count-in is a reform) */
  away(k: number): number;
  /** the seat's device ('keyboard-left', 'gamepad-0', …), for two at one screen */
  device(k: number): string | null;
  /** optional facing yaw (rad, forward = (sin yaw, cos yaw)): draws a crisp forward compass chevron on your foot ring */
  yaw?(k: number): number;
}

/** the HUD's part of a seat that is yours (HudPlayer.you) */
export interface YouHud { label: string; sub?: string; intro: number; pulse: number }

/** a device's name as a player knows it */
export function deviceLabel(name: string | null): string | null {
  if (!name) return null;
  if (name === 'keyboard-left') return 'W A S D';
  if (name === 'keyboard-right') return 'ARROWS';
  if (name.startsWith('keyboard')) return 'KEYS';
  if (name.startsWith('gamepad')) return 'PAD';
  if (name.startsWith('touch')) return 'TOUCH';
  return null;
}

/** whose seats are the page's own: a local duel's human seats that no virtual player took, or online this page's seat */
export function ownSeats(o: { online: boolean; netSeat: number | null | undefined; human: readonly number[]; bot: (k: number) => boolean; film: boolean }): number[] {
  if (o.film) return [];
  if (o.online) return o.netSeat == null ? [] : [o.netSeat];
  return o.human.filter((k) => !o.bot(k));
}

const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

export class YouTell {
  /** the page's own seats (null: as `auto` finds them) */
  seats: number[] | null = null;
  /** draw it at all (a capture's comparison) */
  show = true;
  /** seconds since the set began, and the opening's length this set */
  private since = Infinity;
  private len = YOU.intro;
  private sets = 0;
  /** per seat: the first press's answer under way (s since it, Infinity: none), and whether it came this set */
  private pulseAge = [Infinity, Infinity];
  private answered = [false, false];
  /** the count's beats (s since each: a ring rises) */
  private counts: number[] = [];
  /** the tell's strength per seat (eased: away fades it) */
  private on = [0, 0];

  constructor(private ctx: YouCtx, private auto: () => number[]) {}

  /** the page's own seats now */
  own(): number[] { return this.show ? (this.seats ?? this.auto()) : []; }
  mine(k: number) { return this.own().includes(k); }

  /** a set's count-in began */
  set() {
    this.since = 0; this.len = this.sets++ ? YOU.introLater : YOU.intro;
    this.answered = [false, false]; this.counts = [];
  }
  /** a count of the count-in */
  count() { this.counts.push(0); }

  /** 0 … 1: the opening now (up quickly, held, eased out) */
  intro() {
    const t = this.since, L = this.len;
    if (!(t < L)) return 0;
    return smooth(t / 0.25) * (1 - smooth((t - (L - 1.2)) / 1.2));
  }
  /** 0 … 1: seat k's first press's answer now */
  pulse(k: number) { const a = this.pulseAge[k]; return a < YOU.pulse ? 1 - a / YOU.pulse : 0; }

  /** the seat the camera favours (stands a little behind) and how much more than its usual turn (rad), or null: seat 1
   *  as before (two at one screen, a watcher) */
  favour(): { seat: number; turn: number } | null {
    const s = this.own();
    return s.length === 1 ? { seat: s[0], turn: YOU.favour * this.intro() } : null;
  }

  /** the HUD's part for seat k, or undefined when it isn't yours */
  hud(k: number): YouHud | undefined {
    const s = this.own();
    if (!s.includes(k)) return undefined;
    const two = s.length > 1, dev = deviceLabel(this.ctx.device(k));
    return two
      ? { label: `P${k + 1}`, sub: dev ?? SEAT_NAME[k].toUpperCase(), intro: this.intro(), pulse: this.pulse(k) }
      : { label: 'YOU', sub: SEAT_NAME[k].toUpperCase(), intro: this.intro(), pulse: this.pulse(k) };
  }

  /** each frame (real seconds), after the moments' light is drawn */
  update(dt: number) {
    this.since += dt;
    for (let i = 0; i < this.counts.length; i++) this.counts[i] += dt;
    this.counts = this.counts.filter((a) => a < 1.1);
    const own = this.own(), G = this.ctx.glows, I0 = this.intro();
    for (let k = 0; k < 2; k++) {
      this.pulseAge[k] += dt;
      const mine = own.includes(k);
      // (the first press after the set began, in the opening or after it)
      if (mine && !this.answered[k] && this.since < 60 && this.ctx.pressed(k)) { this.answered[k] = true; this.pulseAge[k] = 0; }
      this.on[k] += ((mine ? 1 - this.ctx.away(k) : 0) - this.on[k]) * (1 - Math.exp(-dt * 8));
      if (!this.show || this.on[k] < 0.01) continue;
      const head = this.ctx.head(k);
      if (!head) continue;
      const on = this.on[k], col = seatRGB(k), P = this.pulse(k), root = this.ctx.root(k);
      const gy = this.ctx.ground(root[0], root[2]), foot: V3 = [root[0], (Number.isFinite(gy) ? Math.min(root[1], gy) : root[1]) + 0.03, root[2]];
      // (sizes kept on screen: a marker at 15 m is as big as at 9)
      const eye = this.ctx.eye(), dist = eye ? Math.hypot(head[0] - eye[0], head[1] - eye[1], head[2] - eye[2]) : YOU.marker.ref;
      const sc = Math.max(YOU.marker.scale[0], Math.min(YOU.marker.scale[1], dist / YOU.marker.ref));
      // the marker over the head: a petal of the seat's colour standing on its point, a gold heart at the point
      const M = YOU.marker, big = 1 + (M.intro - 1) * I0 + 0.5 * P * P, bob = I0 > 0 ? 0.03 * Math.sin(this.since * 2.4) * I0 : 0;
      const a: V3 = [head[0], head[1] + (M.over + bob) * sc * (0.6 + 0.4 * big), head[2]];
      const b: V3 = [a[0], a[1] + M.len * sc * big, a[2]];
      G.petal(a, b, M.w * sc * big, col, M.I * on * (1 + 0.8 * P));
      // (and a faint soft light behind it, so it reads over a busy ground)
      G.dot([a[0], (a[1] + b[1]) / 2, a[2]], M.len * sc * big * 0.75, col, 0.16 * on * (1 + I0), 'soft');
      // the ring round the feet (bright, unmistakable steady-state beacon + gold inner rim + forward facing chevron)
      const R = YOU.ring;
      G.flat(foot, R.R, col, (R.I + (R.intro - R.I) * I0) * on, 'ring');
      G.flat(foot, R.R * 0.78, GOLD, (0.34 + 0.35 * I0) * on, 'ring');
      if (this.ctx.yaw) {
        const yw = this.ctx.yaw(k), fx = Math.sin(yw), fz = Math.cos(yw), rx = Math.cos(yw), rz = -Math.sin(yw);
        const tipR = R.R + 0.24, baseR = R.R + 0.04, wing = 0.14;
        const tip: V3 = [foot[0] + fx * tipR, foot[1] + 0.015, foot[2] + fz * tipR];
        const lft: V3 = [foot[0] + fx * baseR - rx * wing, foot[1] + 0.015, foot[2] + fz * baseR - rz * wing];
        const rgt: V3 = [foot[0] + fx * baseR + rx * wing, foot[1] + 0.015, foot[2] + fz * baseR + rz * wing];
        G.seg(lft, tip, 0.022, GOLD, (0.95 + 0.4 * I0) * on, 'soft');
        G.seg(rgt, tip, 0.022, GOLD, (0.95 + 0.4 * I0) * on, 'soft');
      }
      if (P > 0) {
        const u = 1 - P;
        G.flat(foot, R.R + 1.1 * smooth(u), col, 1.3 * P * on, 'ring');
        G.flat([foot[0], foot[1] + 1.9 * smooth(u), foot[2]], 0.42 - 0.12 * u, col, 1.1 * Math.sin(Math.PI * Math.min(1, u * 1.2)) * on, 'ring');
      }
      if (I0 > 0.01) {
        // the opening: a shaft of soft sunlight on the body, a sunlit disc at the feet, a ring rising on each count
        const top: V3 = [head[0], head[1] + 0.25, head[2]];
        G.seg([foot[0], foot[1] + 0.2, foot[2]], top, 0.5, SUN, YOU.shaft * I0 * on, 'soft');
        G.flat(foot, 0.62, GOLD, YOU.disc * I0 * on, 'soft');
        for (const c of this.counts) {
          const u = c / 1.1;
          G.flat([foot[0], foot[1] + smooth(u) * (head[1] - foot[1] + 0.2), foot[2]], 0.5 - 0.15 * u, col, 1.0 * Math.sin(Math.PI * u) * on, 'ring');
        }
      }
    }
  }
}
