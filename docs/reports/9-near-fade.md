# Wave 7: the near fade and the depth of field through the gates

Item 8 of 8-integration.md's "What is left". Solid world geometry between the camera and the dancers (a stub, a
trunk, a blade, a slab) now dissolves instead of filling the frame, and the depth of field focuses what is seen
through a live gate as far as it really is. Each is one mechanism, shared by every world and every gate.

**Measured:** `npm run typecheck`; `npm test` (limits, the binding budget, 8 TS test files, audio, 10,034 gate checks,
the net tests; see the end for the net run); `?baseline` on every world (`9-baseline-all.jpg`: the geode, the Pool,
the temple, the redwoods, the forge, with fire and water; no failed pipeline, no validation error, no error in
`bend.stats()`); staged A/B stills in all four worlds with solids, each pair one stepped frame apart (left: the fade
off, right: on); 30 s locked jogo takes in the temple, the redwoods, the geode and the forge, each frame grabbed with
the fade off and on (`ab` in `scripts/critic-cap.mjs`); the gates' window A/B; GPU timings at 1920x1080 against a build
of the commit before mine served beside it (Report 8's method: weft's profiler over 150 stepped frames, one take at a
time under the render lock). Everything on the RTX 5090 through headless Chrome, against production builds served by
`vite preview` on 5463 (mine) and 5464 (the base). I looked at every still named here. **Not measured:** a laptop or a
phone, a person playing, the films (no film was re-rendered with the fade).

## 1. The near fade

### How

- `src/worlds/fade.ts` (`NearFade`, created in main.ts and updated in the `post` phase, after the camera, so a film's
  camera counts too). Each frame it reads the eye (`kit.camera.position`), the main view's world's solids
  (`portals/solids.ts solidsOf(world)`, the same `World.solids` the rig uses) and the framed dancers as the main view
  sees them (`gates.seen(main.world, framed, 2)`). On the CPU it asks two cheap questions: is a solid within
  `near + 0.15` of the eye (`Solids.inside`), and does a solid cross a sight line (radius 0.2) from the eye to either
  dancer's hips, chest, head, knees or hands (`Solids.sweep`). Each answer eases a strength (in 0.15 s, out 0.5 s).
  It writes per dancer an upright capsule (its lowest joint to its highest, round its hips, radius from its reach,
  at least 0.45 m) with that strength, and the near distance, its strength and the floor's height under the eye.
- **No binding.** The numbers ride in the worlds' light uniform as a new member, `sight: Sight` (`WorldLight` grows
  3,824 to 3,904 of 65,536 bytes), which every lit world draw already binds. The uniform is one value per `kit.run`
  and a gate's view reads it too, so the main view marks itself with weft's per-view `Frame.user.x = 1` (group 0, in
  every pipeline; nothing in the project used `user` before). Gate views and the inset keep 0 and fade nothing.
- `worlds/light.wgsl`: `sightFade(p)` and `sightDrop(p, px)`. A uniform branch first (`user.x`, and `k.w`, 0 while
  nothing is near or blocked), so in most frames a solid fragment pays one branch. Otherwise a fragment fades if it is
  within `near` of the eye (above the floor under the eye), or if the ray from the eye through it passes within a
  dancer's radius of that dancer's axis and it stands more than half a radius + 0.15 m in front of the dancer's axis
  (whole from 0.4 m further on), and not below that dancer's feet + 12 cm (the floor it stands on: a ledge, a slab, a log's
  top). `sightDrop` dithers the result against weft's interleaved gradient noise (`weft/lodfade`'s `ign`), so the
  depth contract holds: what is drawn is opaque and writes its distance, what is dropped shows what stands behind it.
- **Every world's solid draws call it**, first in the fragment shader: the temple's stones, the redwoods' trunks and
  stage logs and lanterns, the geode's shelves (blades) and crystals, the forge's slabs (its basalt columns). Seven
  lines across six shaders.
