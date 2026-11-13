# Wave 4: the second integration

All eleven branches of the second wave are merged into `master` with their history (`--no-ff`): the depth contract
and the lens, fire as a field, water and ice, steam fronts, gems and hearts, the hub, Pool and forge, the redwoods and
the temple, cameras through gates, the jogo, the device budget, then the brains. The seams between them are joined
(the table below says which are verified by eye and which are not), and the critic's step files were re-shot on the
merged build and looked at beside the critic's own frames.

**Measured:** after every merge `npm run typecheck`, a build, `npm test` and a headless still that the app boots; the
whole `npm test` again at the end (limits, the binding budget, 6 TS test files, audio, 10,023 gate checks, the net
tests: all pass; the net smoothness test failed once under load mid-session, as in every earlier report, and passed
on its rerun). Every still named below was captured on the RTX 5090 through headless Chrome and looked at. Captures
ran against a production build served by `vite preview` on port 5392 (built into the scratchpad); every capture held
the shared render lock for one run of at most about 50 s and released it. GPU timings are weft's profiler over 150
stepped frames. **Not measured:** a laptop or a phone (the perf branch's service on 5441 still waits for the MacBook),
anything by ear, a real gamepad or a person playing, a network, a long soak, the films (task 10).

## What merged, and how each conflict was resolved

weft went to **0.2.9** first, as its own commit (`265abe4`): its changelog says additions only (`View.globals`, the
TAAU's `motion`, `Frame.jitterNdc` after the 0.2.8 fields; shaders that don't read them are byte-identical). The
lockfile and every regenerated `*.d.wgsl.ts` are in that commit; from then on typings were never merged by hand: each
merge was built and whatever weft's plugin wrote was committed.

| # | merge | conflicts | resolution |
|---|---|---|---|
| 1 | depth and lens (`a739d9f`) | none | — |
| 2 | fire (`a6c4ca5`) | `matter/core/kind.ts` | **one** `focus?(view: ViewCtx): Texture \| null`, documented: "nothing" is ≥ 1e4, compare, never do arithmetic. Fire's composite now lays its light into the view's **glow** target, not the opaque scene (below) |
| 3 | water and ice (`af58bf7`) | `kind.ts` (a duplicate import) | the one declaration kept; water's `distAlpha` stays off (default). The post chain's focus slots are filled each frame from the kinds that return a texture (water and ice share one pool and one surface; counting kinds warned "3 kinds, more than FOCUS_SLOTS") |
| 4 | steam (`ae061af`) | none | `post.sceneTex` is the air target: its alpha is the opaque distance (or a water body's, from the merge), finite, so steam's three draws needed no change |
| 5 | gems (`aee50be`) | none (`particle.wgsl`'s pads → `hold`, `trailCap`, `pad0` merged clean) | typings regenerated |
| 6 | hub, Pool, forge (`a5af3e5`) | none | typings regenerated (the light struct grew) |
| 7 | redwoods, temple (`a4c22b2`) | none | typings regenerated |
| 8 | cameras (`a47b755`) | none | — |
| 9 | the jogo (`a9723fd`) | `engine/camera.ts` | the cameras' locked framing kept (fifteen joints, lead, safe area, composed angle, clearance); the jogo's `framePad` widens its margin (`0.3 + framePad` across, `0.6·framePad` up and down) |
| 10 | perf (`a2387dd`) | none | — (its `docs/reports/perf/*.json` came along as copies; the worktree's files and the 5441 service were not touched) |
| 11 | brains (`ab7d89c`) | `src/main.ts` | the brains' wider `?play || ?roda || ?teach` block with the cameras' `gates.seen(gates.rigWorld, …)` |

`kind.ts`'s `focus` had been spelled three ways; `limits.ts`, `frame.ts`, `views.ts`, `scene.ts`, `film.ts`,
`world.ts`, `light.wgsl`, `post/**`, `portals/**`, `shared/rules.ts`, `session.ts`, `index.html`, `package.json` and the
step files all merged without conflict (each agent had kept to its own structs and cases).

## The seams

| # | seam | state |
|---|---|---|
| 1 | the depth contract everywhere | **joined and verified.** Scene alpha is the opaque distance only. Fire no longer writes alpha (its min-blend was already gone in its branch); its composite goes into the main view's **glow** target, so the air fogs it at the fire's focus distance and neither the Pool's water nor the merge of water bodies can take a flame for a surface; its mirror draw no longer returns 1e5 (fire's splat writes no alpha at all). Water writes colour only and returns its focus. Steam reads the air target's finite alpha. Verified: no rectangle at the Pool's horizon behind fire or water (`5-ba-el-fire-close.jpg`, `5-ba-el-water-close.jpg`), no smear on the geode's floor (`5-ba-moves-fire.jpg`: the fire's reflection shows in the agate instead), fire and water sharp in focus (`5-pairs-worlds.jpg`), bodies below the Pool's horizon not painted over (`5-ba-w-pool-lock.jpg`). **Still wrong:** fire *behind* a water body is added over it (the glow is laid over the whole scene; the lens report's known weak point), visible in the close pairs |
| 2 | reflections in water worlds | **joined and verified.** Chose the kinds' mirror copy (cheaper than marching the glow target: one more splat draw at half resolution in the Pool and the temple only). `World.waterY()` (the Pool 0, the temple its tide) is the floor fire's existing MIRROR splat reflects about; on water the copy fades slowly with height (`mirrorFall` 0.35/m; the agate keeps 1.6). Water bodies were already mirrored through the merge. Seen: `5-ba-w-pool-lock.jpg`, `5-pairs-worlds.jpg` (Pool and temple rows), `5-jogo-pool-sheet.jpg`. The copy is a perfect mirror (the water's ripples don't bend it) and breaks into pieces where the reflected flame is thin |
| 3 | hearts | **joined; verified for fire, partly for water.** Fire's splat thins in front of a heart (`heartVeil`); the water surface (water and ice) lowers its opacity in front of a heart and takes its light (`heartLight`), in the main composite and in gate views. `ember` and `geodeheart` show their hearts through the flame (`5-ba-el-ember-close.jpg`, `5-presets.jpg`); `tide`'s pale celestite heart shows as a soft glow in the chest, not a clear stone (`5-el-tide-close-sheet.jpg`); `all` shows its geode heart and cut head (`5-presets.jpg`). Ice shards don't read hearts (only silhouette shards remain) |
| 4 | budgets | **joined; verified on this PC by forcing each class.** `budget()` is read by fire (flames per dancer), water (count, resolution, smoothing), steam (pool; wisp size × spriteScale), the show (stones), the field (grid, cell), the portals (live gates, scale), the post chain (depth of field) and ice (mist size). `?class=phone` gives exactly the counts `coarse` gave (fire 14,336 = 24k × 0.6, water 24,000, stones 9,000, field 32×24×32); laptop 28,928 flames, 48,000 water, 12,000 stones, 40×28×40. The table now holds today's desktop numbers (60k flames, 6,000 steam, three smoothing passes; it had wave 1's). The phone's `spriteScale` is 1 (not the perf report's 0.7) to keep phones identical; `perDancerCoarse` is gone. The laptop's 1.5 pixel-ratio cap was already a budget number (`maxPixelRatio`), left as is. Not run on a laptop or phone |
| 5 | fusion | **joined and verified** in the Pool script (`5-jogo-pool-sheet.jpg`, rows 3 and 4): the jogo calls `field.fuse({ dancers, kind, amount, strength, tightness })` with the seats' slots; its own vortex, its steam and heat deposits, prism's glints and aurora's curtains are gone; its streams, storm's arcs and drops, the loadout mix and the camera stay. A steam column rises between the pair, both bodies show both elements. Only steam was seen; prism, storm and aurora through the jogo were not captured |
| 6 | field thresholds | **joined; verified in part, and changed after looking.** Water freezes from cold 0.05, fire's wet and cold reactions ramp from 0.05 to 0.6. The suggested 0.05 for boiling and melting was tried and **looked wrong**: a water dancer touching a fire dancer was gone in three seconds, and in a fusion (loadouts mixed) each body boiled away **from its own fire**, because the field's heat is one sum. Now ice melts from 0.3 ("touching") and water boils from 0.6 (inside a flame); the reason is in `water/params.ts`. Seen (`5-reactions.jpg`): water beside ice freezes whole within a second; water beside fire thins on the fire's side under a steam column; ice beside fire throws a jet and a white front, but **melting is not visible** (the ice dancer's own cold outweighs the fire's heat in the summed field); flame bending behind a kick: the flame leans with the kick, not conclusively |
| 7 | worlds | **joined; grades verified by eye only in passing.** Each world sets `grade` (the world agents' values in the hook's terms: their lift colours became lift plus shadow tints, warm whites became highlight tints; per-world vignettes and the forge's "pull greens toward cyan" are not in the hook). `StageDef` passes `yaw`/`pitch` to the `StagePlane` (no world sets them yet; the world agents asked for eye heights, which the rig doesn't take). The redwoods' gate is out of the locked view (`5-ba-w-redwoods-lock.jpg`), but **a lantern still hangs large and blurred in front of the lock camera** (top middle of that frame). The hub's non-live gates show their stills inside the geode's crystal crowns (`5-hub-sheet.jpg`): they sit well; the Pool's still reads as a black disc (its world is black water) |
| 8 | played gems | **joined and verified**: `playParams.gemStiffness` 700 → 280. A jump and a rolê re-shot (`5-g-mo-jump-classic-sheet.jpg`, `5-g-mo-role-classic-sheet.jpg`) look like the gems agent's at 700: the body holds, the rolê still trails a cloud of loose stones |
| 9 | the jogo against everything new | **joined; verified in captures.** The Pool script runs (its world now applies: a scripted jogo played in the geode before, `script.world` was ignored unless `&world=` was given) with the locked framing, exchanges, the HUD's thread, the invitation, the fusion and the release (`5-jogo-pool-sheet.jpg`). The partner is src/ai's (seam B1). Menus: the front shows (31 buttons), the lobby shows its cards, no page errors |
| 10 | cameras' small asks | **joined.** `Carry.within` (a sphere): the core, gems and fire carry shaders leave particles further than the disc's radius + 1.6 m behind (`gates.carryReach`); `npm run test` gate checks pass, **not seen in a capture**. `World.clear(a, b)` is cheap for the redwoods (their trunks as cylinders) and is combined with the discs in the portals' clearance; **not exercised in a capture** (no take drives the follow camera into a trunk). Temple pillars and the geode's blades don't answer `clear` yet |

