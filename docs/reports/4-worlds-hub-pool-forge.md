# Wave 4: the hub, the Pool and the forge (the critic's task 6)

Branch `worktree-agent-a5af3e5d95f33d768`. Everything below was rendered on the RTX 5090 through headless Chrome
against a dev server on port 5427, every capture under the shared render lock, at 1280x800. Not measured: a laptop, a
phone, `coarse` on a real device, anything by ear, a long soak. The per-world `grade` hook was not in this worktree,
so the grades are suggestions in this report, not code.

## The three worlds in a paragraph each

- **Geode (the hub).** Before: a black void with dark blobs (at the critic's 9 m orbit the camera stood *outside* the
  8.5 m crystal dome, so the wall's gems filled the foreground as black spheres), lavender boxes for shelves, gates as
  bare discs. After: a hollow twelve metres round whose wall is lit and present (faces of crystal in veins of
  amethyst, celestite, citrine and rose quartz, a few glowing from deep inside so they open into coloured bokeh in the
  depth of field), druses of crystal points in the wall's colours, great crystals by the wall, a crown of crystals in
  its world's colour round every gate and a path worn across the agate to it. The gem dancers' shot is now Gem
  Dancers' geode (`4-hpf-geode-gems-after.jpg` against `original-geode-dance.jpg` and `4-hpf-geode-gems-before.jpg`).
- **Pool.** Before: black, with a pink line. After: a great low moon behind the stage, its road of broken light on
  the water running toward the viewer, a thin mist on the far water lit on its bearing, a brighter river of stars,
  the near water a shade darker. The locked fire and water pair stand either side of the moon's road
  (`4-hpf-pool-lock-sheet.jpg`): the strongest frame in this report. It keeps its purity: black water, the thin
  horizon, nothing else in it.
- **Forge.** Before: black hex blocks on a flat orange sea under a flat green band. After: the sea is two layers (a
  dark deck of smoke over a crust of fire with glowing cracks, hottest under the stage, sinking into a dark dusk at
  the horizon), the islands are tapered masses of rock with veins of fire and lit rims, the aurora hangs as curtains
  in parts of the sky, the anvil's tops are worn and warm and cracked. A fire dancer now reads against the dark far
  sea in the lock (`4-hpf-forge-lock-2.jpg`, first frame of `4-hpf-forge-lock-sheet.jpg`). It is the least finished
  of the three (weak points below).

## What changed and why

### Geode (`src/worlds/geode/`)
- **The hollow** (`geode.wgsl` `geodeWall`, `geodeWallT`, `geodeVein`, `geodeOculus`; `backdrop.wgsl`). The backdrop
  now meets an ellipsoid wall (`wall.x` = cave radius + 0.4 m, `wall.y` how high the vault reaches) behind the gem
  dome and shades it as crystal faces: a cellular pattern round the hollow (a whole number of cells round, so it closes
  without a seam), each face sloped its own way, seams dark, most faces barely lit and one in twenty or so glowing from
  a point deep inside (`spot`), so out of focus they become discs, not tiles. Colour comes from broad veins
  (`geodeVein`, two value noises). Brighter low, where the floor's light reaches; darker up into the vault; an
  opening over the stage pale with the water's light (where the shaft comes from: `shaftTop` raised to 11.5 m). Glints
  where a face turns the softbox or the shaft to the eye. The haze is a dim violet, lit a little low down, so the far
  side sinks into dusk instead of black.
- **The cave is bigger**: `caveRadius` 8.5 → 12 m, `caveStones` 2600 → 3600 (coarse 700 → 1000, of `LIMITS.fixtures`
  4096; the geode is the only world with fixtures). The critic's orbit at 9 m is now inside the hollow. `room` stays at
  7.4 m (the old value), so the locked camera stands in front of the gates and frames the stage between them.
- **The wall's own gems** take the veins (`geodeFixtureTint`), brighter (`caveBright` 0.3 → 0.4) and less faded with
  distance; the studio the gems reflect gains a faint ring of the veins' colours low round the horizon (cheap: sines,
  no noise, since every gem calls it four times).
