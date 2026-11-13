// The brains in the page, behind demo flags (main.ts wires them with one line each, beside the other demos):
//   ?play&partner[=calm|fierce|mirror]   you against the partner (seat 1), the view locked to the world's stage
//   ?play&partner=two                    two partners playing each other (for films), locked
//   ?roda                                two partners playing each other, with free dancers in a ring round them
//   ?npcs=5                              free dancers wandering, dancing and watching (no jogo)
//   ?teach                               the teacher's call and response (seat 1); &student puts a scripted student
//                                        on seat 0 (to film the drill)
// Extras: &level=0.7 holds the brains' music level when the sound isn't running (headless captures), &lock locks
// the view for ?roda. The jogo's rules run here through the brains' own small referee (jogo.ts) until src/play owns
// them; it also eases each player's power form toward the rules'. `window.bend.brains` exposes the referee's numbers.
import type { FrameBuilder, FrameCtx } from '../engine/frame';
import type { Show } from '../dancer/show';
import type { World } from '../worlds/world';
import type { Music } from '../audio/music';
import type { Motion } from '../skeleton/clips';
import type { PlayHandle } from '../dancer/play';
import { IntentController } from '../dancer/intent-controller';
import { Dancer } from '../dancer/dancer';
import { movesOf } from '../dancer/wander';
import { gemsLoadout } from '../matter/core/kind';
import type { Character } from '../dancer/character';
import { LIMITS } from '../engine/limits';
import { BotSource } from '../input/touch';
import type { Brain, MusicView, RulesView, StageView } from './brain';
import type { Direction } from './direct';
import { Scene, type SceneBody } from './scene';
import { BrainDriver } from './driver';
import { JogoReferee } from './jogo';
import { ClipLibrary } from './clips';
import { PartnerBrain, PRESETS, type PresetName } from './partner';
import { NpcBrain, rodaOf, rodaSpot } from './npc';
import { StudentBrain, TeacherBrain } from './teacher';

export interface BrainsCtx {
  query: URLSearchParams;
  frame: FrameBuilder;
  show: Show;
  music: Music;
  /** the main view's world, and any world by id */
  world: () => World;
  worldOf: (id: string) => World;
  motion: Motion;
  travel: Promise<Motion | null> | Motion | null;
  lock: (on: boolean) => void;
  wake: () => void;
}

const SUITES = ['Dawn', 'Ember', 'Forest', 'Blue lace', 'Midnight', 'Violet'];

/** the page's brains: a Scene over every dancer, a driver per brain, the referee for the jogo */
class PageBrains {
  readonly scene = new Scene();
  readonly drivers: BrainDriver[] = [];
  readonly npcs: { c: IntentController; d: Dancer; driver: BrainDriver }[] = [];
  referee: JogoReferee | null = null;
  /** the jogo's rules as another referee publishes them (src/play's), in place of this file's own */
  rules: (() => RulesView | null) | null = null;
  seats: IntentController[] = [];
  private grooved = false;
  private level: number;

  constructor(private ctx: BrainsCtx, readonly clips: ClipLibrary) {
    this.level = Number(ctx.query.get('level') ?? 0.6);
  }

  music(): MusicView {
    const m = this.ctx.music, e = m.engine;
    // (held for captures: &level=, and &mood= for the mood's name, Roda for the low game)
    if (!m.live && !this.ctx.query.has('film')) return { level: this.level, breakdown: false, mood: this.ctx.query.get('mood') ?? e.mood?.name };
    if (e.level >= 2) this.grooved = true;
    return { level: Math.min(1, e.level / 4 + 0.1), breakdown: e.level === 0 && this.grooved, mood: e.mood?.name };
  }

  stageFor(c: Character, d: Dancer | null): StageView {
    const w = d?.world ? this.ctx.worldOf(d.world) : this.ctx.world();
    return {
      plane: c.plane, stage: w.stages[0] ?? null, terrain: { groundAt: (x, z) => w.groundAt(x, z) },
      gates: w.portals.map((p) => ({ id: p.id, at: p.at, normal: p.normal, radius: p.radius })), room: w.room,
    };
  }

