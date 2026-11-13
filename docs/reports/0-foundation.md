# Wave 0: foundation

Energy Bending made from Gem Dancers, restructured into the architecture of `docs/PLAN.md`. Everything Gem Dancers
does in its two scenes still works inside the new structure: gem bodies on mocap dancers, the geode and the redwoods
as two registered worlds, the webcam dancer, the post chain, the score, stepping hooks, stills and the film, on this
Windows PC. On top: the contracts in code (matter kinds, loadouts, worlds, controllers, landmarks, the camera rig,
the field stub), a staged frame, per-view scene declaration proved by `?pip`, a 13-landmark round trip proved by
`?landmarks`, motion-matched locomotion (`?wander`) and the locked camera (`?lock`).

Measured: typecheck and build clean, `npm test` clean, stills of every flag and of the original Gem Dancers run the
same way, GPU timings before and after, a 10 s film with its score. Not measured: a phone, the webcam with a real
camera, a long soak.

## Folder tree

```
AGENTS.md README.md LICENSE index.html vite.config.ts tsconfig.json package.json .gitattributes
docs/        PLAN.md, ASSETS.md, engine-asks.md, element-looks.md (+ jpgs, as delivered), extending/{matter-kind,world,controller}.md, reports/
scripts/     shot.mjs (stills + timings), film.mjs, check-limits.mjs (npm test), mocap.mjs, specimens.py, probe-gpu.mjs, lib/browser.mjs, steps/*.json
tools/       engine-latest.mjs (weft at its dist tip, predev/prebuild)
public/      motion/ (CMU clips), specimens/ (gems), worlds/redwoods/ (three textures)
sketches/    dance-first-2d/ (the 2D prototype, as delivered; excluded from typecheck, build and the dev watcher)
src/
  main.ts                 boot, registries → frame, loop (finds kinds and worlds by import.meta.glob), keys, hooks
  engine/limits.ts|.wgsl  every hard cap, with its reason; the WGSL copy is checked by npm test
  engine/registry.ts      Registry<T>: register / get / all
  engine/params.ts        defineParams: typed parameter objects per module, listed for the panel and hooks
  engine/panel.ts         the debug panel (plain DOM), `/` or ?panel
  engine/frame.ts         FrameBuilder: GPU stages and CPU phases, FrameCtx, describe()
  engine/views.ts         ViewCtx: camera, weft View, world, scene targets, scene pass
  engine/scene.ts         declareScene(view, worlds, kinds): backdrop → opaque → glow
  engine/camera.ts        CameraRig (free orbit + director's shots / locked to a StagePlane), StagePlane
  engine/shots.ts         the director's shot framings
  engine/pip.ts           ?pip: the other world from an orbiting camera, in an inset
  engine/perf.ts          dynamic resolution or a fixed render scale
  engine/hooks.ts         window.bend
  engine/film.ts          the film's scripted cuts (no text)
  engine/util.wgsl        random, quaternions, noise, colour helpers
  skeleton/rig.ts         Rig, JOINT indices, Skeleton (pos/rot → GPU joints), forward()
  skeleton/clips.ts       loadMotion, Track
  skeleton/landmarks.ts   LandmarkPose (13 points), landmarksFromSkeleton
  skeleton/retarget.ts    fitSkeleton: 13 landmarks (+ optional extras) onto the rig
  skeleton/locomotion/    moves.ts (motion-matching database), mover.ts (the Mover, without Lead's UI)
  dancer/                 controller.ts, dancer.ts, mocap.ts, landmark.ts, camera.ts (webcam), wander.ts,
                          programme.ts (the director's acts), show.ts (cast + stage), demos.ts
  matter/core/            kind.ts (contracts, registry, layersOf), capsules.ts, layout.ts (homes), bodies.ts
                          (shared group 3), particle.wgsl, body.wgsl (motion core), touch.ts (the hand), params.ts
  matter/gems/            the first kind: gems.ts, events.ts, fixtures.ts, minerals.ts, params.ts, index.ts,
                          gem.wgsl, sim.wgsl, cull.wgsl, draw.wgsl, streaks.wgsl, sparks_{sim,draw}.wgsl
  matter/field/           field.ts + field.wgsl: the interface, calm air
  matter/{fire,water,ice,plasma,reactions}/  README.md each (wave 1)
  worlds/world.ts         World, WorldDef, PortalDef, Fixture, WorldCtx, the registry
  worlds/light.wgsl       world light per pipeline (override WORLD) over shared group 2
  worlds/shared.ts        builds group 2 from every world's uniforms
  worlds/geode/           geode.ts, geode.wgsl (light, caustics, air), backdrop.wgsl, motes.wgsl, index.ts
  worlds/redwoods/        redwoods.ts, day.ts, layout.ts, textures.ts, forest.wgsl, woods/trunks/grass/ferns/
                          flowers/lanterns/pollen .wgsl, index.ts
  post/                   post.ts, air.wgsl (per view, per world), post.wgsl (dof, trail, bloom, grade, inset), yuv.wgsl
  audio/                  voices.ts, sound.ts, score.ts, music.ts, clock.ts (BeatClock)
  portals/ play/ input/ ai/ net/   README.md each
```