- **The shelves** (`shelves.ts`, `shelves.wgsl`): the ledges are unchanged (same ids, x0, x1, y, thick, solid), but
  the blades now grow out of druses (the side ones at x = ±7.4, the high one from a druse 4.4 m behind the middle), not
  out of a wall that is now 12 m away. Each face is shaded a little its own way, the long edges carry a line of light,
  the glow gathers toward the tip, the body is darker and more fibrous, the faces mirror the wall's veins; longer
  chisel tips.
- **Crystal points** (new `crystals.wgsl`, `shelves.ts` `points`): six-sided prisms with six-faced points, uneven,
  dark and clear in the body, glowing toward the point in their colour, edges lit. They make the druses (in the wall's
  veins' colours), six clusters of great crystals by the back and side walls, and **each gate's setting**: a crown of
  22 short points on the disc's rim in its world's colour (pool blue, temple teal, forge orange, redwoods green), longer
  at its foot, and three more on the floor either side of the way in. about 150 instances of 54 vertices, one draw.
- **Worn paths** (`backdrop.wgsl` `geodePaths`): from near the middle of the floor to each gate, the agate's fine
  bands rubbed out and the polish brighter, ragged at the edges, tinted by the gate's world toward its end, with a pool
  of that light at its foot. The gates' places reach the shader in the uniform (`gates: array<vec4f, 4>`).
- **The mirror floor** now reflects the wall's glow (`geodeWallSoft`) as well as the studio, so no part of the floor
  away from the dancers is a black hole. The black smear under a fire dancer is still there
  (`4-hpf-geode-wide-a-after.jpg`): it is the depth contract (task 3), not the floor's shading.
- **Stage**: lens 20 → 24, spawns ±2.45 → ±2.2 (a little closer, a little wider: the shelves and the bokeh behind both
  dancers). Suggested default angle for the lock (not in the `StagePlane` type): yaw 0, eye height 1.6 m.

### Pool (`src/worlds/pool/`)
- **The moon** (`pool.wgsl` `poolMoon`, `pool.ts` `moonAt`): 2.4° across, 4.2° up, 4° off the stage's axis, a
  soft limb and faint seas, a close halo and a wide faint one, rising 2.5° over ten minutes and back (`moonHold` holds
  it for stills). It is part of `poolSky`, so the water's reflection, the gems' environment and the stars round it all
  take it with no other change.
- **The moon's road**: `poolScene` perturbs the reflected ray for the *sky only* with a small anisotropic noise that
  grows with distance (the shared wind in `water/water.wgsl` fades out far off, which made the moon a mirrored disc),
  so the far water breaks the moon into a long road of glitter. The dancers' reflections keep the ripples' own bend.
- **Mist** (`poolAir`): a band round the horizon over the far water (beyond 15 m), lit on the moon's bearing; it veils
  the moon's lower limb and softens the horizon line.
- **Sky**: the river of stars 2.4× brighter, a few more stars. **Water**: the near water a shade darker (the eye goes
  out across it).
- Stage unchanged (lens 18). Suggested default angle: yaw 0 (the moon between the dancers), eye height 1.2 m.

### Forge (`src/worlds/forge/`)
- **The sea** (`forge.wgsl` `forgeLava`, `forgeClouds`, `forgeBand`): two layers at two depths, which slide past each
  other as the eye moves: a deck of dark smoke at -70 m with holes, and through them the fire at -105 m, a crust with
  glowing cracks, hottest under the stage (a 90 to 110 m falloff from the origin). The rims of the deck's holes burn.
  The far sea fades into a darker dusk (`forgeBand` halved, horizon colour darker), and the haze is a third of what it
  was (`haze` 0.0012 → 0.0004), which had hidden the sea entirely.
- **The aurora** (`forgeAurora`): three curtains, each hanging over only part of the sky, a sharp bright lower edge,
  folds, rays climbing from the hem, green to violet to rose with height.
- **The islands** (`slabs.wgsl` vertex): an island's columns are pushed off the hex grid and given their own girth so
  they overlap into one mass, and taper to a third of their width as they hang (the floats taper a little); the side
  normals follow the taper. Fragment: strata and darker streaks, veins of fire running down, rims (the fire's light
  round the undersides, the night's along the upper edges).
- **The anvil** (`slabs.wgsl` fragment): wider bevels (35 → 60 mm), worn pale and chipped; hairline cracks on the tops,
  warm in patches; the tops hold a little warmth. The tops' reflection no longer marches the aurora (a hint of its
  colour only), which was the green sheen from a high camera and the main cost.
- The stage slabs' tops, ledges and `ledgeY` bob are untouched (layout.ts is unchanged; the taper is below the top).
- Stage unchanged (lens 20). Suggested default angle: yaw 0, eye height 2.2 m (a little above the anvil, so the far
  sea's dusk is behind the dancers).

## Stills (all under `docs/reports/media/`)

| | before | after |
|---|---|---|
| geode, the critic's orbit | `3-w-geode-empty-sheet.jpg` | `4-hpf-geode-empty-sheet.jpg`, `4-hpf-geode-empty-{0,3,6,9}.jpg` |
| geode, wide | `4-hpf-geode-wide-a-before.jpg`, `-b-before` | `4-hpf-geode-wide-a-after.jpg`, `-b-`, `-c-after` |
| geode, locked fire and water | `3-w-geode-lock-2.jpg`, `4-hpf-geode-lock-before.jpg` | `4-hpf-geode-lock-sheet.jpg`, `4-hpf-geode-lock-{2,3,4p2}.jpg`, `4-hpf-geode-lock-after.jpg` |
| geode, gem dancers (the most flattering) | `4-hpf-geode-gems-before.jpg` | `4-hpf-geode-gems-after.jpg` |
| the hub and its gates | `3-hub-sheet.jpg` | `4-hpf-hub-sheet.jpg`, `4-hpf-hub-{0,3}.jpg` |
| pool, orbit | `3-w-pool-empty-sheet.jpg` | `4-hpf-pool-empty-sheet.jpg`, `4-hpf-pool-empty-{0,3,6,9}.jpg` |
| pool, wide | `4-hpf-pool-wide-a-before.jpg`, `-b-before` | `4-hpf-pool-wide-{a,b,c}-after.jpg` |
| pool, locked (the most flattering) | `3-w-pool-lock-sheet.jpg`, `4-hpf-pool-lock-before.jpg` | `4-hpf-pool-lock-sheet.jpg`, `4-hpf-pool-lock-{2,3,4p2}.jpg`, `4-hpf-pool-lock-after.jpg` |
| pool, gem dancers | `4-hpf-pool-gems-before.jpg` | `4-hpf-pool-gems-after.jpg` |
| forge, orbit | `3-w-forge-empty-sheet.jpg` | `4-hpf-forge-empty-sheet.jpg`, `4-hpf-forge-empty-{0,3,6,9}.jpg` |
| forge, wide and high | `4-hpf-forge-wide-a-before.jpg`, `-b-before` | `4-hpf-forge-wide-{a,b,c}-after.jpg` (c: high, the sea) |
| forge, locked | `3-w-forge-lock-sheet.jpg` | `4-hpf-forge-lock-sheet.jpg`, `4-hpf-forge-lock-{2,3,4p2}.jpg`, `4-hpf-forge-lock-after.jpg` |
| forge, gem dancers | (none) | `4-hpf-forge-gems-after.jpg` |
| `?baseline`, once per world | | `4-hpf-baseline-{geode,pool,forge}-1.jpg` (all render, nothing missing) |

The forge's before lock and gems stills were not taken (the lock was held by other projects for long stretches; the
critic's `3-w-forge-lock-sheet.jpg` is the before). The forge orbit and lock sheets were shot before the last forge
change (2D noise for the fire, no aurora in the stone's reflection), which is a cost change that looks nearly the same
(`4-hpf-forge-wide-*-after.jpg` are after it).

Step files: `scripts/steps/hpf-{geode,pool,forge}.json` (stills: wide ×3, lock with fire and water on the outermost
ledges, gem dancers at 5 m), `scripts/steps/critic-hpf.json` (the critic's orbits and lock sheets for these worlds, the
hub, a `?baseline` still per world: run with `scripts/critic-cap.mjs --only …`; it writes `3-hpf-*`, renamed `4-hpf-*`
here), `scripts/steps/hpf-timings*.json` (the timings below), `scripts/steps/hpf-quick.json` (iteration).

## Cost (RTX 5090, 1280x800, weft's profiler over 150 stepped frames, ms per pass)

The same steps before (the merge base, 57483b3) and after, camera at 9 m, yaw 0.4, pitch 0.1:

| world | empty (gems scale 0.0001): scene + air | with the two asleep fire dancers: scene + air |
|---|---|---|
| geode | 0.101 + 0.053 = 0.154 → 0.127 + 0.053 = **0.180** (1.17×) | 0.528 + 0.053 → 0.559 + 0.053 (1.05×) |
| pool | 0.043 + 0.048 = 0.091 → 0.047 + 0.050 = **0.097** (1.07×) | 0.679 + 0.046 → 0.680 + 0.051 (1.01×) |
| forge | 0.168 + 0.009 = 0.177 → 0.123 + 0.008 = **0.131** (0.74×) | 0.865 + 0.008 → 0.756 + 0.008 (0.87×) |

(One intermediate forge build cost 0.315 ms empty, 1.9×: the aurora marched in every basalt pixel's reflection and
three fBms in the sea. Both were cut.) Locked, two dancers playing: geode 1.28 ms frame (scene 0.70, air 0.08), pool
1.34 ms (scene 0.79), forge 6.63 ms (scene 5.75: the fire and water clash, the critic's 7.15 ms case, task 5's, not the
world). Each stays far under the redwoods' (scene 1.65, air 0.38 in the critic's table). The geode seen through a gate
from the forge: scene.gate0 0.061 → 0.069 ms empty. Not measured: `coarse` on a phone; the new work is per pixel in
the backdrops (one 3×3 cellular pattern in the geode's wall, value noise in the forge's sea) and about 150 small instances in
the geode, all of which scale with resolution, and `coarse` lowers the geode's stones to 1000.

**Bindings**: no new binding in any shared group. The light uniform grows by the geode's `wall` and `gates` (5 vec4s)
and the pool's `moon`, `moonCol`, `mist` (3 vec4s): 128 bytes. The new `crystals.wgsl` binds one storage buffer
(group 1) in its vertex stage. `npm test`'s binding check: "bindings within the baseline (106 entry points; most
uniforms: 7 of 12)".

## Suggested grades (for the per-world `grade` hook; not in this worktree)

| world | lift (shadows) | gain (highlights) | contrast | saturation | other |
|---|---|---|---|---|---|
| geode | toward violet `#140c24` at 0.12 | warm white `#fff1e0` | 1.05 | 1.10 | vignette 0.25; keep blacks at 0 (the bokeh needs dark) |
| pool | toward night blue `#08102a` at 0.10 | moon warm `#ffe6c4` | 1.15 | 0.90 | vignette 0.35; blacks at 0 (the water is black) |
| forge | toward maroon-violet `#1a0818` at 0.10 | orange-gold `#ffc078` | 1.10 | 1.05 | pull greens 10° toward cyan and down 15% (the aurora's band and the anvil's teal cast); vignette 0.2 |

## The critique's "Done when", item by item

1. *The `w-geode-empty`, `w-pool-empty` and `w-forge-empty` orbits hold up against `original-geode-dance.jpg` for
   depth and colour.* **Geode: yes for depth and colour** (bokeh, a wall with colour, a vault; the gem dancers' shot
   is close to the original). The orbit at 9 m still passes close by gate crowns and druses, which fill some frames
   blurred in the foreground. **Pool: half.** Facing the moon, yes; facing away (half the orbit) it is black water and a
   dark sky with stars and a mist line, which is the Pool's purity but not "depth and colour". **Forge: partly**: the
   sea has depth and structure from above, the far dusk gives contrast, but the world's palette is still two colours
   (red-orange and aurora green).
2. *A fire dancer reads against the forge in `w-forge-lock`.* **Yes** before the clash (`4-hpf-forge-lock-2.jpg`, first
   frame of the sheet): the far sea is dark behind the flames. Once the two meet, the steam (task 5) hides both.
3. *No black voids filling half the frame.* **Geode and forge: yes** in every frame of their orbits. **Pool: no** for
   the half of the orbit facing away from the moon (see 1), by design of the brief ("keep its purity").
4. *The hub's non-live gates show their worlds.* **Not done here**: the disc's face is drawn by `src/portals/`
   (task 4's folder). What this branch adds is each gate's setting (a crown in its world's colour, a lit path), so a
   non-live gate at least reads as a door to a coloured place.

The brief's own items: a lit wall with coloured bokeh, inner glow, great crystals and a vault (done; the vault is
dark, so the ceiling reads in a high shot more than in the orbit); shelves with facets and inner light whose roots read
against the wall (better, not done: see weak points); a mirror floor without black holes (done apart from the fire's
smear); a shaft with dust (kept, now from the opening in the vault); gates with settings (done); the Pool's sky event,
light on its water, mist, broken stars, a vignette of darker near water (done); the forge's rock masses, rims and seams,
the anvil's bevels, wear and heat, the sea's depth and contrast, the aurora's structure, the green sheen (done,
partly: see weak points), embers and shimmer (kept); the bobbing ledges coincide (layout and `ledgeY` untouched).

## Weak points (as a harsh art director)

- **The geode's high shelf still reads as three blocks** from the locked camera: its chisel ends face the lens as flat
  faces. A real fix is a different end (a broken, stepped end, or the blade turned 20° so its side shows).
- The **druses** read a little like fence posts in a wide orbit; the **gate crowns** look like flower petals when the
  camera is within two metres of one, and they are large and blurred in the foreground of the 9 m orbit.
- The **forge's anvil tops** still read teal-black and the hex grid is very regular; the islands are better but still
  read as clusters of spikes rather than one rock; the aurora is a strong saturated green band at the top of most
  frames. The forge needs a second pass.
- The **Pool**, facing away from the moon, is still a black half-frame (the brief asked to keep its purity; a second
  light there would cost it).
- Not mine but in every still: the black smear under a fire dancer on the geode's floor and the black rectangle behind
  flames at the Pool's horizon (task 3); the fire's dark smoke slivers (task 1); the clash's steam (task 5). In the
  geode's lock the water dancer reset onto the right shelf sometimes falls and lies as a puddle for a second (staging).

## Edits outside my folders

- Generated `*.d.wgsl.ts` files of every shader that includes `worlds/light.wgsl` (weft's plugin rewrites them when the
  light struct grows): `src/matter/gems/draw`, `src/matter/ice/shards`, `src/matter/reactions/steam_draw`,
  `src/matter/water/drops`, `src/matter/water/surface`, `src/post/air`, `src/worlds/light`, `src/worlds/redwoods/*`
  (ferns, flowers, grass, lanterns, pollen, trunks, woods), `src/worlds/temple/{backdrop,stones}`. No hand edits.
- `src/worlds/light.wgsl`: none (the new fields are in my own structs, `Geode` and `Pool`, in my folders).
- `scripts/steps/hpf*.json`, `scripts/steps/critic-hpf.json`: my step files. No change to `scripts/*.mjs`.
- `docs/ASSETS.md`: none (no assets; everything is made in the shaders).

## Verification

- `tsc --noEmit` (and `-p server`, `-p test`): clean. `vite build`: built (to a scratch directory).
- `npm test`: limits, bindings, src tests, audio, portals, net tests pass except `test/smoothness.test.ts` "B: tracks
  the source in real time (rms < 0.02)" (rms 0.08), twice. It is a real-time net test; this branch changes nothing in
  `src/net`, `shared`, `server` or `test`, and the machine was carrying a dozen other GPU captures at the time. Not
  confirmed on the base commit.
- The world was not checked on a phone; `?baseline` renders all three worlds with nothing missing.
