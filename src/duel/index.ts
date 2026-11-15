// ?duel: Energy Bending's dance battle (docs/design/duel.md, the owner's second correction: nobody is knocked out or
// hurt), beside the jogo (src/play). Two bodies free in the world's arena, the camera following from third person and
// framing both; the 2D lock onto the arena's stage plane is an option anywhere (`l`, a player's lock button, or &lock).
// Like contact improvisation: run at each other, jump, catch each other (the grab: the punch button, held), swing each
// other round (the stick pumps it, on the beat twice as hard), fling each other away (let go), launch off each other's
// hands (jump while held above them), spin out (jump or dodge while held), land on each other's shoulders (a vault);
// the two energies merge. Combos, style (mostly for leading), a shared energy, a set on the music, a fusion finale.
//   ?duel&world=temple&dress=fire,water&p1=human&p2=bot&skill=0.7&style=lead&seed=3[&lock][&set=60]
//     p1, p2      human (a device: keyboard, split keyboard, gamepad, touch) or bot (a virtual player,
//                 src/ai/duel-brain.ts). Default: p1 human, p2 bot. Two humans: the first device to press plays seat 1
//     skill       0 … 1 (one for both, or "a,b" per seat); style lead | flyer | base (one, or "a,b"); seed
//     set         a set's length in seconds (default 60); go: start at once without waiting for the human seats' devices
//     keys        the power keys the panels show for virtual players (one, or "a,b": solo | left | right | pad), as if
//                 people played them (a film's: &keys=left,right); a human seat shows its own device's
//     net         online: &net=ROOM[&server=wss://…/ws][&bot] (online.ts): the room server plays the duel, this page
//                 one seat of it (the first to come seat 1, the second seat 2, more watch); p1, p2, go are ignored
//   The grab (the duel's scheme): keyboard J (solo and left layouts, the mouse's left button on solo), , (right layout);
//   gamepad the punch button; touch the punch button. The fling's aim is the stick.
//   The powers (phase 2, shared/powers.ts and powers.ts; drawn by power-fx.ts), two by the body's matter, aimed by the
//   stick: keyboard U and H (solo, left), P and [ (right); gamepad RT and LT; touch 'power 1' and 'power 2'. The power
//   form at full flow: E (solo, left), Enter (right), both stick clicks, touch 'form'. Their temporary solids (ice
//   steps, pillars, the frozen bar) are in World.solids while they stand.
// The rules are shared/duel.ts, the contact contact.ts, joined in match.ts (pure: the same in Node, sim.ts); what is
// felt is fx.ts; the HUD is src/hud's, handed a HudState (version 2) each frame through `bend.hud.set(state)`
// (hud-state.ts). `bend.duel` exposes the state, the events, a restart and the seats' brains.
//
// Each frame (engine/frame.ts phases): input — what the brains see (the Scene); dancers — the bodies step, each seat's
// Intent split between its body and the contact (seat gates); travel — the contact and the rules, the effects;
// camera — the free camera side-on to the pair; post — the glows up to the GPU, the HUD's state.
import type { FrameCtx } from '../engine/frame';
import type { StagePlane } from '../engine/camera';
import type { Dancer } from '../dancer/dancer';
import type { IntentController } from '../dancer/intent-controller';
import type { PlayApp } from '../play';
import { makeIntent, EDGES, type Intent, type IntentSource, type InputMode } from '../input/intent';
import { BotSource } from '../input/touch';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import { Glows } from '../play/glow';
import { GlowDraw } from '../play/glow-draw';
import { elementOf } from '../play';
import { Scene } from '../ai/scene';
import { BrainDriver } from '../ai/driver';
import type { Brain, StageView } from '../ai/brain';
import { DuelBrain, DUEL_STYLES, STYLE_ALIAS, type DuelSight, type DuelStyle } from '../ai/duel-brain';
import { arenaFor, showArena, type Arena } from './arena';
import { fallbackArena } from './fallback';
import type { Solid } from '../worlds/solids';
import { DuelMatch, duelPlane } from './match';
import { noInput, splitIntent, type ContactInput, type ContactEvent } from './contact';
import { DuelFx, type DuelFxCtx } from './fx';
import { DuelPowers, noPower, type PowerInput } from './powers';
import { PowerFxDraw } from './power-fx';
import { DuelHazards } from './hazards';
import { HazardFxDraw } from './hazards-fx';
import { matterOf, POWER_NAME } from '../../shared/powers.ts';
import { onBeat } from '../../shared/duel.ts';
import { POWER_KEYS, type KeyLayout } from '../input/keyboard';
import { POWER_BUTTONS } from '../input/gamepad';
import type { WaterPasses } from '../matter/water/pool';
import type { PlasmaPasses } from '../matter/plasma/plasma';
import { Finale } from './finale';
import { DuelCamera, type CamBody, type CamSpace } from './camera';
import { spaceFor } from './camspace';
import { SEAT_CSS } from './seat';
import { camKind } from './weight';
import { DuelHud, screenOf, type HudSeat, type HudState, type HudWord } from './hud-state';
import { duelSound, phraseSetMs } from './sound';
import { trackFor } from '../audio/track';
// (the HUD is the page's one, reached through bend.hud, and screenOf is hud-state.ts's copy of src/hud's: any value
// imported from src/hud lands in main.ts's own chunk, and the duel's chunk importing it waits for main.ts to finish
// evaluating, which awaits the duel at the top level: a production build hung, the page never ready)
import type { DuelEvent } from '../../shared/duel.ts';
import type { Joined } from '../play';
import { duelLobby } from '../play/menu';
import { installHelp } from './help';
import { startLesson } from './lesson';