Every `.wgsl` has its generated `.d.wgsl.ts` beside it (committed, as weft recommends).

## The contracts, as they ended up

```ts
// matter/core/kind.ts
type BodyPart = 'torso' | 'head' | 'arms' | 'hands' | 'legs' | 'feet';
interface LoadoutLayer { kind: string; share: number; parts?: BodyPart[]; params?: Record<string, unknown> }
interface Loadout { layers: LoadoutLayer[] }
interface Budget { count: number }
interface MatterLayer extends LayoutLayer { layer: LoadoutLayer }      // LayoutLayer: { dancer, rig, parts?, weight }
interface MatterCtx { kit: Kit; frame: FrameBuilder; bodies: BodyBuffers; hand: Hand; field: Field;
  worlds: readonly World[]; base: string; coarse: boolean; film: boolean; views: number }
interface MatterActs { rise(at: number, spread: number): void; shatter(x: number, y: number, z: number, strength: number): void;
  settle(on: boolean): void; dancing(on: boolean): void }
interface MatterPasses { readonly id: string; declareView(scene: ScenePass): void; layout(layers: MatterLayer[]): void;
  update(f: FrameCtx): void; resize?(budget: Budget): void; acts?: MatterActs; stats?(): Record<string, number | string> }
interface MatterKind { readonly id: string; declare(ctx: MatterCtx): MatterPasses | Promise<MatterPasses> }
const matterKinds: Registry<MatterKind>;
function layersOf(kind: string, cast: readonly { rig: Rig; loadout: Loadout }[]): MatterLayer[];
const gemsLoadout: (suite: string) => Loadout;

// matter/core/layout.ts
function layoutHomes(n: number, layers: readonly LayoutLayer[], out: Float32Array, o?: LayoutOptions): LayoutRange[];

// engine/scene.ts
type ScenePhase = 'backdrop' | 'opaque' | 'glow';
interface ScenePass { readonly pass: RenderPass; readonly phase: ScenePhase; readonly view: ViewCtx; readonly world: World; readonly on: () => boolean }
function declareScene(view: ViewCtx, worlds: readonly World[], matter: readonly MatterPasses[]): void;

// worlds/world.ts
interface World {
  readonly id: string; readonly light: number; readonly mood: number;
  readonly shared: Record<string, UniformBuffer<any>>;
  readonly stages: StagePlane[]; readonly portals: PortalDef[]; readonly spawns: [number, number, number][];
  readonly fixtures: Fixture[]; readonly mirrorFloor: boolean; readonly room: number; readonly maxDist: number;
  load(ctx: WorldCtx): Promise<void>;
  update(f: FrameCtx, centre: { x: number; z: number; ring: boolean; dancers: number }): void;
  declareScene(scene: ScenePass): void;
  groundAt(x: number, z: number): number;
  exposure(): number; tone(): Tone; ambience(): [number, number, number, number] | null;
}
interface WorldDef { readonly id: string; make(ctx: WorldCtx): World }
interface WorldCtx { kit: Kit; base: string; bodies: BodyBuffers; coarse: boolean; film: boolean }
interface PortalDef { id: string; at: V3; normal: V3; radius: number; to: { world: string; portal: string } }
interface Fixture { kind: string; [field: string]: unknown }
const worlds: Registry<WorldDef>;

// engine/camera.ts
interface StagePlane { id: string; origin: V3; right: V3; normal: V3; halfWidth: number; height: number;
  ledges: { x0: number; x1: number; y: number }[]; lens: number; maxDistance: number }
class CameraRig { mode: 'free' | 'locked'; yaw; pitch; dist; height; fov; target; idle; shot; zoom;
  orbit(dx, dy); turn(dx, dy); dolly(k, maxDist?); shoot(s: Shot); lock(plane: StagePlane | null);
  framing: Float32Array; framingCount: number; update(dt: number, f: RigInput): void;
  apply(c: Camera, width: number, height: number): void; get locked(): number }

// dancer/controller.ts, dancer/dancer.ts
interface Controller { readonly kind: string; readonly rig: Rig; update(dt: number, ctx: FrameCtx, out: Skeleton): void }
class Dancer { constructor(id: string, controller: Controller, loadout: Loadout); readonly skeleton: Skeleton;
  setController(c: Controller): void; update(f: FrameCtx): void }
class MocapController implements Controller { x; z; yaw; inPlace; constructor(track: Track, timeOffset?: number) }
class LandmarkController implements Controller { pose: LandmarkPose; ground: number | null;
  source: ((pose: LandmarkPose, f: FrameCtx) => void) | null; constructor(rig: Rig, pose?: LandmarkPose); place(x, z, yaw) }
class CameraController extends LandmarkController { baseX; z; yaw; seen; feed(world, image, dt, now) }
class WanderController implements Controller { readonly mover: Mover; radius; cx; cz; place(x, z, yaw?) }

// skeleton/
interface Rig { joints: RigJoint[] }               // RigJoint { name, parent, offset, rotates }
class Skeleton { pos: Vec3[]; rot: Quat[]; world: Float32Array; rig: Rig; commit(dt: number): void; reset(): void }
interface LandmarkPose { p: Float32Array /* 39 */; root: Vec3; yaw: number; extra: Float32Array | null /* 18 */ }
function landmarksFromSkeleton(sk: Skeleton, out: LandmarkPose, ground?: number): LandmarkPose;
function fitSkeleton(lm: LandmarkPose, out: Skeleton, lift?: number): void;

// engine/frame.ts
interface FrameCtx { kit: Kit; dt: number; danceDt: number; t: number; frame: number; now: number;
  beat: { beats: number; bpm: number }; dancers: readonly Dancer[]; views: readonly ViewCtx[] }

// matter/field/field.wgsl + field.ts
fn fieldWind(p: vec3f) -> vec3f; fn fieldHeat(p: vec3f) -> f32; fn fieldWet(p: vec3f) -> f32;   // calm air
class Field { centre; halfSize; cells; live: false; deposit(d: Deposit): void; update(f: FrameCtx): void }
```