  /** a brain on a seat's controller */
  seat(c: IntentController, brain: Brain, seat: number) {
    const body = { id: `seat.${seat}`, seat, character: c.character };
    const d = new BrainDriver(brain, body, this.scene, () => this.stageFor(c.character, null));
    d.defaultFlourish = 'pirueta';
    c.source = d.source();
    this.drivers.push(d);
    return d;
  }

  /** a free dancer: an IntentController walking on the world's floor, motion-matched, on a brain */
  npc(brain: Brain, k: number, at: [number, number]) {
    const ctx = this.ctx;
    const moves = movesOf(ctx.motion, this.travel);
    // the floor of the world the dancer is in (Dancer.world, from the portals' worldOf), not the main view's: a free
    // dancer who walked through a gate walks on the far world's ground
    let dancer: Dancer | null = null;
    const here = () => (dancer?.world ? ctx.worldOf(dancer.world) : ctx.world());
    const terrain = { groundAt: (x: number, z: number) => here().groundAt(x, z) };
    const c = new IntentController(ctx.motion.skeletons[0], { seat: 2 + k, terrain, moves, at: [at[0], terrain.groundAt(at[0], at[1]), at[1]] });
    dancer = new Dancer(`npc.${k}`, c, gemsLoadout(SUITES[k % SUITES.length]));
    const body = { id: dancer.id, seat: -1, character: c.character };
    const d = dancer;
    const driver = new BrainDriver(brain, body, this.scene, () => this.stageFor(c.character, d));
    c.source = driver.source();
    this.drivers.push(driver);
    this.npcs.push({ c, d, driver });
    return d;
  }
  travel: Motion | null = null;

  /** each frame, before the dancers: who is where, the clock, the jogo's state */
  see(f: FrameCtx) {
    const bodies: SceneBody[] = this.seats.map((c, i) => ({ id: `seat.${i}`, seat: i, character: c.character }));
    for (const n of this.npcs) bodies.push({ id: n.d.id, seat: -1, character: n.c.character });
    this.scene.bodies = bodies;
    this.scene.update({ t: f.t, dt: f.danceDt, beat: f.beat.beats, bpm: f.beat.bpm, music: this.music(), rules: this.rules?.() ?? this.referee?.view() ?? null });
  }

  /** each frame, after the dancers: the referee, and the players' power forms */
  judge(f: FrameCtx, dancers: readonly Dancer[]) {
    const R = this.referee;
    if (!R) return;
    R.update((f.beat.beats * 60000) / f.beat.bpm, [this.seats[0]?.intent ?? null, this.seats[1]?.intent ?? null]);
    for (let i = 0; i < 2; i++) {
      const d = dancers[i];
      if (d) d.form += ((R.session.form[i] ? 1 : 0) - d.form) * (1 - Math.exp(-f.dt / 0.6));
    }
  }
}

function installTicks(pb: PageBrains, ctx: BrainsCtx, dancers: () => readonly Dancer[]) {
  ctx.frame.tick('input', (f) => pb.see(f), 'brains: what they see');
  ctx.frame.tick('travel', (f) => pb.judge(f, dancers()), 'brains: the jogo\'s referee');
  Object.assign(window, { brains: pb });
  // (window.bend is made after the demos: hang the report on it on the first frame)
  const report = () => ({
    stats: pb.referee ? { ...pb.referee.stats, distinct: pb.referee.stats.distinct.map((x) => [...x]) } : null, state: pb.referee?.view() ?? null,
    npcs: pb.npcs.map((n) => ({ id: n.d.id, mode: (n.driver.brain as NpcBrain).mode, x: +n.c.character.x.toFixed(2), z: +n.c.character.z.toFixed(2) })),
  });
  let hung = false;
  ctx.frame.tick('input', () => {
    const bend = (window as unknown as { bend?: Record<string, unknown> }).bend;
    if (!hung && bend) { bend.brains = report; hung = true; }
  }, 'brains: bend.brains()');
}

