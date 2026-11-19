# 26: Energy Bending on a MacBook (M3 Max), from 9 fps to 25–45

Branch `perf-mac`, from master `8b2027a`. Eric: "much too slow even on my MacBook M3 Max".

**Measured** on the M3 Max itself, headless Chrome 157 on Metal (`apple metal-3`), a 1512×945 window at a device pixel
ratio of 2 (a 14" MacBook Pro's Retina screen), the built page (`vite build` + `vite preview`). Other sessions were
running their own GPU captures on the same machine the whole time, so absolute numbers swing by up to 2×. What's below
is either A/B in alternating runs, or each pass switched off every other frame (contention hits both halves alike), or
the minimum of many frozen frames (`bend.kit.manual`, one frame at a time, waiting on the GPU). **Not measured:** the
page in Eric's own (headed) Chrome; a 120 Hz screen; Safari.

## What was wrong

1. **The Mac ran the RTX 5090's budget.** The device probe (engine/perf.ts, one additive fill) scores an M3 Max past the
   desktop line, so it got `desktop`: 4× MSAA, the full Retina pixel ratio (3024×1890 rendered), three gate views
   with gates seen through gates, water's surface at full resolution with three smoothing rounds. The default page (the
   geode hub) ran at **9 fps**; the autoscaler crawled down from scale 0.92 and was still at 9–16 fps at its floor
   (1512×945), because most of the cost didn't shrink with the pixels.
2. **Water's depth splat wrote `frag_depth`.** Every water and ice particle (48 000 on the hub's water dancer) is a
   sphere splatted into a depth buffer, and the fragment shader wrote each sphere's true depth. On Apple's tile-based
   GPUs a shader that writes depth turns off hidden-surface removal and early depth for the whole draw: about 6.4 ms
   a view, nearly resolution-independent, paid again for the floor's mirror copy and each gate's view.
3. The quality governor (engine/quality.ts: the air's march steps, reflections, particle counts) ran only on phones,
   with 30 fps thresholds.

## What changed

- **An Apple GPU is never `desktop`** (`chooseClass`): it gets `laptop` (no MSAA, pixel ratio capped at 1.5, one live
  gate, water at 0.75 resolution with two smoothing rounds). `?class=desktop` and films still get what they ask for.
  A browser's kept probe result maps through the same rule, so Eric's cached "desktop" turns into laptop on his next load.
- **Gates' depth is in the budget** (`gates.depth`): laptops and phones show a gate seen through a gate as its still,
  not a third live view. About 10 ms on the hub at 1.5×.
- **Water's splat orders its drops by the rasterizer's own depth** (`frontOf` in matter/water/splat.wgsl): each
  billboard is moved to its sphere's nearest point and the fragment writes only the distance channel. 6.4 ms down to
  0.7 ms for the main view, and the same for the mirror and gate copies. Two drops now meet in a straight cut instead of
  a crease where they cross; after the smoothing rounds a water dancer up close looks the same (compared frame for
  frame, old and new).
- **The laptop's dynamic resolution stops at 0.65** (was 0.5: about 1× the CSS pixels at the 1.5 cap) and the
  **quality governor runs on laptops too**, its thresholds taken from the class's own frame rate (`FrameQuality.target`:
  slow past 1.2× the frame interval on average or 1.5× for a tenth of frames, room under 1.06× / 1.2×). The phone keeps
  its iPhone-tuned numbers.

## Numbers (fps over 5 s windows, live, autoscaler on, the default URL: the probe picks the class)

| page | before | after |
|---|---|---|
| hub (geode), default | 9 · 9 · 9 · 11 · 11 · 16 (2782→1512 wide) | 25 · 29 · 26 · 20 · 21 · 21 (1905→1497) |
| hub, second run | 11 · 13 · 14 · 16 · 18 · 18 | 22 · 26 · 26 · 26 · 33 · 34 |
| duel, temple, fire v water | 7 · 11 · 11 · 13 | 32 · 45 · 35 · 30 |
| duel, redwoods | 18 · 19 · 24 · 31 | 22 · 31 · 31 · 38 |

The main view alone (the hub, frozen, laptop class at 1.5×: 2268×1418) costs about 20 ms of GPU with the machine
loaded; what's left is spread wide: the scene ~5, the air ~3.5 (2.3 of it the shaft's caustic rays), water ~4, fire ~3,
the merge ~2, bloom ~1.3. A live gate view adds 5–8 ms. Next, if it's still short of 60 in Eric's Chrome: the geode's
caustic rays at half resolution, the gate views at a lower scale, fire's composite at half resolution.

How it was measured (scripts in the session's scratchpad, not kept): a frozen bench stepping `bend.kit.step(1e-4)` one
frame at a time and waiting on `queue.onSubmittedWorkDone`; run-list items switched off by label every other frame
(`frame.list()`'s passes have `enabled`); live fps from rAF intervals in 5 s windows.
