# The frame's depth contract and the lens

Branch `worktree-agent-a739d9f54c616e46d` (commits on top of `57483b3`; not pushed or merged). This is task 3 of
`docs/reports/3-critique.md`.

What I measured: `npm run typecheck`, `npm test` (all of it; one net test failed once with `EADDRINUSE 127.0.0.1:5418`
while another worktree ran the same tests, and passed on the rerun), `vite build`, the binding check, and headless
stills and GPU timings on the RTX 5090 through `scripts/shot.mjs` (dev server on port 5423, every run under the shared
lock). The step files are `scripts/steps/depth-lens*.json`. "Before" stills come from this branch's base (`57483b3`)
on the same server, with the same steps. "Before" timings come from the same base, checked out for one run. What I did
not measure: a camera that crosses a gate with its player (task 4's bug: the camera stays behind in this build, see
"Focus"), a laptop or a phone, a film, `?baseline`.

## The contract, as implemented

A view's scene is now **two passes over one depth buffer** (`engine/views.ts`). The **scene pass** (backdrop and opaque
phases) writes the target `hdr`: rgb is the opaque scene, and **alpha is the opaque view distance** (along the camera's
forward, in metres). Only opaque draws write it. `engine/scene.ts` hands declarers a wrapped pass that turns off the
alpha write of any draw with a blend, whatever its blend says. The **glow pass** (`view.glow`, run right after the scene
pass through `follow()` in `engine/frame.ts`, so `main.ts` and `src/portals` add it without knowing it is there) takes
every glow-phase draw into a target of its own, `glow` (rgba16float, MSAA, resolved). It is depth-tested against the
opaque things. Its alpha clears to `NO_FOCUS` (1e4). Fire's current min-blend therefore lands there harmlessly, as a
legacy focus distance. Translucent kinds may implement
`focus?(view: ViewCtx): Texture | null;` on `MatterPasses` (`src/matter/core/kind.ts`). That is an r16float texture of
any size holding the view distance where the matter is dense enough to focus on, and 1e5 elsewhere. The post chain
binds at most **3** (`FOCUS_SLOTS`, found with `focusSources(view)` from `engine/scene.ts`); a 1×1 zero texture stands
in for an empty slot. Readers: the world's surface step (`worldScene`: the Pool's and the temple's water, the forge's
heat), the reflections and the fog (`worldAir`) read only the opaque distance. The glow is laid over the result,
fogged at the nearer of its own distance and the opaque one. The air pass writes the main view's **focus target**
(`post.focusTex`, r16float): the nearer of the opaque distance, the glow's legacy flame distance and the focus
textures. The depth of field reads only that. Steam (`post.sceneTex`, the air target's alpha) still tests against the
opaque distance.

For the main view and the inset, water bodies are composited between those steps (`src/post/air.wgsl` says this in
full). In the new `surface` stage, the world's scene step and air run on the opaque scene and are copied back over it,
so a water body refracts the finished world. `matter/water` then composites its bodies, as before. `fs_merge` rebuilds
the opaque scene with each body in it. A body is found where the scene now differs from the surfaced world, and it sits
at the nearer of its distance and the kinds' focus distance. Then the air runs over that, so the Pool still mirrors the
bodies. These steps run only in worlds with a scene step (light cases 2 to 4: the Pool, the temple, the forge).
Elsewhere they would only run the redwoods' fog march twice.

### What fire and water must do (they were told not to write alpha; this is the exact list)

- **Fire** (`matter/fire/fire.ts`, `draw.wgsl`): drop the `min` alpha on `fire.flames` and return a focus texture
  instead. The `fire.reflection` draw (MIRROR) returns alpha `1e5` under `blend: 'add'`. In the old single target that
  summed into the floor's distance as infinity in a half float. The air pass then treated every pixel of the
  reflection as broken and painted it black: **that was the geode's black smear, traced to the line**
  (`let dist = select(1e5, i.info.z, MIRROR == 0u && …)` in `fs`, with `'add'` = `{one, one}` on alpha too). It is
  harmless now (it lands in the glow target, and the air reads infinity there as "nothing"), but MIRROR should return
  0. Smoke (`fs_smoke`, premultiplied "over") now darkens only the glow under it, not the scene. In practice the black
  needles are gone, and the smoke darkening is gone with them, until fire's field composite brings smoke back as its
  own channel.
- **Fire in the Pool and the temple:** flames are no longer mirrored by the water. The old mirror was an accident: the
  flame's min-written distance made the reflection march "hit" it. If fire wants its reflection there, draw its
  MIRROR copy (or its field's flipped splat) in water worlds too.
- **Water** (`matter/water/surface.wgsl`, last line): `select(s.a, W.x, cover > 0.5)` writes the body's distance into
  the scene's alpha. It is harmless now (the merge reads it as "a body is here"). Still, return a focus texture (your
  smoothed `dist` texture, as r16float) and keep `s.a`. The merge also finds bodies by colour, so that keeps working.

## The fixes

**The Pool's horizon rectangle.** Cause: the flames min-blended their distance into the scene alpha, and the water
composite wrote its own. `poolScene` → `waterHit` then read those pixels as standing above the water, so it skipped the
surface and the haze, which left the black floor. A water body also refracted the scene from *before* the Pool's
surface, so it showed a black rectangle inside itself. Fix: the contract above, plus the surface step running on the
opaque scene before any body is composited. `src/worlds/water/` needed no change: `waterHit` was right, it was given
the wrong distance.
`docs/reports/media/4-horizon-fire.jpg`, `4-horizon-water.jpg` (before left, after right). A faint line of the
horizon's glow remains inside a water body, where the body refracts the world behind it.

**The geode's mirror smear.** Cause: above (fire's MIRROR alpha 1e5, added, became infinity, caught as a broken pixel
and painted black). Fix: the separate glow target. `4-mirror-smear.jpg`: the fire's reflection now shows in the agate.