## Decisions where the plan met weft (also in AGENTS.md)

- **`resize` is on `MatterPasses`, not `MatterKind`.** What it resizes is made in `declare`.
- **`World.declareScene(scene)` takes a `ScenePass`** (pass, phase, view, world, `on`), called per view, per world and
  per phase. weft draws a pass's draws in declaration order and the scene is one MSAA pass (splitting it would cost a
  store and reload of 4x MSAA targets), so matter has to be declared between a world's backdrop and its solid things.
  Draws are enabled by `view.world === world.id`, which is what lets two views show two worlds in one frame.
- **Worlds register a factory** (`{ id, make(ctx) }`): a world needs the kit for its uniforms.
- **World light**: `worlds/light.wgsl` switches on `override WORLD` (one pipeline per world) and reads every world's
  uniform from a shared bind group (group 2). A kind declares one draw per world. The `forest.on` branches are gone.
  A new world adds one include, one binding and one case per function to that file (WGSL has no registry).
- **Shared body group**: joints, capsules, the dancer count and the hand are group 3, shared by weft with every shader
  that includes `matter/core/body.wgsl`. A kind binds none of them.
- **The mode machine is core** (`bodyBegin`, `bodyStep`, `bodyOrient` in body.wgsl), returning event bits; the gems
  add their sparks and sound events on those bits. `homeOf` reads the dancer from the home's capsule slot
  (`dancer × SEGS + capsule`), so blocks of unequal size (loadouts) work; Gem Dancers computed the dancer from equal
  blocks.
