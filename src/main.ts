// Energy Bending: boot, assemble the frame from what is registered, loop. Every matter kind (src/matter/*/index.ts)
// and world (src/worlds/*/index.ts) registers itself when its folder is imported, and the glob below imports them
// all, so adding one never touches this file. Read the frame's order in engine/frame.ts (STAGES, PHASES) and the
// whole of it, item by item, in `bend.stats().frame`.
import { createKit, WebGPUUnavailable, type Kit } from '@ericrius1/weft';
import { loadMotion, type Motion } from './skeleton/clips';
import { checkRig } from './skeleton/rig';
import { FrameBuilder, type FrameCtx } from './engine/frame';
import { makeView, type ViewCtx } from './engine/views';
import { declareScene } from './engine/scene';
import { CameraRig } from './engine/camera';
import { Panel } from './engine/panel';
import { applyPerf } from './engine/perf';
import { makePip } from './engine/pip';
import { installHooks } from './engine/hooks';
import { BodyBuffers } from './matter/core/bodies';
import { Hand } from './matter/core/touch';
import { matterKinds, type MatterPasses } from './matter/core/kind';
import { Field } from './matter/field/field';
import { worlds as worldDefs, type World, type WorldCtx } from './worlds/world';
import { shareWorldLight } from './worlds/shared';
import { PostChain } from './post/post';
import { Music } from './audio/music';
import { BeatClock } from './audio/clock';
import { Show } from './dancer/show';
import { danceParams, PROGRAMS } from './dancer/programme';
import { CameraController, Eyes } from './dancer/camera';
import { landmarksDemo, wanderDemo } from './dancer/demos';
import { JOINT } from './skeleton/rig';
import type { GemPasses } from './matter/gems/gems';

import.meta.glob(['./matter/*/index.ts', './worlds/*/index.ts'], { eager: true });

const query = new URLSearchParams(location.search);
const FILM = query.has('film');
const base = import.meta.env.BASE_URL;
const coarse = matchMedia('(pointer: coarse)').matches;
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const status = document.getElementById('status')!;
// a film is exactly its own size, whatever the window: the canvas is pinned to it (its frames are read back)
const filmSize: [number, number] | null = FILM ? [Math.floor(Number(query.get('w') ?? innerWidth) / 8) * 8, Math.floor(Number(query.get('h') ?? innerHeight) / 2) * 2] : null;
if (filmSize) Object.assign(canvas.style, { width: `${filmSize[0]}px`, height: `${filmSize[1]}px` });

// ---------------------------------------------------------------- the kit and the assets
let kit: Kit;
try {
  kit = await createKit(canvas, { maxPixelRatio: FILM ? 1 : 2 });
} catch (e) {
  status.textContent = e instanceof WebGPUUnavailable ? `${e.message} Try a recent Chrome, Edge or Safari.` : String(e);
  throw e;
}
const motion: Motion = await loadMotion(base);
motion.skeletons.forEach(checkRig);
// the travelling dances (for locomotion), fetched behind the rest
const travelling = loadMotion(base, 'travel').catch(() => null);

// ---------------------------------------------------------------- what is registered
const frame = new FrameBuilder();
const bodies = new BodyBuffers(kit);
const rig = new CameraRig();
const field = new Field();
const worldCtx: WorldCtx = { kit, base, bodies, coarse, film: FILM, frame };
const worlds: World[] = worldDefs.all().map((d) => d.make(worldCtx));
const worldOf = (id: string) => worlds.find((w) => w.id === id) ?? worlds[0];
shareWorldLight(kit, worlds);
const start = query.get('world') ?? (query.get('scene') === 'forest' ? 'redwoods' : 'geode');
const main = makeView(kit, 'main', { world: worldOf(start).id, main: true });
const pip = query.has('pip') ? makePip(kit, worlds.find((w) => w.id !== main.world)?.id ?? main.world) : null;
const views: ViewCtx[] = pip ? [main, pip.view] : [main];

let music: Music | null = null;
const hand = new Hand(bodies, rig, {
  wake: () => wake(),
  blast: (s) => music?.score.blast(music.now(), s),
}, () => worldOf(main.world).maxDist);
hand.attach(canvas, kit.camera);
if (FILM) hand.nowMs = () => (music?.filmClock ?? 0) * 1000;

const kinds: MatterPasses[] = [];
for (const k of matterKinds.all()) {
  kinds.push(await k.declare({ kit, frame, bodies, hand, field, worlds, base, coarse, film: FILM, views: views.length - 1 }));
}
const gems = kinds.find((k) => k.id === 'gems') as GemPasses | undefined;

