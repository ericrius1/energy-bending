# Wave 1: worlds

Three new worlds (the Pool, the Tide Temple, the Sky Forge) and stage planes with ledges in all five, the ledges built
from the same description as the geometry the eye sees. World light for matter in each new world (cases 2, 3, 4 of
`src/worlds/light.wgsl`). Water shared by the pool and the temple: a GPU ripple field that the dancers' feet stir by
themselves, and the surface laid over the scene in the air pass with screen-space reflections bent by it. Portal sites
in every world (the geode the hub). Branch: `worktree-agent-af179ef6e36ee6daf`.

Measured: typecheck, build and `npm test` clean; stills of every world (empty wide, empty locked, mid-dance, the
special states) looked at one by one over four rounds; GPU timings per pass for all five worlds in one session;
an 8 s film of each new world (the `short` cut, 480 frames each, score muxed) with contact sheets. Not measured: a phone (`coarse` paths written, never run), the portals agent's drawing of the gates
at my sites, the body physics on the ledges (another agent's), a long soak.

## The worlds

### The Pool (`src/worlds/pool`, light 2)

The prototype's void made real: an endless sheet of shallow water over a black floor, a dark blue sky, a thin rose-gold
glow on the horizon (brightest behind the stage), a few stars and a faint river of them. Nothing else, so the dancers
and their matter are the light, and the water doubles them.

- **Drawn**: one fullscreen backdrop (sky; below the horizon the black floor, alpha the distance to the surface). The
  surface is laid over the finished scene in the air pass (`poolScene`): for a pixel whose scene point is under the
  water's level, the surface point and its normal (ripples + a breath of wind that fades to a calm mirror far off), the
  reflected ray marched through the scene on screen (22 steps + 4 halvings, `water/water.wgsl waterReflect`), the sky
  where it finds nothing, Fresnel lifted toward a mirror (`pool.mirror`), the floor under it bent by the slope.
- **Ripples** (`water/ripples.ts` + `ripples.wgsl`): a damped wave equation, 320² texels at 5 cm (16 m square;
  coarse 192² at 8 cm) in a window that follows the dancers in whole texels; two steps a frame, each reading one
  rgba16float texture and writing the other. The first step reads the shared body joints (ankles, toes, hands) and
  pushes the water where they move near it, so every dancer stirs it with nobody calling anything; plus up to 16 drops a
  frame from `ripple(x, z, strength, radius)`. The field is a texture in the shared light group (`poolWaves`).
- **Light on matter**: a faint cool light from above, the horizon glow as a strong rim from behind, ambient from the sky
  and its reflection; env = the sky above and the sky mirrored below.
- **Cost**: scene 0.18 ms (the backdrop; matter is most of it), air 0.04 ms (the surface, its march), ripples 0.009 ms (both steps): frame 0.36 ms against the redwoods' 1.37.

### The Tide Temple (`src/worlds/temple`, light 3)

A drowned stone court at dusk: the sun gone down behind the audience (a warm afterglow on that side), a large moon low
behind the stage in a great gate, laying a glitter path over the water and the pillars' shadows long over the floor. Two
broken fluted pillars, a carved altar (glyph panels, a meander band), a lintel on two columns just behind the stage, the
gate, broken colonnades down both sides with fallen drums, ruined walls in the back corners, steps down into the sea in
front, the sea bed beyond the court.

- **Drawn**: the backdrop (sky with moon, clouds and stars; worn flagstones each a little proud or sunk, with joints,
  cracks and a carved ring; the sea bed past the court), 80 stones (`stones.wgsl`, from the vertex index: blocks as
  faces in a 4×4 grid, drums as rings from foot to top, a broken top pushed down by the same noise on every face so it
  stays closed; carving cut into the light, not the mesh). Moon shadows from the 24 nearest standing drums tested
  analytically per pixel (as the redwoods test trunks; no shadow map). Under the tide everything is dimmed and tinted by
  the depth it is seen through and netted by moving caustics (`templeUnder`); the surface itself is the pool's water
  code (`templeScene`) with its own ripple field (288² at 5.5 cm).
- **Tide**: `tideY(beat)` (temple/temple.ts): from 0.4 cm below the floor (the low flagstones hold puddles) to 0.45 m
  (the shins) and back over 8 bars of `FrameCtx.beat`. `temple.tideHold` pins it for stills.
- **Firelight**: `dancerLight(d, rgb | null)` on the Temple (and the Forge) gives a dancer a light at its chest that
  warms the stone (`templeFire`); `temple.firelight` / `temple.fireCol` light every dancer for stills. Matter takes only
  a quarter of it, so a fire dancer doesn't light its own body.
- **Light on matter**: the moon as key (with the pillars' shadows), the moon as rim, the dusk sky and the water's light
  as ambient; env = the dusk sky with the moon above, the sea mirroring it below.
- **Cost**: scene 0.37 ms (backdrop + 80 stones + matter), air 0.04 ms, ripples 0.008 ms: frame 0.58 ms.

### The Sky Forge (`src/worlds/forge`, light 4)

Slabs of basalt floating in an open night sky over a sea of cloud lit through from beneath by a deep orange fire; an
aurora in curtains overhead; islands of the same basalt drifting far off; embers rising past.

- **Drawn**: the backdrop (stars, the aurora in the sky's own angles, a band of glow at the horizon, the billowing cloud
  sea 70 m down, lit through where thin), 1,754 hexagonal columns (`slabs.wgsl`, 108 vertices each from the vertex
  index: a bevelled flat top, six sides, a broken tip): 143 for the stage's four slabs, the rest for 22 islands (10 on
  coarse); 900 embers (glow, 400 coarse). Lit from below by the fire (the undersides glow), from above by the aurora;
  molten light in some seams and cross-joints, deeper down, and at some tips; a honeycomb of hot seams on the anvil's top.
- **Bob**: the floats and the crown ride `ledgeY(ledge, beat)` (worlds/stage.ts: `bob × sin(beat × π/2)`, once a bar);
  each frame the forge uploads every stage slab's lift from that function, so physics and drawing read the same number.
  `forge.bobHold` pins a beat for stills.
- **Heat**: `forgeScene` bends what is far (scene distance > 14 m) by a rising noise, more looking down; nothing near
  smears over the far.
- **No ground**: `groundAt` returns the top of the stage slab under (x, z) (the bobbing ones where they are now), or
  -12 m where the game should catch a fall. The stage's `ground` is null.
- **Cost**: scene 0.37 ms (backdrop, 1,754 columns, embers, matter), air 0.01 ms: frame 0.53 ms.

### Stages in the geode and the redwoods

- **The geode**: three rafts of selenite prisms grown out of the wall (like the beams of Naica), their tops flush and
  flat: a low one from the left wall and a middling one from the right running along the plane to their tips, and a high
  one from the back wall reaching out over the middle; smaller points round their roots (`geode/shelves.ts`,
  `shelves.wgsl`; 22 prisms, faceted, a satin sheen across the fibres, the cave's glow inside). The plane stays through
  the middle, where the dancers are. `geode.shelves` turns them off.
- **The redwoods**: a plane through the clearing aimed at the biggest tree of the ring; a fallen giant (r 0.85 m,
  settled into the ground, a broken red end, a torn root plate with root stubs) lying along it on the left, and two
  boughs from that tree reaching in along it, a low one and a higher one that runs on over the middle
  (`redwoods/stage.ts`: chains of tapered capsules, drawn by a new entry `vs_stage` in `trunks.wgsl` with the trunks'
  bark, moss and fragment shading; a broken end shows heartwood and rings, the root plate's face earth). Plants keep off
  the log (`offLog` in `forest.wgsl`, used by `clearOfTrunks`) and the ground darkens along it.
- Both worlds otherwise draw and light exactly as before; the props are always there (scenery, not lock-only).

## Stage planes and ledges (plane x along `right` from `origin`, y up, m)

| world | origin, right | ground | ledges (id: x0 … x1 at y; solid; bob) | spawns |
|---|---|---|---|---|
| pool | (0,0,0), +x | 0 | none (the pure stage) | (-2.45, 0), (2.45, 0) |
| temple | (0,0,-3.2), +x | 0 | pillarL -4.7…-3.7 @1.9 solid; altar -1.2…1.2 @1.1 solid; pillarR 3.8…4.8 @1.9 solid; lintel 0.35…3.85 @3.1 | on the pillars: (-4.2, 1.9), (4.3, 1.9) |
| forge | (0,0,0), +x | null | anvil -3.81…3.81 @0 solid; floatL -5.61…-3.89 @1.75 bob 0.18; floatR 3.89…5.61 @1.75 bob 0.18; crown -1.08…1.08 @3.1 bob 0.28 | (-2.3, 0), (2.3, 0) |
| geode | (0,0,0), +x | 0 | shelfL -5.75…-3.55 @1.1 solid; shelfR 3.5…5.75 @1.9; shelfC -1.1…1.1 @3.1 | (-2.45, 0), (2.45, 0) |
| redwoods | (0,0,0), (0.996, 0, 0.088) | 0 | log -8.5…-2.3 @1.1 solid; bough 2.6…5.4 @1.9; high -1.3…1.2 @3.1 | (-1.2, 0), (1.2, 0) |

All stages are 11.5 m wide (`halfWidth` 5.75). `thick` is set on every ledge (how deep it is under its top). The temple's
plane is 3.2 m behind the middle of the court so the dancers of today's show (who dance at the middle) are clear of
the altar; every other plane goes through the middle.

## APIs for the game

- `ledgeY(ledge, beat)` (`src/worlds/stage.ts`): a ledge's top at a beat; `bob` m once a bar.
- `tideY(beat)` (`src/worlds/temple/temple.ts`): the temple's water level over its floor; `Temple.tide` is the last one
  drawn.
- `World.ripple?(x, z, strength, radius)` (pool, temple): a push on the water (strength ~1 a hard landing, radius m).
  Feet and hands already stir it through the shared joints.
- `Temple.dancerLight(d, rgb | null)`, `Forge.dancerLight(d, rgb | null)`: a dancer's own light on the world.
- `stagePlane(def)`, `onPlane(plane, x, y)`, `toPlane(plane, world)`, `spawnsOf(plane)` (`src/worlds/stage.ts`).
- `groundAt(x, z)` in every world: the floor, or the top of the solid ledge you'd stand on there (the altar, a stump,
  the fallen log, a forge slab), or -12 m under the forge.
- Params for stills and tuning: `temple.tideHold`, `forge.bobHold`, `temple.firelight`, `forge.firelight`,
  `geode.shelves`, and each world's colours and amounts (`bend.params.pool|temple|forge`).

## Portal sites (`World.portals`; drawn by src/portals)

| id | at | faces | to |
|---|---|---|---|
| geode.pool | (-6.0, 1.35, 3.0) | the middle | pool.geode |
| geode.temple | (6.0, 1.35, 3.0) | the middle | temple.geode |
| geode.forge | (-2.9, 1.35, 6.0) | the middle | forge.geode |
| geode.redwoods | (2.9, 1.35, 6.0) | the middle | redwoods.geode |
| pool.geode | (-7.5, 1.35, 4.5) | (0.83, 0, -0.55) | geode.pool |
| temple.geode | (-7.6, 1.4, 5.4) | (0.8, 0, -0.6) | geode.temple |
| forge.geode | (-5.7, 1.35, -3.5), on the anvil's lobe | (0.7, 0, 0.71) | geode.forge |
| redwoods.geode | (-6.5, 1.35, -5.5), in the meadow behind the stage's left end | (0.76, 0, 0.65) | geode.redwoods |

Radius 1.25–1.3 m, centre 1.35–1.4 m up (a disc a dancer walks through). The geode's four stand on the floor between
the shelves and the wall, in front of the stage; each other world's is off the stage's ends, on flat ground (the
forge's on a lobe of the anvil, behind the left float).

## Stills (docs/reports/media/, 1280×800, bend.grab)

| file (`worlds-*.jpg`) | what it shows | anything wrong |
|---|---|---|
| `pool-empty` | the empty pool from a free camera: black water to the horizon, the rose-gold line, stars, faint rings where the sleeping dancers' joints stir it | the rings at the heap are the asleep dancers' joints, not intended |
| `pool-empty-lock` | the locked view, empty: the horizon doubled in the mirror, rings running out | |
| `pool-dance` | gem dancers mid-dance, locked: their reflections under them, rings from their feet catching the glow | stones that rain in sparkle in the air |
| `pool-ripples` | the director's low "feet" shot: reflections bent by the rings round the feet | |
| `temple-empty` | the court from the front at a middling tide: the gate and the moon, colonnades, the altar, reflections | |
| `temple-empty-lock` | the locked view, empty: the altar's glyphs and meander, the moon behind the gate's columns | the gate's columns fill the frame's sides (long lens) |
| `temple-tide-low` | low tide: dry flagstones with puddles, the pillars' long moon shadows, the carved ring | |
| `temple-tide-high` | the same camera at high tide: the court drowned to the shins, reflections and rings, the floor seen through | |
| `temple-dance` | gem dancers mid-dance in the water, each carrying a warm light (`firelight` 1.5) that warms the altar's carving | the dancers stand in front of the altar, not on the stage plane (today's show) |
| `forge-empty` | the forge from a free camera: the anvil, floats, crown, islands, the cloud sea lit from below, the aurora's edge | islands read as clumps of columns |
| `forge-bob-up` / `forge-bob-down` | the same camera at beat 1 and beat 3: the floats and the crown up and down (0.18 and 0.28 m) | the difference is small at this distance, as it should be |
| `forge-dance` | gem dancers on the anvil, locked: hot seams under their feet, the aurora, an island, the crown's tips above | the crown is cut by the frame's top (framing follows the dancers) |
| `redwoods-stage` | the redwoods' stage square on (free camera): the fallen log, the low bough, the high one, the tree they grow from | the boughs' joints show as gentle kinks |
| `redwoods-lock` | locked, a dancer mid-dance with the log's broken end in the foreground | the lock frames the dancer, so the boughs are mostly out of frame |
| `geode-stage` | the geode's stage square on: the high raft of selenite with the caustics on it, the two side shelves | the shelves' roots vanish into the dark wall |
| `geode-lock` | locked, the dancers under the high shelf in the shaft of light | |

Films (`shots/film-<world>/energybending.mp4`, 8 s each at 1280×720, the `short` cut, score muxed; git-ignored like the foundation's). Contact sheets (2 s apart) committed: `worlds-film-pool-contact.jpg` (the heap rising, the dancers and their reflections, a shatter over the mirror), `worlds-film-temple-contact.jpg` (the heap on wet flagstones, the tide coming in round the dancers, the shatter in the water), `worlds-film-forge-contact.jpg` (the anvil's hot seams, the dancers against the glow and the islands; seen from above, the anvil's tops take a green sheen from the aurora that is too strong).

## GPU timings (RTX 5090, 1280×800, render scale 1, 15,000 stones, two dancers mid-dance, one session)

weft's profiler over 150 frames stepped at 60 fps after 700 frames of dancing, all in one browser session (the temple's
and the redwoods' re-measured after the last fix, same steps). ms per pass; "frame" is the first pass's start to the
last pass's end. The geode and the redwoods are unchanged worlds plus their stages.

| world | frame | scene | air | ripples (2 steps) | everything else (sim, cull, post) |
|---|---|---|---|---|---|
| pool | 0.358 | 0.176 | 0.038 | 0.008 | 0.14 |
| temple | 0.575 | 0.373 | 0.042 | 0.008 | 0.15 |
| forge | 0.528 | 0.367 | 0.009 | – | 0.15 |
| geode (+ shelves) | 0.508 | 0.207 | 0.170 | – | 0.13 |
| redwoods (+ log, boughs) | 1.357 | 0.873 | 0.349 | – | 0.14 |

The foundation measured the geode's scene at 0.21–0.22 ms and the redwoods' at 0.93–0.97 ms (`docs/reports/0-foundation.md`):
the shelves and the stage logs are within noise. Each new world's scene + air is under half the redwoods'.

## Edits outside my folders

- `src/engine/camera.ts`: the `StagePlane` type gains `ground`, `spawns` and typed `Ledge`s (`{ id, x0, x1, y, solid?,
  thick?, bob? }`, exported); nothing else in the rig changed.
- `src/main.ts`: `frame` added to the `WorldCtx` (one word), so a world can add compute steps (the ripples).
- `src/post/air.wgsl`: the scene is read through `worldScene(src, px, ray)` instead of `textureLoad(src, px, 0)` (one
  line; identical for the geode and the redwoods).
- Generated typings that follow `light.wgsl`'s new bindings and structs: `src/matter/gems/draw.d.wgsl.ts`,
  `src/post/air.d.wgsl.ts` (and the worlds' own). Other kinds that include `light.wgsl` will regenerate theirs.
- `docs/extending/world.md` rewritten for five worlds, `worldScene`, stages, ledges, portals.
- `scripts/steps/worlds.json` (the stills and timings), `scripts/steps/worlds-temple-redwoods.json` (their re-take after the last fix), `scripts/steps/worlds-probe.json` (the probe rounds).
- `docs/reports/media/worlds-*.jpg` (the stills and film contact sheets) and this report.

## Honest weak points

- **Reflections are screen space.** What isn't on screen isn't reflected (a dancer cut off at the frame's top loses the
  top of its reflection; the underside of a ledge never shows). The march is 22 steps (12 on coarse) with halvings; thin
  sparse matter can let a ray slip between stones (a speckled reflection). Where it finds nothing the sky is used,
  which is right for open water and wrong under a lintel.
- **The pool's ripples need movement near the water.** Asleep dancers' joints near the floor stir faint rings at the
  heap; gems landing don't ripple it unless something calls `ripple()` (the gems kind can't be edited from here; the
  hook is there for the game and the kinds).
- **The temple reads as a set, not yet as a place painted.** The stone is procedural noise and pits on simple blocks
  and drums; carving is in the light only (silhouettes stay straight); flutes are a normal trick on a 48-sided drum.
  At a distance it is handsome (moon in the gate, the glitter path, long shadows); close up the glyph panels look
  clip-art. Lying drums' ends still catch too much moon at some angles.
- **The forge's islands are voxel-ish** (hexagonal columns of one size stepping round a dome): from far they read as
  clumps of columns, not as the rock masses a painter would make. The aurora is in the sky's angles, so it doesn't
  parallax. The cloud sea is a single noise layer.
- **The forge's anvil tops** reflect the aurora: from a high camera (the film) the whole top goes green-tinted; it wants a rougher, darker top.
- **The geode's shelves** are clean prisms with a satin noise; they read as crystal from the front, as slabs from the
  side. The wall behind them is the gems' dome of crystals, which is dark: their roots look like they come out of
  darkness rather than out of a wall.
- **The redwoods' boughs** are chains of straight capsules: from below the joints show as gentle kinks; no foliage on
  them.
- **Locked views in the current show**: the camera frames the dancers' joints, and today's show dances in the middle, so
  a locked still shows the dancers big with a ledge or two behind them, not the whole stage. The `*-stage` stills are a
  free camera square on to the plane to show the stage itself.
- **Stages offset**: the temple's plane sits 3.2 m behind the court's middle (so today's dancers miss the altar). When
  the game puts dancers on the plane that is irrelevant; if it starts them at `World.spawns` they're on the pillars.
- **Timings are tiny on a 5090** and run-to-run noise is several percent; they say each new world is well under the
  redwoods, not by how much on a phone.

## Not done

- No phone run: the `coarse` sizes (ripple grids, march steps, fewer stones, islands and embers) are written, not
  measured.
- No body physics on the ledges (another agent's); the ledge data and `ledgeY`/`tideY` were checked against the
  drawing only by eye in the stills and by printing the layouts.
- The portals agent's gates are not drawn here; the sites were chosen by geometry (clear of ledges, stages and walls),
  not seen.
- No world sounds (`ambience()` is null for the three new worlds; `tone()` set by guess).
- No textures: everything is procedural, so `docs/ASSETS.md` is unchanged.
- The dancers' own light on the world (`dancerLight`) is an API; nothing in today's show calls it (the stills use the
  `firelight` param).
