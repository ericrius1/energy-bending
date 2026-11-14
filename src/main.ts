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
import { applyPerf, chooseClass } from './engine/perf';
import { makePip } from './engine/pip';
import { installHooks } from './engine/hooks';
import { BodyBuffers } from './matter/core/bodies';
import { Hand } from './matter/core/touch';
import { matterKinds, type MatterPasses } from './matter/core/kind';
import { Field } from './matter/field/field';
import { worlds as worldDefs, type World, type WorldCtx } from './worlds/world';
import { shareWorldLight } from './worlds/shared';
import { NearFade } from './worlds/fade';
import { solidsOf } from './portals/solids';
import { PostChain } from './post/post';
import { Music } from './audio/music';
import { Show } from './dancer/show';
import { danceParams, PROGRAMS } from './dancer/programme';
import { CameraController, Eyes } from './dancer/camera';
import { landmarksDemo, wanderDemo } from './dancer/demos';
import { JOINT } from './skeleton/rig';
import type { GemPasses } from './matter/gems/gems';
import { Portals } from './portals/portals';
import { gatesDebug } from './portals/debug';
import { LIMITS } from './engine/limits';
import { BASELINE_LIMITS } from './engine/baseline';

import.meta.glob(['./matter/*/index.ts', './worlds/*/index.ts'], { eager: true });

const query = new URLSearchParams(location.search);
const FILM = query.has('film');
const base = import.meta.env.BASE_URL;
// ?perf: the self-measuring suite (engine/perfrun.ts); its first load only plans the page loads and moves on
if (query.has('perf') && !query.has('perfgroup')) await (await import('./engine/perfrun')).perfStart(query);
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const status = document.getElementById('status')!;
// a film is exactly its own size, whatever the window: the canvas is pinned to it (its frames are read back)
const filmSize: [number, number] | null = FILM ? [Math.floor(Number(query.get('w') ?? innerWidth) / 8) * 8, Math.floor(Number(query.get('h') ?? innerHeight) / 2) * 2] : null;
if (filmSize) Object.assign(canvas.style, { width: `${filmSize[0]}px`, height: `${filmSize[1]}px` });

// ---------------------------------------------------------------- the kit and the assets
let kit: Kit;
try {
  // ?baseline: only WebGPU's default limits (a phone's budget), so going over one fails on this PC too
  kit = await createKit(canvas, { maxPixelRatio: FILM ? 1 : 2, limits: query.has('baseline') ? BASELINE_LIMITS : undefined });
} catch (e) {
  status.textContent = e instanceof WebGPUUnavailable ? `${e.message} Try a recent Chrome, Edge or Safari.` : String(e);
  throw e;
}
// the device's class (desktop, laptop, phone: engine/perf.ts BUDGETS), from the browser and a probe of up to 2 s, or
// ?class=; `coarse` is what kinds and worlds read of it today
const device = await chooseClass(kit, query, { film: FILM, fresh: query.get('perfgroup') === '0' });
const coarse = device.coarse;
const motion: Motion = await loadMotion(base);
motion.skeletons.forEach(checkRig);
// the travelling dances (for locomotion), fetched behind the rest
const travelling = loadMotion(base, 'travel').catch(() => null);

// ---------------------------------------------------------------- what is registered
const frame = new FrameBuilder();
const bodies = new BodyBuffers(kit);
const rig = new CameraRig();
const field = new Field({ kit, frame, bodies, coarse, query });
const worldCtx: WorldCtx = { kit, base, bodies, coarse, film: FILM, frame };
const worlds: World[] = worldDefs.all().map((d) => d.make(worldCtx));
const worldOf = (id: string) => worlds.find((w) => w.id === id) ?? worlds[0];
shareWorldLight(kit, worlds);
const start = query.get('world') ?? (query.get('scene') === 'forest' ? 'redwoods' : 'geode');
const main = makeView(kit, 'main', { world: worldOf(start).id, main: true });
// the near fade (worlds/fade.ts): solid things near the eye or across the dancers dissolve, in the main view only
const fade = new NearFade(kit, main);
const pip = query.has('pip') ? makePip(kit, worlds.find((w) => w.id !== main.world)?.id ?? main.world) : null;
// the gates between worlds (src/portals): their views join the frame's (drawn before the main one, in 'gates')
const gates = new Portals({
  kit, frame, worlds, main, rig, bodies, coarse, slots: LIMITS.views - (pip ? 1 : 0),
  load: (id) => worldOf(id).load(worldCtx), entered: () => music?.retone(),
});
const drawn: ViewCtx[] = pip ? [main, pip.view] : [main];
const views: ViewCtx[] = [...drawn, ...gates.views];

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
for (const v of drawn) { declareScene(v, worlds, kinds); frame.add('scene', v.scene, `view ${v.id}`); }
const post = new PostChain(kit, frame, main, worlds, { film: filmSize, coarse });
if (pip) { post.declareAir(pip.view, worlds); post.inset(pip.view, pip.rect); }
gates.declare(kinds, post);
for (const k of kinds) k.declarePost?.(post);   // translucent matter over the focused image (steam)