// ---------------------------------------------------------------- the scene, per view, and the post chain
for (const v of views) { declareScene(v, worlds, kinds); frame.add('scene', v.scene, `view ${v.id}`); }
const post = new PostChain(kit, frame, main, worlds, { film: filmSize, coarse });
if (pip) { post.declareAir(pip.view, worlds); post.inset(pip.view, pip.rect); }

// ---------------------------------------------------------------- the show and its sound
music = new Music(FILM, () => worldOf(main.world), gems?.ids ?? []);
const score = music.score;
score.pan = (x, y, z) => {
  const c = kit.camera, dx = x - c.position[0], dy = y - c.position[1], dz = z - c.position[2];
  const ahead = Math.max(0.5, dx * c.forward[0] + dy * c.forward[1] + dz * c.forward[2]);
  return Math.max(-1, Math.min(1, ((dx * c.right[0] + dy * c.right[1] + dz * c.right[2]) / ahead) * 0.9));
};
if (gems) gems.onStones = (when, ev, n) => score.stones(when, ev, n);
const show = new Show(motion, kinds, bodies, rig, {
  setKey: (k) => score.setKey(music!.now(), k),
  rise: (s) => score.rise(music!.now(), s),
  blast: (s) => score.blast(music!.now(), s),
}, coarse);
if (query.has('landmarks')) show.castOverride = landmarksDemo();
if (query.has('wander')) { const t = await travelling; show.castOverride = wanderDemo(motion, t); }
const beat = new BeatClock();

function wake() {
  if (show.awake) return;
  music!.start(show.program.key);
  show.programme.wake();
}

async function setWorld(id: string) {
  const w = worldOf(id);
  await w.load(worldCtx);
  main.world = w.id;
  music!.retone();
  rig.dist = Math.min(rig.dist, w.maxDist);
  if (rig.mode === 'locked') rig.lock(w.stages[0] ?? null);
}

function lock(on: boolean) { rig.lock(on ? worldOf(main.world).stages[0] ?? null : null); }

// ---------------------------------------------------------------- the frame's CPU work, phase by phase
const f: FrameCtx = { kit, dt: 0, danceDt: 0, t: 0, frame: 0, now: 0, beat: beat.info, dancers: [], views };
const framing = new Float32Array(8 * 3 * 7);
const FRAMED = [JOINT.Hips, JOINT.Head, JOINT.HeadEnd, JOINT.LeftHand, JOINT.RightHand, JOINT.LeftToeBase, JOINT.RightToeBase];
const centre = { x: 0, z: 0, ring: false, dancers: 0 };
let castSeen: unknown = null;

frame.tick('dancers', (f) => {
  show.t = f.t;
  show.update(f.dt);
  if (show.dancers !== castSeen) { castSeen = show.dancers; music!.hear(show.dancers); }
  f.dancers = show.dancers;
  for (const d of show.dancers) d.update(f);
  bodies.upload(show.dancers, f.t);
  let x = 0, z = 0;
  for (const d of show.dancers) { x += d.skeleton.world[0]; z += d.skeleton.world[2]; }
  const D = Math.max(1, show.dancers.length);
  Object.assign(centre, { x: x / D, z: z / D, ring: !!show.program.ring, dancers: show.dancers.length });
  field.update(f);
}, 'show: the programme, every dancer posed, joints to the GPU');

frame.tick('camera', (f) => {
  const [w, h] = kit.size.render, world = worldOf(main.world), D = show.dancers.length;
  const crowd = show.program.ring ? 1 : D >= 3 ? 1.35 : D === 2 ? 1.1 : 1;
  // what a locked view frames: every dancer's hips, head, hands and feet
  let n = 0;
  for (const d of show.dancers) for (const j of FRAMED) { if (n < 56) { framing.set(d.skeleton.world.subarray(j * 12, j * 12 + 3), n * 3); n++; } }
  rig.framing = framing; rig.framingCount = n;
  rig.update(f.dt, { aspect: w / Math.max(h, 1), dancers: show.dancers.map((d) => d.skeleton.world), aimX: centre.x, aimZ: centre.z, crowd, ring: !!show.program.ring, awake: show.awake, room: world.room, maxDist: world.maxDist });
  rig.apply(kit.camera, w, h);
  pip?.update(f.t, worlds.find((x) => x.id !== main.world)?.id ?? main.world, [centre.x, centre.z]);
  hand.update(f.dt, kit.camera);
}, 'camera rig, ?pip camera, the hand');

