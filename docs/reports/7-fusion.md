# Wave 6, task 1: the fusion as one body

Branch `worktree-agent-a3ab27765eeea1d03`. Everything below was rendered on the RTX 5090 through headless Chrome
against a dev server on port 5451, every capture through the jogo itself (the Pool script with the critic's form presses
at beat 27.5: steam, prism, storm, aurora), with `scripts/steps/fusion7-gen.mjs` → `fusion7.json` and
`node scripts/critic-cap.mjs scripts/steps/fusion7.json --only <take> --prefix 7 --shots shots/fusion7`. A whole take
(`<kind>-<world>`) is 22 s at 2 fps from the gathering through the landing (t = 3 s), the eight bars and the release
(t ≈ 18.5 s); `<kind>-pool-land` is 4 s at 12 fps round the landing. I looked at every sheet and the stills full size.
The lock was held only by the capture script, one or two takes a run (15 to 50 s; the one run of the four 1080p timing
takes held it longer, about 80 s, which was over the minute: I should have split it).

**Not looked at:** a laptop or a phone, `?baseline`, gate views and `?pip` of a fusion (the field is drawn per view, so
they get it, unverified), anything by ear, a person playing, a network fusion (the dress is set on each page by its own
`Fusion`, as the mix was), the geode and the redwoods fusions, prism / storm / aurora at 12 fps round the landing
(steam and storm only).

## What I built

The critic's **first choice**, landed: the fusion is drawn by fire's screen-space temperature field.

