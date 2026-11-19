// The jogo, joined to the game: main.ts calls `registerPlay(app)` once, and this decides from the page's address what
// the page is:
//   ?jogo=same       two dancers on one screen (the first device to press plays dancer 1, the next dancer 2; until a
//                    second device comes, the partner dances 2)
//   ?jogo=partner    against a partner brain: src/ai's PartnerBrain (&partner=playful|calm|fierce|mirror; playful by
//                    default; &partner=standin the jogo's own little stand-in, partner.ts)
//   ?jogo=online&room=CODE[&create][&watch]   one seat of a room on the room server (&server=ws://…/ws; default this
//                    host's 5417); &watch dances as a free guest
//   ?jogo=script&script=NAME    a scripted jogo (src/play/scripts/NAME.json), for films and captures; also bend.jogo.run
//                    (&bpm=N plays a local room at another tempo: a film's timeline sets it; &hold=S starts its room
//                    S seconds late, the dancers asleep until then)
//                    (&partner=… with a script: the partner brain plays dancer 2, the script dancer 1; &seed=N its seed)
//   &world=pool &dress=fire,water &lock (the side view; open 3D is the default, report 20-roam: &free is kept, a no-op;
//                    a script keeps the side view unless &free)
//   nothing          the front of the game over the show (menu.ts); ?play stays the solo free dance. The front can
//                    begin a jogo or a duel in the same page: bend.front.begin(mode | 'duel', query, joined?)
//                    (geode/front.ts calls it; for the duel the page's address is already the duel's)
//
// Each frame (phases in engine/frame.ts): input — the room's clock moves on, the beat and the music follow it, a
// script cues; travel (after the gates carried anyone) — the jogo hears the dancers' moves and judges the exchanges,
// and everything that happened is felt (feel), fused (fusion), measured (hud), staged (flow) and built (build); camera
// (after the follow camera is aimed) — the fusion stands back; post — the jogo's glows go up to the GPU.
import type { Kit } from '@ericrius1/weft';
import type { FrameBuilder, FrameCtx } from '../engine/frame';
import type { CameraRig, StagePlane } from '../engine/camera';
import type { ViewCtx } from '../engine/views';
import type { Show } from '../dancer/show';
import type { Dancer } from '../dancer/dancer';
import type { Motion } from '../skeleton/clips';
import type { World } from '../worlds/world';
import type { Solid } from '../worlds/solids';
import type { Music } from '../audio/music';
import type { Field } from '../matter/field/field';
import type { MatterPasses } from '../matter/core/kind';
import type { WaterPasses } from '../matter/water/pool';
import type { PlasmaPasses } from '../matter/plasma/plasma';
import type { Portals } from '../portals/portals';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import { IntentController } from '../dancer/intent-controller';
import { Dancer as DancerClass } from '../dancer/dancer';
import { BotSource } from '../input/touch';
import { makeIntent } from '../input/intent';
import { dressed } from '../matter/core/presets';
import { gridError, beatAt, sessionMs, RULES } from '../../shared/rules.ts';
import { Room } from './room';
import { Jogo, type Element, type SeatBody, type JogoEvent } from './jogo';
import { JogoBuilder, Pieces } from './build';
import { Glows } from './glow';
import { GlowDraw } from './glow-draw';
import { Feel } from './feel';
import { Fusion } from './fusion';
import { Hud } from './hud';
import { Flow } from './flow';
import { AiPartner, BrainSource, StandIn, type Brain, type PartnerView } from './partner';
import { ClipLibrary } from '../ai/clips';
import { budget } from '../engine/perf';
import { PRESETS, type PresetName } from '../ai/partner';
import { ScriptRunner, type JogoScript } from './script';
import { jogoParams } from './params';
import { Lobby, Waiting, showFront, escapeToFront, hrefOf } from './menu';
import { roomServer } from '../net/where';
import { roam } from './roam';
import { frontYou } from './front-you';
import { YouTags } from './you-tag';
import { YouTell, YOU } from '../duel/you';
import { screenOf } from '../hud/state';
import { clearTurn } from './opening';
import { softEdge } from './edge';
import { arenaFor } from '../duel/arena';
import { cameraParams } from '../engine/camera';
import { installHelp, devOf, guessDev } from '../duel/help';
import { DanceHud } from './dance-hud';
import { createTutorial, shouldAutoTutorial } from './tutorial';

type V3 = [number, number, number];

export interface PlayApp {
  kit: Kit;
  frame: FrameBuilder;
  show: Show;
  rig: CameraRig;
  gates: Portals;
  music: Music;
  field: Field;
  kinds: readonly MatterPasses[];
  main: ViewCtx;
  query: URLSearchParams;
  canvas: HTMLCanvasElement;
  motion: Motion;
  travel: Promise<Motion | null>;
  coarse: boolean;
  film: boolean;
  wake(): void;
  worldOf(id: string): World;
  /** move the main view to a world (a script's own world, when the address names none) */
  setWorld?(id: string): Promise<void>;
  /** the hand (its one-frame blast throws matter off a body: the duel's KO) */
  hand?: { burst: Float32Array | number[] };
  /** the near fade (worlds/fade.ts): how strongly it dissolves a solid now (the duel dims a power drawn as glow with it) */
  fade?: { strengthOf(s: Solid | null | undefined): number };
}

/** the scripted jogos shipped with the game (src/play/scripts/*.json) */
const SCRIPTS = import.meta.glob('./scripts/*.json', { eager: true, import: 'default' }) as Record<string, JogoScript>;
export const scriptNamed = (name: string): JogoScript | null => SCRIPTS[`./scripts/${name}.json`] ?? null;

/** a body's element now: its biggest layer's kind, at its form (fire → plasma, water → ice past the middle) */
export function elementOf(d: Dancer | null): Element {
  if (!d) return 'gems';
  let best = 'gems', share = -1;
  for (const l of d.loadout.layers) if (l.share > share) { share = l.share; best = l.kind; }
  const f = d.form;
  if (best === 'fire') return f > 0.5 ? 'plasma' : 'fire';
  if (best === 'water') return f > 0.5 ? 'ice' : 'water';
  if (best === 'plasma' || best === 'ice') return best;
  return 'gems';
}