type V3 = [number, number, number];

/** a seat's source, gated and split: nothing gets through while the duel holds the seat (the count-in, reforming);
 *  the grab (the punch button) and, while joined, the stick and the jump go to the contact (contact.ts splitIntent);
 *  the form, merge and interact buttons are the jogo's, never the duel's (the lock button toggles the lock) */
class SeatGate implements IntentSource {
  readonly name: string;
  inner: IntentSource | null = null;
  /** what the contact reads this frame, and the powers */
  contact: ContactInput = noInput();
  power: PowerInput = noPower();
  private _mode: InputMode = 'locked';
  constructor(seat: number, private held: () => boolean, private split: (it: Intent) => ContactInput) { this.name = `duel.seat${seat}`; }
  get mode() { return this._mode; }
  set mode(m: InputMode) { this._mode = m; if (this.inner) this.inner.mode = m; }
  update(dt: number): Intent {
    const it = this.inner ? this.inner.update(dt) : makeIntent();
    if (this.held()) { const o = makeIntent(); o.source = it.source; this.contact = noInput(); this.power = noPower(); return o; }
    const p1 = !!it.power1, p2 = !!it.power2, form = !!it.form;
    it.form = false; it.merge = false; it.interact = false;
    this.contact = this.split(it);
    // (the powers' edges and the form, aimed by the stick as the contact reads it)
    this.power = { p1, p2, form, stick: this.contact.stick };
    return it;
  }
}

/** a brain's spec on the address or through bend.duel.setBrain */
export interface BrainSpec { style?: DuelStyle; skill?: number; seed?: number }

const perSeat = (v: string | null, k: number) => { if (v == null) return null; const xs = v.split(','); return xs[k] ?? xs[0]; };

