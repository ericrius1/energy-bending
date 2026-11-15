# Phone fluidity and touch diagnostics — 15 November 2026

The phone profile was allocating desktop-sized particle pools and four-sample HDR targets, including three portal
views. It also paid for repeated atmospheric lighting calculations whose scattering terms were then subtracted
away. The change reduces that work, keeps the phone's image size, and introduces frame-based effect adaptation
aimed at a steady 30 FPS. It does not impose a frame-rate cap.

The reported three GPU errors could not be reproduced on this Mac. They are **not claimed fixed**. The production
error banner now opens by touch, with wrapping/scrolling messages, the browser and render size, Copy details and
Close errors. Opening it does not enable GPU profiling or send the tap into the game. This is weft 0.2.10,
engine commit `9b2d333`, dist commit `5751338`, pulled into this app's lockfile.

## What was measured

Baseline app: `9efd330`; both comparative builds used the same weft 0.2.10 rendering engine. Production Vite builds,
Chrome 157, Metal on an Apple M3 Max; 390×844 CSS pixels, touch,
DPR 3 capped by the application at 2, and phone render scale 0.85: **663×1435 render pixels in both builds**.
WebGPU baseline limits were requested. Fire and water played together in the geode, temple, pool and redwoods.
The same camera settings, placements, world order and dusk lighting were used before and after.

These are host measurements, **not iPhone FPS estimates**. A viewport, iPhone user agent, minimum-feature device
and CPU throttle cannot reproduce A18 GPU throughput, WebKit/Metal behavior, unified-memory pressure or heat.
The test phone was unavailable. The Mac also had unrelated applications running, so small differences are noise.

Two complementary measurements:

- `profile-phone.mjs`: real animation frames, 16 seconds settling per world, then 7 seconds of wall-frame and
  CPU submission measurements; draw/pass/upload counts, resource inventory and a sampled CPU profile. GPU
  timestamps, if requested with `GPU_TIMING=1`, are collected separately so the main measurement does not pay for profiling. A 6× CDP CPU throttle
  checks CPU headroom, not GPU speed.
- `throughput-phone.mjs`: manual fixed 1/60 steps, 15 seconds initial settling, 600 simulation steps per world,
  then batches of 30 submitted frames completed with `queue.onSubmittedWorkDone()`. Eight batches are reported;
  the upper middle sample is used consistently. This measures completed host throughput including CPU submission,
  queue overhead and GPU execution; it is neither pure GPU time nor displayed FPS. Still refresh is disabled for
  repeatable portal work; live portals remain. `ABLATE=1` removes selected work for diagnosis only.

Raw logs, images, CPU traces and the untouched baseline build are kept in ignored `shots/phone-profile/`.
The compact committed measurements are in `perf/phone-fluidity.json`.

### Completed-frame throughput

| World | Before, ms/frame | Default, ms/frame | Default reduction | Fallback tier 3, ms/frame | Fallback reduction |
|---|---:|---:|---:|---:|---:|
| Geode | 10.43 | 9.51 | 8.9% | 7.14 | 31.5% |
| Temple | 6.37 | 6.17 | 3.1% | 5.35 | 16.0% |
| Pool, live portals | 8.40 | 6.49 | 22.8% | 5.40 | 35.7% |
| Redwoods | 6.90 | 6.27 | 9.1% | 4.63 | 32.8% |

The temple's small default difference is within the range where shared-host noise matters. The portal and memory
reductions are the strongest default wins. The fallback measurements show the additional work the controller can
remove when needed; they do not mean every phone will choose that tier or achieve the reciprocal frame rate.

With 6× CPU throttling, the new default phone workload held 59.86–60.00 displayed FPS on the host GPU. Mean CPU
submission was 3.44 ms geode, 3.49 ms temple, 4.26 ms pool and 4.00 ms redwoods; p95 was 4.9–5.5 ms. P95 frame
intervals were 16.7–16.8 ms. The pool dropped from about 170 draws / 53 render passes to 116 / 38. There were no
browser or GPU errors. This supports CPU headroom; it does not measure the iPhone's GPU or thermal limit.

## Findings and changes

**Resource allocation:** the baseline held 397,726,400 bytes of tracked GPU resources: 281,087,952 in textures
and 116,638,448 in buffers. The phone profile now holds 165,010,590: 130,742,398 in textures and 34,268,192 in
buffers, a **58.5% reduction**. These are weft's allocation estimates, not an OS measurement of total GPU memory;
driver caches and browser allocations are additional.

