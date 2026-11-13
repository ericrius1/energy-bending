// The Brain contract: a dancer that is not a person decides an Intent each frame from what it can see, exactly as a
// player's device would (src/input/intent.ts), so the body, the moves, the rules and the network downstream cannot
// tell a brain from a person. What a brain may see is spelled out here, once, as a `Sight`: its own body, the other
// dancers (their poses, where they are, the moves they have started, replayable from their start events), the beat,
// the stage, the jogo's state, and the music's level. Nothing else: no peeking at another brain's plans.
//
// A brain also has a `body` it may set: hints for what an Intent cannot say (which named move "spin up" means this
// time, how much ginga, a clip to groove to, where to look). The driver (driver.ts) lays them on the Character before
// it steps, the same way ?play sets a player's flourish. Brains are deterministic given their seed: their only
// randomness is a `Rng` (below) seeded at construction, and their only clock is the Sight's.
import type { Character, Terrain } from '../dancer/character';
import type { StagePlane } from '../engine/camera';
import type { Intent } from '../input/intent';
import type { RulesEvent, Phase } from '../../shared/protocol.ts';
import type { ClipGroove } from './clips';
import type { Direction } from './direct';

export type V3 = [number, number, number];

/** a move another dancer started, as a brain sees it: its name, how long ago it started, and its start event (what
 *  Character.shapesAt replays: the move's hit capsules at any time after its start) */
export interface SeenMove {
  name: string;
  serial: number;
  /** seconds since it started (the observer's clock) */
  age: number;
  attack: boolean;
  /** the start event: { move, x, y, z, dir, yaw, aim3, fdir, vx, vy, vz, air, bpm, hand, serial } */
  ev: Record<string, any>;
  /** beat (music clock) at which it started */
  beat: number;
}

/** another dancer, as seen */
export interface Other {
  id: string;
  /** the jogo seat (0 or 1), or -1 for a dancer outside the jogo (an NPC, a guest) */
  seat: number;
  root: V3;
  yaw: number;
  v: V3;
  /** 13 landmarks in the world (39 floats, metres), or null if only the root is known */
  pose: Float32Array | null;
  /** Character.flags (dodging 1, airborne 2, blocking 4, facing left 8, staggered 16) */
  flags: number;
  /** its moves of the last few seconds, oldest first */
  moves: readonly SeenMove[];
  /** the body itself, when it is simulated here (a local player, another brain); null over the network */
  character: Character | null;
}

/** the gates a brain may walk through (a World's PortalDefs, reduced to what walking needs) */
export interface Gate { id: string; at: V3; normal: V3; radius: number }

/** where the dancer is */
export interface StageView {
  /** the locked plane (the 2D jogo), or null in free 3D */
  plane: StagePlane | null;
  /** the world's first stage plane even when the view is free (NPCs keep off it; a roda rings it) */
  stage: StagePlane | null;
  terrain: Terrain;
  gates: readonly Gate[];
  /** how far from the world's middle a body may roam (World.room, m) */
  room: number;
}

/** the jogo's state, as the rules publish it (shared/rules.ts), plus this frame's events */
export interface RulesView {
  phase: Phase;
  tension: number;
  mergeReady: boolean;
  flow: [number, number];
  form: [0 | 1, 0 | 1];
  fusion: boolean;
  events: readonly RulesEvent[];
}

/** the music: its level 0 … 1 (the groove's 0 … 4 over 4), whether it has fallen into a breakdown, and the mood's
 *  name when the page knows it (audio/harmony.ts: Ember, Midnight, Sunrise, Neon, Roda) */
export interface MusicView { level: number; breakdown: boolean; mood?: string }

/** everything a brain may know this frame */
export interface Sight {
  /** seconds (dance time) and this frame's step */
  t: number;
  dt: number;
  /** the music's clock: beats now, beats at the last frame, the tempo */
  beat: number;
  beatPrev: number;
  bpm: number;
  music: MusicView;
  /** its own body (read it; don't drive it except through the Intent and `body`) */
  self: Character;
  seat: number;
  id: string;
  others: readonly Other[];
  /** the other jogo seat, when this dancer plays the jogo */
  partner: Other | null;
  stage: StageView;
  rules: RulesView | null;
  /** a director's loose intentions for this dancer (direct.ts: a film timeline), or null: the brain's own */
  direction?: Direction | null;
}

/** what an Intent can't say; the driver applies it before the body steps */
export interface BodyHints {
  /** the named move "spin with the stick up" starts (a clip phrase, a clap, the pirouette), or null for the default */
  flourish: string | null;
  /** how much ginga (0 still … 1 full) when nothing else plays */
  groove: number;
  /** a clip to groove to in place instead of the ginga, and how much of it (eased by the driver) */
  clip: ClipGroove | null;
  clipW: number;
  /** where to face and look when standing (world), or null: the partner (the jogo's own lookAt) */
  lookAt: V3 | null;
  /** 0 … 1: how low the ginga is (Angola's ginga baixa: hips down, knees open, toward the cocorinha) */
  low: number;
  /** dance time (s) at which this dancer's hands last met in a clap (-Infinity: never), for whatever lights it */
  clapAt: number;
}

export const newHints = (): BodyHints => ({ flourish: null, groove: 1, clip: null, clipW: 0, lookAt: null, low: 0, clapAt: -Infinity });

export interface Brain {
  readonly name: string;
  readonly body: BodyHints;
  /** decide this frame's Intent */
  think(s: Sight): Intent;
}

/** a small seeded random source (mulberry32): every brain owns one, so a seed replays a dance exactly */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  chance(p: number) { return this.next() < p; }
  /** a standard normal draw (Box-Muller) */
  normal() { const u = Math.max(1e-9, this.next()), v = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  /** a human reaction time (s) about a median: log-normal (a tail of slow reads, no impossibly quick ones) of spread
   *  `sigma`, kept within 0.65 … 2 × the median, and now and then (`lapse`) a moment's inattention on top */
  reaction(median: number, sigma = 0.2, lapse = 0.05) {
    const x = Math.min(median * 2, Math.max(median * 0.65, median * Math.exp(sigma * this.normal())));
    return x + (this.next() < lapse ? this.range(0.1, 0.25) : 0);
  }
  pick<T>(xs: readonly T[]): T { return xs[Math.min(xs.length - 1, Math.floor(this.next() * xs.length))]; }
  /** one of `xs` by weight */
  weighted<T>(xs: readonly T[], w: (x: T) => number): T | null {
    let sum = 0;
    for (const x of xs) sum += Math.max(0, w(x));
    if (sum <= 0) return null;
    let r = this.next() * sum;
    for (const x of xs) { r -= Math.max(0, w(x)); if (r <= 0) return x; }
    return xs[xs.length - 1];
  }
}
