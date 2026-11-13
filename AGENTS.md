# Energy Bending, for agents (and anyone learning from it)

## What it is

1. A place you dance in, with someone else, where bodies are made of matter that answers the music.
2. Dancers are skeletons (the 38-joint CMU rig) wearing matter: GPU particles sprung to homes on capsules.
3. Matter kinds (gems, fire, plasma, water, ice, steam) and worlds (the geode, the redwoods, the pool, the tide temple,
   the sky forge) are plugged in by registry; live gates join the worlds.
4. It runs on WebGPU through weft (`@ericrius1/weft`), an explicit list of passes with WGSL as the source of data.
5. The plan of record is `docs/PLAN.md`. Reports: `docs/reports/0-foundation.md`, the eight wave 1 reports
   (`1-*.md`), the first integration (`2-integration.md`), the critic's look and plan (`3-critique.md`), the jogo and
   the brains (`3-jogo.md`, `3-brains.md`), the second wave (`4-*.md`), the second integration (`5-integration.md`),
   the second critic (`6-critique.md`), the film tool (`6-film-tool.md`), the last wave (`7-*.md`) and the third
   integration, `docs/reports/8-integration.md` (read that one first: what joins what now, and what is left).

## Run it

```bash
npm install
npm run dev          # http://localhost:5391/energybending/ (PORT=5395 npm run dev for another port)
npm run build        # dist/, served from BASE (default /energybending/: BASE=/ npm run build for the root)
npm run typecheck    # tsc (Vite only strips types)
npm test             # limits, the binding budget, src tests, audio tests, the gates' algebra, the net tests (~2 min)
npm run test:net     # the net tests alone (real time: the slow part)
npm start            # the room server (node server/index.ts [port]; default 5417)
npm run weft         # weft at the tip of its dist/weft branch (predev and prebuild do this too)
```

