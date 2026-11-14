# 11: the duel's HUD (phase 1, "Move")

The HUD a player of the duel sees: who is who, how hurt, how close to winning, how much flow, and above all the beat.
It is drawn from one plain object (`HudState`, docs/design/duel.md) that the duel's rules fill each frame, works in
the free third-person view and in the lock, and is in every captured frame: stills and films show what a player sees.

Branch `worktree-agent-a600b82ad12fea540`, from master `df03f4a`. The owner's correction of the brief (master
`b91e987`: the duel is 3D native, the lock an option; flow from dancing well feeds the super) is taken in: the tags
follow heads projected from 3D and point from the screen's edge at a player out of frame or behind the camera; the
super meter is drawn as flow; the beat is shown twice, at the bottom and at each player's tag; the stills are free
and locked.

## What was built

`src/hud/` (nothing outside it but the joins listed below):

| file | job |
|---|---|
| `state.ts` | `HudState` and its parts as TypeScript (the contract, unchanged), `emptyHud()`, and `screenOf(viewProj, p)`: a world point to the HUD's screen fractions. Out of frame it lies outside 0 … 1; **behind the eye** it is put far outside on the side to turn toward (leaning down), so the tag points the right way in the free view |
| `hud.ts` | `Hud`: two 2D canvases over the WebGPU canvas. `base` holds what changes seldom (the panels, the score), drawn again per strip (seat 0's panel, the score, seat 1's panel) only when what it shows changes or a piece of it moves; `live` holds what moves every frame (the flow rings, the tags, the beat, the pops, the countdown and the banner), clearing only last frame's boxes. Kept at the device pixel ratio (up to 3) or, filming, at the render's (the film is graded 1.5× bigger than it is shown). A warm-up makes the duel's sprites one a frame before they are needed |
| `panel.ts` | a player's panel: the matter's emblem in a dark well, the **flow ring** round it, the name and seat, KOs as slanted marks toward the target (fill from the name outward), hits as crystal pips that crack (white flash, two halves fall apart along the crack, three shards), the dash (two chevrons and a recharge hairline, a flash when ready), the spell slots (empty sockets until phase 2; with charges, filled by readiness and dotted by count). Seat 1's mirrors seat 0's |
| `centre.ts` | the score at the top centre (each seat's KOs in its colour, the clock, "FIRST TO 5"), the countdown ("3", "2", "1" thin and large, each dropping in with a ring opening; "BEND" in gold once as play starts), the winner's banner (a band opening from the centre, the name tracking in, fitted to the screen, the final score) |
| `beat.ts` | the beat indicator at the bottom centre: a still ring, a ring closing on it once a beat and landing exactly on the beat, the perfect window as a gold band whose edges are hairlines (its width is the window: the closing ring is inside it for exactly `window` seconds either side), the whole mark turning gold in the window, a flash outward on the beat |
| `pops.ts` | words rising from where something happened (PERFECT gold, PARRY ice-white, KO large with a slash of light in the scorer's colour, a reaction in the actor's, info plain), kept below the panels and inside the screen; the **tags** ("P1" in the player's colour over a pointer) with a small beat ring of their own, held at the screen's edge with an arrow when the head is out of frame or behind the camera |
| `style.ts` | the site's type (system-ui, tracked caps for the few words) and glass (index.html's `.jg-front`, deeper so it holds type over a bright sky), the elements' colours (menu.ts's swatches), the matter glyphs (flame, drop, hex crystal, bolt, cut stone, cloud), sprites in shelf-packed **atlases** |
| `demo.ts` | `?hud=demo`: a seeded duel animated over any world without the duel's mode (see below); `?hud=demo2` fills the spell slots too |
| `jogo.ts` | the jogo's beat alone (mode `'jogo'`) behind `?hud=beat` / `bend.hud.jogoBeat` |
| `index.ts` | `hud` (the one HUD), `installHud` (mounts it, the demo and jogo ticks, the frame's draw step, the film's overlay), `bend.hud` |
| `overlay.wgsl` | the HUD drawn over a film's graded frame |