- Params `fade` (`on`, `near` 0.6, `between`, `radius`, `easeIn`, `easeOut`); `bend.fade.seen` says what the CPU found.
- `rig.sight` stays published (the stage agent's lock still fills `blocking`); the fade does its own test because a
  film's camera is not the rig's pose. I did not touch camera.ts.

### Seen (`9-nf-*.jpg`: left the fade off, right on, one stepped frame apart)

Staged takes (`scripts/steps/nf-stage.json`, made by `scripts/steps/nf-gen.mjs`): the pair placed beyond a solid, the
eye fixed 1.6 m (or 0.3 m: `-near`) on this side of it.

| still | what it shows |
|---|---|
| `9-nf-temple-stub-0p5.jpg` | a column stub covering the pair is cut away where it covers them; its foot below their feet stays (it reads as a broken column); the column beside them, not in front, is untouched |
| `9-nf-temple-near-0p5.jpg` | the eye 0.3 m from the stub: the stub that filled the frame is gone but for a dithered veil at its edges (the band between 0.3 and 0.6 m) |
| `9-nf-redwoods-trunk-0p5.jpg` | a redwood trunk (1.6 m radius) filling the frame: a soft-edged keyhole opens on the pair, fire and water in the grass |
| `9-nf-geode-blade-0p5.jpg`, `9-nf-geode-near-0p5.jpg` | crystal blades across the pair dissolve; at 0.3 m the blade that filled the frame dissolves and the gates behind show |
| `9-nf-forge-slab-0p5.jpg`, `9-nf-forge-near-0p5.jpg` | a raised basalt mass across the pair: two body-shaped openings; at 0.3 m the face that filled the frame thins to a dithered veil with the openings through it. (The first take of `-near` faded nothing near the eye: beside a raised slab and below its top, the forge's `groundAt` gave the slab's top as "the floor under the eye". Fixed: that floor is at most 25 cm under the eye, which the rig keeps; this still is the fix) |
| `9-nf-forge-lock-11.jpg` | **in play**: the forge's locked jogo at 11 s, the lock's corner of the stage slab in the foreground over the pair; with the fade the slab's upper corner opens and the fire, the water and the roda show. The forge's whole take: `9-nf-forge-lock-sheet.jpg` (on) against `9-nf-forge-lock-a-sheet.jpg` (off) |
| `9-nf-temple-lock-sheet.jpg` / `-a-sheet.jpg` | the temple's locked jogo (the critic's take), 30 s; see the weak points |

In the redwoods' and the geode's locked jogo (30 s each, the same `ab` takes, not kept as stills) the CPU flagged a
block in a few frames (a hand's sight line grazing the stage log) and **nothing visible changed**: the shader's own
test found nothing standing in front. That is the point of the two tests: the CPU only wakes the shader.

### Weak points

- **The temple's lock, the case Report 8 named, is barely changed.** In the critic's temple take (`9-nf-temple-lock-sheet.jpg`
  against `-a-sheet.jpg`, the last build) the stubs stand large in the foreground *beside* the pair far more often than
  across them, and where one does cross a dancer it stands within half a metre of it (the fire dancer half behind a
  stub at 17.5 s), which the fade leaves alone so a dancer can stand at a column. The CPU found a block in 21 of 60
  frames; I could not find a frame where the picture visibly changed. Fading whatever is large in the foreground
  regardless of the dancers is a different rule (a screen-space "too big, too near" test) and would eat the temple's
  composition; the stage agent owns the temple's layout and the lock's dodge, which is the better fix there.
- The cut is a hole shaped like the dancer's capsule seen through the solid (two pills for two dancers apart), not a
  fade of the whole object. With the dither and MSAA its edge is soft but visible; the DoF blurs it more when near.
- The dither is a static per-pixel pattern (no TAA here), so a half-faded band reads as a fine screen-door veil.
- Fire and gate rings show *over* a near solid in several "off" frames (`9-nf-temple-near`, `9-nf-geode-near`,
  `9-nf-redwoods-trunk` left halves): the lens blurring a very near surface lets the bright glow behind bleed through.
  Pre-existing, not touched; the fade happens to remove the case.
- Only what `World.solids` describes wakes the fade: a solid without a solid entry (ferns, flowers, small crystals)
  never fades, and those draws don't call `sightDrop` (grass and ferns would cost every blade a branch).

## 2. `PostChain.focusFrom` for the gates

### How

- The disc writes its own plane's distance into the main scene's alpha (the depth contract: this world's air lies over
  the disc as over a window). So the lens saw everything through a gate as being at the gate.
- **One pass for every gate, not one per gate**: `portals/focus.wgsl` (`fs_focus`, which includes surface.wgsl and
  reuses its `vs_disc` rectangles and `farDist`), declared by `Surfaces.declareFocus` and added by `Portals` to the
  `scene` stage after the main scene: one draw, an instance per gate, into a full-resolution r16float cleared to 0.
  Where the open disc of a live gate is what the eye sees (the scene's alpha there is the disc's distance: nothing
  opaque in front), it writes the far view's whole path from the eye (the slot's air alpha: the gate camera is this
  one carried through, so it is already eye → disc → what it shows), or a flame's nearer focus there (the slot view's
  own fire focus texture). Elsewhere 0.
