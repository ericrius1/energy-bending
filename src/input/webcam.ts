// The webcam and the models that read it, for the camera body (input/camera.ts): MediaPipe's pose landmarker, and on
// a device that isn't coarse (a phone's budget is spent on the pose) its hand landmarker as a second model, for a real
// thumb-to-index pinch. Both are loaded from their CDN only when a camera player joins, and run on this device: no
// picture leaves it. Each new picture goes to a BodyTracker (input/tracker.ts); the hands run on every other picture.
import { BodyTracker, type MPPoint } from './tracker';

const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0';
const POSE = (kind: 'lite' | 'full') => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${kind}/float16/1/pose_landmarker_${kind}.task`;
const HANDS = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

type PoseModel = { detectForVideo(v: HTMLVideoElement, t: number): { landmarks?: MPPoint[][]; worldLandmarks?: MPPoint[][] }; close(): void };
type HandModel = { detectForVideo(v: HTMLVideoElement, t: number): { landmarks?: MPPoint[][] }; close(): void };

export class Webcam {
  readonly tracker = new BodyTracker();
  /** whether the hand model is running (else the pinch comes from the pose model's coarse hand points) */
  fineHands = false;
  private video = document.createElement('video');
  private stream: MediaStream | null = null;
  private pose: PoseModel | null = null;
  private hands: HandModel | null = null;
  private running = false;
  private n = 0;

  constructor(private say: (s: string) => void = () => {}, private aspect: () => number = () => innerWidth / Math.max(1, innerHeight)) {
    this.video.playsInline = true;
    this.video.muted = true;
    // kept in the page (iOS only decodes frames for a video that is), out of sight
    this.video.setAttribute('aria-hidden', 'true');
    Object.assign(this.video.style, { position: 'fixed', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', left: '0', top: '0' });
    document.body.append(this.video);
  }

  /** ask for the camera and load the models; `coarse` (a phone): the lite pose model and no hand model */
  async start(coarse: boolean) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera access in this browser');
    this.say('asking for the camera');
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.say('loading the pose model (a few MB, once)');
    const vision = await import(/* @vite-ignore */ `${VISION}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
    const makePose = (delegate: 'GPU' | 'CPU') => vision.PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: POSE(coarse ? 'lite' : 'full'), delegate },
      runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    this.pose = await makePose('GPU').catch(() => makePose('CPU'));
    if (!coarse) {
      // the second model is optional: if it won't load, the pinch falls back to the closed hand
      const makeHands = (delegate: 'GPU' | 'CPU') => vision.HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: HANDS, delegate }, runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      try { this.hands = await makeHands('GPU').catch(() => makeHands('CPU')); this.fineHands = true; } catch (e) { console.warn('energybending: no hand model, pinching by closing the hand', e); }
    }
    this.running = true;
    this.say('step back until all of you is in the picture');
    this.loop();
  }

  private loop() {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => { this.look(); this.loop(); });
    else requestAnimationFrame(() => { this.look(); this.loop(); });
  }

  private look() {
    if (!this.pose || this.video.readyState < 2) return;
    const now = performance.now(), va = (this.video.videoWidth || 4) / (this.video.videoHeight || 3);
    let r: ReturnType<PoseModel['detectForVideo']>;
    try { r = this.pose.detectForVideo(this.video, now); } catch { return; }
    const lm = r.landmarks?.[0];
    if (!lm) return;
    // the hands first (they're matched to the pose's last wrists), on every other picture
    if (this.hands && (this.n++ & 1) === 0) {
      try { const h = this.hands.detectForVideo(this.video, now); this.tracker.ingestHands(h.landmarks ?? [], now, va); } catch { /* a dropped picture */ }
    }
    const was = this.tracker.everSeen;
    this.tracker.ingest(lm, r.worldLandmarks?.[0] ?? null, now, this.aspect(), va);
    if (!was && this.tracker.everSeen) this.say('there you are: dance');
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.pose?.close(); this.pose = null;
    this.hands?.close(); this.hands = null;
    this.video.remove();
  }
}