`engine/views.ts` now uses one sample on phone/laptop and keeps four on desktop. Single-sample HDR/glow targets
are used directly, without duplicate MSAA attachments or invalid resolve targets. This saves bandwidth and
memory; the tradeoff is less antialiasing on opaque geometry. Water and fire retain their existing surface fields.

`engine/perf.ts` sets allocation capacities before constructing the kinds:

| Pool | Desktop | Laptop | Phone |
|---|---:|---:|---:|
| Gem particles, excluding fixtures | 300,000 | 80,000 | 40,000 |
| Flame particles | 262,144 | 196,608 | 131,072 |
| Water/ice particles | 400,000 | 240,000 | 128,000 |
| Sparks | 65,536 | 16,384 | 8,192 |
| Portal view slots | 3 | 2 | 1 |

Normal two-player phone counts remain 14,336 flames and 24,000 water particles at full quality. Capacity is a
ceiling shared by all dancers, not the active count. Gem fixture offsets and cull lists follow the actual capacity;
spark shaders use `arrayLength` rather than indexing a desktop-sized ring.

`portals/portals.ts` now applies scale **before** allocating targets and restricts allocated phone views to one.
Previously `live=1` still permitted a second view through another portal. This was particularly expensive in the
pool. Phone pipeline records fell from 669 to 361. Other gates keep their still/ambient appearance; crossing, simulation and networking are unchanged.

**Shader work:** the initial redwoods ablation was about 6.89 ms/frame; removing water gave 4.73 ms, removing the
air pass 4.75 ms. Removing bloom, sparks, curl or foliage did not produce a useful improvement in that workload.
Those are isolated diagnostics, not additive cost estimates, and removing air also bypasses its composite work.
Bloom and the flame curl are retained.

`worlds/light.wgsl` now expresses `Air(colour, distance) - Air(0, distance)` as transmission. Geode, pool and temple
transmission is analytic; the forest integrates only mist density, without leaf/trunk shadow tests and lantern
lighting. The original air functions share the same transmission definitions where applicable. Both the main
glow composite and water's fog estimate use this path. The intended image is mathematically the same, apart from
floating-point cancellation differences. Fusion illumination is included through `answerAir`.

`matter/water/smooth.wgsl` trims samples beyond four Gaussian standard deviations. Empty pixels use 17 rather
than 33 taps; wide kernels retain all 33 and their spacing. The individual omitted weights are below 0.034% of
the centre weight. This is a small approximation near very thin edges, not a reduction in surface resolution.

**CPU and timings:** the original desktop run held 60 displayed FPS in all four worlds, with roughly 0.95–1.13 ms
mean CPU submission time. The sampled CPU trace was predominantly idle. GPU timestamps nevertheless claimed
350–1,114 ms frames while the page displayed 60 FPS, even with the profiler's trust flag set. Those readings are
invalid and were rejected. Apple computers now use frame-based resolution adaptation instead of those timings;
phones use the effect controller below. The phone error panel stays independent of the profiler.

WebKit startup uses weft's `SerialCompiler` while pipelines are declared and awaited, avoiding a simultaneous
burst of hundreds of shader compilation requests. The normal compiler is restored after readiness. The iPhone
user-agent test covers selection of that path in Chrome, not the behavior of Apple's WebKit compiler.

## Adaptation without blurring the phone image

`engine/quality.ts` observes wall-clock frame intervals, before simulation dt is clamped. There is a 12-second
warmup; decisions use two-second windows. Four seconds of mean frames above 34.5 ms or p90 above 42 ms lower
one tier, with four seconds to settle. Recovery needs 20 seconds below 24 ms mean / 28 ms p90, one tier at a time.
Background intervals and long pauses clear the evidence. Stable 30 FPS does not repeatedly upgrade/downgrade.

| Tier | Forest air steps | Geode shaft steps | Pool/temple reflection steps | Particle density |
|---|---:|---:|---:|---:|
| 0 | 10 | 16 | 12 | 100% |
| 1 | 8 | 12 | 10 | 100% |
| 2 | 6 | 10 | 8 | 85% |
| 3 | 4 | 6 | 6 | 65% |

The final fallback has 9,472 flame and 15,600 water particles in the measured two-player scene. Fine mist becomes
grainier and particles less dense; the worlds, dancers, lighting, bloom, physical rules and input remain present.
The controller is bounded, so it cannot guarantee 30 FPS on every GPU. It does not reduce the render scale or
water surface resolution. Film/manual captures bypass adaptation. `?quality=0..3` fixes a tier for comparisons.

