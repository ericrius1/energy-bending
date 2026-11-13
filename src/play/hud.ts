// The meters, in the world: nothing on the screen's edge, nothing written. Drawn as the jogo's glows each frame.
//   tension  a thread of light between the two dancers' chests, hanging slack when the jogo is calm. It fills from both
//            ends, each in its dancer's colour, as the shared tension rises; at the top the halves meet in the middle
//            and the thread becomes the invitation: drawn taut, light running along it from both ends to the middle on
//            every beat, brighter while either holds merge, white-gold when both do
//   streak   beads strung on the thread, one for each exchange in the streak; the newest flashes as it is added
//   flow     an arc of light on the floor round each dancer's feet, as much of the circle as its flow; past the form's
//            threshold it brightens, in form it is a full ring that breathes as the flow drains
//   timing   on every beat the feet's arcs pulse; a perfect move sends a gold ring out from the dancer's feet
// Bright in the locked side view, dimmed in the free view (out of the way), and gone during a fusion (the fusion's
// own light says it) and between worlds.
import { RULES } from '../../shared/rules.ts';
import type { PublicState } from '../../shared/protocol.ts';
import type { JogoEvent, SeatBody } from './jogo';
import type { Glows, RGB } from './glow';
import { COLOURS, mixRGB } from './feel';
import { jogoParams } from './params';

type V3 = [number, number, number];
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

export interface HudCtx {
  glows: Glows;
  /** 0 free … 1 locked (the rig's lock weight) */
  locked(): number;
  /** the music's beat now (fractional) */
  beat(): number;
  /** while true the meters stay away (a fusion holds the scene, a dancer is between worlds) */
  hidden(): number;
}

export class Hud {
  private tension = 0;
  private flow = [0, 0];
  private streakShown = 0;
  private beadFlash = -1;
  private pulses: { seat: number; t: number }[] = [];
  private t = 0;
  private merge = [0, 0];

  constructor(private bodies: readonly SeatBody[], private ctx: HudCtx) {}

  update(dt: number, st: PublicState | null, events: readonly JogoEvent[]) {
    this.t += dt;
    for (const e of events) if (e.k === 'move' && e.perfect) this.pulses.push({ seat: e.seat, t: this.t });
    this.pulses = this.pulses.filter((p) => this.t - p.t < 0.8);
    if (!st) return;
    const playing = st.phase === 'play' || st.phase === 'fusion' || st.phase === 'finale' || st.phase === 'release';
    const k = 1 - Math.exp(-dt * 4);
    this.tension += ((playing ? st.tension / RULES.TENSION_MAX : 0) - this.tension) * k;
    for (let i = 0; i < 2; i++) {
      this.flow[i] += (st.flow[i] / RULES.FLOW_MAX - this.flow[i]) * k;
      this.merge[i] += ((st.merge[i] ? 1 : 0) - this.merge[i]) * (1 - Math.exp(-dt * 8));
    }
    if (st.streak > this.streakShown) this.beadFlash = this.t;
    this.streakShown = st.streak;
    const gain = (jogoParams.hudFree + (jogoParams.hudLocked - jogoParams.hudFree) * this.ctx.locked()) * (1 - this.ctx.hidden());
    if (gain <= 0.01) return;
    const beat = this.ctx.beat(), phase = ((beat % 1) + 1) % 1, pulse = Math.exp(-phase * 5);
    for (let s = 0; s < 2; s++) this.feet(s, st, gain, pulse);
    if (playing || st.phase === 'intro') this.thread(st, gain, beat);
  }

  /** the flow's arc round a dancer's feet, its beat pulse, a perfect move's ring */
  private feet(s: number, st: PublicState, gain: number, pulse: number) {
    const b = this.bodies[s];
    if (!b) return;
    const r = b.root(), G = this.ctx.glows, col = COLOURS[b.element()];
    const p: V3 = [r[0], r[1] + 0.01, r[2]];
    const f = this.flow[s], ready = f * RULES.FLOW_MAX >= RULES.FORM_ENTER, inForm = !!st.form[s as 0 | 1];
    const R = 0.42, bright = (ready ? 1 : 0.55) * (0.75 + 0.5 * pulse) * gain;
    // the circle's ghost, then the arc of the flow from the front, both ways round
    G.flat(p, R, col, 0.12 * gain, 'ring');
    if (inForm) G.flat(p, R, col, (0.8 + 0.4 * Math.sin(this.t * 5)) * gain * Math.max(0.3, f), 'ring');
    else if (f > 0.005) {
      const half = Math.PI * Math.min(1, f);
      G.arc(p, R, -Math.PI / 2 - half, -Math.PI / 2 + half, 0.016, col, bright, 40);
    }
    if (st.phase === 'over' && st.ready[s as 0 | 1]) G.flat(p, R * 1.25, [1.5, 1.35, 0.9], 0.9 * gain, 'ring');
    for (const q of this.pulses) if (q.seat === s) {
      const u = (this.t - q.t) / 0.8;
      G.flat(p, R + u * 0.55, [1.6, 1.3, 0.6], 0.7 * (1 - u) * (1 - u) * gain, 'ring');
    }
  }

  /** the thread between them: tension, the streak's beads, the invitation */
  private thread(st: PublicState, gain: number, beat: number) {
    const A = this.bodies[0], B = this.bodies[1];
    if (!A || !B) return;
    const a = A.chest(), b = B.chest(), G = this.ctx.glows;
    const T = this.tension, inv = st.mergeReady ? 1 : 0, both = this.merge[0] * this.merge[1], either = Math.max(this.merge[0], this.merge[1]);
    const cA = COLOURS[A.element()], cB = COLOURS[B.element()];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (d < 0.05) return;
    // slack when calm, taut at the top
    const sag = (0.06 + 0.22 * (1 - T)) * Math.min(1.5, d) * (1 - 0.8 * inv);
    const at = (u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - sag * 4 * u * (1 - u), a[2] + (b[2] - a[2]) * u];
    const N = 40, fillA = T / 2, fillB = 1 - T / 2;
    const gold: RGB = [1.6, 1.4, 0.85];
    let prev = at(0);
    for (let i = 1; i <= N; i++) {
      const u = i / N, p = at(u), m = (i - 0.5) / N;
      const filled = m <= fillA || m >= fillB;
      let col = m < 0.5 ? cA : cB, I = filled ? 0.55 + 0.6 * T : 0.06;
      if (inv) {
        // light running from both ends to the middle on each beat
        const run = (beat % 1), w = Math.abs(m - 0.5) * 2, hit = Math.exp(-Math.pow((1 - w - run) * 7, 2));
        I = 0.6 + 0.9 * hit + 0.5 * either;
        col = mixRGB(m < 0.5 ? cA : cB, gold, 0.25 + 0.75 * both);
      }
      G.seg(prev, p, 0.008 + 0.006 * T + 0.01 * inv, col, I * gain, 'soft');
      prev = p;
    }
    // the streak's beads on it, spread from the middle out
    const n = Math.min(12, st.streak);
    for (let i = 0; i < n; i++) {
      const u = 0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.06 + (i === 0 ? 0 : 0);
      const flash = i === n - 1 ? Math.exp(-(this.t - this.beadFlash) * 3) : 0;
      const p = at(Math.min(0.9, Math.max(0.1, u)));
      G.dot(p, 0.022 + 0.02 * flash, mixRGB(gold, [1.6, 1.6, 1.6], flash), (0.9 + 2 * flash) * gain, 'gem');
    }
    void smooth;
  }
}
