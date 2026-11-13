// ?play: a playable dancer, end to end. Player one stands in the world in ginga; the first device anyone uses (a key,
// a gamepad button, a touch; 'c' for the camera body) becomes theirs, and the next device brings in player two
// (input/hub.ts). Free by default, with a third-person camera behind player one (right stick, right-drag or a drag
// to look); Tab, V or the gamepad's View button (or `l`, or bend.lock) locks the view onto the world's first stage
// plane: both dancers ease onto it, its ledges become solid to them, and the camera swings round side-on with a long
// lens. A plane with no ledges gets a few test ledges here, so there is something to jump onto. The dancers wear gems.
// ?play&two adds a second dancer on a bot from the start (for scripts). main.ts wires it with one line, like the other
// demos; it runs on the frame's input and camera phases.
import type { Kit } from '@ericrius1/weft';
import type { Show } from './show';
import type { CameraRig, StagePlane, Ledge } from '../engine/camera';
import type { FrameBuilder } from '../engine/frame';
import type { World } from '../worlds/world';
import type { Motion } from '../skeleton/clips';
import { JOINT } from '../skeleton/rig';
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
import { defineParams, setParams } from '../engine/params';

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
}

export const playParams = defineParams('play', {
  /** the gem suites players one and two wear */
  suiteOne: 'Violet',
  suiteTwo: 'Sky',
  /** the gems' spring while playing (see playDemo) */
  gemStiffness: 700,
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

export interface PlayHandle {
  readonly hub: InputHub;
  readonly controllers: IntentController[];
  /** the plane locking uses (the world's, with test ledges if it has none) */
  plane(): StagePlane | null;
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
  // a slow underwater dance (130, an 0.8 m lag at jump speed), are stiffened so the body stays a body, and shed less
  try { setParams('gems', { stiffness: playParams.gemStiffness, damping: 2 * Math.sqrt(playParams.gemStiffness) * 0.9, speedShed: 0.04 }); } catch { /* no gems */ }
  // the CMU pirouette as a flourish (spin with the stick up; bend.move(p, 'pirueta'))
  const flourish = pirouetteFlourish(ctx.motion);
  if (flourish && !MOVES[flourish.name]) registerMove(flourish);

  const terrain = { groundAt: (x: number, z: number) => ctx.world().groundAt(x, z) };
  const controllers: IntentController[] = [];
  const dancers: Dancer[] = [];
  const addDancer = (seat: number) => {
    const sp = ctx.world().spawns[seat] ?? [seat ? 1.2 : -1.2, 0, 0];
    const c = new IntentController(skel, { seat, terrain, moves, at: [sp[0], sp[1], sp[2]] });
    c.character.flourish = flourish?.name ?? null;
    c.character.yaw = seat ? -Math.PI / 2 : Math.PI / 2;
    if (lockedPlane) c.setPlane(lockedPlane);
    controllers.push(c);
    dancers.push(new Dancer(`player.${seat}`, c, gemsLoadout(seat ? playParams.suiteTwo : playParams.suiteOne)));
    return c;
  };
  let lockedPlane: StagePlane | null = null;
  addDancer(0);
  show.castOverride = () => dancers.slice();

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
    const p = ctx.world().stages[0];
    if (!p) return { id: 'test', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 4, ground: 0, ledges: testLedges(4), spawns: [[-1.5, 0], [1.5, 0]] };
    return p.ledges.length ? p : (testPlanes.get(p) ?? testPlanes.set(p, { ...p, id: `${p.id}.test`, ledges: testLedges(p.halfWidth) }).get(p)!);
  };
  const testPlanes = new Map<StagePlane, StagePlane>();
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
      if (want && rig.plane !== want && (rig.plane === ctx.world().stages[0] || !rig.plane.ledges.length)) rig.lock(want);
    }
    const want = rig.mode === 'locked' ? rig.plane : null;
    if (want !== lockedPlane) setLock(want);
    // partners look at each other
    for (let i = 0; i < controllers.length; i++) {
      const c = controllers[i], other = controllers[1 - i] ? dancers[1 - i] : null;
      c.character.lookAt = other ? controllers[1 - i].character.root : null;
      c.lookAtHead = other ? other.skeleton.pos[JOINT.Head] : null;
      c.inputYaw = rig.yaw;
    }
    // the follow camera: behind player one (and, with two, the middle of them, standing back as they part)
    const a = dancers[0].skeleton.pos[JOINT.Spine1], b = dancers[1]?.skeleton.pos[JOINT.Spine1] ?? a;
    const c0 = controllers[0].character;
    rig.follow = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 - 0.15, z: (a[2] + b[2]) / 2, yaw: c0.yaw, speed: Math.hypot(c0.v[0], c0.v[2]), spread: Math.hypot(a[0] - b[0], a[2] - b[2]) };
    const look = controllers[0].intent;
    rig.lookBy(look.camX, look.camY, f.dt);
    pad?.update();
  }, 'play: the lock, partners, the follow camera');

  return { hub, controllers, plane: () => lockedPlane };
}
