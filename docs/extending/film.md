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
fresh page, for checks), `--no-encode`, `--no-score` (pictures only, silence under them: the offline score is the slow
part, about 8× real time, so leave it off while working on a timeline), `--variant <name>` (a separate cache), `--out <dir>`
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
twelve frames evenly through the shot. The page logs a line a second of film (`film: <shot> frame k/n … beat b seats
x,y,z | x,y,z eye x,y,z nearest body d m`): where the jogo's beat is, where each seat stands and how far the eye is
from the nearest body, which is how to find which cue put a dancer behind the other or the camera in a body. What to look for: a subject out of frame or cut by the edge, the camera inside
something (a crystal, a bough: the film camera stays clear of gates' discs, a world's `clear` and, by `near`, the dancers and a fusion's column), a
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
  "bars": 28,                           // or "beats", or "seconds"; a bar is 4 beats at the film's tempo (its track's)
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

**A hold.** `"hold": 9` on a jogo shot starts the jogo's room nine seconds late (the page's `&hold=9`,
src/play/index.ts): until then the dancers lie asleep in their heaps (the gems in their cairn at the world's middle),
and a `{ "at": 4.2, "wake": true }` cue wakes them early (a gem dancer streams in from the cairn as a comet). Use it
with `"from": "start"`; a `dress` cue during the hold changes what a seat wears before the intro (film 1: gems, then
water as the intro begins).

**Free jogo, placed.** `"lock": false` plays the jogo free (`&free`); a `place` given as a point, `[x, z]`, is the
film's own even in a jogo (bend.place), so `{ "at": -9, "seat": 0, "place": [-1.2, 0.3] }` stands a seat there before
the intro (which re-forms it there). Times of -9 or less fire on the first frame in any shot. A seat's `goto` in a
free jogo is along x (its z kept).

**Forms.** A timeline with any `form` cue owns the forms for its duration: src/ai's partner's own presses of the form
button are dropped (`AiPartner.formHeld`), so a form the timeline turns off stays off and the fusion is the kind the
timeline meant. `bend.jogo.partner.home = [x, z]` moves the middle a free partner's ginga drifts back to (the stage's
middle otherwise).

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
| `near` | metres the eye keeps from every dancer's bones and outside a fusion's column (default 1.2; 0 lets it in) |

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

## The music: a track

A film is scored by a world's track (`public/music/`, docs/extending/sound.md section 5):

```json
{ "name": "film2", "audio": { "track": "temple" }, "shots": [ … ] }
```

`track` is a world (or a track's id), or a file (a path from the timeline's folder: it is measured as the film starts,
its tempo searched round `"bpm"`; the pages then play in the key of the first shot's world's track, so prefer a world's).
Optional: `"gain"` (the track's level, 1) and `"score"` (the shots' recorded sounds under it, 1: the game's own balance).
With a track:

- The film's tempo is the track's measured tempo (a film's `bpm` is ignored): bars and beats are the track's.
- Each shot's page runs the music's clock on the track's grid: a jogo's grid start (its "1.1"), or a play or show
  shot's in-point, is the track beat at that point of the film. The first shot's page chooses: a bar line of the track
  on its grid's start, the first that lets the track start under the film's first frame; its `info.json` says which
  (`track.trackBeatAtGrid`, `trackBeatAtIn`, and `gridTime`, where on the score's clock the grid started). The later
  shots are handed theirs (so the first shot renders first; a later shot alone stops if the first has no info yet).
- The pages play none of the game's groove: each shot's recorded score is the matter voices, the stones and feet, the
  players' melody and the jogo's sounds, in the track's key and on its 16ths. The `music` cues still set the groove's
  level, which only the brains hear now.
- Every shot is rendered a beat longer than asked and cut where its end falls on the nearest whole beat of the track
  (to the frame: within half a frame, and no error carried from one shot to the next).
- The track is laid under the whole film, its place at the first frame from the first shot's info, the shots' scores
  under it at the game's balance, then a limiter at -1 dBFS. The source is the conformed WAV the analysis leaves in
  `docs/reports/media/music/<id>.wav` (the .m4a when it isn't there).
- `--flash` lights every frame that starts a beat of the track and measures, from the encoded picture, how far each
  flash falls from its beat (`sync:` in the log and run.json): the pages' clock against the track the film lays.
- A film without `audio` keeps the generative score (its pages run with `&procedural`).

## The score

Each shot's page records its score (the Recorder) from its first frame and renders it offline after its last frame,
with the lock released. The film's score is the shots' scores laid on the film's time: each starts 40 ms before its
cut, the one before rings out over 0.45 s (`ringOut`); the film fades in and out (`fadeIn`, `fadeOut`, seconds). A
shot's own score is continuous across its takes and its internal cuts. Between shots the music is two renders joined
on a beat (both run at the film's tempo), not one: put what must sound continuous in one shot.
