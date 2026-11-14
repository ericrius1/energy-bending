# Energy Bending: master plan

The plan of record. Every agent reads this first. If the code and this file disagree, fix whichever is
wrong and say so in your report.

## What we are making

A place you dance in, with someone else, where bodies are made of matter that answers the music.

- **Dancers are skeletons wearing matter.** A body can be gems (one kind or many), fire, water, ice,
  plasma, or any mix: a gem heart inside a body of flame, ice limbs on a water torso.
- **Two dancers play a jogo**, in the spirit of capoeira: part dance, part sparring, nobody hurt. A kick
  that almost lands and the dodge that slips under it are one move made by two people. Exchanges build a
  shared tension; at the top the two **fuse**: their matter flows together into a new element for eight
  bars while the music drops, then they part. Duality, unity, and back.
- **It is a real 3D world**, and it can **lock into a 2D side view** (a stage with ledges, Smash-like)
  for a jogo, then free up again.
- **Worlds are joined by portals** you can see through, live, and walk through in any direction.
- **You build as you dance.** Moves on the beat leave matter behind that sets: ice bridges, gem spires,
  ledges you can stand on.
- **Everything is on the music's clock**: moves, matter, the world's light, the other player.
- **Anyone can dance**: camera body, gamepad, keyboard and mouse, touch. Other dancers can be a person
  over the network, motion capture, or an AI partner.

No health, no winner, no text on screen beyond controls and meters.

## Where it comes from

| Source | What we take |
|---|---|
| **Gem Dancers** (`C:\Users\ericr\codeprojects\weft-migration\GemDancers`) | The engine base. Bodies as GPU particles sprung to homes on skeleton capsules (`body.ts`, `sim.wgsl`), GPU LOD cull and indirect draws, the specimens, CMU mocap and its format, webcam retargeting (`pose.ts`), motion matching (`play/moves.ts`, `play/mover.ts`), the redwoods and the geode, the post chain, the score that rings when stones land, deterministic capture and film scripts. |
| **weft** (`@ericrius1/weft`, MIT, source at `C:\Users\ericr\codeprojects\weft`) | The WebGPU kit: explicit pass list, WGSL as the single definition of data, typed shader imports. Read its `AGENTS.md` before touching rendering. Do not fork engine code; note engine asks in `docs/engine-asks.md`. |
| **Drake** (`C:\Users\ericr\codeprojects\drake`) | The portal as one rigid transform applied to everything, the camera-reaches-face trigger, traveller clipping at the door plane, gamepad mapping, probe and film habits. We go further: the destination is rendered live. |
| **Dance First** (the 2D prototype, `sketches/dance-first-2d/` once copied in) | The jogo rules and server, netcode with a jitter buffer, the generative music engine with a shared clock, the move vocabulary and input layer, and the *looks* of fire, water, ice, plasma and steam (`docs/element-looks.md`). |

## Principles (this is open source: the code is part of the work)

1. **Small modules with one job, joined by registries.** Adding a matter kind, a world, a move, a
   controller or a brain means adding a folder and one `register` call. No edits to `main.ts`.
2. **`main.ts` stays thin**: boot, assemble the frame from what is registered, loop.
3. **WGSL is the single source of data layouts.** No hand-copied offsets.
4. **No hidden globals.** Tunables live in typed, documented parameter objects per module. Hard caps are
   named constants in one place (`src/engine/limits.ts`) with the reason beside them.
5. **Every file opens with a short plain paragraph**: what it is, how it fits. Comments explain why.
6. **Deterministic when stepped.** `window.bend` can step frames at a fixed dt so captures and tests
   repeat.
7. **Verify by running.** Headless stills and probes for looks and cost; Node tests for pure logic.
   Reports say what was measured and what was not.
8. **It must run on a good laptop and a recent phone**, by scaling counts and resolution, never by a
   separate code path.

## Architecture

