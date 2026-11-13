// The jogo, joined to the game: main.ts calls `registerPlay(app)` once, and this decides from the page's address what
// the page is:
//   ?jogo=same       two dancers on one screen (the first device to press plays dancer 1, the next dancer 2; until a
//                    second device comes, the partner dances 2)
//   ?jogo=partner    against a partner brain: src/ai's PartnerBrain (&partner=playful|calm|fierce|mirror; playful by
//                    default; &partner=standin the jogo's own little stand-in, partner.ts)
//   ?jogo=online&room=CODE[&create][&watch]   one seat of a room on the room server (&server=ws://…/ws; default this
//                    host's 5417); &watch dances as a free guest
//   ?jogo=script&script=NAME    a scripted jogo (src/play/scripts/NAME.json), for films and captures; also bend.jogo.run
//   &world=pool &dress=fire,water &free (the 3D view; the side view is the default)
//   nothing          the front of the game over the show (menu.ts); ?play stays the solo free dance
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
import { gridError, beatAt, RULES } from '../../shared/rules.ts';
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
import { Lobby, Waiting, showFront, escapeToFront, hrefOf } from './menu';

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
  const mode = q.get('jogo');
  if (mode == null) {
    // the plain page: the front of the game over the show (never in a film, or with any of the debug demos)
    const demo = ['play', 'net', 'landmarks', 'wander', 'film', 'gates', 'fly', 'nomenu', 'pip', 'you', 'lock', 'roda', 'teach', 'npcs', 'perf', 'perfgroup'].some((k) => q.has(k));
    if (!demo && typeof document !== 'undefined') {
      const root = showFront(q);
      // the show goes on behind it; a press on the canvas (the show's wake) hides the front
      app.canvas.addEventListener('pointerdown', () => root.classList.add('dim'), { once: true });
    }
    return null;
  }
  return startJogo(app, mode);
}

export async function startJogo(app: PlayApp, mode: string) {
  const { kit, frame, show, rig, gates, music, field, query: q } = app;
  const scripted = mode === 'script';
  const online = mode === 'online';
  const script = scripted ? scriptNamed(q.get('script') ?? 'pool-fire-water') : null;
  const world = () => app.worldOf(app.main.world);
  const dress = (q.get('dress') ?? script?.dress?.join(',') ?? 'fire,water').split(',');
  // dressed by seat (online, this page's own dancer is its seat's; set once the room says which)
  show.dress = [dress[0] ?? 'fire', dress[1] ?? dress[0] ?? 'water'];

  // ---------------------------------------------------------------- the dancers (dancer/play.ts: devices, the lock)
  const { playDemo } = await import('../dancer/play');
  const play = await playDemo({
    show, rig, frame, kit, canvas: app.canvas, world, motion: app.motion, travel: app.travel, coarse: app.coarse, wake: app.wake,
    seen: (d) => gates.seen(app.main.world, [d]).joints[0] ?? null,
  });
  escapeToFront();

  // ---------------------------------------------------------------- the room
  const server = q.get('server') ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:5417/ws`;
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
  const aiPartner = new AiPartner({
    world, events: () => frameEvents, clips,
    music: () => {
      const e = music.engine;
      return music.live ? { level: Math.min(1, e.level / 4 + 0.1), breakdown: false } : { level: Number(q.get('level') ?? 0.6), breakdown: false };
    },
  }, wanted in PRESETS ? (wanted as PresetName) : 'playful');
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
    hub.join(scripted ? new BotSource(null, 'script') : ps, 'bot');
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
  const beatNow = () => { const m = room.state?.music; return m ? beatAt(m, room.now()) : 0; };
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
    updraftAt: (p) => pieces.updraftAt(p), frame: () => kit.frameIndex,
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
  const flow = new Flow(bodies, {
    glows, sfx, now: () => room.now(), rise: (s) => show.rise(s),
    respawn: (_s, c) => c.spawn(), plane: () => play.plane(),
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
    waiting = new Waiting(room.session.room ?? '', `${location.origin}${hrefOf({ mode: 'online', world: world().id, dress: [dress[0] ?? 'fire', dress[1] ?? 'water'], lock: !q.has('free'), room: room.session.room ?? '' }, location.pathname, q)}`);
    app.wake();
  }

  // ---------------------------------------------------------------- the lock: the side view unless &free
  if (!q.has('free') && script?.lock !== false) rig.lock(world().stages[0] ?? null);

  // ---------------------------------------------------------------- starting: a lobby on one screen, at once scripted
  let lobby: Lobby | null = null;
  let started = online;
  const start = async () => {
    if (started) return;
    started = true;
    lobby?.hide();
    app.wake();
    if (!room.connected) await room.connect();
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
    // capture is the room's first frame whatever the page did before; watched live, after a second
    let waited = 0;
    frame.tick('input', () => { if (!started && (kit.manual || ++waited > 60)) void start(); }, 'jogo: a script waits for the first stepped frame');
  } else if (!online) {
    lobby = new Lobby(mode === 'partner');
    lobby.seat(1, 'bot');
    const was = play.hub.onJoin;
    play.hub.onJoin = (p) => {
      was?.(p);
      lobby?.seat(p.index, p.device);
      if (p.index === 0 && !started) setTimeout(() => void start(), 1600);
      if (p.index === 1) music.players.add(play.dancers[1].id);
    };
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
      const key = `${st.music.epoch}/${st.music.bpm}`;
      music.clock.measure(room.now() / 1000, music.heardTime(), f.dt);
      if (key !== lastSync) { lastSync = key; music.engine.syncTo({ epoch: st.music.epoch, bpm: st.music.bpm }); }
      if (st.phase === 'play' && playFrom == null && st.sessionEnd != null) playFrom = st.sessionEnd - RULES.SESSION_MS;
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
  }, 'jogo: the room\'s clock, the beat, the tension, the script');

  frame.tick('travel', (f) => {
    glows.clear();
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
    // online, this page's own dancer moved the room (a seat's travel moves the jogo's world)
    if (online && d === play.dancers[0]) room.send(room.session.seat ?? 0, { t: 'travel', world: e.to, portal: e.partner });
  });

  frame.tick('camera', (f) => {
    if (!started) return;
    fusion.camera(f.dt);
    // the results stand back to hold their ring
    if (room.state?.phase === 'over') rig.framePad = Math.max(rig.framePad, 1.1);
    // online: this page's dancer to the room (20 Hz on the wire), with its state for the others' exchanges
    if (online) {
      const c = play.controllers[0].character;
      room.session.sendPose(play.dancers[0].skeleton, { world: world().id, flags: c.flags, move: c.move ? [String(c.move.serial), c.move.startTime] : null });
    }
  }, 'jogo: the fusion stands back; online, the pose out');

  frame.tick('post', () => draw.upload(), 'jogo: its glows to the GPU');

  // ---------------------------------------------------------------- the hooks (bend.jogo)
  const api = {
    room, jogo, feel, fusion, pieces, glows, builder,
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
      seats: [0, 1].map((s) => ({ el: bodies[s].element(), root: bodies[s].root().map((v) => +v.toFixed(2)) })),
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
