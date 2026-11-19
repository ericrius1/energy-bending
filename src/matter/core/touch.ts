// The hand: Gem Dancers' pointer and fingers, as they act on matter and on the free camera. A mouse moving through
// the dancers pushes and swirls their matter (a vortex that turns the way the pointer circles); a click bursts it; a
// held button or finger gathers and, let go, blasts; two quick taps (or a double click) shatter everyone. Dragging
// (or two fingers) turns the camera, the wheel or a pinch moves it in and out. Each frame `update` turns that into
// the Touch uniform (body.wgsl) every kind's simulation reads through the shared body group.
// (The players' own input, one Intent each from keyboard, gamepad, touch and camera, is wave 1's src/input.)
import { mat4, vec3, vec4, type Mat4, type Vec3, type Vec4 } from 'math';
import type { Camera } from '@ericrius1/weft';
import type { Touch } from './body.wgsl';
import type { BodyBuffers } from './bodies';
import type { CameraRig } from '../../engine/camera';
import { defineParams } from '../../engine/params';

export const touchParams = defineParams('touch', {
  hover: true,
  push: 1.2,
  attract: 0,
  swirl: 0.7,
  radius: 0.38,
  dragAmt: 0.9,
  burst: 0.6,
  /** a finger (or a held button): a longer reach, a stronger vortex; hold to gather, let go to blast */
  fingerSize: 1.5,
  fingerSwirl: 2.4,
  gather: 2.5,
  blast: 1.2,
  comet: 1,
}, {
  radius: { min: 0.05, max: 1.5, label: 'reach' },
  push: { min: -2, max: 4 },
  swirl: { min: -3, max: 3 },
  burst: { min: 0, max: 4, label: 'click burst' },
});

export interface HandEvents {
  /** the first touch (wakes the dancers and the sound) */
  wake(): void;
  /** a blast of this strength somewhere (the score booms) */
  blast(strength: number): void;
}

export class Hand {
  /** the pointer in client pixels, whether it's over the canvas, held down, how far it moved since */
  readonly pointer = { x: 0, y: 0, inside: false, down: false, moved: 0, downAt: 0, hasLast: false, last: vec3.create(), vel: vec3.create() };
  /** a finger (or a held mouse button): down since `at`, gathering `charge` the longer it's held */
  readonly finger = { on: false, at: 0, charge: 0, camera: false, lastTap: 0, tapX: 0, tapY: 0, mouse: true, hold: false };
  /** a blast this frame (xyz, strength), and whether everyone shatters this frame */
  readonly burst: Vec4 = vec4.create();
  shatterAll = false;
  /** whether the hand is touching matter this frame, and holding */
  active = false;
  holding = false;
  /** milliseconds for holds and taps (a film gives its own clock so a scripted hold charges the same every time) */
  nowMs: () => number = () => performance.now();
  /** false while a game is playing: the show's sandbox pointer (orbit, dolly, click-burst, double-click shatter) steps
   *  aside so it never fights the game's own mouse, click-to-catch/strike, right-drag camera or scroll zoom */
  enabled: () => boolean = () => true;
  private touches = new Map<number, { x: number; y: number }>();
  private spin = { x: 0, y: 0, vx: 0, vy: 0, rate: 0, sign: 1 };
  private u: Partial<Touch> & { rayOrigin: Vec3; rayDir: Vec3; pointerVel: Vec3; burst: Vec4; finger: Vec4; fingerPrev: Vec4 };
  private ivp: Mat4 = mat4.create();
  private world = vec3.create();
  private vel = vec3.create();

  constructor(private bodies: BodyBuffers, private rig: CameraRig, private events: HandEvents, private maxDist: () => number) {
    this.u = { rayOrigin: vec3.create(), rayDir: vec3.create(), pointerVel: this.pointer.vel, burst: this.burst, finger: vec4.create(), fingerPrev: vec4.create() };
  }

  /** a blast where the pointer is, on the plane through the dancers */
  burstAtPointer(strength: number, cam: Camera) {
    this.ray(cam);
    vec3.scaleAndAdd(this.world, this.u.rayOrigin, this.u.rayDir, this.focalT(cam));
    vec4.set(this.burst, this.world[0], this.world[1], this.world[2], strength);
    this.events.blast(strength);
  }
  /** everyone's matter blown off at once */
  shatter() { this.shatterAll = true; this.events.blast(4); }

  /** hold (or let go of) a finger where the pointer is: a hold gathers, letting go blasts with what it gathered */
  press(down: boolean, cam: Camera, burst: number) {
    if (down) { this.finger.on = true; this.finger.at = this.nowMs(); this.pointer.inside = true; this.pointer.hasLast = false; }
    else { if (this.finger.charge > 0.15) this.burstAtPointer(burst * (1 + touchParams.blast * this.finger.charge), cam); this.finger.on = false; }
  }

  private canvas: HTMLCanvasElement | null = null;

