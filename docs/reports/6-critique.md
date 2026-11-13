# Wave 5: the second critic's look, and the plan for the last stretch before filming

Everything below was rendered on the RTX 5090 through headless Chrome against a dev server on port 5396, every capture
one take per run under the shared render lock (the longest hold 87 s, a cold first page load; the rest 8 to 53 s). The
takes are `scripts/steps/critic6.json`, written by `scripts/steps/critic6-gen.mjs`, run with
`node scripts/critic-cap.mjs scripts/steps/critic6.json --only <take> --prefix 6 --shots shots/critic6`; the menus with
`scripts/steps/jogo-menus.mjs`. I looked at every sheet named here and at the stills full size. The four fusions were
driven **through the jogo** (the Pool script with form presses at beat 27.5, `bend.jogo.stats()` confirming
steam / prism / storm / aurora), not through `field.fuse` by hand. **Not looked at:** a laptop or a phone, anything by
ear, a real person playing, a network, the results screen (the jogo agent's stills only), set pieces being built, the
release's ring in the temple. One staging failed: `film1-gate` (an `intent` of `moveY: 1` did not walk the player, so
no crossing was filmed); for the gate I rely on the integration's `5-gate-*` sheets.

## The verdict in ten lines

1. This is now a game with a look. The redwoods jogo at 1080p (`6-t-redwoods-jogo-0p5.jpg`) and plasma against ice in the geode (`6-partner-geode-16.jpg`) are real game screens; fire is fire (`6-film2-dolly-3p6.jpg`: an armada throws a wing of flame over the temple's water).
2. Since the first critique, everything it called broken is fixed: fur, black needles, the horizon hole, the mirror smear, the camera lost at the gates, the 7 ms clash (now 1 ms). That was the right list and it was done well.
3. What stands between this and a portfolio film is now three things, in this order: **the fusion, water, and white-out.**
4. **The fusion is the worst-looking minute in the game** and it is 40 % of a jogo's climax (`6-jogo-arc-sheet.jpg`). All four kinds look the same: two blue-outlined gummy figures with pink mush inside, white rectangular dashes round them, a grey plume, a pixel-shattered reflection (`6-fusion-*-pool-sheet.jpg`). The reference (`element-looks/05` to `08`) is one figure made of a new medium.
5. **Water is a blue gummy bear** with a uniform cyan outline, self-lit, beside a fire that is lit, shaped and alive (`6-el-fw-redwoods-close-1p2.jpg`, `6-el-water-solo-close-1p2.jpg`). It is the single most "cheap" element now, and it is in every fire-and-water shot of both films.
6. **White-out:** fire and plasma cores and the fusion's landing burn to flat white discs (`6-partner-geode-16.jpg`, `6-fusion-steam-pool-f30.jpg`); a fire seen from the side in the temple is a white bar (`6-film2-dolly-sheet.jpg`, first row).
7. The free camera has no clearance for most worlds: an orbit at 8 m passes through the geode's shelves and blades, the temple's columns and the redwoods' log (`6-w-*-sheet.jpg`). Films must use scripted paths or this must be fixed.
8. Worlds: redwoods and temple are film-ready; the geode reads as a place now but the first thing anyone sees is an empty dark floor (`6-first-4.jpg`); the Pool is a black void for two thirds of a turn; the forge is unchanged in substance and should not be in a film.
9. Cost is not a problem on this GPU: 1.6 to 3.2 ms a frame at 1920x1080 for every scene the films need.
10. **First change: rebuild the fusion as one body of a new medium** (fire's field with a per-kind ramp, water stepping back), and fix the glow and steam-front artefacts that make it look broken. **Second: water's shading and silhouette.** Third: a highlight shoulder so nothing blows to a white disc. Then film.

## Evidence (`docs/reports/media/6-*`, committed JPEGs; the MP4s are in `6-film/`, ignored)

**The game as a player meets it**
- `6-first-sheet.jpg`, `6-first-4.jpg`: the root address with no choice made, 8 s: an empty purple floor, a fog column, blades cut off at the top. No dancer in frame.
- `6-menu-front.jpg`: the front over the show (`jogo-menus.mjs`).
- `6-first-play-sheet.jpg`: `?play`: the player's gems stream in as a comet and stand up as a body. Lovely, but small and dim in a dark frame.
- `6-jogo-arc-sheet.jpg`: the whole Pool script at 2 fps (40 s): exchanges, the thread, the invitation, 16 s of fusion, the release.

**The fusion, all four kinds, frame by frame at 12 fps round the landing (9 s each)**
- `6-fusion-steam-pool-sheet.jpg`, `6-fusion-prism-pool-sheet.jpg`, `6-fusion-storm-pool-sheet.jpg`, `6-fusion-aurora-pool-sheet.jpg`; `6-fusion-steam-temple-sheet.jpg`, `6-fusion-aurora-temple-sheet.jpg`.
- `6-fusion-steam-pool-f30.jpg`: the landing: a hard-edged disc, light above the horizon and black below it, cuts the Pool behind the pair.
- `6-fusion-steam-pool-f60.jpg`: mid-fusion: the blob, the white dashes, the shattered reflection.
- `6-fusion-storm-pool-f60.jpg`: storm: vertical white pills for rain, a pale hard-edged rectangle behind the heads.
- `6-fusion-aurora-pool-f100.jpg`: aurora mid-way: a green-violet plume, dashes, a white foam heap on the floor.
- `6-fusion-aurora-temple-f60.jpg`: aurora in the temple: a crouched knot on the altar.

**Elements (15 fps, 3.2 s, an armada then an aú, slow orbit)**
- `6-el-fw-temple-close-sheet.jpg`, `6-el-fw-redwoods-close-sheet.jpg` (+ `-1p2.jpg`), `6-el-fw-temple-wide-sheet.jpg`: fire and water.
- `6-el-ip-temple-close-sheet.jpg`, `6-el-ip-redwoods-close-sheet.jpg` (+ `-1p2.jpg`): plasma and ice.
- `6-el-water-solo-close-sheet.jpg` (+ `-1p2.jpg`): two water dancers in the temple, 1.9 m.

**Worlds (a 12 s orbit at 8 m with a fire and a water dancer)**: `6-w-geode-sheet.jpg` (+ `-6.jpg`), `6-w-pool-sheet.jpg`, `6-w-temple-sheet.jpg`, `6-w-redwoods-sheet.jpg`, `6-w-forge-sheet.jpg` (+ `-3.jpg`).

**Motion and brains**: `6-partner-temple-sheet.jpg` (+ `-24.jpg`) and `6-partner-geode-sheet.jpg` (+ `-16.jpg`): 30 s against the partner at 5 fps, seat 0 pressed by a script, the roda round them; `6-partner-temple-motion-sheet.jpg`: 6 s at 20 fps.

**Film stagings (1920x1080)**: `6-film2-dolly-sheet.jpg` (+ `-3p6.jpg`): film 2's opening dolly in the temple; `6-film1-rise-sheet.jpg` (+ `-3.jpg`): film 1's rise at dusk; `6-t-redwoods-jogo-0p5.jpg`: the redwoods jogo at 1080p.

## Findings

Marked **broken** (wrong), **weak** (works, falls short) or **could be wonderful**. Confidence is about the cause.

### What is already wonderful: do not touch

- **Fire** (`6-film2-dolly-3p6.jpg`, `6-el-fw-*-sheet.jpg`): contours, dark gaps, red tips, a wing of flame on an armada, firelight on grass. Only its brightest core needs a shoulder (below); leave its shape alone.
- **Plasma** (`6-el-ip-redwoods-close-sheet.jpg`): violet filaments, arcs to the ground, the best element against its reference.
- **The redwoods at dusk** (`6-w-redwoods-sheet.jpg`, `6-t-redwoods-jogo-0p5.jpg`): fog, warm backlight, flowers, the log. The best world.
- **The temple at moonrise and at its orange side** (`6-w-temple-sheet.jpg` rows 1 and 2): the strongest single backdrop for film 2.
- **The gems streaming in to become a body** (`6-first-play-sheet.jpg`, first row): a comet of stones that stands up. It should be in film 1.
- **The locked jogo with plasma against ice in the geode** (`6-partner-geode-sheet.jpg`): legible, colourful, the roda behind; a real game.

### The game as a player meets it

- **Weak: the first thing anyone sees is an empty floor** (`6-first-4.jpg`). The root page shows a fogged agate floor and the bottoms of crystal blades: no dancer, no gate, no light event. The front's panel then covers the lower half of the screen (`6-menu-front.jpg`). *Cause (high):* the show's default camera frames a spot where nothing stands until a choice is made. For a portfolio link this is the first two seconds. Fix: frame the show's two dancers dancing under the hub's lit crown, with one live gate behind them, and put the front's panel to the side or lower third so the bodies stay visible.
- **Weak: the front is a generic dark-glass form** (`6-menu-front.jpg`): 20 identical small dots in two rows with 9 px grey labels ("geodeheart-water"), five more dots for worlds. You choose a body by reading a word under a dot. The rule says icons and short labels; this obeys it but is not beautiful. Choosing a body should be done by seeing it: the two dancers in the scene re-dress live as you step through presets (the hooks exist: `bend.dress`), and the dots become the matter (a fire swatch that flickers, a water one that runs). Medium priority: the films do not show menus.
- **Weak: in play the HUD is legible and in the right spirit** (`6-jogo-arc-sheet.jpg`): the thread between chests, rings at the feet, beads. It needs no text. Two problems: in the side view the thread is a thin line that is lost against fire (`6-t-redwoods-jogo-0p5.jpg`: it reads only against the grass), and the invitation's "both hold merge" has no visible prompt beyond the thread tightening; a new player will not discover merge. *Suggestion:* when the thread is taut, the two hands that would merge glow and pulse on the beat (a gesture, not a word).
- **Where a new player is lost:** what the buttons are (no text, no teach unless `?teach`), what merge is, and that gates are the level select. `?teach` exists (the brains' teacher) but nothing offers it. The game should open the first jogo with the teacher by default.

### Elements

**Water: broken as a look, high confidence on the causes** (I read `water/surface.wgsl`, `water/params.ts`).
- `6-el-fw-redwoods-close-1p2.jpg`, `6-el-water-solo-close-1p2.jpg`, `6-film2-dolly-3p6.jpg`: a saturated blue body, nearly opaque, with a thick cyan outline of constant width all round, white smears inside, a rounded "gummy" silhouette with no wisps or tendrils. Beside fire it looks like a toy.
- *Causes:* (1) the rim `wc += rim * rimStrength * (1 - smoothstep(0.22, 0.62, Wr))` is added wherever the smoothed thickness is low, which is a band of the same width round every silhouette, unrelated to light or view angle: the thick cyan outline. (2) The body is **emissive**: `mix(thin, deep) * (0.35 + 1.5 rp²) * glow` with `glow` 1, so it glows the same blue in the moonlit temple, the redwoods' warm dusk and the Pool's black, never lit by the world. (3) `opacity` 0.85 and `refract` 0.02 hide the world behind it, so it reads as a solid. (4) The silhouette is the capsules smoothed: `wobble` 5 mm and `noiseAmp` 8 mm are invisible at body scale, `bulge` 2.2 cm is a swell inside the outline; nothing ever leaves the outline except drops, so the edge is always a smooth round contour. (5) The highlights use a light fixed to the view (`Lv`, power 56), not the world's key, so they are white blobs that don't move with the moon.
- Against the reference (`element-looks/09`): pale cyan-white luminous water whose edges break into curling wisps and spray; the colour is mostly white-cyan with deep blue only in folds. Against the fire beside it: fire is shaped by its edge, water is shaped by an outline.
- **Ice: weak, but acceptable** (`6-el-ip-redwoods-close-sheet.jpg`, `6-partner-geode-16.jpg`): faceted steel-blue glass with a white outline. Reads as a stained-glass suit, and from some poses as a bent tube (`6-partner-geode-16.jpg`). The same uniform rim (here white, `iceThick.w`) is the main cartoon cue. Ice is not in either film's critical path; it inherits the rim fix.
- **Water asleep is a flat cyan pancake** (`6-film1-rise-sheet.jpg`, frames 5 to 8; `6-jogo-arc-sheet.jpg` frame 1): the heap is a smooth lozenge with the rim round it. Film 1 opens on it.

**Fire: could be wonderful, one fault.** Its core burns white over the torso in most frames (`6-el-fw-redwoods-close-1p2.jpg`, `6-partner-temple-24.jpg`); side-on at 6 m in the temple it is a white bar with orange edges (`6-film2-dolly-sheet.jpg`, frames 3 to 6). *Cause (high):* `composite.wgsl`'s ramp `pow(T, (1, 2, 3.6)) × (1.75, 0.95, 0.6)` has all three channels above 1 once T passes about 1.2, then the bloom (threshold 2) spreads it. There is no shoulder. **Plasma** blows out the same way at its hands (`6-partner-geode-16.jpg`: a white disc larger than its head).

**Fire behind water glows through it: broken** (`6-partner-temple-24.jpg`: the fire dancer's arm and body are seen through the water dancer, added over it). Known (5-integration open item 2), still true, and it happens in every overlapping exchange of the side view.

**The roda's free dancers** (`6-partner-geode-16.jpg`, `6-t-redwoods-jogo-0p5.jpg`) read as sand figures: grainy one-colour gem point clouds. In the background at 1080p they are acceptable; in film close-ups they would look unfinished. Low priority.

### The fusion (frame by frame, all four kinds)

Read: `play/fusion.ts`, `play/glow.wgsl`, `matter/reactions/steam_front.wgsl`, `matter/field/field.ts` (fuse), `matter/water/drops.wgsl`, `post/air.wgsl`, `post/post.wgsl` (trails), `worlds/water/water.wgsl` (the reflection).

What happens on screen, in order (`6-fusion-steam-pool-sheet.jpg`):
1. Gathering (0 to 2 s): sparks drawn to the middle, a small glow. Fine, a little thin.
2. **The landing (2 to 2.5 s): broken.** A soft disc up to 1.7 m across flashes, and where its core is bright it cuts a hard-edged circle out of the scene: lit above the horizon, **black below it** (`6-fusion-steam-pool-f30.jpg`). A flat ring then lies on the water as a pale band with a straight upper edge. *Cause (medium-high):* `glow.wgsl` writes its view distance into the glow target's alpha wherever `v > 0.4` (`select(1e5, i.dist, v > 0.4)`), a binary mask; the air takes the glow's alpha as the nearest focus (`near = min(g.a, …)`) and fogs, focuses and composites the Pool behind it as if a body stood across that whole disc. The same alpha trick on the stream segments is why they keep hard edges in a blurred frame (next).
3. **The eight bars: broken as design.** All four kinds show the same thing: both dancers keep their own shape, each now water-outlined with fire inside (pink mush in a blue jelly), crouched against each other into one blob (`6-fusion-steam-pool-f60.jpg`). *Cause (high):* `Fusion.mix` mixes the loadouts both ways (`mixLoadout(a, b, 0.32)` then 0.5), so each body gets water, and water's surface (the rim, the opaque blue) draws over everything inside it: the water body becomes the fusion's look. The kinds differ only in the steam plume's tint (grey, green-orange, violet) and in storm's rain and arcs.
4. **Rectangular sparks: broken.** Hundreds of small white or tinted dashes with hard ends round the pair, horizontal in every kind (`6-fusion-steam-pool-f60.jpg`, `6-fusion-aurora-pool-f100.jpg`), vertical pills for storm's rain (`6-fusion-storm-pool-f60.jpg`). *Cause (medium; two sources):* (a) the jogo's streams, 180 `G.seg` segments 6 cm long orbiting a vertical axis, drawn by `glow.wgsl`, which writes its distance into alpha where it is bright so the lens keeps that core sharp and blurs the rest away: a pill with a hard edge in an otherwise soft frame; storm's 50 rain segments are the same; (b) steam's **fronts** (`steam_front.wgsl`): with the loadouts mixed, every body is fire against water everywhere, so fronts (white-hot streaks drawn at full resolution after the lens, tinted per kind) are born all over both bodies and carried round by the fusion's vortex. Not separated by an A/B this session.
5. **The reflection: broken.** In the Pool the pair's reflection is a column of vertical pixel blocks (`6-fusion-steam-pool-f60.jpg`, `6-fusion-storm-pool-f60.jpg`); in the temple it is better but still torn (`6-fusion-aurora-temple-f60.jpg`). *Cause (medium-high):* the Pool's water reflects water bodies by marching the merged scene on screen (`water.wgsl` `waterReflect`, jittered, over a sharp-edged merged body) with the ripple normal; where the ripples are strong (the fusion splashes and the release rings) the march lands on different rows column by column. It is the same on any water dancer near ripples (`6-el-fw-temple-close-sheet.jpg`, last frames), most visible in the fusion because the bodies stand in the splash.
6. **The vapour is capped by design**: steam's `cap` 0.45 and `maxBright` 0.85 (the anti-whiteout rule from the first critique) also cap the fusion's plume, which therefore can never become the reference's luminous body; it stays a grey smoke column behind the pair.
7. **Pose:** the script's "both hold merge" brings the dancers to 0.32 m and they crouch into each other (macaco, spin): from the side the fused figure is a squat knot (`6-fusion-aurora-temple-f60.jpg`). The reference figures stand tall.
8. **Release and parting (7 to 9 s and the arc sheet):** the parted bodies keep a cyan puddle "sheet" spreading on the floor (`6-fusion-steam-pool-sheet.jpg`, rows 2 and 3) and a white foam heap (aurora, storm). Weak.

**Confidence that the fusion's look is the loadout mix plus water's surface: high.** It is visible in every frame: no element other than water draws an outline.

### Worlds

- **Redwoods: wonderful.** Weak: the cut end of the log reads as an orange plastic clam shell with wood grain (`6-t-redwoods-jogo-0p5.jpg`, left); the free orbit passes through the log and a bough (`6-w-redwoods-sheet.jpg`). The lantern in front of the lock camera did not appear in my lock frames (`6-t-redwoods-jogo-0p5.jpg` shows a faint disc at the top centre only); I did not re-shoot the integration's exact framing.
- **Temple: could be wonderful.** The moonlit side and the orange side are both beautiful. Weak: on the orange side, columns turn a flat untextured grey-white (`6-w-temple-sheet.jpg`, row 2) like an unlit CG block-out; the columns' waterlines carry a row of glittering pixel noise (`6-fusion-aurora-temple-f60.jpg`, right); texture edges ghost on capitals. The orbit drives through columns.
- **Geode: weak but usable.** It has depth and coloured bokeh now (`6-w-geode-6.jpg`). The free camera is inside shelves and blades for a third of an orbit (`6-w-geode-sheet.jpg`); in the menus' framing the shelf above is a plain lavender slab.
- **Pool: weak.** A black void for two thirds of a turn (`6-w-pool-sheet.jpg`); beautiful only facing the moon. Fine for one locked shot toward the moon; keep it out of orbits.
- **Forge: weak, the weakest, unchanged in substance** (`6-w-forge-sheet.jpg`, `6-w-forge-3.jpg`): black hex blocks, a flat red sea, a hard green aurora band. Do not film it; do not spend the last stretch on it.

### Motion and brains

- **Could be wonderful: plasma against ice in the geode, 30 s** (`6-partner-geode-sheet.jpg`): the partner keeps distance, answers, an arc to the floor, rings at the feet on the beat; it reads as a conversation from the side.
- **Weak: the temple, 30 s** (`6-partner-temple-sheet.jpg`, `6-partner-temple-motion-sheet.jpg`): seat 0 jumps onto a column stub and stays up there for much of the take while the partner stands in the water below; the two meet across a height gap, and late in the take a column stands between the camera and the dancers (`6-partner-temple-sheet.jpg`, row 3). From the side the dancers overlap often, and fire then shows through water. *Cause (medium):* the temple's stage puts ledges (stubs) in the line; the locked framing does not avoid occluding columns.
- **Weak: machinery.** At 20 fps (`6-partner-temple-motion-sheet.jpg`) the partner's play is a loop of step-in, move, step back; between exchanges both dancers ginga in place facing each other. It reads as a game, not yet as capoeira's circling and inversion. The brains agent's own list (echoes at a fixed 3½ beats, the shuffle before an attack) is consistent with what I saw; I could not hear the music, so the conversation in time was not judged.
- **The roda** stands at the edges and dances its own groove; in the side view it frames the stage well (`6-t-redwoods-jogo-0p5.jpg`).

### Camera and the game screen

- **Could be wonderful:** the locked side view at 1080p in the redwoods (`6-t-redwoods-jogo-0p5.jpg`) and the geode (`6-partner-geode-16.jpg`): both dancers whole, a third of the frame high, the roda behind. This is the game screen.
- **Broken for films: the free camera has no clearance** in the geode (blades, shelves), the temple (columns) and the redwoods (log, boughs): `6-w-*-sheet.jpg`. `World.clear` exists for the redwoods' trunks only. For the films this is avoidable with scripted paths; for players it is a fault.
- **Weak: occluders in the locked view** (a temple column in front of the dancers, `6-partner-temple-sheet.jpg` row 3).

### Post and grade

- **Broken: blown cores** (fire, plasma, the fusion's landing): above.
- **Broken: the jogo's glows write a binary focus distance** (the landing disc, the pill-shaped sparks): above.
- **Weak: reflections on rippled water** are torn into pixel columns (the Pool most); fire's mirror copy is a perfect unrippled mirror (`6-film2-dolly-3p6.jpg`: the fire's reflection is crisp under rippling water while the columns' reflections ripple).
- **Weak: the depth of field is strong at film distances** (`6-film2-dolly-3p6.jpg`: the fire, a metre nearer than the water, is soft). Choose per shot in the films.

### Performance (RTX 5090, 1920x1080, weft's profiler over 150 stepped frames)

| scene | frame | top passes (ms) |
|---|---|---|
| temple, fire and water, 4 m | 1.95 | scene 0.40, fire.splat 0.17, glow 0.12, water depth 0.12, air 0.11, surface 0.10 |
| redwoods at dusk, fire and water, 4 m | 2.89 | air 0.86, scene 0.78, glow 0.12, water depth 0.11 |
| redwoods jogo, locked, roda of four | 3.23 | scene 0.99, air 0.88, glow 0.13, fire.splat 0.11 |
| hub, fire and water, 6 m | 1.62 | scene 0.24, air 0.15, glow 0.12 |
| Pool fusion (steam), mid-fusion | 1.75 | fire.splat 0.18, water.surface 0.16, water depth 0.12, glow 0.12 |

No film scene needs more than 3.3 ms here: rendering offline at 60 fps with any quality setting raised (smoothing, resolution, more flames) is affordable. The redwoods' fog march (air 0.86 ms) is the largest single pass and the first thing to scale on a laptop.

## Water: what to change (read: `water/surface.wgsl`, `water/params.ts`, `water/sim.wgsl` header, `water/drops.wgsl`)

**First choice: shading and silhouette in the existing surface (low risk, about +0.1 ms).**
1. **Remove the uniform rim.** Replace `rim × (1 - smoothstep(0.22, 0.62, Wr))` with a rim that is (a) Fresnel-weighted on the reconstructed normal, (b) lit by the world's key (`worldKey`) so it sits on the side the light comes from, and (c) broken by the flowing caustic noise, with its width capped in pixels (one to two) instead of in thickness. The reference's cyan lives where the fluid is thin *in its interior* (wisps), not as a contour.
2. **Light it, don't glow it.** Lower `glow` to about 0.25, keep the caustic as the self-light; add the world's diffuse and key (`worldKey`) on the normal; take the highlights from the key's direction instead of the view-fixed `Lv` (keep `Lv` as a weak fill so the darkest worlds still show a highlight). Make `thin` near white-cyan (#cfefff) and keep deep blue only where thick (`smoothstep(0.6, 1.4, Wr)`), as in `09`.
3. **Let the world through.** `opacity` 0.85 → 0.45, `refract` 0.02 → 0.06 with the existing dispersion; the temple's columns and the redwoods' grass seen bent through the body is what makes it water instead of plastic.
4. **Break the silhouette.** In `sim.wgsl`, give the outer layer of particles (the ones farthest from their capsule's axis) a curl-noise displacement of 2 to 4 cm that rises along the body (the flow already runs down; let the outside curl up), and let 5 to 10 % of them leave the outline as short-lived streamers that rejoin (fire's tongues, in water's colours). Raise `noiseAmp` and `wobble` to centimetres. The edge, not the interior, is what the eye reads.
5. **The asleep heap and the puddle:** apply the same rim change; give the heap the floor film's look (it is a puddle, not a lozenge).
6. **Narrower smoothing (`smooth` 0.05 → 0.03)** once the silhouette has detail, so the detail survives.

**Fallback: draw water's edge as a field, the way fire is drawn.** Keep the surface for the body's core (normals, refraction), but splat the outer and flying particles' "amount" into a half-resolution target per view, and composite it with the 2D reference's water ramp and flow-advected display noise (the machinery of `fire/splat.wgsl` and `fire/composite.wgsl`, copied into `matter/water`, not shared). This gives `09`'s wisps for free and makes water and fire one visual language. Cost: about fire's, 0.1 to 0.2 ms per view; risk medium (one more target per view, and the gate views).

**Done when:** `6-el-fw-redwoods-close` and `6-el-water-solo-close` re-shot show no constant-width outline, a body whose highlights move with the world's light, the background seen through it, and an edge that breaks into wisps in at least half the frames; beside fire in `6-film2-dolly` at 3.6 s it reads as the same quality of matter; water costs ≤ 0.2 ms more than today at 1080p.

## The fusion: what to change (read: `play/fusion.ts`, `play/glow.wgsl`, `reactions/steam_front.wgsl`, `field/field.ts`, `fire/composite.wgsl`)

**First choice: one body of a new medium, drawn by fire's field (medium risk, near zero cost).**
Fire is now a screen-space temperature field: two flame bodies near each other *sum into one contour*. That is exactly what a fusion should look like.
1. **Change what the loadouts become.** In `Fusion.mix`, instead of mixing water into fire and fire into water, give both bodies mostly flame (about 80 % of the fire pool's layer, `params: { fusion: kind }`) and only a little of their own matter (water as a few streaming highlights, gems hearts kept). Water's surface then stops drawing the outline over the pair.
2. **A ramp per kind in fire's composite.** Fire's composite already blends ramps by the splatted `form` (fire, torch, plasma). Add a fusion uniform (kind, amount) and four ramps applied to the summed field during a fusion: **steam** white body with cyan and orange licks (`05`), **prism** thin-film colour by T and the flow noise (`06`), **storm** violet body with the arcs inside (`07`; the arcs exist), **aurora** cyan-white core with violet and green curtains on the noise's low band (`08`). Kept to the fire pool, gate views and mirrors come for free.
3. **Lift steam's cap inside the helix only** (cap 0.45 → about 0.8 and maxBright 0.85 → 1.2 within the fusion's radius) so the plume joins the body instead of standing behind it as grey smoke; keep the cap everywhere else.
4. **Turn off steam's fronts while a fusion holds** (fronts are a contact's hiss; inside one body there is no contact), and **stop `glow.wgsl` writing a binary focus distance**: write none (the stream light is not a surface), or write it only into the focus texture with a soft weight. This removes the black landing disc and the hard pills.
5. **Fewer, softer streams.** 180 segments → 40 to 60 longer, fainter ribbons along the helix; storm's rain as water's own drops (falling, stretched, faint), not glow pills.
6. **Pose:** the script and the rules' merge should keep the dancers standing and turning about each other (a slow volta or giro, arms up) through the eight bars, not crouching. The camera in the free view rises and orbits (it does), and in the lock widens (it does).
7. **The landing:** a ring of light on the floor that does not cut the scene (fix 4), plus a short (0.3 s) bloom pulse instead of a 1.7 m disc.

**Fallback (if 1 and 2 cannot land in time):** keep today's mix but during a fusion set water's rim to 0 and opacity to 0.2 and tint its glow by kind, turn the fronts off, make the glows soft (fix 4), and replace the Pool's screen-space reflection of bodies with the kinds' own mirror copies (water's `fs_mirror` exists) for the duration. It will look like two glowing bodies in a tinted vapour, which is acceptable, not wonderful.

**Done when:** for each of the four kinds, a still at 5 s through the jogo (`critic6.json` `fusion-<kind>-pool` and `-temple`) shows one continuous figure in the kind's colours, no water outline, no hard-edged dashes or pills, no disc cut into the scene at the landing, and a reflection without pixel columns; the four kinds are told apart at a glance in a 4-up contact sheet; frame time stays ≤ 2.5 ms at 1080p.

## The work plan for the last stretch

The film agent already owns `scripts/` film tooling and `src/engine/film.ts`; nothing below touches them. Each task owns its folders alone. "Before filming" means the first film waits for it.

| # | task | priority | owns | lands |
|---|---|---|---|---|
| 1 | The fusion as one body | 1 | `src/play/`, `src/matter/reactions/`, `src/matter/field/`, `src/matter/fire/` | before filming |
| 2 | Water that looks like water | 1 | `src/matter/water/`, `src/matter/ice/` | before filming |
| 3 | Highlights, glows and reflections | 1 | `src/post/`, `src/worlds/water/` | before filming |
| 4 | Cameras that never enter the world | 2 | `src/engine/camera.ts`, `src/engine/shots.ts`, `src/portals/` | before filming (film 1's gate shot needs it) |
| 5 | The first ten seconds: the hub and the front | 2 | `src/worlds/geode/`, `src/dancer/show.ts`, `src/dancer/programme.ts`, `index.html` (the front's styles) | can follow the first film |
| 6 | The temple and the redwoods, film polish | 2 | `src/worlds/temple/`, `src/worlds/redwoods/` | before film 2 (temple), before film 1 (redwoods) |
| 7 | The partner plays capoeira | 3 | `src/ai/` | can follow the first film |

Note on 1 and 5: `src/play/menu.ts` is in task 1's folder; task 5 changes only the front's styles in `index.html` and the show, and asks task 1 for any change to `menu.ts` (or leaves the menu's DOM as is).

### 1. The fusion as one body (priority 1, before filming)
Rebuild the fusion as described above: both bodies drawn as flame with a per-kind ramp in fire's composite, water stepping back, steam's cap lifted inside the helix, fronts off during a fusion, softer streams, and the jogo's glows writing no binary focus. Also give fire's and plasma's ramp a shoulder (channels above 1 roll toward the hue, not to white) since this task owns `fire/`.
**Done when:** the fusion's "Done when" above; and `6-el-fw-redwoods-close-1p2` and `6-partner-geode-16` re-shot show a fire core that is yellow-white with structure and a plasma hand that is violet-white, neither a flat disc larger than the head.

### 2. Water that looks like water (priority 1, before filming)
Water's surface lit by the world, no uniform outline, the world seen through it, a silhouette that breaks into wisps and streamers; the asleep heap as a puddle; ice inherits the rim change.
**Done when:** the water "Done when" above; `6-film1-rise` re-shot shows no flat cyan lozenge at 3 s; `6-el-ip-redwoods-close` re-shot shows ice without a constant-width white outline.

### 3. Highlights, glows and reflections (priority 1, before filming)
Fire behind water no longer adds through it (the air compares fire's focus with water's, or a body mask); the bloom's threshold and a highlight shoulder in the grade so nothing becomes a flat white disc; the Pool's and the temple's reflection of bodies blurred by ripple strength (or taken from the kinds' mirror copies near the bodies) instead of torn into columns; fire's mirror copy bent by the water's wave normal; the temple's waterline glitter row removed.
**Done when:** `6-partner-temple-24` re-shot shows no fire over the water body; `6-fusion-steam-pool` at 5 s and `6-el-fw-temple-close` last frames show reflections without pixel columns; `6-film2-dolly-3p6` shows the fire's reflection rippling with the columns'; lens and air ≤ +0.2 ms at 1080p.

### 4. Cameras that never enter the world (priority 2, before filming)
`World.clear` for the geode's blades and shelves, the temple's columns and the redwoods' log and boughs (or a near fade of anything inside 0.6 m of the eye); in the lock, a column or trunk between the camera and the dancers fades. A camera path API the film agent can call (keyframes in the rig's terms), if the film agent asks for one.
**Done when:** the five `6-w-*` orbits re-shot never show the inside of a solid, and `6-partner-temple` re-shot has no column across the dancers.

### 5. The first ten seconds: the hub and the front (priority 2, can follow the first film)
The root page opens on the two show dancers in the hub, lit, with a live gate behind; the front sits in the lower third and lets the bodies be seen; choosing a preset re-dresses the dancers on screen. The first jogo offers the teacher.
**Done when:** `6-first-4` re-shot shows two dancers and a gate in the first second; `6-menu-front` re-shot leaves both dancers' bodies uncovered.

### 6. The temple and the redwoods, film polish (priority 2)
Temple: texture the orange side's columns (no flat grey-white), the capitals' ghosting, the moon's halo checked at 1080p. Redwoods: the log's cut end as wood, not a shell; the lantern above the lock camera faded or moved. Nothing else: both are protected.
**Done when:** `6-w-temple` row 2 and `6-t-redwoods-jogo-0p5` re-shot lose those faults and keep their light (side by side with today's).

### 7. The partner plays capoeira (priority 3, can follow the first film)
Circling (the pair turns about each other, not only along the stage), inversions offered more often (aú, rolê, queda de rins), echoes on varied delays, the step-in shuffle replaced by the ginga's own step. Free dancers in the roda clap and turn toward the pair.
**Done when:** 30 s at 5 fps in the redwoods free view shows the pair circling through at least 180° and three inversions; a person has played it for five minutes (reported in their words).

**Not planned:** the forge (do not film it), the Pool beyond the shot toward the moon, phones (no film needs them), menus beyond task 5.

## The films, revised against the build today

Both 1920x1080, 60 fps, no text, score from the music engine. "Today" says whether the shot can be made now. Camera in the rig's terms; times in seconds.

**Lead with film 2's shot 3: in the temple at moonrise, side-on and low over the water, the fire dancer throws an armada and a wing of flame crosses the moon's path on the water, mirrored.** It can be shot today (`6-film2-dolly-3p6.jpg` is a rough version) and becomes the poster frame once water (task 2) and reflections (task 3) land.

### Film 1, "Energy Bending" (the whole idea), about 60 s

| # | time | world | bodies | action / brain | camera | music | today? |
|---|---|---|---|---|---|---|---|
| 1 | 0–6 | redwoods, hour 19.4 | asleep heaps | fireflies, the meadow, the heaps smoulder and glisten | crane down from 7 m, pitch 0.5 → 0.15, onto the meadow | low drone, forest ambience | yes, but the water heap is a cyan lozenge (task 2) |
| 2 | 6–11 | redwoods | gems | one dancer streams in as a comet of stones and stands up (the `?play` re-form) | follow at 3.5 m, side-on, slow push | the stone score's bell | **yes** (`6-first-play-sheet.jpg`), in the redwoods instead of the geode |
| 3 | 11–17 | redwoods | fire, water | the other two rise: flame climbs one, water the other | push 6 m → 3.5 m, yaw drifting 0.04/s | first pulse | yes after task 2 (`6-film1-rise`) |
| 4 | 17–27 | redwoods, locked | fire, water | the jogo against the partner brain (`?jogo=partner`, playful), roda of four: an armada and an esquiva, the thread rising between them | locked side view | the groove, 112 bpm | **yes** (`6-t-redwoods-jogo-0p5.jpg`); fire through water needs task 3 |
| 5 | 27–33 | redwoods | fire → plasma, water → ice | forms shift: violet threads, the freeze; an arc to the floor | close 2.6 m, orbit 0.15 rad/s | brighter | yes (`6-el-ip-redwoods-close-sheet.jpg`); core shoulder from task 1 |
| 6 | 33–43 | redwoods | fusion (aurora) | the invitation, merge, eight bars of one body | unlock, rise to 4 m pitch 0.35, orbit | the drop, the fusion pad | **no: task 1** |
| 7 | 43–48 | redwoods → geode | fire, water | walk through the redwoods' gate, half a body in each world | follow at 3.6 m through the disc | rising sweep, retone | needs a working walk cue and task 4 (my staging failed to walk) |
| 8 | 48–56 | geode hub | plasma, ice | a locked exchange under the crown, the roda in gems behind | locked side view | the geode's key | **yes** (`6-partner-geode-sheet.jpg`) |
| 9 | 56–60 | geode | plasma, ice | they face, hands near, an arc between them; light falls | hold, then fade | resolve | yes |

### Film 2, "Fire and water" (one take in the temple), about 50 s

One continuous camera on a scripted path (avoiding columns: task 4 or a hand-checked path), moon behind the lintel.

| # | time | bodies | action | camera | music | today? |
|---|---|---|---|---|---|---|
| 1 | 0–8 | fire (left), water (right), 2.4 m apart | still, facing on the drowned court; reflections | from 9 m, height 0.5, dolly in 0.4 m/s, fov 34 | the tide, one held chord | yes; water looks like a toy until task 2 |
| 2 | 8–18 | fire, water | slow ginga; firelight on the altar | dolly continues, arcs left to 5 m | slow pulse, 90 bpm | yes |
| 3 | 18–28 | fire, water | **the lead shot**: an armada thrown slowly, a wing of flame over the water; the water's aú answers with an arc of spray (place them ≥ 2.4 m apart: at 1.8 m the aú lands in the fire, `6-film2-dolly-sheet.jpg` row 2) | 3 m, side-on, low, arcing 0.12 rad/s | the melody | **yes** for the armada; the aú's spray after task 2 |
| 4 | 28–36 | fire → plasma, water → ice | the forms shift together; a white-hot front where hands meet | pull back to 5 m, pitch 0.3, the moon enters behind | bright section | yes; front's white disc needs task 1/3 |
| 5 | 36–46 | fusion (steam) | invitation and eight bars standing tall on the court, the plume over them | slow orbit 5 m, lintel and moon passing behind | the peak | **no: task 1** (today it is a knot on the altar, `6-fusion-aurora-temple-f60.jpg`) |
| 6 | 46–50 | fire, water | the release: a ring of ripples across the court; they part and bow | rise to 7 m over them, hold on the moon's reflection | resolve, tide alone | yes for the ripples; the parting's puddle sheet wants task 2 |

## Step files and helpers added

`scripts/steps/critic6-gen.mjs` (writes `critic6.json`: the fusions through the jogo with form presses, the elements in the film worlds, the partner in two worlds, the worlds' orbits, the film stagings, the 1080p timings). Every take runs alone under a minute. The `film1-gate` take does not walk the player (an `intent` hold doesn't drive `?play` here); fix it before reuse.
