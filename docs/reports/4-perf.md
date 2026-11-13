# Report 4: phones and laptops, the budget (the self-measuring page)

## The Mac run: open this

The service is running on this PC (port 5441, tailnet only). On the MacBook Pro, open in **Chrome** (any recent
version: WebGPU is on by default since Chrome 113):

```
https://portal-windows.tail4a295a.ts.net:5441/energybending/?perf=default&device=macbook-pro&sink=https%3A%2F%2Fportal-windows.tail4a295a.ts.net%3A5441%2Fenergybending%2F__perf
```

- **No click is needed.** The page plans its run, reloads itself once into the first group of scenes, reloads again
  into the second, and ends with **PERF DONE** at the top left over a summary table (and `data-perf="done"` on
  `<body>`, `window.__perf` holding the JSON). If the POST failed, a "copy the results (JSON)" button is there.
- **How long:** about 6 minutes on this PC (17 scenes × two runs of 5 s each, with warm-ups, and two page loads). The
  first load on a new browser profile compiles every pipeline and can take a minute or more before the first scene.
  Keep the window in front, the lid open and the machine on power; do not touch it until PERF DONE.
- **Quick variant** (about 2.5 minutes): replace `perf=default` with `perf=quick`.
- **Also worth one run each, if there's time:** add `&class=laptop` or `&class=desktop` to force a class (the default
  is the class the probe picks), and `&baseline` (only WebGPU's default limits).
- **Safari:** WebGPU is on by default from Safari 26 (macOS Tahoe). The page should run there (weft's FrameBudget paces
  by frames on WebKit, and its GPU timestamps are not trusted, so only frame intervals will be reported). Not tested
  here: there is no Safari on this PC.
- The **MacBook Air** (it showed as active on the tailnet during this session) takes the same URL with
  `device=macbook-air`. An **iPhone** takes it with `device=iphone` (Safari 26).
- Results land in `docs/reports/perf/<device>[-<variant>]-<date>.json` in this worktree as each scene finishes. See
  what has arrived at `https://portal-windows.tail4a295a.ts.net:5441/energybending/__perf`. Then
  `node scripts/perf-report.mjs` prints the table with every device as a column.

## How the suite works

`?perf=<suite>&sink=<url>` (`src/engine/perfrun.ts`, wired in `src/main.ts`).

1. **The first load only plans.** It writes the run (an id, the suite, the groups) to `sessionStorage` and replaces
   itself with the first group's URL: the scenes that need players load with `?play&two`, the gem dancers without.
   Each group's page carries its results forward in `sessionStorage`, and the last one posts the whole run.
2. **The class** is chosen as the app boots (below). In group 0 the probe always runs fresh; later loads reuse it.
3. **Sound** starts only if an `AudioContext` made without a click runs at once (Chrome headless allows it; a normal
   Chrome window or Safari does not). If not, `music.start` is skipped and the clock runs on the page's time, as it
   does before a touch. The run records which (`audio`).
4. **The display's refresh**: the app's loop is paused, 90 bare `requestAnimationFrame` intervals are timed, and their
   median is snapped to a common rate (60, 120, 144, ...). The loop starts again.
5. **Each scene** is staged with `bend` calls: the world (`bend.world`), dress (`bend.dress`), the follow camera's
   params (`bend.set('camera', …)`), `bend.wake`, `bend.place`, `bend.move`, `bend.lock`, and an `each` callback for
   the critic's held yaw. Then `await kit.ready()`, because a draw whose pipeline isn't compiled is skipped silently.
   The critic's six scenes set the canvas to exact device pixels (1280×800 or 1920×1080, the CSS size divided by the
   pixel ratio). The rest run at the window's own size (`native`, what a player gets).
