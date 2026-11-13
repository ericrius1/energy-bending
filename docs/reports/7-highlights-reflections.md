# 7: Highlights, glows and reflections (task 3 of the second critique)

Branch `worktree-agent-a4e453b820a03e4a2`. Owned: `src/post/**`, `src/worlds/water/**`. Everything below was rendered
on the RTX 5090 through headless Chrome, one take per run under the shared render lock (dev server on 5453; a copy
of the tree as it stood before this work, `e3dabbc`, served on 5454 for the late "before" takes). Takes:
`scripts/steps/hl7.json` (written by `scripts/steps/hl7-gen.mjs`), plus the critic's `el-fw-temple-close`,
`film2-dolly` and `fusion-steam-pool` from `critic6.json` at 5 fps. Media: `docs/reports/media/7h-*` (after),
`7h-before-*` (before), `7h-critic-*` (the critic's takes re-shot after), `7h-cmp-*` (before and after side by side).
I looked at every still named here full size.

**Not checked:** a laptop or phone, `?baseline` in a browser (the binding count passes, below), the inset (`?pip`),
AgX (only ACES, the default), a film render, the forge's lock dim beyond its sheet, anything with a body texture or
refraction offset handed over (no kind does yet). The simulation isn't bit-identical between runs, so before and
after pairs show the same staging, not always the same instant.

## What changed, and why

### 1. Fire behind water is seen through the water (air.wgsl `glowSeen`, post.ts)

*Cause:* the air laid the whole glow target over the merged scene, whatever was in front of it; fire behind a water
dancer was simply added over it (`6-partner-temple-24`).

*Change:* each focus slot is now known to be a **body's** (water, ice: hides what is behind it) or a **light's**
(fire, plasma: light in the glow target), `post.ts BODY_KINDS`, passed to the air as a bit mask in a new per-view
uniform (`AirView`). Where a body is in front, the air asks how much of the light at that pixel lies behind it: a vote
of the light's focus distance at the pixel and on two rings round it (13 taps of the half-resolution focus texture, so
its blocks blend into a soft edge; a thin flame's edge takes the dense flame's distance beside it). Light behind is
dimmed to `postParams.through` (0.3) and tinted (`throughTint`, a pale cyan), or as the body texture says (below);
light in front of the body still glows over it. Where no flame round a pixel is dense enough to have a distance, it
counts as 70 % behind (a thin flame over a body is usually behind it). The merge now takes the bodies' distance only.

- `7h-cmp-fire-behind-water.jpg` (temple, fire behind water: before | after); sheets `7h-before-fw-temple-sheet.jpg`
  and `7h-fw-temple-sheet.jpg` (top row fire behind, bottom row fire in front), `7h-before-fw-pool-sheet.jpg` /
  `7h-fw-pool-sheet.jpg`. Before: a pink mush of flame through the whole water body. After: the water reads as a body;
  the fire behind shows as a dim warm glow through it and round its edge; fire in front (bottom rows) still glows over
  the water. `7h-dim-pool-sheet.jpg` frame 4 (the jogo) shows it in play.

### 2. No flat white discs (post.wgsl `toneMap`, the bloom's curve)

*Cause:* ACES maps each channel alone, so a colour whose channels all pass about 1 comes out flat white; the bloom
(threshold 2, no ceiling) then spread a core's whole energy round it as a disc.

*Change:* a **highlight shoulder** in the tone map: past a peak of 2 (whole at 6) the colour's peak is mapped and the
other channels scaled with it, which keeps the hue and the structure inside a hot core; only past a peak of 10 (all
white at 40) does a colour go white, so peak whites stay bright and small. Below a peak of 2 nothing changes, so the
worlds' looks and grades are as they were, and flame bodies keep their brightness. (A first try that started the
shoulder at 0.7 kept hues but made flame bodies a duller, see-through orange; moved up before the final stills.) It
never darkens a peak, only moves the other channels, so it does not double with fire's own ramp shoulder into grey.
The **bloom** now rolls what passes the threshold off toward `bloomCap` (3): a core ten times brighter gives a halo
only a little brighter, light in the air rather than a stamp; the knee is wider (`bloomKnee` 0.6 × threshold).