```
energybending/
  AGENTS.md  README.md  LICENSE  index.html  vite.config.ts  package.json
  docs/           PLAN.md, element-looks.md, extending/*.md, engine-asks.md, reports/
  shared/         rules.ts (the jogo; runs on server and client), protocol.ts (message types)
  server/         the room server (Node, ws) and its tests
  scripts/        shot.mjs (stills + timings), film.mjs, mocap.mjs, specimens.py
  public/         motion/, specimens/, worlds/<id>/
  sketches/       dance-first-2d/ (the prototype, kept as a study)
  src/
    main.ts
    engine/       kit setup, frame assembly, limits, registry, camera rig (free / locked), hooks (window.bend)
    skeleton/     the 38-joint rig, FK, clips, retargeting from landmarks, motion matching
    dancer/       Dancer = skeleton + controller + loadout; body physics; controllers
    matter/       the body-as-particles core and one folder per kind
      core/       layout of homes over capsules, shared joint/segment buffers, MatterKind, loadouts
      field/      a small 3D grid around the dancers: wind, heat, wet (kinds deposit and sample)
      gems/  fire/  water/  ice/  plasma/
      reactions/  steam, melting, freezing, quenching, fusion flows
    worlds/       World interface, registry, and one folder per world
    portals/      live gates between worlds
    play/         the jogo on the client: exchanges, tension, fusion, building, HUD and menus
    input/        one Intent per player from keyboard, gamepad, touch, camera
    ai/           brains: partner and NPC dancers
    net/          Net / LocalNet
    audio/        the music engine, the score, the offline recorder
    post/         air, depth of field, trails, bloom, grade
```

### The contracts (finalised by the foundation agent in code; this is the intent)

```ts
// a body of matter
interface MatterKind {
  id: string;                                  // 'gems' | 'fire' | 'water' | 'ice' | 'plasma' | ...
  declare(ctx: MatterCtx): MatterPasses;       // its buffers, compute steps and draws, built once
  resize?(budget: Budget): void;               // particle counts follow the device budget
}
// what a dancer wears: which kinds, how much of each, on which parts of the body
interface Loadout { layers: { kind: string; share: number; parts?: BodyPart[]; params?: object }[] }

// who moves a skeleton
interface Controller { update(dt: number, ctx: FrameCtx, out: Skeleton): void }
// MocapController, CameraController (webcam), IntentController (player/NPC through body physics and moves),
// NetController (the remote player), and brains wrap an IntentController.

interface World {
  id: string; mood: number;
  load(ctx): Promise<void>;
  update(dt, ctx): void;
  declareScene(scene: Pass, view: ViewCtx): void;   // callable once per view (main, and a portal's view)
  groundAt(x: number, z: number): number;
  stages: StagePlane[];                              // places the view can lock to: origin, right, ledges
  portals: PortalDef[];
  spawns: Vec3[];
}
```

- **Shading that depends on the world** (environment light, fog) is selected with WGSL `override`
  constants per pipeline, never with runtime `if (forest.on)` branches threaded through shared shaders.
- **The scene is declared per view**, so a portal can draw its destination with the same code.
- **The matter field** is a coarse 3D grid that follows the dancers (of the main view's world). It lays itself down
  from the bodies' auras (what each part wears, at the dancer's form and presence); the CPU can deposit into it; kinds
  sample it: `fieldWind(p)`, `fieldHeat(p)`, `fieldWet(p)`. Limbs stir the wind, so flame and spray trail a kick.
  Heat and wet are how elements react: water in heat becomes steam, flame in wet dies to smoke, ice near
  heat melts to water, water in cold (near ice) freezes.

### Skeletons and motion