6. **Two runs per scene, in real time** (the loop is never stepped): **auto** (the class's autoscaler from its
   budget, starting at the class's maximum scale, 5 s to settle) and **fixed** (autoscaler off, render scale 1, 2.5 s
   warm). Each measures for 5 s:
   - frame intervals from `requestAnimationFrame`: mean, p50, p95, p99, max, fps, **dropped** (the vsyncs missed:
     `round(interval / refresh) − 1` summed) and **late** (intervals over 1.5 refreshes);
   - the JS time per frame (`kit.step` wrapped: CPU phases, encoding, submit) and per CPU phase (`frame.update`
     re-run with a clock around each phase);
   - weft's profiler, forced on: the GPU frame and each pass, from each completed frame's raw numbers (`lastMs`,
     counted by `serial`), with `trusted` (weft's own judgement) and `passesTrusted` (trusted and not an Apple GPU: on a
     tile GPU per-pass times describe the passes' structure more than their cost, and only the frame total is read);
   - the render scale (end, mean, range), render and canvas size, pixel ratio, live gate views (sampled);
   - after both runs, `bend.stats().matter` (particle counts per kind) and the views.
7. **Recorded once**: user agent and platform, cores, memory, screen and window, the adapter's `info` (vendor,
   architecture, device, description, driver, backend), its limits and features, the device's granted limits and
   features, the class and how it was chosen, the probe, every budget, `?baseline`, pipelines built and failed, and
   errors (weft's, `console.error`, uncaught errors, a lost device).
8. **Reporting**: after each scene the run so far is POSTed (`text/plain`, so a cross-origin sink needs no
   preflight). The sink replaces the file each time; the last POST has `done: true`.

`scripts/perf-remote.mjs` builds (`npm run build`), picks a port in 5440 to 5449 that neither `tailscale serve status`
nor a local listener has, starts the server **detached** (on Windows through WMI's `Win32_Process.Create`, so it is no
child of the session's shell), binds it to 127.0.0.1, maps it with `tailscale serve --bg --https=<port>
http://127.0.0.1:<port>` (tailnet only, no Funnel, no other mapping touched), and prints the URL. The server serves
`dist/` at `/energybending/` and the sink at `POST /energybending/__perf`. It names each file by `?device=`, else the
posting machine's tailnet name (from `tailscale whois` on the forwarded address; it said `portal-windows` for the runs
here), else the platform. `--local` runs the suite here in headless Chrome through the tailnet URL, holding the render
lock only for the run. `--status` and `--stop` do what they say. `scripts/perf-report.mjs` makes the tables.

## This PC (RTX 5090, headless Chrome through the tailnet URL)

Runs: `portal-windows-headless-2026-11-13`, `portal-windows-headless-baseline-2026-11-13`. Frame times are the mean interval between animation frames in real
time (so capped by the display: a 60 Hz display never shows under 16.7 ms); "p95" is the 95th percentile.

#### At render scale 1 (the true cost)

| scene | size | portal-windows-headless-2026-11-13 | portal-windows-headless-baseline-2026-11-13 |
|---|---|---|---|
| critic-800-redwoods-close | 1280x800 | 18.3 ms, 54.6 fps (p95 19.0) 1280×800 | 18.2 ms, 54.9 fps (p95 18.9) 1280×800 |
| critic-800-geode-hub-pair | 1280x800 | 18.3 ms, 54.7 fps (p95 19.0) 1280×800 | 18.3 ms, 54.8 fps (p95 19.0) 1280×800 |
| critic-1080-redwoods-close | 1920x1080 | 18.2 ms, 54.8 fps (p95 18.9) 1920×1080 | 18.2 ms, 54.9 fps (p95 19.0) 1920×1080 |
| critic-1080-geode-hub-pair | 1920x1080 | 18.3 ms, 54.7 fps (p95 18.9) 1920×1080 | 18.2 ms, 54.8 fps (p95 19.0) 1920×1080 |
| pair-pool-wide | native | 18.2 ms, 54.9 fps (p95 18.8) 1280×800 | 18.2 ms, 55.0 fps (p95 18.9) 1280×800 |
| pair-pool-close | native | 18.2 ms, 54.9 fps (p95 18.8) 1280×800 | 18.2 ms, 55.0 fps (p95 18.7) 1280×800 |
| pair-redwoods-wide | native | 18.2 ms, 54.8 fps (p95 19.0) 1280×800 | 18.2 ms, 54.8 fps (p95 19.0) 1280×800 |
| pair-redwoods-close | native | 18.4 ms, 54.3 fps (p95 19.1) 1280×800 | 18.3 ms, 54.8 fps (p95 19.0) 1280×800 |
| hub-gates | native | 18.5 ms, 54.1 fps (p95 19.2) 1280×800 | 18.2 ms, 54.9 fps (p95 19.0) 1280×800 |
| locked-forge | native | 18.4 ms, 54.4 fps (p95 19.1) 1280×800 | 18.2 ms, 54.9 fps (p95 19.0) 1280×800 |
| critic-800-ice-plasma | 1280x800 | 18.3 ms, 54.6 fps (p95 19.1) 1280×800 | 18.2 ms, 54.8 fps (p95 19.0) 1280×800 |
| critic-1080-ice-plasma | 1920x1080 | 18.4 ms, 54.3 fps (p95 19.1) 1920×1080 | 18.2 ms, 54.8 fps (p95 19.0) 1920×1080 |
| gems-geode | native | 18.3 ms, 54.6 fps (p95 19.1) 1280×800 | 18.2 ms, 54.9 fps (p95 19.0) 1280×800 |
| gems-redwoods | native | 18.5 ms, 54.2 fps (p95 19.2) 1280×800 | 18.3 ms, 54.6 fps (p95 19.1) 1280×800 |
| gems-pool | native | 18.4 ms, 54.3 fps (p95 19.0) 1280×800 | 18.3 ms, 54.6 fps (p95 19.0) 1280×800 |
| gems-temple | native | 18.4 ms, 54.4 fps (p95 19.1) 1280×800 | 18.3 ms, 54.5 fps (p95 19.1) 1280×800 |
| gems-forge | native | 19.1 ms, 52.4 fps (p95 19.2) 1280×800 | 18.4 ms, 54.3 fps (p95 18.9) 1280×800 |

#### With the class's autoscaler (what a player gets)

| scene | size | portal-windows-headless-2026-11-13 | portal-windows-headless-baseline-2026-11-13 |
|---|---|---|---|
| critic-800-redwoods-close | 1280x800 | 18.4 ms, 54.5 fps, scale 1.00 (1280×800) | 18.2 ms, 54.8 fps, scale 1.00 (1280×800) |
| critic-800-geode-hub-pair | 1280x800 | 18.2 ms, 54.8 fps, scale 1.00 (1280×800) | 18.2 ms, 54.9 fps, scale 1.00 (1280×800) |
| critic-1080-redwoods-close | 1920x1080 | 18.2 ms, 55.1 fps, scale 1.00 (1920×1080) | 18.2 ms, 54.8 fps, scale 1.00 (1920×1080) |
| critic-1080-geode-hub-pair | 1920x1080 | 18.3 ms, 54.7 fps, scale 1.00 (1920×1080) | 18.2 ms, 54.9 fps, scale 1.00 (1920×1080) |
| pair-pool-wide | native | 18.2 ms, 54.9 fps, scale 1.00 (1280×800) | 18.2 ms, 55.0 fps, scale 1.00 (1280×800) |
| pair-pool-close | native | 18.3 ms, 54.7 fps, scale 1.00 (1280×800) | 18.3 ms, 54.7 fps, scale 1.00 (1280×800) |
| pair-redwoods-wide | native | 18.2 ms, 54.9 fps, scale 1.00 (1280×800) | 18.3 ms, 54.7 fps, scale 1.00 (1280×800) |
| pair-redwoods-close | native | 18.2 ms, 54.9 fps, scale 1.00 (1280×800) | 18.2 ms, 54.9 fps, scale 1.00 (1280×800) |
| hub-gates | native | 18.4 ms, 54.3 fps, scale 1.00 (1280×800) | 18.2 ms, 54.9 fps, scale 1.00 (1280×800) |
| locked-forge | native | 18.4 ms, 54.4 fps, scale 1.00 (1280×800) | 18.2 ms, 54.9 fps, scale 1.00 (1280×800) |
| critic-800-ice-plasma | 1280x800 | 18.3 ms, 54.6 fps, scale 1.00 (1280×800) | 18.2 ms, 54.8 fps, scale 1.00 (1280×800) |
| critic-1080-ice-plasma | 1920x1080 | 18.4 ms, 54.2 fps, scale 1.00 (1920×1080) | 18.2 ms, 54.9 fps, scale 1.00 (1920×1080) |
| gems-geode | native | 18.4 ms, 54.2 fps, scale 1.00 (1280×800) | 18.3 ms, 54.8 fps, scale 1.00 (1280×800) |
| gems-redwoods | native | 18.5 ms, 54.1 fps, scale 1.00 (1280×800) | 18.4 ms, 54.4 fps, scale 1.00 (1280×800) |
| gems-pool | native | 18.5 ms, 54.0 fps, scale 1.00 (1280×800) | 18.4 ms, 54.5 fps, scale 1.00 (1280×800) |
| gems-temple | native | 18.5 ms, 54.1 fps, scale 1.00 (1280×800) | 18.3 ms, 54.6 fps, scale 1.00 (1280×800) |
| gems-forge | native | 18.8 ms, 53.3 fps, scale 1.00 (1280×800) | 18.4 ms, 54.4 fps, scale 1.00 (1280×800) |

#### GPU time per frame at scale 1 (weft's profiler; only where its timestamps are trusted)

| scene | size | portal-windows-headless-2026-11-13 | portal-windows-headless-baseline-2026-11-13 |
|---|---|---|---|
| critic-800-redwoods-close | 1280x800 | **3.30** ms (scene 1.67, air 0.38, scene.gate0 0.35, scene.gate1 0.25) | **3.50** ms (scene 1.80, air 0.38, scene.gate0 0.37, scene.gate1 0.25) |
| critic-800-geode-hub-pair | 1280x800 | **2.23** ms (scene 0.90, scene.gate1 0.26, scene.gate0 0.25, air 0.07) | **2.23** ms (scene 0.93, scene.gate1 0.25, scene.gate0 0.25, air 0.07) |
| critic-1080-redwoods-close | 1920x1080 | **3.95** ms (scene 2.28, air 0.78, water.splat.depth 0.10, lens 0.08) | **3.94** ms (scene 2.27, air 0.77, water.splat.depth 0.10, lens 0.08) |
| critic-1080-geode-hub-pair | 1920x1080 | **2.90** ms (scene 1.38, scene.gate1 0.26, scene.gate0 0.25, air 0.11) | **3.00** ms (scene 1.52, scene.gate1 0.25, scene.gate0 0.25, air 0.10) |
| pair-pool-wide | native | **1.36** ms (scene 0.44, scene.gate0 0.33, water.splat.depth 0.05, lens 0.05) | **1.41** ms (scene 0.44, scene.gate0 0.33, water.splat.depth 0.05, water.splat.thick 0.05) |
| pair-pool-close | native | **1.82** ms (scene 1.15, water.splat.depth 0.08, water.splat.thick 0.05, lens 0.05) | **1.86** ms (scene 1.15, water.splat.depth 0.08, water.splat.thick 0.05, lens 0.05) |
| pair-redwoods-wide | native | **2.45** ms (scene 1.24, air 0.39, water.splat.depth 0.05, water.splat.thick 0.05) | **2.34** ms (scene 1.24, air 0.39, water.splat.depth 0.05, water.splat.thick 0.05) |
| pair-redwoods-close | native | **3.13** ms (scene 2.05, air 0.40, water.splat.depth 0.08, water.splat.thick 0.05) | **3.02** ms (scene 1.93, air 0.40, water.splat.depth 0.09, water.splat.thick 0.05) |
| hub-gates | native | **2.17** ms (scene 0.91, scene.gate1 0.25, scene.gate0 0.25, air 0.07) | **2.35** ms (scene 0.95, scene.gate1 0.26, scene.gate0 0.25, air 0.07) |
| locked-forge | native | **5.93** ms (scene 5.04, lens 0.21, water.splat.depth 0.08, water.splat.thick 0.05) | **5.93** ms (scene 4.98, lens 0.21, water.splat.depth 0.09, water.splat.thick 0.05) |
| critic-800-ice-plasma | 1280x800 | **1.17** ms (scene 0.58, lens 0.05, water.splat.depth 0.05, water.splat.thick 0.05) | **1.24** ms (scene 0.61, air 0.05, lens 0.05, water.splat.depth 0.05) |
| critic-1080-ice-plasma | 1920x1080 | **1.73** ms (scene 0.90, lens 0.09, air 0.07, water.smooth.x0 0.05) | **1.72** ms (scene 0.90, air 0.09, lens 0.09, water.smooth.x0 0.05) |
| gems-geode | native | **0.86** ms (scene 0.37, air 0.18, lens 0.05, field.step 0.04) | **0.78** ms (scene 0.33, air 0.18, lens 0.05, field.step 0.04) |
| gems-redwoods | native | **1.93** ms (scene 1.27, air 0.40, lens 0.05, field.step 0.03) | **1.93** ms (scene 1.26, air 0.40, lens 0.05, field.step 0.03) |
| gems-pool | native | **0.92** ms (scene 0.24, trail 0.08, lens 0.08, air 0.07) | **0.79** ms (scene 0.23, lens 0.08, trail 0.07, air 0.06) |
| gems-temple | native | **0.91** ms (scene 0.49, lens 0.05, air 0.05, trail 0.04) | **0.71** ms (scene 0.43, lens 0.05, air 0.04, field.step 0.02) |
| gems-forge | native | **0.59** ms (scene 0.37, field.step 0.04, lens 0.04, trail 0.01) | **0.61** ms (scene 0.37, field.step 0.04, lens 0.04, trail 0.01) |

#### CPU (JS) per frame at scale 1, ms: the whole step / the dancers phase / the matter phase

| scene | size | portal-windows-headless-2026-11-13 | portal-windows-headless-baseline-2026-11-13 |
|---|---|---|---|
| critic-800-redwoods-close | 1280x800 | 1.90 / 0.36 / 0.24 | 1.30 / 0.23 / 0.17 |
| critic-800-geode-hub-pair | 1280x800 | 1.70 / 0.28 / 0.23 | 1.32 / 0.22 / 0.18 |
| critic-1080-redwoods-close | 1920x1080 | 1.07 / 0.21 / 0.16 | 0.97 / 0.19 / 0.14 |
| critic-1080-geode-hub-pair | 1920x1080 | 1.36 / 0.23 / 0.18 | 1.20 / 0.20 / 0.15 |
| pair-pool-wide | native | 1.20 / 0.22 / 0.17 | 1.07 / 0.21 / 0.15 |
| pair-pool-close | native | 1.13 / 0.21 / 0.17 | 1.25 / 0.28 / 0.18 |
| pair-redwoods-wide | native | 1.17 / 0.23 / 0.17 | 0.91 / 0.17 / 0.14 |
| pair-redwoods-close | native | 2.34 / 0.49 / 0.33 | 0.94 / 0.18 / 0.15 |
| hub-gates | native | 2.84 / 0.61 / 0.36 | 0.98 / 0.16 / 0.12 |
| locked-forge | native | 2.16 / 0.48 / 0.33 | 0.89 / 0.19 / 0.15 |
| critic-800-ice-plasma | 1280x800 | 1.92 / 0.40 / 0.28 | 0.86 / 0.18 / 0.14 |
| critic-1080-ice-plasma | 1920x1080 | 2.15 / 0.45 / 0.31 | 1.00 / 0.19 / 0.15 |
| gems-geode | native | 1.90 / 0.23 / 0.23 | 0.83 / 0.09 / 0.10 |
| gems-redwoods | native | 2.05 / 0.26 / 0.24 | 1.20 / 0.13 / 0.14 |
| gems-pool | native | 1.96 / 0.23 / 0.25 | 1.23 / 0.13 / 0.14 |
| gems-temple | native | 1.62 / 0.18 / 0.17 | 1.30 / 0.14 / 0.14 |
| gems-forge | native | 4.38 / 1.36 / 0.34 | 2.95 / 0.34 / 0.26 |

#### The devices

- **portal-windows-headless-2026-11-13**: nvidia blackwell 0x2b85 NVIDIA GeForce RTX 5090 (GL: ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 (0x00002B85) Direct3D11 vs_5_0 ps_5_0, D3D11)); class **desktop** (probe, probe 230.9 Gpix/s); display 55.2 Hz; dpr 1, window 1280×800; audio on; GPU timestamps trusted; 0 error(s); pipelines failed: 0. Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36
- **portal-windows-headless-baseline-2026-11-13**: nvidia blackwell 0x2b85 NVIDIA GeForce RTX 5090 (GL: ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 (0x00002B85) Direct3D11 vs_5_0 ps_5_0, D3D11)); class **desktop** (probe, probe 245.4 Gpix/s); display 54.9 Hz; dpr 1, window 1280×800; baseline limits; audio on; GPU timestamps trusted; 0 error(s); pipelines failed: 0. Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36