// ---------------------------------------------------------------- the show and its sound
// (the camera is the listener: sounds are panned and distanced from it; kinds that can be heard get their ears)
// (each world's track is the music; ?procedural plays the generative groove instead)
music = new Music(FILM, () => worldOf(main.world), gems?.ids ?? [], kit.camera, kinds, !query.has('procedural'));
const score = music.score;
if (gems) gems.onStones = (when, ev, n) => score.stones(when, ev, n);
const show = new Show(motion, kinds, bodies, rig, {
  setKey: (k) => score.setKey(music!.now(), k),
  rise: (s) => score.rise(music!.now(), s),
  blast: (s) => score.blast(music!.now(), s),
}, coarse);
if (query.has('landmarks')) show.castOverride = landmarksDemo();
if (query.has('wander')) { const t = await travelling; show.castOverride = wanderDemo(motion, t); }
if (query.has('play') || query.has('roda') || query.has('teach')) {
  const play = await import('./dancer/play').then((m) => m.playDemo({ show, rig, frame, kit, canvas, world: () => worldOf(main.world), motion, travel: travelling, coarse, wake, seen: (d) => gates.seen(gates.rigWorld, [d]).joints[0] ?? null, worldOf: (d) => worldOf(gates.worldOf(d)) }));
  // ?play&net=ROOM: the played dancer online, the other seat through the network
  if (query.has('net')) await (await import('./net/play')).netPlay({ show, play, frame, world: () => worldOf(main.world), query, gates });
  // ?play&partner, ?roda, ?teach: brains on the seats (src/ai/demo.ts)
  if (['partner', 'roda', 'teach'].some((k) => query.has(k))) await (await import('./ai/demo')).brainsPlay({ query, frame, show, music: music!, world: () => worldOf(main.world), worldOf, motion, travel: travelling, lock, wake, play });
} else if (query.has('net')) show.castOverride = await (await import('./net/demo')).netDemo(motion, frame, query);
// ?npcs=5: free dancers on brains (src/ai/demo.ts)
if (query.has('npcs') && !query.has('play')) await (await import('./ai/demo')).npcsDemo({ query, frame, show, music: music!, world: () => worldOf(main.world), worldOf, motion, travel: travelling, lock, wake }, Number(query.get('npcs') || 5));
gatesDebug(gates, frame, query, () => show.dancers);
// the jogo, its modes and menus (src/play): ?jogo=…, or the front of the game on a plain page
await (await import('./play')).registerPlay({ kit, frame, show, rig, gates, music, field, kinds, main, query, canvas, motion, travel: travelling, coarse, film: FILM, wake, worldOf, setWorld, hand });
// the music owns time: FrameCtx.beat is its clock, live and filming
const beat = music.clock;

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
const f: FrameCtx = { kit, dt: 0, danceDt: 0, t: 0, frame: 0, now: 0, beat: beat.info, tension: 0, dancers: [], views };
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
  for (const d of show.dancers) d.world = gates.worldOf(d);   // (Dancer.world: the field follows the main view's)
  const seen = gates.seen(gates.rigWorld, show.dancers.filter((d) => d.framed), 2);
  Object.assign(centre, { x: seen.x, z: seen.z, ring: !!show.program.ring, dancers: show.dancers.length });
  field.update(f);
}, 'show: the programme, every dancer posed, joints to the GPU');

frame.tick('camera', (f) => {
  // (the rig works in its player's world: from the moment they go through a gate, before the view follows)
  const [w, h] = kit.size.render, world = worldOf(gates.rigWorld), here = gates.seen(gates.rigWorld, show.dancers.filter((d) => d.framed), 2).joints, D = here.length;
  const crowd = show.program.ring ? 1 : D >= 3 ? 1.35 : D === 2 ? 1.1 : 1;
  // what a locked view frames: every dancer's hips, head, hands and feet
  let n = 0;
  for (const J of here) for (const j of FRAMED) { if (n < 56) { framing.set(J.subarray(j * 12, j * 12 + 3), n * 3); n++; } }
  rig.framing = framing; rig.framingCount = n;
  rig.update(f.dt, { aspect: w / Math.max(h, 1), dancers: here, aimX: centre.x, aimZ: centre.z, crowd, ring: !!show.program.ring, awake: show.awake, room: world.room, maxDist: world.maxDist, groundAt: (x, z) => world.groundAt(x, z) });
  rig.apply(kit.camera, w, h);
  pip?.update(f.t, worlds.find((x) => x.id !== main.world)?.id ?? main.world, [centre.x, centre.z]);
  hand.update(f.dt, kit.camera);
}, 'camera rig, ?pip camera, the hand');

frame.tick('worlds', (f) => {
  for (const w of worlds) if (views.some((v) => v.on() && v.world === w.id)) w.update(f, centre);
}, 'worlds on screen');

frame.tick('matter', (f) => { for (const k of kinds) k.update(f); }, 'matter kinds');

frame.tick('post', (f) => {
  // the locked view's stage dim (post.ts PostChain.stage): what lies beyond the stage darkens and softens a little as the
  // lock comes in, by the world's taste (World.stageDim; 0.55 where a world says nothing), focused on the stage plane
  const W = worldOf(main.world);
  post.stage.dim = rig.locked * (W.stageDim ?? 0.55);
  post.update(f, W, rig.focus);
  fade.update(f.dt, kit.camera.position, solidsOf(W), gates.seen(main.world, show.dancers.filter((d) => d.framed), 2).joints, (x, z) => W.groundAt(x, z));
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
applyPerf(kit, FILM || query.has('noautores'), device);
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
Object.assign(bend, { gates, device, fade, post });
if (query.has('perfgroup')) void import('./engine/perfrun').then((m) => m.perfRun({ bend, kit, frame, views, choice: device, ready }));
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