- `PostChain.focusFrom(view, source)` now means **a window**: `air.wgsl` takes a window slot's distance in place of the
  opaque distance for the focus target only (a flame or a body in front still wins; the fog and the glow's fogging
  don't change). `AirView.windows` marks the slot like `bodies`; the light and body votes leave it out. It takes one of
  the three focus slots while a live gate is on screen (fire, water, the window: three).
- **The lens frames a dancer seen only through a disc**: `Portals` wraps `PostChain.framed`: a dancer in the far world
  is carried back through the gate (`partner.through`) and counted where the line from the eye passes the open disc.
- `gates.focus` (on by default) turns the window off (the framing through a disc stays); on a device whose budget has
  no depth of field the window isn't declared.

### Seen

`9-nf-gate-dof-0p5.jpg`: the hub, the player before the gate to the redwoods, the partner in the redwoods 3 m beyond
the disc. Left the window off, right on: with it the lens frames both (the player at ~3 m, the partner at ~8.5 m
through the disc), so the focus moves out and the hub's far wall sharpens; the redwood trunk through the disc (~15 m)
is now as soft as a background that far should be instead of as sharp as the disc. The difference is real but
subtle at this blur (postParams.blur 5 px).

`9-nf-gate-window-0p5.jpg` (and `9-nf-gate-window-crop.jpg`, the disc at full size) isolates the window: the player
stands behind the eye, so the lens frames only the partner through the disc (~8.5 m) in both halves. Left, the window
off: the partner's pixels read as the disc's distance (5.5 m) while the focus is at 8.5 m, so the partner is soft
(about 3 px of blur at this setting). Right, on: the partner and the grass round its feet are sharp, the trunk
behind is soft. Subtle at the default blur, but it is the right way round now.

### Cost

The `gates.focus` pass: **0.003 ms** (one live gate on screen, the temple and redwoods stagings) and **0.006 ms** (the
hub gate scene with several gates, two live) at 1920x1080. Far under the 0.1 ms per live gate the brief set, so it is
not gated beyond the depth of field's own budget switch.

## Timings (RTX 5090, 1920x1080, weft's profiler over 150 stepped frames; `scripts/steps/nf-timings.json`)

The base is the commit before mine (`18edb91`), built and served beside mine; each scene shot once on each, one after
the other. The GPU is shared with five other agents this wave, so whole frames move by ±0.3 ms between runs (the
redwoods jogo by 1.3 ms the other way); the scene pass is the number to read.

| scene | frame: base → now | scene pass: base → now | notes |
|---|---|---|---|
| temple, fire and water, 4 m (critic) | 2.24 → 2.38 | 0.43 → 0.44 | nothing to fade: the branch only |
| redwoods at dusk, 4 m (critic) | 3.14 → 3.21 | 0.79 → 0.83 | the same |
| redwoods jogo, locked (critic) | 4.92 → 3.61 | 1.38 → 1.14 | noise (a played jogo; Report 8 had 3.44 / 1.00) |
| hub, 6 m (critic) | 1.82 → 1.89 | 0.31 → 0.32 | |
| Pool fusion (critic) | 1.82 → 1.91 | 0.03 → 0.03 | the Pool has no solids: nothing calls it |
| temple, a stub across the pair (staged) | 4.90 → 5.42 | 0.74 → 0.88 | the fade active: +0.14 ms (discards, and the court behind now drawn) |
| redwoods, a trunk across the pair (staged) | 4.50 → 5.17 | 1.04 → 1.25 | the fade active: +0.21 ms (the grass and flowers behind the hole drawn) |
| hub before a gate (staged) | 5.09 → 4.51 | 0.31 → 0.33 | `gates.focus` 0.006 ms |

So: with nothing in the way, +0.01 to 0.04 ms on the scene pass (within the noise); while a solid is being dissolved,
+0.14 to 0.21 ms, most of it the world behind the hole that is now drawn. Every critic scene stays under 3.5 ms but the
noisy jogo base run.

## The binding budget

The near fade adds **no binding**; the window adds one shader. `node scripts/check-bindings.mjs --table`: every row is
as AGENTS.md has it except one new row, and the world light's size:

```
| portals/focus.wgsl | v/f | 3 / 3 | 0 / 0 | 4 / 7 | 0 / 0 | 0 1 |
```

and "The world light uniform is 3,904 of 65,536 bytes" (was 3,824). The air's fragment stage is unchanged (9 of 16
sampled textures): the window uses one of its existing focus slots.

