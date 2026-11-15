// The show: who is dancing, and the programme they dance (Gem Dancers' stage, cast and director, joined). It keeps
// the cast (a list of Dancers: their slot in the list is their slot on the GPU), dresses the stage for each programme
// (the dancers, their loadouts, how many particles each matter kind runs and where they live), and acts the
// programme's moments on every matter kind (rise, shatter, settle). A debug flag can swap the programme's cast for a
// demo (dancer/demos.ts) while everything else carries on.
// On the front of the game (the plain address) it opens already dancing: the two bodies last chosen (fire and water the
// first time), the rise a quick flourish under the page's fade-in, the camera turned so the hub's gates stand behind
// the pair (worlds/geode/front.ts joins the menu to it: a body chosen re-dresses its dancer with a flourish, a world
// chosen turns to its gate). A jogo or a demo taking the cast ends it.
import type { Motion } from '../skeleton/clips';
import { Track } from '../skeleton/clips';
import { Dancer } from './dancer';
import { MocapController } from './mocap';
import { CameraController } from './camera';
import { Programme, PROGRAMS, FRONT, danceParams, type Program, type Stagehand } from './programme';
import { gemsLoadout, layersOf, type MatterPasses } from '../matter/core/kind';
import type { BodyBuffers } from '../matter/core/bodies';
import { dressed, dressFromQuery, distinctDress } from '../matter/core/presets';
import type { CameraRig } from '../engine/camera';
import { LIMITS } from '../engine/limits';
import { matterParams as showParams } from '../matter/core/params';
import { budget } from '../engine/perf';
import { SHOTS } from '../engine/shots';
import { HUB_GATES, HUB_OPENING, hubParams } from '../worlds/geode/gates';

/** the address keys that make the page something other than the front of the game (src/play/index.ts keeps the same
 *  list for its menus; the front also gives way to ?jogo and a film) */
