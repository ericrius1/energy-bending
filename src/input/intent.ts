// The Intent: one per player per frame, whatever the device (keyboard, gamepad, touch, the camera, a bot, a script).
// Ported from the 2D prototype (sketches/dance-first-2d/js/input.js), with its 3D fields. A source turns its device
// into an Intent each frame; an IntentController (dancer/intent-controller.ts) turns the Intent into body physics and
// moves. The pure helpers here (dead zones, hysteresis, peaks, edge bookkeeping) run in Node for the tests.
//
// Fields:
//   moveX  -1..1 right       moveY  -1..1 (+ up; < -0.5 = crouch / drop / fast fall)
//   moveZ  -1..1 + = into the screen (away from the camera); ignored in the locked 2D view
//   jump (edge) jumpHeld   punch (edge) kick (edge) spin (edge) dodge (edge) form (edge) merge (held)
//   dash (edge)  the duel's burst (docs/design/duel.md): its direction is the move stick (8-way; none: the facing).
//               Only a body on the duel's profile dashes (Character.phys.dash); the jogo's ignores it
//   power1, power2 (edges, optional)  the duel's two powers (shared/powers.ts, by the body's matter), aimed by the move
//               stick (none: the facing); the duel's `form` edge is its power form (at full flow)
//   aimX, aimY  the bending hand: direction and reach (length 0..1) in the screen plane, relative to the dancer's
//               shoulder; aimActive  whether the hand is being played
//   camX, camY  free-camera look rate (-1..1 for a stick; a fast mouse drag may exceed 1)
//   lock (edge) toggle the 2D lock      interact (edge) use a portal / build
// Extras, optional (the Character uses them when present):
//   dodgeHeld, punchHeld  held states (a held block; a strike held into the throw)
//   auDir  -1|+1 with spin: a cartwheel that way (gamepad bumpers)    flick  the punch came from a stick flick
//   limb ('LW'|'RW'|'LA'|'RA')  the camera body's striking limb     limbs, hasLegs  the camera body itself
//   walk  the keyboard's walk modifier (free mode)     source  the source's name
// Edges are resolved per update: a press between two updates is reported once, however short.

export type Limb = 'LW' | 'RW' | 'LA' | 'RA';
export type InputMode = 'locked' | 'free';
/** what the buttons mean: the jogo's (the dance) or the duel's (Shift or K, RT or B, a stick flick: the dash; the moves
 *  they took move over: keyboard.ts, gamepad.ts and touch.ts list each). Whoever seats a source sets it (InputHub.scheme) */
export type Scheme = 'jogo' | 'duel';

export interface Intent {
  moveX: number; moveY: number; moveZ: number;
  jump: boolean; jumpHeld: boolean;
  punch: boolean; kick: boolean; spin: boolean; dodge: boolean; form: boolean; merge: boolean;
  /** the duel's dash (edge) */
  dash: boolean;
  /** the duel's two powers (edges; the duel's scheme only) */
  power1?: boolean;
  power2?: boolean;
  aimX: number; aimY: number; aimActive: boolean;
  camX: number; camY: number;
  lock: boolean; interact: boolean;
  dodgeHeld: boolean; punchHeld: boolean;
  auDir?: number;
  flick?: boolean;
  limb?: Limb;
  /** the camera body: 13 landmarks (39 floats, metres) about the hips' middle, in the dancer's own frame (x the
   *  dancer's left, y up, z forward), and whether its legs are seen */
  limbs?: Float32Array | null;
  hasLegs?: boolean;
  /** the camera body's pinch state per hand (diagnostics) */
  pinch?: { L: PinchState; R: PinchState };
  walk?: boolean;
  source?: string;
}

export interface PinchState { on: boolean; conf: number; ratio: number; fine?: boolean }

/** anything that makes Intents: a device, a bot, a script */
export interface IntentSource {
  readonly name: string;
  /** 'locked' (the 2D side view) or 'free' (3D): some controls mean different things in each */
  mode: InputMode;
  /** the jogo's buttons or the duel's (default the jogo's; a bot or the camera body ignores it) */
  scheme?: Scheme;
  update(dt: number): Intent;
}