**What the load was.** Other projects shared the machine through both runs. Total CPU (typeperf, every 10 s) stood at
**68 to 100 % (mostly about 90 %) through the default run and 36 to 100 % through the baseline run**. The GPU
(nvidia-smi, every 10 s) was at 3 to 38 % with 35 to 196 W drawn, part of that ours; 20 to 21 GB of its memory was in
use by other processes. Each run waited for the shared render lock first (other captures held it), and held it for
about 5.5 minutes. The `?baseline` column matches the default one within the noise (±0.2 ms): the limits cost nothing
on the 5090. So the CPU columns are noisy and probably high. The
GPU numbers repeat the critic's stepped numbers closely (redwoods close 3.30 against 3.28 ms, the geode pair 2.23
against 2.22, plasma and ice 1.17 against 1.16, the locked forge 5.9 against 7.2: the clash differs with what the
dancers are doing in real time).

**Read the frame columns with care.** Headless Chrome on this PC paces `requestAnimationFrame` at about **55 Hz** (the
refresh probe found 54.6 to 55.2 Hz, no real display). Every scene sits on that cadence with no late frames, so the
frame columns show only that the 5090 never misses it. The GPU column is the cost on this PC. On the Mac, in a real
window, the frame columns are the point: a 120 Hz ProMotion display shows headroom up to 8.3 ms.

