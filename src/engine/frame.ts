// Frame assembly. A weft frame is the ordered list given to `kit.run`. Here systems put their GPU work under a named
// stage, and their CPU work (setting uniforms, posing skeletons) under a named phase; `main.ts` builds the run list
// from the stages in the order below, once, and calls the phases each frame before running it. Within a stage,
// items run in the order they were added. `frame.describe()` (and `bend.stats().frame`) prints the whole frame.
//
// Things that come and go (a world not on screen, the ?pip inset) are still in the list: their `enabled` decides.
// That keeps the list fixed, as weft intends (declare once, at setup).
//
// An item can bring followers (`follow`): whoever adds it to a stage adds them right after it, in the same stage. A
// view's scene pass brings its glow pass that way, so the main view (main.ts) and the gates' views (src/portals) get
// it without knowing it is there.
import type { Kit, RunEntry } from '@ericrius1/weft';
import type { Dancer } from '../dancer/dancer';
import type { ViewCtx } from './views';

/** GPU stages, in the order they run */
export const STAGES = [
  'sim',    // matter simulation: compute steps that move particles (and the readbacks that follow them)
  'cull',   // per view: level-of-detail culls that fill draw lists for that view's camera
  'gates',  // the views through live gates (src/portals): each one's scene and air, deepest first, so the views that
            // show them (the main one last) can sample them in their own scene pass this frame
  'scene',  // per view: the scene pass (the world, then the matter in it), then its glow pass (what translucent matter
            // adds, kept off the opaque scene: engine/views.ts)
  'surface', // per view with its own air (the main one, the inset): the world's surface step on the opaque scene (the
            // pool's and the temple's water), before anything translucent is composited over it
  'air',    // per view: the water bodies' surface, the glow's trails, then the light in the air and the glow over it
  'post',   // the main view's depth of field, trails, bloom
  'out',    // to the canvas (or the film's frames), and insets over it
  'end',    // swaps of ping-pong pairs
] as const;
export type Stage = (typeof STAGES)[number];

/** CPU phases, in the order they run each frame, before the GPU work */
export const PHASES = [
  'input',    // pointer, keys, webcam: what the players are doing
  'dancers',  // controllers pose the skeletons; the joints go up to the GPU
  'travel',   // dancers whose middle passed through a gate are carried to the other world (src/portals)
  'camera',   // the camera rig follows them
  'gates',    // the camera through a gate (and the main view with it), then the camera behind each live gate
  'worlds',   // each world on screen updates its light (the day going by)
  'matter',   // each matter kind sets its uniforms (it can read the camera and the world now)
  'post',     // the post chain's uniforms
  'audio',    // the score hears the bodies
] as const;
export type Phase = (typeof PHASES)[number];

/** what every per-frame callback is handed */
export interface FrameCtx {
  kit: Kit;
  /** seconds since the last frame (clamped), and the same in dance time (slowed or sped by the dance's speed) */
  dt: number;
  danceDt: number;
  /** dance time (s): what clips are sampled at */
  t: number;
  /** the frame's number (kit.frameIndex) */
  frame: number;
  /** the audio clock (s): when a sound made now should play */
  now: number;
  /** the music's clock: where we are in beats, and the tempo. Driven by a local clock now (audio/clock.ts); the
   *  music engine (wave 1, audio) and the network's shared clock will drive it later, through the same object */
  beat: { beats: number; bpm: number };
  /** the jogo's shared tension, 0 (calm) … 1 (the top: fusion is near), eased; 0 outside a jogo (src/play sets it in
   *  the 'input' phase). Worlds may read it for their mood: a slow intensifying of light */
  tension: number;
  /** who is dancing */
  dancers: readonly Dancer[];
  /** every view drawn this frame; views[0] is the main one */
  views: readonly ViewCtx[];
}

interface Entry { stage: Stage; item: RunEntry; owner: string }

const followers = new WeakMap<object, RunEntry[]>();
/** run `next` right after `item`, in whatever stage `item` is added to (engine/views.ts: a scene pass's glow pass) */
export function follow(item: object, ...next: RunEntry[]) { followers.set(item, [...(followers.get(item) ?? []), ...next]); }
interface Tick { phase: Phase; fn: (f: FrameCtx) => void; owner: string }

export class FrameBuilder {
  private items: Entry[] = [];
  private ticks: Tick[] = [];
  private afters: { fn: (f: FrameCtx) => void; owner: string }[] = [];
  private built: RunEntry[] | null = null;

  /** GPU work under a stage. `owner` is only for describe() */
  add(stage: Stage, item: RunEntry, owner = '?') {
    if (this.built) throw new Error(`frame: '${owner}' added work after the frame was built (declare at setup)`);
    this.items.push({ stage, item, owner });
    if (item && typeof item === 'object') for (const n of followers.get(item) ?? []) this.items.push({ stage, item: n, owner });
  }

  /** CPU work each frame, before the GPU work, under a phase */
  tick(phase: Phase, fn: (f: FrameCtx) => void, owner = '?') { this.ticks.push({ phase, fn, owner }); }

  /** CPU work each frame after the run is submitted (readbacks) */
  after(fn: (f: FrameCtx) => void, owner = '?') { this.afters.push({ fn, owner }); }

  /** the run list, in stage order (built once) */
  list(): RunEntry[] {
    if (this.built) return this.built;
    const order = new Map(STAGES.map((s, i) => [s, i]));
    this.built = this.items.map((e, i) => ({ e, i }))
      .sort((a, b) => order.get(a.e.stage)! - order.get(b.e.stage)! || a.i - b.i)
      .map(({ e }) => e.item);
    return this.built;
  }

  /** run the CPU phases in order */
  update(f: FrameCtx) {
    for (const p of PHASES) for (const t of this.ticks) if (t.phase === p) t.fn(f);
  }

  /** after kit.run */
  finish(f: FrameCtx) { for (const a of this.afters) a.fn(f); }

  /** the whole frame as text: one line per item and tick, in the order they run */
  describe(): string[] {
    const order = new Map(STAGES.map((s, i) => [s, i]));
    const label = (it: RunEntry) => (it && typeof it === 'object' && 'label' in it ? String((it as { label: string }).label) : String(it));
    const cpu = PHASES.flatMap((p) => this.ticks.filter((t) => t.phase === p).map((t) => `cpu ${p}: ${t.owner}`));
    const gpu = this.items.map((e, i) => ({ e, i })).sort((a, b) => order.get(a.e.stage)! - order.get(b.e.stage)! || a.i - b.i)
      .map(({ e }) => `gpu ${e.stage}: ${label(e.item)} (${e.owner})`);
    return [...cpu, ...gpu, ...this.afters.map((a) => `cpu after: ${a.owner}`)];
  }
}
