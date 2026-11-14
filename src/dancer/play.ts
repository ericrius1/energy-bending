// ?play: a playable dancer, end to end. Player one stands in the world in ginga; the first device anyone uses (a key,
// a gamepad button, a touch; 'c' for the camera body) becomes theirs, and the next device brings in player two
// (input/hub.ts). Free by default, with a third-person camera behind player one (right stick, right-drag or a drag
// to look); Tab, V or the gamepad's View button (or `l`, or bend.lock) locks the view onto the world's first stage
// plane: both dancers ease onto it, its ledges become solid to them, and the camera swings round side-on with a long
// lens. The plane is the world's own stage (src/worlds: its ledges bob with ledgeY, the forge's has no ground); a world
// with no stage at all gets a test plane with a few ledges. Set ice on the plane (the water kind's setIce) adds ledges
// you can stand on. Free, the dancers walk on the world's groundAt; in a world you can fall out of (the forge's fallY)
// they re-form at their spawn. The dancers wear gems unless ?dress says otherwise.
// ?play&two adds a second dancer on a bot from the start (for scripts). main.ts wires it with one line, like the other
// demos; it runs on the frame's input and camera phases.
// ?play&duel plays with the duel's movement (docs/design/duel.md): the bodies on DUEL_PHYS (wall slides and kicks, the
// dash, the duel's run and jump) and every device on the duel's buttons. ?play&arena=test does that on a test arena
// of its own, locked from the start: the world's first stage plane (where it stands, its lens) with two blocks whose
// four faces are walls, the plane's ends, a shaft between the left end and the tall block, and a few platforms; a 2D
// overlay draws it over the canvas (#arena-overlay), since no world draws it. The duel's own arenas are src/duel's.
import type { Kit } from '@ericrius1/weft';
import type { Show } from './show';
import { planePoint, type CameraRig, type StagePlane, type Ledge, type Wall } from '../engine/camera';
import { DUEL_PHYS } from './character';
import type { FrameBuilder } from '../engine/frame';
import type { World } from '../worlds/world';
import type { Motion } from '../skeleton/clips';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import { Dancer } from './dancer';
import { IntentController } from './intent-controller';
import { movesOf } from './wander';
import { pirouetteFlourish } from './clip-move';
import { registerMove, MOVES } from './moves';
import { gemsLoadout } from '../matter/core/kind';
import { danceParams } from './programme';
import { InputHub, type Player } from '../input/hub';
import { CameraSource } from '../input/camera';
import { TouchPad } from '../input/touch-pad';
import { BotSource, type TouchSource } from '../input/touch';
import type { IntentSource } from '../input/intent';
import { defineParams, setParams } from '../engine/params';
import type { WaterPasses } from '../matter/water/pool';
import type { IceLedge } from '../matter/ice/setice';

export interface PlayCtx {
  show: Show;
  rig: CameraRig;
  frame: FrameBuilder;
  kit: Kit;
  canvas: HTMLCanvasElement;
  /** the world the main view shows */
  world: () => World;
  motion: Motion;
  travel: Promise<Motion | null> | Motion | null;
  coarse: boolean;
  wake: () => void;
  /** a dancer's joints (the GPU layout) as the main view sees it: through a gate when it is in another world (the
   *  portals' seen), so the follow camera keeps aiming at a player who has walked through a gate. Default: its own */
  seen?: (d: Dancer) => Float32Array | null;
  /** the world a dancer is in (the portals' worldOf): the ground it walks on and the height it falls out at. Default:
   *  the main view's. (The main view changes world only once the camera's eye has come through the gate, a second
   *  after its player, so a player walking back from the forge into the hub stood on the forge's floor at hub
   *  coordinates for that second: no column there, and they fell through the hub and re-formed: 9-stage.md) */
  worldOf?: (d: Dancer) => World;
}

export const playParams = defineParams('play', {
  /** the gem suites players one and two wear */
  suiteOne: 'Violet',
  suiteTwo: 'Sky',
  /** the gems' spring while playing (see playDemo): the gems' fast-motion hold (gems/motion.ts) keeps fast limbs
   *  together, so this needs only to be stiffer than the show's 130, not 700 as before the hold */
  gemStiffness: 280,
});

