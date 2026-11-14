# Report 10: polish before the master films

Five visible faults from `docs/reports/9-integration.md`'s "What is left" (items 1, 2, 4 and 6 there, and the
streaks), fixed on branch `worktree-agent-a140020e914eb1617` from master `29f8d5f`. Nothing pushed or merged.

**Measured** (RTX 5090, headless Chrome, muted, every capture under the shared render lock, one take at a time): film
2's affected takes with the film tool (`--preview --no-score --take 6 --only-take k`: take 7 is the steam fusion's
middle, 42 to 48 s; take 9 the release, 54 to 60 s; take 11 the bow, 66 to 72 s), each against the same take of
master (a production build of `29f8d5f` served by `vite preview` on 5495, or the same take rendered before any edit);
film 1's `c-gate`, `d-hub` and `ab-jogo` shots whole at preview (`--sheet`, `10-film-film1-*-sheet.jpg`); `scripts/steps/polish-10.json` through
`critic-cap.mjs` for the water stills (the integration's `lock-redwoods`, the same with a gem dancer in the fire's
place, `lock-temple`, the temple jogo), `?baseline`, and the critic's five 1080p scenes for timings (master's build
on 5495 against this branch's on 5496, two runs each). Diagnoses by A/B in one take (critic-cap's `ab`: each frame
grabbed twice, a stepped frame apart, a parameter switched between). I looked at every still and sheet named here.
**Not measured:** the films whole or at master quality, the release of prism, storm or aurora (only steam's was rendered; the others share the code), the scores (no audio was touched or rendered), a jogo walked
through a gate (no film does it: see 5), a laptop or a phone, anything by ear.

## 1. Film 2's release burst — fixed

**Whose draw:** fire's. At the release the fused body's flames (fire flames dressed with the fusion's `side`, drawn
through fire's temperature field in the steam look) were thrown: `fire/sim.wgsl` pushed every fusion flame outward
from the helix at 5 m/s² plus 1.5 up for the release's beat, and `play/fusion.ts release()` laid eight wind deposits
of 6 m/s outward in the field, which fire's flames ride (`f.vel = wind + …`). With lives grown 48 % over the eight
bars, the column became a white ball two metres across in half a second (`10-release-ba.jpg`, top row). Not steam's
fronts, not bloom: the burst has the fusion look's orange and cyan licks and moves as flames.

**Fix:**
- `fire/sim.wgsl`: past the eighth bar every fusion flame is its own body's (no helix, no rain, `role` 0), and is
  drawn to its home by a spring (`22 × parting`, with the home's velocity), so as the knock carries the two dancers
  apart each takes its own flames with it. The column's growth is let go over the release's first 0.3 bar. A flame
  further than 0.35 to 0.9 m from its home (the column's top, the strands) burns out within 0.12 s instead of being
  flown home. No outward push.
- A fusion flame whose home is no longer a fusion's (the loadouts back) becomes its body's own flame at once, or, if
  its slot now belongs elsewhere (the water's flames handed to the fire), goes out. Before, they kept the fusion's
  look until they died: the fire stood white for a second after every release (seen in the first fix's take).
- `fire/composite.wgsl`: through the release the fusion's look crossfades (`rel`, bar 8 → 8.45) into each side's own:
  the hot side (seat 0: fire, plasma in storm and aurora; `shared/rules.ts fusionKinds`) to its ramp, the cold side
  (water, ice in prism and aurora) to a cool glow of its colour, fading to half as its own body climbs back.
- `play/fusion.ts`: the release's wind 1.5 m/s (was 6) and `RELEASE_MS` 550 (was 750), so the water's own body
  starts back from its feet 0.2 s sooner.

**Seen:** `10-release-ba.jpg` (master's take 9 above, this branch's below, every sixth frame at 30 fps from the
release), `10-release-sheet.jpg` (the release and the next 2.5 s): the column parts into a flame and a blue body a
step apart, the fire stays fire, the ring of sparks on the floor; nothing reaches past the pair's own width.

## 2. The steam fusion column — better, still pale

**Cause, two parts:** (a) the column sums two whole bodies' flames, so nearly all of it sits at the compressed sum's
top (`Tc` ≈ 2.2), and the steam look (`1 − exp(−0.8 Td)`, a quarter of the gaps the display noise gives fire) is
flat white there; (b) steam's wisps rise along the helix, and inside the helix `steam_comp.wgsl` lifted their cap to
cover 0.8 of what is behind in a gold-white at 1.2 of white, after the depth of field, blurred: a white veil over the
body (`take 7` with steam's births at 0 showed the body underneath with far more in it).

**Fix:** `fire/composite.wgsl fusionLook` steam: the full display-noise gaps (as fire), slow billows at about twice
the noise's scale, a power ramp (`1.05 (Ts/3)^1.9`, steep enough that the noise's lanes read as contours) from a cool
blue-grey where thin to a warm white where thick and a gold core only in the thickest, under the shoulder; the orange
and cyan licks at the edges kept. `reactions/steam_comp.wgsl`: for the steam kind only, the wisps inside the helix
cover at most 0.3 (was 0.8) and keep `maxBright`. Prism, storm and aurora are untouched (their branch and cap are as
they were; the release crossfade is the only change they see).

**Seen:** `10-steam-ba.jpg` (master above, this branch below, three frames 2 s apart of take 7): lanes, billows and
the two bodies' licks now read inside it; it is still a pale column at moonrise (the temple's exposure, ACES and
bloom on a near-neutral colour). A warmer or dimmer steam would read more, but that is a look decision, not a fault.

## 3. The faint diagonal streaks — fixed

**Cause:** the film grain (`post/post.wgsl fs_out`): `fract(sin(dot(px + time × 61, (12.99, 78.23))) × 43758)`. With
the time a film reaches (a minute and more) the sine's argument is in the hundreds of thousands, where the GPU's sine
is no longer a hash: the grain fell into a regular diagonal pattern, period about 10.5 px (`10-streaks-ba.jpg`: the
bow's frame and its high-pass, master left; the high-pass's spectrum had its two strongest peaks at that diagonal
frequency, and a take with `post.grain` 0 had none). Found by reproducing the bow (take 11), high-passing the frame
and A/B-ing the grain.

**Fix:** `engine/util.wgsl pixelRnd(px, salt)`, an integer hash (pcg) of the pixel and a salt; the grain uses it with
the frame number. The same sine hash with a pixel's coordinates and a running time was the jitter of the redwoods'
and the geode's fog marches and of the Pool's and temple's water reflection march, and a fixed one turned the lens's
gather: all four use `pixelRnd` now. After: the grain is white noise, no diagonal peak (`10-streaks-ba.jpg` right).

## 4. The pale side of water facing a fire — mostly fixed

**Diagnosis** (the redwoods lock, one take each, `ab` with one parameter switched): `fire.light` 0 turns the water
blue head to foot (`10-diag-firelight-ab.jpg`); the fire's glow in the air (`fire.intensity` 0), the lens and
refraction (`water.lens`, `refract` 0) do not; `water.glint` 0 removed most of it (`10-diag-glint-ab-before.jpg`);
with that, the foam and the water's milk carried the rest (`water.opacity` 1 makes the side whiter:
`10-diag-milk-ab.jpg`). So it was not `glowSeen` (Report 9's guess, which I first changed and reverted: no effect) but
the fire's **world light in the water's own shading**, three terms of it, each at a fire's full strength a metre off
(about (2.5, 1, 0.3), and ten times that at 30 cm), added over blue:
- `fireSpec`: a broad lobe (`pow 40 × 1.2`) and a wide rim over the whole half facing the fire;
- the foam's light (`lightIn × 0.7`, uncompressed), and foam replacing the water's colour where a fire churns it;
- the light scattered inside (compressed by luminance, so an orange light still reached twice white in red).

**Fix** (`matter/water/surface.wgsl`): `fireSpec` is a sharp highlight (`pow 140`) that moves over the ripples as
streaks of the flame's colour and a thin rim (`rimK²`), and the sum rolls off at its brightest channel (keeps the
flame's hue, never passes 1.25); the foam's light keeps the fire's part apart and compressed per channel, and foam is
laid over the water's colour (70 % of it kept) instead of replacing it; the scattered light's fire part rolls off per
channel and is held to about a quarter of white, warm-tinted.

**Seen:** `10-water-redwoods-ba.jpg` (master, this branch, the gem dancer in the fire's place): the side facing the
fire is blue now with warm highlights, close to the gem dancer's; a slight grey remains along the fire side's edge.
`10-water-temple-ba.jpg` (the temple jogo at 6 s, not the same instant: the jogo isn't deterministic): the peach-white
fire side is now silver-blue. Stills: `10-p10-lock-redwoods-0p5.jpg`, `-gems-`, `10-p10-lock-temple-0p5.jpg`,
`10-p10-jogo-temple-6.jpg` against `10b-…` (master).

## 5. The jogo's ground seam — joined

`src/play/index.ts` passes `worldOf: (d) => app.worldOf(gates.worldOf(d))` to `playDemo`, as `main.ts`'s `?play`
does: a jogo's seat crossing a gate walks on the far world's floor. A film's `place: [x, z]` goes through
`Character.reset` on the same terrain, which is the main world's until a seat crosses, so places are unchanged: film
2's seats log the same places as before (−1.2 / 1.2 before the intro, −0.14 / 0.13 in the fusion). Film 1's `c-gate`
and `d-hub` are `play` shots (`?play&two`, `main.ts`'s path, which already passed `worldOf`), so this line doesn't
reach them; rendered again anyway (`10-film-film1-c-gate-sheet.jpg`, `-d-hub-`, and the jogo shot `-ab-jogo-`): the
pair placed where the timeline says, into the geode's disc, the hub's pair apart, the aurora; no fall, no jump.
**Not run:** a jogo whose seat crosses a gate (no film or take does; the integration suggested the forge's gate and
back).

## Timings (RTX 5090, 1920×1080, weft's profiler over 150 stepped frames, production builds)

The critic's five 1080p scenes (`polish-10.json` `p10-t-*`, the same takes as Report 9's), master's build (5495)
against this branch's (5496), two runs each, alternating, each run under the lock. Whole frame in ms, run 1 / run 2:

| scene | master | this branch | the passes I touched (mean of the two runs) |
|---|---|---|---|
| temple, fire and water, 4 m | 2.55 / 2.20 | 2.27 / 2.25 | water.surface 0.155 → 0.157, fire.composite 0.011 → 0.011, air 0.148 → 0.148 |
| redwoods at dusk, fire and water, 4 m | 3.15 / 3.13 | 3.20 / 3.21 | water.surface 0.162 → 0.182 (runs 0.200, 0.163), air 0.860 → 0.861, water.fog 0.071 → 0.071 |
| redwoods jogo, locked, roda of four | 3.63 / 3.55 | 3.59 / 3.56 | water.surface 0.216 → 0.206, air 0.928 → 0.919 |
| hub, fire and water, 6 m | 1.90 / 1.84 | 1.90 / 1.89 | water.surface 0.120 → 0.119, air 0.140 → 0.140 |
| Pool fusion (steam), mid-fusion | 1.91 / 1.84 | 1.83 / 1.85 | fire.composite 0.017 → 0.018, air 0.145 → 0.142 |

Nothing grew by more than 0.1 ms, whole frame or pass: the largest move in a touched pass is the redwoods pair's
water surface, +0.02 on the mean from one run of 0.200 (its other run 0.163, master's 0.162 and 0.161); the largest
whole-frame move is the same scene's +0.06 to +0.08, inside the spread these takes show between runs (the temple's
master read 2.55 and 2.20). The release's extra `homeOf` per flame runs only for its 0.55 s and wasn't timed alone.
The integer hash costs nothing measurable in the air (the redwoods' march) or the grade.

## Tests

- `npm run typecheck`: clean.
- `npm test`, the full run: limits (14 caps); bindings within the baseline (149 entry points, unchanged: no binding
  was added); 10 of 10 TS test files (the fusion's 3 among them, with RELEASE_MS changed); audio's 20; the gates' 10,037
  checks; the net tests, all passing, **the smoothness test first time** (the GPU was rendering other agents' takes).
- `?baseline` (`p10-baseline-redwoods`, `p10-baseline-fusion-pool`, 1280×800 on this branch's build): both render, the
  redwoods lock's pair and the Pool's steam fusion (`10-p10-baseline-redwoods-0p5.jpg`, `-fusion-pool-`).
- Film 1's `ab-jogo` (the jogo shot, the only film shot `worldOf` reaches) logs exactly the same seats in its last take
  as master's build (frames 1260 to 1470, every second of film).

## Weak points

- The steam column is still pale at moonrise: it has structure now but not colour. Turning it warmer or dimmer is a
  choice for the owner (`fusionLook` steam: `hue`, the `1.05` and the power).
- After the release the water's own body takes about a second to climb back from its feet (the water kind's rise),
  so for half a second the fire stands alone with a fading blue glow beside it. Shorter needs the water's rise faster
  on a re-dress, which I didn't touch.
- The release's look per side assumes the rules' seats (seat 0 fire or plasma, seat 1 water or ice): a jogo dressed
  the other way round parts with the colours swapped for half a second.
- Water beside a fire keeps a slight grey on the side facing it, and the fire's highlight streaks depend on where the
  fire stands: measured in two staged takes and one jogo, not swept.
- The integer hash changes the grain's and the fog marches' noise (statistically the same, not the same pixels).

## Not done

- No master renders, no audio, no deploy.
- A jogo crossing a gate (above). The free partner's walk upstage (Report 9 item 5), the water's terraces, fire's own
  cold, the temple pair's place, the near fade's dither: untouched.

## Files

`src/engine/util.wgsl`, `src/post/post.wgsl`, `src/worlds/geode/geode.wgsl`, `src/worlds/redwoods/forest.wgsl`,
`src/worlds/water/water.wgsl` (the hash); `src/matter/fire/sim.wgsl`, `composite.wgsl`,
`src/matter/reactions/steam_comp.wgsl`, `src/play/fusion.ts` (the fusion); `src/matter/water/surface.wgsl` (water);
`src/play/index.ts` (`worldOf`); `scripts/steps/polish-10.json` (the takes). No `films/*.json` changed, nothing in
`src/audio` or `scripts/film.mjs`.

## For the master render

- Film 2 should be rendered again whole (every take: the grain changed in every frame, and the fusion and release).
  Film 1 too (the grain; its aurora fusion has no release in frame, but its scenes' fog march jitter changed).
- Watch film 2's bars 22 to 23 (the release) and its bow for the grain; film 1's redwoods for the fog's grain.

## Proposed lines for AGENTS.md

- In "The frame" or a new note under the weft footguns: "Per-pixel noise uses `pixelRnd(px, salt)` (engine/util.wgsl,
  an integer hash; `frame.frame` as the salt for noise that changes each frame), never `fract(sin(dot(…)) × 43758)`:
  with a pixel's coordinates and a running time the sine's argument reaches the hundreds of thousands, where the GPU's
  sine falls into regular diagonal bands (Report 10: film 2's streaks were the grain)."
- Under the contracts, after `Character.env.still`: "A fusion's release (`play/fusion.ts`, RELEASE_MS 550) parts the
  one body: past bar 8 every fusion flame is drawn to its own body's home and its look crossfades to its side's own
  (fire or plasma, water's or ice's blue); a fusion flame whose home is no longer a fusion's turns ordinary at once."
- In the map, `play/`: "the jogo's seats walk on their own world's ground (`PlayCtx.worldOf`, as ?play's)" — and drop
  the narrowing in Report 9's line ("the played dancer's own ground is `?play`'s only").
- Under water: "A fire's light on water (`surface.wgsl`: `fireSpec`, the foam's and the scattered light) rolls off
  per channel at the flame's hue: added at full strength over blue it sums to grey-white."
