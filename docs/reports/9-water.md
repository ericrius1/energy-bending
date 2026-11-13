# Wave 7: water at game distance, its rise, its blocks

Items 4 and 5 of `docs/reports/8-integration.md`'s "What is left". Owner: `src/matter/water/`. Branch:
`worktree-agent-a66cb4eecb0f020f6`. Everything below was rendered on the RTX 5090 through headless Chrome against a dev
server on port 5457 (this branch) and, for the "before" stills, port 5458 serving an export of this branch's base
(`18edb91`, Report 8's build), one take at a time under the shared render lock (`scripts/critic-cap.mjs`). I looked at
every still named here. **Not looked at:** a laptop or a phone, a gate's view of water (`fs_scene`, unchanged), the
geode's mirror copy (`fs_mirror`, unchanged but for reading between texels), anything by ear.

## The verdict

1. **The cause of the pale heads was not the water's light: it was the fog.** The redwoods and the geode have no scene
   step (`src/post/post.ts sceneStep`): they fog their scene once, after the water is composited, at the distance in
   the scene's alpha, which is the opaque distance (the depth contract). So a water body standing 7 m away in front of
   fog 110 m away was fogged as if it stood 110 m away: above the horizon it dissolved into the fog, below it (grass 10
   m behind) it read blue, with a hard line at the horizon between the two and the fog march's grain over the top half.
   That is why more own light did nothing (Report 8). Fixed: in a world that fogs after the water, the water writes
   what the air will turn into the right pixel (below). The whole body now reads as water against the fog, head
   included (`9-ba-g-redwoods-1p4.jpg`, `9-ba-c-redwoods-1p2.jpg`).
2. **The front's rise** is no longer a column: particles that come into the world while the show is awake were
   spawned as rain from a 0.7 m cylinder 2.6 to 5.1 m over the dancer (the hard-edged rectangle of streaks); now they
   start as a film on the floor under their own homes and rise feet first (`9-ba-first-rise-0p2.jpg`, `-0p3.jpg`).
3. **Blocks and terraces, close up:** fewer, not gone. The edge's tongues read between texels (no more stretched
   nearest texels), the narrow-range filter fades its range instead of cutting it, and the surface's normal takes the
   depth's normal at 0.15 (was 0.5), which is where the flat patches with hard edges came from (`9-ba-arms-*.jpg`).
4. **What still reads pale at game distance is the side facing a fire** (`9-ba-lock-redwoods-0p5-crop.jpg`): with the
   fire dancer swapped for a gem dancer the same body is blue water from head to feet against the same fog
   (`9-lock-gems-water.jpg`). None of the water's own terms makes it (rim, highlights, milk and reflection switched off
   one at a time leave it; `9ab-fireside.jpg`); I did not trace it further (weak point 1).
5. **Cost:** within +0.1 ms of the water's surface at 1080p everywhere I measured (table below), after moving the fog
   lookups to a pass at an eighth of the resolution.

## What I changed, and why

### Water fogged at its own distance (`surface.wgsl` fs and fs_fog, `surface.ts`)

The air (`post/air.wgsl`) computes `scene × T + A` per pixel with T and A from the world's fog march at the scene's
alpha. The right pixel for water standing at distance w in front of something at distance d is: what is behind as the
air shows it, through the water; the air between w and d dimmed by the water like anything else behind it; the water's
own light through the air in front of it only. Writing the water's distance into the alpha would do the last part for
free, but fire's splat runs after the water composite in the 'air' stage and tests that alpha, so every flame behind a
water body would be cut instead of dimmed through it (seam 1 of Report 8). So the alpha stays the opaque distance and
the water writes

    behind × trans + (own × Tw − (A − Aw) × (1 − trans)) / Tb

where A and Tb are the air at the opaque distance, and Tw, Aw the air in front of the water taken as the same air,
thinner by its length (`Tw = Tb^(w/d)`, `Aw = A (1 − Tw) / (1 − Tb)`). The air then turns it into the right pixel. A and
Tb come from two calls of `worldAir` (it is affine in the colour), made by a new pass `water.fog` (`fs_fog`) at an
eighth of the resolution each way, only in blocks with water in them: at full resolution in the composite they cost
0.15 to 0.35 ms at 1080p in the redwoods. Only the geode and the redwoods take this path (`surfaced()`, the same test as
`post.ts sceneStep`); the Pool, the temple and the forge already surface their scene before the water and put the body
at its own distance in the merge, and are unchanged.

### Thick water as a lens, and what is seen through it softened