The autoscaler never moved off 1.0 on this PC: the heaviest scene is 6 ms of a 14 ms budget. The probe scored
**231 to 254 Gpix/s** over three runs (desktop, chosen in 0.8 to 1.6 s).

With `?baseline` (only WebGPU's default limits, as a phone has), every scene built and ran: 0 pipelines failed, 0
validation errors.

`?class=phone` forced on this PC (one quick check, gems in the geode) gave the phone's counts as `coarse` always did
(9,000 stones, a 32×24×32 field, 3,000 steam puffs, 700 cave stones) and the phone's autoscaler range (the auto run
held 0.85, 1088×680); no errors. The rebuilt build (with `budget()`) ran the locked forge cleanly before the service
was left up.

## The budget classes

`src/engine/perf.ts` `BUDGETS` (typed `Record<DeviceClass, Budget>`):

| | desktop | laptop | phone |
|---|---|---|---|
| target fps | 60 | 60 | 30 |
| autoscaler GPU budget (ms) | 14 | 12 | 26 |
| render scale | 0.5 to 1 | 0.5 to 1 | 0.5 to 0.85 |
| pixel ratio cap | 2 | **1.5** | 2 |
| `coarse` (what kinds read today) | false | false | true |
| gem stones (all dancers) | 15,000 | 12,000 | 9,000 |
| flames per fire dancer | 150,000 | 80,000 | 40,000 |
| water per water dancer | 100,000 | 60,000 | 40,000 |
| water surface resolution, smoothing passes | 1, 2 | 0.75, 2 | 0.5, 1 |
| steam puffs | 9,000 | 6,000 | 3,000 |
| sprite scale (flames, steam, smoke, mist, sparks) | 1 | 0.85 | 0.7 |
| field grid, cell | 48×32×48, 0.18 m | 40×28×40, 0.21 m | 32×24×32, 0.26 m |
| live gates, their scale | 2, 0.5 | 1, 0.4 | 1, 0.4 |
| depth of field | on | on | off |