- The rig is Gem Dancers' 38-joint CMU skeleton. Clips are its packed mocap.
- A second, lighter description is **13 landmarks in 3D** (head, shoulders, elbows, wrists, hips, knees,
  ankles). Procedural moves, camera tracking and the network all speak landmarks; one retargeter
  (generalised from Gem Dancers' `pose.ts`) fits the full rig to them. Mocap goes the other way when a
  clip is sent over the network.
- Moves are either functions of time or sampled clips, behind one interface, so capoeira mocap can
  replace a procedural move later without touching anything else.

### The 2D lock

A `StagePlane` is a vertical plane in a world with ledges defined in its own 2D coordinates. Locking
eases the camera to face the plane (long lens, near-orthographic), constrains both dancers to it and
turns ledge collision on. Unlocking hands the camera back. Nothing else changes: same bodies, same
matter, same rules.

### Portals

A gate pairs two frames in two worlds. While a gate is in view, the destination world is drawn from the
transformed camera into a reduced-resolution texture and shown in the gate's disc with a rippling
surface. Crossing applies one rigid transform (full rotation) to the dancer, the camera and their matter;
the traveller is clipped at the door plane. Gates work both ways. The other player on the far side is
visible through the gate. Online, a `travel` message moves the room.

### Building

Matter that lands on a beat in the right mode **sets**: it keeps its place and becomes part of the world
(an ice trail under a cartwheel becomes a bridge; gems shed at the top of a jump become a spire). Set
matter can be stood on in the locked view (it adds ledges) and is melted or shattered by the elements.
It is shared state: the server holds a compact list of set pieces per world.

### Network and rules

As built for the prototype (see `sketches/dance-first-2d/DESIGN.md`): each client owns its own dancer;
poses are landmarks at 20 Hz through a jitter buffer; moves are deterministic from their start event;
the dancer being attacked reports the exchange; the server owns flow, tension, streak, axé, forms,
fusion, phases and the music clock.

## Waves

**Wave 0, foundation (one agent).** Create this repo from Gem Dancers, restructured into the
architecture above with everything it does today still working: gems on mocap dancers, the geode and the
redwoods as two worlds, webcam, post, score, stepping hooks, stills and film scripts working on Windows.
Write `AGENTS.md` and the first `docs/extending/` guides.

**Wave 1 (in parallel, one folder each).**

| Agent | Folder | Makes |
|---|---|---|
| fire + plasma | `src/matter/fire`, `plasma` | flame and plasma bodies, arcs |
| water + ice | `src/matter/water`, `ice` | fluid bodies with a screen-space surface, freezing and melting, set ice |
| field + reactions | `src/matter/field`, `reactions` | the wind/heat/wet grid, steam, quench, fusion flows |
| worlds | `src/worlds/*` | the void pool, tide temple (and the sky forge, retired 14 Nov 2026); stage planes; world light on matter |
| portals | `src/portals` | live gates |
| dancers | `src/dancer`, `src/input`, `src/skeleton/retarget` | body physics in 3D, the move library, all input devices, the locked/free camera rig |
| net | `src/net`, `shared`, `server` | the prototype's server and netcode, in TypeScript, on landmarks |
| audio | `src/audio` | the music engine joined with the stone score and the offline recorder |
| brains | `src/ai` | the partner and NPC dancers on motion matching and the move library |

Wave 1 is built and merged into `master`, its seams joined (`docs/reports/2-integration.md`: what joins what, what was
verified, the open items).

**Wave 2 (one agent, then helpers).** `src/play`: the jogo end to end, fusion, building, HUD, menus,
same-screen and online. Built (`docs/reports/3-jogo.md`), with the brains (`src/ai`, `3-brains.md`).

**Then the loop.** Render stills and a short film; a critic agent watches and writes the next plan;
agents execute; repeat until it is beautiful. The first turn of the loop is done: the critic's look and plan
(`docs/reports/3-critique.md`), its ten tasks built in parallel (`4-*.md`: fire as a field, water and ice, the depth
contract and the lens, cameras through gates, steam fronts, the five worlds, gems and hearts, the device budget) and
merged with the jogo and the brains (`docs/reports/5-integration.md`). The second turn is done too: the second
critic (`6-critique.md`: the fusion, water, white-out), the film tool (`6-film-tool.md`), its seven tasks (`7-*.md`)
and their integration (`docs/reports/8-integration.md`). The third turn is done: six tasks from that report's list
(`9-*.md`: the fusion as one body and the moves at film distance, the field's heat by source and the violet bars, the
near fade and the gates' depth of field, the temple's lock, the stage dim and the forge, the films' tooling and both
timelines, water against the fog and its rise) and their integration (`docs/reports/9-integration.md`, which lists
what is left). Next: the music from Suno (in progress), the two films rendered at master quality, the deploy (the
code on GitHub, the room server on Railway, the site at ericlevin.dev/energybending), and a place in the portfolio.

**14 Nov 2026: the Sky Forge retired.** Eric: this is a chill, good-vibes thing, so no lava; worlds stay with nature,
healing and awe. Four worlds remain (the geode, the hub; the redwoods; the pool; the tide temple), the hub has three
gates (the redwoods' now straight out in front of the stage), and the forge's world, track and duel arena are gone;
the reports and the films made in it (films/duel-1.json, duel-p1.json) stay as records.

## Shared habits

- The RTX 5090 on this PC is shared with other agents. Only **heavy renders** take the render lock (a master film,
  long full-resolution work): never two of those at once. `mkdir /c/Users/ericr/render-lock` (retry while it exists),
  remove it when done, always (`trap`); `scripts/film.mjs` without `--preview` does this itself. Test captures,
  stills, timings and previews don't take it: agents run them alongside each other (`takeLock()` in
  scripts/lib/browser.mjs skips them; `RENDER_LOCK_ALL=1` makes every capture take it again).
- Each agent leaves a report in `docs/reports/<wave>-<name>.md`: what was built, what was measured,
  honest weak points, what was not done.
- Do not commit other agents' folders. Do not push. Do not deploy.
