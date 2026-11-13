// pose.js — camera body tracking (MediaPipe Pose Landmarker, runs entirely on-device).
//
// BodyTracker(video)
//   await init(onStatus), stop(), update(nowMs, aspect) -> true when a fresh pose was written.
//   pose      Float32Array(26): the 13 joints (order J) in the old stage space (figure units, floor y = 0,
//             mirror view), filtered. Unchanged from before; main.js relies on it with visible, everSeen, hasLegs.
//   visible, everSeen, hasLegs, ready                          (unchanged)
//   frame     increments on every fresh pose;  frameDt  seconds between the last two fresh poses
//   pose3     Float32Array(39) | null: the same joints in 3-D from MediaPipe's worldLandmarks, in figure units
//             (torso = 0.21), hip-centred, x right (mirror view), y up, z toward the camera; filtered.
//   body      { shX, shY, hipX, hipY, shW, torso } raw image-plane measures (x mirrored, y up, units of
//             image height), unfiltered: for gesture detection that must not be smoothed away.
//   hands     { L, R }: { wrist, index, thumb, pinky: [x, y] (same units as body), vis } from landmarks
//             15-22 (L = screen left after mirroring = the player's own left hand).
//   ingest(landmarks, worldLandmarks, nowMs, aspect, videoAspect)  the processing step on its own (used by
//             update(); also lets tests feed synthetic MediaPipe output).
import { J, NJ } from './skeleton.js';

const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

class OneEuro {
  constructor(minCut = 2.0, beta = 6.0) { this.minCut = minCut; this.beta = beta; this.x = null; this.dx = 0; }
  filter(v, dt) {
    if (this.x == null) { this.x = v; return v; }
    const a = c => { const r = 2 * Math.PI * c * dt; return r / (r + 1); };
    const dx = (v - this.x) / dt;
    this.dx += (dx - this.dx) * a(1.5);
    this.x += (v - this.x) * a(this.minCut + this.beta * Math.abs(this.dx));
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}

// MediaPipe landmark index for each of our joints (wrists are extended toward the fingertips separately)
const LM = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export class BodyTracker {
  constructor(video) {
    this.video = video;
    this.pose = new Float32Array(NJ * 2);
    this.filters = Array.from({ length: NJ * 2 }, () => new OneEuro());
    this.pose3 = null;
    this.filters3 = Array.from({ length: NJ * 3 }, () => new OneEuro(1.5, 4.0));
    this.visible = false; this.everSeen = false; this.hasLegs = false;
    this.lastSeen = 0; this.lastVideoTime = -1; this.lastT = 0;
    this.torso = null; this.slowY = null; this.hipStand = 0.36; this.legLen = null;
    this.ready = false;
    this.frame = 0; this.frameDt = 1 / 30;
    this.body = null; this.hands = { L: null, R: null };
  }

  async init(onStatus = () => {}) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('No camera access in this browser.');
    onStatus('Asking for your camera…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    onStatus('Waking the fire…');
    const { PoseLandmarker, FilesetResolver } = await import(/* @vite-ignore */ `${MP_BASE}/vision_bundle.mjs`);
    const vision = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = delegate => PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { this.landmarker = await make('GPU'); } catch (e) { this.landmarker = await make('CPU'); }
    this.ready = true;
  }

  stop() {
    this.ready = false;
    this.stream?.getTracks().forEach(t => t.stop());
    this.landmarker?.close?.();
  }

  // Returns true when a fresh pose was written to this.pose.
  update(nowMs, aspect) {
    if (!this.ready) return false;
    const v = this.video;
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime) {
      if (nowMs - this.lastSeen > 700) this.visible = false;
      return false;
    }
    this.lastVideoTime = v.currentTime;
    let res;
    try { res = this.landmarker.detectForVideo(v, nowMs); } catch (e) { return false; }
    const lm = res?.landmarks?.[0];
    if (!lm) { if (nowMs - this.lastSeen > 700) this.visible = false; return false; }
    return this.ingest(lm, res?.worldLandmarks?.[0] || null, nowMs, aspect, (v.videoWidth || 4) / (v.videoHeight || 3));
  }