export function makeIntent(): Intent {
  return {
    moveX: 0, moveY: 0, moveZ: 0, jump: false, jumpHeld: false, punch: false, kick: false, spin: false, dodge: false,
    dash: false, form: false, merge: false, aimX: 0, aimY: 0, aimActive: false, camX: 0, camY: 0, lock: false, interact: false,
    dodgeHeld: false, punchHeld: false,
  };
}

export const EDGES = ['jump', 'punch', 'kick', 'spin', 'dodge', 'dash', 'form', 'lock', 'interact', 'power1', 'power2'] as const;
export const HELDS = ['jumpHeld', 'merge', 'dodgeHeld', 'punchHeld', 'aimActive'] as const;
const AXES = ['moveX', 'moveY', 'moveZ', 'camX', 'camY'] as const;

/** two devices driving one player: the bigger axis wins, any button counts */
export function mergeIntents(a: Intent, b: Intent): Intent {
  const o = makeIntent();
  const big = (x: number, y: number) => (Math.abs(x) >= Math.abs(y) ? x : y);
  for (const k of AXES) o[k] = big(a[k] || 0, b[k] || 0);
  for (const k of [...EDGES, ...HELDS]) o[k] = !!(a[k] || b[k]);
  const src = b.aimActive && !a.aimActive ? b : a;
  o.aimX = src.aimX; o.aimY = src.aimY;
  o.auDir = a.auDir ?? b.auDir;
  o.flick = a.flick ?? b.flick;
  o.limb = a.limb ?? b.limb;
  o.limbs = a.limbs ?? b.limbs;
  o.hasLegs = a.hasLegs ?? b.hasLegs;
  o.walk = a.walk || b.walk;
  for (const k of Object.keys(o) as (keyof Intent)[]) if (o[k] === undefined) delete o[k];
  return o;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** radial dead zone with rescale: |v| < inner → 0, inner..outer → 0..1 (direction kept), > outer → 1 */
export function radialDeadzone(x: number, y: number, inner = 0.2, outer = 0.95): [number, number] {
  const m = Math.hypot(x, y);
  if (m < inner || m === 0) return [0, 0];
  const k = clamp((m - inner) / (outer - inner), 0, 1) / m;
  return [x * k, y * k];
}

/** on above `on`, off below `off` (a trigger that doesn't chatter) */
export class Hysteresis {
  state = false;
  constructor(public on: number, public off: number) {}
  update(v: number) {
    if (!this.state && v >= this.on) this.state = true;
    else if (this.state && v <= this.off) this.state = false;
    return this.state;
  }
}

/** a speed peak: rises above `min`, then falls below `drop` × the peak → fires once with the peak value */
export class PeakDetector {
  peak = 0;
  t = 0;
  constructor(public min: number, public drop = 0.5, public cool = 0.3) {}
  update(v: number, dt: number) {
    this.t = Math.max(0, this.t - dt);
    if (v > this.peak) { this.peak = v; return 0; }
    if (this.peak >= this.min && v < this.peak * this.drop) {
      const p = this.peak;
      this.peak = v;
      if (this.t <= 0) { this.t = this.cool; return p; }
      return 0;
    }
    if (v < this.min * 0.3) this.peak = v;
    return 0;
  }
}

/** edge and held bookkeeping shared by the sources */
export class Buttons {
  private down = new Set<string>();
  private edges = new Set<string>();
  press(n: string) { if (!this.down.has(n)) { this.down.add(n); this.edges.add(n); } }
  release(n: string) { this.down.delete(n); }
  held(n: string) { return this.down.has(n); }
  took(n: string) { return this.edges.has(n); }
  clear() { this.edges.clear(); }
  reset() { this.down.clear(); this.edges.clear(); }
}

export const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export const hasDOM = typeof window !== 'undefined' && typeof document !== 'undefined';