## Verification and reproducibility

Use Node ≥22.18 (the Mac's default `node` was older; the checks used `/opt/homebrew/opt/node@22/bin` where needed).

```sh
npm run build
npm run typecheck
npm test
node scripts/check-phone.mjs http://127.0.0.1:5492/energybending/ shots/phone-profile/check
node scripts/check-phone-flow.mjs http://127.0.0.1:5492/energybending/ shots/phone-profile/flow
node scripts/throughput-phone.mjs http://127.0.0.1:5492/energybending/ shots/phone-profile/default
node scripts/throughput-phone.mjs http://127.0.0.1:5492/energybending/ shots/phone-profile/fallback 3
node scripts/profile-phone.mjs http://127.0.0.1:5492/energybending/ shots/phone-profile/cpu6 6
```

All browser scripts launch muted. Binding audit: 192 shader entry points, at most 9 of the baseline's 12 uniform
buffers. The source tests passed all 30 files, including pacing at 3/10/20/30/60/120/144 FPS, pauses, warmup,
recovery, and bounds. Audio passed all 37 tests; limits and portal checks passed. The network suite had two
timing-sensitive failures on the shared host: real-time smoothness RMS (0.0235 vs <0.02) and zero-lag duel prediction
(34.7 mm). Both failing cases passed isolated reruns (smoothness 0.0028 RMS; duel 10.7 mm), without changing network
code or test assertions. The other network/duel checks completed; the original full-suite run was not all green.

The compatibility matrix passed 48 world/material cases: baseline limits with optional WebGPU features removed, full/fallback phone
profiles, laptop and desktop; each visits all four worlds with fire/water, plasma/ice and gems/mosaic, then rotates
and resizes to 320 CSS pixels. The diagnostics test inserts **explicitly synthetic** errors to check opening,
copying and closing by touch, message wrapping and input isolation. Separate front/game and frame-pressure tests
check the normal entry path and real controller wiring. With a deliberate 43 ms CPU delay at each frame boundary,
the controller reached tier 3 (43.76 ms mean / 43.90 ms p90) and 15,600 water particles. After removing that delay,
it recovered to tier 2 (16.67 ms mean / 17.50 ms p90) and 20,400 water particles. Both states remained 663×1435,
render scale 0.85, with no GPU errors. The front strip's first touch after resting wakes it; a second starts play.
The final release build also passed a fresh touch entry check and an eight-dancer capacity check: 128,000 water
particles, 131,072 flames, then gems, with no pipeline/GPU errors. Apple laptop/desktop checks confirmed
`autoRes.byPace=true`, 1×/4× scene samples respectively, and scale 1 after settling. These additional results are
retained in `shots/phone-profile/release-check.json` and `release-front/results.json`.

Screenshots are reviewed for intact dancers, water silhouettes, lighting, portal appearance and obvious rendering
failures. The fallback's coarser mist is an accepted quality tradeoff. Exact screenshot differences also include
live simulation and stochastic lighting, so image differences are not a pixel-exact equivalence test.

## Follow-up on the actual phone

Confirm Chrome on the iPhone 16, after at least 15 seconds of warming, through several minutes of play and portal
crossings, in portrait and landscape. Check whether adaptation holds at least 30 FPS as the phone warms. If errors
recur, tap the banner and screenshot or copy its messages; those labels should identify the actual failure. This
work does not establish which three errors the original phone produced.

If more work is needed, first measure the geode shaft/caustics and the full-screen water composite on that device.
Possible next steps are a cached caustic field, fewer empty-pixel water lookups with conservative bounds, or a
depth-aware reduced-cost scattering pass. They need device evidence and visual review; lowering the phone's
canvas resolution is not the next step.

Reference ledger: `webgpu` SKILL.md read; `threejs-debug-profiler` SKILL.md read, applied to raw WebGPU without
adding Three.js; its `references/debug-profile-checklists.md`, `checklists/scene-debugging.md`,
`checklists/performance-profile.md`, and `checklists/mobile-input.md` all read. Checklist areas used: CPU/GPU
separation, ablation, allocation/bandwidth, shader features/limits, resizing, touch input, production-build checks,
visual review and evidence retention. Prompt-template reference not applicable. WebGPU feature/limit behavior
was checked against the [WebGPU specification](https://www.w3.org/TR/webgpu/).
