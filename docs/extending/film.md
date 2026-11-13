# Films: how to write a shot, render it and review it

A film is a timeline in `films/<name>.json`: an ordered list of **shots**. Each shot is one page of the game, played
from its first frame, deterministic (stepped at 1/60 s, seeded), filmed by a camera you keyframe over the game's own
camera rig. `scripts/film.mjs` renders the shots in short takes under the shared GPU lock, caches the takes, lays the
score under them and encodes the film. Nothing is drawn as text, ever: no titles, no HUD unless a shot asks for the
in-world meters, no menus (the DOM is never in a frame: frames come from the GPU), no debug.

```
films/<name>.json          the timeline
scripts/film.mjs           the renderer: takes, cache, lock, score, encodes, contact sheets
scripts/film-serve.mjs     the server to render from (Vite without hot reload: restart it after changing code)
scripts/film-seams.mjs     the seam check (takes against one take, a take rendered alone)
scripts/film-cut.mjs       the older path (a cut of src/engine/film.ts: --cut short|showcase|dream|forest|jogo)
src/engine/film-shot.ts    the page side of a shot: set-up, cues, the frames, pauses, the score
src/engine/filmcam.ts      the film camera: keys, splines, eases, lag and lead, framing, handheld, focus, modes
src/engine/film.ts         the page's film entry (?film): the older cuts, and ?cut=timeline → film-shot.ts
```

## Render

```bash
node scripts/film-serve.mjs 5435 &                         # the server (any free port; not 5441, the perf service)
node scripts/film.mjs films/film2.json --preview --sheet   # 960×540, 30 fps, quick; a contact sheet per shot
node scripts/film.mjs films/film1.json --shot c-gate --preview --sheet --sheet-n 30   # one shot, a denser sheet
node scripts/film.mjs films/film1.json                     # the master: 1920×1080, 60 fps, rendered at 1.5× and
                                                           # brought down on the GPU; master + web copy
node scripts/film.mjs films/film1.json --hevc --av1        # also an HEVC and an AV1 copy
node scripts/film-seams.mjs films/test-seam.json --take 3  # prove the seams are invisible
```

Options: `--url` (default `http://127.0.0.1:5435/energybending/`), `--port` (the sink, default 5436), `--take <s>`
(take length: 10 s master, 20 s preview; `0` for one take), `--force` (render again), `--only-take <k>` (one take in a
fresh page, for checks), `--no-encode`, `--variant <name>` (a separate cache), `--out <dir>`
(default `docs/reports/media/film`, git-ignored). Files: `<out>/<film>-master.mp4`, `-web.mp4`, `-preview.mp4`,
`<out>/cache/<quality>/<film>-<shot>-<key>/take-NNN.mkv` (lossless x264, the takes), `score.wav` and `info.json` (the
shot's in-point, its page frames, the jogo's state at the end, the page's warnings), `<out>/work/<film>-<quality>/`
(joined shots, the score, `run.json`: lock holds, encode times and sizes). Sheets:
`docs/reports/media/6-film-<film>-<shot>-sheet.jpg` (commit those).

A changed shot renders again; an unchanged one is read from the cache. The key is the shot as the page sees it, its
page address, the size, rate, scale and take length, and a hash of `src/`, `shared/`, `index.html` and the lockfile:
any code change renders everything again.

## Review

Look at every shot's sheet (`--sheet`; `--sheet-n 30` for a denser one), then the preview with sound. A sheet is
twelve frames evenly through the shot. What to look for: a subject out of frame or cut by the edge, the camera inside
something (a crystal, a bough: the film camera stays clear of gates' discs and a world's `clear`, nothing else), a
cut that jumps the axis, bodies inside each other, a known bug from `docs/reports/3-critique.md`. Write what the game
can't do yet down for the critic rather than working round it in the film.

## A shot

```json
{
  "id": "temple",
  "mode": "jogo",                       // jogo (a scripted jogo, src/play), play (?play&two), show (the programme)
  "world": "temple",
  "cast": [{ "dress": "fire" }, { "dress": "water", "brain": "calm", "seed": 5 }],
  "from": "1.1",                        // the in-point: a place on the jogo's grid, or "start" (with "preroll": s)
  "bars": 28,                           // or "beats", or "seconds"; a bar is 4 beats at the film's "bpm" (112)
  "yawBase": "stage",                   // yaw 0 is the stage's camera side ("side": side-on to the pair; or a number)
  "hour": 19.7,                         // the redwoods' time of day (held still)
  "set": { "temple": { "tideHold": 0.42 } },          // any parameter group (bend.params), once at the start
  "curves": { "temple.moonHeight": [["1.1", 3.5], ["29.1", 15]] },   // a parameter eased through keys
  "music": { "level": 0 },              // the groove's level (0 … 4) to start
  "hud": false,                         // the jogo's in-world meters (off unless asked)
  "cues": [ … ],
  "camera": [ … ]
}
```

**Times.** `"at"` is `"bar.beat"` (whole beats, 1-based: `"1.1"` is the first beat, `"12.3"` the third beat of bar
12), `"bar:beat"` (a fractional beat: `"3:2.5"`), or a number of seconds from the in-point (negative: in the lead-in;
`-9` is "before anything"). In a jogo the grid is the jogo's own (beats since play began, as src/play/script.ts
counts them), so a cue lands on the music's beat however long the intro took; elsewhere it starts at the in-point. A
shot that starts before the jogo's play (`"from": "start"`) times its grid keys once play begins.

