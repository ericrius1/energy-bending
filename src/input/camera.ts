// The camera body as an Intent source: the player's real limbs (Intent.limbs, worn by the dancer directly) and
// gestures for everything else. Ported from the prototype's input.js CameraSource. It reads a BodyTracker
// (input/tracker.ts); input/webcam.ts runs the models. All thresholds are in torso lengths, so they don't depend on how
// far the player stands from the camera.
//   move     the shoulders' middle off a slowly adapting neutral (adapts in 2 s inside the dead zone, 10 s outside);
//            on above 0.3 torso, off below 0.18, full speed at 0.7.
//   crouch   the hips dropped below a slow standing height: on 0.35, off 0.2 → moveY -1.
//   duck     the hips dropping fast (> 1.4 torso/s) through 0.25 → dodge (with crouch: esquiva).
//   jump     the hips rising > 0.3 torso at > 1.5 torso/s, OR a pinch of the jump hand (held = jumpHeld).
//   form     a pinch of the other hand.        merge   both wrists above the head and close together (0.25 s).
//   spin     the shoulder line foreshortens below 0.55 of its usual width and recovers above 0.8 within 0.9 s.
//   punch / kick  limb-speed peaks (wrist > 2.2 figure units/s while extended; ankle > 1.8 while lifted; the bending
//            hand needs 3.0 so playing the melody does not punch; both hands fast together is a gesture, never a
//            punch) → Intent.limb names the limb.
//   aim      the bending hand from its shoulder (aimActive while seen).
// The pinch: thumb to index over the hand's size. From the pose model's hand points (17-22, near the knuckles, not the
// fingertips) it behaves like "close the hand": on below 0.38, off above 0.6, held 2 frames, its confidence the
// points' visibility times how decisive the ratio is. With the hand model's fingertips (`fine` hands, loaded on a
// device that isn't coarse) it is a real thumb-to-index pinch: on below 0.22, off above 0.36.
import { Hysteresis, PeakDetector, makeIntent, type Intent, type IntentSource, type InputMode, type Limb, type PinchState } from './intent';
import type { HandPoints, BodyMeasures } from './tracker';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** what CameraSource reads (a BodyTracker, or a test's fake) */
export interface TrackerLike {
  visible: boolean;
  frame: number;
  frameDt?: number;
  hasLegs: boolean;
  /** 13 × 2 in the prototype's figure units, mirror view, floor at 0 */
  pose: Float32Array | null;
  limbs?: Float32Array | null;
  body: BodyMeasures | null;
  hands: { L: HandPoints | null; R: HandPoints | null };
}

const J2 = { HEAD: 0, LS: 1, RS: 2, LE: 3, RE: 4, LW: 5, RW: 6, LH: 7, RH: 8, LK: 9, RK: 10, LA: 11, RA: 12 } as const;
type JN = keyof typeof J2;

export class CameraSource implements IntentSource {
  readonly name = 'camera';
  mode: InputMode = 'locked';
  readonly aimHand: 'L' | 'R';
  readonly jumpHand: 'L' | 'R';
  pinch!: { L: PinchState & { n: number }; R: PinchState & { n: number } };
  debug: Record<string, unknown> = {};
  private nx: number | null = null;
  private lean = new Hysteresis(0.3, 0.18);
  private crouch = new Hysteresis(0.35, 0.2);
  private hipN: number | null = null;
  private prev: Float32Array | null = null;
  private vel = new Float32Array(26);
  private lastFrame = -1;
  private hipV = 0;
  private prevHip: number | null = null;
  private jumpCool = 0; private duckCool = 0; private duckArmed = true; private jumpHoldT = 0; private bothT = 0;
  private peaks!: Record<Limb, PeakDetector>;
  private mergeT = 0;
  private shWRef: number | null = null;
  private twist = { armed: false, t: 0 };

  constructor(public tracker: TrackerLike | null, opts: { aimHand?: 'L' | 'R'; jumpHand?: 'L' | 'R' } = {}) {
    this.aimHand = opts.aimHand === 'L' ? 'L' : 'R';
    this.jumpHand = opts.jumpHand ? opts.jumpHand : this.aimHand === 'R' ? 'L' : 'R';
    this.reset();
  }
  reset() {
    this.nx = null; this.lean = new Hysteresis(0.3, 0.18); this.crouch = new Hysteresis(0.35, 0.2);
    this.hipN = null; this.prev = null; this.vel = new Float32Array(26); this.lastFrame = -1; this.hipV = 0; this.prevHip = null;
    this.jumpCool = 0; this.duckCool = 0; this.duckArmed = true; this.jumpHoldT = 0; this.bothT = 0;
    this.peaks = { LW: new PeakDetector(2.2, 0.5, 0.35), RW: new PeakDetector(2.2, 0.5, 0.35), LA: new PeakDetector(1.8, 0.5, 0.4), RA: new PeakDetector(1.8, 0.5, 0.4) };
    this.peaks[(this.aimHand + 'W') as Limb].min = 3.0;
    this.pinch = { L: { on: false, ratio: 1, conf: 0, n: 0 }, R: { on: false, ratio: 1, conf: 0, n: 0 } };
    this.mergeT = 0; this.shWRef = null; this.twist = { armed: false, t: 0 };
    this.debug = {};
  }
  private pinchStep(side: 'L' | 'R', hand: HandPoints | null, dt: number): 'down' | 'up' | null {
    const P = this.pinch[side];
    if (!hand || !hand.thumb || !hand.index) { P.n = 0; P.on = false; P.conf = 0; return null; }
    const d = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const size = Math.max(d(hand.wrist, hand.index), d(hand.wrist, hand.pinky || hand.index), 1e-4);
    const ratio = d(hand.thumb, hand.index) / size;
    P.ratio = ratio;
    P.fine = !!hand.fine;
    const [onAt, offAt] = hand.fine ? [0.22, 0.36] : [0.38, 0.6];
    const vis = clamp(hand.vis ?? 1, 0, 1);
    const decisive = ratio < onAt ? clamp((onAt - ratio) / 0.2 + 0.5, 0, 1) : ratio > offAt ? clamp((ratio - offAt) / 0.3 + 0.5, 0, 1) : 0.3;
    P.conf += (vis * decisive - P.conf) * (1 - Math.exp(-dt * 10));
    const want = vis > 0.5 ? (P.on ? ratio < offAt : ratio < onAt) : false;
    if (want !== P.on) { P.n++; if (P.n >= 2) { P.on = want; P.n = 0; return want ? 'down' : 'up'; } }
    else P.n = 0;
    return null;
  }

  update(dt = 1 / 60): Intent {
    const o = makeIntent(); o.source = this.name;
    const tr = this.tracker;
    if (!tr || !tr.visible || !tr.pose) { this.prev = null; return o; }
    const P = tr.pose, B = tr.body;
    o.limbs = tr.limbs ?? null; o.hasLegs = !!tr.hasLegs;
    const fresh = tr.frame !== this.lastFrame;
    const fdt = fresh && this.lastFrame >= 0 ? tr.frameDt || dt : dt;
    this.lastFrame = tr.frame;
    const px = (j: JN) => P[2 * J2[j]], py = (j: JN) => P[2 * J2[j] + 1];
    // per-joint velocity (figure units / s), only on fresh frames
    if (fresh) {
      if (this.prev) for (let i = 0; i < 26; i++) this.vel[i] += ((P[i] - this.prev[i]) / Math.max(fdt, 1e-3) - this.vel[i]) * 0.6;
      this.prev = Float32Array.from(P);
    }
    const sp = (j: JN) => Math.hypot(this.vel[2 * J2[j]], this.vel[2 * J2[j] + 1]);
    // ----- body-relative measures from the raw tracker body
    const torso = (B && B.torso) || 0.2;
    const shX = B ? B.shX : (px('LS') + px('RS')) / 2, hipY = B ? B.hipY : (py('LH') + py('RH')) / 2;
    const shW = B ? B.shW : Math.hypot(px('LS') - px('RS'), py('LS') - py('RS'));
    if (this.nx == null) this.nx = shX;
    const off = (shX - this.nx) / torso;
    const inDZ = Math.abs(off) < 0.18;
    this.nx += (shX - this.nx) * (1 - Math.exp(-dt / (inDZ ? 2 : 10)));
    if (this.lean.update(Math.abs(off))) o.moveX = Math.sign(off) * clamp((Math.abs(off) - 0.18) / (0.7 - 0.18), 0.25, 1);
    // crouch / duck / jump from the hips
    if (this.hipN == null) this.hipN = hipY;
    const drop = (this.hipN - hipY) / torso;
    if (!this.crouch.state && drop < 0.15) this.hipN += (hipY - this.hipN) * (1 - Math.exp(-dt / 4));
    if (this.prevHip != null && fresh) this.hipV += ((hipY - this.prevHip) / torso / Math.max(fdt, 1e-3) - this.hipV) * 0.6;
    if (fresh) this.prevHip = hipY;
    if (this.crouch.update(drop)) o.moveY = -1;
    this.duckCool = Math.max(0, this.duckCool - dt); this.jumpCool = Math.max(0, this.jumpCool - dt);
    if (drop < 0.12) this.duckArmed = true;
    if (this.duckArmed && this.duckCool <= 0 && drop > 0.25 && this.hipV < -1.4) { o.dodge = true; o.moveY = -1; this.duckCool = 0.6; this.duckArmed = false; }
    this.jumpHoldT = Math.max(0, this.jumpHoldT - dt);
    if (this.jumpCool <= 0 && -drop > 0.3 && this.hipV > 1.5) { o.jump = true; this.jumpCool = 0.8; this.jumpHoldT = 0.35; }
    // pinches
    const hands = tr.hands || { L: null, R: null };
    for (const side of ['L', 'R'] as const) {
      const ev = this.pinchStep(side, hands[side], dt);
      if (ev === 'down') { if (side === this.jumpHand) o.jump = true; else o.form = true; }
    }
    if (this.pinch[this.jumpHand].on) o.jumpHeld = true;
    if (this.jumpHoldT > 0) o.jumpHeld = true;   // a real jump: full height
    const pin = (s: 'L' | 'R'): PinchState => ({ on: this.pinch[s].on, conf: +this.pinch[s].conf.toFixed(3), ratio: +this.pinch[s].ratio.toFixed(3), fine: this.pinch[s].fine });
    o.pinch = { L: pin('L'), R: pin('R') };
    // merge: both hands up over the head, together
    const handsUp = py('LW') > py('HEAD') && py('RW') > py('HEAD') && Math.hypot(px('LW') - px('RW'), py('LW') - py('RW')) < 0.09;
    this.mergeT = handsUp ? this.mergeT + dt : 0;
    o.merge = this.mergeT >= 0.25;
    // spin: the shoulders foreshorten, then recover
    if (this.shWRef == null) this.shWRef = shW;
    const ratio = shW / Math.max(this.shWRef, 1e-4);
    if (ratio > 0.8) this.shWRef += (shW - this.shWRef) * (1 - Math.exp(-dt / 5));
    if (ratio < 0.55 && !this.twist.armed) { this.twist.armed = true; this.twist.t = 0; }
    if (this.twist.armed) { this.twist.t += dt; if (ratio > 0.8) { if (this.twist.t <= 0.9) o.spin = true; this.twist.armed = false; } else if (this.twist.t > 1.5) this.twist.armed = false; }
    // punches and kicks from limb-speed peaks; both hands flying together is a gesture (merge, arms thrown up)
    const shoulder: Record<string, JN> = { LW: 'LS', RW: 'RS' }, hip: Record<string, JN> = { LA: 'LH', RA: 'RH' };
    if (sp('LW') > 1.5 && sp('RW') > 1.5) this.bothT = 0.3; else this.bothT = Math.max(0, this.bothT - dt);
    if (fresh) for (const limb of ['LW', 'RW', 'LA', 'RA'] as Limb[]) {
      const pk = this.peaks[limb].update(sp(limb), fdt);
      if (!pk) continue;
      if (limb[1] === 'W') {
        if (this.bothT > 0) continue;
        const ext = Math.hypot(px(limb) - px(shoulder[limb]), py(limb) - py(shoulder[limb]));
        if (ext > 0.8 * 0.23 && !o.merge) { o.punch = true; o.limb = limb; }
      } else if (tr.hasLegs) {
        const lifted = py(limb) > 0.1 || py(limb) > py(hip[limb]) - 0.25;
        if (lifted) { o.kick = true; o.limb = limb; }
      }
    }
    // the bending hand
    const aw = (this.aimHand + 'W') as JN, as = (this.aimHand + 'S') as JN;
    let ax = (px(aw) - px(as)) / 0.23, ay = (py(aw) - py(as)) / 0.23;
    const l = Math.hypot(ax, ay); if (l > 1) { ax /= l; ay /= l; }
    o.aimX = ax; o.aimY = ay; o.aimActive = true;
    this.debug = { off, drop, hipV: this.hipV, shRatio: ratio, pinch: o.pinch };
    return o;
  }
}