/** ?play&partner, ?roda, ?teach: brains on the play demo's seats (and free dancers round them) */
export async function brainsPlay(ctx: BrainsCtx & { play: PlayHandle }) {
  const { query, play } = ctx;
  const travel = await ctx.travel;
  const pb = new PageBrains(ctx, new ClipLibrary(ctx.motion, travel));
  pb.travel = travel;
  const human = play.controllers[0];
  const preset = (q: string | null): PresetName => (q && q in PRESETS ? (q as PresetName) : 'playful');
  if (query.has('teach')) {
    const T = new TeacherBrain({ seed: 2 });
    const c1 = play.addPlayer(new BrainDriverStub());
    pb.seats = [human, c1];
    pb.seat(c1, T, 1);
    if (query.has('student')) pb.seat(human, new StudentBrain({ seed: 3 }), 0);
    ctx.lock(true);
  } else {
    const two = query.get('partner') === 'two' || query.has('roda');
    const c1 = play.addPlayer(new BrainDriverStub());
    pb.seats = [human, c1];
    pb.seat(c1, new PartnerBrain({ preset: preset(query.get('partner')), seed: 23 }), 1);
    if (two) pb.seat(human, new PartnerBrain({ preset: 'playful', seed: 11 }), 0);
    if (query.has('roda')) {
      const n = Math.min(Number(query.get('roda') || 5) || 5, LIMITS.dancers - 2);
      const ring = rodaOf(n), w = ctx.world(), p = w.stages[0];
      // (they wear their own gems: the show's dress names the two seats, and its last name would serve them too)
      while (ctx.show.dress.length < Math.max(2, play.dancers.length) + n) ctx.show.dress.push('');
      for (let k = 0; k < n; k++) {
        // (they start a little out from their places and walk in)
        const spot = p ? rodaSpot(p, ring[k], 0, w.room) : [Math.cos(k) * 5, Math.sin(k) * 3] as [number, number];
        const at: [number, number] = [spot[0] * 1.08, spot[1] * 1.15];
        play.addDancer(pb.npc(new NpcBrain({ seed: 100 + k, clips: pb.clips, roda: ring[k], params: { energy: 0.3 + 0.6 * ((k * 0.37) % 1) } }), k, at));
      }
      if (query.has('lock')) ctx.lock(true);
    } else ctx.lock(true);
  }
  pb.referee = new JogoReferee([human.character, pb.seats[1].character], ctx.world().id, 0);
  installTicks(pb, ctx, () => play.dancers);
  if (query.has('roda')) exposeRoda(pb, ctx);
  return pb;
}

/** ?npcs=N: free dancers living in the world (they replace the programme's cast) */
export async function npcsDemo(ctx: BrainsCtx, n: number) {
  const travel = await ctx.travel;
  const pb = new PageBrains(ctx, new ClipLibrary(ctx.motion, travel));
  pb.travel = travel;
  const cast: Dancer[] = [];
  const count = Math.max(1, Math.min(n, LIMITS.dancers));
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    cast.push(pb.npc(new NpcBrain({ seed: 200 + k, clips: pb.clips, params: { energy: 0.25 + 0.7 * ((k * 0.61) % 1), radius: 5 } }), k, [Math.cos(a) * 3.5, Math.sin(a) * 2.5 - 2]));
  }
  ctx.show.castOverride = () => cast;
  ctx.show.stage(ctx.show.program);
  installTicks(pb, ctx, () => cast);
  return pb;
}

/** the roda round a jogo the game plays (src/play, ?jogo=partner|same): `n` free dancers ringing the stage behind its
 *  plane, watching, clapping, answering a unison or a fusion; they see the jogo's two seats and the room's rules */
