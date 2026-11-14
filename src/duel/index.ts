// ?duel: Energy Bending's fast two-player arena mode (docs/design/duel.md), beside the jogo (src/play). Two bodies on
// one screen on the world's duel arena, the view locked side-on to its plane framing both: three hits scatter a body,
// so does a fall, it re-forms, and the first to five KOs takes the round.
//   ?duel&world=temple&dress=fire,water&p1=human&p2=bot&skill=0.7&style=aggressive&seed=3
//     p1, p2      human (a device: keyboard, split keyboard, gamepad, as the jogo's same screen) or bot (a virtual
//                 player, src/ai/duel-brain.ts). Default: p1 human, p2 bot. Two humans: the first device to press plays
//                 seat 1, the next seat 2.
//     skill       0 … 1 (one for both, or "a,b" per seat); style aggressive | evasive | showy (one, or "a,b"); seed
//     go          start at once without waiting for the human seats' devices
// The rules are shared/duel.ts through match.ts (pure: the same in Node, sim.ts); what is felt is fx.ts (the jogo's
// feel for hits and clashes, the duel's own KO scatter and reform); the HUD is src/hud's, handed a HudState each frame
// (hud-state.ts) through `bend.hud?.set(state)`. `bend.duel` exposes the state, the events, a restart and the seats'
// brains.
//
// Each frame (engine/frame.ts phases): input — what the brains see (the Scene) and the seats' gates; dancers — the
// bodies step (a seat's controls held while the duel says so); travel — the rules judge what the bodies did, the
// effects and the HUD follow; post — the glows go up to the GPU.
import type { FrameCtx } from '../engine/frame';
import type { StagePlane } from '../engine/camera';
import type { Dancer } from '../dancer/dancer';
import type { IntentController } from '../dancer/intent-controller';
import type { PlasmaPasses } from '../matter/plasma/plasma';
import type { Music } from '../audio/music';
import type { PlayApp } from '../play';
import { makeIntent, type Intent, type IntentSource, type InputMode } from '../input/intent';
import { BotSource } from '../input/touch';
import { JOINT } from '../skeleton/rig';
import { Glows } from '../play/glow';
import { GlowDraw } from '../play/glow-draw';
import { elementOf } from '../play';
import { Scene } from '../ai/scene';
import { BrainDriver } from '../ai/driver';
import type { Brain, StageView } from '../ai/brain';
import { DuelBrain, DUEL_STYLES, type DuelSight, type DuelStyle } from '../ai/duel-brain';
import { arenaFor, type Arena } from './arena';
import { fallbackArena } from './fallback';
import { DuelMatch, duelPlane } from './match';
import { DuelFx } from './fx';
import { DuelHud, type HudSeat, type HudState } from './hud-state';
import type { DuelEvent } from '../../shared/duel.ts';

type V3 = [number, number, number];

/** a seat's source, held: nothing gets through while the duel holds the seat (the count-in, scattered), and the lock,
 *  form, merge and interact buttons are the jogo's, never the duel's */
class SeatGate implements IntentSource {
  readonly name: string;
  inner: IntentSource | null = null;
  private _mode: InputMode = 'locked';
  constructor(seat: number, private held: () => boolean) { this.name = `duel.seat${seat}`; }
  get mode() { return this._mode; }
  set mode(m: InputMode) { this._mode = m; if (this.inner) this.inner.mode = m; }
  update(dt: number): Intent {
    const it = this.inner ? this.inner.update(dt) : makeIntent();
    if (this.held()) { const o = makeIntent(); o.source = it.source; return o; }
    it.lock = false; it.form = false; it.merge = false; it.interact = false;
    return it;
  }
}

/** a brain's spec on the address or through bend.duel.setBrain */
export interface BrainSpec { style?: DuelStyle; skill?: number; seed?: number }

const perSeat = (v: string | null, k: number) => { if (v == null) return null; const xs = v.split(','); return xs[k] ?? xs[0]; };