`lensOf`: a thick body turns the view through it toward its middle on the way in and again on the way out (2 (θi − θt)
at water's 1.33), so what stands behind is seen drawn in and upside down (the top of a head shows the ground beneath
it). Weighted by thickness, so sheets, films and edges keep the small bend they had; `lens` 1. What is seen through is
read with two bilinear taps per channel spread by `soft` (× the screen's height × how far behind the water it is): the
scene behind the water is out of focus beside it, and seen sharp through the water (which is in focus) the redwoods'
fog march showed its grain. `fs_focus` now marks the water for the lens only where the composite shows it half or more:
it used to mark the smoothed thickness's halo just past the outline, where the far fog then came out in focus, grainy.

### The rise (`pool.ts spawn`, `sim.wgsl`)

`spawn` while the show is awake puts each new particle on the floor marked `life −1`; `sim.wgsl` keeps a marked
RESTING particle under its own home (it slides with it: the front's two dancers cross the stage in their first fifth of
a second) until the body's rise lifts it, feet first when a rise has just been called (the front's opening, a body
changed on the front). Ten lines in `sim.wgsl`, after `rest` is known; the field agent's heat lines are untouched (the
merge of master kept both).

### Blocks and terraces (`surface.wgsl` edgeAt, waterAt, shade; `smooth.wgsl`; `params.ts`)

- The edge's tongues used to round their offset to whole texels and read the nearest one; where a tongue stretches the
  edge, neighbouring pixels read the same texel: small square blocks. Now the offset stays fractional and `waterAt`
  reads between the four texels (the distance only from those that have water).
- The narrow-range filter: a neighbour falling in or out of the depth range between one pixel and the next moved the
  mean by a step; along x then y those steps were rectangles. Each side of the range now fades (over the band's width
  in front, half of it behind).
- `depthNormal` 0.15 (was 0.5): the depth's normal is where the flat patches with hard edges show; A/B'd at 0.5, 0.25
  and 0 on the same close take (`9ab-depthnormal.jpg`).

## Before and after (left: this branch's base, `9b-*`; right: this branch, `9-*`; the same take)

The play is not bit-identical between runs: a pair shows the same staging, not always the same instant.

| pair | what it shows |
|---|---|
| `9-ba-g-redwoods-1p4.jpg` | **the redwoods at dusk at game distance (7.5 m, low camera):** the upper body was a grainy ghost cut off at the horizon; now the whole body reads as blue water |
| `9-ba-c-redwoods-1p2.jpg` | the same close (2.6 m): head and arms in front of the fog now blue water with the grass bent through them |
| `9-ba-lock-redwoods-0p5.jpg`, `-crop.jpg` | the locked jogo view at 1080p (a script places the pair 1.2 m apart, no brain): the grain on the head is gone and the blocks along the left edge; the side facing the fire is still pale |
| `9-ba-g-{geode,pool,temple,forge}-1p4.jpg` | the other worlds at game distance: the geode a little bluer; the Pool, the temple, the forge as they were (they never had the fault) |
| `9-ba-c-{geode,pool,temple,forge}-1p2.jpg` | the other worlds close |
| `9-ba-ice-g-{redwoods,temple}-0p4.jpg` | ice at game distance beside plasma: the redwoods' ice now reads as whole facets against the fog |
| `9-ba-arms-0p8.jpg`, `-1p2.jpg` | one water dancer close (1.7 m, the temple): fewer flat patches with hard edges |
| `9-ba-first-rise-0p2.jpg`, `-0p3.jpg` | **the front's first 0.3 s:** the rectangular column of streaks → a mound of water rising from the floor at the dancer's feet |
| `9-ba-redress-0p5.jpg` | a body changed on the front (fire → water): the new water rises from the floor |
| `9-ba-t-redwoods-jogo-0p5.jpg`, `9-ba-el-fw-redwoods-close-1p2.jpg`, `9-ba-el-water-solo-close-1p2.jpg` | the critic's takes, re-shot |

Sheets: `9-first-rise-sheet.jpg` (the front's first 1.2 s at 20 fps), `9-{g,c}-<world>-sheet.jpg`, `9-arms-sheet.jpg`,
`9-redress-sheet.jpg`.

## Timings (RTX 5090, 1920x1080, weft's profiler over 150 stepped frames)

Before: this branch's base, measured first in this session (`shots/w9-before/timings.jsonl`; the lock take on the base
served from 5458). After: the final code, after master's merge (`shots/w9/timings.jsonl`). `water.fog` is the new pass
(the redwoods and the geode only); it is counted with the surface. Other agents' renders shared the GPU throughout, and
the whole frames carry master's merge (the near fade, the gates' focus): the water's own passes are the comparison.