## Proposed AGENTS.md lines (I did not edit it)

- The contracts, the post line: "`PostChain.stage = { dim, at }` (…), `PostChain.focusFrom(view, f)` (a window: where
  `f()`'s r16float holds a distance, the lens focuses there in place of the opaque distance; the gates' live discs use
  it, portals/focus.wgsl)".
- After "The two-pass scene and the depth contract": "**The near fade.** A world's solid draws call
  `if (sightDrop(i.wp, i.pos.xy)) { discard; }` first (worlds/light.wgsl; worlds/fade.ts): a dither drops what is
  within 0.6 m of the eye or stands well in front of a framed dancer, in the main view only (`Frame.user.x` 1). No
  binding: it rides in `WorldLight.sight`. Params `fade`; `bend.fade.seen`."
- The map, `worlds/`: "…, light.wgsl (…; and the near fade, `sightDrop`), fade.ts (what the near fade fades), …";
  `portals/`: "…, the disc's surface, the depth of field's window (focus.wgsl), …".
- The binding table: the row above and 3,904 bytes.
- `scripts/critic-cap.mjs` takes `ab: { a, b }` (each frame grabbed twice, a stepped frame apart; stills side by side).

## What the integrator must know

- **Seams with this wave:** I edited six world shaders by one line each (temple/stones, redwoods/trunks (two entries)
  and lanterns, geode/shelves and crystals, forge/slabs), `main.ts` (four lines), `post/post.ts` and `post/air.wgsl`
  (the window), `portals/portals.ts`, `surface.ts`, `params.ts`, and `scripts/critic-cap.mjs` (`ab`). Nothing in
  `camera.ts`, `filmcam.ts`, films, fusion, water, the field. If the stage agent culls temple geometry the fade needs
  nothing: it reads `World.solids` each frame through `solidsOf`.
- `WorldLight` has a non-world member, `sight`, after `forge` (as `fire` is before the worlds). A new world appends its
  member after it; nothing else changes.
- `View.user` of the main view is taken (x = 1). Anyone else wanting per-view values should use y, z, w.
- Every `.d.wgsl.ts` that includes worlds/light.wgsl was regenerated by the build (the `Sight` type).

## Commits (branch `worktree-agent-add02466362778c12`, not pushed)

```
The near fade: a world's solid draws dissolve what is within 0.6 m of the eye or stands in front of a framed dancer …
The depth of field through the gates: one draw of every live disc after the main scene writes the far view's path …
Report 9: the near fade and the gates' depth of field; its stills, step files, and critic-cap's ab takes
```

`npm test`: limits, bindings, 8 TS files, 20 audio tests, 10,034 gate checks and the 12 net tests all pass (the net
tests run alone, while captures were going: passed first time). The stills were shot before the last change to the
"in front of the dancer" margin (from radius + 0.25 m to half a radius + 0.15 m), except the temple lock sheets; the
staged stills stand the solid 2 m or more in front of the pair, where both margins agree.