  attach(canvas: HTMLCanvasElement, cam: Camera) {
    this.canvas = canvas;
    const { pointer, finger, touches, spin, rig } = this;
    const P = touchParams;
    const pinch = () => { const [a, b] = touches.values(); return [(a.x + b.x) / 2, (a.y + b.y) / 2, Math.hypot(a.x - b.x, a.y - b.y)]; };
    canvas.addEventListener('pointerenter', (e) => { if (this.enabled() && e.pointerType === 'mouse') pointer.inside = true; });
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { pointer.inside = false; pointer.hasLast = false; } });
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled()) return;
      this.events.wake();
      canvas.setPointerCapture(e.pointerId);
      finger.mouse = e.pointerType === 'mouse';
      if (finger.mouse) { pointer.down = true; pointer.moved = 0; pointer.downAt = this.nowMs(); finger.hold = false; return; }
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        finger.on = true; finger.camera = false; finger.at = this.nowMs(); finger.charge = 0;
        pointer.x = spin.x = e.clientX; pointer.y = spin.y = e.clientY; spin.vx = spin.vy = 0;
        pointer.moved = 0; pointer.inside = true; pointer.hasLast = false;
      } else {
        // a second finger: the matter is let go (no blast) and the gesture moves the camera
        finger.on = false; finger.camera = true; pointer.inside = false;
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.enabled()) { pointer.down = false; finger.hold = false; pointer.inside = false; return; }
      if (e.pointerType !== 'mouse') {
        const t = touches.get(e.pointerId);
        if (!t) return;
        if (finger.camera && touches.size >= 2) {
          const [x0, y0, s0] = pinch();
          t.x = e.clientX; t.y = e.clientY;
          const [x1, y1, s1] = pinch();
          rig.turn(x1 - x0, y1 - y0);
          if (s0 > 20 && s1 > 20) rig.dolly(s0 / s1, this.maxDist());
        } else {
          pointer.moved += Math.abs(e.clientX - t.x) + Math.abs(e.clientY - t.y);
          t.x = e.clientX; t.y = e.clientY;
          if (finger.on) { pointer.x = e.clientX; pointer.y = e.clientY; }
        }
        return;
      }
      pointer.inside = true;
      if (pointer.down && !finger.hold) {
        const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
        pointer.moved += Math.abs(dx) + Math.abs(dy);
        if (pointer.moved > 6) rig.orbit(dx, dy);
      }
      pointer.x = e.clientX; pointer.y = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!this.enabled()) { pointer.down = false; finger.hold = false; finger.on = false; touches.clear(); return; }
      if (e.pointerType === 'mouse') {
        if (finger.hold) { if (finger.charge > 0.15) this.burstAtPointer(P.burst * (1 + P.blast * finger.charge), cam); }
        else if (pointer.down && pointer.moved <= 6 && this.nowMs() - pointer.downAt < 400) this.burstAtPointer(P.burst, cam);
        pointer.down = false; finger.hold = false;
        return;
      }
      touches.delete(e.pointerId);
      if (finger.on) {
        const t = this.nowMs();
        if (pointer.moved < 12 && t - finger.at < 260) {
          // a tap bursts; a second tap close by shatters everyone
          if (t - finger.lastTap < 340 && Math.hypot(e.clientX - finger.tapX, e.clientY - finger.tapY) < 60) this.shatter();
          this.burstAtPointer(P.burst, cam);
          finger.lastTap = t; finger.tapX = e.clientX; finger.tapY = e.clientY;
        } else if (finger.charge > 0.15) this.burstAtPointer(P.burst * (1 + P.blast * finger.charge), cam);
        finger.on = false;
      }
      if (touches.size === 0) { finger.camera = false; pointer.inside = false; pointer.hasLast = false; }
    });
    canvas.addEventListener('pointercancel', (e) => {
      touches.delete(e.pointerId);
      pointer.down = false; finger.hold = false;
      if (touches.size === 0) { finger.on = false; finger.camera = false; pointer.inside = false; pointer.hasLast = false; }
    });
    canvas.addEventListener('dblclick', () => { if (this.enabled() && finger.mouse) this.shatter(); });
    // two fingers up and down on a trackpad dolly, like a pinch (a pinch arrives as ctrl + wheel)
    canvas.addEventListener('wheel', (e) => {
      if (!this.enabled()) return;
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      rig.dolly(Math.exp(dy * (e.ctrlKey ? 0.012 : 0.0016)), this.maxDist());
    }, { passive: false });
  }

  /** the pointer's ray through the scene, unprojected with the camera's inverse view-projection (reversed-Z) */
  private ray(cam: Camera) {
    const c = (this.canvas ?? document.querySelector('canvas')!).getBoundingClientRect();
    const x = ((this.pointer.x - c.left) / c.width) * 2 - 1, y = 1 - ((this.pointer.y - c.top) / c.height) * 2;
    for (let i = 0; i < 16; i++) this.ivp[i] = cam.invViewProj[i];
    const o = this.u.rayOrigin, d = this.u.rayDir;
    vec3.transformMat4(o, vec3.set(o, x, y, 1), this.ivp);
    vec3.transformMat4(d, vec3.set(d, x, y, 0.001), this.ivp);
    vec3.normalize(d, vec3.subtract(d, d, o));
  }
  /** distance along the ray to the plane through the orbit's target, facing the camera */
  private focalT(cam: Camera) {
    const f = cam.forward, tg = this.rig.target, o = this.u.rayOrigin, d = this.u.rayDir;
    const denom = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    return ((tg[0] - o[0]) * f[0] + (tg[1] - o[1]) * f[1] + (tg[2] - o[2]) * f[2]) / (denom || 1);
  }

  /** each frame, after the camera: the ray, the swipe's velocity on the dancers' plane, the vortex's turn, the charge */
  update(dt: number, cam: Camera) {
    const { pointer, finger, spin } = this, P = touchParams;
    if (!this.enabled()) {
      pointer.down = false; pointer.inside = false; finger.on = false; finger.hold = false; finger.charge = 0;
      vec4.set(this.u.finger, 0, 0, 0, 0);
      this.u.hoverOn = 0;
      this.bodies.touch.set(this.u);
      this.active = false;
      this.holding = false;
      return;
    }
    this.ray(cam);
    vec3.zero(this.vel);
    // a mouse button held still for a moment gathers, like a finger
    if (pointer.down && !finger.hold && pointer.moved <= 6 && this.nowMs() - pointer.downAt > 300) { finger.hold = true; finger.at = pointer.downAt; }
    const holding = finger.on || finger.hold;
    const active = pointer.inside && (!pointer.down || finger.hold);
    vec4.set(this.u.finger, 0, 0, 0, 0);
    if (active) {
      vec3.scaleAndAdd(this.world, this.u.rayOrigin, this.u.rayDir, this.focalT(cam));
      if (!pointer.hasLast) vec3.copy(pointer.last, this.world);
      if (dt > 0) vec3.scale(this.vel, vec3.subtract(this.vel, this.world, pointer.last), 1 / dt);
      vec4.set(this.u.fingerPrev, pointer.last[0], pointer.last[1], pointer.last[2], 0);
      // sparkles off its path, more the faster it goes (a finger's comet is brighter than a mouse's)
      const comet = Math.min(0.8, P.comet * (finger.on ? 1 : 0.3) * vec3.length(this.vel) * 0.05);
      vec4.set(this.u.finger, this.world[0], this.world[1], this.world[2], comet);
      vec3.copy(pointer.last, this.world);
      pointer.hasLast = true;
    }
    vec3.lerp(pointer.vel, pointer.vel, this.vel, 1 - Math.exp(-dt * 18));
    const v = vec3.length(pointer.vel);
    if (v > 12) vec3.scale(pointer.vel, pointer.vel, 12 / v);
    // the vortex turns the way the pointer circles: the angle between this frame's screen motion and the last
    const sx = pointer.x - spin.x, sy = pointer.y - spin.y;
    spin.x = pointer.x; spin.y = pointer.y;
    if (active && Math.hypot(sx, sy) > 0.5 && Math.hypot(spin.vx, spin.vy) > 0.5) {
      const w = Math.atan2(spin.vx * sy - spin.vy * sx, spin.vx * sx + spin.vy * sy) / Math.max(dt, 1e-3);
      spin.rate += (Math.max(-1, Math.min(1, w / 8)) - spin.rate) * (1 - Math.exp(-dt * 5));
    } else spin.rate *= Math.exp(-dt * 2);
    if (Math.hypot(sx, sy) > 0.5) { spin.vx = sx; spin.vy = sy; }
    if (Math.abs(spin.rate) > 0.05) spin.sign = Math.sign(spin.rate);
    const turning = spin.sign * Math.max(0.3, Math.abs(spin.rate));
    finger.charge = holding ? Math.max(0, Math.min(1, ((this.nowMs() - finger.at) / 1000 - 0.35) / 1.4)) : 0;
    const fg = holding ? 1 : 0, u = this.u;
    u.radius = P.radius * (fg ? P.fingerSize : 1);
    u.push = P.push * (1 - finger.charge);
    u.swirl = (fg ? P.fingerSwirl : P.swirl) * turning;
    u.dragAmt = P.dragAmt * (fg ? 1.4 : 1);
    u.attract = P.attract + P.gather * finger.charge;
    u.hoverOn = (P.hover || fg) && active ? 1 : 0;
    this.bodies.touch.set(u);
    this.active = active;
    this.holding = holding;
  }

  /** after the frame: a blast and a shatter last one frame */
  endFrame() { vec4.set(this.burst, 0, 0, 0, 0); this.shatterAll = false; }

  /** for hooks and films: move the pointer (client pixels), or a finger that only swirls (it never gathers) */
  point(x: number, y: number, inside = true) { this.pointer.x = x; this.pointer.y = y; this.pointer.inside = inside; }
  touch(on: boolean) { this.finger.on = on; this.finger.at = Infinity; this.pointer.inside = on; this.pointer.hasLast = false; }
}
