# Wave 6, task 6: the temple and the redwoods, film polish

Branch `worktree-agent-a572cd80930ec6a1e` (on top of `d070f8d`; not pushed or merged).

Everything was rendered on the RTX 5090 through headless Chrome against this worktree's dev server on port 5456, one
take per run under the shared render lock (each take 3 to 8 s of rendering once it held the lock; the machine was busy
and most of the wall time was waiting for the lock). Takes: `scripts/steps/tr7.json` (written by
`scripts/steps/tr7-gen.mjs`; `node scripts/steps/tr7-gen.mjs before` writes `tr7-before.json` for the code as it was),
run with `node scripts/critic-cap.mjs scripts/steps/tr7.json --only <take> --prefix 7tr --shots shots/tr7`. Every
"before" was shot from the base code in this same session at the same pinned time (the temple's tide held at 0.12 of
its cycle, the redwoods at 19.4 h). I looked at every still named here full size, side by side with its before.

Measured: `npm run typecheck`, `npm run build`, `npm test` (all of it; exit 0), the critic's world and film takes for
these two worlds before and after, the lead shot's frame, both locks at 1080p, the log's end close at dusk and at noon,
the moon close at 16° and 6° lenses, the camera's clearance on an orbit in each world, the film path against the live
path in both worlds, 1080p timings, `?baseline` in both worlds. Not measured: a phone or laptop, sound, a person
playing, a real film render through `scripts/film.mjs` (the film agent's), the other agents' changes together with
mine.

## The faults, before and after

| fault | before | after |
|---|---|---|
| temple: the orange side's columns flat grey-white | `7tr-before-w-temple-sheet.jpg` (row 2), `7tr-before-w-temple-3.jpg`, `7tr-before-tm-orange-1p9.jpg`, `-2p9.jpg` | `7tr-w-temple-sheet.jpg` (row 2), `7tr-w-temple-3.jpg`, `7tr-tm-orange-1p9.jpg`, `-2p9.jpg` |
| temple: the capitals' carving ghosting | `7tr-before-tm-orange-1p9.jpg`, `-2p9.jpg` (the abacus bands) | the same frames after |
| temple: the moon's halo and cloud at 1080p | `7tr-before-tm-orange-3p9.jpg`, `-4p9.jpg` | `7tr-tm-orange-3p9.jpg`, `-4p9.jpg` |
| temple: moonlit faces clipping to white | `7tr-before-tm-orange-2p9.jpg` | `7tr-tm-orange-2p9.jpg` |
| temple: the lead shot's frame (the moon behind the lintel) | `7tr-before-film2-dolly-3p6.jpg`, `7tr-before-tm-lead-sheet.jpg` | `7tr-film2-dolly-3p6.jpg`, `7tr-tm-lead-sheet.jpg`, `-0p5.jpg` |
| temple: the lock | `7tr-before-tm-lock-2.jpg` | `7tr-tm-lock-2.jpg` |
| redwoods: the log's cut end a shell | `7tr-before-t-redwoods-jogo-0p5.jpg`, `7tr-before-rw-logend-1p9.jpg`, `-2p9.jpg` | `7tr-t-redwoods-jogo-0p5.jpg`, `7tr-rw-logend-1p9.jpg`, `-2p9.jpg` |
| redwoods: the lantern large and blurred in front of the lock | `7tr-before-rw-lock-2.jpg` (top left) | `7tr-rw-lock-2.jpg` |
| redwoods: the log darker in the locked view | `7tr-before-rw-lock-2.jpg`, `7tr-before-rw-lock-sheet.jpg` | `7tr-rw-lock-2.jpg`, `7tr-rw-lock-sheet.jpg` |

### The temple

- **The orange side's columns** (`stones.wgsl`). Cause: seen against the afterglow the camera stands between the stone
  and the moon, so it sees the faces square to the moon, lit by its full direct light (`moonLight` 1 on a pale stone),
  flat (a head-on light has no modelling) and bright enough that the stone's ±10 % grain and mottle vanished in the
  tone curve. Two changes. The moon's direct light on stone is held to half (`temple.moonStone`, 0.5; the moon's rim
  light, its wet highlight, its shadows and everything else it lights are untouched), and the side that faces the sea
  and the moon is weathered (`temple.weather`, 1): the stone's own large mottle sharpened into grey-brown crust, rust
  stains, more of the rain's streaks, more grain. The fronts (the afterglow side, the critic's row 1) skip this: they
  look as they did (`7tr-w-temple-0.jpg` against its before). After: the columns read as weathered stone with streaks
  and mottle, grey not white, in the same shade family as the rest; still paler than the fronts (they are moonlit).