**Focus on the dancers.** `PostChain.update` ignores the look point while anyone is framed. `framed(view, dancers)`
reads the view's own `seen` uniform (what `src/portals` fills each frame). It takes each dancer's hips and head where
this view sees them: in this world, carried through a gate, or not at all beyond a door. The focus is set to
`2nf/(n+f)` of the nearest and farthest on screen. If either would still blur more than `holdBoth` (1.2 px), the lens
closes. The focus eases (`focusEase` 0.2 s) and snaps on a cut, a world change (a crossing) or a camera jump of more
than 1.5 m. `postParams.focusOn: 'look'` restores the old behaviour for comparison.
`4-focus-cut-lock-stub.jpg`. Top row: a world switch with the dancers moved, under the old focus, then the new one
1 frame and 40 frames after. Bottom row: the locked redwoods, then `focusStub: 12`, a test texture in the third slot.
The dancers are sharp in every frame, but the old focus was also sharp here, because the rig's look point stayed near
the dancers. **The critic's blurred frame after a crossing (`3-film-12p6.jpg`) could not be re-shot**, because the
camera does not cross with its players in this build (`4-crossing.jpg`: the dancers walk through the Pool's gate into
the redwoods, and the camera stays). That frame came from the look point being in the far world's coordinates. The
new focus no longer reads the look point while a dancer is framed, and it snaps on the world change.

**The lens: 0.044 ms at 1080p** (`lens.down` 0.006 + `lens.gather` 0.022 + `lens` 0.016; before, one 40-tap pass at
full resolution took 0.078 to 0.084). It is a 2×2 downsample that keeps the nearest distance, a 28-tap golden-angle
gather at half resolution with the same "behind can't blur over a sharp front" rule, then a full-resolution composite
that keeps the sharp pixel where it is in focus. `lens` is still the composite pass that `declarePost` draws into
(steam).