- **Gem homes merged**: `homes` and `homes2` are one `array<Home>` (place, look), which keeps the gem simulation at 7
  storage buffers with the shared joints and capsules.
- **Per-view cull**: each view has its own cull compute, args, lists and a small `CullView` uniform (one value per
  run, so one buffer per view). Draw-list capacity always includes every world's fixtures (a little more list memory;
  no change to what is drawn).
- **Landmarks**: the prototype's order and frame (x across, y up, z forward, a yaw, the root on the ground under the
  hips), but "left" is the dancer's own left (+x facing +z, a right-handed world). **The prototype puts its L joints at
  -x**: its poses are mirrored relative to ours. Wave 1 (dancers, net) must negate x or swap L/R when porting moves.
- **A beat clock** (`audio/clock.ts`, `FrameCtx.beat`) with the prototype's `syncTo`, `beatInfo`, `beatError`, driven
  locally for now.
- **The director** became `dancer/programme.ts` (acts) + the camera rig's idle shots; **the cast and stage** became
  `dancer/show.ts`. The pointer's matter interaction stayed (it's part of Gem Dancers) as `matter/core/touch.ts`.
- `kit.view` gives the pip its own Frame; the pip inset is a pass with a viewport onto the canvas.

## The frame, in order (`bend.stats().frame`, with ?pip)

```
cpu dancers  show: the programme, every dancer posed, joints to the GPU
cpu camera   camera rig, ?pip camera, the hand
cpu worlds   worlds on screen
cpu matter   matter kinds
cpu post     post chain
cpu audio    the score
gpu sim      gems.sim, gems.events.copy, gems.sparks
gpu cull     gems.lod.reset, gems.cull, gems.lod.reset.pip, gems.cull.pip
gpu scene    scene (main), scene.pip
gpu air      air, air.pip
gpu post     lens, trail, bloom.down0-4, bloom.up3-0
gpu out      grade (or grade.film + film.yuv), inset.pip
gpu end      trail.swap
cpu after    gems: sound events; the hand: blasts last one frame
```

Without ?pip it is exactly Gem Dancers' run list: step, events copy, reset, cull, sparks, scene, air, lens, trail,
nine bloom passes, grade, swap (sparks moved before the scene; it was after the cull, and neither reads the other).

## What was dropped from Gem Dancers

Lead mode (`play/play.ts`, `troupe.ts`, `hud.ts`, `play.css`, `lead.wgsl`, the marks on the floor) except the motion
matching it was built on (`moves.ts`, `mover.ts`, now `skeleton/locomotion/`); the portfolio's chrome (`home.ts`,
`controls.ts`, `kit.ts`, `lapidary.css`, the dock, the wake card, captions, the X mark); Tweakpane and `ui.ts` (replaced
by `engine/panel.ts`); the film's title cards and captions (`film.mjs` lays no text over anything now); the deploy
script and the phone/lead check scripts. The Mover keeps its carry-and-throw physics, unused for now.

## Timings (GPU, RTX 5090, 1280×800, render scale 1, 15,000 stones, same steps)

weft's profiler (timestamp queries), smoothed, over 150 frames stepped at 60 fps after the stated warm-up, each on its own weft
(Gem Dancers pins weft 0.2.1; this repo 0.2.8). Gem Dancers is the original, built and served read-only (vite preview)
from a copy on port 5392; Energy Bending ran from its dev server on 5391 (the GPU work is the same either way: the
same shaders, sent lean in both).

Two sessions each (the second a fresh browser, same steps). Per pass in ms; "frame" is first pass start to last pass end.

| scene | Gem Dancers, run 1 / run 2 | Energy Bending, run 1 / run 2 |
|---|---|---|
| geode, salsa, 900 frames in: frame | 0.545 / 0.594 | 0.560 / 0.640 |
| geode, 300 frames later: frame | n/a / 0.602 | n/a / 0.597 |
| geode: scene pass | 0.225 / 0.219 | 0.214 / 0.216 |
| geode: air | 0.191 / 0.190 | 0.190 / 0.191 |
| geode: gem sim + cull + sparks | 0.017 / 0.018 | 0.017 / 0.017 |
| redwoods 13:00, 900 frames in: frame | 20.04 (a compile stall) / 1.417 | 1.418 / 1.487 |
| redwoods: scene pass | 16.36 (stall) / 0.908 | 0.929 / 0.971 |
| redwoods: air | 0.360 / 0.357 | 0.357 / 0.359 |
| ?pip (geode + the redwoods inset at a third): frame | n/a | 1.318 / 1.300 (inset scene 0.65 to 0.75, its air 0.07) |