/** ledges for a stage plane that has none (m, in the plane's own coordinates): two low ones to either side, a high one
 *  in the middle that bobs with the music (an air jump reaches it) */
export function testLedges(halfWidth: number): Ledge[] {
  const w = Math.min(halfWidth, 4);
  return [
    { id: 'test.left', x0: -w + 0.3, x1: -w * 0.45, y: 1.1 },
    { id: 'test.right', x0: w * 0.45, x1: w - 0.3, y: 1.1 },
    { id: 'test.high', x0: -0.9, x1: 0.9, y: 2.4, bob: 0.15 },
  ];
}

const TEST_PLANE: StagePlane = { id: 'test', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 4, ground: 0, ledges: testLedges(4), spawns: [[-1.5, 0], [1.5, 0]] };

/** ?play&arena=test: a duel test arena on a world's stage plane (where it stands and how the camera sees it), its floor
 *  at the stage's ground (0 over a pit). In its own coordinates (s along the plane, y up from the floor): a tall block
 *  at s -3.0 … -2.4 (4.5 m) and a low step at 2.4 … 3.0 (1.2 m), each a solid ledge with a wall on each face; the shaft
 *  between the left end and the tall block (2.7 m); a one-way platform at 1.7 m, one at 3.3 m, a perch at 6 m in the
 *  shaft; the ends at ±5.75 (the pool's own: walls too) */
export function testArena(base: StagePlane): StagePlane {
  const g = base.ground ?? 0, oy = base.origin[1] + g;
  const block = (id: string, x0: number, x1: number, h: number): { ledge: Ledge; walls: Wall[] } => ({
    ledge: { id, x0, x1, y: g + h, solid: true, thick: h },
    walls: [{ id: `${id}.l`, s: x0, side: -1, y0: oy, y1: oy + h }, { id: `${id}.r`, s: x1, side: 1, y0: oy, y1: oy + h }],
  });
  const tall = block('arena.tall', -3.0, -2.4, 4.5), low = block('arena.low', 2.4, 3.0, 1.2);
  return {
    id: 'arena.test', origin: base.origin, right: base.right, halfWidth: 5.75, ground: g,
    ledges: [tall.ledge, low.ledge,
      { id: 'arena.mid', x0: -1.8, x1: 0.2, y: g + 1.7 }, { id: 'arena.high', x0: -0.4, x1: 1.8, y: g + 3.3 }, { id: 'arena.perch', x0: -5.6, x1: -4.6, y: g + 6.0 }],
    walls: [...tall.walls, ...low.walls],
    spawns: [[-1.5, g], [4.2, g]],
    height: 6.5, lens: base.lens, yaw: base.yaw, pitch: base.pitch,
  };
}

/** the test arena drawn in 2D over the canvas (no world draws it): its blocks filled, its walls bright, its platforms
 *  as lines, the plane's ends; projected with the camera each frame */