const NOT_FRONT = ['jogo', 'play', 'net', 'landmarks', 'wander', 'film', 'gates', 'fly', 'nomenu', 'pip', 'you', 'lock', 'roda', 'teach', 'npcs', 'perf', 'perfgroup'];
/** is this page the front of the game (the plain address, the show behind the menu)? */
export function isFront(q: URLSearchParams | null = typeof location === 'undefined' ? null : new URLSearchParams(location.search)) {
  return !!q && typeof document !== 'undefined' && !NOT_FRONT.some((k) => q.has(k));
}
/** the bodies last chosen on the front (kept in the browser), or fire and water */
const DRESS_KEY = 'energybending.front.dress';
export function lastDress(): [string, string] {
  try {
    const v = JSON.parse(localStorage.getItem(DRESS_KEY) ?? 'null');
    if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string' && x)) return distinctDress(v);
  } catch { /* no storage, or nothing kept */ }
  return ['fire', 'water'];
}
const keepDress = (d: string[]) => { try { localStorage.setItem(DRESS_KEY, JSON.stringify(d.slice(0, 2))); } catch { /* private window */ } };
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** the opening's rush: dance time runs this many times its pace at the first frame, easing to 1 over RUSH_S seconds */
const RUSH = 4, RUSH_S = 1.6;

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
  /** a loadout preset per dancer slot (matter/core/presets.ts; ?dress=a,b, bend.dress): kept on through restaging. The
   *  last name serves the slots after it; empty: as the programme or the demo dresses them */
  dress: string[] = dressFromQuery();
  /** dance time (s), and the dance time the matter began to rise (0: it doesn't) */
  t = 0;
  wakeAt = 0;
  wakeSpread = 2.2;
  /** the front of the game (the plain page): the show opens already dancing, in the last bodies chosen, the camera
   *  turned so a live gate stands behind them; it gives the stage up when a jogo or a demo takes the cast */
  readonly front: boolean;
  /** the front: the point (x, z) the camera keeps behind the dancers (a gate), and how far off it (rad) it stands; null
   *  leaves the yaw to the shots and to whoever drags */
  facing: { x: number; z: number; side: number } | null = null;
  private opened = false;
  private faceT = 0;
  /** the dance's own pace, while the opening rushes it (0: not rushing) */
  private speed = 0;
  private pieces: Map<string, Motion['pieces'][number]>;
  private baseCount: number;

  constructor(readonly motion: Motion, readonly kinds: readonly MatterPasses[], private bodies: BodyBuffers, private rig: CameraRig,
    private sound: ShowSound, private coarse: boolean) {
    this.pieces = new Map(motion.pieces.map((p) => [p.id, p]));
    showParams.count = budget().stones;   // the device's budget (engine/perf.ts: a phone's 9000, as `coarse` gave)
    this.baseCount = showParams.count;
    this.programme = new Programme(this, rig);
    this.front = isFront();
    if (this.front && !this.dress.length) this.dress = lastDress();
    // (the hub's own gates: only when the page opens in the geode)
    const w = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('world');
    if (this.front && (!w || w === 'geode')) this.face(HUB_OPENING.world);
  }

  /** the front: turn so the hub's gate to `world` stands behind the dancers (a world with no gate here: the opening's) */
  face(world: string) {
    const g = HUB_GATES[world] ?? HUB_GATES[HUB_OPENING.world];
    this.facing = { x: g[0], z: g[1], side: HUB_GATES[world] ? HUB_OPENING.side * Math.sign(g[0] || 1) : HUB_OPENING.side };
    this.rig.idle = Math.max(this.rig.idle, 4);
  }

  /** the front: change dancer d's body at once, with a flourish, and keep the choice for the next visit. The new layout
   *  is the flourish: matter the dancer no longer wears becomes spare and falls off it, the new matter rises from where
   *  it rested, feet first (a short rise: only what lies on the floor answers it; a blast would knock the partner too) */
  redress(d: number, name: string) {
    if (this.dress[d] === name) return;
    this.setDress(d, name);
    keepDress(this.dress);
    if (this.awake && this.wakeAt > 0) this.rise(0.7);
  }

  /** the front's opening (the first frame): awake, the rise a quick flourish already under way, the camera framed on
   *  the pair with a gate behind them from the first frame (the springs take it from there) */
  private open() {
    this.opened = true;
    hubParams.highBlade = false;
    this.speed = danceParams.speed;
    this.programme.open(FRONT);
    const s = SHOTS[this.program.shots[0]];
    // (a little further back than the shot, so the feet stand clear of the menu's strip)
    this.rig.zoom = 1.15;
    Object.assign(this.rig, { dist: s.dist * this.rig.zoom, pitch: s.pitch, height: s.height, fov: s.fov, idle: 0 });
    if (this.facing) this.rig.yaw = this.yawFor(this.facing, 0);
  }

  /** the yaw that puts (x, z) behind what the camera looks at, `side` off it, swaying slowly */
  private yawFor(f: { x: number; z: number; side: number }, t: number) {
    const tg = this.rig.target;
    return Math.atan2(-(f.x - tg[0]), -(f.z - tg[2])) + f.side + 0.12 * Math.sin(t * 0.09);
  }

  /** each frame on the front: the opening, a body being changed, the camera's slow drift round the facing */
  private stageFront(dt: number) {
    if (this.castOverride || this.you) {
      this.facing = null;
      if (this.opened) hubParams.highBlade = true;
      if (this.speed > 0) { danceParams.speed = this.speed; this.speed = 0; }
      return;
    }
    if (!this.opened) { this.open(); return; }
    // the opening's camera values went into the springs on the first frame; from the second the shots ease it
    if (this.rig.idle < 4 && this.faceT < 0.1) this.rig.idle = 4;
    this.faceT += dt;
    // the rise runs quick under the page's fade-in (dance time, so the matter too), easing to the dance's own pace
    if (this.speed > 0) {
      const k = Math.min(1, this.faceT / RUSH_S);
      danceParams.speed = this.speed * (1 + (RUSH - 1) * (1 - k * k * (3 - 2 * k)));
      if (k >= 1) this.speed = 0;
    }
    // someone dragged the camera: it's theirs until a world is chosen again
    if (this.rig.idle < 4) { this.facing = null; return; }
    if (this.facing) this.rig.yaw += wrap(this.yawFor(this.facing, this.faceT) - this.rig.yaw) * (1 - Math.exp(-dt * 0.9));
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
    them.forEach((d, k) => this.dressOne(d, k));
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

  /** put slot k's dress (if any) on a dancer, keeping the gem suite it wore */
  private dressOne(d: Dancer, k: number) {
    const name = this.dress.length ? this.dress[Math.min(k, this.dress.length - 1)] : '';
    if (!name) return;
    const gem = d.loadout.layers.find((l) => l.kind === 'gems');
    const l = dressed(name, String(gem?.params?.suite ?? 'Violet'));
    if (l) d.loadout = l; else console.warn(`dress: no preset '${name}' (matter/core/presets.ts)`);
  }

  /** dress dancer d in a preset by name and keep it on (bend.dress); '' takes the dress off (the next dance dresses
   *  it as the programme says) */
  setDress(d: number, name: string) {
    while (this.dress.length <= d) this.dress.push(this.dress[this.dress.length - 1] ?? '');
    this.dress[d] = name;
    if (this.dancers[d] && name) { this.dressOne(this.dancers[d], d); this.relayout(); }
  }

  /** change one dancer's loadout (bend.loadout) */
  setLoadout(d: number, loadout: Dancer['loadout']) {
    if (!this.dancers[d]) throw new Error(`no dancer ${d} (there are ${this.dancers.length})`);
    this.dancers[d].loadout = loadout;
    this.relayout();
  }

  /** each frame: the programme moves on (the dancers are posed by main.ts in the dancers phase) */
  update(dt: number) {
    if (this.front) this.stageFront(dt);
    this.programme.update(dt);
    // how much of each dancer's matter is on its body (Dancer.presence, read by the field): none while asleep in a
    // heap or after a shatter (wakeAt 0), rising with the matter over the rise's spread
    const on0 = this.awake && this.wakeAt > 0 ? Math.min(1, Math.max(0, (this.t - this.wakeAt) / Math.max(this.wakeSpread, 1e-3))) : 0;
    for (const d of this.dancers) d.presence = on0;
    const on = this.programme.act === 'dancing';
    if (on !== this.wasDancing) { this.wasDancing = on; for (const k of this.kinds) k.acts?.dancing(on); }
  }
  private wasDancing = false;
}