export async function startDuel(app: PlayApp, opts: { joined?: Joined } = {}) {
  const { kit, frame, show, rig, music, field, query: q } = app;
  const world = () => app.worldOf(app.main.world);
  const W = world();
  // ---------------------------------------------------------------- the arena (the arena work's, or the fallback)
  const stage0: StagePlane = W.stages[0] ?? { id: 'duel.test', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5, ground: 0, ledges: [{ id: 't.l', x0: -3.6, x1: -1.8, y: 1.3 }, { id: 't.r', x0: 1.8, x1: 3.6, y: 1.3 }, { id: 't.m', x0: -0.9, x1: 0.9, y: 2.6 }], spawns: [[-2, 0], [2, 0]] };
  const arena: Arena = arenaFor(W.id) ?? fallbackArena(W, stage0);
  // the arena shown (src/duel/arena.ts): the world draws its pieces, lists them in World.solids (the bodies' walls and
  // floors, the camera, the near fade), opens its drops; the arena's camera range in place of the world's room
  showArena(arenaFor(W.id) ? W.id : null);
  const roomWas = Object.getOwnPropertyDescriptor(W, 'room');
  if (arena.camera?.maxDist) { const room = arena.camera.maxDist; Object.defineProperty(W, 'room', { get: () => room, configurable: true }); }
  // the world's solids, with the powers' temporary ones (ice steps, pillars, the frozen bar) laid in while they stand:
  // World.solids is what the bodies, the camera, the near fade and the brains all read
  const powerSolids: Solid[] = [];
  const solidsWas = Object.getOwnPropertyDescriptor(W, 'solids');
  const baseSolids = (): readonly Solid[] => (solidsWas ? (solidsWas.get ? solidsWas.get.call(W) : solidsWas.value) : Object.getPrototypeOf(W) && Reflect.get(Object.getPrototypeOf(W), 'solids', W)) ?? [];
  let solidsKey: [readonly Solid[] | null, number] = [null, -1], solidsAll: Solid[] = [];
  let powersVersion = () => 0;
  Object.defineProperty(W, 'solids', {
    configurable: true,
    get: () => {
      const base = baseSolids(), v = powersVersion();
      if (solidsKey[0] !== base || solidsKey[1] !== v) { solidsKey = [base, v]; solidsAll = powerSolids.length ? [...base, ...powerSolids] : [...base]; }
      return solidsAll;
    },
  });
  const solids = (): readonly Solid[] => world().solids ?? [];
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
  // free in the world (the follow camera behind seat 1, framing both); &lock starts locked to the arena's plane, and
  // `l` (or a player's lock button: Tab, V, the View button) toggles it anywhere, as in ?play
  if (q.has('lock')) { for (const c of ctl) c.setPlane(plane); rig.lock(plane); }
  for (const d of play.dancers) music.players.add(d.id);
  // dressed by seat (the show restages the cast when a dancer joins: dress them once both are in)
  for (let k = 0; k < 2; k++) show.setDress(k, show.dress[k]);

  // ---------------------------------------------------------------- the duel
  let now = 0;
  const bpm0 = 112;
  // (a set of whole phrases of the world's track, so its finale lands on a phrase line: sound.ts; a film's or &set's as asked)
  const setMs = q.has('set') || app.film ? Number(q.get('set') ?? 60) * 1000 : phraseSetMs(60000, trackFor(W.id)?.bpm ?? bpm0);
  const match = new DuelMatch(chars, arena, plane, 0, bpm0, { solids, setMs });
  // the powers by each body's matter (its dress's biggest layer, as dressed: not its form)
  const kindOf = (k: number) => { const d = play.dancers[k]; let best = show.dress[k], share = -1; if (d) for (const l of d.loadout.layers) if (l.share > share) { share = l.share; best = l.kind; } return matterOf(best); };
  const powers = new DuelPowers(chars, match, { matter: [kindOf(0), kindOf(1)], sink: powerSolids, groundAt: (x, z) => world().groundAt(x, z), yKill: arena.space.yKill });
  powersVersion = () => powers.version;
  // the arena's gentle hazard (hazards.ts: the tide, the wind, the swell, the hum), after the powers; &hazards=0 off
  const hazards = new DuelHazards(chars, match, arena, { on: q.get('hazards') !== '0' });
  // the finale's duet (finale.ts): it holds both seats and moves the bodies for its length
  const finale = new Finale(chars);
  const sight = (): DuelSight => {
    const L = match.contact.link;
    return {
      frozen: [match.frozen(0), match.frozen(1)], link: L ? { holder: L.holder, held: L.held, age: match.contact.age } : null,
      flown: match.contact.flown?.flyer ?? null,
      yKill: arena.space.yKill, space: arena.space, spawns: arena.spawns, solids: solids(), groundAt: (x, z) => world().groundAt(x, z),
      powers: powers.sight(), bends: powers.liveSight(), hazard: hazards.sight(),
    };
  };

  // ---------------------------------------------------------------- the seats: humans and virtual players
  const kinds = [q.get('p1') ?? 'human', q.get('p2') ?? 'bot'].map((x) => (x === 'bot' || x === 'ai' || x === 'cpu' ? 'bot' : 'human'));
  // online (&net=ROOM, online.ts): no virtual player here but this page's own seat's with &bot (set below)
  const online = q.has('net');
  if (online) kinds.splice(0, 2, 'human', 'human');
  let started = false;
  const gates = [0, 1].map((k) => new SeatGate(k, () => !started || match.frozen(k) || finale.holds(k), (it) => splitIntent(chars[k], it, match.contact.holding(k), match.contact.held(k))));
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
      style: (DUEL_STYLES as readonly string[]).includes(st ?? '') ? (st as DuelStyle) : STYLE_ALIAS[st ?? ''] ?? (['lead', 'flyer'] as const)[k],
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
    if (gates[k].inner) gates[k].inner!.mode = ctl[k].locked ? 'locked' : 'free';
    return brains[k];
  };
  for (let k = 0; k < 2; k++) if (kinds[k] === 'bot' || (online && q.has('bot'))) setBrain(k, specOf(k));
  /** a ghost: a virtual player that thinks for a seat each frame without driving it (the playtest presses real keys
   *  from what it wants: scripts/playtest.mjs) */
  const ghosts: (BrainDriver | null)[] = [null, null];
  const ghostIntent: (Intent | null)[] = [null, null];
  const ghost = (k: number, spec: BrainSpec | null) => {
    ghosts[k] = spec ? new BrainDriver(new DuelBrain({ ...specOf(k), ...spec, duel: sight }), { id: `seat.${k}`, seat: k, character: chars[k] }, scene, stageView) : null;
    ghostIntent[k] = null;
    return !!ghosts[k];
  };
  // the devices: the first to press plays the first human seat, the next the other (the hub numbers them as they come)
  const humanSeats = [0, 1].filter((k) => kinds[k] === 'human');
  const hub = play.hub;
  const seatDevice = (index: number, src: IntentSource) => {
    const k = humanSeats[index];
    if (k == null) return;
    devices[k] = src; src.mode = ctl[k].locked ? 'locked' : 'free';
    if (!brains[k]) gates[k].inner = src;
    console.info(`duel: seat ${k + 1} is ${src.name}`);
    app.wake();
    if (!started && !online && humanSeats.every((s) => devices[s])) begin();
  };
  hub.onJoin = (p) => seatDevice(p.index, p.source);
  hub.onChange = (p) => seatDevice(p.index, p.source);

  // ---------------------------------------------------------------- what is seen and heard
  const glows = new Glows();
  const draw = new GlowDraw(kit, glows);
  draw.declare(app.main.scene, () => true);
  const cam = kit.camera;
  const ear = (p: V3) => {
    const dx = p[0] - cam.position[0], dy = p[1] - cam.position[1], dz = p[2] - cam.position[2], d = Math.hypot(dx, dy, dz) || 1;
    const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    return { pan: Math.max(-1, Math.min(1, (dx * right[0] + dz * right[2]) / Math.max(d, 2))), dist: Math.min(1, d / 14) };
  };
  const dancer = (k: number): Dancer | null => play.dancers[k] ?? null;
  const fx = new DuelFx({
    glows, dancer, character: (k) => chars[k], element: (k) => elementOf(dancer(k)),
    slot: (k) => { const d = dancer(k); return d ? show.dancers.indexOf(d) : -1; },
    sfx: (name, o) => sound.jogo(name, o), ear,
    rumble: (k, s, ms) => { const i = humanSeats.indexOf(k); if (i >= 0) hub.rumble(i, s, ms); },
    field: field as unknown as DuelFxCtx['field'], burst: app.hand?.burst ?? null, finale: () => finale.look(),
    eye: () => [cam.position[0], cam.position[1], cam.position[2]], form: (k) => powers.hud(k).form,
  });
  const water = app.kinds.find((k) => k.id === 'water' || k.id === 'ice') as WaterPasses | undefined;
  const plasma = app.kinds.find((k) => k.id === 'plasma') as PlasmaPasses | undefined;
  const powerFx = new PowerFxDraw({
    glows, dancer, field: field as unknown as ConstructorParameters<typeof PowerFxDraw>[0]['field'], arcs: plasma?.arcs ?? null, setIce: water?.setIce ?? null,
    ripple: (x, z, s, r) => { (world() as unknown as { ripple?: (x: number, z: number, s: number, r: number) => void }).ripple?.(x, z, s, r); },
    sfx: (name, o) => sound.jogo(name, o), ear,
    rumble: (k, s, ms) => { const i = humanSeats.indexOf(k); if (i >= 0) hub.rumble(i, s, ms); },
    fadeOf: (s) => app.fade?.strengthOf(s) ?? 0,
  }, (k) => powers.rules.seats[k].matter);
  const hazardFx = new HazardFxDraw({ glows, eye: () => cam.position, ground: (x, z) => world().groundAt(x, z), field: field as unknown as ConstructorParameters<typeof HazardFxDraw>[0]['field'], ripple: (x, z, s, r) => { (world() as unknown as { ripple?: (x: number, z: number, s: number, r: number) => void }).ripple?.(x, z, s, r); } });
  const duelHud = new DuelHud();
  /** the keys a seat's powers are on (its device's), for the HUD */
  const powerKeys = (k: number): [string, string, string] | null => {
    const n = gates[k].inner?.name ?? '';
    // (a virtual player has no keys, unless &keys names the layouts it would be on: a film's two players shown as two
    // people at one split keyboard, `&keys=left,right`, or a pad's buttons, `pad`)
    const shown = perSeat(q.get('keys'), k);
    if (brains[k]) return shown === 'pad' ? POWER_BUTTONS : (POWER_KEYS[shown as KeyLayout] ?? null);
    if (n.startsWith('keyboard-')) return POWER_KEYS[n.slice(9) as KeyLayout] ?? null;
    if (n.startsWith('gamepad')) return POWER_BUTTONS;
    return null;
  };
  // (the head on screen, past 0 … 1 when it is out of frame: the HUD points an arrow at it from the edge)
  const project = (p: V3): [number, number] => screenOf(cam.viewProj, p);
  const hudSeats = (): HudSeat[] => [0, 1].map((k) => {
    const d = dancer(k), c = chars[k] as unknown as Record<string, unknown>;
    const head = d ? (d.skeleton.pos[JOINT.HeadEnd] as unknown as V3) : null;
    // (the dash's readiness, once the body has one: whatever the movement work names it)
    const dash = typeof c.dashReady === 'number' ? (c.dashReady as number) : typeof c.dashCharge === 'number' ? (c.dashCharge as number) : 1;
    const B = powers.hud(k), keys = powerKeys(k);
    const bend = { flow: B.flow, form: B.form, powers: B.powers.map((p, i) => ({ ...p, ...(keys ? { key: keys[i] } : {}) })) };
    return { name: brains[k] ? `P${k + 1} · ${(brains[k] as DuelBrain).style ?? 'bot'}` : `P${k + 1}`, matter: elementOf(d), screen: head ? project([head[0], head[1] + 0.12, head[2]]) : null, dash, holding: match.contact.holding(k), held: match.contact.held(k), bend };
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
  if (!online && (!humanSeats.length || q.has('go'))) begin();
  // the lobby (play/menu.ts): a card per seat, how to join a waiting one; the press that began the duel on the front
  // joins seat 1; a second human seat nobody takes can go to a virtual partner; a touch player's buttons. (Online the
  // room is the lobby: online.ts shows its card)
  if (!online && !app.film && !q.has('go')) duelLobby({ hub, frame, canvas: app.canvas, humanSeats, bot: (k) => !!brains[k], started: () => started, joined: opts.joined, partner: (k) => { setBrain(k, specOf(k)); begin(); } });

  // ---------------------------------------------------------------- online: the server plays the duel (online.ts)
  const net = online ? await (await import('./online')).startOnline({
    app, q, chars, ctl, match, powers, finale, plane, arena, world: W.id, dress: [show.dress[0], show.dress[1]], matter: [kindOf(0), kindOf(1)],
    powerSolids, music, begin: () => begin(),
    source: (k) => (brains[k] ? gates[k].inner : devices[0] ?? devices[1]),
  }) : null;

  // ---------------------------------------------------------------- each frame
  let frameEvents: DuelEvent[] = [];
  let hudState: HudState | null = null;
  let beat = 0, bpm = bpm0;
  // the weight of contact (weight.ts): the frame's dance time scaled before anything steps with it (the bodies, the
  // matter, the field, the powers, the rules), held a few frames on a catch and slowed a beat on a pair tier. The
  // page's own time (f.dt: the HUD, the camera, the music) is left alone, and so is `danceReal`, what the contact's
  // ring and the link's beads (fx.ts) run on, so they keep moving through a hold
  let danceReal = 0;
  frame.tick('input', (f: FrameCtx) => {
    danceReal = f.danceDt;
    // (online the bodies' time is the room server's, the same on both pages: no warp of this page's own)
    if (started && !net) f.danceDt *= match.warp.step(f.dt);
  }, 'duel: the weight of contact (the bodies\' time)');
  frame.tick('input', (f: FrameCtx) => {
    beat = f.beat.beats; bpm = f.beat.bpm || bpm0;
    // what the brains see this frame (before the bodies step: the drivers think as the controllers ask)
    scene.update({ t: now / 1000, dt: f.danceDt, beat, bpm, music: { level: music.live || app.film ? Math.min(1, music.engine.level / 4 + 0.1) : 0.7, breakdown: false }, rules: null });
    for (let k = 0; k < 2; k++) { chars[k].lookAt = chars[1 - k].root; }
    // (a ghost's edges gather until they are read: a reader polling slower than the frames misses none)
    for (let k = 0; k < 2; k++) {
      if (!ghosts[k]) continue;
      const it = ghosts[k]!.think(), was = ghostIntent[k];
      ghostIntent[k] = { ...it };
      if (was) for (const e of EDGES) if (was[e]) ghostIntent[k]![e] = true;
    }
  }, 'duel: what the brains see');

  // the free camera (camera.ts, pure): side on to the pair, both bodies whole with head room over the higher one (a
  // rising body framed at its apex), its eye clear of the arena's pieces by more than the near fade's distance or
  // risen over them, turned smoothly. Its pose goes to the rig (CameraRig.pose), which keeps it above the ground and
  // eases the lock in and out from it. A player's own look input (the right stick, the mouse) turns it by hand for a
  // moment. The lock gets the same head room (CameraRig.apexG, headroom)
  const dcam = new DuelCamera();
  // (camspace.ts: World.solids with the powers' own, made again whenever one comes or goes)
  const spaceNow = spaceFor((x, z) => world().groundAt(x, z)), camSpace = (): CamSpace | null => spaceNow(solids());
  const FRAMED = [JOINT.Hips, JOINT.Spine1, JOINT.LeftHand, JOINT.RightHand, JOINT.LeftToeBase, JOINT.RightToeBase];
  const camBody = (k: number): CamBody | null => {
    const d = dancer(k);
    if (!d) return null;
    const J = d.skeleton.world, at = (j: number): V3 => [J[j * JOINT_FLOATS], J[j * JOINT_FLOATS + 1], J[j * JOINT_FLOATS + 2]];
    const c = chars[k];
    return { pts: FRAMED.map(at), sight: [at(JOINT.Hips), at(JOINT.Spine1)], head: at(JOINT.HeadEnd), root: [c.root[0], c.root[1], c.root[2]], vel: [c.v[0], c.v[1], c.v[2]], air: !c.grounded, away: c.reforming };
  };
  rig.apexG = chars[0].phys.gravity;
  rig.headroom = 0.5;
  frame.tick('camera', (f: FrameCtx) => {
    const a = camBody(0), b = camBody(1);
    if (!a || !b) { rig.pose = null; return; }
    // (the player turning the camera by hand: the right stick or the mouse, in the free view)
    if (rig.mode !== 'locked' && rig.lookIdle === 0) dcam.hold(rig.yaw);
    const [w, h] = kit.size.render;
    rig.pose = dcam.update(f.dt, {
      bodies: [a, b], aspect: w / Math.max(1, h), gravity: chars[0].phys.gravity, space: camSpace(), near: rig.sight.near,
      center: arena.space.center, room: arena.camera?.maxDist ?? arena.space.radius + 6, maxDist: arena.camera?.maxDist, pad: rig.framePad, arena: arena.world,
    });
  }, 'duel: the free camera, side on to the pair with head room');
  // the world's gates shut while the duel is on (a body flung through one left the arena, the camera with it; their
  // discs sat at the edge of the shots), opened again when it stops
  const shut = W.portals.map((p) => p.id);
  for (const id of shut) app.gates.close(id);

  frame.tick('travel', (f: FrameCtx) => {
    glows.clear();
    if (!started) { for (let k = 0; k < 2; k++) chars[k].events.length = 0; return; }
    let ev: DuelEvent[];
    if (net) { ev = net.frame(f.danceDt); now = net.now(); }
    else {
      // (the set's clock kept with the music: sound.ts SetMusic.nudge, 12 % at most, nothing in a film; online the
      // set's clock is the room server's)
      now += f.danceDt * 1000 + sound.music.nudge(f.dt, f.danceDt);
      powers.gripInputs([gates[0].contact, gates[1].contact]);
      ev = match.step(now, beat, bpm, f.danceDt * 1000, [gates[0].contact, gates[1].contact]);
      // the powers after the contact (a catch at range joins the two through it), their effects drawn
      powers.step(now, f.danceDt * 1000, [0, 1].map((k) => castNext[k] ?? gates[k].power), ev, onBeat(beat, bpm));
      castNext[0] = castNext[1] = null;
      ev.push(...powers.duelEvents);
    }
    // (online the server's hazards move the bodies; this page's, on the room's beat, keep the world's floor and stones
    // where the server has them and draw the hazard)
    hazards.step(beat, f.danceDt * 1000);
    for (const e of ev) {
      // (the finale: the set's powers end and fade, nothing of them runs on under the duet)
      if (e.k === 'finale') { finale.start(e.fused, bpm, [match.state.seats[0].style, match.state.seats[1].style]); powers.settle(); }
      else if (e.k === 'set') finale.stop();
    }
    const top = finale.update(f.danceDt);
    // the moments of weight (juice events) into the frame's events; the camera eases toward each
    const juice = match.juice(now, [], powers.fx, powers.live, top ? { base: finale.base, flyer: finale.flyer, at: finale.topAt() } : null);
    ev.push(...juice);
    const impulse = (dcam as unknown as { impulse?: (e: { at: V3; kind: ReturnType<typeof camKind>; k: number }) => void }).impulse;
    for (const j of juice) if (j.at) impulse?.call(dcam, { at: j.at, kind: camKind(j.what), k: j.w });
    frameEvents = ev;
    fx.update(danceReal, ev, match.touches, match.contact, match.state);
    powerFx.update(f.danceDt, powers);
    hazardFx.update(f.danceDt, hazards);
    for (const e of powers.events) pendingPowers.push(e);
    for (const x of powers.fx) if (x.k === 'react') reactAt.set(x.kind, project(x.at));
    pendingHud.push(...ev); pendingTouches.push(...match.touches);
    // (the finale and the result stand the camera back a little)
    rig.framePad = match.state.phase === 'finale' || match.state.phase === 'done' ? 0.5 : 0;
  }, 'duel: the rules judge the bodies, the effects and the HUD');

  // the HUD's state, after the camera moved (the tags ride the heads where this frame shows them)
  const pendingHud: DuelEvent[] = [], pendingTouches: ContactEvent[] = [];
  const pendingPowers: (typeof powers.events)[number][] = [];
  /** a cast asked for by bend.duel.cast, for the next frame */
  const castNext: (PowerInput | null)[] = [null, null];
  const REACT_WORD = { geyser: 'STEAM!', melt: 'MELT!', freeze: 'FREEZE!' } as const;
  const reactAt = new Map<string, [number, number]>();
  frame.tick('post', (f: FrameCtx) => {
    draw.upload();
    if (!started) return;
    const seats = hudSeats(), L = match.contact.link;
    const linkAt = L ? project(L.at) : null;
    // the powers' words, through the HUD's pop budget: a cast's name by the caster (only when there is room), the power
    // form (within the budget, or in place of the dancer's last word), a reaction where it happened (always, once)
    const words: HudWord[] = [];
    for (const e of pendingPowers.splice(0, pendingPowers.length)) {
      if (e.k === 'cast') words.push({ text: e.free ? `${POWER_NAME[e.power].toUpperCase()}+` : POWER_NAME[e.power].toUpperCase(), kind: 'power', seat: e.seat, prio: 1 });
      else if (e.k === 'form' && e.on) words.push({ text: 'POWER FORM', kind: 'power', seat: e.seat, prio: 2 });
      else if (e.k === 'react') words.push({ text: REACT_WORD[e.kind], kind: 'react', at: reactAt.get(e.kind) ?? undefined, prio: 3 });
    }
    reactAt.clear();
    duelHud.events(pendingHud.splice(0, pendingHud.length), pendingTouches.splice(0, pendingTouches.length), seats, linkAt, project, words);
    // (from: the holder's contact point, its grip; to: the held body's, its chest, which the grip carries)
    const link = L ? { on: true, from: linkAt ?? undefined, to: project(fx.chest(L.held)) } : { on: false };
    hudState = duelHud.build(match.state, now, f.dt, seats, beat, bpm, setMs, link);
    for (const p of hudState.players) p.color = SEAT_CSS[p.seat];   // (each seat its own colour, whatever its matter: seat.ts)
    (window as unknown as { bend?: { hud?: { set?: (s: HudState) => void } } }).bend?.hud?.set?.(hudState);
  }, 'duel: its glows to the GPU, its HUD state');

  // ---------------------------------------------------------------- bend.duel
  // the duel's sound (sound.ts): its moments, powers, tiers and movement on the music's beat, the track following the set
  const sound = duelSound({ frame, music, listener: kit.camera, film: app.film, world: () => app.main.world, duel: () => api, wake: () => { app.wake(); if (!music.live && !app.film) music.start(show.program.key); } });
  const api = {
    match, arena, plane, finale, powers, hazards, sound,
    /** online (&net): the room, this page's seat, the measurements (net.stats()), the client; null offline */
    net,
    /** the free camera (camera.ts): its choice, what it framed, how clear its eye stood */
    camera: dcam, camSpace,
    /** cast a seat's power now (slot 0 or 1; the stick as a world x, z), or the form: as its buttons would */
    cast: (k: number, slot: 0 | 1 | 'form', stick: [number, number] = [0, 0]) => { castNext[k] = { p1: slot === 0, p2: slot === 1, form: slot === 'form', stick }; },
    /** a seat's flow (0 … 1), read or set */
    flow: (k: number, v?: number) => { if (v !== undefined) powers.rules.seats[k].flow = Math.max(0, Math.min(1, v)); return powers.rules.seats[k].flow; },
    get state() { return match.state; },
    get started() { return started; },
    /** this frame's events, and every event so far with its time (ms of duel time) */
    events: () => frameEvents,
    history: match.history,
    /** the HudState handed to the HUD this frame */
    hud: () => hudState,
    /** begin now (the human seats' devices not yet in), or from set 1 again */
    start: begin,
    restart: () => { finale.stop(); if (!started) begin(); else match.restart(now); },
    /** the duel's end: the arena off, the world's room back */
    stop: () => {
      started = false; match.warp.reset(); showArena(null); field.fuse(null); powerFx.clear(); powers.clear(); hazardFx.clear();
      if (solidsWas) Object.defineProperty(W, 'solids', solidsWas); else delete (W as { solids?: unknown }).solids;
      rig.pose = null; rig.apexG = 0; rig.headroom = 0;
      app.gates.open(...W.portals.filter((p) => shut.includes(p.id)).map((p) => ({ ...p, world: W.id })));
      if (roomWas) Object.defineProperty(W, 'room', roomWas); else delete (W as { room?: number }).room;
    },
    /** a seat's brain: { style, skill, seed } for a virtual player, any Brain, or null for the seat's device */
    setBrain,
    brains,
    drivers,
    /** what a virtual player would press for a seat now (for the playtest's brain-driven keys): its last Intent */
    wish: (k: number) => {
      const g = ghostIntent[k];
      if (!g) return drivers[k]?.intent ?? null;
      const out = { ...g };
      for (const e of EDGES) g[e] = false;
      return out;
    },
    /** a seat's ghost: a virtual player ({ style, skill, seed }) thinking for it without driving it (null: none) */
    ghost,
    now: () => now,
    stats: () => ({
      phase: match.state.phase, set: match.state.set, style: match.state.seats.map((s) => Math.round(s.style)),
      combo: match.state.seats.map((s) => s.combo.n), energy: +match.state.energy.toFixed(2), peak: +match.state.peak.toFixed(2), merge: +match.state.merge.toFixed(2),
      link: match.contact.link ? { holder: match.contact.link.holder, held: match.contact.link.held, age: +match.contact.age.toFixed(2) } : null,
      clock: match.clock(now), stats: { ...match.state.stats }, locked: match.locked,
      seats: [0, 1].map((k) => ({ at: chars[k].root.map((v) => +v.toFixed(2)), grounded: chars[k].grounded, move: chars[k].move?.name ?? null, source: gates[k].inner?.name ?? null, brain: brains[k]?.name ?? null })),
      arena: arena.world, fallback: !arenaFor(W.id),
      powers: { flow: powers.rules.seats.map((s) => +s.flow.toFixed(2)), form: [0, 1].map((k) => +powers.hud(k).form.toFixed(2)), casts: powers.rules.seats.map((s) => s.casts), forms: powers.rules.seats.map((s) => s.forms), reactions: { ...powers.rules.reactions }, live: powers.live.map((L) => L.kind), felt: { ...powers.felt } },
    }),
  };
  // the first duel's lesson (lesson.ts, once) and the controls card (help.ts: ?, F1, Start, the ? chip)
  const lesson = startLesson({ frame, duel: api, query: q, film: app.film, humanSeats, bot: (k) => !!brains[k], device: (k) => gates[k].inner?.name ?? null, root: (k) => chars[k].root, held: (k) => match.contact.held(k), joined: (k) => match.contact.held(k) || match.contact.holding(k) });
  if (!app.film) installHelp({ frame, device: () => gates[humanSeats[0] ?? 0].inner?.name ?? null, matters: () => powers.rules.seats.map((s) => s.matter), lesson, split: () => gates.some((g) => g.inner?.name === 'keyboard-right') });
  Object.assign(api, { lesson });
  frame.tick('input', () => { const b = (window as unknown as { bend?: Record<string, unknown> }).bend; if (b && b.duel !== api) b.duel = api; }, 'duel: bend.duel');
  console.info(`duel: ${W.id} (${arenaFor(W.id) ? 'its arena' : 'a fallback arena from its stage'}), ${kinds.join(' v ')}`);
  return api;
}