function arenaOverlay(canvas: HTMLCanvasElement, kit: Kit, plane: () => StagePlane | null) {
  const el = document.createElement('canvas');
  el.id = 'arena-overlay';
  Object.assign(el.style, { position: 'fixed', pointerEvents: 'none', zIndex: '4' });
  (canvas.parentElement ?? document.body).append(el);
  const P: [number, number, number] = [0, 0, 0];
  return () => {
    const r = canvas.getBoundingClientRect(), pl = plane();
    Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const w = canvas.width, h = canvas.height;
    if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
    const c = el.getContext('2d')!;
    c.clearRect(0, 0, w, h);
    if (!pl) return;
    const m = kit.camera.viewProj;
    const at = (s: number, y: number): [number, number] | null => {
      planePoint(pl, s, y, P);
      const x = P[0], yy = P[1], z = P[2];
      const cx = m[0] * x + m[4] * yy + m[8] * z + m[12], cy = m[1] * x + m[5] * yy + m[9] * z + m[13], cw = m[3] * x + m[7] * yy + m[11] * z + m[15];
      return cw > 1e-4 ? [(cx / cw * 0.5 + 0.5) * w, (0.5 - cy / cw * 0.5) * h] : null;
    };
    const poly = (pts: [number, number][], fill: string | null, stroke: string | null, lw = 2) => {
      const q = pts.map(([s, y]) => at(s, y));
      if (q.some((p) => !p)) return;
      c.beginPath(); q.forEach((p, i) => (i ? c.lineTo(p![0], p![1]) : c.moveTo(p![0], p![1])));
      if (fill) { c.closePath(); c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw * (h / 800); c.stroke(); }
    };
    const g = pl.ground ?? 0, top = g + (pl.height ?? 6) + 1.5;
    for (const L of pl.ledges) {
      if (L.solid) poly([[L.x0, L.y - (L.thick ?? 0.4)], [L.x1, L.y - (L.thick ?? 0.4)], [L.x1, L.y], [L.x0, L.y]], 'rgba(120, 100, 190, 0.28)', 'rgba(215, 205, 255, 0.55)', 1.5);
      else poly([[L.x0, L.y], [L.x1, L.y]], null, 'rgba(225, 215, 255, 0.85)', 4);
    }
    const oy = pl.origin[1];
    for (const W of pl.walls ?? []) poly([[W.s, W.y0 - oy], [W.s, W.y1 - oy]], null, W.climb === false ? 'rgba(255, 200, 160, 0.6)' : 'rgba(250, 245, 255, 0.95)', 3);
    for (const e of [-pl.halfWidth, pl.halfWidth]) poly([[e, g], [e, top]], null, 'rgba(250, 245, 255, 0.6)', 3);
    poly([[-pl.halfWidth, g], [pl.halfWidth, g]], null, 'rgba(225, 215, 255, 0.5)', 2);
  };
}

/** set ice's stretches (sloped from y0 to y1) as flat one-way ledges a body can stand on: a sloped one in steps of at
 *  most 0.3 m, each at the stretch's height at its middle */
export function flatSteps(stretches: readonly IceLedge[]): Ledge[] {
  const out: Ledge[] = [];
  for (const L of stretches) {
    const n = Math.max(1, Math.ceil((L.x1 - L.x0) / 0.3) * (Math.abs(L.y1 - L.y0) > 0.02 ? 1 : 0) || 1);
    for (let k = 0; k < n; k++) {
      const a = L.x0 + ((L.x1 - L.x0) * k) / n, b = L.x0 + ((L.x1 - L.x0) * (k + 1)) / n, u = (k + 0.5) / n;
      out.push({ id: `ice.${L.piece}.${k}`, x0: a, x1: b, y: L.y0 + (L.y1 - L.y0) * u });
    }
  }
  return out;
}

export interface PlayHandle {
  readonly hub: InputHub;
  readonly controllers: IntentController[];
  /** the players' dancers, in seat order (the show stages them later: show.dancers may not hold them yet) */
  readonly dancers: Dancer[];
  /** the plane locking uses (the world's own stage) */
  plane(): StagePlane | null;
  /** add a dancer played from elsewhere (the network's NetController): it joins the cast after the players */
  addDancer(d: Dancer): void;
  /** seat the next player on a source (a brain's, src/ai): a dancer like the others, locked with them */
  addPlayer(source: IntentSource): IntentController;
}

