# Energy Bending, for agents (and anyone learning from it)

## What it is

1. A place you dance in, with someone else, where bodies are made of matter that answers the music.
2. Dancers are skeletons (the 38-joint CMU rig) wearing matter: GPU particles sprung to homes on capsules.
3. Matter kinds (gems, fire, plasma, water, ice, steam) and worlds (the geode, the redwoods, the pool, the tide temple,
   the sky forge) are plugged in by registry; live gates join the worlds.
4. It runs on WebGPU through weft (`@ericrius1/weft`), an explicit list of passes with WGSL as the source of data.
5. The plan of record is `docs/PLAN.md`. Reports: `docs/reports/0-foundation.md`, the eight wave 1 reports
   (`1-*.md`) and the integration, `docs/reports/2-integration.md` (read that one first: what joins what now).

## Run it

```bash
npm install
npm run dev          # http://localhost:5391/energybending/ (PORT=5395 npm run dev for another port)
npm run build        # dist/, served from BASE (default /energybending/: BASE=/ npm run build for the root)
npm run typecheck    # tsc (Vite only strips types)
npm test             # limits, src tests (dancers, input), audio tests, the gates' algebra, the net tests (~2 min)
npm run test:net     # the net tests alone (real time: the slow part)
npm start            # the room server (node server/index.ts [port]; default 5417)
npm run weft         # weft at the tip of its dist/weft branch (predev and prebuild do this too)
```