1. **One body.** At the landing `Fusion` dresses both seats with `fusionLoadout`: a `fire` layer with
   `params: { fusion: 1, side: 0 | 1 }`, and the seat's own other matter kept **on its feet only**. Fire counts a fusion
   layer as a whole dancer's flame whatever its (token, 0.001) share, so the water and ice keep their particle count:
   they rest on the feet (the field makes the fused body burn at least plasma's heat, so that water boils thin), and on
   the release they climb back from there instead of being made anew. (My first try removed water outright; on the
   release water re-made its particles as rain from 2.6 to 5 m up, which drew as a white pillar: `water/pool.ts spawn`.)
   The fusion's flames carry their side where a form would be (`look.x = 2 + side`), splat themselves into the field's
   spare channel (`heat.a`) and their side into `heat.g`, and the composite puts that share of each pixel through the
   kind's ramp (`fusionLook`). Two bodies close together sum into one contour; the side lets a ramp tint the matter by
   which dancer it came from (steam's orange and cyan licks). Gate views, the inset and the mirror floors get it for
   free (the fire pool's), and the Pool's reflection of the pair is now fire's own mirror copy, not water's screen-space
   march (no pixel columns: there is no water body to march).
2. **Four kinds**, each with its ramp (`composite.wgsl fusionLook`), motion (`sim.wgsl fusionMotion`, `fusionRole`),
   light (`fire.ts FUSION_LIGHT`) and scale, driven by the bar count (`field.fuse({ bar })`):
   - **steam**: a soft white-gold vapour that saturates slowly (thick parts brighter than thin), a warm core, orange
     licks at the thin edges of the fire dancer's matter and cyan at the water dancer's; flames live 1.5× longer, rise
     1.35× harder and swell 1.5×: a rising column; the column grows through the bars.
   - **prism**: clear and cold (a dim pale-blue body, brighter only where thick), spectral bands where the field's
     contour is steep (its gradient over 3.5 texels), the hue laid across the body by position and bent by the carried
     noise, so the rainbows move with the flow; a faint thin-film shimmer inside; desaturated toward white (never a full
     primary); flames short-lived, thin, sprung to the body (a cling of 25).
   - **storm**: dark blue-violet and heavy (buoyancy 0.35×, size 1.45×), lit from inside by soft patches that jump each
     flicker (7 a second), plasma's ridged threads as lightning inside it, 12 % of its flames falling as rain from
     above the pair (faint, stretched by the splat's motion streak), arcs between the two bodies' hands, the middle and
     a hand, the floor and a head.
   - **aurora**: curtains (a ridged noise fine across, long upward, drifting at half time) green low, cyan, violet high
     by height over the floor; a cyan-white core where both bodies are; flames live 2.3× longer and the helix is
     taller and turns at half speed, so the column rises far above the pair; it grows through the bars twice as fast as
     steam's.
   - **Landing:** a 380 ms swell of the whole body (`pulse`), a ring in the world's water, a small soft light at the
     middle. **Development:** the helix tightens toward bar 4 and opens after it; the column grows. **Release:** for
     750 ms the one body is let go outward and up (the field's bar past 8), the helix opens wide, then each body's own
     matter returns; the parting knock, ripples and the ring of sparks on the floor as before.
3. **What was ugly, removed:**
   - **The landing's hard disc** (confirmed cause): `glow.wgsl` wrote its view distance into the glow target's alpha
     where `v > 0.4`, a binary mask the air took as the nearest focus, so it fogged and focused the Pool behind as if a
     body stood across the disc. The glow now writes 1e5 (min-blended: nothing), and the landing's light is 0.22 to
     0.57 m instead of up to 1.7 m. `7-steam-pool-land-sheet.jpg` and `7-storm-pool-land-sheet.jpg` (12 fps round the
     landing) show no disc, no black below the horizon.
   - **The white dashes**: both sources named by the critic are gone: the jogo's 180 stream segments (replaced by the
     helix in fire's field and 46 to 70 tiny motes that write no focus) and steam's fronts during a fusion (fronts,
     drips and sparks are born × (1 − amount): none while one holds). I removed both together and the dashes are gone
     in every fusion frame I took; I did not A/B the two sources separately.
   - **The pale rectangle behind the heads** (storm, confirmed cause): steam's composite lit storm's flashes per screen
     cell, `floor(uv × (5, 3))`: a fifth of the screen wide and a third high (its edge sat at exactly 800/3 px). Now a
     smooth noise's peaks, moved each flicker. Fire's storm flashes were written the soft way from the start.
   - **The grey plume**: the fusion's vapour was lit by the world (grey on a night) and capped at 0.45 coverage. It is now
     lit by the kind (white-gold, pale blue, deep violet, green into violet), and inside the helix's column on screen the
     cap is lifted (0.8 coverage, 1.2 of white); everywhere else it holds.
   - The cyan puddle sheet and foam heap after the release: gone with the loadout mix (water never left its body).
4. **The helix**: 18 % of each body's fusion flames are born on that body's strand of the field's double helix and held
   to it by a spring as they climb (the field's own strands, `strandAt`, so steam is born along the same curve): two
   strands, one per dancer, turning round the pair. Its radius wraps both bodies (half their distance apart + 0.34 m);
   a wider helix winds fewer turns a metre so its strands keep their slope (not rings); it tightens toward bar 4 and
   opens at the release. Storm's glow rain is gone (its rain is fire's).
5. **The shoulder** (`flame.wgsl shoulder`): below 1 nothing changes; above, the brightest channel rolls off toward 1.6
   with the others kept in ratio; fire's hottest is held to green ≤ 0.86 red, blue ≤ 0.56 green (yellow-white), plasma's
   to red ≤ 0.82 blue, green ≤ 0.56 blue (violet-white), the torch ramp too, and the composite's final mix again.
6. **The field's heat**: see "The field decision".
7. Rules, tests, scripts, the jogo's flow and HUD are unchanged. `Fusion.stats()` reports `dressed` instead of `mixed`;
   `mixLoadout` is gone (nothing else used it).

## Each kind: reference, before, after

| kind | reference | before (critic) | after: the landing + 2 s, mid-fusion, late, release + 1 s | whole fusion |
|---|---|---|---|---|
| steam | `docs/element-looks/05-fusion-steam.jpg` | `6-fusion-steam-pool-f30.jpg`, `-f60.jpg` | `7-steam-pool-5.jpg`, `-9`, `-17`, `-19p5` | `7-steam-pool-sheet.jpg`, `7-steam-temple-sheet.jpg` |
| prism | `06-fusion-prism.jpg` | `6-fusion-prism-pool-sheet.jpg` | `7-prism-pool-5.jpg`, `-9`, `-17`, `-19p5` | `7-prism-pool-sheet.jpg`, `7-prism-temple-sheet.jpg` |
| storm | `07-fusion-storm.jpg` | `6-fusion-storm-pool-f60.jpg` | `7-storm-pool-5.jpg`, `-9`, `-17`, `-19p5` | `7-storm-pool-sheet.jpg`, `7-storm-temple-sheet.jpg` |
| aurora | `08-fusion-aurora.jpg` | `6-fusion-aurora-pool-f100.jpg`, `6-fusion-aurora-temple-f60.jpg` | `7-aurora-pool-5.jpg`, `-9`, `-13`, `-19p5`; `7-t-aurora-pool-0p5.jpg` (1080p) | `7-aurora-pool-sheet.jpg`, `7-aurora-temple-sheet.jpg` |

Side by side (reference | before | after): `7-cmp-steam.jpg`, `7-cmp-prism.jpg`, `7-cmp-storm.jpg`,
`7-cmp-aurora.jpg`; the four kinds at the same moment: `7-four-kinds.jpg`. The landing at 12 fps:
`7-steam-pool-land-sheet.jpg`, `7-storm-pool-land-sheet.jpg`. The cores: `7-el-fw-redwoods-close-1p2.jpg` (before
`6-el-fw-redwoods-close-1p2.jpg`) and `7-partner-geode-16.jpg` (before `6-partner-geode-16.jpg`).

How they read against the references:
- **steam** is the closest: a white luminous vapour figure with warm and cyan licks and a column above (`-5`).
- **aurora** reads as its reference at 1080p (`7-t-aurora-pool-0p5.jpg`): a cyan-white body rising into violet
  curtains far above, the helix in it.
- **storm** is dark blue-violet with lightning threads and arcs inside; heavier and darker than its reference, which is
  paler; the rain is faint.
- **prism** is the least like its reference: the reference is a bright white core with iridescent colour all through
  it; mine is a clear, cold body with spectral contours (the brief's words), which reads as a rainbow outline more than
  a glowing body at game distance.

## Timings (RTX 5090, 1920×1080, weft's profiler over 150 stepped frames, mid-fusion in the Pool)

| kind | GPU frame | fire.splat | top passes |
|---|---|---|---|
| steam | 1.66 ms | 0.28 | glow 0.15, glow.gate2 0.14, air 0.12, scene.gate2 0.11, surface 0.11 |
| prism | 1.53 ms | 0.17 | glow 0.15, glow.gate2 0.14, air 0.11, surface 0.11 |
| storm | 1.63 ms | 0.26 | glow 0.15, glow.gate2 0.14, scene.gate2 0.13, air 0.12 |
| aurora | 1.62 ms | 0.19 | glow 0.15, glow.gate2 0.14, air 0.12, surface 0.11 |

The critic's steam fusion was 1.75 ms (fire.splat 0.18, water.surface 0.16): the water bodies' cost went with them,
the splat grew with the longer-lived, larger flames. All four are under the critic's 2.5 ms and the brief's 3.5 ms.
(`shots/fusion7/timings.jsonl`.)

## The field decision

The single heat sum (5-integration open item 3) is **not fixed**: the fix is not small inside my folders. Water reads
`fieldHeat(p)` (src/matter/water/sim.wgsl), which has no idea whose heat it is; telling "heat from others" needs either
water to pass its dancer (`fieldHeatFrom(p, d)`) or a third group-3 texture tracking heat by source dancer, and in both
cases water's sim must call something new, which is not mine to edit. What I did instead:
- the fusion no longer makes any body wear both fire and water (the mix is gone), so "each body boils from its own
  fire" cannot happen in a fusion; the water resting on the feet is *meant* to boil thin there (it is stepping back);
- a fusion layer counts as a whole body's aura (4 : 1 against the matter on the feet) at at least plasma's heat
  (`field.ts layAuras`). Measured on the storm fusion: the water dancer's feet read heat 0.64 to 0.72 when the bodies
  were together, 0.35 to 0.41 when apart (probes at the hips' foot of each dancer).

**Recommended to the water agent** (and whoever takes the field next), as one change: in `field/step.wgsl` lay each
cell's heat and cold from the *nearest* dancer's capsules into a third rgba16float texture (x hot, y cold, z that
dancer's slot), add `fieldHeatFrom(p, d)` to `field.wgsl` returning the sum less dancer d's own share where z == d, and
have water's sim call it with `dancerOf(home)`. Cost: one sampled texture in every shader that includes group 3 (the
water surface's fragment stage goes from 7 to 8 of 16). Then the measured thresholds can come back: **freeze from cold
0.05, melt from heat 0.08 (others'), boil from 0.3 (others')**, instead of today's 0.3 and 0.6, which exist only to
stop a body reacting to its own aura. Without that change, keep 0.3 / 0.6.

## The critique's "Done when", item by item

Fusion:
- **one continuous figure in the kind's colours at 5 s, Pool and temple**: yes while the dancers are within about half a
  metre (`7-*-pool-5.jpg`: two dancers moving inside one shape). **Not while they are apart**: the script parts them to
  ±0.42 m at beat 33 and ±0.3 at 48 (its `goto`s; scripts were not mine to change), and then the fusion reads as two
  bodies of the same medium joined by the helix's strands and the vapour arching between them
  (`7-storm-pool-9.jpg`, `7-steam-temple-9.jpg`). The critic's pose item (6: keep the dancers standing and turning about
  each other) needs the rules or the script.
- **no water outline**: yes; the water resting on the feet boils thin (a small cyan point remains in some frames, and
  aurora's ice shows as small white rings at the feet: the ice does not boil).
- **no hard-edged dashes or pills**: yes, in every frame I took of the four kinds.
- **no disc cut into the scene at the landing**: yes (`7-*-pool-land-sheet.jpg`).
- **a reflection without pixel columns**: yes for the fused body in the Pool and the temple (fire's own mirror copy);
  the Pool's screen-space reflection of water bodies (outside the fusion) is task 3's.
- **told apart at a glance in a 4-up**: yes (`7-four-kinds.jpg`): white-gold, iridescent, violet, green-violet.
- **≤ 2.5 ms at 1080p**: 1.53 to 1.66 ms.

Task 1:
- **fire core yellow-white with structure**: yes (`7-el-fw-redwoods-close-1p2.jpg`: the core keeps its dark gaps and is
  yellow-white, not a flat disc).
- **plasma hand violet-white, never a flat disc larger than the head**: yes in `7-partner-geode-16.jpg` (the partner
  brain does not repeat its moves exactly, so the pose differs from the critic's still; I saw no white disc in the 18 s
  sheet `7-partner-geode-sheet.jpg`).

## Weak points

- Apart, the fusion is two figures (above). Within my folders the fix would be for `Fusion` to draw the dancers
  together (a soft pull on their characters each frame); I did not, because it changes the jogo's play (positions), which
  the brief told me to keep.
- Prism reads as a rainbow outline more than the reference's luminous white body; on the temple's bright moonlit side
  every kind (being additive light) is fainter than on the Pool's black.
- The jogo's echo and unison rings at the feet (feel.ts, in the two elements' orange and blue) drew under every
  fusion (the script has both dancers spin together in it); they now fade by the fusion's weight (`FeelCtx.fused`,
  wired in `play/index.ts`). The ripple rings in the water remain, as they should.
- Before the landing (the gathering), fire against ice makes steam's white front and a bright glow between the bodies
  (prism, aurora): that is the clash, not the fusion, and steam's front's look is the white-out item.
- The release is a beat (750 ms of the body thrown outward, then the matter climbing back), but the matter's return is
  water's own (particles flying home from the feet); I did not shoot the release at 12 fps.
- The fused body's light (`FUSION_LIGHT`, one point light per body) lights the world in the kind's colour; in the
  temple my first aurora turned the columns green. I halved it and desaturated the colours; re-shot
  (`7-aurora-temple-9.jpg`) the columns near the pair are still faintly green. The 1080p timings were taken before that
  change and before the rings' fade (both CPU-side, no GPU cost).

## Edits outside my four folders

- `docs/extending/play.md`, `docs/extending/reactions.md` (the fusion's new contract), this report.
- `scripts/steps/fusion7-gen.mjs`, `scripts/steps/fusion7.json` (my takes).
- `docs/reports/media/7-*.jpg` (stills and sheets).
- None in `src/` outside `play/`, `matter/reactions/`, `matter/field/`, `matter/fire/` (in `play/`: `fusion.ts`,
  `glow.wgsl`, and one line each in `feel.ts` and `index.ts` for the rings' fade; `menu.ts` untouched).

## Verification

`npm run typecheck`, `npm run build`, `npm test` (limits, the binding budget, src tests, audio, portals, the net tests:
all pass at the final commit; one run of the net tests met another session's server on port 5418, EADDRINUSE, and
passed on a re-run). The binding budget is unchanged (no new bindings: the fusion rides in fire's spare `heat.a` channel and
two vec4s added to `FireSim`, `FireField`). The dev server is stopped and the lock released.