const jointOf = (d: Dancer, j: number): V3 => { const W = d.skeleton.world, o = j * JOINT_FLOATS; return [W[o], W[o + 1], W[o + 2]]; };

export async function registerPlay(app: PlayApp) {
  const q = app.query;
  // ?duel: the fast two-player arena mode beside the jogo (src/duel)
  if (q.has('duel')) return (await import('../duel')).startDuel(app);
  const mode = q.get('jogo');
  if (mode == null) {
    // the plain page: the front of the game over the show (never in a film, or with any of the debug demos)
    const demo = ['play', 'net', 'landmarks', 'wander', 'film', 'gates', 'fly', 'nomenu', 'pip', 'you', 'lock', 'roda', 'teach', 'npcs', 'perf', 'perfgroup'].some((k) => q.has(k));
    if (!demo && typeof document !== 'undefined') {
      const frontRoot = showFront(q);
      // always-visible toggleable controls legend icon on the front screen too (stays even when bottom strip fades)
      if (!app.film) installHelp({
        frame: app.frame,
        game: () => (frontRoot.dataset.game === 'duel' ? 'duel' : 'dance'),
        device: () => null,
        matters: () => app.show.dress.slice(0, 2),
        allowModeSwitch: true,
      });
      // which body will be yours and what to press (front-you.ts: the YOU tell on the show's first dancer, the word)
      const fy = frontYou({ kit: app.kit, frame: app.frame, scene: app.main.scene, body: () => app.show.dancers[0] ?? null, ground: (x, z) => app.worldOf(app.main.world).groundAt(x, z) });
      // (the front's fading, and beginning a jogo from a key or a tap, are the hub's: worlds/geode/front.ts)
      // beginning in this page: the jogo with this page's parts, in the world the query names, the device that began it
      // joined to seat 1 at once
      const front = {
        begin: async (m: 'same' | 'partner' | 'duel', query: URLSearchParams, joined?: Joined) => {
          fy.stop();
          const w = query.get('world');
          if (w && w !== app.main.world) await app.setWorld?.(w);
          // the duel (src/duel), seat 1 the device that began it: the same parts, the duel's own lobby and lesson
          if (m === 'duel') return (await import('../duel')).startDuel({ ...app, query }, { joined });
          return startJogo({ ...app, query }, m, { joined });
        },
      };
      app.frame.tick('input', () => { const b = (window as unknown as { bend?: Record<string, unknown> }).bend; if (b && b.front !== front) b.front = front; }, 'jogo: bend.front');
    }
    return null;
  }
  return startJogo(app, mode);
}

/** the device whose press began a jogo or a duel (the front's key, tap, click or a gamepad's button), joined to seat 1
 *  as it starts */
export type Joined = { device: 'keyboard'; code: string; held?: () => boolean } | { device: 'touch'; id: number; x: number; y: number } | { device: 'mouse' } | { device: 'gamepad'; index: number };

