# Wave 3: the critic's look, and the plan to make it beautiful

Everything below was rendered on the RTX 5090 through headless Chrome (dev server on port 5396, every capture under the
shared render lock), saved as frames, and looked at as contact sheets and as full-size stills. Nothing here is from the
earlier reports' stills unless it says so. A new helper, `scripts/critic-cap.mjs`, runs a timeline (cues, a per-frame
camera script) and writes JPEG frames, an MP4, a contact sheet and chosen stills. The step files are
`scripts/steps/critic-*.json`, written by `scripts/steps/critic-gen.mjs`. Not measured: anything on a laptop or a phone,
anything by ear, a real gamepad, a long soak.

## The verdict in ten lines

1. Right now this is a strong engine demo with one beautiful world and one beautiful element. It is not yet a film you would put on a portfolio.
2. The redwoods at dusk (`3-filmb-*.jpg`, `3-w-redwoods-empty-sheet.jpg`) and plasma (`3-el-plasma-*`, `3-filmb-9p2.jpg`) are already wonderful. Protect them.
3. Fire reads as **orange fur**: summed additive streaks with the colour ramp applied per sprite. Water reads as a **blue rubber mannequin** at rest and as **glitter** when it moves. Ice reads as a **white sugar cut-out**. Not one of them reaches the 2D prototype's elements.
4. Where two elements meet, the frame turns to mush: a white steam bank, black needle streaks (stretched smoke sprites) and a fur halo (`3-filmb-5p6.jpg`, `3-w-forge-lock-sheet.jpg`).
5. Broken in plain sight: a hard black rectangle cut at the Pool's horizon behind every flame and water body (`3-el-fire-close-0p3.jpg`), a black smear on the geode's mirror floor under every fire dancer (`3-moves-fire-0p95.jpg`), and a follow camera that loses the player at every gate crossing (`3-gate-*-sheet.jpg`).
6. Worlds: the redwoods and the temple have a sense of place. The geode is a black void of untextured lavender slabs, the Pool is a black void with a pink line, and the forge is black hex blocks on a flat orange sea.
7. The locked 2D view is not yet a game screen: the dancers are small and dark in a void, and in the redwoods one dancer is cropped (`3-w-geode-lock-2.jpg`, `3-w-redwoods-lock-sheet.jpg`).
8. Cost is fine on a 5090 (1 to 3.3 ms per frame at 1280x800, 4.75 ms at 1080p), except where elements clash: the forge clash takes **7.15 ms** (5.8 ms in the scene pass, all overdraw). That will not hold 60 fps on a laptop.
9. **First change:** shade fire as a field. Splat temperature into a buffer, then apply the reference ramp and display noise once, after the sum. Fur becomes flame.
10. **Second change:** make water flow and glow (a narrow-range filter, the reference's luminous colour model, real spray and foam). **Third:** make the meeting of two elements a designed event (a capped, wispy steam front, no smoke needles), and fix the depth contract behind the horizon hole.

## Evidence

All under `docs/reports/media/` and committed as JPEG. The videos (MP4, one per take, 47 files, 1.1 GB) are in
`docs/reports/media/3-film/`, which git ignores. The frames are in `shots/critic/<take>/` (also ignored). Timings are in
`shots/critic/timings.jsonl`.

**Films (item 1)**
- `3-main-film-sheet.jpg`: the joined film, 29.5 s (`3-film/main.mp4`). Fire and water in the Pool, forms shifting to plasma and ice, steam, a walk through a gate into the redwoods at dusk, the lock, the jogo, the unlock.
- `3-film-sheet.jpg`: the first take, 28 s. In the Pool the dancers walk through a gate I opened (Pool to redwoods). After the lock, the camera is carried *back* into the Pool.
- `3-film-3.jpg`: an armada on fire beside water in the Pool. The fire has lost its silhouette, and the water is opaque blue plastic.
- `3-film-6.jpg`: plasma meets ice. A steam whiteout hides both dancers.
- `3-film-7p2.jpg`: ice at game distance is a flat white paper doll. Plasma with an arc.
- `3-film-11p8.jpg`: the gate disc. In the redwoods through the disc, the water dancer is only sparkles (no surface in gate views).
- `3-film-12p6.jpg`: the moment after the camera crosses. The whole frame is out of focus.
- `3-film2-sheet.jpg`: the second take, with the redwoods end of the gate at the world's own site. The fire dancer crosses alone, and the camera and the water dancer stay in the Pool.
- `3-film2-10p8.jpg`: a walking water dancer becomes a teal sand-cloud. `3-film2-13p4.jpg`: an empty Pool after the player has left without the camera. `3-film2-18.jpg`: a water body cut flat by the disc's plane.
- `3-filmb-sheet.jpg`: the redwoods take, 16 s (free, then locked, then free again). `3-filmb-3.jpg`: the fire is fur, with a dark smoke cloud behind its head. `3-filmb-5p6.jpg`: the clash, with black needles, grey wings and a pink column. `3-filmb-7p4.jpg`: ice as rice-grain fur. `3-filmb-9p2.jpg`: the best frame of the session, plasma and ice apart in the meadow. `3-filmb-14p5.jpg`: back to free, with fire lighting the grass and water as a dark teal ghost.

**Elements alone (item 2), Pool, 6 s each, wide (6.2 m) and close (2.3 m):** `3-el-<fire|plasma|water|ice|gems|ember|tide|geodeheart>-<wide|close>-sheet.jpg` (16 sheets). Stills: `3-el-fire-close-0p3.jpg` (fur and the horizon rectangle), `3-el-fire-wide-1p2.jpg`, `3-el-water-close-1p2.jpg` (glitter after a kick), `3-el-plasma-close-1p2.jpg` (a needle halo with an arc), `3-el-ice-close-0p3.jpg` (sugar crust).

**Worlds (item 3):** `3-w-<world>-empty-sheet.jpg` (a 360° orbit at 9 m, 48 frames; the "empty" world still shows the two asleep fire dancers, because asleep fire does not go out in the show) and `3-w-<world>-lock-sheet.jpg` (locked, two dancers put on the outermost ledges, then moves). Stills: `3-w-geode-lock-2.jpg`, `3-w-temple-lock-3.jpg`, `3-w-redwoods-lock-3.jpg`.

**Moves (item 4):** `3-moves-fire-sheet.jpg`, `3-moves-water-sheet.jpg` (ten moves each way, fire and water, in the geode). Stills: `3-moves-fire-0p95.jpg` (an armada against an esquiva, which reads), `3-moves-fire-8p45.jpg` (an aú on fire, which does not read), `3-moves-water-8p45.jpg` (an aú on water, a good arc of spray).

**Gates (item 5):** `3-gate-geode-to-redwoods-sheet.jpg`, `3-gate-redwoods-to-geode-sheet.jpg`, `3-gate-other-inside-sheet.jpg`, `3-hub-sheet.jpg`. Stills: `3-gate-geode-to-redwoods-3.jpg`, `3-gate-other-inside-1p5.jpg`, `3-hub-4.jpg`.

**Motion (item 6):** `3-mo-<fire|water|gems>-sheet.jpg` (an armada at 60 fps, 48 consecutive frames) and `3-ginga-<fire|water>-sheet.jpg` (3.2 s of ginga at 15 fps).

**Cost:** `3-t800-*` and `3-t1080-*` sheets and stills (the same three scenes at 1280x800 and 1920x1080), plus `3-t1080-ice-plasma-1.jpg` and `3-t1080-redwoods-close-1.jpg` at full size.

## Findings

Each finding is marked **broken** (wrong, fix it), **weak** (works, falls short) or **could be wonderful**. Confidence is about the *cause*; what I saw is in the still.

### Elements

**Fire**
- **Weak, the biggest single problem: fire is fur.** Close up (`3-el-fire-close-0p3.jpg`, `3-filmb-3.jpg`), the body is thousands of thin orange streaks, a fox's pelt, with no tongues and no dark gaps between licks. The reference (`docs/element-looks/01`, `09`) has smooth, curling, coherent tongues with a white-yellow core and deep red tips. *Cause (high confidence):* `fire/draw.wgsl` applies the ramp `fireRamp(Tf)` **per sprite** and adds the results. The reference applies the ramp **once, to the summed temperature field**. A non-linear ramp on the sum gives hard-ish isotherms (the licking contours). A sum of ramped sprites gives fuzz. Velocity streaks (`stretch`) make each sprite a hair. The world-space tongue noise only dims sprites. It cannot cut a contour.
- **Weak: fire has no silhouette in motion.** In an armada or an aú (`3-film-3.jpg`, `3-moves-fire-8p45.jpg`), the body becomes a blob of fur twice its size. The wing a kick throws is lovely in the 60 fps sheet (`3-mo-fire-sheet.jpg`, frames 30 to 48), but it hides the limb that threw it. At game distance a fire dancer is a torch (`3-el-fire-wide-sheet.jpg`), and you cannot tell which way it faces.
- **Broken: smoke is black needles.** Wherever there is wet (a water dancer within a metre or two), the fire's `fs_smoke` draw puts dark, velocity-stretched slivers all over the frame: around the head (`3-filmb-3.jpg`, a dark cloud), in the clash (`3-filmb-5p6.jpg`), and round plasma (`3-t1080-ice-plasma-1.jpg`, a black hedgehog). *Cause (high):* the smoke draw shares the flame's vertex stage, so it inherits `streak` (×2.2 for plasma), and its "over" darkening reads as black on any lit background. The integration report's "dark needle streaks" are this, not the gems' spare stones (medium confidence: the needles appear only with wet).
- **Broken: the black smear on the geode's mirror floor** under every fire dancer (`3-moves-fire-0p95.jpg`, `3-gate-geode-to-redwoods-sheet.jpg`, `3-hub-sheet.jpg`), a black shape larger than the dancer. *Cause (medium):* the floor's screen-space reflection marches into pixels whose alpha the flames have min-blended to a near distance with no opaque colour behind them, so it "hits" black. The same depth contract breaks the Pool (below). Not traced to the line.
- **Could be wonderful:** fire lighting the world. The meadow's grass warmed round the fire dancer at dusk (`3-filmb-14p5.jpg`) and the temple's altar are the most "of a place" moments in the build.

**Plasma**
- **Could be wonderful, nearly there.** Violet filaments, white threads, hand arcs (`3-el-plasma-close-sheet.jpg`, `3-filmb-9p2.jpg`). It reads instantly as not-fire and is the closest element to its reference (`04-plasma-arc.jpg`).
- **Weak:** in a kick it grows a halo of long straight spark needles in every direction (`3-el-plasma-close-1p2.jpg`), a hedgehog. Sparks are stretched 1.6× and the flames 2.2× by `form`. The cores are violet rather than white-hot at body scale. The reference's white comes from the cube term on the *summed* field (the same cause as fire's fur).