**Motion: no ghost copies on opaque bodies.** The whole-frame trail pass is gone. Trails now run on the glow target
alone (`glow.trail`, before the air), so flames, sparks, streaks and plasma keep their long luminous trails, and they
are fogged and focused with the rest. The past is spread over a six-tap ring that turns each frame (`smear` 2.2 px),
so older copies melt into a streak. `4-ice-au.jpg`: three frames of the ice aú, before (two or three offset white
copies) and after (one body). `4-armada-kick.jpg`: a fire armada (horizon fixed) and a gems meia-lua (the leg is
crisp, the sparkles keep their trails). **Not done:** a per-pixel velocity blur for opaque matter. It needs a velocity
target written by the opaque draws (a second colour attachment on the scene pass, written by every opaque shader, or
the gems writing theirs). That is outside my folders; it is listed under weak points.

**Bloom.** The first downsample carries the source's hue outward (`bloomSat` 1.6), so a white-hot core blooms orange on
fire and violet on plasma, not white. Each wider level adds a little more (`bloomWide` 1.15). The two widest steps take
a warm tint (`bloomWarm` 0.25 → ×(1.06, 0.975, 0.89)). The threshold is unchanged (2), so the frame does not wash. With
today's fire the change is subtle (`4-horizon-fire.jpg`), because few pixels pass the threshold. It will show once
fire's field composite makes real white cores.

## The grade hook, and a proposal per world