**The cast.** Seat 0 is scripted; a seat with `"brain"` is src/ai's partner (`playful`, `calm`, `fierce`, `mirror`)
with its `seed`, on seat 1. `dress` is a preset (matter/core/presets.ts).

**Lead-in.** A jogo shot's page runs its intro (the bodies re-forming at their spawns, about four seconds) before
play; frames before the in-point are stepped and not kept. A `play` or `show` shot keeps frames from `preroll`
seconds (default 0.5).

## Cues

| cue | does |
|---|---|
| `{ "at", "seat": 0, "move": "armada" }` | a move now (the library's names, RULES.moves) |
| `"press": "dodge"` (or a list) | an edge: jump punch kick spin dodge form interact |
| `"hold": { "moveY": -1 }, "for": 0.6` | Intent fields held for `for` beats |
| `"goto": -0.5` | walk to s on the locked stage (a jogo) |
| `"place": -0.5` / `[x, z, yaw]` | stand there now (a jogo: s on the stage; play: the world) |
| `"build": true` | arm the build button (the next perfect move sets a piece: ice, a crystal ledge) |
| `"walk": [x, z], "speed": 0.5, "on": 1.4` | play: walk to a point; through a gate, straight on for `on` s |
| `"form": 1` | the seat's power form (fire → plasma, water → ice); a jogo holds it on (flow kept up) |
| `{ "at", "fuse": true }` | a jogo: the tension full and merge ready (then `goto` close and `hold: { merge }`) |
| `{ "at", "tension": 80 }` | a jogo: the rules' tension |
| `{ "at", "music": { "level": 3, "drop": true, "fusion": "steam", "release": true, "key": 50 } }` | the score |
| `{ "at", "set": { "redwoods": { "lanterns": 0 } } }` | parameters now |
| `{ "at", "wake": true }`, `"rig": "lock"`, `"shot": "crown"` | the show wakes; the rig locks or frees; a director's shot |
| `{ "at", "js": "bend.…" }` | anything else, with `bend` in scope (keep it rare) |

Seats are `0`, `1` or `"both"`. In a jogo the seat cues go to the jogo's own ScriptRunner (exact on its clock); the
rest run in the film's frame loop.

## The camera

Keys in time; each sets any of these, and the values between keys are a Catmull-Rom spline through them with the time
eased per key (`"ease"`: `inOut` the default, `in`, `out`, `linear`, `spline` for no stop at the key, `hold`).

| key | means |
|---|---|
| `around` | what it looks round: `pair`, `d0`, `d1`, `stage`, `[x, y, z]`, or `{ "of": "d0", "joint": "chest", "offset": [0, 0.2, 0] }` (joints: ground, hips, chest, head, hands) |
| `yaw`, `pitch`, `dist`, `height` | the orbit, in the rig's terms (yaw 0 = the eye at +z; plus `yawBase`), `height` the point looked at above the anchor |
| `orbit` | rad/s round it (integrated, so it eases in and out with its keys) |
| `eye`, `look` | an explicit path instead: the eye (a point) and what it looks at (an anchor) |
| `fov` or `mm` | the lens: degrees top to bottom, or a full-frame focal length |
| `lag`, `lead` | seconds the anchor lags (an operator's follow) and seconds of its travel to aim ahead (lead room) |
| `frame` | `[x, y]`: where the subject sits on screen (-1 … 1 of the half frame; `[-0.3, 0]` a third left) |
| `focus` | an anchor (its chest), `"look"`, or metres; pulled between keys |
| `handheld` | a slow seeded drift (0 … 1 gentle; the shot's `seed`); no roll |
| `mode`, `blend` | `free` (these keys), `lock` (the rig's locked game screen), `rig` (the rig's own: its follow camera, its crossing of a gate), blended over `blend` s |
| `cut` | jump here: a cut on the beat inside the shot (the take goes on: dancers, matter, music) |

The horizon is always level (an eye and a point looked at; weft's camera has no roll). The film camera is laid over
the rig's pose in the rig's `apply`, and its focus replaces the rig's for the depth of field; the rig keeps running
underneath (the jogo's lock moves the dancers onto the stage plane, the follow camera turns a free stick), so `lock` and
`rig` blend into what the game would show. A free camera that passes through a gate's disc isn't carried (its keys are
in one world's coordinates): to cross, blend to `rig` and let the rig's follow camera go through, then cut or blend
back to `free` round the pair (anchors are found in the rig's world, so they follow).

**Add a primitive.** Camera arithmetic lives in `FilmCamera.update` (src/engine/filmcam.ts). A new scalar is a name in
`SCALARS` with a default, read with `g('name')` in `update`; a new anchor is a case in film-shot.ts's `scene.anchor`
(or a joint in `pointOf`); a new mode is a case in `rigWeight`. Keep it a function of the keys, the time, the dt and
what the scene says each frame, so the same file renders the same path.

## Takes, continuity, determinism

A shot is cut into takes; at each boundary the page pauses (no GPU work), the renderer releases the lock and takes it
again, and the page goes on: one page lives through the whole shot, so the dancers, the particles, the field and the
music never stop. A take rendered alone (after a failure or a change) is a fresh page that steps through everything
before it without reading it back. `scripts/film-seams.mjs` measures both against one uninterrupted take (see
docs/reports/6-film-tool.md for the numbers).

Deterministic: the frames (stepped at 1/60 s, seeded brains, a seeded handheld, the jogo's room on a stepped clock),
the score's calls. Not bit-exact: a handful of pixels per frame differ by one or two levels between runs of the same
shot (GPU), and the offline audio render differs by an LSB or so (Chrome's OfflineAudioContext, docs/reports/1-audio.md).

## The score

Each shot's page records its score (the Recorder) from its first frame and renders it offline after its last frame,
with the lock released. The film's score is the shots' scores laid on the film's time: each starts 40 ms before its
cut, the one before rings out over 0.45 s (`ringOut`); the film fades in and out (`fadeIn`, `fadeOut`, seconds). A
shot's own score is continuous across its takes and its internal cuts. Between shots the music is two renders joined
on a beat (both run at the film's tempo), not one: put what must sound continuous in one shot.