Debug flags (add to the URL): `?pip` (the other world in an inset, from an orbiting camera), `?landmarks` (a mocap
dancer and its 13-landmark copy), `?wander` (motion-matched dancers walking to random points), `?lock` (the camera
locked to the world's stage plane; `l` toggles), `?world=redwoods|pool|temple|forge`, `?panel` (or `/`),
`?debug` (weft's overlay: GPU time per pass), `?noautores`, `?you` (webcam on first touch; `y` toggles),
`?dress=fire,water` (loadout presets per dancer: matter/core/presets.ts), `?play` (a playable dancer; `&two` adds a
bot partner; `&net=ROOM&server=ws://…/ws` plays online), `?net=ROOM` (the mocap net demo), `?gates` (debug gates; the
worlds' own gates are always open), `?fly`, `?field` (the field overlay), `?aura=fire,water` (auras for the field
only), `?vortex=4`. Keys: space wakes, then shatters; `n`
next dance; `w` next world; `f` fullscreen.

Links for Eric: never localhost. Serve tailnet-only with `tailscale serve --bg --https=<port> http://127.0.0.1:<port>`
and give `https://portal-windows.tail4a295a.ts.net:<port>/energybending/`.

## The map

```
src/
  main.ts            boot, assemble the frame from the registries, loop (kinds and worlds are found by import.meta.glob)
  engine/            limits (caps), registry, params + panel, frame (stages and phases), views, scene (declaration
                     per view and phase), camera rig (free / locked) and shots, pip, perf, hooks (window.bend), film
  skeleton/          rig + Skeleton (posed joints, the GPU layout), clips (CMU mocap), landmarks (13 points),
                     retarget (landmarks onto the rig), locomotion/ (motion matching: moves.ts, mover.ts)
  dancer/            Dancer, Controller and the controllers (mocap, landmark, camera, wander), the programme and show
                     (Gem Dancers' director and cast), demos (?landmarks, ?wander)
  matter/core/       MatterKind, loadouts, presets (?dress), capsules and the layout of homes, shared body buffers
                     (group 3), the body's motion (body.wgsl), the hand (touch.ts), carry (portals), sounding (voices)
  matter/gems/       specimens, LOD cull per view, shading, streaks, sparkles, sound events, fixtures, carry
  matter/field/      the wind/heat/wet grid (3D textures in group 3), auras, deposits, vortices, probes, overlay
  matter/fire/       one flame pool for fire and plasma (a form per dancer), the fire's light for the worlds
  matter/plasma/     plasma's layers (flames at form 1) and the arcs
  matter/water/      one particle pool for water and ice, the screen-space water surface, drops
  matter/ice/        shards, mist, set ice (ledges, melt, shatter)
  matter/reactions/  steam (born of the field; drawn after the depth of field)
  worlds/            World contract and registry, light.wgsl (world light per pipeline, group 2, with the dancers'
                     fire), shared.ts, stage.ts (stage planes), water/ (ripples and the surface of the pool and temple)
  worlds/geode|redwoods|pool|temple|forge/   the five worlds, each with its stage, ledges and portal sites
  portals/           live gates: slots (views), the gate camera, the disc's surface, crossing, carrying
  dancer/            Dancer (form, presence, world), the controllers (mocap, landmark, camera, wander, intent), body
                     physics (character.ts), the move library, ?play (play.ts), the programme and show
  input/             one Intent per player from keyboard, gamepad, touch, camera body; the hub
  net/               Net, LocalNet, Session, NetController, the ?net demo, ?play&net (play.ts)
  post/              air (per view, per world), depth of field (and the post-lens hook), trails, bloom, grade, inset
  audio/             the music engine (clock, harmony, engine, synth), the stone score, matter voices, the lab
  play/ ai/          later waves (a README each)
shared/ server/ test/   the protocol and the jogo rules, the room server, the net tests
scripts/             shot.mjs (stills + GPU timings; a step's `eval`/`eval2` run in the page with `bend`), film.mjs,
                     test-ts.mjs, test-audio.mjs, check-portals.mjs, check-limits.mjs, audio-lab.mjs, lib/browser.mjs
sketches/            dance-first-2d/: the 2D prototype, plain JS with its own package.json, ignored by typecheck/build
public/              motion/, specimens/, worlds/<id>/ (see docs/ASSETS.md)
```

## The frame

GPU stages, in order (`engine/frame.ts STAGES`): `sim` (the field's step, the carries, every kind's step, the worlds'
ripples, readback copies) → `cull` (per view: gem culls, water splats and smoothing) → `gates` (each live gate's view:
its scene and air, deepest first) → `scene` (per view) → `air` (per view: the water's surface composite, then the air)
→ `post` (main view: the lens (depth of field, then steam over it), trail, bloom) → `out` (canvas or film, insets) →
`end` (swaps).
CPU phases before the run (`PHASES`): `input` → `dancers` → `travel` (dancers through gates) → `camera` → `gates`
(the camera through a gate, which gates go live) → `worlds` → `matter` → `post` → `audio`; then `after` callbacks
(readbacks). `bend.stats().frame` lists every item and tick in the order it runs.

Within a scene pass the order is the declaration order (weft), so declaration goes phase by phase
(`engine/scene.ts`): `backdrop` (worlds only) → `opaque` (matter, then the world's solid things) → `glow` (additive).

## The contracts (exact signatures in docs/reports/0-foundation.md)

- `MatterKind { id; declare(ctx: MatterCtx): MatterPasses | Promise<MatterPasses> }`, registered with
  `matterKinds.register`. `MatterPasses { id; declareView(scene); layout(layers); update(f); resize?(budget); acts?; stats? }`.
- `Loadout { layers: { kind, share, parts?, params? }[] }`, `BodyPart = 'torso'|'head'|'arms'|'hands'|'legs'|'feet'`.
  Optional on `MatterPasses`: `hear(ears)` (its voice), `carry(moves)` (a dancer through a gate), `declarePost(post)`
  (translucent matter over the focused image). Every cull and draw of a dancer's particles binds the view's `seen`.
- `World { id; light; mood; shared; stages; portals; spawns; fixtures; mirrorFloor; room; maxDist; fallY?; load;
  update; declareScene(scene); groundAt; exposure; tone; ambience }`, registered as `worlds.register({ id, make(ctx) })`;
  `PortalDef { id, at, normal, radius, to, up? }`.
- `Controller { kind; rig; update(dt, ctx: FrameCtx, out: Skeleton); carry?(m) }`; `Dancer = skeleton + controller +
  loadout`, plus `form` (0 … 1, the one power form), `presence` (0 … 1, set by the show) and `world` (from the gates).
- `LandmarkPose { p: Float32Array(39); root; yaw; extra }`, `landmarksFromSkeleton`, `fitSkeleton`.
- `CameraRig` modes `free` (with `follow`, a third-person camera) / `locked` (`lock(plane | null)`); `carry(m)`.
  `StagePlane { id, origin, right, halfWidth, ground, ledges: Ledge[], spawns, ledgeY?, height?, lens? }`,
  `Ledge { id, x0, x1, y, solid?, thick?, bob? }`, `ledgeY`, `planeNormal`, `planePoint` (engine/camera.ts).
- `Field` (`deposit`, `vortex`, `probe`, `updraft`, `forms`, `presence`) and `fieldWind / fieldHeat / fieldWet /
  fieldSteam` (matter/field/field.wgsl, group 3).
- `Session` / `NetController` (src/net), `Portals` (`bend.gates`), `Music` (`bend.music`): see their guides.
- Hooks: `bend.loadout`, `bend.dress(d, preset)`, `bend.form(d, v)`, `bend.players/intent/move/place`, `bend.gates`.

## Rules (from docs/PLAN.md, "Principles")

1. Small modules with one job, joined by registries. A new matter kind or world is a folder with an `index.ts` that
   registers it; `main.ts` finds it by glob. (One exception, by necessity: a new world adds its case to
   `src/worlds/light.wgsl`, because WGSL has no registry.)
2. `main.ts` stays thin.
3. WGSL is the single source of data layouts: `kit.uniforms(shader.structs.X)`, bind by name, no byte offsets.
4. No hidden globals: each module's tunables are a typed `defineParams` object; caps are in `src/engine/limits.ts`
   (and `limits.wgsl`, checked by `npm test`).
5. Every file opens with a short plain paragraph; comments say why.
6. Deterministic when stepped: `bend.step(n, dt)`.
7. Verify by running: stills, probes, timings. Say what was measured and what was not.
8. Phones by scaling counts and resolution, never a separate code path (`coarse` lowers counts).

## weft footguns (read node_modules/@ericrius1/weft/AGENTS.md)

- A draw or compute whose pipeline isn't compiled yet is skipped silently. `await kit.ready(items)` before a one-off
  run; the app awaits `kit.ready()` once before its loop.
- A uniform buffer holds one value per `kit.run`. Two views that need different values need two buffers (that's why
  each view's gem cull has its own `CullView` uniform).
- Draws in a pass run in declaration order; declare in drawing order (engine/scene.ts does it by phase).
- Declare draws and computes once, at setup; switch with `enabled`, never by redeclaring in the loop.
- Eight storage buffers and twelve uniform buffers per shader stage on the baseline. Storage now (own, plus the
  shared joints and segs where a shader includes body or field): gems' sim 7, gems' cull 7, gems' draw 5, water's sim 5,
  ice shards 4, fire's sim 4, water splat and drops 3, steam's sim 3, fire's draw 2. **Uniforms are the tight one**:
  the world light group is now six uniforms (five worlds and the dancers' fire) in every shader lit by the world, so
  the gems' draw declares 12 of 12, water drops and ice shards 11, steam and grass 10 (counted from the declarations,
  frame included). The next world or a new uniform in a lit shader breaks the baseline: pack the worlds' uniforms
  into one (or move some to storage) first.
- Bind group 0 is weft's (frame). Here: group 1 is a shader's own, group 2 the worlds' light (shared: five worlds'
  uniforms, the pool's and the temple's wave textures, the dancers' fire light), group 3 the bodies and the field
  (shared, made by `Field`: joints, segs, bodies, touch, fieldA, fieldB, fieldBox). A shader gets a shared group by
  including the file that declares it.
- Reversed-Z, infinite far: clear depth to 0; `depthCompare` defaults to greater-equal.

## Capture a still, read timings

```bash
npm run dev                                                   # in one terminal (port 5391)
node scripts/shot.mjs shots/mine scripts/steps/foundation.json # stills into shots/mine/*.png, timings-*.json
node scripts/shot.mjs shots/one --query pip                    # the default two steps (asleep, awake) with ?pip
node scripts/film.mjs docs/reports/media/film --seconds 10     # a film (no text), score muxed in
```

Both take the shared render lock (`C:/Users/ericr/render-lock`, a directory) and release it on exit; both run headless
Chrome on the real GPU (on Windows no ANGLE flag is needed: `--enable-unsafe-webgpu --ignore-gpu-blocklist
--enable-gpu`) and print the adapter. Headless Chrome doesn't composite WebGPU into page screenshots, so stills come
from `bend.grab()` (weft's Capture reads the canvas back). In a page: `bend.kit.profiler.force = true`, step, then
`bend.stats().passes` (ms per pass) and `.gpuMs`.

## How to add

- a matter kind: `docs/extending/matter-kind.md`
- a world: `docs/extending/world.md`
- a controller (or a brain): `docs/extending/controller.md`
- a draw: in a kind's `declareView(s)` or a world's `declareScene(s)`, for `s.phase`, with `enabled: s.on` (and for
  matter, `constants: { WORLD: s.world.light }` if it includes worlds/light.wgsl).
- a compute step: in `declare(ctx)`, `ctx.frame.add('sim', kit.compute(shader, { threads, bind }), 'my-kind')`.
- reading the joints and capsules from a kind's shader: `#include "../core/body"`, then `joints[d * MAXJ + j]`
  (`Joint { pos, rot, vel }`: pos.w is the speed), `segs[d * SEGS + s]`, `bodies.dancers`, and
  `homeOf(home, i, step)` for a home laid out by `layoutHomes`.

## Decisions taken where the plan met weft (also in the report)

- `MatterKind.resize` lives on `MatterPasses` (the state it resizes is made in `declare`).
- `World.declareScene(scene)` takes a `ScenePass` (pass, phase, view, world, on): declaration happens per phase so
  matter can sit between a world's backdrop and its own solid things in one MSAA pass.
- Worlds register a factory (`make(ctx)`), because a world needs the kit for its uniforms.
- World light is a WGSL `override WORLD` switch in `worlds/light.wgsl` over a shared uniform group; a kind declares
  one draw per world.
- `Controller.update(dt, ctx, out: Skeleton)` writes positions and rotations; the Dancer commits (velocities, GPU layout).
- Landmarks follow the prototype's order and frame (x across, y up, z forward, yaw), but "left" is the dancer's own
  left (+x when facing +z). The prototype puts L at -x: mirror (negate x) when porting its poses.
