# Wave 7: the field's heat by source, and the violet bars near plasma

Branch `worktree-agent-abc656dbf3ee0d848`. Two of 8-integration.md's open items: 9 (the field's heat by source, the
fusion agent's plan in 7-fusion.md) and 6 (horizontal violet bars across the ice dancer in film 1, row 2). Everything
was rendered on the RTX 5090 through headless Chrome, muted, every capture under the shared render lock, one take per
hold (`scripts/critic-cap.mjs --only <take>`), against two servers without hot reload (`scripts/film-serve.mjs`): this
branch on 5465, and `HEAD` before my commits (a `git archive` of `18edb91`, its own Vite cache) on 5466, so "before"
and "after" are the same take on two builds. Take files: `scripts/steps/field9.json` (the blink, the fusion) and
`scripts/steps/field9-heat.json` (the field's stills, the 1080p timings). I looked at every still and sheet named here.

**Not looked at:** a laptop or a phone, `?baseline` beyond the boot check below, the films at master quality (the films
agent's), anything by ear, a person playing, a gate's view of a reaction (the field is one world's), a network game.

## 1. The field's heat by source

### What was wrong

Water read `fieldHeat(p)`, one sum of every body's heat and cold. A body that wears fire and water (`all`, a fusion's
feet) or ice and water (`tide`), or water at a power form between 0 and 1, sat in its own heat or cold, so water's
thresholds had been raised to stop a body reacting to itself: melt 0.3 and boil 0.6 (both only "touching" or "inside a
flame"), and the freeze threshold multiplied by `1 + 4 × form + 12 × (how much of the dancer is ice)`.

### What I built (the plan in 7-fusion.md, with one change)

- **A third group-3 texture, `fieldC`** (rgba16float, the field's grid; `@group(3) @binding(7)`), stepped beside A and B
  in `field/step.wgsl` (a third storage texture there, `nextC`, and one more copy in `field.copy`). The plan had one
  owner per cell (x hot, y cold, z the slot); I split it: **the dancer laying the most heat owns the cell's hot, the one
  laying the most cold owns its cold**, so a flame touching an ice body leaves each body its own (with one owner per
  cell, the first run of my probes showed an ice body touching fire reading its own cold as someone else's: its
  "others' heat" was −0.02 to −0.17 where the flame was 0.3 m away). C is x: the owner's share of the cell's hot, y: of
  its cold, z: the hot owner's slot × x, w: the cold owner's slot × y. Premultiplied, so a trilinear sample between a
  heated cell and a calm one keeps the heated cell's owner, and between two dancers' cells gives each its share.
- **Carried with the air**: C is advected, diffused and faded exactly as B is (same back trace, same neighbours, same
  rates), and never holds more than B (clamped after the exchange, the deposits and the helix). Each frame the owner
  lays its share as the total takes it (`claim` in step.wgsl); another dancer takes a cell over once it lays more than
  the owner's carried share, and claims the cell's heat up to what it lays (so its own matter never sees its own heat
  ramping up as someone else's). The CPU's deposits (ice's frost, the jogo's) and a fusion's helix are nobody's own.
- **A fused body's heat is nobody's own** (`FieldSim.unowned`, set in `field.ts` when a dancer wears a layer with
  `params.fusion`): the fusion agent's design rests the water and ice on the feet under the fused flame "to boil thin",
  and that flame is the dancer's own; without this the water on the feet would stop boiling.
- **`fieldHeatFrom(p, d)`** in `field.wgsl`: `fieldHeat` less dancer d's own share of the hot and of the cold.
- **Water's sim** (`water/sim.wgsl`, the heat read only): `fieldHeatFrom(p.pos, dancerOf(home))` instead of
  `fieldHeat`, and the freeze test is plain `heat < −freezeCold` (the form and ice-share multipliers are gone: a body's
  own cold is left out now). `WaterSim.colds` and `coldOf` are no longer read by the sim (left in place: the water
  agent's struct).
- **Probes** take an optional dancer (`field.probe(id, p, d)`) and return `reading.others`: the heat as that dancer's
  matter feels it (the spare float of the probe's first vec4; no new binding).
- Fire, steam, the ripples, grass and the rest still read the totals; nothing else changed for them.

### Measured (probes, `?play&two` in the geode, both standing in ginga, 40 frames per point after 1.5 s settled)

Probes on dancer 0's body: the chest's surface facing dancer 1 (Spine1 + 0.16 m), 0.3 m further, its back, the thigh
facing dancer 1, 0.5 m over the chest. "Total" is what water read before; "others" is `fieldHeatFrom`. Gap is the
measured distance between the two hips.

Self (dancer 1 is gems 3 m away):

| dancer 0 | chest, total / others | back | thigh | above |
|---|---|---|---|---|
| `all` (fire arms, water legs, ice hands and feet) | 0.435 / 0.000 | 0.371 / 0.000 | 0.003 / 0.000 | 0.014 / 0.000 |
| `tide` (water, ice hands and feet) | −0.100 / 0.000 | −0.039 / 0.000 | −0.056 / 0.000 | −0.093 / 0.000 |
| water at form 0.5 | −0.374 / 0.000 | −0.395 / 0.000 | −0.369 / 0.000 | −0.120 / 0.000 |
| water at form 1 | −0.768 / 0.000 | −0.813 / 0.000 | −0.709 / 0.000 | −0.243 / 0.000 |

A body's own heat and cold read exactly zero for its own matter. Before, `all`'s chest read 0.44 (over the old melt
0.3: its own ice hands melted near its own arms) and `tide`'s −0.10 (under −0.05: only the ×12 multiplier kept its
water from freezing).

Against another dancer ("others" at dancer 0's chest surface / thigh; the totals are within a few percent of these for
water, which lays no heat of its own; for ice they differ by its own cold):

| dancer 1 → dancer 0 | gap 0.5 to 0.66 (touching) | 0.7 to 0.86 | 0.9 to 1.06 | 1.2 to 1.36 | 1.7 to 1.86 |
|---|---|---|---|---|---|
| fire → water (heat) | 0.15 / 0.28 (0.61 inside the flame) | 0.12 / 0.15 | 0.045 / 0.064 | 0.010 / 0.020 | 0.001 / 0.002 |
| plasma → water (heat) | 0.44 / 0.62 | 0.11 / 0.19 | 0.048 / 0.100 | 0.021 / 0.035 | 0.004 / 0.005 |
| ice → water (cold) | −0.50 / −0.59 | −0.16 / −0.18 | −0.051 / −0.068 | −0.019 / −0.023 | −0.002 / −0.003 |
| fire → ice (heat at the ice) | 0.36 / 0.51 | 0.14 / 0.14 | 0.042 / 0.056 | 0.011 / 0.016 | −0.005 / 0.001 |
| plasma → ice (heat at the ice) | 0.43 / 0.76 | 0.25 / 0.34 | 0.065 / 0.090 | 0.011 / 0.024 | −0.004 / 0.000 |

(The ice body's total at the same points was −0.24 to −0.83: before, its own cold hid the flame entirely.) Mixed
bodies beside fire at 0.7 to 0.85 m: `all`'s chest reads 0.48 total and 0.12 others; `tide`'s thigh 0.06 / 0.10.

### The thresholds, from those numbers (`water/params.ts`)

- **freeze: others' cold below −0.05** (unchanged in value, now honest): an ice body's surface within about 40 cm
  (−0.05 to −0.07 at 1.06 m hips to hips, −0.16 at 0.86 m); a body's own form or ice no longer counts, so the
  multipliers went.
- **melt: others' heat above 0.1** (was 0.3): a flame within about half a metre melts the ice facing it (0.14 at 0.83 m
  for fire, 0.25 at 0.71 m for plasma, 0.04 to 0.06 at 0.98 m, so not across the floor). 0.08 (the plan's) would start
  at about 0.95 m with plasma's radiant tail; 0.1 keeps it a near thing.
- **boil: others' heat above 0.3** (was 0.6): touching a flame or inside it (0.28 to 0.62 at contact, 0.61 inside a
  fire's body, never above 0.2 with the hips 0.8 m or more apart). It thins at `(heat − 0.3) × 4` a second, so a water
  arm inside a plasma body (1.2) is gone in about 0.3 s, one brushing a fire (0.35) in several seconds.

### Before and after (`9-field-ba-*.jpg`: HEAD left, this branch right, the same take)

Pairs (before left, after right, 5 s after waking, the bodies held in place, `?play&two` in the geode):

| file | what it shows |
|---|---|
| `9-field-ba-self-all.jpg` | **`all` alone** (fire arms, water legs, ice hands and feet; the far figure on the left): before, its water legs were frozen into faceted ice by its own ice feet's cold (the total read −0.06 to −0.1 at the legs); after, they are liquid water, the ice hands and feet stay ice and the fire arms burn. The camera is too far for detail: the legs' change of state is what reads |
| `9-field-ba-plasma-ice.jpg` | **ice beside plasma, hips 0.84 m apart**: before, the ice body is untouched, every facet set (its own cold hid the plasma's heat: total −0.2 to −0.7); after, the side facing the plasma melts to clear water with drips and loose shards, the far side stays faceted |
| `9-field-ba-fire-water.jpg` | **water beside fire, 0.6 m apart**: after, the water on the fire's side thins (boils from 0.3 instead of 0.6); a small change at this distance |
| `9-field-ba-ice-water.jpg` | **water beside ice, 0.9 m apart** (the control): the same before and after, a white frozen rim on the side facing the ice; the freeze threshold kept its value |
| `9-field-ba-fu-steam-6.jpg`, `9-field-ba-fu-steam-8p5.jpg` | **the steam fusion** in the Pool (critic6's script, mid-fusion): the same; the water resting on the feet still boils thin under the fused flame (its heat is nobody's own), no water outline |

### Cost

Bindings: one more sampled texture in every stage that uses group 3; one more storage texture in the field's step.
Regenerated rows (`node scripts/check-bindings.mjs --table`), against the AGENTS.md table:

| shader | stages | uniform buffers (of 12) | storage buffers (of 8) | sampled textures (of 16) | storage textures (of 4) | groups |
|---|---|---|---|---|---|---|
| matter/field/debug.wgsl | v/f | 6 / 5 | 2 / 2 | 3 / 3 | 0 / 0 | 0 1 3 |
| matter/field/probe.wgsl | c | 6 | 3 | 3 | 0 | 0 1 3 |
| matter/field/step.wgsl | c | 6 | 2 | 3 | 3 | 0 1 3 |
| matter/fire/curl.wgsl | c | 6 | 4 | 3 | 0 | 0 1 3 |
| matter/fire/sim.wgsl | c | 7 | 5 | 3 | 0 | 0 1 3 |
| matter/gems/sim.wgsl | c | 8 | 7 | 3 | 0 | 0 1 3 |
| matter/ice/mist_sim.wgsl | c | 6 | 5 | 3 | 0 | 0 1 3 |
| matter/reactions/steam_draw.wgsl | v/f | 7 / 7 | 3 / 2 | 5 / 6 | 0 / 0 | 0 1 2 3 |
| matter/reactions/steam_sim.wgsl | c | 6 | 3 | 3 | 0 | 0 1 3 |
| matter/water/sim.wgsl | c | 6 | 5 | 3 | 0 | 0 1 3 |
| matter/water/surface.wgsl | v/f | 6 / 9 | 2 / 2 | 5 / 8 | 0 / 0 | 0 1 2 3 |
| worlds/redwoods/grass.wgsl | v/f | 6 / 6 | 2 / 2 | 5 / 5 | 0 / 0 | 0 2 3 |
| worlds/water/ripples.wgsl | c | 6 | 2 | 4 | 1 | 0 1 3 |

The tightest group-3 stage is the water surface's fragment stage, now 8 of 16 sampled textures; the field's step uses 3
of 4 storage textures (a fourth field texture would be its last). `npm test`'s binding check passes.

GPU time (RTX 5090, 1920×1080, weft's profiler over 150 stepped frames; the critic's 1080p pair scenes, before on HEAD
and after on this branch, each its own take):

| scene | field.step before → after | water.sim before → after | whole frame before → after |
|---|---|---|---|
| hub, fire and water, 6 m | 0.0275 → 0.0307 ms | 0.0158 → 0.0151 | 2.11 → 2.16 |
| temple, fire and water, 4 m | 0.0295 → 0.0322 | 0.0148 → 0.0153 | 2.46 → 2.98 |
| redwoods at dusk, fire and water, 4 m | 0.0292 → 0.0315 | 0.0157 → 0.0154 | 3.26 → 3.16 |

The change costs the field's step about 0.003 ms (a third texture sampled seven times a cell, one more stored, one
more 3D copy, unprofiled, of 48 × 32 × 48 × 8 bytes); water's sim is unchanged within noise. The whole frames move by
what is on screen: the temple's +0.5 ms is fire.splat (0.21 → 0.37) and the scene (0.46 → 0.53), the pair having
danced into a different pose in front of the camera (the play isn't bit-identical between builds), not the field;
the redwoods' went down by 0.1. Every scene stays under 3.5 ms.

## 2. The horizontal violet bars

**Whose:** the jogo's own glows, `src/play/feel.ts` (the perks): plasma's dodge is a blink (`c.env.blink`, the root
jumps 1.4 m), and its `blink` event drew **three straight capsules of light** (`G.seg`, radius 3 cm, intensity 1.6)
from where the body was to where it landed, at 0.4, 0.85 and 1.3 m over the floor, for 0.45 s. Straight, parallel,
evenly spaced, in plasma's violet: the bars. In film 1 the partner (fire, then plasma at bar 5) dodged the ice dancer's
attack by blinking past it, so the bars crossed the ice body. Not the arcs (jagged), not the fire splat (its motion
streak is capped at 10 cm).

**Reproduced** (`field9.json bars-blink`: the redwoods at 19.4 h, the water seat at form 1 (ice), the fire seat at
form 1 (plasma) 1.1 m away blinking across it): `9-field-before-bars-blink-sheet.jpg`, row 3, and full size
`9-field-bars-before-3p33.jpg`: three hard violet bars, the same as film 1's frame.

**Fixed at the cause:** the blink's trace is now plasma's own lightning, `ctx.arcs.add` (jagged, forked again every
frame, so it flickers), two strokes at chest and hip height, fading over 0.3 s and dropping strokes as it fades.

After, the same take on this branch: `9-field-bars-blink-sheet.jpg` (row 3: a thin jagged violet-white stroke along the
blink's path, then gone) and `9-field-ba-bars.jpg` (the same frame before and after: the three bars are gone, one
faint forked arc runs from the ice body toward where the plasma came from). The rest of the frame is unchanged: the
plasma body smeared across the gap is its own flames flying 1.4 m to the new place (that is matter, not a glow).
Film 1 was not re-rendered (the films agent's); its `ab-jogo` row 2 should show the arcs instead of the bars the next
time it renders.

## Verification

- `npm run typecheck`: passes.
- `npm test`: limits, the binding budget (137 entry points within the baseline), the 8 src test files, audio, the
  gates' checks and the net tests all pass, except the net's real-time smoothness test, which failed in the full run
  and once alone while other agents' captures loaded the machine (rms 0.036 against 0.02) and passed alone when it
  was quieter (12 passed, 0 failed), as in every earlier report.
- `?baseline` renders (`9-field-baseline-pair-0p5.jpg`: the redwoods, `all` beside ice, only WebGPU's default limits;
  no failed pipeline, no validation error).
- The shaders compiled on the real GPU in every take (critic-cap reports failed pipelines; none); the only console
  warnings were Chrome's powerPreference note and the jogo's "no script 'none'" (the take's own `script=none`).

## Edits outside my two items

- `src/matter/water/sim.wgsl`: the heat read only (the water agent's file: one line changed, the freeze test simplified,
  comments); `src/matter/water/params.ts`: the three thresholds and their comment.
- `src/play/feel.ts`: the blink's trace (four lines and a comment).
- `docs/extending/reactions.md`: the third texture, `fieldHeatFrom`, the budget line.
- `scripts/steps/field9.json`, `scripts/steps/field9-heat.json` (my takes); `docs/reports/media/9-field-*.jpg`.
- No edits to filmcam, films, fusion.ts, moves, the stages, worlds' shaders, post or portals.

## For AGENTS.md (proposed, not edited)

- In "weft footguns", the group-3 line: "group 3 the bodies and the field (shared, made by `Field`: joints, segs,
  bodies, touch, fieldA, fieldB, fieldBox, fieldC)".
- In "The contracts", the Field line: add "`fieldHeatFrom(p, d)` (the heat less dancer d's own: water reads it),
  `probe(id, p, d?)` (`reading.others`)".
- In "The binding budget", replace the thirteen rows above, and in the closing paragraph: "the water surface's fragment
  stage holds 8 of 16 sampled textures; the field's step 3 of 4 storage textures".
- In "The map", matter/field: "the wind/heat/wet grid and whose heat it is (3D textures in group 3)".

## Weak points

- Two dancers laying heat of the same sign in one 18 cm cell: only the larger is told apart, so a fire-and-water body
  touching a fire dancer sees the other's excess over its own, not all of it. Two flames touching is rare in play; a
  fusion's own flame is excluded from ownership on purpose.
- In the fire → water contact the "others" reading was up to 12 % under the total although water lays no heat (0.153
  against 0.171 at the chest); somewhere a cell's hot owner reads as slot 0. I did not find why; it does not change any
  threshold's crossing by more than a few centimetres.
- Steam is still made where any heat meets any wet, a body's own included (`step.wgsl contact`); it is born only at
  contacts between two dancers (steam_sim), so a mixed body alone makes none visible. Fire's guttering near cold still
  reads the total (a fire dancer wearing ice hands would gutter by its own cold); I left fire's look alone.
- The thresholds are from probes at five points on a standing body, not from counting particles that melted or boiled.