| scene (critic6 `t-*`; mine `lock-redwoods`) | water.surface before | water.surface + water.fog after | difference | frame before → after |
|---|---|---|---|---|
| temple, fire and water, 4 m | 0.19 | 0.15 | −0.04 | 2.25 → 2.39 |
| redwoods at dusk, fire and water, 4 m | 0.16 | 0.17 + 0.07 | +0.08 | 3.38 → 3.33 |
| redwoods jogo, locked, roda of four | 0.17 | 0.20 + 0.07 | +0.10 | 3.59 → 3.76 |
| hub, fire and water, 6 m | 0.12 | 0.13 | +0.01 | 1.83 → 3.25 (bloom and others up too: not the water's) |
| Pool fusion (steam) | 0.12 | 0.12 | 0 | 1.90 → 1.95 |
| redwoods, the locked view, the pair placed apart | 0.20 | 0.21 + ≤ 0.07 (not in the top eight) | ≤ +0.08 | 3.60 → 3.77 |

Within the +0.1 ms asked, at the limit in the redwoods' jogo. The fog estimate at full resolution in the composite
(two calls of the redwoods' 15-step march per water pixel) measured 0.35 to 0.68 ms there (frame 3.6 → 4.0 to 4.4):
that is why it is a pass of its own at an eighth of the resolution. At a quarter it was 0.10 to 0.11 ms, at an eighth
0.07 (most of that is the pass itself: it is cleared and drawn whatever the water covers).

## Weak points

1. **The side of a water body facing a fire still reads pale** at game distance in the redwoods' lock. It is not the
   water's rim, highlights, milk or reflection (each switched off leaves it), and with a gem dancer in the fire's place
   the same body is blue all over. My guess is the fire's light laid over the water by the air (`post/air.wgsl
   glowSeen`: where no dense flame is near enough to vote, a light over a body counts as 0.7 behind it); not traced.
2. **Grain** from the fog march still shows a little inside water in front of far fog: the air's own march has a
   per-pixel jitter, and the eighth-resolution estimate of it does not cancel the air's grain the way a full-resolution
   one did (that one cost too much).
3. **Blocks and terraces are fewer, not gone:** where capsules overlap, the bone frame a pixel takes its ripples and
   caustic from still switches along a vote's axis-aligned boundary, and the depth's normal, at 0.15, still shows the
   filter's steps faintly.
4. The fog estimate assumes the air in front of the water is the same air as behind it, thinner by its length (the
   redwoods' mist thickens near the ground and has shafts; a body in a shaft gets the shaft's average).
5. The lens makes thick water show the floor upside down inside it: water-like close up, but busier than before in the
   forge's lava light (`9-ba-c-forge-1p2.jpg`).
6. A gate's view of water (`fs_scene`) and the mirror copy get none of this (no fog fix: a gate's air fogs its water as
   far as what is behind; no lens).

## Checks

- `npm run typecheck`: clean.
- `npm test` (limits; the binding budget; 8 TS test files; audio; 10,034 gate checks; the net tests, smoothness
  included): all pass, run after master's merge with the final shaders.
- The binding budget: the water surface's fragment stage stays at 9 of 12 uniform buffers; sampled textures 9 of 16
  (8 after master's merge, +1 the fog estimate). No group-3 binding added.
- The dev servers (5457, 5458) are stopped at the end; every capture released the render lock.

## Files outside `src/matter/water/`

- `scripts/steps/water-9-gen.mjs`, `water-9.json`, `water-9-pairs.mjs`: my takes and the before/after pairs.
- `docs/reports/9-water.md`, `docs/reports/media/9-*.jpg`, `9b-*.jpg`, `9ab-*.jpg`.
- None in `src/` outside `src/matter/water/`.

## For the integrator

- `src/matter/water/sim.wgsl`: ten lines added after `rest` (a new particle's film under its home); the field agent's
  `fieldHeatFrom` and the plain freeze test are untouched (master merged into this branch cleanly).
- **On this branch after master's merge, `bend.jogo` was missing on `?jogo=script&script=none&world=temple`** (my
  `lock-temple` take threw `Cannot read properties of undefined (reading 'run')` twice; the same take on the base ran,
  and `world=redwoods` runs on both). I did not trace it; the take is left out of `water-9.json`.
- The hub's 1080p frame read 3.25 ms after against 1.83 before with the water's passes unchanged (bloom and others up):
  one run while other agents rendered, not separated.
- The depth contract is unchanged (the composite still writes colour only); in the geode and the redwoods the colour it
  writes is the pre-image of the right pixel under the air. Anything that changes `worldAir` for those worlds keeps
  it right as long as the air stays affine in the colour.

## For AGENTS.md (proposed, not edited)

- The frame's 'air' stage: "water's fog estimate (`water.fog`, an eighth of the resolution, the geode and the redwoods
  only), the water bodies composited, …".
- The binding table: `matter/water/surface.wgsl` fragment: 9 / 2 / 9 (sampled textures 9 of 16: the fog estimate).
- Under the depth contract: "In a world with no scene step the water composite pre-compensates for the air (it writes
  what the air turns into the right pixel: surface.wgsl fs), because the alpha must stay the opaque distance for fire's
  splat, which runs after it."