**Water**
- **Weak, the second-biggest problem: water at rest is a rubber mannequin.** Uniform blue, opaque, one long specular streak, no movement on the surface (`3-el-water-close-sheet.jpg` first two frames, `3-mo-water-sheet.jpg`). It is the capsule body, smoothed. *Cause (high):* particles are sprung to homes on capsules with a 5 mm `wobble` and 8 mm noise (`water/params.ts`), so the surface is the capsules. Thickness absorption toward deep blue (`absorbR` 4 and the rest) makes it opaque. The reference water is luminous (body gradient × a rising fbm caustic, a cyan rim where thin, sharp highlights), heavy, and always running down.
- **Weak: moving water is glitter.** After a kick the body breaks into a cloud of round, bloomed star sprites with a cyan outline (`3-el-water-close-1p2.jpg`, `3-film2-10p8.jpg`). *Cause (high):* drops are drawn as glinting stars (`drops.wgsl`), and the surface's thin rim adds the cyan outline round every clump. There is no velocity stretch, no foam, no spray.
- **Weak: at game distance water vanishes.** A dim navy figure on dark (`3-el-water-wide-sheet.jpg`), and dark teal in the redwoods (`3-filmb-3.jpg`), because it refracts a dark scene and absorbs. Its reflection in the Pool is brighter than the body.
- **Weak: the puddle** is a flat, bright cyan slab on the floor (`3-el-water-wide-sheet.jpg`, the last row; `3-w-pool-lock-sheet.jpg`).
- **Broken: water through a gate** is only its drops (`3-film-11p8.jpg`), the integration report's open item 2, confirmed.
- **Could be wonderful:** the water aú (`3-moves-water-8p45.jpg`) throws a perfect arc of spray. With a liquid look on that arc, it would be the shot of the film.

