// The camera body, measured: MediaPipe's pose landmarks (and, when it runs, its hand landmarks) turned into what the
// gestures (input/camera.ts) and the dancer need. Pure; webcam.ts feeds it from the camera, the tests feed it synthetic
// landmarks. Ported from the prototype's pose.js BodyTracker (its 2D figure-unit pose and raw body measures, which the
// gesture thresholds are written in), plus the 3D body this repo dances with:
//   pose      Float32Array(26): 13 joints (order LM) in the prototype's 2D figure units (floor y = 0, mirror view),
//             filtered: what the gestures read
//   body      { shX, shY, hipX, hipY, shW, torso }: raw image-plane measures (x mirrored, y up, image heights)
//   hands     { L, R }: { wrist, index, thumb, pinky: [x, y] (same units), vis, fine? } (L: the player's own left).
//             From the pose model's coarse hand points (17-22), or, with `fine`, the hand model's fingertips
//   limbs     Float32Array(39) | null: the 13 landmarks in METRES about the hips' middle, in the dancer's own frame
//             (x the player's left, y up, z the way they face: toward the camera), from MediaPipe's world landmarks,
//             filtered: the real limbs the dancer wears (Character.setPoseFromCamera)
//   visible, everSeen, hasLegs, frame (one more per fresh pose), frameDt
import { LM, NLM } from '../skeleton/landmarks';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  constructor(private minCut = 2.0, private beta = 6.0) {}
  filter(v: number, dt: number) {
    if (this.x == null) { this.x = v; return v; }
    const a = (c: number) => { const r = 2 * Math.PI * c * dt; return r / (r + 1); };
    const dx = (v - this.x) / dt;
    this.dx += (dx - this.dx) * a(1.5);
    this.x += (v - this.x) * a(this.minCut + this.beta * Math.abs(this.dx));
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}

export interface MPPoint { x: number; y: number; z?: number; visibility?: number }
export type P2 = [number, number];
export interface HandPoints { wrist: P2; index: P2; thumb: P2; pinky: P2; vis: number; fine?: boolean }
export interface BodyMeasures { shX: number; shY: number; hipX: number; hipY: number; shW: number; torso: number }