- `7h-cmp-dolly-3p6-fire.jpg` (film 2's lead shot at 3.6 s, critic | after): the white bar is a yellow-white core in
  an orange body with its contours; `7h-critic-film2-dolly-3p6.jpg` full size.
- Fire close and at game distance: `7h-before-core-fire-sheet.jpg` / `7h-core-fire-sheet.jpg` (the white mass on the
  torso is smaller, with structure; the very centre still goes white: that is fire's ramp, task 1's).
- Plasma: `7h-before-core-plasma-sheet.jpg` / `7h-core-plasma-sheet.jpg`: the hands are violet-white at both
  distances. The white disc in the before sheet's 4th frame is at the foot's contact with the ice (a steam front plus
  bloom); in the after take the foot does not reach the ice at that instant, so that pair is not a like-for-like test
  of the front.
- Gems' glints and the moon stay crisp: `7h-before-bloom-geode-gems-0p5.jpg` / `7h-bloom-geode-gems-0p5.jpg`,
  `7h-before-bloom-pool-moon-0p5.jpg` / `7h-bloom-pool-moon-0p5.jpg` (the moon's disc and halo unchanged; the fire in
  that frame has a halo instead of a white core).

### 3. Reflections in the Pool and the temple (water.wgsl `waterMarch`, `waterReflect`, `waterMirrorBend`)

*Cause of the columns:* each pixel marched its own rippled reflected ray, so neighbours under strong ripples landed
on different rows; a jittered march that stepped over thin bodies left misses next to hits.

*Change (same signature, so `poolScene` and `templeScene` needed no edit):* the march follows the **flat mirror's
ray**, which neighbouring pixels share, so the distance it finds is continuous; the **ripples then bend it** (what is
seen is what lies that far along the pixel's own rippled ray) and **spread it** (five filtered taps up and down the
reflected ray, as wide as the surface tilts there plus a little with distance: a calm surface mirrors sharp, a stirred
one smears into a soft vertical streak); taps that land in front of what was met or on the water drop out; Fresnel
stays the callers'. The march now finds a crossing even when one step jumps a thin body, and tests the crossing, not
the step. Close to the surface it accepts a thinner gap, so a column's foot meets its reflection with no seam: the
temple's glittering waterline row is gone. **Fire's mirror copy** (splatted below the floor by fire, a perfect mirror)
is bent in the air by the same wave normal and spread the same way (`waterMirrorBend`: the offset from where a still
mirror shows a point to where the rippled one does), when the glow at a water pixel lies past the surface.

- `7h-cmp-pool-reflection.jpg` (Pool, gems and water dancers under ripple: before | after): the gem dancer's
  torn columns become a soft streak; full: `7h-before-refl-pool-gems-water-2p2.jpg` / `7h-refl-pool-gems-water-2p2.jpg`,
  calm at `-0p8`, sheets `-sheet.jpg`; the temple: `7h-refl-temple-gems-water-*`, `7h-refl-temple-fire-water-*`.
- Fire's reflection now ripples with the columns': `7h-refl-temple-fire-water-2p2.jpg` against
  `7h-before-refl-temple-fire-water-2p2.jpg`; `7h-cmp-dolly-3p6-fire.jpg` (bottom: the fire's reflection soft and
  rippled under the rippling water); `7h-refl-pool-fire-water-*` in the Pool.
- The temple's waterline: `7h-cmp-waterline.jpg` (columns' feet at 8 m, film 2's opening framing, before over after;
  the tide stood at a different height in the two runs). Before: a row of glittering pixels along the left column's
  foot; after: a clean line. The bright band a little above the water on the columns is the stone's salt line.