**Ice**
- **Weak: ice is a white cut-out.** Wide, a flat glowing white silhouette, the "spirit" look that `element-looks.md` §3 records as tried and rejected (`3-el-ice-wide-sheet.jpg`, `3-film-7p2.jpg`). Close, a crust of tiny white grains (`3-el-ice-close-0p3.jpg`, `3-filmb-7p4.jpg`). There are no large flat facets, no dark facets, no steel blue, no transparency. *Cause (high):* one small shard per 14 particles, lit bright, with frosted rims at 120/m, so the grain is finer than a pixel at game distance. It is also the costliest body (scene 0.93 ms close, one dancer).
- **Could be wonderful:** the freeze climbing from the feet (seen in `3-filmb-sheet.jpg` row 2) and the ice dust.

**Gems**
- **Weak but finished:** still the most "made" body (`3-el-gems-close-sheet.jpg`), Gem Dancers' look, though dim on the Pool's black.

**Mixed loadouts**
- **Weak:** in `ember`, the gem heart disappears inside additive fire (`3-el-ember-close-sheet.jpg`). In `geodeheart`, the amethyst torso is a flat purple vest with no facets (`3-el-geodeheart-close-sheet.jpg`). In `tide`, the ice hands and feet are white mittens and boots (`3-el-tide-close-sheet.jpg`). The idea (a heart of one matter in a body of another) is good. It needs the heart to glow *through* (fire should be dimmer where it overlaps the heart, and the heart should emit).

**Steam and the meeting**
- **Broken (as design): the clash is a whiteout.** Plasma meeting ice (`3-film-6.jpg`), and fire with water at contact range (`3-w-forge-lock-sheet.jpg`, `3-moves-*-sheet.jpg` rows 4 and 5), fill the frame with a flat grey-white bank, needles and wings, and hide both dancers for seconds. The reference's steam is a *front*: a white-hot hissing line where they touch, and pale wisps boiling up for a second. *Cause (high):* unbounded overdraw of large soft puffs (`steam.pool` 9,000), no per-pixel density cap, no wisp shape, lives of 1.8 to 3.2 s, and fire's smoke on top.

### Bodies and motion

- **Could be wonderful: the ginga is alive.** Weight shifts and bob between moves (`3-ginga-fire-sheet.jpg`, `3-ginga-water-sheet.jpg`); nothing freezes.
- **Weak but sound: the kick at 60 fps.** No pops and no strobing in the body: windup, extension and recovery are continuous (`3-mo-*-sheet.jpg`). Fire leaves a good follow-through wing. Water drags nothing during the kick (the leg is a smooth rod) and only sheds afterwards. Gems smear, as the dancers report said.
- **Weak: the trail post ghosts fast moves.** The ice aú shows three offset copies (`3-el-ice-close-sheet.jpg`, frame 8; also the wide sheet). This is `trailFx` 0.2 (medium confidence). It reads as strobing, not as motion blur.
- **Weak: the moves read on gems and on water from the side, not on fire.** The armada against an esquiva reads (`3-moves-fire-0p95.jpg`). The aú, the macaco and the rolê on fire become a ball of fur. The kicks are not readable as kicks from the follow camera behind the player.
- **Note for staging:** a dancer re-placed with `reset` leaves its water as a frozen translucent cone for a second (`3-w-geode-lock-sheet.jpg`, frame 1). This is a staging artifact, but the game's respawns will show it too.

