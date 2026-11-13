// CameraController: you, through the webcam. MediaPipe's pose landmarker (loaded only when asked, from its CDN; it
// runs on this device and nothing leaves it) finds 33 landmarks in each picture; they are smoothed (a 1-euro filter),
// seen as in a mirror (raise your right hand and the hand on the right of the screen goes up), turned into the 13
// landmarks plus the ears, index knuckles and toes, and fitted onto the rig by the LandmarkController it is, with the
// feet kept on the floor. Gem Dancers' "You" (pose.ts), on the shared landmark path.
import { LandmarkController } from './landmark';
import type { FrameCtx } from '../engine/frame';
import type { Rig, Skeleton } from '../skeleton/rig';
import { LM, LMX, newLandmarkPose } from '../skeleton/landmarks';

const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0';
const MODEL = (kind: 'lite' | 'full') => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${kind}/float16/1/pose_landmarker_${kind}.task`;

/** MediaPipe's landmark for each of ours, as the mirror shows it (the dancer's left is your right) */
const FROM_MP: [number, number][] = [
  [LM.LS, 12], [LM.RS, 11], [LM.LE, 14], [LM.RE, 13], [LM.LW, 16], [LM.RW, 15],
  [LM.LH, 24], [LM.RH, 23], [LM.LK, 26], [LM.RK, 25], [LM.LA, 28], [LM.RA, 27],
];
const FROM_MP_EXTRA: [number, number][] = [[LMX.LEAR, 8], [LMX.REAR, 7], [LMX.LINDEX, 20], [LMX.RINDEX, 19], [LMX.LTOE, 32], [LMX.RTOE, 31]];

/** a body standing easy, as MediaPipe landmarks about the hips (mirrored already): [index, x, y, z] */
const NEUTRAL: [number, number, number, number][] = [
  [0, 0, 0.68, 0.1], [7, -0.075, 0.68, -0.02], [8, 0.075, 0.68, -0.02],
  [11, -0.19, 0.52, 0], [12, 0.19, 0.52, 0], [13, -0.24, 0.26, 0.02], [14, 0.24, 0.26, 0.02], [15, -0.27, 0.02, 0.06], [16, 0.27, 0.02, 0.06],
  [19, -0.28, -0.07, 0.08], [20, 0.28, -0.07, 0.08], [23, -0.1, 0, 0], [24, 0.1, 0, 0], [25, -0.11, -0.43, 0.02], [26, 0.11, -0.43, 0.02],
  [27, -0.12, -0.85, 0], [28, 0.12, -0.85, 0], [31, -0.13, -0.9, 0.14], [32, 0.13, -0.9, 0.14],
];

/** a 1-euro filter (Casiez et al.): smooth when still, quick when moving; one per landmark coordinate */
class OneEuro {
  private x = NaN;
  private dx = 0;
  constructor(private minCut = 1.6, private beta = 1.6, private dCut = 1) {}
  private static a(cut: number, dt: number) { const r = 2 * Math.PI * cut * dt; return r / (r + 1); }
  filter(v: number, dt: number) {
    if (Number.isNaN(this.x)) { this.x = v; return v; }
    const d = (v - this.x) / dt;
    this.dx += (d - this.dx) * OneEuro.a(this.dCut, dt);
    this.x += (v - this.x) * OneEuro.a(this.minCut + this.beta * Math.abs(this.dx), dt);
    return this.x;
  }
}

export class CameraController extends LandmarkController {
  override readonly kind = 'camera';
  /** where on the stage your middle is when you stand in the middle of the picture */
  baseX = 0;
  z = 0;
  yaw = 0;
  /** whether anyone's been seen lately */
  seen = false;
  private mp = new Float32Array(33 * 3);
  private filters = Array.from({ length: 99 }, () => new OneEuro());
  private stageX = new OneEuro(0.5, 0.3);
  private x = 0;
  private lastSeen = -1e9;

  constructor(rig: Rig) {
    super(rig, newLandmarkPose(true));
    this.ground = 0.035;
    for (const [i, x, y, z] of NEUTRAL) this.mp.set([x, y, z], i * 3);
  }

  /** new landmarks: `world` in metres about the hips (MediaPipe's: x right, y down, z away from the camera), `image`
   *  the same points as fractions of the picture (for where you stand side to side) */
  feed(world: ArrayLike<{ x: number; y: number; z: number }>, image: ArrayLike<{ x: number; y: number }> | null, dt: number, now: number) {
    for (let i = 0; i < 33; i++) {
      const p = world[i];
      this.mp[i * 3] = this.filters[i * 3].filter(-p.x, dt);
      this.mp[i * 3 + 1] = this.filters[i * 3 + 1].filter(-p.y, dt);
      this.mp[i * 3 + 2] = this.filters[i * 3 + 2].filter(-p.z, dt);
    }
    if (image) this.x = this.stageX.filter((0.5 - (image[23].x + image[24].x) / 2) * 3.2, dt);
    this.lastSeen = now;
    this.seen = true;
  }

  override update(dt: number, f: FrameCtx, out: Skeleton) {
    if (performance.now() - this.lastSeen > 1500) this.seen = false;
    const P = this.pose, m = this.mp;
    const put = (dst: Float32Array, i: number, j: number) => { dst[i * 3] = m[j * 3]; dst[i * 3 + 1] = m[j * 3 + 1]; dst[i * 3 + 2] = m[j * 3 + 2]; };
    for (const [i, j] of FROM_MP) put(P.p, i, j);
    // the head: between the ears
    for (let a = 0; a < 3; a++) P.p[LM.HEAD * 3 + a] = (m[7 * 3 + a] + m[8 * 3 + a]) / 2;
    for (const [i, j] of FROM_MP_EXTRA) put(P.extra!, i, j);
    P.root[0] = this.x + this.baseX; P.root[1] = 0; P.root[2] = this.z;
    P.yaw = this.yaw;
    super.update(dt, f, out);
  }
}

type Landmarker = {
  detectForVideo(v: HTMLVideoElement, t: number): { landmarks: { x: number; y: number }[][]; worldLandmarks: { x: number; y: number; z: number }[][] };
  close(): void;
};

/** the webcam and the landmarker: start() asks for the camera, then every new picture is a new pose */
export class Eyes {
  private video = document.createElement('video');
  private stream: MediaStream | null = null;
  private landmarker: Landmarker | null = null;
  private last = 0;
  private running = false;
  constructor(private you: CameraController, private say: (s: string) => void) {
    this.video.playsInline = true;
    this.video.muted = true;
    // kept in the page (iOS only decodes frames for a video that is), out of sight
    this.video.setAttribute('aria-hidden', 'true');
    Object.assign(this.video.style, { position: 'fixed', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', left: '0', top: '0' });
    document.body.append(this.video);
  }

  async start(small: boolean) {
    this.say('asking for the camera');
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.say('loading the pose model (a few MB, once)');
    const vision = await import(/* @vite-ignore */ `${VISION}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
    const make = (delegate: 'GPU' | 'CPU') => vision.PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL(small ? 'lite' : 'full'), delegate },
      runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    this.landmarker = await make('GPU').catch(() => make('CPU'));
    this.running = true;
    this.say('step back until all of you is in the picture');
    this.loop();
  }

  private loop() {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const next = () => this.loop();
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => { this.look(); next(); });
    else requestAnimationFrame(() => { this.look(); next(); });
  }

  private look() {
    if (!this.landmarker || this.video.readyState < 2) return;
    const now = performance.now();
    if (now - this.last < 1) return;
    const dt = Math.min(0.2, Math.max(1 / 120, (now - this.last) / 1000));
    this.last = now;
    const r = this.landmarker.detectForVideo(this.video, now);
    if (r.worldLandmarks?.length) {
      const was = this.you.seen;
      this.you.feed(r.worldLandmarks[0], r.landmarks?.[0] ?? null, dt, now);
      if (!was) this.say('there you are: dance');
    }
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.video.remove();
  }
}