export async function startDuel(app: PlayApp) {
  const { kit, frame, show, rig, music, field, query: q } = app;
  const world = () => app.worldOf(app.main.world);
  const W = world();
  // ---------------------------------------------------------------- the arena (the arena work's, or the fallback)
  const stage0: StagePlane = W.stages[0] ?? { id: 'duel.test', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5, ground: 0, ledges: [{ id: 't.l', x0: -3.6, x1: -1.8, y: 1.3 }, { id: 't.r', x0: 1.8, x1: 3.6, y: 1.3 }, { id: 't.m', x0: -0.9, x1: 0.9, y: 2.6 }], spawns: [[-2, 0], [2, 0]] };
  const arena: Arena = arenaFor(W.id) ?? fallbackArena(W.id, stage0);
  const plane = duelPlane(arena);
  const dress = (q.get('dress') ?? 'fire,water').split(',');
  show.dress = [dress[0] ?? 'fire', dress[1] ?? dress[0] ?? 'water'];

  // ---------------------------------------------------------------- the bodies (dancer/play.ts: devices, the lock)
  const { playDemo } = await import('../dancer/play');
  const play = await playDemo({
    show, rig, frame, kit, canvas: app.canvas, world, motion: app.motion, travel: app.travel, coarse: app.coarse, wake: app.wake,
    seen: (d) => app.gates.seen(app.main.world, [d]).joints[0] ?? null,
    worldOf: (d) => app.worldOf(app.gates.worldOf(d)),
    stage: () => plane,
  });
  play.addPlayer(new BotSource(null, 'waiting'));
  const ctl = play.controllers as IntentController[];
  const chars = [ctl[0].character, ctl[1].character] as const;
  for (const c of ctl) c.setPlane(plane);
  rig.lock(plane);
  for (const d of play.dancers) music.players.add(d.id);
  // dressed by seat (the show restages the cast when a dancer joins: dress them once both are in)
  for (let k = 0; k < 2; k++) show.setDress(k, show.dress[k]);

  // ---------------------------------------------------------------- the duel
  let now = 0;
  const bpm0 = 112;
  const match = new DuelMatch(chars, arena, plane, 0, bpm0);
  const sight = (): DuelSight => ({
    untouchable: [match.untouchable(0, now), match.untouchable(1, now)], frozen: [match.frozen(0), match.frozen(1)],
    yKill: arena.bounds.yKill, spawns: arena.spawns,
  });

  // ---------------------------------------------------------------- the seats: humans and virtual players
  const kinds = [q.get('p1') ?? 'human', q.get('p2') ?? 'bot'].map((x) => (x === 'bot' || x === 'ai' || x === 'cpu' ? 'bot' : 'human'));
  let started = false;
  const gates = [0, 1].map((k) => new SeatGate(k, () => !started || match.frozen(k)));
  for (let k = 0; k < 2; k++) ctl[k].source = gates[k];
  const scene = new Scene();
  scene.bodies = [0, 1].map((k) => ({ id: `seat.${k}`, seat: k, character: chars[k] }));
  const stageView = (): StageView => ({ plane, stage: plane, terrain: { groundAt: (x, z) => world().groundAt(x, z) }, gates: [], room: world().room, solids: world().solids });
  const brains: (Brain | null)[] = [null, null];
  const drivers: (BrainDriver | null)[] = [null, null];
  const devices: (IntentSource | null)[] = [null, null];
  const specOf = (k: number): BrainSpec => {
    const st = perSeat(q.get('style'), k);
    return {
      style: (DUEL_STYLES as readonly string[]).includes(st ?? '') ? (st as DuelStyle) : (['aggressive', 'showy'] as const)[k],
      skill: Number(perSeat(q.get('skill'), k) ?? 0.7),
      seed: Number(q.get('seed') ?? 5) * 7 + k * 101,
    };
  };
  /** a seat's brain: a DuelBrain from a spec, any Brain, or null to give the seat back to its device */
  const setBrain = (k: number, b: Brain | BrainSpec | null) => {
    if (b && !('think' in b)) b = new DuelBrain({ ...b, duel: sight });
    brains[k] = b as Brain | null;
    if (b) {
      const d = new BrainDriver(b as Brain, { id: `seat.${k}`, seat: k, character: chars[k] }, scene, stageView);
      drivers[k] = d;
      gates[k].inner = d.source();
    } else { drivers[k] = null; gates[k].inner = devices[k]; }
    gates[k].inner && (gates[k].inner!.mode = 'locked');
    return brains[k];
  };
  for (let k = 0; k < 2; k++) if (kinds[k] === 'bot') setBrain(k, specOf(k));
  // the devices: the first to press plays the first human seat, the next the other (the hub numbers them as they come)
  const humanSeats = [0, 1].filter((k) => kinds[k] === 'human');
  const hub = play.hub;
  const seatDevice = (index: number, src: IntentSource) => {
    const k = humanSeats[index];
    if (k == null) return;
    devices[k] = src; src.mode = 'locked';
    if (!brains[k]) gates[k].inner = src;
    console.info(`duel: seat ${k + 1} is ${src.name}`);
    app.wake();
    if (!started && humanSeats.every((s) => devices[s])) begin();
  };
  hub.onJoin = (p) => seatDevice(p.index, p.source);
  hub.onChange = (p) => seatDevice(p.index, p.source);

  // ---------------------------------------------------------------- what is seen and heard
  const glows = new Glows();
  const draw = new GlowDraw(kit, glows);
  draw.declare(app.main.scene, () => true);
  const plasma = show.kinds.find((k) => k.id === 'plasma') as PlasmaPasses | undefined;
  const cam = kit.camera;
  const ear = (p: V3) => {
    const dx = p[0] - cam.position[0], dy = p[1] - cam.position[1], dz = p[2] - cam.position[2], d = Math.hypot(dx, dy, dz) || 1;
    const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    return { pan: Math.max(-1, Math.min(1, (dx * right[0] + dz * right[2]) / Math.max(d, 2))), dist: Math.min(1, d / 14) };
  };
  const dancer = (k: number): Dancer | null => play.dancers[k] ?? null;
  const fx = new DuelFx({
    glows, plane: () => plane, dancer, character: (k) => chars[k], element: (k) => elementOf(dancer(k)),
    sfx: (name, o) => { music.sfx(name as Parameters<Music['sfx']>[0], o); }, ear,
    rumble: (k, s, ms) => { const i = humanSeats.indexOf(k); if (i >= 0) hub.rumble(i, s, ms); },
    field, arcs: plasma?.arcs ?? null, burst: app.hand?.burst ?? null, frame: () => kit.frameIndex,
    untouchable: (k) => match.untouchable(k, now),
  });
  const hud = new DuelHud();
  const project = (p: V3): [number, number] | null => {
    const m = cam.viewProj, x = p[0], y = p[1], z = p[2];
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 1e-4) return null;
    const u = cx / w * 0.5 + 0.5, v = 0.5 - cy / w * 0.5;
    return u < -0.2 || u > 1.2 || v < -0.2 || v > 1.2 ? null : [u, v];
  };
  const hudSeats = (): HudSeat[] => [0, 1].map((k) => {
    const d = dancer(k), c = chars[k] as unknown as Record<string, unknown>;
    const head = d ? (d.skeleton.pos[JOINT.HeadEnd] as unknown as V3) : null;
    // (the dash's readiness, once the body has one: whatever the movement work names it)
    const dash = typeof c.dashReady === 'number' ? (c.dashReady as number) : typeof c.dashCharge === 'number' ? (c.dashCharge as number) : 1;
    return { name: brains[k] ? `P${k + 1} · ${(brains[k] as DuelBrain).style ?? 'bot'}` : `P${k + 1}`, matter: elementOf(d), screen: head ? project([head[0], head[1] + 0.12, head[2]]) : null, dash };
  });

  // ---------------------------------------------------------------- starting
  const begin = () => {
    if (started) return;
    started = true;
    app.wake();
    if (!music.live && !app.film) music.start(show.program.key);
    match.restart(now);
  };
  // only bots: at once; a human seat waits for its device (or &go). A film (stepped by hand) starts on its first frame
  if (!humanSeats.length || q.has('go')) begin();

  // ---------------------------------------------------------------- each frame
  let frameEvents: DuelEvent[] = [];
  let hudState: HudState | null = null;
  let beat = 0, bpm = bpm0;
  frame.tick('input', (f: FrameCtx) => {
    beat = f.beat.beats; bpm = f.beat.bpm || bpm0;
    // what the brains see this frame (before the bodies step: the drivers think as the controllers ask)
    scene.update({ t: now / 1000, dt: f.danceDt, beat, bpm, music: { level: music.live || app.film ? Math.min(1, music.engine.level / 4 + 0.1) : 0.7, breakdown: false }, rules: null });
    for (let k = 0; k < 2; k++) { chars[k].lookAt = chars[1 - k].root; }
  }, 'duel: what the brains see');

  frame.tick('travel', (f: FrameCtx) => {
    glows.clear();
    if (!started) { for (let k = 0; k < 2; k++) chars[k].events.length = 0; return; }
    now += f.danceDt * 1000;
    const ev = match.step(now, beat, bpm);
    frameEvents = ev;
    for (let k = 0; k < 2; k++) chars[k].events.length = 0;
    fx.update(f.danceDt, ev);
    const seats = hudSeats();
    hud.events(ev, seats);
    hudState = hud.build(match.state, now, f.dt, seats, beat, bpm);
    const H = (window as unknown as { bend?: { hud?: { set?: (s: HudState) => void } } }).bend?.hud;
    H?.set?.(hudState);
    // (a round's last KO and the results stand the camera back a little; the lock frames both bodies otherwise)
    rig.framePad = match.state.phase === 'won' ? 0.5 : 0;
  }, 'duel: the rules judge the bodies, the effects and the HUD');

  frame.tick('post', () => draw.upload(), 'duel: its glows to the GPU');

  // ---------------------------------------------------------------- bend.duel
  const api = {
    match, arena, plane,
    get state() { return match.state; },
    get started() { return started; },
    /** this frame's events, and every event so far with its time (ms of duel time) */
    events: () => frameEvents,
    history: match.history,
    /** the HudState handed to the HUD this frame */
    hud: () => hudState,
    /** begin now (the human seats' devices not yet in), or from round 1 again */
    start: begin,
    restart: () => { if (!started) begin(); else match.restart(now); },
    /** a seat's brain: { style, skill, seed } for a virtual player, any Brain, or null for the seat's device */
    setBrain,
    brains,
    drivers,
    /** what a virtual player would press for a seat now (for the playtest's brain-driven keys): its last Intent */
    wish: (k: number) => drivers[k]?.intent ?? null,
    now: () => now,
    stats: () => ({
      phase: match.state.phase, round: match.state.round, kos: match.state.seats.map((s) => s.kos), hits: match.state.seats.map((s) => s.hits),
      life: match.state.seats.map((s) => s.life), clock: match.clock(now), stats: { ...match.state.stats },
      seats: [0, 1].map((k) => ({ s: +chars[k].s.toFixed(2), y: +(chars[k].root[1] - plane.origin[1]).toFixed(2), grounded: chars[k].grounded, move: chars[k].move?.name ?? null, source: gates[k].inner?.name ?? null, brain: brains[k]?.name ?? null })),
      arena: arena.world, fallback: !arenaFor(W.id),
    }),
  };
  frame.tick('input', () => { const b = (window as unknown as { bend?: Record<string, unknown> }).bend; if (b && b.duel !== api) b.duel = api; }, 'duel: bend.duel');
  console.info(`duel: ${W.id} (${arenaFor(W.id) ? 'its arena' : 'a fallback arena from its stage'}), ${kinds.join(' v ')}`);
  return api;
}