Desktop is today's numbers. Phone is today's `coarse` numbers (the ones each kind and world hard-codes now) plus the
fill cut the critique asked for (sprite scale 0.7 is about half the fill per sprite). Laptop is between. Why laptop
looks like this:

- **Fill is the cost.** Every expensive pass here is fill: the locked forge's 5.0 ms scene pass is flames, steam and
  smoke overlapping; a close fire dancer is 2 ms. A laptop GPU in the M-series Pro / Max range is perhaps a fifth to a
  tenth of a 5090 in fill (an estimate: the Mac run will say). That puts the clash at 30 to 60 ms at full counts. So
  the laptop row cuts fill three ways: fewer flames (80k), smaller sprites (0.85² ≈ 0.72 of the fill each), and
  fewer pixels.
- **Pixels first.** A Retina MacBook at a pixel ratio of 2 renders 4× its CSS pixels: a full-screen Chrome window on
  a 14" Pro is about 3024×1890, 5.7 Mpix, 5.6× this PC's 1280×800 headless frame. The cap of 1.5 gives 0.56 of that
  before the autoscaler starts; its scale of 0.5 gives a quarter again.
- **Gates.** A live gate into the redwoods costs about 0.35 ms here at half scale; one live gate at 0.4 on a laptop.
- **Phones** hold 30 fps through weft's `FrameBudget` (by frame pacing on WebKit, where GPU timestamps aren't trusted),
  starting at 0.85. The pixel-ratio cap stays 2 (an iPhone's is 3).

**Not yet applied** (this file only): the laptop's counts reach no kind until its owner reads them (next section).
What a laptop gets today from the class: the 12 ms budget, the 1.5 pixel-ratio cap, the autoscaler (`FrameBudget` on
WebKit). A phone gets what it got before (`coarse` is true exactly when the browser is a phone's, as the pointer test
said) plus the phone's autoscaler range and `FrameBudget`.

### How the class is chosen

`chooseClass(kit, query)` in `src/engine/perf.ts`, called in `main.ts` right after the kit is made, before any kind,
world or the field is declared:

1. `?class=desktop|laptop|phone` forces it.
2. A film (`?film`) is always desktop (its frames must repeat).
3. weft's `isPhone()` (a phone's or a tablet's browser, an iPad saying it's a Mac, or a small screen with a coarse
   pointer) gives phone.