/** MediaPipe's pose landmark for each of our 13, in our order */
const MP = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export class BodyTracker {
  readonly pose = new Float32Array(NLM * 2);
  limbs: Float32Array | null = null;
  visible = false; everSeen = false; hasLegs = false;
  frame = 0; frameDt = 1 / 30;
  body: BodyMeasures | null = null;
  hands: { L: HandPoints | null; R: HandPoints | null } = { L: null, R: null };
  /** the hand model's hands, when it runs (set by the webcam): replaces the coarse ones for the pinch */
  fineHands: { L: HandPoints | null; R: HandPoints | null; t: number } = { L: null, R: null, t: -1e9 };
  private filters = Array.from({ length: NLM * 2 }, () => new OneEuro());
  private filters3 = Array.from({ length: NLM * 3 }, () => new OneEuro(1.5, 4.0));
  private lastSeen = 0; private lastT = 0;
  private torso: number | null = null; private slowY: number | null = null; private hipStand = 0.36; private legLen: number | null = null;
  private legScore: number | null = null; private footCx: number | null = null;

  /** one picture's landmarks (image fractions, and metres about the hips if the model gave them); `aspect` is the
   *  screen's, `va` the video's. Returns true when a fresh pose was written. */
  ingest(lm: MPPoint[], wlm: MPPoint[] | null, nowMs: number, aspect: number, va = 4 / 3) {
    const dt = clamp((nowMs - (this.lastT || nowMs - 33)) / 1000, 0.008, 0.1);
    this.lastT = nowMs;
    const X = (i: number) => (0.5 - lm[i].x) * va, Y = (i: number) => 0.5 - lm[i].y, V = (i: number) => lm[i].visibility ?? 1;
    if (Math.min(V(11), V(12)) < 0.4) { if (nowMs - this.lastSeen > 700) this.visible = false; return false; }

    const shX = (X(11) + X(12)) / 2, shY = (Y(11) + Y(12)) / 2;
    const shW = Math.hypot(X(11) - X(12), Y(11) - Y(12));
    const hipsOk = Math.min(V(23), V(24)) > 0.5 && lm[23].y < 1.05 && lm[24].y < 1.05;
    let hipX = (X(23) + X(24)) / 2, hipY = (Y(23) + Y(24)) / 2;
    let torso = Math.hypot(shX - hipX, shY - hipY);
    if (!hipsOk || torso < shW * 0.7) { torso = Math.max(shW * 1.3, 0.05); hipX = shX; hipY = shY - torso; }
    const k = 1 - Math.exp(-dt * 1.2);
    this.torso = this.torso == null ? torso : this.torso + (torso - this.torso) * k;
    const s = clamp(0.21 / this.torso, 0.3, 6);
    this.body = { shX, shY, hipX, hipY, shW, torso: this.torso };
    const P2 = (i: number): P2 => [X(i), Y(i)];
    const hand = (w: number, idx: number, th: number, pk: number): HandPoints => ({ wrist: P2(w), index: P2(idx), thumb: P2(th), pinky: P2(pk), vis: Math.min(V(w), V(idx), V(th), V(pk)) });
    this.hands = { L: hand(15, 19, 21, 17), R: hand(16, 20, 22, 18) };
    // the hand model's fingertips, when fresh, for a real pinch
    if (nowMs - this.fineHands.t < 250) {
      if (this.fineHands.L) this.hands.L = this.fineHands.L;
      if (this.fineHands.R) this.hands.R = this.fineHands.R;
    }

    const legsNow = hipsOk && Math.min(V(25), V(26), V(27), V(28)) > 0.55 && lm[27].y < 1.03 && lm[28].y < 1.03;
    const ln = legsNow ? 1 : 0;
    this.legScore = this.legScore == null ? ln : this.legScore + (ln - this.legScore) * (1 - Math.exp(-dt * 3));
    this.hasLegs = this.hasLegs ? this.legScore > 0.3 : this.legScore > 0.7;

    this.slowY = this.slowY == null ? shY : this.slowY + (shY - this.slowY) * (1 - Math.exp(-dt / 2.5));
    let stand = 0.36;
    if (this.hasLegs) {
      const leg = hipY - Math.min(Y(27), Y(28));
      this.legLen = this.legLen == null ? leg : this.legLen + (leg - this.legLen) * (1 - Math.exp(-dt / 2.0));
      stand = clamp(this.legLen * s, 0.24, 0.5);
    }
    this.hipStand += (stand - this.hipStand) * (1 - Math.exp(-dt * 2));
    const shStand = this.hipStand + 0.21;
    const maxX = Math.max(0.2, aspect * 0.5 - 0.08);
    const rootX = clamp(shX * 1.25, -maxX * 1.4, maxX * 1.4);

    const out = this.pose;
    const put = (j: number, px: number, py: number) => {
      out[j * 2] = this.filters[j * 2].filter(rootX + (px - shX) * s, dt);
      out[j * 2 + 1] = this.filters[j * 2 + 1].filter(Math.max(0, shStand + (py - this.slowY!) * s), dt);
    };
    put(LM.HEAD, X(0), Y(0) + 0.02 / s);
    put(LM.LS, X(11), Y(11)); put(LM.RS, X(12), Y(12));
    put(LM.LE, X(13), Y(13)); put(LM.RE, X(14), Y(14));
    // extend past the wrist toward the fingertips
    put(LM.LW, X(15) + 0.3 * (X(15) - X(13)), Y(15) + 0.3 * (Y(15) - Y(13)));
    put(LM.RW, X(16) + 0.3 * (X(16) - X(14)), Y(16) + 0.3 * (Y(16) - Y(14)));
    if (hipsOk) { put(LM.LH, X(23), Y(23)); put(LM.RH, X(24), Y(24)); }
    else { put(LM.LH, hipX - shW * 0.32, hipY); put(LM.RH, hipX + shW * 0.32, hipY); }
    if (this.hasLegs) {
      put(LM.LK, X(25), Y(25)); put(LM.RK, X(26), Y(26)); put(LM.LA, X(27), Y(27)); put(LM.RA, X(28), Y(28));
    } else {
      // legs out of frame: stand the figure on the floor beneath its hips
      const lhx = out[LM.LH * 2], lhy = out[LM.LH * 2 + 1], rhx = out[LM.RH * 2], rhy = out[LM.RH * 2 + 1];
      const f = this.filters, sm = (j: number, c: number, val: number) => { out[j * 2 + c] = f[j * 2 + c].filter(val, dt); };
      const cx = (lhx + rhx) / 2;
      this.footCx = this.footCx == null ? cx : this.footCx + (cx - this.footCx) * (1 - Math.exp(-dt * 2.5));
      sm(LM.LA, 0, this.footCx - 0.075); sm(LM.LA, 1, 0); sm(LM.RA, 0, this.footCx + 0.075); sm(LM.RA, 1, 0);
      sm(LM.LK, 0, (lhx + this.footCx - 0.075) / 2 - 0.02); sm(LM.LK, 1, lhy / 2);
      sm(LM.RK, 0, (rhx + this.footCx + 0.075) / 2 + 0.02); sm(LM.RK, 1, rhy / 2);
    }

    // the real body in 3D, in metres, from the world landmarks: MediaPipe's x is the image's right (the player's own
    // left, facing the camera), y down, z away from the camera; ours is x the dancer's left, y up, z forward
    if (wlm && wlm.length >= 29) {
      const WX = (i: number) => wlm[i].x, WY = (i: number) => -wlm[i].y, WZ = (i: number) => -(wlm[i].z ?? 0);
      const hc = [(WX(23) + WX(24)) / 2, (WY(23) + WY(24)) / 2, (WZ(23) + WZ(24)) / 2];
      this.limbs ??= new Float32Array(NLM * 3);
      for (let j = 0; j < NLM; j++) {
        const i = MP[j];
        let x = WX(i), y = WY(i), z = WZ(i);
        // the head landmark is the head's middle: between the ears
        if (j === LM.HEAD) { x = (WX(7) + WX(8)) / 2; y = (WY(7) + WY(8)) / 2; z = (WZ(7) + WZ(8)) / 2; }
        const v = [x - hc[0], y - hc[1], z - hc[2]];
        for (let c = 0; c < 3; c++) this.limbs[3 * j + c] = this.filters3[3 * j + c].filter(v[c], dt);
      }
      if (!this.hasLegs) {
        // legs not seen: stand them under the hips rather than trusting the model's guess
        const L = this.limbs;
        for (const [h, kn, a, sd] of [[LM.LH, LM.LK, LM.LA, 1], [LM.RH, LM.RK, LM.RA, -1]]) {
          const hx = L[3 * h], hz = L[3 * h + 2];
          L.set([hx + sd * 0.02, -0.42, hz + 0.04], 3 * kn); L.set([hx + sd * 0.03, -0.84, hz], 3 * a);
        }
      }
    }

    this.frameDt = dt; this.frame++;
    this.visible = true; this.everSeen = true; this.lastSeen = nowMs;
    return true;
  }

  /** the hand model's result for one picture: each hand's 21 points (image fractions), matched to the pose's wrists */
  ingestHands(hands: MPPoint[][], nowMs: number, va = 4 / 3) {
    const X = (p: MPPoint) => (0.5 - p.x) * va, Y = (p: MPPoint) => 0.5 - p.y;
    const out: { L: HandPoints | null; R: HandPoints | null; t: number } = { L: null, R: null, t: nowMs };
    for (const h of hands) {
      if (!h || h.length < 21) continue;
      const pts: HandPoints = { wrist: [X(h[0]), Y(h[0])], thumb: [X(h[4]), Y(h[4])], index: [X(h[8]), Y(h[8])], pinky: [X(h[17]), Y(h[17])], vis: 1, fine: true };
      // which of the body's hands is it? the nearer wrist (the model's own handedness assumes a mirrored picture)
      const L = this.hands.L?.wrist, R = this.hands.R?.wrist;
      const dL = L ? Math.hypot(L[0] - pts.wrist[0], L[1] - pts.wrist[1]) : Infinity, dR = R ? Math.hypot(R[0] - pts.wrist[0], R[1] - pts.wrist[1]) : Infinity;
      const side = dL <= dR ? 'L' : 'R';
      if (!out[side]) out[side] = pts;
    }
    this.fineHands = out;
  }
}