### Worlds

- **Redwoods: could be wonderful, protect it.** At dusk: fog, warm backlight, trunks, flowers, lantern bokeh (`3-w-redwoods-empty-sheet.jpg`, `3-filmb-14p5.jpg`). Weak points: the lanterns read as ping-pong balls (uniform discs); the boughs are straight capsules with kinks; and **the world's own gate stands behind the stage's left ledge**, so a dancer on the log stands in front of the disc and is drawn half through it (`3-w-redwoods-lock-sheet.jpg`).
- **Temple: could be wonderful.** The moon over the lintel, the drowned court, reflections and moonlit ripples (`3-w-temple-lock-sheet.jpg`), and an orange sky behind the ruins at one angle of the orbit (`3-w-temple-empty-sheet.jpg`, row 3). Weak: the stone reads as pink cardboard with blotch noise, the Greek key and glyphs as clip art (`3-t1080-ice-plasma-1.jpg`), and the moon is a flat blown disc.
- **Geode (the hub): weak.** A black void, with shelves that are untextured lavender boxes and the crystal wall reading as dark blobs (`3-w-geode-empty-sheet.jpg`, `3-hub-sheet.jpg`). It has none of Gem Dancers' geode (`original-geode-dance.jpg`: depth, coloured bokeh, a floor). It is the first world anyone sees.
- **Pool: weak.** A black plane, a pink horizon line, a few stars (`3-w-pool-lock-sheet.jpg`). As a minimalist stage it could work, but it needs one event in the sky and some light on the water.
- **Forge: the weakest.** Voxel hex islands silhouetted as black blocks, a flat orange sea, an aurora as a flat green band at the top (`3-w-forge-empty-sheet.jpg`). Fire on orange has no contrast.
- **Coherence:** the worlds do not share a light language. The redwoods and the temple are painterly and fogged. The geode, Pool and forge are graphic and black. The elements are lit by none of them except the fire's own light.

### Portals