The geode is the same within run-to-run noise (which is itself up to 10 % of the frame here). The redwoods' scene
pass reads 2 to 7 % higher; with a run-to-run spread of the same size I can't call that a regression, but if it is one
the likely causes are the gem pipelines now binding both worlds' light uniforms (group 2) and weft 0.2.1 against
0.2.8. The numbers are tiny because a 5090 has little to do at 1280×800 with 15k
stones; the redwoods scene is the expensive part (the meadow's instancing and the per-pixel trunk tests), as before.
Timings files: `shots/*/timings-*.json` (not committed).

## Stills (docs/reports/media/, 1280×800, read back from the canvas with bend.grab)

| file | what it shows | anything wrong |
|---|---|---|
| `geode-dance.jpg` vs `original-geode-dance.jpg` | the salsa couple 15 s after waking, amethyst and celestite, wall crystals out of focus, caustics on the floor | none seen; PSNR 26.9 dB against the original, the difference being film grain (it moves with time) and the sparkles' positions |
| `redwoods-day.jpg` vs `original-redwoods-day.jpg` | the couple in the meadow at 13:00, trunks, grass, flowers, mist, sun and shade | none seen; PSNR 25.0 dB, same causes |
| `redwoods-night.jpg` vs `original-redwoods-night.jpg` | 21:36: fireflies, moonlight, dark trunks | the lanterns hang above this framing (redwoods-lanterns.jpg shows them); PSNR 21.3 dB (fireflies and sparks move) |
| `pip.jpg` | the geode, and top right the redwoods from an orbiting camera with the same dancers lit by the woods | the inset has no bloom or depth of field (by design: air and tone map only) |
| `landmarks.jpg` | left: the mocap dancer (Violet suite); right: the same dance through 13 landmarks and back onto the rig (Sky) | measured: the copy's joints are within 2 cm of the source's (hands), under 1 cm elsewhere; hands and feet lose their own turn (no index or toe landmarks) |
| `wander.jpg` | two dancers on motion matching, each dancing toward its own random point on the floor | a first capture framed them badly (4 m apart in a close shot); the demo now keeps them within 2 m of the middle |
| `redwoods-lanterns.jpg` | 21:36, looking up the trunks: the paper lanterns lit on their cords, the limbs, a starry sky through the canopy | |
| `lock.jpg` | the camera locked to the geode's centre plane, face on, long lens, framing the couple | the salsa couple dance along the view, so in side view they overlap; that is the plane's choice, not a bug |
| `film-contact.jpg` | three frames of the 10 s film: rising, the swirl, the blast | |

## The film

`node scripts/film.mjs docs/reports/media/film --seconds 10` (cut `short`): 600 frames at 60 fps rendered at
1920×1080 and brought down to 1280×720 YUV on the GPU, 36 s to render, with the score rendered offline and muxed in
(h264 + aac, 4.6 MB). It is at `docs/reports/media/film/energybending.mp4` (git-ignored, with `score.wav`). No text.

## Console

On load: one warning from weft's `createKit` on Windows ("The powerPreference option is currently ignored when calling
requestAdapter() on Windows"). Gem Dancers shows the same warning; it can't be silenced from the app (weft fills the
option in) and is engine ask 1. A favicon 404 seen in the first captures is fixed. No WebGPU validation errors
(`bend.stats().errors` empty), no failed pipelines (`kit.ready()` failed: 0), and the app awaits `kit.ready()` before
its first frame, so no draw is skipped silently. The headless captures print the adapter: `nvidia blackwell 0x2b85
NVIDIA GeForce RTX 5090` (the real GPU; `--enable-webgpu-developer-features` makes Chrome give the full name).

## Honest weak points

- **The two worlds still share one programme.** The show is Gem Dancers' director (heap, rise, dance, shatter); the
  jogo replaces it in wave 2. `show.ts` knows about the webcam and the demos; it is glue, not a contract.