- The fusion: `7h-cmp-fusion-reflection.jpg` (the critic's `6-fusion-steam-pool-f60` crop | after at 5 s): the
  rectangular pixel blocks are gone; what remains is soft vertical streaks plus speckle that mirrors the fused body's
  own noise (its blocky interior, drops and the steam fronts strewn on the water: task 1's). Full:
  `7h-critic-fusion-steam-pool-5.jpg`.
- The moon's road in the Pool is untouched (`7h-bloom-pool-moon-0p5.jpg`, `7h-dim-pool-sheet.jpg`).

### 4. Gate views' cost: skip the glow pass when nothing in the view glows (post.ts `glows`)

A live gate view's glow pass is an MSAA clear and resolve, about 0.11 ms even when empty. The air of a gate view now
runs that pass only when something can glow there, and otherwise reads a cleared 1×1 stand-in (the air takes a glow
alpha of 0 as "none"). The signal "anything here?", asked once a frame per view:
- **a dancer the view sees**: the view's `seen` uniform, which the portals already fill (a dancer in another world
  has the clip plane (0, 0, 0, -1)); every kind's glow draws are a dancer's matter;
- **or a glow draw that is no kind's** (a world's motes, the gates' halos and rings), told by the draw label's first
  word (a kind's draws start with its id), that is on and has instances.

Only gate views: the main view's glow target also takes fire's composite. Measured in the hub at 1080p:
`t-hub-gates-1p6` and `-4p7` each drop one empty gate view's glow pass (`glow.gate1` 0.109 ms → not run);
`-3p1` has dancers seen in both views, so both run.

**What the kinds should expose to go further:** `MatterPasses.glows?(view): boolean` ("anything of mine in this
view's glow pass?": sparks left behind by a dancer who has gone, say), and the same test on their own per-view passes.
The empty gate view in `t-hub-gates-1p6` still spends about 0.2 ms in **fire's splat (0.059) and water's splats and
smoothing (0.05 + 0.05 + 0.09)** with no dancer in it; those are fire's and water's passes (their folders), and
`view.seen` is the signal they can use today.

### 5. The stage dim for the locked view, and the gate disc's focus (post.ts, post.wgsl)

`PostChain.stage = { dim, at }`, set by the camera rig each frame (default 0: no change). `dim` 0 … 1 (the rig should
pass its lock weight × a taste, e.g. `rig.locked * 0.6`), `at` the stage's focus plane's distance from the eye (0: the
lens's focus distance, which in the lock is the stage plane). What lies beyond the plane (from 0.4 m past it, whole
some metres further) darkens by up to `stageDarken` (0.45) and softens by up to `stageSoften` (2.5 px of blur through
the lens's gather, which now runs for the dim even with the depth of field off); eased over 0.4 s.
`postParams.stageDim` adds to it, for testing. Not wired into the rig (`src/engine/camera.ts` is the cameras agent's).
Stills at 0 then 0.6 in each world: `7h-dim-geode-sheet.jpg` (+ `-0p5`, `-1p5`), `7h-dim-redwoods-*`, `7h-dim-pool-*`,
`7h-dim-temple-*`, `7h-dim-forge-*`. The backdrop (crystals, trunks, the court's far columns) goes a little darker and
softer, the dancers and the roda on the stage are untouched. 0.6 reads as a quiet lean; I'd give the rig 0.5 to 0.6.

**A gate's disc and focus:** the disc already writes its own distance into the scene's alpha (it is drawn in the
opaque phase). For the far view's focus distance, `PostChain.focusFrom(view, () => Texture | null)` adds a focus
source to a view besides its kinds' (r16float, any size, ≥ 1e4 where nothing): the portals can hand the main view a
texture holding, where the disc is, the disc's distance plus the far view's (the far view's air alpha is its opaque
distance). It takes one of the three focus slots and counts as a light's. Not used yet (the portals are the cameras
agent's).

## Interfaces

**Refraction and see-through, for the water agent** (post.ts `BodySource`): a body kind's `MatterPasses` may add
`body(view): Texture | null`, an rgba16float texture of any size:
- r: the body's view distance (≥ 1e4: no body here; compare, never do arithmetic on it)
- g: how much of what lies behind it shows through (0 … 1)
- b, a: a screen offset in the view's uv to read what lies behind from (its refraction); (0, 0) for none

When one is handed over, the air uses it instead of `through`, `throughTint` and no offset (the tint is still
applied). The first body kind that returns one wins. Default: none, no offset.

**Body or light:** `BODY_KINDS` (post.ts) names the kinds whose focus texture is a body's: water and ice. Anything else
is a light.

**Anything here?:** above (4). `PostChain.glows(view)` is public.

## Timings (RTX 5090, 1920×1080, weft's profiler over 150 stepped frames; `shots/hl7b` before, `shots/hl7` after)

Post chain only. "Air" is the surface step, its copies, the merge, the air and the glow's trails; "lens" is the lens's
down, gather and composite, the bloom chain and the grade.

| scene | air before → after | lens + bloom + grade before → after | gate views' glow before → after |
|---|---|---|---|
| temple, fire and water, 4 m | 0.248 → 0.297 | 0.097 → 0.137 | — |
| Pool, fire and water, 4 m | 0.230 → 0.262 | 0.097 → 0.111 | — |
| redwoods, fire and water, 4 m | 0.866 → 0.873 | 0.102 → 0.110 | — |
| hub, fire and water, 6 m | 0.237 → 0.237 | 0.095 → 0.107 | — |
| hub facing two gates (1.6 rad) | 0.096 → 0.169 | 0.095 → 0.108 | 0.219 → 0.110 |
| hub facing two gates (4.7 rad) | 0.149 → 0.156 | 0.094 → 0.108 | 0.221 → 0.113 |
| hub, both gate views with dancers (3.1 rad) | 0.145 → 0.147 | 0.095 → 0.107 | 0.223 → 0.223 |

Lens plus air: at most **+0.09 ms** (the temple), within the +0.2 budget. The temple's air pays for the 13-tap vote
and the bent mirror copy (both only where there is glow), and the reflection's five filtered taps; the lens about
0.01 for the stage term in the gather and the shoulder in the grade. The hub at 1.6 rad's air row moved by 0.07 with
nothing of mine in it (a hub has no water; the scenes aren't bit-identical: a water surface pass appeared in that
frame), so read single rows to ±0.05. Whole frames (noisy for the same reason): temple 1.97 → 2.47, Pool 1.51 → 1.80,
redwoods 2.85 → 2.93, hub 1.79 → 1.79; the temple and Pool frames grew mostly outside the post chain (water's surface
and splats with a different pose), the post chain's own share is the table.

The whole post chain after, temple pair (ms): air 0.128, surface 0.112, merge 0.024, glow.trail 0.017, lens.down
0.006, lens.gather 0.028, lens 0.020, bloom 0.045 (ten passes), grade 0.023. Before: air 0.105, surface 0.100, merge
0.025, glow.trail 0.017, lens.down 0.006, lens.gather 0.022, lens 0.020, bloom 0.031, grade 0.018.

## The critique's "Done when", item by item

- **`6-partner-temple-24` re-shot shows no fire over the water body:** re-shot as `partner-temple-24` (the jogo at
  23 to 25 s, `7h-partner-temple-24-sheet.jpg`; the play doesn't replay the critic's instant). In its middle frame the
  water dancer stands in front of the fire dancer's arm: the water body is clean, the arm dims behind it (the before
  run, `7h-before-partner-temple-24-sheet.jpg`, had no overlap in those frames). Also on purpose-staged takes:
  `7h-cmp-fire-behind-water.jpg`, `7h-fw-temple-sheet.jpg`, `7h-fw-pool-sheet.jpg`, and in play in
  `7h-dim-pool-sheet.jpg`. **Met** (on these frames; the critic's exact frame not reproduced).
- **`6-fusion-steam-pool` at 5 s and `6-el-fw-temple-close` last frames show reflections without pixel columns:**
  `7h-critic-fusion-steam-pool-5.jpg`, `7h-cmp-fusion-reflection.jpg`, `7h-critic-el-fw-temple-close-sheet.jpg`. The
  block columns are gone; the fusion's reflection is still busy (streaks and speckle that mirror the fused body's own
  noise and the fronts strewn on the water). **Met for the columns; the fusion's reflection will look as good as the
  fusion does.**
- **`6-film2-dolly-3p6` shows the fire's reflection rippling with the columns':** `7h-critic-film2-dolly-3p6.jpg`,
  `7h-cmp-dolly-3p6-fire.jpg`. **Met.**
- **Lens and air ≤ +0.2 ms at 1080p:** +0.09 at most (table). **Met.**
- Also asked: the temple's waterline glitter row removed (`7h-cmp-waterline.jpg`): **met**; no flat white discs: the
  frame's part **met** (cores keep hue and structure, the moon and glints crisp); the very centre of a fire core still
  goes white where fire's own ramp sends all three channels far past 1 (task 1's shoulder in the ramp).

## Weak points

- The "behind a body" test needs a flame dense enough to have a focus distance somewhere within about 12 pixels; a
  thin flame over a body with none near is taken as 70 % behind, so a thin flame edge in front of a water body is a
  little dimmed. Plasma's threads are thin: plasma in front of water may dim at its edges (not shot).
- Water's own glow (its drops) and gem sparks in front of a water body have no focus distance, so they also count as
  70 % behind it and dim (not seen to matter in the stills).
- The bent mirror copy decides "mirror copy or flame in front" by fire's focus distance; at the contact (a foot in the
  water) the two meet with a small dark gap under strong ripples (`7h-fw-temple-1p6.jpg`, at the feet).
- The reflection's vertical spread is a cheap model of rough water (one axis, five taps); far, very rough water is
  streaky. The march is still screen-space: what is off screen or hidden is not reflected (as before).
- Square light patches in the temple's column reflections (`7h-cmp-waterline.jpg`, both rows) are not mine: they are
  in the before too; not chased.
- The gate-glow signal trusts label prefixes for "a kind's draw"; a kind whose draw labels don't start with its id
  would be counted as a world's (it runs: safe, just not skipped).
- The shoulder's thresholds (2 / 6 / 10) were chosen by eye on four scenes; AgX not looked at.

## Edits outside my folders

- `src/engine/hooks.ts`: `bend.worlds` (one line and a comment), so a take can push the water
  (`bend.worlds.find((w) => w.id === 'pool').ripple(x, z, s, r)`).
- At run time (no file edit): `PostChain.declareAir` for a gate view wraps that view's glow pass's `enabled`
  (engine/views.ts makes the pass; post owns what reads it).
- `AGENTS.md`'s binding table is now stale for `post/air.wgsl`: fragment 4 uniforms (was 3) and 9 sampled textures
  (was 8); `npm test`'s check passes (`node scripts/check-bindings.mjs --table` to regenerate). AGENTS.md was not
  edited.
- New files: `scripts/steps/hl7-gen.mjs`, `scripts/steps/hl7.json`, this report, `docs/reports/media/7h-*`.

## Checks

`npm run typecheck` clean; `npm run build` clean (the usual chunk-size warning); `npm test` passed (limits, bindings
within the baseline, 6 TS test files, audio, gates, the net tests). Dev servers stopped, render lock released by each
run.