The joins outside `src/hud`: `main.ts` (+4 lines: install, the post chain's `overlay`, the hooks' `overlay`,
`bend.hud`), `post/post.ts` (+3: an optional `overlay(pass)` called in the film's grade pass, after the grade draw),
`engine/hooks.ts` (`bend.grab` composites), `engine/film-shot.ts` (`"hud": false` hides it), index.html (the `.hud`
layer: fixed, z-index 3, above the stage and its loading glow, under the menus and the touch pad at 5, no pointer).

### The API

```ts
import { hud, screenOf, type HudState } from '../hud';
hud.set(state);                 // each frame, from any tick (it is drawn as the frame is submitted, after every tick)
hud.visible = false;            // the player's switch: off on screen and in captures
// state.players[i].screen = screenOf(bend.kit.camera.viewProj, headPlus25cm)   (a tick after 'camera')
```

`bend.hud`: `set(state)`, `state`, `visible`, `jogoBeat`, `demo` (`.at(seconds)` jumps the demo, returns its
state), `startDemo(on?, spells?)`, `stats(reset?)` (CPU ms mean and worst, frames the base layer was drawn, size,
ratio, compact). Query: `?hud=0` (off everywhere), `?hud=demo`, `?hud=demo2`, `?hud=beat` (the jogo's beat).

Readings of the contract the integrator should know: `beat.window` is read as **± seconds** round the beat (like
RULES.PERFECT_MS); `round.time` is shown as m:ss as given (the duel decides up or down); `round.countdown` is seconds
left, "BEND" shows once as it reaches 0 or play starts; a pop lives about 1 s (KO 1.3, info 1.6) of its `age`;
`superMeter` is drawn as flow (a rise of more than 1.2% in a frame reads as a gain and pulses). `screen` may lie
outside 0 … 1.

### Flow and the beat (after the correction)

- **Flow**, round the emblem, on the live layer so it can move every frame without redrawing the panel: it breathes
  on each beat (swells and brightens, decaying over the beat), a short bright current runs along what is filled once
  a beat, a spark sits at its leading end, a gain flashes the new part white and sends a thin ring out, and full it
  turns gold, glows with the beat and glints. Its fill eases (rate 10/s).
- **The beat** in two places: the ring at the bottom centre (bigger now: 22 and 58 u radii at desktop, u = 1 at
  1280×720) and a small ring at each player's tag, which closes on the tag once a beat in the player's colour and
  lights gold through the perfect window. The tags are over the heads, where the eyes are, so a player can time a
  move without looking away from the bodies; the bottom ring is the precise one (window band, edges, flash).

### Captured frames include it

- **`bend.grab`** (stills, `shot.mjs`, `critic-cap.mjs`): the frame read back (weft's `Capture.step`), then the HUD's
  two canvases drawn over it at the frame's size, then encoded. The canvases already hold the stepped frame's HUD
  (it is drawn inside `kit.run`).
- **A film** (`grabYuv`, `film.mjs`): at the head of the frame's `out` stage a CPU step draws the HUD, flattens the
  two canvases into one at the render size and uploads it with `copyExternalImageToTexture` (premultiplied) into an
  rgba8 texture the size of the render; the film's grade pass then draws it over the graded frame with premultiplied
  blending (both are display-encoded, so it mixes as the browser composites the page), before the frame is brought
  down to YUV. The draw is enabled only while the HUD shows anything.
- **Off**: `?hud=0` in the page or a shot's `query`, `"hud": false` on a shot, `bend.hud.visible = false` in a cue.
- **The jogo's films stay HUD-free**: in a jogo the HUD shows nothing unless `?hud=beat` is given (checked: a jogo
  still without it has no HUD, `11-hud-jogo-beat.jpg` has only the beat).

### The demo

`?hud=demo` plays a seeded round: the countdown (3 s), then about 40 s of play built from a sequence (hits, three to a
KO, the body reforming 1.5 s, perfect moves and parries with their pops, dashes and their 0.9 s recharge, a reaction,
flow rising on good moves and dashes and ebbing slowly, the super spent after 3.5 s full), the winner at 5 KOs for
6 s, then a new seed. Deterministic when stepped (its own clock, a seeded generator); its beat is the music's clock
(`FrameCtx.beat`); its tags ride the first two framed dancers' heads; names and colours come from what they wear
(fire: Ember, water: Tide, ice: Frost, plasma: Volt, gems: Geode). `bend.hud.demo.at(s)` replays it to second s.

## What was measured (RTX 5090 PC, headless Chrome, `scripts/hud-time.mjs`)

| case | HUD CPU a frame (mean) | worst frame |
|---|---|---|
| desktop 1920×1080, demo | 0.153 ms | 0.8 ms |
| desktop 1280×720, demo | 0.138 ms | 0.8 ms |
| phone 390×844, demo (compact) | 0.136 ms | 0.8 ms |
| jogo, beat only, 1280×720 | 0.049 ms | 1.4 ms (the first frame: sizing and sprites) |
| film 1920×1080 at scale 1.5 (draw + flatten + upload) | 0.217 ms | |

- Means over 600 stepped frames of the demo's busiest stretch (countdown, then hits, KOs and pops every half second
  or so, more than a real duel). Chrome's `performance.now()` is coarsened to 0.1 ms here, so a single frame reads
  0.0, 0.1 … and the worst column is quantised; the means are over 600 such readings. Device pixel ratio 1 (the
  capture scripts force it); at a phone's 3 the drawing is the same calls over 9× the pixels, not measured.
- Before the atlases, the first KO cost **13.3 ms** in one frame (making new canvases and contexts for its word and
  glows) and the countdown's "BEND" 3.6 ms; with sprites packed into atlases and the warm-up, no frame of 2,400 went
  over 1.1 ms (the first "STEAM!", which nothing warms).
- The base layer was drawn in 273 of 600 frames of the demo (a strip at a time: a recharging dash or a reforming
  body redraws its panel each frame while it moves).
- **GPU**: the film's grade pass 0.048 ms without the HUD, 0.064 with it (+0.016 ms at 2880×1620). Nothing is added
  to the live page's GPU work (the HUD is DOM canvases the browser composites). The film's stepped frame went from
  4.66 to 5.84 ms of wall time with the HUD (the flatten and the upload of a 2880×1620 image each frame).
- A 6 s master film (`scripts/steps/hud-film.json`, 1920×1080 at scale 1.5) shows the HUD composited and crisp
  (`11-hud-film-frame.jpg`); a preview (960×540, scale 1) too.
- `npm run typecheck` clean; full `npm test` passed (the net smoothness test passed in the full run); the binding
  check counts `hud/overlay.wgsl` at 1 sampled texture.

## Stills (`docs/reports/media/11-hud-*.jpg`)

Every world, locked (`-lock`) and in the free third-person view (`-free`), 1920×1080: geode, pool, temple, forge,
redwoods by day and by night, each a moment just after a KO (a pip cracking, the KO mark landing, the KO's word
rising, flow pulsing). `geode-countdown`, `geode-bend`, `geode-won`; `pool-free-behind` (player 2 walked behind the
camera: its tag held at the bottom right corner, pointing). `phone-landscape` (844×390) and `phone-portrait`
(390×844) sheets of eight; `jogo-beat`; `film-frame` (a frame of the master film). Regenerate with
`node scripts/shot.mjs <out> scripts/steps/hud.json --url … --size 1920x1080` (and `--size 844x390`, `390x844`).

What I changed after looking: pips and glyph larger; KO word bigger with a slash of light; PERFECT warmer (it read
white); pops kept below the panels and wholly on screen; the banner over the pops and fitted to a phone's width; the
off-screen arrow moved clear of the tag; the demo's pops lifted off the tags; the beat ring larger with drawn window
edges.

## Weak points

- **The flow ring is small** for what the correction makes the core of the game: 29.5 u radius on desktop, 15 u on a
  phone. It moves and pulses, but a player watching the bodies sees it only peripherally. If flow becomes the main
  resource (spells and super in phase 2), it may want a second home near the body (a ring at the tag, like the beat).
- **The tag's beat ring** is one more thing at the head; with two players it is two rings closing in step. It reads
  as rhythm, but it is untested with real players and might be busy in a close fight; `drawTags` is the place to
  tone it down.
- The jogo judges perfect on eighths (`PERFECT_GRID` 2); its beat indicator closes on beats only.
- The free view's behind-the-camera case is shown with a placed body (`pool-free-behind`); the real third-person
  camera framing both players rarely puts one behind it.
- Compact layout is chosen by size (`W < 760 || H < 480`), not by touch: a small desktop window gets the phone bars;
  it keeps the beat ring clear of the touch pad's column whether or not one is shown. Safe-area insets (a notch) are
  not read; the 8 u margin is all.
- The demo's dancers are `?play&two` bodies that don't fight; the hits and pops are scripted, not theirs.
- The base layer clips a glow at its strip's edge (halfway across the gap between a panel and the score); not seen in
  any still, but possible with a very wide glow.
- Fonts: system-ui, so Segoe UI on Windows, SF on Apple, Roboto on Android: the look shifts a little by platform.

## Not done

- Phase 2's spell slots are drawn (sockets, readiness, charge dots; `?hud=demo2`), but have no spell glyphs.
- No settings UI for `visible` (only the hook and the query); no keyboard toggle.
- Not measured at a real phone's pixel ratio or on a real phone.

## Proposed lines for AGENTS.md (not edited)

- In the map: `hud/   the screen's HUD (the duel's panels, flow, score, beat, pops, tags), drawn from one HudState
  (hud.set) on two 2D canvases over the stage; composited into bend.grab and a film's frames (post's overlay);
  ?hud=0|demo|demo2|beat`.
- In "The frame": `out` begins with the HUD's CPU step (`hud`: draw, and filming, the upload); a film's `grade.film`
  pass ends with the HUD's overlay draw.
- In the hooks: `bend.hud` (set, visible, jogoBeat, demo, startDemo, stats).
- In the binding budget table: `hud/overlay.wgsl | v/f | 2 / 2 | 0 / 0 | 0 / 1 | 0 / 0 | 0 1`.