export async function rodaForJogo(ctx: BrainsCtx & { play: PlayHandle }, n: number, seats: () => readonly (Character | null)[], rules: () => RulesView | null) {
  const travel = await ctx.travel;
  const pb = new PageBrains(ctx, new ClipLibrary(ctx.motion, travel));
  pb.travel = travel;
  pb.rules = rules;
  const count = Math.max(0, Math.min(n, LIMITS.dancers - 2));
  const ring = rodaOf(count), w = ctx.world(), p = w.stages[0];
  // they wear their own gems (the show's dress names the two seats; its last name would serve them too) and the
  // camera frames the two seats, not the ring
  const seated = Math.max(2, ctx.play.dancers.length);
  while (ctx.show.dress.length < seated + count) ctx.show.dress.push('');
  for (let k = 0; k < count; k++) {
    const spot = p ? rodaSpot(p, ring[k], 0, w.room) : [Math.cos(k) * 5, Math.sin(k) * 3] as [number, number];
    const d = pb.npc(new NpcBrain({ seed: 100 + k, clips: pb.clips, roda: ring[k], params: { energy: 0.3 + 0.6 * ((k * 0.37) % 1) } }), k, [spot[0] * 1.08, spot[1] * 1.15]);
    d.framed = false;
    ctx.play.addDancer(d);
  }
  // the scene: the jogo's seats (simulated here or not) and the ring
  ctx.frame.tick('input', (f) => {
    const s = seats();
    const bodies: SceneBody[] = [];
    for (let i = 0; i < 2; i++) { const c = s[i]; if (c) bodies.push({ id: `seat.${i}`, seat: i, character: c }); }
    for (const x of pb.npcs) bodies.push({ id: x.d.id, seat: -1, character: x.c.character });
    pb.scene.bodies = bodies;
    pb.scene.update({ t: f.t, dt: f.danceDt, beat: f.beat.beats, bpm: f.beat.bpm, music: pb.music(), rules: rules() });
  }, 'brains: the roda sees the jogo');
  exposeRoda(pb, ctx);
  return pb;
}

/** the ring for the game and for films, as `bend.roda`: where each free dancer stands and what it is doing, buying the
 *  game (one walks into the roda to a seat's spot, for the game to seat when it is ready: `buy(k, seat)`, `release(k)`),
 *  and directing any dancer the brains see (`direct(id, direction)`, direct.ts). Not wired into src/play */
function exposeRoda(pb: PageBrains, ctx: BrainsCtx) {
  const api = {
    npcs: () => pb.npcs.map((n) => ({ id: n.d.id, mode: (n.driver.brain as NpcBrain).mode, x: +n.c.character.x.toFixed(2), z: +n.c.character.z.toFixed(2), clapAt: n.driver.brain.body.clapAt })),
    /** the nearest two free dancers stand this far apart (m) */
    spacing: () => {
      let best = Infinity;
      for (const a of pb.npcs) for (const b of pb.npcs) if (a !== b) best = Math.min(best, Math.hypot(a.c.character.x - b.c.character.x, a.c.character.z - b.c.character.z));
      return best;
    },
    buy: (k: number, seat: number) => {
      const n = pb.npcs[k], s = pb.scene.bodies.find((b) => b.seat === seat)?.character;
      if (!n || !s) return false;
      (n.driver.brain as NpcBrain).buy([s.x, s.z]);
      return true;
    },
    release: (k: number) => { const n = pb.npcs[k]; if (n) (n.driver.brain as NpcBrain).release(); },
    bought: (k: number) => !!pb.npcs[k] && (pb.npcs[k].driver.brain as NpcBrain).bought,
    direct: (id: string, d: Direction | null) => pb.scene.direct(id, d),
  };
  let hung = false;
  ctx.frame.tick('input', () => {
    const bend = (window as unknown as { bend?: Record<string, unknown> }).bend;
    if (!hung && bend) { bend.roda = api; hung = true; }
  }, 'brains: bend.roda');
}

/** a placeholder source until the driver's own replaces it (addPlayer wants one) */
class BrainDriverStub extends BotSource { constructor() { super(null, 'brain'); } }