`World.grade?: Grade` (`src/worlds/world.ts`). Every field is optional: `lift`, `gamma`, `gain` (rgb), `shadows` and
`highlights` tints with `split`, `saturation`, `contrast` about `pivot`, and `protect` (0.6: how much a saturated
colour, an element's, is left alone). It is applied after the tone map (`post.wgsl grade`). A world that sets none is
drawn exactly as before: the grade is skipped (`gradeOn` 0), not applied as an identity. The grade on screen eases
toward the shown world's over 0.5 s. `postParams.proposals` shows the proposals below for worlds that set none.

Suggested values (from `src/post/grade.ts PROPOSED_GRADES`; judged on `4-grades.jpg`, where the rows are geode,
redwoods, Pool, temple and forge, and the columns are the base, this branch with no grade, and the proposal):

| world | set this in the world's class | why |
|---|---|---|
| geode | `grade = { lift: [0.002, 0, 0.006], shadows: [0.94, 0.92, 1.06], highlights: [1.04, 1.0, 0.94], saturation: 1.04, contrast: 1.05 }` | violet shadows, warm light under the shaft |
| redwoods | `{ lift: [0.003, 0.004, 0.002], shadows: [0.95, 1.02, 0.98], highlights: [1.05, 1.0, 0.9], saturation: 1.04, contrast: 1.04 }` | protect it: a touch of green in the shade, amber in the light |
| pool | `{ lift: [0.002, 0.001, 0.008], shadows: [0.96, 0.93, 1.08], highlights: [1.03, 0.98, 1.0], saturation: 1.06, contrast: 1.04 }` | deep blue night instead of black |
| temple | `{ lift: [0, 0.003, 0.008], shadows: [0.92, 0.98, 1.08], highlights: [1.05, 1.0, 0.93], contrast: 1.04 }` | moonlit teal shadows, warm stone where lit |
| forge | `{ lift: [0, 0.002, 0.004], shadows: [0.92, 0.98, 1.06], highlights: [1.04, 0.99, 0.94], contrast: 1.03 }` | cooler rock so fire stands off the orange sea |

**Parity at default:** the grade code is skipped when no world sets one, so it cannot change the picture. The frame as
a whole does differ from the base (the second column against the first), but for the contract's reasons: no horizon
hole, no black smear, no ghosts, no smoke needles, the new bloom, and in the Pool no flame reflection.

## Timings (RTX 5090, 1920x1080, profiler over 150 stepped frames; same steps, base vs branch)

| scene | frame | what moved |
|---|---|---|
| fire and water, redwoods at dusk, two live gates | 4.10 → 4.76 ms | scene 1.87 → scene 0.77 + glow 1.12 (the same draws, split); gate scenes the same, split the same way; air 0.75 → 0.98 (the glow fogged at its own distance: three air calls on glow pixels, which in the redwoods are marches); lens 0.078 → 0.044 |
| one fire dancer close, Pool | 4.04 → 4.48 ms | scene 3.57 → glow 3.60; new surface 0.090 + merge 0.011 (+ two copies, untimed); air 0.083 → 0.099; lens 0.084 → 0.044 |

The post chain excluding the scene: redwoods 0.89 → 1.09 ms, Pool 0.23 → 0.31 ms. The rest of each frame's difference
is not in any timed pass (copies and the extra depth store are untimed) or is run-to-run noise (the base's redwoods run
under contention earlier read 163 ms and was thrown away). Cheaper later: fog the glow with one transmittance call
instead of two extra air calls, and skip the merge when no water body is drawn.

## The critique's "Done when", item by item

- *`critic-elements.json` re-shot in the Pool has no rectangle at the horizon*: **done**, shown with the same setups
  through my step file (`4-horizon-fire.jpg`, `4-horizon-water.jpg`). I did not run `critic-cap.mjs` itself, because it
  writes over the critic's `3-*` media.
- *`critic-moves.json` re-shot has no black smear under the fire*: **done**, armada against esquiva at 0.95 s in the
  geode (`4-mirror-smear.jpg`).
- *the frame right after a crossing is in focus on the player*: **mechanism done, not shown**. The camera does not
  cross in this build (task 4), so no such frame exists to shoot. The world-change snap and the lock are shown
  (`4-focus-cut-lock-stub.jpg`).
- *the ice aú shows no triple ghost*: **done** (`4-ice-au.jpg`).
- *the lens ≤ 0.15 ms at 1080p*: **done**, 0.044 ms.

## Weak points

- No per-pixel velocity blur on opaque matter (it needs a velocity attachment from the opaque draws). Gems lost the old
  whole-frame smear; their streaks and sparkles still trail.
- Flames are no longer mirrored by the Pool's and the temple's water (fire's job, above). Fire's smoke no longer darkens
  the scene.
- Glow drawn behind a water body is added over the body (the body is not in the depth buffer).
- A body's rim pixels (where it covers less than half) get the water surface laid over them twice. This is a few
  pixels wide.
- `sceneStep` in `post.ts` mirrors the `worldScene` switch in `light.wgsl` by light number. A new world with a scene
  step must be added in both places.
- The weft reflection makes an entry bind every binding of its module, so the surface and merge passes bind all seven
  textures (`air.wgsl` stays at 7 of 16 sampled in the fragment stage, inside the baseline).
- Steam was not converted to return a focus texture. It is drawn after the lens, so its focus would arrive a frame
  late, and it is never dense enough to focus on. The focus path was tested with `focusStub` instead.
- `npm run build`'s prebuild moved weft to 0.2.9 (adds `jitterNdc` to `Frame`). I put back the lockfile and every
  generated `.d.wgsl.ts` outside `src/post`. The two in `src/post` carry that one extra line.

## Edits outside my folders

- `src/engine/views.ts`: the glow target and glow pass, the scene's depth stored for it, `NO_FOCUS`. This was
  unavoidable, because the scene pass is made there. It was not on my list.
- `src/matter/core/kind.ts`: `focus?(view: ViewCtx): Texture | null;` plus the two type imports it needs (`Texture`,
  `ViewCtx`).
- `src/worlds/world.ts`: the optional `grade` and the `Grade` type.
- Nothing in `src/matter/reactions/`, `src/worlds/light.wgsl` or any world folder.
- New: `src/post/grade.ts`; `scripts/steps/depth-lens.json`, `-worlds.json`, `-grades.json`, `-timings.json`,
  `-cross.json`, `-cross-look.json`, `-cut.json`; `docs/reports/media/4-*.jpg`.
