# 27: the glass was the other half (a MacBook, round two)

Branch `perf-mac2`, from master `ff2d66d` (report 26: an Apple GPU gets the laptop budget, water's splat without
`frag_depth`). Same machine and method as report 26: an M3 Max, headless Chrome on Metal, a 1512×945 window at device
pixel ratio 2, other sessions' GPU captures running alongside the whole time.

## What was found

Live frames ran at about 30 ms at render scale 0.66 while the frame's own GPU work, stepped frozen, cost about 13 ms
there. The difference was outside the run list: the **page's glass**. Every panel shares `--eb-blur` (a
`backdrop-filter: blur(14px) saturate(1.25)`), and the hub's gate names, the YOU tag and the front's strip sit over the
live canvas. A backdrop filter over a canvas that changes every frame makes the browser's compositor read back and
blur what's under each panel again every frame, on the same GPU, and none of it shows in the game's own timings.
Alternating 3 s windows on one page (scale fixed at 0.66):

| | frame interval |
|---|---|
| as it was | 26.5 ms |
| no backdrop filter anywhere | 17.6 ms |
| every DOM overlay hidden | 16.7 ms |
| blur 6 px instead of 14 | 19.2 ms |
| `saturate()` alone, no blur | 22.3 ms (no better) |
| `--eb-blur: none` | 16.7 ms |

## What changed

- **`--eb-blur: none`** (index.html), and the YOU tag's and the online notice's own blur gone too. The glass's smoke is a
  little deeper (the lower gradient 0.5/0.48 → 0.64/0.62) so the names over the stage read as they did; side by side
  they look the same.
- **A laptop's gate views at 0.32 of the main view** (was 0.4): about a third fewer pixels for each live view.

## Numbers (fps over 5 s windows, live, the default URL, before = the live site at ff2d66d)

| page | before | after |
|---|---|---|
| hub | 26 · 30 · 30 · 37 · 35 | 37 · 50 · 47 · 59 · 59 |
| hub, again | 34 · 42 · 35 · 28 · 29 | 44 · 57 · 59 · 59 · 55 |
| temple duel | 26 · 30 · 34 · 36 | 30 · 42 · 39 · 42 |

The duel's HUD is drawn on the canvas, not with the glass, so it gains less. At the laptop's full 1.5× pixel ratio the
hub still runs about 35 fps (the GPU's own work); the autoscaler settles near 0.66–0.85 of it. What's left there:
the solid things' shaders all hold a `discard` (the near fade's dither, worlds/light.wgsl `sightDrop`), which on a tile GPU
turns off hidden-surface removal for the scene pass, and the geode's wall is a fullscreen backdrop drawn first, so it's
shaded under every solid in front of it. A pipeline without the dither while nothing fades, and the backdrop drawn last
against the solids' depth, are the next things to try.

**Elsewhere:** every project on ericlevin.dev carries a copy of PortfolioII's `src/shared/kit.ts`, Aether's glass, and
any panel with a backdrop blur over a live WebGPU canvas pays the same way.