- **Broken: the follow camera does not cross with the player.** In both directions a lone player walks through and is seen beyond the disc, but the camera stays in the old world and drives into the wall (into the geode's crystals, `3-gate-geode-to-redwoods-sheet.jpg` last row; into a redwood trunk, `3-gate-redwoods-to-geode-sheet.jpg`). With two players, the fire dancer crossed alone and the camera stayed (`3-film2-sheet.jpg`). After a lock near the gate, the lock camera stood behind the disc and was carried *back* (`3-film-sheet.jpg`, from frame 13). *Cause (medium):* the follow target is the player's position in the far world's coordinates, so the eye flies toward that point in this world and passes beside the disc. The integration report's item 8 is the same family of bug. The camera crossed only once, in the first take, while both players walked into the disc together.
- **Broken: focus at the crossing.** Just through, the whole frame is blurred (`3-film-12p6.jpg`). The focus is the distance to the rig's look point (`main.ts` → `post.update`), not to the dancers.
- **Weak: non-live gates read as cheap textures.** Polka-dot spirals, green kiwi slices, grey dartboards (`3-hub-sheet.jpg`, `3-w-geode-empty-sheet.jpg`). With only two live slots, most of the hub's gates are these. The other dancer standing behind a gate in the redwoods was **not** seen through it: the gate showed its green shimmer (`3-gate-other-inside-1p5.jpg`). The slot choice does not favour the gate a dancer stands behind (medium).
- **Weak:** opening a two-gate pair over the worlds' eight warns `gates: 10 open, more than LIMITS.gates (8); the rest aren't drawn`, and closing a pair did not lower the count (closing animates). Any game that adds gates will hit this.
- **Could be wonderful:** a dancer seen walking on into the redwoods inside the disc, its near half still in the geode (`3-gate-geode-to-redwoods-sheet.jpg`, rows 2 and 3). That is the shot of the idea.

### Camera and the 2D lock

- **Weak: the locked view is not a game screen yet.** In the geode two small dancers sit on far-apart pale slabs in a black void, and the water player is dark teal on black (`3-w-geode-lock-2.jpg`). In the redwoods the dancer on the high bough is cut at the right edge (`3-w-redwoods-lock-sheet.jpg`, frame 3). The Pool has no ledges at all. There is no floor line, no lit ledge edges, no separation of dancers from the background.
- **Weak:** the lock on the temple is the best game screen (`3-w-temple-lock-3.jpg`): dancers on column stubs, the moon and lintel between them.
- **Broken (edge):** the lock camera can stand behind a gate's disc and be carried through it (see Portals).

### Post and grade

- **Broken: the Pool's horizon hole.** A hard-edged black rectangle under the horizon behind every flame and every water body in the Pool (`3-el-fire-close-0p3.jpg`, all of `3-el-*-sheet.jpg`, `3-w-pool-lock-sheet.jpg`; also the water head cut at the horizon in the integration's `2-lock-pool.jpg`). *Cause (high):* flames min-blend their distance into the scene alpha wherever even a faint tip shows (`fire/draw.wgsl` `fs`), and the water composite writes its distance too. The Pool's surface (`worlds/water/water.wgsl` `waterHit`) then decides those pixels are above the water and skips the reflection and haze, which leaves the black floor. One alpha channel is doing two jobs: "what is opaque here" (for the water and the reflections) and "where to focus" (for the depth of field). The redwoods horizon seam in the fire report is the same bug.
- **Weak: no shadows from fire or water bodies.** Gem Dancers had contact shadows (`original-redwoods-day.jpg`). Fire and water dancers float.
- **Weak:** the bloom is modest, and fire cores never bloom into the warm halo of the reference. The grade has no per-world colour script. Steam is crisper than the frame round it (drawn after the lens).
- **Could be wonderful:** the depth of field in the redwoods at dusk, and the warm haze.

### Performance (RTX 5090, weft's profiler over 150 stepped frames)

| scene | 1280x800 | 1920x1080 |
|---|---|---|
| fire and water, redwoods at dusk, close, two live gates | 3.28 ms (scene 1.65, air 0.38, gates 0.61) | 4.75 ms (scene 2.32, air 0.75) |
| fire and water in the geode hub, wide, two live gates | 2.22 ms (scene 0.97, gates 0.50) | 2.86 ms |
| plasma and ice, temple | 1.16 ms | 1.72 ms |
| **fire and water clashing, forge, locked** | **7.15 ms (scene 5.79, lens 0.21)** | not taken |
| one fire dancer close (2.3 m), Pool | 2.56 ms (scene 2.28) | |
| one ice dancer close | 1.48 ms (scene 0.93) | |
| one water dancer close | 0.86 ms (splats 0.29) | |
| geode heart (fire limbs), close | 2.91 ms | |
| the Pool film with gates live | 2.36 to 2.62 ms (scene.gate0 0.97 to 1.06) | |

- **Flag:** the clash case (steam, smoke and flames overlapping) costs 5.8 ms of fill on a 5090. A good laptop GPU is roughly a quarter to a sixth of a 5090 (an estimate, not measured), which puts it at 25 to 40 ms: **it will not hold 60 fps.** A close fire dancer is 2.3 ms of fill here, about 10 to 14 ms there.
- **Flag:** a live gate into the redwoods costs about 1 ms (its scene at a quarter of the pixels). Two live gates and the redwoods' air come to about 1.4 ms of the 3.3.
- **Phones:** not run. Everything costly here scales with fill (flames, steam, smoke, ice shards). `coarse` halves counts, but the sprites stay the same size on screen. Expect the clash to be the frame-killer there too.

## Fire and water: what to build

I read `fire/draw.wgsl`, `fire/sim.wgsl`, `water/surface.wgsl`, `water/smooth.wgsl`, `water/splat.wgsl`, `water/params.ts`, `post/air.wgsl` and `worlds/water/water.wgsl`, and weighed each option against weft (explicit passes, per-view culls, `seen` through gates, uniform limits), the frame as it is (the `cull` → `scene` → `air` → `post` stages, matter that must also draw in gate views and mirrors), and phones.

### Fire

| option | look | cost (5090, one close dancer) | phones | gates and mirrors | risk |
|---|---|---|---|---|---|
| A. **A temperature field in screen space**: the particles splat temperature (and velocity) additively into a half-res RGBA16F target per view, then one composite applies the reference's ramp and display noise to the **sum** (with the noise advected along the splatted velocity, and smoke as its own channel) | real contours, white cores, deep-red tips, dark gaps: the reference's look | splats at quarter of the pixels: fill falls about 3 to 4×; the composite about 0.1 ms. Expect 0.6 to 0.9 ms against 2.3 | quarter res, same code | one target per view, like water's surface; the mirror is a flipped splat into the same target | low to medium: the frame already does this for water |
| B. A velocity grid with vorticity confinement per dancer (for example 32×64×32 round the body, following it), advecting the existing flames | real curling tongues in 3D, coherent from any angle | ~0.2 to 0.4 ms of compute per dancer | 16×32×16 | unchanged | medium: tuning, the box following fast limbs |
| C. A 3D grid fluid per dancer, ray-marched as a volume | the most physical | 1 to 3 ms at close range | too heavy | a march per view | high |
| D. The prototype's 2D solver in a camera-facing slab fed by the 3D body | exactly the reference, proven | low | fine | breaks on an orbit (the history lives in screen space), needs a slab per view | medium; wrong for a free 3D camera |
| E. Better particle shading alone (anisotropic, sorted, soft, curl noise) | less fur, still additive fuzz | similar to now | similar | unchanged | low, but it does not fix the cause |

**First choice: A, then B.** A fixes the cause of the fur (ramp after the sum) and also fixes the smoke (shaded as a soft grey-brown channel in the composite, not stretched sprites), the horizon hole (the composite writes one clean distance where T crosses a threshold), and most of the fill cost. B gives the tongues their curl. The particles keep their job (carrying matter, kicks throwing sheets, gates, carry), and only how they are drawn changes. **Fallback:** D, in the locked 2D view only (where the camera is fixed side-on and the prototype's look is exactly right), with A in free view, cross-faded with the lock. Do not do C now.

Expected result: the white core and orange body as one shape with licks climbing off it; at game distance a readable figure with a hot core, because the ramp makes the contour, not the fuzz.

### Water

| option | look | cost | risk |
|---|---|---|---|
| A. **Upgrade the screen-space fluid**: (1) a narrow-range filter (Truong and Yuksel 2018) instead of the bilateral, to kill the bead outline and the grain; (2) motion on the body: particles flow along their capsule (down the limbs, pulled up again at the shoulders), with 2 to 4 cm travelling bulges and sheets that peel off at speed; (3) the reference's luminous colour model on the reconstructed normal and thickness (the body gradient by thickness, a rising caustic fbm, a cyan rim where thin, sharp specular; far less absorption toward navy); (4) spray as small velocity-stretched drops (stars only on a few), foam as diffuse white aerated particles classified by speed and curvature, the puddle as a thin reflective film that joins the Pool's ripples; (5) the surface's passes per gate view | luminous, heavy, running water | +0.1 to 0.2 ms over today's 0.4 | low to medium |
| B. A reference-only shading mode: the same splats and smoothing, the physical refraction dropped, the 2D colour model painted on | exactly the reference in a still, flat in 3D | cheaper than today | low |
| C. Metaballs or an SDF of capsules plus particles, ray-marched | smooth and glossy | heavy | high, and it looks like the mannequin again |

**First choice: A.** **Fallback: B** (a day's work inside A's composite, so it costs nothing to keep as a switch). Most of the "rubber" comes from the body not moving, not from the renderer: (2) matters as much as (3).

**Ice** should be drawn by the same surface (frozen particles splatted into the same target), with the reference's facets from a world-space voronoi on the reconstructed surface (large cells, `lit³`, steel blue to navy, a thin frosted rim, glints one cell at a time). Keep a few real shards only at the silhouette and where ice breaks. That is the reference's method, it is cheaper than 7,000 shards, and it gives large flat facets.

## The work plan

Three agents are already at work: **the jogo** (`src/play`), **brains** (`src/ai`), and **the engine fix** packing the worlds' light uniforms (`src/worlds/light.wgsl` and each world's uniform plumbing). Nothing below touches `src/play` or `src/ai`. The two world tasks wait for the engine fix, because they edit inside the world folders whose uniform plumbing it is changing.

| # | task | priority | runs |
|---|---|---|---|
| 1 | Fire as a field | 1 | now, in parallel |
| 2 | Water that flows and glows; ice facets | 1 | now, in parallel |
| 3 | The frame's depth contract and the lens | 1 | now, in parallel (1 and 2 adopt its contract: agree the names on day one) |
| 4 | Cameras through gates, and the game screen | 1 | now, in parallel |
| 5 | The meeting: steam fronts | 2 | now, in parallel |
| 6 | The hub, the Pool and the forge | 2 | after the engine fix lands |
| 7 | The redwoods and the temple: finish | 2 | after the engine fix lands; parallel with 6 |
| 8 | Gems and the mixed hearts | 3 | now, in parallel |
| 9 | Phones and laptops: the budget | 2 | measures now; tunes after 1, 2 and 5 |
| 10 | The films | 3 | tooling now; shooting after 1 to 7 |

### 1. Fire as a field (priority 1)
Fire and plasma become a temperature field in screen space: the flames splat temperature, velocity and smoke into a per-view half-res target, and one composite applies the reference ramps (fire and plasma) to the sum, with flow-advected display noise. Then a small velocity grid per dancer with vorticity confinement makes the tongues curl.
**Owns:** `src/matter/fire/`, `src/matter/plasma/`.
**Done when:** `3-el-fire-close`-style stills, re-shot with the same step file (`critic-elements.json`), show contours, dark gaps and red tips, side by side with `element-looks/01` at matching scale; the wide sheet shows a readable figure with a hot core, facing one way; no black needles anywhere (`critic-film-b.json` at 5.6 s); plasma's halo has no straight needles and its cores are white; a close fire dancer costs ≤ 1.0 ms of scene at 1280x800 (today 2.28); flames in a gate view and in the geode's mirror.

### 2. Water that flows and glows; ice facets (priority 1)
Water's body runs down the limbs and peels at speed, its surface is filtered by a narrow-range filter and shaded with the reference's luminous model, its spray is stretched drops and foam is its own diffuse particles; the surface runs in gate views. Ice is drawn by the same surface with world-space voronoi facets, with real shards only at edges and breaks.
**Owns:** `src/matter/water/`, `src/matter/ice/`.
**Done when:** `3-el-water-close` re-shot shows a luminous, moving surface at rest (compare `element-looks/09`), no star-glitter after a kick, and a bead-free outline; the wide shot reads at 6 m on the Pool's black; water through a gate has its surface (`critic-film.json` at 11.8 s); ice wide reads as steel-blue faceted crystal, not a white cut-out, and close shows large flat facets with dark ones among them (compare `element-looks/02`); two ice bodies cost less than today's +1.4 ms.

### 3. The frame's depth contract and the lens (priority 1)
Split the scene's one alpha job in two: an opaque view distance (what surfaces, reflections and the air test against) and a focus distance (what translucent matter and the depth of field use). Fix the Pool's horizon hole and the geode's mirror smear, focus on the dancers rather than the look point, replace the trail's ghost copies with real motion blur, give the bloom a warm halo for hot cores, and add a per-world grade (a LUT or curves per world, chosen with each world's mood).
**Owns:** `src/post/`, `src/engine/scene.ts`, `src/engine/frame.ts`, `src/worlds/water/` (the Pool's and temple's water surface shaders, not `light.wgsl`). Publishes the contract (texture names and one paragraph) to tasks 1 and 2 on day one.
**Done when:** `critic-elements.json` re-shot in the Pool has no rectangle at the horizon; `critic-moves.json` re-shot has no black smear under the fire; the frame right after a crossing is in focus on the player; the ice aú shows no triple ghost; `bend.stats().passes` shows the lens ≤ 0.15 ms at 1080p.

### 4. Cameras through gates, and the game screen (priority 1)
The follow camera crosses with its player (carried in the same frame, never flying toward far-world coordinates), the lock camera never stands behind a disc, and the slot choice favours the gate a dancer stands behind. The locked view becomes a game screen: framing that keeps both dancers and the ledges between them in a safe area with each dancer at least a fifth of the frame's height, a rim light and a slight background dim while locked, and no cropping when one leaps.
**Owns:** `src/portals/`, `src/engine/camera.ts`, `src/engine/shots.ts`.
**Done when:** `critic-gates.json` re-shot shows the camera in the far world behind the player in both directions; `critic-film.json` (both gate placements) keeps the camera with the players through the lock; `3-gate-other-inside` shows the other dancer through a live disc; the five `w-*-lock` sheets re-shot show both dancers whole and readable in every frame; adding a gate pair over eight drops the farthest instead of warning.

### 5. The meeting: steam fronts (priority 2)
Where two elements meet, draw a white-hot front at the contact and wisps that boil up and are gone within a second, with a per-pixel density cap so it never whites out. Steam gets a soft blur of its own so it sits in the lens.
**Owns:** `src/matter/reactions/`, `src/matter/field/`.
**Done when:** `3-film-6` (plasma against ice) and the forge clash (`critic-worlds.json` `w-forge-lock`) re-shot show both dancers through the steam in every frame; the forge clash costs ≤ 2.5 ms at 1280x800 (today 7.15) with tasks 1 and 5 in; steam is never brighter than 0.85 of white except at the front.

### 6. The hub, the Pool and the forge (priority 2, waits for the engine fix)
The geode becomes Gem Dancers' geode again: a lit crystal wall with coloured bokeh, crystal shelves with real facets and inner light, a floor that reflects without black holes, and gates whose non-live face is a soft, dim view of their world rather than a texture. The Pool gets one sky event (a moon or slow aurora) and light on its water. The forge's islands become rock masses with lit rims, and its sea gets depth and contrast against fire.
**Owns:** `src/worlds/geode/`, `src/worlds/pool/`, `src/worlds/forge/`.
**Done when:** the `w-geode-empty`, `w-pool-empty` and `w-forge-empty` orbits re-shot hold up against `original-geode-dance.jpg` for depth and colour; a fire dancer reads against the forge in `w-forge-lock`; no black voids filling half the frame; the hub's non-live gates show their worlds.

### 7. The redwoods and the temple: finish (priority 2, waits for the engine fix; parallel with 6)
Protect what is there and finish it: lanterns with paper, glow and flicker; boughs with taper and foliage; the redwoods' gate moved out of the stage's composition; the temple's stone weathered and stained instead of pink noise, carving in relief, and the moon with a halo.
**Owns:** `src/worlds/redwoods/`, `src/worlds/temple/`.
**Done when:** the `w-redwoods-*` and `w-temple-*` sheets re-shot keep their light and lose the ping-pong lanterns, the cardboard stone and the clip-art glyphs; in the redwoods' lock no dancer stands in front of a disc.

### 8. Gems and the mixed hearts (priority 3)
The heart of a mixed body glows through its outer matter (fire dims where it overlaps the heart, and the heart emits), the geode heart is a real faceted geode, and the gems kind stops drawing its spare stones as streaks when nobody wears gems.
**Owns:** `src/matter/gems/`, `src/matter/core/presets.ts`.
**Done when:** `el-ember`, `el-geodeheart` and `el-tide` re-shot show the heart clearly at 2.3 m and as a glow at 6 m.

### 9. Phones and laptops: the budget (priority 2)
Measure the staged scenes (`critic-timings.json`) on a mid-range laptop GPU and a recent phone over the tailnet, set fill budgets per kind (sprite size and resolution, not only counts), and make `coarse` and the autoscaler hold 60 fps on the laptop and 30 fps on the phone.
**Owns:** `src/engine/perf.ts`, `src/engine/limits.ts` (with `limits.wgsl`), a new `scripts/perf-remote.mjs`. It hands numbers to the owners of 1, 2 and 5 rather than tuning their folders.
**Done when:** a table of ms per pass for the six staged scenes on the laptop and the phone; the clash scene at 60 fps on the laptop after 1 and 5.

### 10. The films (priority 3; tooling now, shooting last)
Turn `scripts/critic-cap.mjs` into the film tool: a timeline file per film (cues, camera paths and splines, moves on the music's beat from `bend.music`, gate crossings), the offline score muxed in as `film.mjs` does, at 1920x1080 and 60 fps with the master quality.
**Owns:** `scripts/` (the film tooling and timelines), `src/engine/film.ts`.
**Done when:** both films below render end to end with sound, no text, no frame that shows a known bug from this report.

## The shot lists for the final films

Both are 1920x1080, 60 fps, no text, with the score from the music engine. Camera notes use the rig's terms (`yaw`, `dist`, `pitch`, `fov`, follow or locked). Times are in seconds. They assume tasks 1 to 7 are in, and fusion from the jogo agent.

### Film 1, "Energy Bending" (the whole idea), about 70 s

| # | time | world | loadouts | action | camera | music |
|---|---|---|---|---|---|---|
| 1 | 0 to 6 | redwoods, 19:40 | asleep heaps | dusk light through the trunks, fireflies; two heaps in the meadow smoulder and glisten | crane down from `canopy` (pitch -0.5, 7.6 m) to `wide` | a held low drone, the forest's ambience |
| 2 | 6 to 12 | redwoods | fire, water | they rise: flame climbs from the feet of one, water runs up the other | slow push in, 5 m to 3 m, yaw drifting 0.05/s | the first pulse, the stone score's bell |
| 3 | 12 to 20 | redwoods | fire, water | ginga facing each other; a meia-lua answered by an esquiva, an armada by a rolê, on the beat | free, side-on (yaw across their line), 4 m | the groove enters, 112 bpm |
| 4 | 20 to 26 | redwoods | fire becoming plasma, water becoming ice | forms shift as the tension rises: violet threads and an arc between the hands; the freeze climbs the other body; a steam front where they touch | close, 2.5 m, orbit at 0.2 rad/s | brighter, the plasma's buzz |
| 5 | 26 to 30 | redwoods | plasma, ice | lock: the camera swings to side-on with a long lens; the log, the boughs | the lock's ease (1.1 s) | the beat drops to the kick |
| 6 | 30 to 38 | redwoods, locked | plasma, ice | a jogo across the ledges: an aú onto the log, a jump to the bough, a martelo slipped by a macaco; an ice bridge sets under a cartwheel | locked, the game screen | the jogo's call and response |
| 7 | 38 to 46 | redwoods | fusion | the tension peaks: they fuse, matter swirls into one body (steam, white with cyan and orange licks), the vortex pulls fireflies in | unlock to free, rise to `high`, slow orbit | the drop: eight bars of the fusion pad |
| 8 | 46 to 50 | redwoods | fire, water | they part and walk toward the gate | follow behind the pair, 3.6 m | a breath |
| 9 | 50 to 56 | redwoods → geode | fire, water | through the disc: the geode seen live inside, then the crossing; half a body in each world | follow, through the face (focus held on the dancers) | a rising sweep; the retone on crossing |
| 10 | 56 to 64 | geode hub | fire, water | the hub: four gates live round them, the crystal wall glittering; a last exchange on the shelves | wide (`crown`, 7 m, pitch 0.8) slowly descending | the geode's own key |
| 11 | 64 to 70 | geode | fire, water | they stand facing, hands nearly touching, steam rising between; the light falls | hold, then fade | resolve to the drone |

### Film 2, "Fire and water" (pure beauty, one take), about 60 s

One continuous camera, no cuts, in the temple at moonrise, then the moon fully up.

| # | time | loadouts | action | camera | music |
|---|---|---|---|---|---|
| 1 | 0 to 8 | fire (left), water (right) | still, on the drowned court, facing; the moon behind the lintel; their reflections | starts 9 m back, low over the water (pitch 0.03, height 0.5), dolly in at 0.4 m/s | the temple's tide, one held chord |
| 2 | 8 to 20 | fire, water | slow ginga; the fire lights the altar's carving; water runs down the other body, its reflection rippling | the dolly continues and begins to arc left round them, 6 m | the pulse, slow (90 bpm) |
| 3 | 20 to 32 | fire, water | an armada thrown slowly: a wing of flame over the water; the water dancer's aú throws an arc of spray through the moonlight | close, 3 m, arcing between them at 0.15 rad/s, pitch rising to 0.2 | the melody |
| 4 | 32 to 42 | fire → plasma, water → ice | the forms shift together: violet threads and the freeze climbing; a white-hot front where their hands meet, wisps boiling up | pulling back and rising to 5 m, pitch 0.35, the moon entering the frame behind them | the bright section |
| 5 | 42 to 52 | plasma, ice | an arc from hand to hand; ice dust glittering down onto the water | a slow orbit at 5 m, the lintel and the moon passing behind | the peak, held |
| 6 | 52 to 60 | fire, water | the forms ease back; they bow; the flame and the water settle into their reflections | rise to `high` over them and hold on the reflection of the moon among the ripples | resolve, the tide alone |