- **`?pip` shows the same dancers in the other world.** That proves per-view declaration and per-world pipelines; a
  portal will want the other world's own population, which the cast doesn't model yet (one cast, one set of slots).
- **Locked camera**: the easing and framing work; dancers are not constrained to the plane and ledges do nothing yet
  (wave 1, dancers). The geode's plane caps the camera inside the wall, widening the lens instead.
- **Retargeting from 13 landmarks** loses the head's own turn, the hands' and the feet's (they follow the forearm and
  the body's facing). The webcam keeps them by passing the six extras.
- **Landmark handedness differs from the prototype** (see Decisions). Someone porting its moves must mirror them.
- **The world-light switch** is the one file a new world edits outside its folder.
- **Uniform caps grew** (32 specimen kinds): the gem uniforms are 3.5 KB; nothing measurable.
- **`mover.ts` is 645 lines** (ported nearly whole); `main.ts` is 250 lines, mostly the per-phase ticks, which read
  better in one place than spread across files.
- **GPU timings on a 5090 at 1280×800 are a fraction of a millisecond**, where run-to-run noise is several percent.
  They show no regression; they can't show a 1 % one. A phone-sized device would be a better test.
- **Determinism**: stepped captures repeat, but the post's grain and the fireflies run on the frame's time, and the
  sound events reach the CPU a frame or two late (as before).

## Not done

- Not tested on a phone, nor with a real webcam (headless has no camera); the webcam path is a port that typechecks.
- No Node tests of the retargeter or the layout (the round trip was measured in the page instead).
- The field is a stub; reactions, portals, input, net, brains and play are READMEs.
- The panel shows a chosen subset of parameters; everything is reachable through `bend.params` / `bend.set`.

## What wave 1 needs to know

- **Read `AGENTS.md`, then your guide in `docs/extending/`.** Don't edit `main.ts`: a kind or world folder with an
  `index.ts` is found by glob.
- **Binding budgets left** (eight storage buffers per stage on the baseline): gem sim 7 (1 left), gem cull 7 (1
  left), gem draw vertex 5 (3 left), grass vertex 2. A new kind's sim starts with 2 used by the shared body group.
  Uniforms: the gem draw has sim, look, minerals, the two world lights and the frame. The field must be sampled
  textures, not storage buffers.
- **Bind groups**: 0 weft's frame, 1 the shader's own, 2 world light (shared, include `worlds/light.wgsl`), 3 bodies
  (shared, include `matter/core/body.wgsl`). A draw-only shader that needs particle structs includes
  `matter/core/particle.wgsl` (no bindings).
- **Add a draw**: in `declareView(s)` (kinds) or `declareScene(s)` (worlds), for `s.phase`, `enabled: s.on`, and
  `constants: { WORLD: s.world.light }` if lit by the world. Declare once; never in the loop.
- **Add a compute step**: in `declare(ctx)`, `ctx.frame.add('sim', kit.compute(…), 'my-kind')`; per view in the
  `'cull'` stage with `view: s.view.view` (see `GemPasses.listsFor`). A per-view value needs its own uniform buffer.
- **Read the joints and capsules in a shader**: `#include "../core/body"`; `joints[d * MAXJ + j]` is
  `Joint { pos (w: speed), rot, vel }` in world space, `segs[d * SEGS + s]` the capsule, `bodies.dancers` how many;
  `homeOf(home, i, step)` places a `Home` from `layoutHomes`. Joint indices are `JOINT` in skeleton/rig.ts.
- **Loadouts**: `bend.loadout(d, { layers: [...] })` re-lays every kind. A layer's `share` is its part of the dancer
  and, across dancers, of the kind's particles; `parts` picks capsules by `BodyPart`.
- **Capture**: `node scripts/shot.mjs <dir> <steps.json>` and `node scripts/film.mjs <dir>`, both under the render lock.
  Don't edit `src/` while a capture runs against the dev server: Vite reloads the page and the capture dies.
- **Timing**: `bend.kit.profiler.force = true`, step, read `bend.stats().passes`.

## Commits

On `master`, no remote: the foundation; the docs and capture scripts; the report with stills and fixes (see
`git log`).