4. A software adapter (`isFallbackAdapter`, SwiftShader, llvmpipe) gives phone.
5. Otherwise **the probe** (`probeFill`, up to 2 s): additive fill of K full-target triangles into a 1024² rgba16float
   target, with a flame sprite's worth of ALU in the fragment, timed by the queue's round trip
   (`onSubmittedWorkDone`, which works where timestamps don't). K doubles until a submit takes 15 ms more than an empty
   one; then K and 2K alternate and the best of each is kept, so the fixed round trip (≈ 40 ms on WebKit) cancels in
   the difference. Score: Gpix/s. **Desktop from 50, laptop from 6, else phone** (`PROBE_CLASS`). This PC's 5090 scores
   about 230 to 250, so desktop starts at about a fifth of a 5090 and laptop at about a fortieth. Only the 5090 is
   measured: the Mac's score will place these lines properly (an M-series Max should land in laptop or low desktop).
6. The probe's result is kept in `localStorage` per adapter and user agent for 30 days (`?probe` probes again), so
   only a browser's first visit pays for it. On this PC the probe takes 0.8 to 1.6 s.

`bend.device` shows the choice in a page (class, how, the probe, the adapter, the GL name, Apple GPU, WebKit, and the
old pointer guess). `budget()` and `deviceClass()` (exported from `engine/perf.ts`) are what a kind or world reads at
declare; `perfState.choice` is set the moment the class is chosen.

## What each owner should read from the table

Each owner keeps working with `coarse` as now. To use the class, `import { budget } from '../../engine/perf'` at
declare and read:

| owner (task) | where it reads `coarse` today | read instead |
|---|---|---|
| fire and plasma (1) | `matter/fire/fire.ts:152` `perDancerCoarse` / `perDancer` | `budget().flamesPerDancer`; `budget().spriteScale` × `fireParams.size` |
| water and ice (2) | `matter/water/pool.ts:76` (perDancer, resolution, smoothPasses) | `budget().waterPerDancer`, `.waterResolution`, `.waterSmooth` |
| post, the lens (3) | `post/post.ts:51` `dof = false` | `budget().dof` |
| gates (4) | `portals/portals.ts:140` live, scale | `budget().gates.live`, `budget().gates.scale` |
| steam (5) | `matter/reactions/steam.ts:30` `pool / 3` | `budget().steam`; `budget().spriteScale` for the puffs' size |
| gems (8) | `dancer/show.ts:48,60` count 9000, × 0.55 | `budget().stones` (and `stones / 15000` for a programme's own count) |
| the field | `matter/field/field.ts:131` dims, cell | `budget().field.dims`, `budget().field.cell` |
| worlds (6, 7) | ripple cells, embers, pollen, motes, layouts | keep `coarse` for the geometry; `budget().spriteScale` for embers, pollen and motes, the one fill number they have |

## Weak points

- **Nothing has been measured on a laptop or a phone yet.** The laptop and phone rows, and the probe's two thresholds,
  are estimates from the 5090 and from what is known of Apple GPUs. They should be redrawn once the Mac's JSON is in.
- **Headless frame pacing on this PC is about 55 Hz**, so this PC's frame columns say nothing beyond "never late".
  The GPU column is the measure here. A non-headless Chrome run here would show the display's real rate.
- **The probe measures fill and a little ALU, not this game.** On Apple's tile GPUs blending happens in tile memory
  and is cheap, so a Mac may score higher than its game frame suggests. That would show in the Mac's run as a desktop
  class that misses its frames, and is why each run records both the probe's score and the scenes.
- **Per-pass GPU times on Apple are not comparable**, and Chrome rounds timestamps (to about 0.1 ms) without
  `--enable-webgpu-developer-features`. On WebKit there are none to trust (weft's profiler marks it).
- **Real-time staging differs run to run**: the dancers move in real time, so a scene's live gates and overlap vary
  (the 1080 redwoods scene had no live gate in these runs where the critic's stepped run had two).
- **The CPU phases are timed by replacing `frame.update`** with the same loop plus a clock (it reads FrameBuilder's
  private tick list; if that list is renamed, the phases read 0 and the whole-frame number still works).
- **`maxPixelRatio` 1.5 on a laptop** softens a Retina canvas a little before the autoscaler moves. That is the
  intent, but it is a visible change on Macs from this branch on.
- **Sound** is off in a normal browser's run (no click), so the score's CPU cost isn't in the Mac numbers.
- The class is fixed at boot (kinds size their buffers once). The autoscaler's `starved` hook could step a class down
  at run time; not done.

## Edits outside my files

- `src/main.ts`, the wiring only: `coarse` comes from `chooseClass` (after the kit, before anything that reads it)
  instead of `matchMedia('(pointer: coarse)')`; `?perf` without `perfgroup` hands off to `perfStart` before the app
  boots; `applyPerf` takes the class; `bend.device`; `?perfgroup` starts `perfRun`.
- None in matter, worlds, post, play or ai. `limits.ts` is unchanged (no budget needed a new cap).
- `npm run build` runs `npm run weft` first (its prebuild), which moved weft from 0.2.8 to 0.2.9 in `node_modules`
  and regenerated the `.d.wgsl.ts` files across the tree (weft's Frame uniform gained `jitterNdc`). The build being
  served uses weft 0.2.9. I did not commit `package-lock.json` or those generated files: they belong to whoever moves
  weft next.

## The service

- Running: port **5441** on 127.0.0.1, mapped tailnet-only to `https://portal-windows.tail4a295a.ts.net:5441`, serving
  this worktree's `dist/`. Log: `%TEMP%\perf-remote-5441.log`; state: `%TEMP%\perf-remote-energybending.json`.
- Status: `node scripts/perf-remote.mjs --status`.
- Stop: `node scripts/perf-remote.mjs --stop` (stops the server and runs `tailscale serve --https=5441 off`, removing
  only this mapping). By hand: stop the pid in the state file, then `tailscale serve --https=5441 off`.
- Rebuild after a change: `--stop`, then `node scripts/perf-remote.mjs` (it builds).

Branch: `worktree-agent-a2387ddc93f125b34`.