- **The capitals' ghosting.** Cause: the egg-and-dart's lips and the inscription are a height field a centimetre or
  two across, sampled for its slope 4 mm apart; at 5 to 10 m a pixel is 5 mm, so the slope aliased into doubled
  outlines (bright and dark fringes round each egg, `7tr-before-tm-orange-2p9.jpg`). Now the slope is taken over two
  pixels' footprint and the relief fades where it is finer than that (`foot = length(fwidth(wp))`). Close up nothing
  changes; at a distance the bands read as one row of eggs.
- **The moon's halo and cloud at 1080p**: checked, unchanged. A luminance profile up from the disc's edge through the
  halo in `7tr-tm-orange-3p9.jpg` falls smoothly (largest step 3.6 levels in a 9-pixel average, at the disc's soft
  edge); the veil of cloud crosses the disc without a hard edge. The disc itself is a flat white (its seas are blown
  out at 3.2× the moon's colour); I left it: it is the sky the critic called the strongest backdrop.
- **The lead shot's frame.** From the critic's dolly (`film2-dolly`, the frame at 3.6 s: 5.8 m, yaw 0.28, low) the moon
  stood behind the stage's lintel. The lintel is a ledge (unchanged), so the moon and the set round it moved instead:
  the moon's bearing is now -0.22 rad (`MOON_BEARING` in `layout.ts`, was 0.05: 15° to the left), and the great gate
  and the whole drowned court beyond are turned about the court's middle onto that bearing, so the moon still rises in
  the gate with the far gate under it. From the dolly the moon now stands clear between the gate's columns, its path
  on the water runs up between the two dancers, the colonnade either side (`7tr-film2-dolly-3p6.jpg`). The tide for the
  lead shot wants to be near its height so the path is on water all the way to the eye (`tm-lead` holds 0.42: the
  first frames of `7tr-tm-lead-sheet.jpg`). For the film agent: with this bearing the moon clears the lintel for camera
  yaws up to about 0.3 at 4 to 6 m; past that (the end of `tm-lead`, arcing to yaw 0.7) it goes behind the lintel
  again, so the arc of shot 3 should run from about -0.1 to 0.3, not further right.
- **The lock** (`temple.ts`: the stage plane's `yaw` 0.14, `pitch` 0, `lens` 19 kept). Before, the lock looked down a
  little and the moon was above the frame (`7tr-before-tm-lock-2.jpg`). Now level and turned a little more, the moon
  stands in the great gate over the far gate, its path down the middle of the court between the two pillars where the
  dancers start (`7tr-tm-lock-2.jpg`). The gate's tops are cut by the frame's top edge.
- Ledge data, `tideY`, the water and every other light are unchanged. The shadows on the floor follow the moon's new
  bearing (they are the moon's).

### The redwoods

- **The log's cut end** (`trunks.wgsl vs_stage`, `bark`). Cause: the broken end was the end disc pushed in and out by
  one smooth noise up to half the radius, its rim moving with it, so it stood out past the bark as a thin bent sheet
  with eleven wide ring stripes (the "clam shell"); the hollow was a cone. Now a big broken end has: a bark band
  (the outer seventh) snapped a little short of the wood, dark and fibrous; a thin pale sapwood ring; the heartwood
  standing out in short splinters (at most a fifth of the radius, longest midway out), 46 rings that fade where finer than
  a pixel, radial checks, the old broken wood greyed in patches; and the heart rotted out into a hollow about a third of
  the radius wide that runs 1.5 m back into the log, its walls narrowing and closed at the bottom, punky brown at the
  mouth and black down it. The end's faces take the mesh's own facets (blended with the axis) so splinters and the
  hollow's walls are lit as shapes. The stage draw has more rings and sides for it (48 × (14 + 2·14 − 1) a piece, ten
  pieces; the boughs' draw is unchanged). After: `7tr-rw-logend-1p9.jpg` (noon, square on), `-2p9.jpg` (three quarter),
  and in the critic's jogo `7tr-t-redwoods-jogo-0p5.jpg` it reads as a sawn-off, ringed, hollow trunk, not a shell.
- **The lantern in front of the lock** (`stage.ts liftLanterns`). It was lantern 12, hanging to 2.95 m from a limb about
  4 m in front of the lock camera. Lanterns hung low between the stage and the lock (on the camera's side of the plane, 3
  to 8 m out, within 4 m of the middle along it) now hang with their bottoms at 6.4 m or more; only lantern 12 qualifies
  (a test checks that and that no other cord changed). It keeps its limb and its light; it now hangs above the lock's
  frame (`7tr-rw-lock-2.jpg`).
- **The log's dusk light.** Cause: the last pass covered its crown with a 90 % moss cushion over most of the top and
  lichen down a quarter of its flank, so the bark that catches the low sun was green-grey. Now the moss is in patches on
  the crown (a higher threshold, a little lighter and warmer), the lichen half as strong: the warm bark shows along the
  top and face again (`7tr-rw-lock-2.jpg` against `7tr-before-rw-lock-2.jpg`; the meadow, fog, trunks and lanterns are
  the same).

## The camera's proxies (`World.solids`, `World.clear`)

`src/worlds/solids.ts` (new): `type Solid = { kind: 'capsule'; a; b; r } | { kind: 'box'; c; half; yaw }`, `cylinder()`
(a capsule whose round ends stop at the foot and top), and `clearOf(solids, a, b, margin = 0.4)`: how much of a → b is
clear (iq's ray-capsule, a slab test in the box's own frame, each grown by the margin). A solid the segment starts
inside is ignored, so a look point inside a margin (a dancer on a stump) does not pull the camera in to nothing.

- **Temple** (`layout.ts solidsOf`, 131 solids, from the same `Stone` list the geometry is drawn from): every block a
  box (the altar, the lintels, the gate's lintel, bases and abaci, walls, steps), every drum a cylinder (columns, bases,
  capitals by their wider end, stumps, fallen drums lying along their axis), the far court too; the platform under the
  floor left out (the floor is `groundAt`'s). `Temple.solids`, and `Temple.clear(a, b)` (new) answers from them.
- **Redwoods** (`layout.ts solidsOfWoods`, `stage.ts solidsOfStage`): every trunk a tall cylinder of its radius plus a
  short fat one round its flared foot; every limb two capsules following its droop; every piece of the stage's chains a
  capsule (the fallen log, its root plate and roots, every piece of both boughs). `Redwoods.solids`; `Redwoods.clear` now
  answers from them (it was the first 24 trunks only).
- `World.solids?: readonly Solid[]` added to the World contract (`world.ts`, one optional member and an import).
- Tests: `src/worlds/temple/solids.test.ts` (12, in `npm test`): segments stop at the altar's and a pillar's faces less
  the margin, pass over a stump's top and the log, hit the gate's columns, the fallen drums, the boughs, a ring trunk;
  a look point inside a margin is not pulled in; the lantern lift.
- Seen working: `7tr-w-temple-clear-sheet.jpg` and `7tr-w-redwoods-clear-sheet.jpg`, the critic's orbits with the
  clearance on: the eye never enters a column, the altar, a trunk, the log or a bough. What the rig then does (comes in
  quickly to the dancers, down to its 0.9 m floor, so a few frames are filled by a dancer) is the camera agent's to
  shape. Note: my look takes set `bend.rig.clearance = null` so before and after are the same frame.

## Film-ready controls and the film path

- **Temple:** `bend.set('temple', { tideHold, moonHeight, moonSize, moonStone, weather })`. `tideHold` ≥ 0 pins the
  tide (0 low, 0.5 high); the drying of the stone follows it. The moon's height is a parameter (8°); a film can animate
  it by setting it per frame. Deterministic when stepped: the clouds' drift, the stars' twinkle, the glitter's sparkle
  and the ripples run on the frame's stepped clock. **One exception, not in my folders:** with `tideHold` < 0 the tide
  follows the music's beat, which on the live path is the wall clock (`music.now()` is `performance.now()` unless
  filming), so a stepped live capture's tide drifts with real time; on `?film` it is the film's clock and repeats.
  Films should hold the tide (or drive `tideHold` from their own clock).
- **Redwoods:** `bend.set('redwoods', { hour, dayGoes: false })` pins the hour (the lanterns light by it, the key, fog,
  sky and exposure all follow it). On `?film` the day never goes on its own (the film sets the hour), so a held hour
  holds. The lanterns' swing and flicker, the fireflies and the dust run on the stepped dance time.
- **The film path against the live path** (`scripts/steps/tr7-film.mjs`: the same world, time, dancers, camera and 150
  stepped frames, once live at render scale 1.5 and once through `?film&w=1920&h=1080&scale=1.5`, its YUV 4:2:0 frame
  read back with `bend.grabYuv` and turned back to RGB; `7tr-film-temple-side.jpg`, `7tr-film-redwoods-side.jpg`, live
  left, film right). The pinned settings arrived identical (hour 19.4, tide 0.12, moon 8°). **The world's look is the
  same:** in the temple the region without dancers differs by 3.2/255 on average (left strip), which is the YUV round
  trip and a half-pixel resample. **What differs:** (1) the dancers' motion: after the same 150 steps the two dancers
  are in different poses on the two paths (the moves and the bot partner are not driven only by the stepped clock), so
  their light on the stone and grass differs too; not my folders, reported for the film agent; (2) the redwoods on
  `?film` test 24 trunks for the light shafts and march the fog in 26 steps (13 and 15 live): by design, finer shafts;
  with the dancers' light also different, the region by the log was 13 % darker in red on the film in my frame; (3)
  the film's frame is the graded image tent-filtered down from the supersampled render, the live canvas the same image
  shown by the browser: no visible difference in tone.

## Cost (RTX 5090, 1920x1080, weft's profiler over 150 stepped frames; the machine was shared, numbers move ±0.1 ms)

| scene | before | after |
|---|---|---|
| temple, fire and water, 4 m (`t-temple-pair`) | frame 1.93 ms, scene 0.40 | frame 2.02 ms, scene 0.43 |
| redwoods, fire and water, 4 m (`t-redwoods-pair`) | frame 2.91 ms, scene 0.78, air 0.86 | frame 2.97 ms, scene 0.79, air 0.85 |
| redwoods jogo, locked, roda (`t-redwoods-jogo`) | frame 3.19 ms, scene 1.00, air 0.89 | frame 3.28 ms, scene 0.99, air 0.88 |

The first version of the sea-side weathering added a three-octave noise per stone pixel and cost 0.1 ms of scene
(0.50); it now reuses the stone's own mottle and runs only on faces turned to the sea: 0.43, within the noise of 0.40.
The log's denser end mesh is ten instances of 11,808 vertices: not measurable. `?baseline` renders both worlds cleanly
(`7tr-base-sheet.jpg`, no warnings but Chrome's own about `powerPreference`).

## The critique's "Done when", item by item

- *`6-w-temple` row 2 re-shot loses its fault and keeps its light*: yes: row 2 of `7tr-w-temple-sheet.jpg` shows grey,
  streaked, mottled stone where it showed flat grey-white block-outs; the sky, the afterglow, the moonlit floor, the
  water and the fronts are as they were (row 1, `7tr-w-temple-0.jpg`). The moon in row 1 now stands left of where it
  stood, between the gate's columns (the bearing moved for the lead shot).
- *`6-t-redwoods-jogo-0p5` re-shot loses its fault and keeps its light*: yes: `7tr-t-redwoods-jogo-0p5.jpg`: the log's
  end is a ringed, barked, hollow trunk end; the fog, warm backlight, flowers and dancers are as they were.
- The brief's further items: the lantern out of the lock (yes, `7tr-rw-lock-2.jpg`), the log's dusk light back (yes,
  same still), the capitals' ghosting (yes, at the distances shot), the halo and cloud at 1080p (checked, no banding),
  moon-facing stone not clipping (yes, `7tr-tm-orange-2p9.jpg`), the lead shot composed (yes, `7tr-film2-dolly-3p6.jpg`
  and the first half of `7tr-tm-lead-sheet.jpg`), proxies and `World.clear` for both (yes, tested and seen), time
  settable and holdable and stepped deterministically (yes, with the live-path tide exception above), cost within noise
  (yes), `?baseline` clean (yes).

## Weak points

- The moonlit columns are grey stone now, but still a flat light: a face square to the moon has no modelling. A lower
  `moonStone` (0.4) would darken them further; I kept 0.5 so the moonlit side stays visibly moonlit.
- The moon's disc is a flat white; its seas don't show at any lens. A smaller multiplier in `templeSky` would show
  them, and would change the sky everyone likes; not done.
- Moving the moon's bearing moved the moon in every temple view, and the shadows on the floor with it. The critic's
  row 1 still has the moon in the gate.
- The log's end at noon is a little dark and faceted on its splinters (the end has 48 sides); at dusk and from the
  game's distances it reads as wood. Its hollow's bottom is below the ground where the log is settled in, so from a low
  angle a little of the ground shows inside the mouth.
- The proxies are coarse: a capital is its wider end's cylinder, a broken top is its full height, the gate's lintel is a
  box without its break. A margin of 0.4 m covers that for a camera.
- `World.clear` pulling the camera in is now real in the temple: the critic's orbits and any free camera will dolly in
  past columns. Takes that want the old framing must null `bend.rig.clearance`, as mine do.
- The film path does not repeat the dancers' motion exactly (above); world-only comparisons are clean.

## Edits outside my folders

- `src/worlds/solids.ts` (new): the proxy types and `clearOf`, shared by both worlds (and any other world).
- `src/worlds/world.ts`: `readonly solids?: readonly Solid[]` on `World`, and its import.
- `scripts/steps/tr7-gen.mjs`, `tr7.json`, `tr7-before.json`, `scripts/steps/tr7-film.mjs`: my step files.
- `docs/reports/media/7tr-*.jpg` and this report. Nothing in `src/worlds/light.wgsl` changed (the temple's `tide2.z/w`,
  free before, now carry `moonStone` and `weather`; its comment in `temple/temple.wgsl` says so).

## How to see it

`?world=temple&lock`, `?world=redwoods&lock`; `bend.set('temple', { tideHold: 0.42 })` for the lead shot's tide,
`{ moonStone, weather }` for the stone; `bend.set('redwoods', { hour: 19.4, dayGoes: false })`; the proxies are each world's
`solids` and `clear(a, b)` (the rig reads `clear` through the portals' clearance). Re-shoot:
`node scripts/steps/tr7-gen.mjs && node scripts/critic-cap.mjs scripts/steps/tr7.json --only film2-dolly --prefix 7tr --shots shots/tr7 --url http://[::1]:5456/energybending/`;
the film check: `node scripts/steps/tr7-film.mjs --only temple`.
