// The show: who is dancing, and the programme they dance (Gem Dancers' stage, cast and director, joined). It keeps
// the cast (a list of Dancers: their slot in the list is their slot on the GPU), dresses the stage for each programme
// (the dancers, their loadouts, how many particles each matter kind runs and where they live), and acts the
// programme's moments on every matter kind (rise, shatter, settle). A debug flag can swap the programme's cast for a
// demo (dancer/demos.ts) while everything else carries on.
import type { Motion } from '../skeleton/clips';
import { Track } from '../skeleton/clips';
import { Dancer } from './dancer';
import { MocapController } from './mocap';
import { CameraController } from './camera';
import { Programme, PROGRAMS, type Program, type Stagehand } from './programme';
import { gemsLoadout, layersOf, type MatterPasses } from '../matter/core/kind';
import type { BodyBuffers } from '../matter/core/bodies';
import type { CameraRig } from '../engine/camera';
import { LIMITS } from '../engine/limits';
import { matterParams as showParams } from '../matter/core/params';

/** what the show needs from the sound (audio/score.ts) */
export interface ShowSound { setKey(key: number): void; rise(seconds: number): void; blast(strength: number): void }

/** a cast to dance instead of the programme's (dancer/demos.ts) */
export type CastFn = (p: Program, show: Show) => Dancer[];

const ENSEMBLE = ['indian', 'pirouette', 'lambada'];

export class Show implements Stagehand {
  readonly programme: Programme;
  dancers: Dancer[] = [];
  program: Program = PROGRAMS[0];
  /** you, through the webcam, when on: dancing among them */
  you: CameraController | null = null;
  /** a demo's cast, when a debug flag asks for one */
  castOverride: CastFn | null = null;
  /** dance time (s), and the dance time the matter began to rise (0: it doesn't) */
  t = 0;
  wakeAt = 0;
  wakeSpread = 2.2;
  private pieces: Map<string, Motion['pieces'][number]>;
  private baseCount: number;

  constructor(readonly motion: Motion, private kinds: readonly MatterPasses[], private bodies: BodyBuffers, private rig: CameraRig,
    private sound: ShowSound, private coarse: boolean) {
    this.pieces = new Map(motion.pieces.map((p) => [p.id, p]));
    if (coarse) showParams.count = 9000;
    this.baseCount = showParams.count;
    this.programme = new Programme(this, rig);
  }

  get awake() { return this.programme.awake; }
  get act() { return this.programme.act; }

  // ---------------------------------------------------------------- the stagehand (the programme calls these)
  stage(p: Program) {
    this.program = p;
    showParams.trail = p.trails ?? 0;
    showParams.count = Math.round(p.count ? p.count * (this.coarse ? 0.55 : 1) : this.baseCount);
    this.dancers = this.cast(p);
    this.relayout(true);
  }

  rise(spread: number) {
    for (const k of this.kinds) k.acts?.settle(false);
    this.wakeAt = Math.max(this.t, 1e-3);
    this.wakeSpread = spread;
    for (const k of this.kinds) k.acts?.rise(this.wakeAt, spread);
    this.sound.setKey(this.program.key);
    this.sound.rise(spread + 0.9);
  }

  shatter() {
    for (const k of this.kinds) k.acts?.settle(true);
    this.wakeAt = 0;
    const tg = this.rig.target;
    for (const k of this.kinds) k.acts?.shatter(tg[0], 1.0, tg[2], 3.5);
    this.sound.blast(4);
  }

  /** the cast or a loadout changed: capsules up to the GPU, each kind told where its particles live now */
  relayout(budget = false) {
    const D = Math.min(this.dancers.length, LIMITS.dancers), cast = this.dancers.slice(0, D);
    this.bodies.setRigs(cast.map((d) => d.rig));
    const placed = cast.map((d) => ({ rig: d.rig, loadout: d.loadout }));
    for (const k of this.kinds) {
      if (budget) k.resize?.({ count: showParams.count });
      k.layout(layersOf(k.id, placed));
    }
  }

  // ---------------------------------------------------------------- the cast
  private cast(p: Program): Dancer[] {
    const them = this.castOverride ? this.castOverride(p, this) : this.castThem(p);
    if (!this.you) return them;
    const ring = !!p.ring;
    this.you.baseX = ring ? 0 : p.piece === 'ensemble' ? 0 : 1.7;
    this.you.z = ring ? 0 : p.piece === 'ensemble' ? 1.8 : 0.7;
    return [...them.slice(0, LIMITS.dancers - 1), new Dancer('you', this.you, gemsLoadout('Dawn'))];
  }

  /** a programme's own dancers: a piece's dancers, a mandala of copies on a ring, or the ensemble of three */
  castThem(p: Program): Dancer[] {
    const suite = (d: number) => gemsLoadout(p.suites[d % p.suites.length]);
    if (p.piece === 'ensemble') {
      return ENSEMBLE.map((pid, k) => {
        const c = new MocapController(new Track(this.motion, this.pieces.get(pid)!, 0), k * 3.7);
        c.x = (k - 1) * 2.1;
        c.yaw = (k - 1) * -0.35;
        return new Dancer(`${pid}`, c, suite(k));
      });
    }
    const piece = this.pieces.get(p.piece) ?? this.pieces.get('salsa')!;
    if (p.ring) {
      // a mandala: copies on a ring, each turned with its place on it (so they wheel together), each a beat behind
      const n = Math.min(p.ring, LIMITS.dancers), R = 0.55 + n * 0.2;
      return Array.from({ length: n }, (_, k) => {
        const th = (k / n) * Math.PI * 2;
        const c = new MocapController(new Track(this.motion, piece, 0), -k * (p.canon ?? 0));
        c.inPlace = true;
        c.yaw = th;
        c.x = Math.cos(th) * R;
        c.z = -Math.sin(th) * R;
        return new Dancer(`${piece.id}.${k}`, c, suite(k));
      });
    }
    return piece.dancers.map((_, d) => new Dancer(`${piece.id}.${d}`, new MocapController(new Track(this.motion, piece, d)), suite(d)));
  }

  /** change one dancer's loadout (bend.loadout) */
  setLoadout(d: number, loadout: Dancer['loadout']) {
    if (!this.dancers[d]) throw new Error(`no dancer ${d} (there are ${this.dancers.length})`);
    this.dancers[d].loadout = loadout;
    this.relayout();
  }

  /** each frame: the programme moves on (the dancers are posed by main.ts in the dancers phase) */
  update(dt: number) {
    this.programme.update(dt);
    const on = this.programme.act === 'dancing';
    if (on !== this.wasDancing) { this.wasDancing = on; for (const k of this.kinds) k.acts?.dancing(on); }
  }
  private wasDancing = false;
}