export async function startJogo(app: PlayApp, mode: string, opts: { joined?: Joined } = {}) {
  const { kit, frame, show, rig, gates, music, field, query: q } = app;
  const scripted = mode === 'script';
  const online = mode === 'online';
  const script = scripted ? scriptNamed(q.get('script') ?? 'pool-fire-water') : null;
  /** the side view: asked for (&lock), else open 3D; a script's is the side view unless &free or its own lock is false */
  const side = scripted ? !q.has('free') && script?.lock !== false : q.has('lock') && !q.has('free');
  const world = () => app.worldOf(app.main.world);
  // a script plays in its own world unless the address names one
  if (script?.world && !q.has('world') && script.world !== app.main.world) await app.setWorld?.(script.world);
  const dress = (q.get('dress') ?? script?.dress?.join(',') ?? 'fire,water').split(',');
  // dressed by seat (online, this page's own dancer is its seat's; set once the room says which)
  show.dress = [dress[0] ?? 'fire', dress[1] ?? dress[0] ?? 'water'];

  // ---------------------------------------------------------------- the dancers (dancer/play.ts: devices, the lock)
  const { playDemo } = await import('../dancer/play');
  const play = await playDemo({
    show, rig, frame, kit, canvas: app.canvas, world, motion: app.motion, travel: app.travel, coarse: app.coarse, wake: app.wake,
    seen: (d) => gates.seen(app.main.world, [d]).joints[0] ?? null,
    // each seat walks on its own world's ground (the gates': a dancer crossing a gate stands on the far world's floor,
    // not the main view's), as ?play's dancers do
    worldOf: (d) => app.worldOf(gates.worldOf(d)),
    // only 2-player local ('same') splits the keyboard; in partner/online modes arrows orbit the 3D camera
    allowSplit: mode === 'same',
  });
  escapeToFront();

  // ---------------------------------------------------------------- the room
  const server = roomServer(q);
  const cond = { lag: num(q.get('lag')), jitter: num(q.get('jitter')), loss: num(q.get('loss')) };
  const room = new Room(online
    ? { mode: 'online', world: world().id, url: server, room: (q.get('room') ?? 'DEMO').toUpperCase(), create: q.has('create') || !q.has('room'), role: q.has('watch') ? 'guest' : 'player', ...cond }
    : { mode: 'local', world: world().id });

  // ---------------------------------------------------------------- seats
  /** the dancer of each seat (in a local room both are this page's; online, one is a NetController's) */
  const seatDancer: (Dancer | null)[] = [null, null];
  const seatCtl: (IntentController | null)[] = [null, null];
  // the partner: src/ai's PartnerBrain (&partner=playful|calm|fierce|mirror; playful by default) through the adapter;
  // &partner=standin keeps the jogo's own little stand-in (partner.ts)
  const standIn = new StandIn();
  const wanted = q.get('partner') ?? 'playful';
  const clips = await app.travel.then((t) => new ClipLibrary(app.motion, t)).catch(() => null);
  // the music as the partner hears it: its level, its mood's name (the temple's is the Roda: low, close, slow) and a
  // breakdown (the groove dropped to nothing within eight bars of playing: the engine's own twinkling stillness)
  let grooveBeat = -Infinity;
  const aiPartner = new AiPartner({
    world, events: () => frameEvents, clips,
    music: () => {
      const e = music.engine, heard = !!music.live || app.film;
      const level = heard ? Math.min(1, e.level / 4 + 0.1) : Number(q.get('level') ?? 0.6);
      if (!heard || e.level >= 1) grooveBeat = beatNow();
      return { level, breakdown: heard && e.level < 1 && beatNow() - grooveBeat <= 32, mood: e.mood.name };
    },
  }, wanted in PRESETS ? (wanted as PresetName) : 'playful', Number(q.get('seed') ?? 23));
  let partner: Brain = wanted === 'standin' ? standIn : aiPartner;
  const partnerView = (seat: number) => (dt: number): PartnerView | null => {
    const me = seatCtl[seat], other = seatDancer[1 - seat];
    if (!me || !other) return null;
    const oc = seatCtl[1 - seat]?.character ?? null;
    const r = bodies[1 - seat]!.root();
    return { dt, beat: { beats: beatNow(), bpm: room.state?.music.bpm ?? RULES.BPM }, me: me.character, them: { root: r, move: oc?.move?.name ?? null, moveT: oc?.move?.t ?? 0, character: oc }, state: room.state, seat, plane: play.plane() };
  };
  const body = (seat: number): SeatBody => ({
    get character() { return seatCtl[seat]?.character ?? null; },
    root: () => {
      const c = seatCtl[seat]?.character;
      if (c) return [c.root[0], c.root[1], c.root[2]];
      // a remote dancer: under its hips, at its lower foot
      const d = seatDancer[seat];
      if (!d) return [0, 0, 0];
      const h = jointOf(d, JOINT.Hips), l = jointOf(d, JOINT.LeftToeBase), r = jointOf(d, JOINT.RightToeBase);
      return [h[0], Math.min(l[1], r[1]) - 0.03, h[2]];
    },
    chest: () => { const d = seatDancer[seat]; return d ? jointOf(d, JOINT.Spine1) : [0, 1.2, 0]; },
    intent: () => seatCtl[seat]?.intent ?? null,
    element: () => elementOf(seatDancer[seat]),
  });
  const bodies: SeatBody[] = [body(0), body(1)];

  if (!online) {
    // both seats are this page's: dancer 1 waits for a device; dancer 2 is the partner until a second device comes.
    // (The two bots join through the hub, so its players are numbered by seat, then leave its list so the devices that
    // come later take their places: InputHub numbers a newcomer by how many it holds.)
    const hub = play.hub;
    hub.join(new BotSource(null, 'waiting'), 'bot');
    const ps = new BrainSource('partner', { think: (v) => partner.think(v) }, partnerView(1));
    // (a script with &partner=… seats the partner brain on dancer 2 and scripts dancer 1 alone: a film's jogo)
    hub.join(scripted && !q.has('partner') ? new BotSource(null, 'script') : ps, 'bot');
    hub.players.splice(0, hub.players.length);
    for (let s = 0; s < 2; s++) { seatCtl[s] = play.controllers[s]; seatDancer[s] = play.dancers[s]; }
    if (scripted) seatCtl[0]!.source = new BotSource(null, 'script');
    for (const d of play.dancers) music.players.add(d.id);
    // the roda: free dancers (src/ai) ringing the stage behind its plane, as many as the device's budget allows
    // (desktop 4, laptop 2, phone none; &roda=N to ask for another number, &roda=0 for none)
    const n = q.has('roda') ? Number(q.get('roda') || 0) : budget().roda;
    if (!scripted && n > 0) {
      const { rodaForJogo } = await import('../ai/demo');
      await rodaForJogo({
        query: q, frame, show, music, world, worldOf: app.worldOf, motion: app.motion, travel: app.travel, lock: () => {}, wake: app.wake, play,
      }, n, () => [seatCtl[0]?.character ?? null, seatCtl[1]?.character ?? null], () => {
        const st = room.state;
        return st ? { phase: st.phase, tension: st.tension, mergeReady: st.mergeReady, flow: [st.flow[0], st.flow[1]], form: [st.form[0], st.form[1]], fusion: !!st.fusion, events: frameEvents as never } : null;
      });
    }
  }

  // ---------------------------------------------------------------- what the room needs to know first
  const plane = (): StagePlane | null => play.plane();
  // a function declaration, hoisted: the partner (above, after an await) may read the beat before this line runs
  function beatNow() { const m = room.state?.music; return m ? beatAt(m, room.now()) : 0; }
  const judge = (_seat: number) => {
    const st = room.state;
    // as heard, when the music follows the room's clock live; else the room's grid at this instant (stepped by hand:
    // a capture, a film, where the audio's clock is the page's and not the frames')
    if (music.live && music.clock.synced && !kit.manual) return music.beatError(music.heardTime(), RULES.PERFECT_GRID);
    return st ? gridError(st.music, room.now(), RULES.PERFECT_GRID) : 999;
  };
  const builder = new JogoBuilder(bodies, () => room.now(), plane);
  const jogo = new Jogo(room, bodies, { judge, plane, builder });

  // ---------------------------------------------------------------- the jogo's light and its parts
  const glows = new Glows();
  const draw = new GlowDraw(kit, glows);
  draw.declare(app.main.scene, () => true);
  const water = show.kinds.find((k) => k.id === 'water' || k.id === 'ice') as WaterPasses | undefined;
  const plasma = show.kinds.find((k) => k.id === 'plasma') as PlasmaPasses | undefined;
  const ripple = (x: number, z: number, s: number, r: number) => { (world() as unknown as { ripple?: (x: number, z: number, s: number, r: number) => void }).ripple?.(x, z, s, r); };
  const sfx = (name: string, o: Record<string, unknown>) => { music.sfx(name as Parameters<Music['sfx']>[0], o); };
  const cam = kit.camera;
  const ear = (p: V3) => {
    const dx = p[0] - cam.position[0], dy = p[1] - cam.position[1], dz = p[2] - cam.position[2], d = Math.hypot(dx, dy, dz) || 1;
    const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    return { pan: Math.max(-1, Math.min(1, (dx * right[0] + dz * right[2]) / Math.max(d, 2))), dist: Math.min(1, d / 14) };
  };
  const rumble = (seat: number, s: number, ms: number) => { play.hub.rumble(seat, s, ms); };
  const pieces = new Pieces({
    setIce: water?.setIce ?? null, field, glows, world: () => world().id, now: () => room.now(),
    send: (seat, msg) => room.send(seat, msg),
  });
  const feel = new Feel(jogo, bodies, {
    glows, sfx, field, arcs: plasma?.arcs ?? null, ripple, rumble, ear, dancer: (s) => seatDancer[s], plane,
    updraftAt: (p) => pieces.updraftAt(p), frame: () => kit.frameIndex, fused: () => fusion.weight,
  });
  const fusion = new Fusion(bodies, {
    glows, rig, field, arcs: plasma?.arcs ?? null, music, ripple, now: () => room.now(), frame: () => kit.frameIndex,
    dancer: (s) => seatDancer[s],
    slot: (s) => { const d = seatDancer[s]; return d ? show.dancers.indexOf(d) : -1; },
    setLoadout: (s, l) => { const d = seatDancer[s]; const k = d ? show.dancers.indexOf(d) : -1; if (k >= 0) show.setLoadout(k, l); },
  });
  const hud = new Hud(bodies, {
    glows, locked: () => rig.locked, beat: beatNow,
    hidden: () => Math.max(fusion.weight, travelling ? 1 : 0),
  });
  let fresh = !!opts.joined;
  const flow = new Flow(bodies, {
    glows, sfx, now: () => room.now(),
    // (the first count-in of a dance begun by the front's press: the bodies already stand at their spawns, and the
    // player's first steps are kept rather than undone by a re-form that holds them for a second: report 24-newcomer)
    rise: (s) => { if (fresh) { fresh = false; return; } show.rise(s); },
    respawn: (_s, c) => { if (!fresh) c.spawn(); }, plane: () => play.plane(),
  });

  // the characters stand on the pieces too (set ice's tops, the crystal ledges), on the locked stage
  const ledgesFor = (c: IntentController) => () => pieces.ledges(c.character.plane);
  for (const c of play.controllers) c.character.extraLedges = ledgesFor(c);

  // ---------------------------------------------------------------- online: the other seat through the network
  let waiting: Waiting | null = null;
  if (online) {
    try {
      const info = await Promise.race([room.connect(), new Promise<never>((_, no) => setTimeout(() => no(new Error('timed out')), 8000))]);
      console.info(`jogo: room ${info.room}, slot ${info.slot}${info.player ? ` (seat ${info.seat})` : ' (watching)'}, ${server}`);
    } catch (e) { console.warn(`jogo: could not reach ${server} (${(e as Error).message})`); }
    const me = play.controllers[0], meD = play.dancers[0];
    const seat = room.session.seat;
    music.players.add(meD.id);
    if (seat != null) {
      seatCtl[seat] = me; seatDancer[seat] = meD;
      const other = 1 - seat;
      const remote = room.session.remote(me.rig, other);
      const sp = world().spawns[other] ?? [other ? 1.2 : -1.2, 0, 0];
      remote.place(sp[0], sp[2], other ? -Math.PI / 2 : Math.PI / 2);
      const them = new DancerClass(`net.${other}`, remote, dressed(dress[other] ?? 'water')!);
      play.addDancer(them);
      seatDancer[other] = them;
      show.dress = [dress[seat] ?? 'fire', dress[other] ?? 'water'];
      if (seat === 1) me.character.reset(world().spawns[1]?.[0] ?? 1.2, undefined, world().spawns[1]?.[2] ?? 0);
      // each page wears what it chose; the other page is told (a cosmetic message, relayed as it is)
      const tell = () => room.send(seat, { t: 'fx', k: 'dress', name: dress[seat] ?? 'fire' });
      tell();
      room.on('peer', (p) => { if (p.present && p.slot < 2) tell(); });
      room.on('fx', (m) => {
        if (m.k !== 'dress' || m.from !== other || typeof m.name !== 'string') return;
        const l = dressed(m.name);
        const k = show.dancers.indexOf(them);
        if (l && k >= 0) { show.dress[k] = m.name; show.setLoadout(k, l); }
      });
    } else {
      // a guest: a free dancer, and the two seats through the network
      for (let s = 0; s < 2; s++) {
        const r = room.session.remote(me.rig, s);
        const sp = world().spawns[s] ?? [s ? 1.2 : -1.2, 0, 0];
        r.place(sp[0], sp[2], s ? -Math.PI / 2 : Math.PI / 2);
        const d = new DancerClass(`net.${s}`, r, dressed(s ? 'water' : 'fire')!);
        play.addDancer(d);
        seatDancer[s] = d;
      }
    }
    waiting = new Waiting(room.session.room ?? '', `${location.origin}${hrefOf({ mode: 'online', world: world().id, dress: [dress[0] ?? 'fire', dress[1] ?? 'water'], lock: side, room: room.session.room ?? '' }, location.pathname, q)}`);
    app.wake();
  }

  // ---------------------------------------------------------------- the lock: open 3D unless &lock (report 20-roam);
  // a script keeps its own (the side view unless &free or its lock is false: the films)
  if (side) rig.lock(world().stages[0] ?? null);

  // ---------------------------------------------------------------- starting: a lobby on one screen, at once scripted
  let lobby: Lobby | null = null;
  let started = online;
  const start = async () => {
    if (started) return;
    started = true;
    lobby?.hide();
    app.wake();
    if (!room.connected) await room.connect();
    // a local room at another tempo (&bpm=N: a film's timeline asks for one; the rules' 112 otherwise)
    const bpm = num(q.get('bpm'));
    const S = (room.session.net as unknown as { session?: { music: { bpm: number }; changed: boolean } }).session;
    if (!online && bpm && bpm >= 60 && bpm <= 180 && S) { S.music.bpm = bpm; S.changed = true; }
  };
  let runner: ScriptRunner | null = null;
  let playFrom: number | null = null;
  const runScript = (s: JogoScript) => {
    runner = new ScriptRunner(s, {
      controllers: () => seatCtl,
      beat: () => (playFrom == null || !room.state ? null : ((room.now() - playFrom) * room.state.music.bpm) / 60000),
      arm: (seat) => builder.arm(seat),
      setTension: (v) => { const S = (room.session.net as unknown as { session?: { tension: number; changed: boolean } }).session; if (S) { S.tension = v; S.changed = true; } },
      plane: () => play.plane(),
    });
  };
  if (scripted) {
    if (script) runScript(script);
    else console.warn(`jogo: no script '${q.get('script')}' (src/play/scripts)`);
    // a script starts its room on the first frame stepped by hand (a capture or a film: kit.manual), so frame 0 of the
    // capture is the room's first frame whatever the page did before; watched live, after a second. &hold=S holds it
    // S seconds more (of stepped time: a film's opening, the dancers asleep in their heaps until the intro wakes them;
    // a film may wake them sooner itself); a bare &hold waits for bend.jogo.start()
    const hold = q.has('hold') ? (q.get('hold') ? Number(q.get('hold')) : Infinity) : 0;
    let waited = 0, held = 0;
    frame.tick('input', (f: FrameCtx) => {
      if (started) return;
      if (kit.manual) { held += f.dt; if (held >= hold - 1e-6) void start(); }
      else if (++waited > 60 + hold * 60) void start();
    }, 'jogo: a script waits for the first stepped frame (and its hold)');
  } else if (!online) {
    // a device that joins seat 1 by a pointer: a touch joins as touch; a click joins the keyboard's solo layout (the
    // mouse is part of it)
    const joinPointer = (pt: { touch: boolean; id: number; x: number; y: number }) => {
      const hub = play.hub, n = hub.players.length;
      if (pt.touch) hub.touch(pt.id, pt.x, pt.y);
      if (hub.players.length === n) {
        hub.key('KeyA');
        (hub.players[n]?.source as { keyUp?(code: string): void } | undefined)?.keyUp?.('KeyA');
      }
    };
    lobby = new Lobby(mode === 'partner', (_seat, e) => joinPointer({ touch: e.pointerType !== 'mouse', id: e.pointerId, x: e.clientX, y: e.clientY }));
    lobby.seat(1, 'bot');
    // (the room starts 1.6 s after the first device joins, on the frames' clock: a capture stepped by hand starts it on
    // the same frame every time)
    let startIn = Infinity;
    frame.tick('input', (f: FrameCtx) => { if (!started && (startIn -= f.dt) <= 0) void start(); }, 'jogo: starts a moment after the first device joins');
    const was = play.hub.onJoin;
    play.hub.onJoin = (p) => {
      was?.(p);
      lobby?.seat(p.index, p.device);
      // (the join is a key's or a touch's own handler: the sound starts inside the gesture, or a browser keeps it
      // suspended until the next one)
      // (begun by the front's press: the room starts at once, so the bodies re-form at their spawns before the player
      // is off, not under them a second and a half later: report 24-newcomer)
      if (p.index === 0 && !started) { if (!music.live) music.start(show.program.key); app.wake(); startIn = opts.joined ? 0.2 : 1.6; }
      if (p.index === 1) music.players.add(play.dancers[1].id);
    };
    // the device whose press began this jogo (the front's key, tap or click) joins seat 1 now: one press starts and
    // joins (a key or a click that names no key of the layouts joins the keyboard's solo layout, mouse included)
    const j = opts.joined, hub = play.hub;
    if (j) {
      const n = hub.players.length;
      if (j.device === 'keyboard') {
        hub.key(j.code);
        // (the key that began it went up while the game was loading: let it go, or the body walks off on its own until
        // the room starts and puts it back, report 24-newcomer)
        if (j.held && !j.held()) (hub.players[n]?.source as { keyUp?(code: string): void } | undefined)?.keyUp?.(j.code);
      }
      else if (j.device === 'gamepad') { const p = hub.join(hub.pads.source(j.index), 'gamepad'); if (p) p.slot = j.index; }
      if (hub.players.length === n) joinPointer(j.device === 'touch' ? { touch: true, id: j.id, x: j.x, y: j.y } : { touch: false, id: 0, x: 0, y: 0 });
    }
  }

  // ---------------------------------------------------------------- each frame
  let tension = 0;
  let travelling = false;
  let lastSync = '';
  let frameEvents: JogoEvent[] = [];
  /** what happened lately, with the room's time and the frame (for probes and the films' logs) */
  const history: { t: number; frame: number; e: JogoEvent }[] = [];
  frame.tick('input', (f: FrameCtx) => {
    if (!started) return;
    jogo.clock(f.dt);
    const st = room.state;
    if (st) {
      // the beat everyone reads is the room's; the music follows it (and lands its fusion on the room's bar line)
      f.beat.beats = beatAt(st.music, room.now()); f.beat.bpm = st.music.bpm;
      // (the room's world names the track, whose bar 1 is the epoch: a seat's travel gives the room a new one)
      const world = st.world ?? st.stage, key = `${st.music.epoch}/${st.music.bpm}/${world}`;
      music.clock.measure(room.now() / 1000, music.heardTime(), f.dt);
      if (key !== lastSync) { lastSync = key; music.syncTo({ epoch: st.music.epoch, bpm: st.music.bpm, world }); }
      if (st.phase === 'play' && playFrom == null && st.sessionEnd != null) playFrom = st.sessionEnd - sessionMs(st.music);
      if (st.phase === 'waiting' || st.phase === 'intro') playFrom = null;
    }
    // the tension (eased) for the worlds' light and the music; the fusion holds it at the top while it lasts
    const want = Math.max((st?.tension ?? 0) / RULES.TENSION_MAX, fusion.weight);
    tension += (want - tension) * (1 - Math.exp(-f.dt * 1.5));
    f.tension = tension;
    music.tension = tension;
    runner?.update();
    // online the other dancer is a NetController, which dancer/play.ts doesn't pair with: this page's dancer faces it
    // (set before the dancers move; play.ts's own pairing only knows its controllers)
    if (online) for (const s of room.seats) {
      const c = seatCtl[s], o = seatDancer[1 - s];
      if (c && o) { const r = bodies[1 - s].root(); c.character.lookAt = r; c.lookAtHead = o.skeleton.pos[JOINT.Head]; }
    }
    if (waiting) waiting.visible = !st || st.phase === 'waiting';
    // online, the other seat through a mirror: its poses come in the far world's coordinates, named with that world; it
    // is drawn there (seen through the mirror until this page's own dancer follows), not in this page's world
    if (online) for (let s = 0; s < 2; s++) {
      const d = seatDancer[s], w = (d?.controller as { info?: { ok: boolean; world?: string } } | undefined)?.info;
      if (d && d !== play.dancers[0] && w?.ok && w.world && app.worldOf(w.world)?.id === w.world && gates.worldOf(d) !== w.world) gates.place(d, w.world);
    }
  }, 'jogo: the room\'s clock, the beat, the tension, the script');

  frame.tick('travel', (f) => {
    glows.clear();
    glows.rings = jogoParams.rings;
    if (!started) return;
    // the build button, tapped round a move
    for (const s of room.seats) if (seatCtl[s]?.intent.interact) builder.arm(s);
    jogo.update();
    const ev = jogo.events.splice(0, jogo.events.length);
    frameEvents = ev;
    for (const e of ev) { history.push({ t: Math.round(room.now()), frame: kit.frameIndex, e: e.k === 'xch' ? { ...e, move: null } : e }); }
    if (history.length > 400) history.splice(0, history.length - 300);
    for (const e of ev) {
      fusion.event(e);
      if (e.k === 'set') pieces.lay(e.piece);
      else if (e.k === 'unset') { if (e.how === 'melt') { const p = room.session.pieces.get(e.id); pieces.melt(e.id, p?.melt ?? room.now()); } else pieces.unlay(e.id, e.how === 'shatter'); }
    }
    if (ev.some((e) => e.k === 'phase' && e.phase === 'intro')) openSoon(2);
    feel.update(f.dt, ev);
    fusion.update(f.dt);
    hud.update(f.dt, room.state, ev);
    flow.update(f.dt, room.state, ev);
    const local = room.seats.map((s) => ({ seat: s, c: seatCtl[s]?.character ?? null, el: bodies[s].element() })).filter((x) => x.c) as { seat: number; c: IntentController['character']; el: Element }[];
    pieces.update(f.dt, local);
    // travel: a dancer through a gate pauses the jogo (free) until both have arrived in the same world
    if (travelling) {
      const w = [seatDancer[0], seatDancer[1]].filter(Boolean).map((d) => gates.worldOf(d!));
      if (w.every((x) => x === app.main.world)) {
        travelling = false; jogo.paused = false;
        if (wasLocked) rig.lock(world().stages[0] ?? null);
        pieces.reset(room.session.pieces.values());
      }
    }
  }, 'jogo: moves to the rules, exchanges judged and felt, fusion, meters, flow, pieces');

  let wasLocked = rig.mode === 'locked';
  gates.on((e) => {
    if (e.who !== 'dancer') return;
    const d = show.dancers[e.dancer];
    if (!seatDancer.includes(d)) return;
    if (!travelling) { wasLocked = rig.mode === 'locked'; travelling = true; jogo.paused = true; rig.lock(null); }
    // online, this page's own dancer moved the room (a seat's travel moves the jogo's world, and its music: the new
    // world's track and tempo from the room's next bar line); a local room hears both seats' travels
    if (online && d === play.dancers[0]) room.send(room.session.seat ?? 0, { t: 'travel', world: e.to, portal: e.partner });
    else if (!online) room.send(seatDancer.indexOf(d), { t: 'travel', world: e.to, portal: e.partner });
  });

  // the pair roams: through a mirror or a gate together, the main view after them, the way said (roam.ts)
  const roaming = roam({
    gates, rig, main: app.main, frame, all: () => show.dancers, seats: seatDancer, local: (s) => !online || s === room.session.seat, started: () => started,
    lead: () => { const c = seatCtl[0]?.character; return c ? { yaw: c.yaw, v: c.v } : null; },
    aspect: () => { const [w, h] = kit.size.render; return w / Math.max(1, h); },
  });

  // ---------------------------------------------------------------- the edge (edge.ts; report 24-newcomer): in open 3D
  // this page's bodies keep inside their world's play space (the duel's arena space, its ways out open), as the duel's
  // do: a run at the edge curves round it rather than through the balustrade and out past the glass
  // (now kept by the dancers' own soft edge, src/dancer/play.ts via src/duel/edge.ts, a metre inside this one; report
  // 24-feel. Two edges stacked turned bodies twice at the rim, so this page no longer adds its own.)
  void softEdge; void arenaFor;

  // ---------------------------------------------------------------- the first view (opening.ts; report 24-newcomer)
  // as the dance begins (the first device joins) and as the bodies re-form at their spawns (the intro), the follow
  // camera turns to the nearest turn whose view of the pair is clear of the world's slabs and planters, eased there
  let openIn = -1, openYaw: number | null = null, openT = 0;
  const opening: { t: number; from: number; to: number; blocked: number }[] = [];
  const openSoon = (frames: number) => { if (!scripted && !app.film) openIn = frames; };
  frame.tick('camera', (f: FrameCtx) => {
    if (openIn > 0 && --openIn === 0 && rig.follow && rig.solids && rig.mode !== 'locked') {
      const F = rig.follow, [w, h] = kit.size.render;
      const T: V3 = [F.x, F.y, F.z], dist = cameraParams.followDist + Math.min(F.spread, 5) * 0.45;
      // aim cleanly behind player 1 in a 3/4 hero framing looking toward the partner before checking clearTurn
      const r0 = bodies[0]?.root(), r1 = bodies[1]?.root();
      const heroYaw = r0 && r1 && Math.hypot(r0[0] - r1[0], r0[2] - r1[2]) > 0.35
        ? Math.atan2(r0[0] - r1[0], r0[2] - r1[2]) + 0.42
        : rig.yaw;
      const r = clearTurn(rig.solids, T, heroYaw, cameraParams.followPitch, dist, cameraParams.followFov, w / Math.max(1, h), world().room);
      opening.push({ t: +(kit.frameIndex / 60).toFixed(2), from: +rig.yaw.toFixed(2), to: +r.yaw.toFixed(2), blocked: r.blocked });
      if (r.yaw !== rig.yaw) { openYaw = r.yaw; openT = 0; }
    }
    if (openYaw != null) {
      // (eased over about half a second; the player's own look input takes it at once)
      openT += f.dt;
      if (rig.lookIdle < 0.05 || openT > 1.2 || rig.mode === 'locked') openYaw = null;
      else {
        const d = Math.atan2(Math.sin(openYaw - rig.yaw), Math.cos(openYaw - rig.yaw));
        rig.yaw += d * (1 - Math.exp(-f.dt * 7));
        if (Math.abs(d) < 0.01) openYaw = null;
      }
    }
  }, 'jogo: the first view clear of the world pieces');

  // ---------------------------------------------------------------- which one is you (src/duel/you.ts; report 24-newcomer)
  // the duel's tell on the page's own seats (a local room's seats a device plays, online this page's seat; none in a
  // film or a script): its opening as the first device joins (the front's press: the same petal the front showed over
  // this body) and again each time the view comes into a new world, a small petal over the head and a ring at the feet
  // all through; the page's tag over the petal in the opening ("you", or two at one screen each seat's device)
  const sourceName = (k: number) => (seatCtl[k]?.source as { name?: string } | undefined)?.name ?? null;
  const human = (k: number) => /^(keyboard|touch|gamepad|camera)/.test(sourceName(k) ?? '');
  const pressedNow = (it: IntentController['intent'] | undefined) => !!it && (Math.hypot(it.moveX, it.moveZ) > 0.3 || it.jump || it.punch || it.kick || it.spin || it.dodge || it.form || it.dash);
  const headOf = (k: number): V3 | null => {
    const d = seatDancer[k];
    if (!d || gates.worldOf(d) !== app.main.world) return null;
    return jointOf(d, JOINT.HeadEnd);
  };
  const you = new YouTell({
    glows, head: headOf, root: (k) => bodies[k].root() as V3, ground: (x, z) => world().groundAt(x, z),
    eye: () => [cam.position[0], cam.position[1], cam.position[2]],
    pressed: (k) => pressedNow(seatCtl[k]?.intent), away: () => fusion.weight, device: sourceName,
    yaw: (k) => seatCtl[k]?.character.yaw ?? 0,
  }, () => (app.film || scripted ? [] : online ? (room.session.seat != null && room.state?.phase !== undefined ? [room.session.seat] : []) : [0, 1].filter(human)));
  const youTags = new YouTags();
  const danceHud = !app.film && !scripted ? new DanceHud() : null;
  const tutorial = !app.film && !scripted ? createTutorial({
    game: 'dance',
    autoStart: shouldAutoTutorial('dance', app.query, app.film || scripted),
    onStep: () => { music.sfx('dodge', { element: 'ice', perfect: true, count: 2, vel: 0.85 }); danceHud?.callout('NICE! STEP COMPLETE', true, 1.0); },
    onComplete: () => { music.sfx('unison', { element: 'ice', perfect: true, vel: 0.95 }); danceHud?.callout('TUTORIAL COMPLETE!', true, 2.0); },
  }) : null;
  let tutLastLocked = rig.mode === 'locked';
  let youWorld = app.main.world, youBeat = Infinity, youBegun = false;
  if (online) { you.set(); youBegun = true; }
  const wasJoin = play.hub.onJoin;
  play.hub.onJoin = (p) => { wasJoin?.(p); if (p.index === 0 && !youBegun) { youBegun = true; you.set(); openSoon(2); } };
  if (!online && play.hub.players.some((p) => p.index === 0) && !youBegun) { youBegun = true; you.set(); openSoon(2); }
  frame.tick('travel', (f: FrameCtx) => {
    if (!youBegun) return;
    // (into a new world: the opening again, the shorter one)
    if (app.main.world !== youWorld) { youWorld = app.main.world; you.set(); }
    // (a ring rises up you on each beat of the opening, as the count-in's do)
    const b = Math.floor(f.beat.beats);
    if (you.intro() > 0.05 && b !== youBeat && Number.isFinite(youBeat)) you.count();
    youBeat = b;
    you.update(f.dt);
    const mySeat = online ? (room.session.seat ?? 0) : 0;
    const myRaw = jogo.raw[mySeat] ?? [];
    danceHud?.update(f.dt, {
      seat: mySeat, el: bodies[mySeat]?.element() ?? 'fire', state: room.state, events: frameEvents, raw: myRaw,
      beat: f.beat.beats, bpm: f.beat.bpm, hidden: fusion.weight > 0.7,
    });
    if (tutorial?.active()) {
      const it = seatCtl[mySeat]?.intent;
      const lockedNow = rig.mode === 'locked';
      const viewToggled = lockedNow !== tutLastLocked;
      tutLastLocked = lockedNow;
      const moves: string[] = [];
      let jumped = false, dashed = false, dodged = false;
      for (const r of myRaw) {
        if (r.type === 'jump') jumped = true;
        else if (r.type === 'dash') dashed = true;
        else if (r.type === 'move' && r.move) {
          const mv = String(r.move);
          moves.push(mv);
          if (mv === 'role' || mv === 'esquiva' || mv === 'block') dodged = true;
        }
      }
      for (const e of frameEvents) if (e.k === 'move' && e.seat === mySeat && e.move !== 'jump') moves.push(e.move);
      const exchanged = frameEvents.some((e) => (e.k === 'xch' && (e.by === mySeat || e.target === mySeat)) || e.k === 'echo' || e.k === 'unison');
      const formedOrMerged = frameEvents.some((e) => (e.k === 'form' && e.seat === mySeat && e.on) || e.k === 'fusion') || !!it?.form || !!it?.merge;
      const root0 = bodies[mySeat]?.root() ?? [0, 0, 0];
      const root1 = bodies[1 - mySeat]?.root() ?? null;
      tutorial.update({
        dt: f.dt,
        root: [root0[0], root0[1], root0[2]],
        partner: root1 ? [root1[0], root1[1], root1[2]] : null,
        camMoved: !!it && (Math.abs(it.camX) > 0.08 || Math.abs(it.camY) > 0.08 || Math.abs(it.camZoom ?? 0) > 0.01 || !!it.camReset),
        viewToggled,
        jumped, dashed, dodged, moves, exchanged, caughtOrFlung: false, powered: false, formedOrMerged,
      }, devOf(sourceName(mySeat)) ?? guessDev());
    }
  }, "jogo: which one is you (the tell on the page's own seats)");
  frame.tick('post', () => {
    const own = you.own(), I = you.intro(), vis = Math.max(0, 1 - fusion.weight * 1.4);
    for (let k = 0; k < 2; k++) {
      const isOwn = own.includes(k), h = isOwn ? you.hud(k) : undefined, head = headOf(k);
      if (!head || vis < 0.02 || (!isOwn && own.length !== 1)) { youTags.place(k, 0, 0, 0, ''); continue; }
      const e = cam.position, dist = Math.hypot(head[0] - e[0], head[1] - e[1], head[2] - e[2]);
      const M = YOU.marker, sc = Math.max(M.scale[0], Math.min(M.scale[1], dist / M.ref)), big = isOwn ? 1 + (M.intro - 1) * I : 0.7;
      const lift = isOwn ? (M.over * (0.6 + 0.4 * big) + M.len * big + 0.08) * sc : 0.34 * sc;
      const p = screenOf(cam.viewProj, [head[0], head[1] + lift, head[2]]);
      if (isOwn && h) {
        const two = own.length > 1;
        // always keep YOUR badge clearly visible (never fades to 0 after intro)
        youTags.place(k, p[0], p[1], Math.max(0.86, I, you.pulse(k)) * vis, two ? h.label : 'YOU', two ? h.sub : undefined, 'you');
      } else {
        youTags.place(k, p[0], p[1], 0.54 * vis, 'Partner', undefined, 'partner');
      }
    }
  }, 'jogo: the tag over your petal');

  frame.tick('camera', (f) => {
    if (!started) return;
    fusion.camera(f.dt);
    // the results stand back to hold their ring
    if (room.state?.phase === 'over') rig.framePad = Math.max(rig.framePad, 1.1);
    // online: this page's dancer to the room (20 Hz on the wire), with its state for the others' exchanges
    if (online) {
      const c = play.controllers[0].character;
      // (the world this page's dancer is in, not the main view's: the view comes through a mirror a moment later)
      room.session.sendPose(play.dancers[0].skeleton, { world: gates.worldOf(play.dancers[0]), flags: c.flags, move: c.move ? [String(c.move.serial), c.move.startTime] : null });
    }
  }, 'jogo: the fusion stands back; online, the pose out');

  frame.tick('post', () => draw.upload(), 'jogo: its glows to the GPU');

  // always-visible toggleable control legend for Dance / Jogo (hidden only in films/scripts)
  if (!app.film && !scripted) {
    installHelp({
      frame, game: 'dance',
      device: () => sourceName(online ? (room.session.seat ?? 0) : 0),
      matters: () => [],
      lesson: tutorial,
      split: () => seatCtl.some((c) => (c?.source as { name?: string } | undefined)?.name === 'keyboard-right'),
      locked: () => rig.mode === 'locked',
      toggleView: () => play.toggleLock(),
      replayTutorial: () => tutorial?.start(),
    });
  }

  // ---------------------------------------------------------------- the hooks (bend.jogo)
  const api = {
    room, jogo, feel, fusion, pieces, glows, builder, field, tutorial,
    get state() { return room.state; },
    get phase() { return room.state?.phase ?? null; },
    /** beats since play began */
    beat: () => (playFrom == null || !room.state ? null : ((room.now() - playFrom) * room.state.music.bpm) / 60000),
    /** run a scripted jogo (a JogoScript object) from now */
    run: (s: JogoScript) => runScript(s),
    /** the partner brain: anything with think(view); null puts src/ai's back */
    setPartner: (b: Brain | null) => { partner = b ?? aiPartner; },
    /** src/ai's partner's preset (playful, calm, fierce, mirror) */
    preset: (p: PresetName) => { aiPartner.setPreset(p); partner = aiPartner; },
    partner: aiPartner,
    events: () => frameEvents,
    history,
    stats: () => ({
      phase: room.state?.phase, tension: room.state?.tension, streak: room.state?.streak, flow: room.state?.flow, form: room.state?.form,
      axe: room.state?.axe, fusion: fusion.stats(), feel: feel.stats(), pieces: pieces.stats(), glows: glows.count, travelling,
      seats: [0, 1].map((s) => ({ el: bodies[s].element(), root: bodies[s].root().map((v) => +v.toFixed(2)), world: seatDancer[s] ? gates.worldOf(seatDancer[s]!) : null })),
      crossings: roaming.log, ways: roaming.counts, opening, you: you.own(), world: app.main.world, side: rig.mode === 'locked',
      devices: seatCtl.map((c) => (c?.source as { name?: string } | undefined)?.name ?? null),
      script: runner ? { fired: (runner as ScriptRunner).fired, done: (runner as ScriptRunner).done } : null,
    }),
    start,
    makeIntent,
    /** (a local room) the play ends in `ms`: the finale, then the results. For captures of the end without its 3 minutes */
    endIn: (ms = 0) => {
      const S = (room.session.net as unknown as { session?: { phase: string; sessionEnd: number | null; tEnd: number | null; changed: boolean } }).session;
      if (!S || S.phase !== 'play') return false;
      S.sessionEnd = S.tEnd = room.now() + ms; S.changed = true;
      return true;
    },
  };
  // bend.jogo: the hooks are installed after this (main.ts), so the first frame puts it there
  frame.tick('input', () => { const b = (window as unknown as { bend?: Record<string, unknown> }).bend; if (b && b.jogo !== api) b.jogo = api; }, 'jogo: bend.jogo');
  return api;
}

const num = (s: string | null) => (s != null && Number.isFinite(+s) ? +s : undefined);