The brains' seams (from the coordinator's message):

| # | seam | state |
|---|---|---|
| B1 | the real partner | **joined and verified.** `AiPartner` (play/partner.ts) seats src/ai's `PartnerBrain` through a `BrainDriver` over the brains' `Scene`, fed each frame from the jogo's `PartnerView`, the **room's state** (the real rules) and the jogo's events; between jogos it says ready as the stand-in did. `playful` by default, `&partner=calm\|fierce\|mirror`, `bend.jogo.preset(name)`, `&partner=standin` for the old one. 30 s in the redwoods, locked, seat 0 pressed by a script (`5-jogo-partner-redwoods-sheet.jpg`): the partner keeps its distance, dodges, answers, a clash flashes. The brains' own referee stays for their Node tests and demos |
| B2 | flourishes and palmas | **joined, tested**: `pirueta`, `giro`, `volta`, `saltos`, `voo`, `tour`, `quebra` (no attack, flow 2) and `palmas` (flow 1, no echo) are in `RULES.moves`; `test/rules.test.ts` lists them; all tests pass. A side effect: the partner may now echo a flourish |
| B3 | free dancers through gates; lined up | **joined** (a free dancer's terrain is its own world's `groundAt` through `Dancer.world`; not exercised through a gate). **Lined up: not real.** In the page after 600 frames of `?npcs=5` the nearest two stood 2.36 m apart; the line-up is the camera looking along a row of them |
| B4 | the roda in the game | **joined and verified.** `?jogo=partner\|same` rings the stage with src/ai's free dancers (`Budget.roda`: desktop 4, laptop 2, phone none, checked by forcing the class; `&roda=N`). Two fixes were needed: they wore the second seat's dress (the show's last dress name serves later slots) and the locked framing widened to include them; now they wear their own gems and `Dancer.framed = false` keeps the camera on the two seats. Seen locked (`5-jogo-partner-redwoods-sheet.jpg`) and free (`5-roda-free-sheet.jpg`) |

## Before and after (docs/reports/media/5-ba-*.jpg: the critic's frame on the left, this build's on the right)

Same step files (`critic-*.json`), same times; mine at 10 fps, so a frame can be a few hundredths of a second off.

| file | what it shows | what still looks wrong |
|---|---|---|
| `5-ba-el-fire-close.jpg` | fur → flame with contours, a white-yellow core, red tips; the black horizon rectangle gone | the core is one large white mass on the torso; licks shorter than the reference's |
| `5-ba-el-water-close.jpg` | the blue rubber mannequin → a luminous body with a cyan rim and caustic, the moon on the water behind | a little bloated at the outline; the rim is a uniform cyan line |
| `5-ba-el-ice-wide.jpg` | the white cut-out → a steel-blue faceted figure, mirrored | at 6 m it reads as glass more than crystal |
| `5-ba-el-ember-close.jpg` | the gem heart, lost in fur, now a gold heart seen through the flame | the heart is a flat gold disc from this side |
| `5-ba-moves-fire.jpg` | the black smear under the fire in the geode → the fire's reflection in the agate | the reflection is faint and patchy |
| `5-ba-filmb.jpg` | the clash in the redwoods: black needles, grey wings and a pink column → plasma's threads, a steam jet, a water dancer | at this instant the water dancer is a heap (the take's staging) and the plasma core blooms large |
| `5-ba-film2.jpg` | plasma against ice: the whiteout → both dancers visible, a violet-white front | the front at the contact is a blown white disc (front glow plus bloom) |
| `5-ba-w-forge-lock.jpg` | the forge clash: a 7 ms bank of smoke and needles → a white-hot fire dancer and a steam wisp on the rock, 1.0 ms | the water dancer is out of frame at this instant; the fire core is blown white |
| `5-ba-w-redwoods-lock.jpg` | the gate gone from behind the log; both dancers whole | a lantern hangs large and blurred in the top middle |
| `5-ba-w-pool-lock.jpg` | the Pool: horizon hole gone; the moon; both reflected (fire's copy restored) | the fire's reflection is a perfect mirror under rippling water |
| `5-ba-gate-geode-to-redwoods.jpg` | the camera that drove into the crystal wall → behind the player in the meadow | — |

Also: `5-pairs-worlds.jpg` (a fire and a water dancer in each world, wide and close; the locked view is each
`5-w-*-lock-sheet.jpg`), `5-presets.jpg` (`ember`, `tide`, `geodeheart`, `monolith` beside `all`, `all`, plasma against
ice), `5-reactions.jpg` (the field's reactions), `5-baseline.jpg` (`?baseline` in all five worlds: every one renders, no
pipeline failed, no validation error), `5-jogo-pool-sheet.jpg` (the scripted jogo, dodge to release),
`5-jogo-partner-redwoods-sheet.jpg`, `5-roda-free-sheet.jpg`, `5-hub-sheet.jpg`, `5-gate-*-sheet.jpg` (a crossing each
way and the other dancer through a live disc), and a sheet per element take (`5-el-*-sheet.jpg`). The takes are
`scripts/steps/integ-5.json` (written by `integ-5-gen.mjs`) and the critic's own files, run with
`scripts/critic-cap.mjs … --prefix 5 --fps 10` (`--prefix`, `--shots`, `--fps` are new, so a re-shoot no longer
overwrites the critic's `3-*` media).

What still looks wrong across them, honestly: fire behind a water body glows through it; plasma and fire cores blow
out to white discs in bloom, and the steam front at a plasma contact is a white blot rather than a line; the Pool's
fire reflection is unrippled; the forge's aurora is still a hard green band; in the geode's free roda take the crystal
blades fill the foreground; in the free roda the partner ended overlapping the player (fire inside water).

## Timings (RTX 5090, weft's profiler over 150 stepped frames)

The critic's six scenes (`critic-timings.json`, the same staging) and other takes. "Critic" is `3-critique.md`'s
number (or its `shots/critic/timings.jsonl`).

| scene | size | critic: frame (scene) | now: frame | now: scene / glow / air / gates / fire / water / lens |
|---|---|---|---|---|
| fire and water, redwoods close | 1280×800 | 3.28 (1.65) | **2.21** | 0.70 / 0.12 / 0.49 / 0.52 / 0.21 / 0.65 / 0.03 |
| fire and water, the hub | 1280×800 | 2.22 (0.97) | **2.13** | 0.15 / 0.13 / 0.12 / 1.25 / 0.31 / 1.02 / 0.03 |
| plasma and ice, temple | 1280×800 | 1.16 (0.57) | **1.34** | 0.30 / 0.16 / 0.06 / 0.52 / 0.15 / 0.65 / 0.03 |
| fire and water, redwoods close | 1920×1080 | 4.75 (2.32) | **3.02** | 0.78 / 0.12 / 0.86 / 0.58 / 0.23 / 0.95 / 0.05 |
| fire and water, the hub | 1920×1080 | 2.86 (1.45) | **2.72** | 0.26 / 0.17 / 0.15 / 1.46 / 0.32 / 1.30 / 0.05 |
| plasma and ice, temple | 1920×1080 | 1.72 (0.90) | **2.07** | 0.46 / 0.21 / 0.11 / 0.56 / 0.17 / 0.91 / 0.05 |
| the forge clash, locked (`w-forge-lock`) | 1280×800 | 7.15 (5.79) | **1.04** | 0.10 / 0.12 / 0.01 / – / 0.19 / 0.34 / 0.03 |
| one fire dancer close (ember close) | 1280×800 | 1.80 | **0.71** | fire 0.19 |
| geode heart close | 1280×800 | 2.91 | **0.63** | fire 0.24 |
| one ice dancer close | 1280×800 | 1.48 | **1.30** | glow 0.28, water 0.59 |
| one water dancer close | 1280×800 | 0.86 | **0.98** | water 0.57 |

(The gates and fire/water columns overlap: a gate view's fire and water passes are in both.) The scenes with the most
fill got much cheaper (the clash 7.2 → 1.0 ms, close fire 2.3 ms of scene → 0.2 ms of fire). The hub and the temple
got no cheaper or dearer because **every gate view now runs its own glow pass (about 0.1 ms each, even empty: an MSAA
clear and resolve), its own fire field and its own water splats**, and the still slot draws one more view up to four
times a second: in the hub that is 1.25 ms of gates against 0.5 before. That is the first cost to cut (below).

## The critique's "Done when", task by task

1. **Fire as a field.** Contours, gaps and red tips in `el-fire-close`: **met**. Wide figure with a hot core: **met**
(facing reads in moves). No black needles at `film-b` 5.6 s: **met**. Plasma without needles, white cores: **met**.
Close fire ≤ 1.0 ms of scene: **met** (0.2 ms of fire). Flames in a gate view and in the geode's mirror: **met**
(`5-gate-geode-to-redwoods-sheet.jpg`, `5-ba-moves-fire.jpg`; the mirror is faint).
2. **Water and ice.** Luminous, moving surface at rest: **met**. No star glitter after a kick: **met**. Bead-free
outline: **met**. Reads at 6 m on the Pool's black: **met** (`5-el-water-wide-sheet.jpg`). Water through a gate has its
surface: **met** (the water agent's door still; not re-shot at `critic-film` 11.8 s, where my take had no water
dancer beyond the disc). Ice wide as steel-blue faceted crystal: **met, reads as glass at 6 m**. Large flat facets close:
**met**. Two ice bodies under +1.4 ms: **met** (the water agent's +0.54; not re-measured here).
3. **Depth and lens.** No horizon rectangle in the Pool: **met**. No smear under fire in `critic-moves`: **met**. In
focus right after a crossing: **met** (`5-gate-geode-to-redwoods-sheet.jpg`: sharp once through). No triple ghost on
the ice aú: **met by the lens agent's still, not re-shot**. Lens ≤ 0.15 ms at 1080p: **met** (0.05).
4. **Cameras.** Camera in the far world behind the player both ways: **met**. Through the lock with both gate
placements: **not re-shot here** (the cameras agent's sheets). The other dancer through a live disc: **met**
(`5-gate-other-inside-sheet.jpg`). Five lock sheets with both dancers whole: **met** (`5-w-*-lock-sheet.jpg`). Over
eight gates drops the farthest: **not re-shot**.
5. **Steam fronts.** Both dancers through the steam in `film` 6 s and `w-forge-lock`: **met**. Forge clash ≤ 2.5 ms:
**met** (1.04). Steam never brighter than 0.85 except the front: **met by construction**; the front itself blows out
with bloom.
6. **Hub, Pool, forge.** Orbits hold against the original geode: **geode yes, Pool half (facing away is black, by
design), forge partly** (not re-shot here; the world agent's orbits). A fire dancer reads against the forge in the lock:
**met** (`5-ba-w-forge-lock.jpg`). No black voids filling half the frame: **geode and forge met, Pool not**. Non-live
gates show their worlds: **met** (the cameras' stills, in the crowns).
7. **Redwoods and temple.** Keep their light, lose the ping-pong lanterns, cardboard stone and clip-art glyphs: **met**
(the world agent's sheets; the lock re-shot here keeps the light). No dancer in front of a disc in the redwoods' lock:
**met**.
8. **Gems and hearts.** `ember`, `geodeheart` and `tide` show the heart at 2.3 m and as a glow at 6 m: **ember and
geodeheart met; tide partly** (a pale glow, not a stone).
9. **The budget.** A table of ms per pass on the laptop and the phone: **not met** (the Mac has not reported; the
service waits). The clash at 60 fps on the laptop: **not measured** (1.0 ms on the 5090 suggests it now fits).
10. **The films.** **Not met** (not this wave's work).

## Open items, most important first

1. **Gate views cost too much for what they show.** Each live gate view runs a glow pass (≈ 0.1 ms empty), a fire
   field and water splats; the hub with three views spends 1.25 ms in gates. Skip a view's glow pass, fire field and
   water passes when nothing of that kind is in it (the `seen` uniform knows), or draw a gate's glow into its scene
   pass.
2. **Fire behind a water body glows through it.** The glow target is laid over the merged scene. The air could compare
   the fire's focus distance with a water body's (it needs the fire's focus separately from water's, or a body mask).
3. **The field's heat is one sum**, so a body that wears fire and water or ice reacts to its own fire; melting and
   boiling were raised to 0.3 and 0.6 for that reason, and ice beside fire does not visibly melt (its own cold wins).
   A per-dancer aura channel (heat from others) would let the thresholds be the measured 0.05.
4. **The Mac's numbers.** The laptop and phone rows of the budget are guesses until `docs/reports/perf/` has the
   MacBook's run (and a phone's); then set `spriteScale` and the probe's thresholds.
5. **Blown white cores and fronts.** Fire and plasma cores and the steam front at a plasma contact bloom into white
   discs; the bloom's threshold or the front's glow wants a look across worlds.
6. **The redwoods' lantern in front of the lock camera** (the cameras agent's note, still true), and the geode's
   crystal blades filling a free camera's foreground: both want `World.clear` for lanterns and blades, or a near fade.
7. **Fire's mirror on water is unrippled**; it could take the water's wave normal (light.wgsl's group) to bend it.
8. **Not captured:** the crossing carrying only near particles (`Carry.within`), the follow camera kept off the
   redwoods' trunks (`World.clear`), prism, storm and aurora fusions in the jogo, a free dancer crossing a gate, the
   freeze climbing in a jogo, set ice melting from the field.
9. **Per-world vignette and the forge's colour pull** are not in the grade hook; the world agents' proposals lost them.
10. **The brains' known weak points** (the brains agent's, unchanged): echoes come 3½ beats later too regularly; the
    step-in before an attack is a visible shuffle; fast attacks can rarely be answered at human reaction time; nobody
    has played against it. And the partner can end overlapping the player in the free view (seen once in
    `5-roda-free-sheet.jpg`).
11. Water's thinning at contact is strong (a touching water dancer loses much of its body in a few seconds) and the
    redwoods' close pair showed a flat-cut head on the fire side: worth a film to judge.
12. `stagePlane` carries `yaw`/`pitch` but no world sets them; the world agents' suggested eye heights need a rig
    parameter the camera doesn't have.

## What the brains merge needed (done here)

The brains branch arrived during the work and is merged last (`35a046a`), with its seams joined above (B1 to B4).
What a later brains change should know: the jogo seats `AiPartner` (play/partner.ts), which drives `PartnerBrain`
through the brains' own `Scene` and `BrainDriver` with a `RulesView` built from the room's `PublicState` and the jogo's
events (`JogoEvent`s with `k: 'unison' | 'fusion' | …`, passed as the brains' `RulesEvent`s); the roda in the game is
`rodaForJogo` (ai/demo.ts), which marks its dancers `framed = false` and pads the show's dress list so they keep their
gems; RULES.moves now holds the flourishes and `palmas`, so `echoable` is true for flourishes.

## Commits (on master, not pushed)

```
(this report)
The integration's stills; AGENTS.md, the guides and PLAN.md
The roda's free dancers wear their own gems and the camera frames only the two seats (Dancer.framed)
A scripted jogo plays in its own world; ice melts from heat 0.3 and water boils from 0.6
Water boils away from heat 0.1; the integration's step file (integ-5-gen.mjs)
Fire's mirror copy on water fades slowly with height
Cameras' small asks: carry within, World.clear, the roda round the game's jogo, free dancers on their own floor
The jogo's partner is src/ai's PartnerBrain; flourishes and the clap are rules moves
Played gems at stiffness 280 with the gems' hold
Field thresholds, the worlds' grades, stage yaw and pitch through stagePlane, critic-cap's --prefix
The jogo's fusion drives the field's
Every owner reads the device budget instead of coarse
Fire mirrored in the Pool's and the temple's water (World.waterY); gem hearts show through fire, water and ice
Merge brains, perf, the jogo, cameras, redwoods and temple, hub/Pool/forge, gems, steam, water and ice, fire, depth and lens
weft 0.2.9: the lockfile and the regenerated shader typings
```