Debug flags (add to the URL): `?pip` (the other world in an inset, from an orbiting camera), `?landmarks` (a mocap
dancer and its 13-landmark copy), `?wander` (motion-matched dancers walking to random points), `?lock` (the camera
locked to the world's stage plane; `l` toggles), `?world=redwoods|pool|temple|forge`, `?panel` (or `/`),
`?debug` (weft's overlay: GPU time per pass), `?baseline` (only WebGPU's default limits: a phone's), `?noautores`, `?you` (webcam on first touch; `y` toggles),
`?jogo=same|partner|online|script` (the game: src/play; `&partner=playful|calm|fierce|mirror|standin`, `&roda=N`,
`&free`, `&bpm=N` a local room's tempo), `?play&partner`, `?roda`, `?teach`, `?npcs=5` (the brains' demos: src/ai), `?class=desktop|laptop|phone`
(the device's budget; `?probe` measures again), `?perf=default|quick&sink=…` (the self-measuring suite, 4-perf.md),
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
  engine/            limits (caps), registry, params + panel, frame (stages and phases), views (a view's scene and
                     glow passes), scene (declaration per view and phase, focus sources), camera rig (free / locked,
                     through gates) and shots, pip, perf (device classes and budgets; perfrun: ?perf), hooks
                     (window.bend), film (the cut path), film-shot and filmcam (a film's timeline: films/*.json)
  skeleton/          rig + Skeleton (posed joints, the GPU layout), clips (CMU mocap), landmarks (13 points),
                     retarget (landmarks onto the rig), locomotion/ (motion matching: moves.ts, mover.ts)
  dancer/            Dancer, Controller and the controllers (mocap, landmark, camera, wander), the programme and show
                     (Gem Dancers' director and cast), demos (?landmarks, ?wander)
  matter/core/       MatterKind, loadouts, presets (?dress), capsules and the layout of homes, shared body buffers
                     (group 3), the body's motion (body.wgsl), the hand (touch.ts), carry (portals), sounding (voices)
  matter/gems/       specimens, LOD cull per view, shading, streaks, sparkles, sound events, fixtures, carry, large
                     crystals, hearts (one uniform other kinds read), the fast-motion hold, minerals
  matter/field/      the wind/heat/wet grid (3D textures in group 3), auras, deposits, vortices, probes, overlay
  matter/fire/       one flame pool for fire and plasma (a form per dancer), drawn as a temperature field in screen
                     space per view (splat, composite into the glow target, focus), a curl grid per dancer, the
                     fire's light for the worlds
  matter/plasma/     plasma's layers (flames at form 1) and the arcs
  matter/water/      one particle pool for water and ice that runs down the body, the screen-space surface
                     (narrow-range filter, luminous shading, ice's facets) in every view and the geode's mirror, drops
  matter/ice/        shards, mist, set ice (ledges, melt, shatter)
  matter/reactions/  steam: fronts, wisps, drips and sparks where bodies meet (drawn after the depth of field, capped)
  worlds/            World contract and registry, solids.ts (World.solids: the one description of a world's solid
                     things, read by the camera, World.clear and the brains), light.wgsl (world light per pipeline, group 2, with the dancers'
                     fire), shared.ts (its one uniform: a slot per world, lightSlot), stage.ts (stage planes), water/ (ripples and the surface of the pool and temple)
  worlds/geode|redwoods|pool|temple|forge/   the five worlds, each with its stage, ledges and portal sites
  portals/           live gates: slots (views), the gate camera, the disc's surface, crossing, carrying
  dancer/            Dancer (form, presence, world), the controllers (mocap, landmark, camera, wander, intent), body
                     physics (character.ts), the move library, ?play (play.ts), the programme and show
  input/             one Intent per player from keyboard, gamepad, touch, camera body; the hub
  net/               Net, LocalNet, Session, NetController, the ?net demo, ?play&net (play.ts)
  post/              the surface step, the merge and the air (per view, per world: the depth contract), the glow's
                     trails, the lens (half-resolution gather, the post-lens hook), bloom, grade (per world), inset
  audio/             the music engine (clock, harmony, engine, synth), the stone score, matter voices, the lab
  play/              the jogo: the room, exchanges, feel, fusion (driving the field's), building, the HUD, menus,
                     scripts, the partner adapter (src/ai's PartnerBrain by default), the roda round it
  ai/                brains: the Brain contract, Scene, BrainDriver, the partner, free dancers (roda), the teacher
shared/ server/ test/   the protocol and the jogo rules, the room server, the net tests
films/               the films' timelines (scripts/film.mjs renders them; docs/extending/film.md)
scripts/             shot.mjs (stills + GPU timings; a step's `eval`/`eval2` run in the page with `bend`), film.mjs (a
                     timeline, shot by shot in takes under the lock; film-serve.mjs serves it without hot reload,
                     film-seams.mjs checks the seams),
                     test-ts.mjs, test-audio.mjs, check-portals.mjs, check-limits.mjs,
                     check-bindings.mjs (the binding budget), audio-lab.mjs, lib/browser.mjs
sketches/            dance-first-2d/: the 2D prototype, plain JS with its own package.json, ignored by typecheck/build
public/              motion/, specimens/, worlds/<id>/ (see docs/ASSETS.md)
```

## The frame

GPU stages, in order (`engine/frame.ts STAGES`): `sim` (the field's step, the carries, every kind's step, fire's curl
grids, the worlds' ripples, readback copies) → `cull` (per view: gem culls, water splats and smoothing, the gates'
views included) → `gates` (each live gate's view: its scene, glow, air, then fire's field over it, deepest first; and
at most four times a second a still for a gate nobody sees live) → `scene` (per view: the scene pass, then its glow
pass) → `surface` (main view and inset, worlds with a scene step: the Pool's and the temple's water, the forge's heat,
on the opaque scene) → `air` (per view: the water bodies composited, fire's splat, focus and composite into the glow
target, the glow's trails, the merge, the air; then steam's half-resolution wisps) → `post` (main view: the lens:
down, gather, composite with steam over it; bloom) → `out` (canvas or film, insets) → `end` (swaps).
CPU phases before the run (`PHASES`): `input` (the jogo's clock and beat, what the brains see) → `dancers` → `travel`
(dancers through gates; the jogo judges) → `camera` (the rig, carried with its player) → `gates` → `worlds` → `matter`
→ `post` → `audio`; then `after` callbacks (readbacks). `bend.stats().frame` lists every item in the order it runs.

**The two-pass scene and the depth contract.** A view's scene is two passes over one depth buffer
(`engine/views.ts`). The scene pass draws the `backdrop` and `opaque` phases into `hdr`, whose **alpha is the opaque
view distance** and nothing else (`engine/scene.ts` turns off the alpha write of any blended draw). The glow pass
draws the `glow` phase into the view's `glow` target (alpha clears to `NO_FOCUS`, 1e4), depth-tested against the opaque
things. Surfaces, reflections and fog (`worldScene`, `worldAir`, the Pool's mirror, the geode's floor) read only the
opaque distance; the glow is laid over afterwards, fogged at its own distance. Translucent matter tells the depth of
field where it is through `MatterPasses.focus(view)` (an r16float texture; "nothing" is at least 1e4: fire writes 6e4,
water 1e5, which a half float stores as +infinity, so compare against it and never do arithmetic on it); the air writes
the main view's focus target from the nearer of the opaque distance and those. Fire splats against the opaque distance
and lays its light into the glow target; water composites its bodies over the opaque scene in `air`, and the merge
finds them there so the Pool mirrors them; fire mirrors itself where the floor is the geode's agate or water
(`World.waterY`). Steam tests by hand against `post.sceneTex` (the air target's alpha: the opaque distance, or a water
body's).

**What each stage costs** (RTX 5090, 1280×800, the critic's six scenes, 5-integration.md): sim about 0.1 ms (field,
fire 0.006 + curl 0.05, water 0.012, steam 0.02); cull 0.3 to 0.6 (water's splats and smoothing about 0.5 with a water
dancer close); gates 0.25 to 0.5 a live view (its glow pass alone about 0.1, even empty); scene 0.15 (the geode) to
0.8 (the redwoods); glow 0.1 to 0.3; air 0.05 (most worlds) to 0.5 (the redwoods' fog march); fire's field 0.1 to
0.25; post about 0.1 (the lens 0.03 to 0.05 at 1080p); whole frames 1.3 to 2.2 ms at 1280×800, 2.1 to 3.0 at 1080p.

**The device's budget** (`engine/perf.ts`): the class (desktop, laptop, phone: `?class=`, else a fill probe) sets a
`Budget` that kinds, worlds and the post chain read at declare with `budget()` (flames and water per dancer, the water
surface's resolution and smoothing, steam, stones, the field's grid, live gates and their scale, the depth of field,
the sprite scale, the roda, the pixel-ratio cap and the autoscaler's range). A phone's numbers are what `coarse` gave;
`coarse` remains only for geometry (worlds' layouts, the curl grid, the webcam's model).

Within a scene pass the order is the declaration order (weft), so declaration goes phase by phase
(`engine/scene.ts`): `backdrop` (worlds only) → `opaque` (matter, then the world's solid things) → `glow` (the glow
pass: additive, never the opaque distance).

## The contracts (exact signatures in docs/reports/0-foundation.md)

- `MatterKind { id; declare(ctx: MatterCtx): MatterPasses | Promise<MatterPasses> }`, registered with
  `matterKinds.register`. `MatterPasses { id; declareView(scene); layout(layers); update(f); resize?(budget); acts?; stats? }`.
- `Loadout { layers: { kind, share, parts?, params? }[] }`, `BodyPart = 'torso'|'head'|'arms'|'hands'|'legs'|'feet'`.
  Optional on `MatterPasses`: `hear(ears)` (its voice), `carry(moves)` (a dancer through a gate; a move may carry
  `within`, a sphere: what was shed further off stays), `declarePost(post)` (translucent matter over the focused
  image), `focus(view)` (the depth contract, above), `body(view)` (a translucent body's rgba16float texture: r its
  distance, g how much shows through, ba its refraction; the air dims, tints and bends fire's glow behind it with it;
  water's is the only one; kind.ts). Every cull and draw of a dancer's particles binds the view's
  `seen`. Hearts: `heartsOf(kit)` / `hearts.wgsl` (`heartVeil`, `heartLight`, `heartDepth`) for matter round a gem heart.
- `World { id; light; mood; shared; stages; portals; spawns; fixtures; mirrorFloor; room; maxDist; fallY?; load;
  update; declareScene(scene); groundAt; exposure; tone; ambience; grade?; waterY?(); clear?(a, b); solids?;
  stageDim? }` (`solids`: capsules and boxes, `src/worlds/solids.ts`; every world but the Pool has them), registered as
  `worlds.register({ id, make(ctx) })`; `PortalDef { id, at, normal, radius, to, up? }`.
- `Controller { kind; rig; update(dt, ctx: FrameCtx, out: Skeleton); carry?(m) }`; `Dancer = skeleton + controller +
  loadout`, plus `form` (0 … 1, the one power form), `presence` (0 … 1, set by the show) and `world` (from the gates).
- `LandmarkPose { p: Float32Array(39); root; yaw; extra }`, `landmarksFromSkeleton`, `fitSkeleton`.
- `CameraRig` modes `free` (with `follow`, a third-person camera) / `locked` (`lock(plane | null)`); `carry(m)`.
  `StagePlane { id, origin, right, halfWidth, ground, ledges: Ledge[], spawns, ledgeY?, height?, lens?, yaw?, pitch? }`,
  `CameraRig.framePad` (the jogo stands back), `clearance` (gates and `World.clear`), `Dancer.framed` (false: the
  camera ignores it),
  `Ledge { id, x0, x1, y, solid?, thick?, bob? }`, `ledgeY`, `planeNormal`, `planePoint` (engine/camera.ts).
- `Field` (`deposit`, `vortex`, `probe`, `updraft`, `forms`, `presence`, `fuse({ dancers, kind, amount, strength,
  tightness })`, `fusionFront`) and `fieldWind / fieldHeat / fieldWet / fieldSteam / fieldDry` (matter/field/field.wgsl,
  group 3). Measured: a body's surface reads about ±0.6, 0.3 m out ±0.08, a metre out nothing; a kick's wake about
  3 m/s a metre behind.
- The jogo: `bend.jogo` (state, run, preset, setPartner, partner (`teach(brain, s)`, `direct(direction)`), events,
  history, stats); `bend.front.begin(mode, query, joined?)` on the plain page; a brain is `Brain.think(Sight)` →
  `Intent`, seated by a `BrainDriver` (docs/extending/brain.md), its `Sight.stage.solids` keeping a free pair off the
  world's solids; RULES.moves names every move that scores (with negativa, cocorinha, compasso, queda-de-rins, bow).
- `PostChain.stage = { dim, at }` (main.ts sets `dim` from the lock × `World.stageDim`), `PostChain.focusFrom(view, f)`
  (not used yet). The film tool: docs/extending/film.md (timelines, takes, filmcam; `set: { jogo: { rings: 0 } }`
  hides the floor rings).
- `Session` / `NetController` (src/net), `Portals` (`bend.gates`), `Music` (`bend.music`): see their guides.
- Hooks: `bend.loadout`, `bend.dress(d, preset)`, `bend.form(d, v)`, `bend.players/intent/move/place`, `bend.gates`.

## Rules (from docs/PLAN.md, "Principles")

1. Small modules with one job, joined by registries. A new matter kind or world is a folder with an `index.ts` that
   registers it; `main.ts` finds it by glob. (One exception, by necessity: a new world adds its include, its member
   of `WorldLight` and its cases to `src/worlds/light.wgsl`, because WGSL has no registry. Its TypeScript takes its
   light with `lightSlot(kit, 'name')` and touches nothing outside its folder.)
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
- Stay inside WebGPU's baseline (what many phones and laptops have exactly): per shader stage 12 uniform buffers,
  8 storage buffers, 16 sampled textures, 4 storage textures, 16 samplers; 4 bind groups; 64 KiB per uniform binding.
  `npm test` counts every stage (`scripts/check-bindings.mjs`, from weft's own reflection, without a GPU) and fails
  past any of them; `?baseline` runs the game with only the default limits. See "The binding budget" below.
- Bind group 0 is weft's (frame). Here: group 1 is a shader's own, group 2 the worlds' light (shared: one uniform,
  `worldLight: WorldLight`, with a slot per world and the dancers' fire, and the pool's and the temple's wave textures),
  group 3 the bodies and the field (shared, made by `Field`: joints, segs, bodies, touch, fieldA, fieldB, fieldBox).
  A shader gets a shared group by including the file that declares it, and then **all** of that group's bindings
  count in every stage of its pipeline (weft makes a shared group's layout visible to every stage), so a binding added
  to a shared group costs every shader that includes it.
- Reversed-Z, infinite far: clear depth to 0; `depthCompare` defaults to greater-equal.

## The binding budget (per shader stage, against the baseline)

What each stage's pipeline layout holds, counted as weft builds it: group 0 (2 uniforms, 4 samplers) in every stage;
a shared group whole in every stage of a pipeline that uses any of it; a shader's own bindings only in the stages
whose entry uses them. For a render shader the shared groups any of its entries uses are counted in all of them (an
upper bound: which vertex and fragment entries pair is the TypeScript's business). Per stage, vertex / fragment
(v/f) or compute (c), the most any entry of that stage uses; the baseline less that is what is left. Samplers are 4
of 16 everywhere (group 0's; no shader declares its own). The world light uniform is 3,824 of 65,536 bytes.
Regenerate with `node scripts/check-bindings.mjs --table` (one row per stage) after changing a binding.

| shader | stages | uniform buffers (of 12) | storage buffers (of 8) | sampled textures (of 16) | storage textures (of 4) | groups |
|---|---|---|---|---|---|---|
| matter/core/carry.wgsl | c | 3 | 2 | 0 | 0 | 0 1 |
| matter/field/debug.wgsl | v/f | 6 / 5 | 2 / 2 | 2 / 2 | 0 / 0 | 0 1 3 |
| matter/field/probe.wgsl | c | 6 | 3 | 2 | 0 | 0 1 3 |
| matter/field/step.wgsl | c | 6 | 2 | 2 | 2 | 0 1 3 |
| matter/fire/carry.wgsl | c | 3 | 2 | 0 | 0 | 0 1 |
| matter/fire/composite.wgsl | v/f | 2 / 3 | 0 / 0 | 0 / 3 | 0 / 0 | 0 1 |
| matter/fire/curl.wgsl | c | 6 | 4 | 2 | 0 | 0 1 3 |
| matter/fire/draw.wgsl | v/f | 4 / 3 | 2 / 0 | 0 / 0 | 0 / 0 | 0 1 |
| matter/fire/sim.wgsl | c | 7 | 5 | 2 | 0 | 0 1 3 |
| matter/fire/splat.wgsl | v/f | 6 / 3 | 2 / 0 | 0 / 1 | 0 / 0 | 0 1 |
| matter/gems/carry.wgsl | c | 3 | 2 | 0 | 0 | 0 1 |
| matter/gems/crystal.wgsl | v/f | 5 / 6 | 1 / 0 | 2 / 2 | 0 / 0 | 0 1 2 |
| matter/gems/cull.wgsl | c | 5 | 7 | 0 | 0 | 0 1 |
| matter/gems/draw.wgsl | v/f | 5 / 7 | 5 / 0 | 2 / 2 | 0 / 0 | 0 1 2 |
| matter/gems/halo.wgsl | v/f | 5 / 2 | 0 / 0 | 0 / 0 | 0 / 0 | 0 1 |
| matter/gems/sim.wgsl | c | 8 | 7 | 2 | 0 | 0 1 3 |
| matter/gems/sparks_draw.wgsl | v/f | 3 / 2 | 1 / 0 | 0 / 0 | 0 / 0 | 0 1 |
| matter/gems/sparks_sim.wgsl | c | 3 | 1 | 0 | 0 | 0 1 |
| matter/gems/streaks.wgsl | v/f | 6 / 2 | 3 / 0 | 0 / 0 | 0 / 0 | 0 1 |
| matter/ice/mist_draw.wgsl | v/f | 3 / 2 | 1 / 0 | 0 / 0 | 0 / 0 | 0 1 |
| matter/ice/mist_sim.wgsl | c | 6 | 5 | 2 | 0 | 0 1 3 |
| matter/ice/shards.wgsl | v/f | 6 / 4 | 4 / 0 | 2 / 2 | 0 / 0 | 0 1 2 |
| matter/plasma/arcs.wgsl | v/f | 3 / 3 | 1 / 0 | 0 / 0 | 0 / 0 | 0 1 |
| matter/reactions/steam_comp.wgsl | v/f | 2 / 3 | 0 / 0 | 0 / 1 | 0 / 0 | 0 1 |
| matter/reactions/steam_draw.wgsl | v/f | 7 / 7 | 3 / 2 | 4 / 5 | 0 / 0 | 0 1 2 3 |
| matter/reactions/steam_front.wgsl | v/f | 3 / 2 | 1 / 0 | 0 / 1 | 0 / 0 | 0 1 |
| matter/reactions/steam_sim.wgsl | c | 6 | 3 | 2 | 0 | 0 1 3 |
| matter/water/drops.wgsl | v/f | 6 / 3 | 3 / 0 | 2 / 2 | 0 / 0 | 0 1 2 |
| matter/water/sim.wgsl | c | 6 | 5 | 2 | 0 | 0 1 3 |
| matter/water/smooth.wgsl | v/f | 2 / 3 | 0 / 0 | 0 / 3 | 0 / 0 | 0 1 |
| matter/water/splat.wgsl | v/f | 5 / 2 | 4 / 0 | 0 / 0 | 0 / 0 | 0 1 |
| matter/water/surface.wgsl | v/f | 6 / 9 | 2 / 2 | 4 / 7 | 0 / 0 | 0 1 2 3 |
| play/glow.wgsl | v/f | 3 / 2 | 1 / 0 | 0 / 0 | 0 / 0 | 0 1 |
| portals/surface.wgsl | v/f | 3 / 3 | 0 / 0 | 4 / 4 | 0 / 0 | 0 1 |
| post/air.wgsl | v/f | 3 / 4 | 0 / 0 | 2 / 9 | 0 / 0 | 0 1 2 |
| post/post.wgsl | v/f | 2 / 3 | 0 / 0 | 0 / 3 | 0 / 0 | 0 1 |
| post/yuv.wgsl | c | 3 | 1 | 1 | 0 | 0 1 |
| worlds/redwoods/grass.wgsl | v/f | 6 / 6 | 2 / 2 | 4 / 4 | 0 / 0 | 0 2 3 |
| worlds/redwoods/trunks.wgsl | v/f | 3 / 3 | 1 / 0 | 3 / 4 | 0 / 0 | 0 1 2 |
| worlds/redwoods/woods.wgsl | v/f | 3 / 3 | 0 / 0 | 2 / 3 | 0 / 0 | 0 1 2 |
| worlds/water/ripples.wgsl | c | 6 | 2 | 3 | 1 | 0 1 3 |
| every other world draw (backdrops, motes, shelves, crystals, embers, slabs, stones, ferns, flowers, lanterns, pollen) | v/f | 3 / 3 | ≤ 1 / 0 | 2 / 2 | 0 / 0 | 0 (1) 2 |

The tight ones now: **storage buffers** in the gems' sim and cull (7 of 8: one more storage buffer in either needs
packing first); **uniform buffers** in the water surface's fragment stage (9 of 12: the bodies' group for the bone
frames and the hearts) and the gems' sim (8); **sampled textures** in the air's fragment stage (9 of 16: the scene,
the glow, three focus slots, the body texture, the opaque and surfaced copies, the world light's). The world light costs a lit shader 1
uniform and 2 sampled textures however many worlds there are.

## Capture a still, read timings

```bash
npm run dev                                                   # in one terminal (port 5391)
node scripts/critic-cap.mjs scripts/steps/integ-5.json --only pair-pool-close --prefix 5 --fps 10   # a timeline take
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
- World light is a WGSL `override WORLD` switch in `worlds/light.wgsl` over a shared group whose one uniform has a
  slot per world (and the dancers' fire); a kind declares one draw per world.
- `Controller.update(dt, ctx, out: Skeleton)` writes positions and rotations; the Dancer commits (velocities, GPU layout).
- Landmarks follow the prototype's order and frame (x across, y up, z forward, yaw), but "left" is the dancer's own
  left (+x when facing +z). The prototype puts L at -x: mirror (negate x) when porting its poses.