export async function playDemo(ctx: PlayCtx): Promise<PlayHandle> {
  const { show, rig, frame, kit, canvas } = ctx;
  const travel = await ctx.travel;
  const moves = movesOf(ctx.motion, travel);
  const skel = ctx.motion.skeletons[0];
  // a game runs in real time (the gem show's dance is slowed, as if under water) and doesn't move on by itself
  danceParams.speed = 1;
  danceParams.auto = false;
  // and its bodies move fast (a 9.5 m/s jump, a 4 m/s run, a spin in a third of a second): the gems' springs, tuned for
  // a slow underwater dance (130, an 0.8 m lag at jump speed), are stiffened (with the gems' hold, which stiffens a
  // fast limb along its travel and caps the trail, 280 is enough) so the body stays a body, and shed less
  try { setParams('gems', { stiffness: playParams.gemStiffness, damping: 2 * Math.sqrt(playParams.gemStiffness) * 0.9, speedShed: 0.04 }); } catch { /* no gems */ }
  // the CMU pirouette as a flourish (spin with the stick up; bend.move(p, 'pirueta'))
  const flourish = pirouetteFlourish(ctx.motion);
  if (flourish && !MOVES[flourish.name]) registerMove(flourish);

  // set ice on the locked plane: its stretches as one-way ledges (sloped ones in flat steps)
  const ice = show.kinds.find((k) => k.id === 'ice' || k.id === 'water') as WaterPasses | undefined;
  const iceLedges = (plane: StagePlane | null): Ledge[] => (ice && plane && (!ice.setIce.world || ice.setIce.world === ctx.world().id) ? flatSteps(ice.setIce.ledgesIn(plane)) : []);
  const controllers: IntentController[] = [];
  const dancers: Dancer[] = [];
  // the duel's movement (&duel), on a test arena of its own (&arena=test)
  const q = new URLSearchParams(location.search);
  const arenaTest = q.get('arena') === 'test', duel = arenaTest || q.has('duel');
  let arena: StagePlane | null = null, arenaBase: StagePlane | null = null;
  const addDancer = (seat: number) => {
    const sp = ctx.world().spawns[seat] ?? [seat ? 1.2 : -1.2, 0, 0];
    // (each dancer on its own world's ground: see PlayCtx.worldOf)
    let dancer: Dancer | null = null;
    const home = () => (dancer && ctx.worldOf ? ctx.worldOf(dancer) : ctx.world());
    // (its solids too: a body on the duel's profile stands on them and kicks off them)
    const terrain = { groundAt: (x: number, z: number) => home().groundAt(x, z), get fallY() { return home().fallY; }, get solids() { return home().solids; } };
    const c = new IntentController(skel, { seat, terrain, moves, at: [sp[0], sp[1], sp[2]] });
    c.character.flourish = flourish?.name ?? null;
    if (duel) c.character.setProfile(DUEL_PHYS);
    c.character.extraLedges = () => iceLedges(c.character.plane);
    c.character.yaw = seat ? -Math.PI / 2 : Math.PI / 2;
    if (lockedPlane) c.setPlane(lockedPlane);
    controllers.push(c);
    dancer = new Dancer(`player.${seat}`, c, gemsLoadout(seat ? playParams.suiteTwo : playParams.suiteOne));
    dancers.push(dancer);
    return c;
  };
  let lockedPlane: StagePlane | null = null;
  addDancer(0);
  /** dancers played from elsewhere (the network), after the players */
  const others: Dancer[] = [];
  show.castOverride = () => [...dancers, ...others];

  // ---------------------------------------------------------------- devices
  const project = (p: ArrayLike<number>) => {
    const m = kit.camera.viewProj, x = p[0], y = p[1], z = p[2];
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const r = canvas.getBoundingClientRect();
    return w > 1e-4 ? [r.left + (cx / w * 0.5 + 0.5) * r.width, r.top + (0.5 - cy / w * 0.5) * r.height, w] : null;
  };
  const hub = new InputHub({
    canvas,
    // the mouse plays the bending hand from the dancer's shoulder (the right one; the reach an arm's length on screen)
    dancerScreen: (i) => {
      const c = controllers[i]; if (!c) return null;
      const s = project(dancers[i].skeleton.pos[JOINT.RightArm]);
      if (!s) return null;
      const r = canvas.getBoundingClientRect(), fy = 1 / Math.tan(kit.camera.fovY / 2);
      return { x: s[0], y: s[1], reach: Math.max(20, (0.47 * fy * r.height * 0.5) / s[2]) };
    },
    facing: (i) => controllers[i]?.character.dir ?? 1,
  });
  if (duel) hub.scheme = 'duel';
  let pad: TouchPad | null = null;
  const seat = (p: Player) => {
    if (p.device !== 'bot') ctx.wake();
    let c = controllers[p.index];
    if (!c) { c = addDancer(p.index); show.stage(show.program); }
    c.source = p.source;
    p.source.mode = lockedPlane ? 'locked' : 'free';
    if (p.device === 'touch') pad ??= new TouchPad(p.source as TouchSource, canvas);
    console.info(`energybending: player ${p.index + 1} is ${p.source.name}`);
  };
  hub.onJoin = seat;
  hub.onChange = (p) => { const c = controllers[p.index]; if (c) { c.source = p.source; p.source.mode = lockedPlane ? 'locked' : 'free'; } };
  // the camera body, on 'c' (loaded only then: the webcam and the models)
  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyC' || e.repeat || hub.players.some((p) => p.device === 'camera') || (e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
    void import('../input/webcam').then(async ({ Webcam }) => {
      const cam = new Webcam((s) => console.info(`camera: ${s}`));
      try { await cam.start(ctx.coarse); hub.joinCamera(new CameraSource(cam.tracker)); } catch (err) { cam.stop(); console.warn('energybending: the camera', err); }
    });
  });

  // ?play&two: a second dancer from the start, on a bot that stands in ginga (scripts drive it with bend.intent; a second
  // device takes it over)
  if (new URLSearchParams(location.search).has('two')) { addDancer(1).source = new BotSource(null, 'bot'); show.stage(show.program); }

  // ---------------------------------------------------------------- the lock
  const planeOf = (): StagePlane | null => {
    // the world's own stage, as it is (the pool's has no ledges on purpose: the pure stage); a test plane only where a
    // world has none
    const base = ctx.world().stages[0] ?? TEST_PLANE;
    if (!arenaTest) return base;
    // (the test arena on that stage, made once per stage so the lock keeps one plane)
    if (base !== arenaBase) { arenaBase = base; arena = testArena(base); }
    return arena;
  };
  const setLock = (plane: StagePlane | null) => {
    lockedPlane = plane;
    for (const c of controllers) c.setPlane(plane);
    for (const p of hub.players) p.source.mode = plane ? 'locked' : 'free';
  };

  // ---------------------------------------------------------------- each frame
  frame.tick('input', () => hub.poll(), 'play: devices joining');
  frame.tick('camera', (f) => {
    // a lock asked for by a player (Tab, V, the View button), or by the rig (l, bend.lock, ?lock)
    if (controllers.some((c) => c.intent.lock)) rig.lock(rig.mode === 'locked' ? null : planeOf());
    if (rig.mode === 'locked' && rig.plane) {
      const want = planeOf();
      if (want && rig.plane !== want) rig.lock(want);   // (the world changed under a lock: its own stage)
    }
    const want = rig.mode === 'locked' ? rig.plane : null;
    if (want !== lockedPlane) setLock(want);
    // partners look at each other
    for (let i = 0; i < controllers.length; i++) {
      const c = controllers[i], other = controllers[1 - i] ? dancers[1 - i] : null;
      c.character.lookAt = other ? controllers[1 - i].character.root : null;
      c.lookAtHead = other ? other.skeleton.pos[JOINT.Head] : null;
      c.inputYaw = rig.stickYaw(i, c.intent.moveX, c.intent.moveZ);   // (held steady while the stick is: CameraRig.stickYaw)
    }
    // the follow camera: behind player one (and, with two, the middle of them, standing back as they part)
    const at = (d: Dancer) => { const J = ctx.seen?.(d) ?? d.skeleton.world, o = JOINT.Spine1 * JOINT_FLOATS; return [J[o], J[o + 1], J[o + 2]]; };
    const a = at(dancers[0]), b = dancers[1] ? at(dancers[1]) : a;
    const c0 = controllers[0].character;
    rig.follow = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 - 0.15, z: (a[2] + b[2]) / 2, yaw: c0.yaw, speed: Math.hypot(c0.v[0], c0.v[2]), spread: Math.hypot(a[0] - b[0], a[2] - b[2]) };
    const look = controllers[0].intent;
    rig.lookBy(look.camX, look.camY, f.dt);
    pad?.update();
  }, 'play: the lock, partners, the follow camera');

  // the test arena: locked onto from the start, drawn over the canvas
  if (arenaTest) {
    rig.lock(planeOf());
    const draw = arenaOverlay(canvas, kit, () => (rig.mode === 'locked' ? rig.plane : null));
    frame.tick('post', () => draw(), 'play: the test arena overlay');
  }

  const addPlayer = (source: IntentSource) => { const c = addDancer(controllers.length); c.source = source; source.mode = lockedPlane ? 'locked' : 'free'; show.stage(show.program); return c; };
  return { hub, controllers, dancers, plane: () => lockedPlane, addDancer: (d) => { others.push(d); show.stage(show.program); }, addPlayer };
}
