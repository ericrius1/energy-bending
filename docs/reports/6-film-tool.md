# Report 6: the film tool

Branch `worktree-agent-aae69d594ddec1f16` (worktree `.claude/worktrees/agent-aae69d594ddec1f16`), not pushed or merged.

The film tool is built and has been run end to end: a timeline per film (`films/*.json`), a renderer that renders it shot by shot in short takes under the shared GPU lock, caches each take and joins them, a seam check, a film camera with its own primitives, two rough cuts (both films from the critique's shot lists, previewed with sound), and one shot at master quality. The guide is `docs/extending/film.md`.

**Measured** (RTX 5090, headless Chrome through `scripts/film-serve.mjs` on port 5435, the sink on 5436 and 5437):
- The seam check at master quality.
- Previews of film 1 and film 2, with their contact sheets looked at shot by shot and three rounds of changes.
- The master shot, with its encodes and timings.
- `npm run typecheck` (clean).

**Not measured:**
- Anything by ear. The scores were muxed and their levels read with `volumedetect`, but nobody listened.
- A master render of either whole film. Only the one shot was rendered at master quality.
- Any other GPU or machine.

## The timeline format

A film is `{ name, bpm, size, fps, fadeIn, fadeOut, shots: [...] }`. A **shot** is one page of the game, played from its first frame. Here is a short example, film 2's single take, trimmed:

```json
{ "id": "temple", "mode": "jogo", "world": "temple",
  "cast": [{ "dress": "fire" }, { "dress": "water", "brain": "calm", "seed": 5 }],
  "from": "1.1", "bars": 28, "yawBase": "stage",
  "set": { "temple": { "tideHold": 0.42 } },
  "curves": { "temple.moonHeight": [["1.1", 3.5], ["16.1", 11, "linear"], ["29.1", 15]] },
  "music": { "level": 0 },
  "cues": [
    { "at": "7.1", "seat": 0, "move": "armada" },
    { "at": "15.1", "seat": "both", "form": 1 },
    { "at": "20.1", "music": { "level": 4 } } ],
  "camera": [
    { "at": "1.1", "around": "pair", "yaw": 0, "pitch": 0.03, "dist": 9, "height": 0.5, "fov": 34, "lag": 0.9, "focus": "pair", "handheld": 0.35, "ease": "spline" },
    { "at": "15.1", "yaw": -0.95, "dist": 3.2, "pitch": 0.2, "ease": "spline" },
    { "at": "29.1", "yaw": 0.45, "dist": 4.6, "pitch": 0.72, "height": 0.35, "ease": "out" } ] }
```

- **`mode`:**
  - `jogo`: a scripted jogo. Seat 0 follows the script; a seat that has `brain` is src/ai's partner, with its preset and seed.
  - `play`: `?play&two`. Both players are scripted, and they can walk anywhere, through gates too.
  - `show`: the Gem Dancers programme.
- **`world`, `cast` (presets), the starting state:**
  - `place`, `forms`, and the jogo's tension, `fuse` and form cues.
  - `hour` for the redwoods.
  - `set` takes any parameter group, for example the temple's tide and moon.
  - `curves` eases a parameter through keys.
- **Times:**
  - `"bar.beat"`, 1-based: `"1.1"` is the first beat.
  - `"bar:beat"` when the beat is fractional.
  - Or seconds from the in-point.
  - In a jogo the grid is the jogo's own (beats since play began), so a cue lands on the music's beat whatever the intro took.
  - A shot can begin before play, with `"from": "start"`. Its grid keys are then timed once play begins.
- **Length:** `bars`, `beats` or `seconds`, at the film's tempo. Every shot today is a whole number of beats, so every cut lands on a beat.
- **Cues:**
  - Moves, edges, held Intents, goto, place, build: the jogo's own vocabulary, sent to its ScriptRunner.
  - `walk` to a point (play mode); through a gate the dancer walks straight on.
  - `form`, `fuse`, `tension`.
  - `music` (level, drop, fusion, release, key).
  - `set`, `wake`, `rig` lock and free, `js`.
- **Camera keys:** `around`/`yaw`/`pitch`/`dist`/`height`/`orbit`, or `eye`/`look`; `fov` or `mm`; `lag`, `lead`, `frame`, `focus`, `handheld`; `mode` with `blend`; `cut`; `ease`.
- **Transitions:**
  - Between shots: a cut on the beat.
  - Inside a shot: a `cut` key is a cut within one continuous take (the dancers, the matter and the music go straight on).
  - A crossing through a gate can be a continuous take: blend to `mode: "rig"` and let the rig's follow camera carry through. It is available but not used in the rough cut (see below).
- **Music:** each shot's starting level, and level cues through it. The jogo's fusion brings its own music: eight bars of the fusion pad. That was seen in film 1's preview; it was not heard.

## Takes and continuity

**The choice: one page lives through a whole shot, and the lock is released between takes.** At each take boundary the page stops before stepping on (so no GPU work happens) and calls the sink. The renderer:
1. finishes that take's lossless capture;
2. releases the lock;
3. takes the lock again (waiting behind whatever else holds it);
4. lets the page go on.

The dancers, the particles, the field and the music never stop, so a seam is simply the frame that would have come anyway.

A take that is rendered alone (after a failure or a change) is a fresh page. It steps through everything before the take without reading it back, pausing at the same boundaries so the lock is still released.

**The seam check** (`node scripts/film-seams.mjs films/test-seam.json --take 3`, master quality) uses a redwoods jogo of 514 frames. The partner brain plays against scripted moves, and the camera is a handheld orbit with a push. The shot was rendered three ways and compared on the luma plane, frame by frame. The JSON is `docs/reports/film-seams-test-seam.json`.

| comparison | identical frames | worst frame |
|---|---|---|
| three 3 s takes vs. one uninterrupted take | 472 of 514 | 5 pixels differ, by at most 2 levels of 255 (mean 3 × 10⁻⁶) |
| take 1 rendered alone (fresh page) vs. the same take in place | 160 of 180 | 5 pixels differ, by at most 1 level |

The seams themselves, measured as a jump (the mean difference between the frames either side of a boundary):

| seam | across the boundary | the neighbouring pairs | the shot's neighbours |
|---|---|---|---|
| frame 180 | 5.257 | 5.257 and 5.258 | median 6.75, 95th percentile 15.6 |
| frame 360 | 8.248 | 8.055 and 8.377 | (same) |

So a seam is invisible: it is no larger than ordinary frame-to-frame motion. The few differing pixels show up at run-to-run level on frames far from any seam too, so they are GPU nondeterminism and not caused by the seams.

**The score** is one continuous render per shot. The page's Recorder writes every call from the page's first frame, across its takes and its internal cuts. After the last frame, with the lock released, it is rendered offline.

## Camera primitives (`src/engine/filmcam.ts`)

- **Keys and splines.** Every value is a Catmull-Rom spline through its keys, with the time eased per key: `inOut` (smootherstep, the default), `in`, `out`, `linear`, `spline` (no stop at the key) and `hold`. Splines don't bend across a `cut`.
- **Motivated moves:**
  - `around` an anchor: `pair`, `d0`, `d1`, `stage`, a point, or a joint with an offset.
  - `lag`, an operator's critically damped follow.
  - `lead`, seconds of the anchor's travel to aim ahead (lead room).
  - `frame`, where the subject sits on screen.
  - `orbit` in rad/s, integrated so it eases in and out with its keys.
  - A slow push on a held pose is a `dist` key with `ease: "out"`.
- **Lens:** `fov`, or `mm` (full frame). **Focus:** an anchor's chest, `look`, or metres, pulled between keys. It replaces the rig's focus for the depth of field.
- **Stable horizon:** by construction. The pose is an eye and a point looked at, and weft's camera has no roll. The handheld drift turns only yaw and pitch.
- **Handheld:** three seeded waves per axis between 0.07 and 0.9 Hz, scaled by `handheld`.
- **Modes:** `free`, `lock` (the rig's locked game screen) and `rig` (the rig's own camera, including its follow camera and its gate crossing), blended over `blend` seconds. The rig keeps running underneath. `lock` reproduces film 1 row 5's swing to the long lens exactly (1.1 s, the rig's own ease).
- **Base yaw:** `yawBase` is `stage` (the lock's side), `side` (side-on to the pair, measured until the in-point) or a number.
- **Clearance:** the boom shortens to the rig's `clearance`: the gates' discs, and the trunks through `World.clear`.

## What is deterministic

**Deterministic:**
- The page is stepped at 1/60 s at every frame rate. A 30 fps preview reads back every second frame, so it shows exactly the master's motion.
- The brains are seeded (`seed` reaches `AiPartner`).
- The handheld is seeded.
- The jogo's room runs on the stepped clock.
- The cues are fired on that clock.
- The score's calls are the same each run.

**Not bit-exact:**
- A few pixels per frame differ between runs, by 1 or 2 levels (the GPU; see above).
- The offline audio differs by an LSB or so (Chrome's OfflineAudioContext, per 1-audio.md).

**Not repeatable at all:**
- A shot whose page is served by a dev server that reloads. `film-serve.mjs` has no hot reload and no watcher for this reason.
- Code edited mid-render. The cache key includes a hash of `src/`, `shared/`, `index.html` and the lockfile.

## The rough cuts, shot by shot

Both were rendered with `--preview` and sound. Sheets are `docs/reports/media/6-film-*-sheet.jpg`; the videos are `docs/reports/media/film/film1-preview.mp4` and `film2-preview.mp4` (git-ignored).

**Film 1** has three pages: `ab-jogo` (18 bars), `c-gate` (4½ beats, cut on the off-beat eighth) and `d-hub` (9 bars), about 60 s.

| rows | what works | what the game can't do yet |
|---|---|---|
| 1–2 | A crane down from the canopy (pitch −0.5, 7.6 m, 56°) to the dancers during the jogo's intro, so the bodies rise at their spawns | There are no asleep heaps to hold on. The jogo's intro re-forms the bodies within its ~4 s, and in the show's programme the first dance is the salsa couple, whose bodies overlap (fire inside water). A held heap needs the jogo to wait (a `&hold` hook) or a two-dancer programme |
| 3 | Ginga, side-on at 4.2 m, with scripted meia-lua, dodge, armada, rolê and martelo; the playful partner answers | The answers are the brain's own: no guaranteed esquiva or rolê on cue |
| 4 | Cut on the beat to a close orbit; the forms shift (water to ice, fire to plasma) with arcs between the hands; the focus pulls from d0 to d1 | At 3 m with the pair 2.5 m apart, one dancer is cut by the frame edge for a moment |
| 5–6 | `mode: lock` swings to the game screen in 1.1 s; the aú onto the log and the jump | Building ice under the aú didn't show a bridge in the sheets (build armed at 9.4) |
| 7 | `fuse`: the tension is full, both hold merge, and the fusion lands on the bar line; the camera blends to free and rises to high on a slow orbit | The fusion's first frame blooms into a white sphere (the blown-white cores, open item 5). A dark fern sometimes crosses the high orbit's foreground: the camera's clearance only knows gates and trunks |
| 8–9 | Walking toward the gate followed from behind, with the geode live inside the disc as they reach it: "the shot of the idea". The cut on the beat falls as they step in | **The continuous crossing failed in my takes.** In `rig` mode, with the rig's follow camera, the eye stayed behind in the redwoods for about a second (empty meadow, then the disc edge-on) before it came through. So the rough cut cuts at the disc instead |
| 10–11 | Out of the geode's gate (the redwoods seen through it behind them), across the hub, an armada answered by an aú, then a close side-on two-shot facing, fading out | Matter streams across the stage for about 2 s after `place` (the water flies to its new spawn), so these pages use a 2.5 s lead-in. The geode's crystal shelves and blades fill a free camera at 5 m or more, so the hub shot stays low |

**Film 2** is one take, 28 bars (60 s), in the temple at moonrise:
- **What works:**
  - The dolly in from 9 m low over the water, with the moon behind the lintel.
  - The arc round them to 3 m.
  - The forms shift together at bar 15, then the slow orbit, then the rise over them.
  - The moon rising by a curve from 3.5° to 15°.
  - Their reflections.
- **What doesn't:**
  - **The calm partner walks into the fire dancer and stays overlapping** (plasma inside ice) through most of bars 16 to 23 (the brain's spacing, integration open item 10).
  - The fire dancer stood inside the altar block until I moved its goto to −2.6.
  - The shot list's 90 bpm isn't possible: the jogo is fixed at RULES.BPM 112.
  - "They bow" has no move.

## The finished shot at full quality

`films/redwoods-lock.json`: the redwoods jogo at 19:24 in the locked view. Water is scripted; fire is the playful partner (it turns to plasma by itself). It is 8 bars: 17.15 s, 1,029 frames. Sheet: `6-film-redwoods-lock-lock-master-sheet.jpg`.

- **Render:** 1920×1080 at 60 fps, rendered at 2880×1620 (scale 1.5). The page brings each frame down with a tent filter into YUV 4:2:0, BT.709 video range. The grade's own grain is applied once (no grain added in ffmpeg).
- **Capture:** x264 `-preset ultrafast -qp 0` (lossless). Two takes: 801 MB and 574 MB.
- **Timings:**
  - Waiting for the lock: 5 min 40 s (another project held it).
  - GPU under the lock: **24.1 s + 10.9 s**. That includes boot, pipeline compile, the jogo's 4.3 s intro, and 1,029 frames at about 31 fps.
  - The offline score: about 22 s (lock released).
  - The encodes, with no lock held:
    - master: 22 s
    - web: 13 s
    - HEVC: 58 s
    - AV1: 11 s

The encodes:

| file | settings | size |
|---|---|---|
| `redwoods-lock-master.mp4` | libx264 slow, crf 14, `-tune film`, High profile, GOP 2 s, yuv420p, BT.709 tags; AAC 320k | 125.8 MB (58.3 Mb/s) |
| `redwoods-lock-web.mp4` | libx264 slow, crf 21, maxrate 10M, bufsize 20M; AAC 192k | 22.3 MB (10.2 Mb/s) |
| `redwoods-lock-hevc.mp4` | libx265 slow, crf 18, `hvc1` tag; AAC 256k | 54.8 MB |
| `redwoods-lock-av1.mp4` | libsvtav1 preset 5, crf 26; AAC 256k | 43.6 MB |

At master quality a 10 s take holds the lock for 11 to 24 s; the longest hold seen in any run was 25.6 s.

**The offline score is the slow part on long shots.** The preview's 60 s temple shot took about 8 minutes to render its audio, with no lock held.

## Where the files are

- **The renderer:** `scripts/film.mjs`. Given anything other than a `.json` or `.mjs` timeline, it runs the older path (`scripts/film-cut.mjs`, the cut-based film.mjs moved, unchanged).
- **Other scripts:** `scripts/film-seams.mjs` and `scripts/film-serve.mjs`.
- **The page side:** `src/engine/film-shot.ts` (new) and `src/engine/filmcam.ts` (new). `src/engine/film.ts` dispatches `?cut=timeline`.
- **Films:** `films/film1.json`, `film2.json`, `redwoods-lock.json`, `test-seam.json`.
- **The guide:** `docs/extending/film.md`.
- **Committed:** the sheets `docs/reports/media/6-film-*.jpg` and the seam numbers `docs/reports/film-seams-test-seam.json`.
- **Rendered video and cache** (git-ignored): `docs/reports/media/film/`, with the cache under `cache/` (lossless, about 1.3 GB per 17 s of master).

## Weak points

1. **The continuous gate crossing isn't proven.** The rig's follow camera lagged behind the disc in my take, so the rough cut cuts at the disc.
2. **The music between pages is two renders joined on a beat**, not one continuous score: each shot starts 40 ms early and the one before rings out over 0.45 s. The tempo matches, but the harmony and the groove's bar count restart. What must sound continuous has to be one page, as film 2 is and as film 1's `ab-jogo` covers rows 1 to 7.
3. **The free camera only avoids gates' discs and the redwoods' trunks.** Ferns, crystal shelves and blades go through the frame. A world that answers `clear` for them would fix it.
4. **Offline audio is slow:** about 8× real time on a 60 s shot. It runs with the lock released, but it dominates the wall-clock time of a render.
5. **The lossless cache is large:** about 80 MB per master-quality second.
6. **Brains are cast, not directed.** The partner's answers and spacing are its own (the overlaps above).
7. **A shot's bar.beat camera keys move whenever the jogo's intro length changes.** That is the intent (the keys stay on the beat), but it does change framings.
8. **The jogo's in-world glows still show:** exchange rings at the feet and the count-in pulses. The meters are off (`hudLocked`/`hudFree` 0), but the feel's rings and the flow's count-in still draw. They read as light in the world, but the critic may want a film switch.

## Edits outside my files

- **`src/play/index.ts`** (2 lines and a comment):
  - In script mode, `&partner=…` seats the partner brain on dancer 2 instead of the script's bot, so a film can script one seat against a brain.
  - `&seed=N` is passed to `AiPartner`.
- **`src/play/partner.ts`** (2 lines): `AiPartner` keeps its seed, and `setPreset` reuses it instead of the hard-coded 23.
- **`src/engine/hooks.ts`** (2 lines and a header line): `bend.worldOf(id?)`, the World the rig is in, so the film camera can read the stage and the ground.

Nothing that changes how the game looks. The film camera patches `rig.apply` and `rig.focus` on the instance from inside `film-shot.ts`; `camera.ts` and `main.ts` are not edited.

## For the critic and the owners

These are the game's problems the films ran into:
- The jogo needs a way to hold before its intro: no heaps on screen.
- The rig's follow camera loses about a second at a gate crossing with two walkers.
- The partner brain crowds into the other dancer's body.
- The fusion's first frame blooms white.
- The geode's shelves and the redwoods' ferns don't answer `World.clear`.
- The jogo's tempo is fixed at 112 (film 2 asked for 90).
- There is no bow.
- A placed dancer's matter takes about 2 s to arrive.