frame.tick('worlds', (f) => {
  for (const w of worlds) if (views.some((v) => v.on() && v.world === w.id)) w.update(f, centre);
}, 'worlds on screen');

frame.tick('matter', (f) => { for (const k of kinds) k.update(f); }, 'matter kinds');

frame.tick('post', (f) => {
  const c = kit.camera;
  post.update(f, worldOf(main.world), Math.hypot(c.position[0] - rig.look[0], c.position[1] - rig.look[1], c.position[2] - rig.look[2]));
}, 'post chain');

frame.tick('audio', (f) => {
  music!.frame(f.dt, show.dancers, show.awake, { sweep: hand.active ? Math.hypot(...hand.pointer.vel) : 0, charge: hand.finger.charge });
}, 'the score');

frame.after(() => hand.endFrame(), 'the hand: blasts last one frame');

// ---------------------------------------------------------------- start
await worldOf(main.world).load(worldCtx);
if (pip) await worldOf(pip.view.world).load(worldCtx);
else setTimeout(() => { for (const w of worlds) void w.load(worldCtx); }, 5000);
// asleep: the first programme dressed, its stones in a heap until the first touch
show.stage(PROGRAMS[0]);
rig.shoot('heap');
if (query.has('lock')) lock(true);
const items = frame.list();
const ready = await kit.ready();
if (ready.failed) console.warn(`energybending: ${ready.failed} pipeline(s) failed to build`);
status.remove();
document.body.classList.add('ready');
applyPerf(kit, FILM || query.has('noautores'));
const panel = new Panel(query.has('panel'));
panel.build();

let fpsAvg = 60;
kit.loop(({ dt }) => {
  const speed = danceParams.speed;
  f.dt = dt;
  f.danceDt = dt * speed;
  f.t += f.danceDt;
  f.frame = kit.frameIndex;
  music!.filmClock += dt;
  f.now = music!.now();
  beat.update(f.now);
  fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;
  frame.update(f);
  kit.run(items);
  frame.finish(f);
  if (kit.frameIndex % 15 === 0) panel.status(`${Math.round(fpsAvg)} fps · ${show.dancers.length} dancers · ${kit.profiler.frameMs.toFixed(2)} ms GPU`);
});

// ---------------------------------------------------------------- keys, you, the hooks
let eyes: Eyes | null = null;
async function toggleYou() {
  if (show.you) { eyes?.stop(); eyes = null; show.you = null; show.stage(show.program); return; }
  wake();
  const you = new CameraController(motion.skeletons[0]);
  const e = new Eyes(you, (msg) => console.info(`you: ${msg}`));
  try { await e.start(coarse); show.you = you; eyes = e; show.stage(show.program); } catch (err) { e.stop(); console.warn('energybending: the camera', err); }
}
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
  if (e.key === ' ') { e.preventDefault(); if (!show.awake) wake(); else hand.shatter(); }
  else if (e.key === 'n') { wake(); show.programme.next(); }
  else if (e.key === 'w') void setWorld(worlds[(worlds.indexOf(worldOf(main.world)) + 1) % worlds.length].id);
  else if (e.key === 'l') lock(rig.mode !== 'locked');
  else if (e.key === 'y') void toggleYou();
  else if (e.key === 'f') void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
});
if (query.has('you')) canvas.addEventListener('pointerdown', () => void toggleYou(), { once: true });

const adapter = [kit.adapter.info?.vendor, kit.adapter.info?.architecture, kit.adapter.info?.description].filter(Boolean).join(' ');
const bend = installHooks({
  kit, frame, rig, show, kinds, hand, views, worlds, music, setWorld, wake, lock, failed: ready.failed, adapter,
  pending: () => gems?.pending ?? null,
  grabYuv: () => post.grabYuv(),
});
if (FILM) {
  kit.manual = true;
  kit.renderScale = Number(query.get('scale') ?? 1);
  const sink = query.get('sink');
  if (sink) {
    void import('./engine/film').then((m) => m.film({
      kit, director: show.programme, cam: rig, P: bend.params as Record<string, Record<string, unknown>>,
      wake, step: bend.step, grab: bend.grabYuv, point: bend.point, press: bend.press, touch: bend.touch, shoot: bend.shoot,
      prelude: () => score.prelude(music!.now()), failed: ready.failed,
    }, music.recorder, sink, Number(query.get('seconds') ?? 60), Number(query.get('fps') ?? 60), query.get('cut') ?? 'showcase'));
  }
}