  ingest(lm, wlm, nowMs, aspect, va = 4 / 3) {
    const dt = clamp((nowMs - (this.lastT || nowMs - 33)) / 1000, 0.008, 0.1);
    this.lastT = nowMs;
    const X = i => (0.5 - lm[i].x) * va, Y = i => 0.5 - lm[i].y, V = i => lm[i].visibility ?? 1;
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
    const P2 = i => [X(i), Y(i)];
    const hand = (w, idx, th, pk) => ({ wrist: P2(w), index: P2(idx), thumb: P2(th), pinky: P2(pk), vis: Math.min(V(w), V(idx), V(th), V(pk)) });
    this.hands = { L: hand(15, 19, 21, 17), R: hand(16, 20, 22, 18) };

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
    const put = (j, px, py) => {
      out[j * 2] = this.filters[j * 2].filter(rootX + (px - shX) * s, dt);
      out[j * 2 + 1] = this.filters[j * 2 + 1].filter(Math.max(0, shStand + (py - this.slowY) * s), dt);
    };
    put(J.HEAD, X(0), Y(0) + 0.02 / s);
    put(J.LS, X(11), Y(11)); put(J.RS, X(12), Y(12));
    put(J.LE, X(13), Y(13)); put(J.RE, X(14), Y(14));
    // extend past the wrist toward the fingertips
    put(J.LW, X(15) + 0.3 * (X(15) - X(13)), Y(15) + 0.3 * (Y(15) - Y(13)));
    put(J.RW, X(16) + 0.3 * (X(16) - X(14)), Y(16) + 0.3 * (Y(16) - Y(14)));
    if (hipsOk) { put(J.LH, X(23), Y(23)); put(J.RH, X(24), Y(24)); }
    else { put(J.LH, hipX - shW * 0.32, hipY); put(J.RH, hipX + shW * 0.32, hipY); }
    if (this.hasLegs) {
      put(J.LK, X(25), Y(25)); put(J.RK, X(26), Y(26)); put(J.LA, X(27), Y(27)); put(J.RA, X(28), Y(28));
    } else {
      // legs out of frame: stand the figure on the floor beneath its hips
      const lhx = out[J.LH * 2], lhy = out[J.LH * 2 + 1], rhx = out[J.RH * 2], rhy = out[J.RH * 2 + 1];
      const f = this.filters, sm = (j, c, val) => { out[j * 2 + c] = f[j * 2 + c].filter(val, dt); };
      const cx = (lhx + rhx) / 2;
      this.footCx = this.footCx == null ? cx : this.footCx + (cx - this.footCx) * (1 - Math.exp(-dt * 2.5));
      sm(J.LA, 0, this.footCx - 0.075); sm(J.LA, 1, 0); sm(J.RA, 0, this.footCx + 0.075); sm(J.RA, 1, 0);
      sm(J.LK, 0, (lhx + this.footCx - 0.075) / 2 - 0.02); sm(J.LK, 1, lhy / 2);
      sm(J.RK, 0, (rhx + this.footCx + 0.075) / 2 + 0.02); sm(J.RK, 1, rhy / 2);
    }

    // 3-D from the world landmarks (metres, hip-centred, image axes: x right, y down, z away from the camera)
    if (wlm && wlm.length >= 29) {
      const WX = i => -wlm[i].x, WY = i => -wlm[i].y, WZ = i => -wlm[i].z;
      const sc3 = [(WX(11) + WX(12)) / 2, (WY(11) + WY(12)) / 2, (WZ(11) + WZ(12)) / 2];
      const hc3 = [(WX(23) + WX(24)) / 2, (WY(23) + WY(24)) / 2, (WZ(23) + WZ(24)) / 2];
      const t3 = Math.hypot(sc3[0] - hc3[0], sc3[1] - hc3[1], sc3[2] - hc3[2]);
      if (t3 > 0.05) {
        const s3 = 0.21 / t3;
        this.pose3 = this.pose3 || new Float32Array(NJ * 3);
        for (let j = 0; j < NJ; j++) {
          let i = LM[j], x = WX(i), y = WY(i), z = WZ(i);
          if (j === J.LW || j === J.RW) { const e = j === J.LW ? 13 : 14; x += 0.3 * (x - WX(e)); y += 0.3 * (y - WY(e)); z += 0.3 * (z - WZ(e)); }
          const v = [(x - hc3[0]) * s3, (y - hc3[1]) * s3, (z - hc3[2]) * s3];
          for (let c = 0; c < 3; c++) this.pose3[3 * j + c] = this.filters3[3 * j + c].filter(v[c], dt);
        }
        if (!this.hasLegs) {
          // legs not seen: stand them under the hips rather than trusting the model's guess
          for (const [h, kn, a, sd] of [[J.LH, J.LK, J.LA, -1], [J.RH, J.RK, J.RA, 1]]) {
            const hx = this.pose3[3 * h], hz = this.pose3[3 * h + 2];
            this.pose3.set([hx + sd * 0.02, -0.18, hz + 0.02], 3 * kn); this.pose3.set([hx + sd * 0.03, -0.36, hz], 3 * a);
          }
        }
      }
    }

    this.frameDt = dt; this.frame++;
    this.visible = true; this.everSeen = true; this.lastSeen = nowMs;
    return true;
  }
}
