# Report 9: the music (the worlds' Suno tracks in the game and the films)

Eric asked for Suno tracks in place of the procedural score. Each world now plays its own track (five instrumentals,
one per world, the geode's also on the hub): the music's clock runs on the track, the jogo, the brains and the tide
keep its beat, a world change crossfades to the next track on a bar line, a room plays its world's track at its tempo
for both players, and both films are scored by theirs. The generative groove is silent under a track (`?procedural`
brings it back); the matter voices, stones, feet and the jogo's sounds stay, quieter, on the track's 16ths in its key
and its bar's chord.

## Built

- **`scripts/music-analyze.mjs`** (Node + ffmpeg, no new dependency). For each track (`TRACKS` at its top: title,
  worlds, the tempo and key asked for, the Suno id) it reads the download, measures the tempo through the track,
  **brings it to one tempo** (rubberband through ffmpeg, beat by beat, at most ±4 %: Suno drifts, see below), then on
  the conformed audio measures the tempo, bar 1, the steadiness, the swing, the key and a triad per bar, picks a loop,
  normalises to -16 LUFS (true peak under -1 dBTP) and encodes AAC 160 kb/s 48 kHz (`public/music/<id>.m4a`, 3.6 to
  4.9 MB). It writes `public/music/tracks.json` (everything, with how it was measured) and `shared/tracks.ts` (what
  the game and the server read). `--clicks` renders each track with clicks on the measured grid (a high click on each
  downbeat) and four bars either side of the loop's seam into `docs/reports/media/music/` (git-ignored), which also
  keeps the conformed 24-bit WAVs the films lay under them.
- **The game** (`src/audio/track.ts`, `deck.ts`; `engine.ts`, `music.ts`, `clock.ts`, `harmony.ts`, `synth/mix.ts`):
  the clock at the track's tempo, beat 0 its bar 1; `trackPos` maps any beat to the file (on from bar 1, then round
  the loop). The deck plays AudioBufferSourceNode segments where the clock says, checks every scheduler tick (re-places
  past 12 ms), crossfades 30 ms at the loop's seam, and on a world change fades the old track over a second while the
  new one starts at its bar 1 on the next bar line (the clock's origin and tempo change on that bar line; a drop under a
  track lands on a bar line without moving the grid). The engine plays no drums, bass, pad, arps, toque, tension or
  fusion textures under a track; its level still follows the players (the partner reads it). The harmony is a mood made
  from the track (`trackMood`: its key's pentatonic and seven triads), each bar's chord the triad the analysis heard
  there. The track enters the mix after the limiter (its own low-pass carries the drop's sweep); `Mix.under` turns the
  game's whole bus down 14 dB (the stones, feet and matter 4.4 dB more, the effects 2 dB more, the jogo's sounds 4 dB
  less) and the players' melody to half: measured, the game's own sounds had been a decibel over the track. Loading: the first world's file is fetched and decoded (OfflineAudioContext, 48 kHz) as the page loads, the
  others fetched 8 s later and decoded when their world comes; two at most stay decoded. Mute and volume as before.
- **Rooms** (`shared/rules.ts`, `src/play/index.ts`): a room's tempo is its world's track's (`tempoOf`); its epoch is
  the track's bar 1. A seat's travel to another world re-epochs the room on its next bar line at the new tempo
  (`retempo`; the end of play, a fusion and the intro move to the new grid's next bar line), and both clients switch
  track on the new epoch. Play lasts the whole bars nearest 180 s (`sessionMs`: 84 at 112 bpm, as before). A local
  room now hears its seats' travels too (it never did: a local jogo's world stayed the first).
- **Films** (`scripts/film.mjs`, `src/engine/film-shot.ts`): `"audio": { "track": "<world>" }` (or a file). The
  film's tempo is the track's; each shot's page runs the music's clock on the track's grid (the plan hands each shot
  the film's track beat at its in-point; the first shot's page chooses a bar line of the track on its grid's start and
  reports it); every shot renders a beat long and is cut where its end falls on the nearest whole beat (to the frame,
  no error carried on); the track is laid under the whole film from the conformed WAV, the shots' recorded scores
  under it at the game's balance, a limiter at -1 dBFS. `--flash` lights the frames on the track's beats and measures
  each flash against the track's beat in the encoded picture. `--size`, `--seconds`, `--name` for clips. A film with no
  `audio` keeps the generative score.
- **Checks**: `scripts/music-check.mjs` (the deck's output recorded in the real page against where the clock puts it;
  `--seam`, `--switch`), `scripts/music-online.mjs` (two browsers, one room: where each will be in the track at the same
  moment on the room's clock; `--travel`), `src/audio/test/track.test.ts` (6 tests), a rules test for `retempo`.

## Measured

### The tracks (`node scripts/music-analyze.mjs --clicks`, Eric's five takes from his Downloads)

| track | world | asked | the source's tempo through it | conformed tempo | bar 1 | bars | loop (bars, s) | key (r) | on the grid ±20 / ±40 ms | 4-bar phase within | downbeat margin | size |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Inside the Geode | geode, hub | 112, A minor | 111.11 … 111.62 | **111.431** | **0.539 s** | 96 | 51…87 (110.4–187.9) | **A minor** (0.51) | 97 % / 99 % | ±5.9 ms | 1.53 | 4.36 MB |
| Embers in the Redwoods | redwoods, film 1 | 112, D minor | 111.96 … 113.23 | **113.052** | **0.517 s** | 109 | 44…76 (93.9–161.9) | **A minor** (0.43) | 89 % / 96 % | ±7.3 ms | 1.13 | 4.91 MB |
| The Still Pool | pool | 120, C major | 120.18 … 122.41 | **121.065** | **0.107 s** | 102 | 10…46 (19.9–91.3) | **E♭ major** (0.71) | 94 % / 96 % | ±2.9 ms | 1.12 | 4.16 MB |
| Moon Over the Tide Temple | temple, film 2 | 90, G major | 88.44 … 96.85 | **94.019** | **0.162 s** | 85 | 28…68 (71.6–173.7) | **B minor** (0.62) | 73 % / 86 % | ±18.5 ms | 1.04 | 4.59 MB |
| The Sky Forge | forge | 124, F♯ minor | 126.25 … 131.37 | **130.327** | **0.874 s** | 92 | 36…68 (67.2–126.1) | **F major** (0.32) | 78 % / 87 % | ±5.6 ms | 1.05 | 3.60 MB |

- **Tempo.** Every take drifted from its prompt and through itself: the temple ran 4 % fast (94, not 90) and wandered
  88 → 97 → 92.8 → 94.15 → 93 bpm; the forge 5 % fast and rising 126 → 131; the pool rising 2 % over three minutes.
  A constant tempo fit to the raw temple put only 27 % of beats within 20 ms (the downbeat 0.7 s out by the end), so
  each track is conformed: its 8ths found by the local phase of the onsets' 8th harmonic in 8 s windows (counted from
  window to window, a local line through each ±5 s), and the audio stretched 8th by 8th to the body's median tempo with
  rubberband (pitch and formants kept; stretch 0.96 … 1.04: the temple's first 10 s and its outro hit the limit, 65
  beats; the others 0 to 3 beats). After it the tempo curve through every body is flat to ±0.1 bpm.
- **Steadiness** (after conforming): in each 4-bar window with a clear pulse, how far the onsets' phase sits from the
  line: within ±3 to ±7 ms for four tracks, ±18.5 ms for the temple (its intro); the intro and outro windows with no
  clear pulse are left out.
- **Bar 1 and the grid.** The beat's phase is the peak of the onsets folded on the beat (the beat harmonic's own phase
  is dragged late by swung 16ths: it put the geode's grid 40 ms behind its onsets, 1 % within 20 ms; the fold, 97 %).
  The downbeat is the beat of four where the harmony changes (whole-bar chroma), a bar fits one triad best, the low
  band hits and the onsets are strongest. Bar 1 is the first downbeat at or after the music starts. Median onset
  offset from the grid: -0.5 to +0.7 ms.
- **Key** from the whole track's chroma against the Krumhansl-Kessler profiles (with the tuning measured from the
  spectral peaks: 5 cents from A440, the same for all five). Three takes are not in the key they were asked for.
- **Loop**: the longest stretch of whole 4-bar phrases inside the body (bars within 6 dB of the median loudness, no
  clear-pulse window off the line by more than 15 ms) whose two sides sound most alike: 32 to 40 bars (59 to 102 s).
- **Encode**: AAC 160 kb/s 48 kHz; -16.0 to -16.3 LUFS; the encode against the WAV it came from: 0 samples apart.
- **Clicks** (`docs/reports/media/music/<id>-clicks.m4a`, git-ignored): the onset statistics above are those clicks
  against the onsets; listen to confirm the downbeat (the high click).

### The game: the deck against the clock (`node scripts/music-check.mjs`, headless Chrome on the 5090, 48 kHz)

Each world booted, the sound started as the first touch does, the track's bus recorded for 30 s by an AudioWorklet
(each block stamped with the context's time), and each second of it found in the decoded file round where the clock's
beat puts it (normalised cross-correlation, ±80 ms, to the sample):

| world | seconds placed | recorded audio vs the clock, median / worst | decoded before the touch |
|---|---|---|---|
| geode | 28 of 28 (r 1.000) | 0.00 / 0.00 ms | yes (0 ms waited) |
| redwoods | 28 of 28 | 0.00 / 0.00 ms | yes |
| pool | 28 of 28 | 0.00 / 0.00 ms | yes |
| temple | 28 of 28 | 0.02 / 0.02 ms | yes |
| forge | 28 of 28 | 0.00 / 0.00 ms | yes |

- **The loop's seam** (`--seam`: the clock put 12 beats before the loop's end): pool and temple, one seam each, the
  audio after it 0.02 ms (one sample's rounding) from the clock, correlation 1.000 on both sides.
- **A world change** (`--switch`: geode, then `bend.world('temple')` 10.09 s in): the temple's track began at
  10.850 s, the geode's next bar line (bar 1 started 0.08 s after the touch; 5 bars of 2.154 s), the clock at the
  temple's 94.019 bpm from there. Recorded through it (each second judged by the clock as it was read then), 19 of 19
  seconds sit 0.00 ms (worst 0.02 ms) from the clock: the geode's to 10.24 s, the temple's from 11.26 s.
- **Two players, one room** (`node scripts/music-online.mjs --world temple --travel redwoods`: the room server and two
  Chromes): four probes a second and a half apart, each a moment on the room's clock a second ahead: both pages put
  it at the same place in the temple's track (14.8998 s, 16.4041 s, …: 0.00 ms apart), the room at 94.0191 bpm, both
  clocks synced; their decks within 0.04 ms of their clocks. Then seat 0 travelled to the redwoods: the room took
  113.0517 bpm and a new epoch, both pages switched to the redwoods' track (6.8548 s … 11.3788 s into it, 0.00 ms apart).
  What this leaves is the shared clock's own error between two machines (the net tests' "clock |a-b|", 5 to 8 ms
  over a lagged link).

### The films

FILMS

### Tests

`npm run typecheck` clean. `npm test`: the limits, the bindings, the src tests (10 of 10 files: the jogo, fusion and
script tests now read the room's tempo and play time, and the brains' simulated room runs at the simulation's tempo),
the audio tests (26: 6 new for the tracks: the file for a beat round the loop, a track's mood in its key, no groove
under a track at level 3 with each bar's chord the track's, a new world's track on the next bar line at its tempo, a
drop on a bar line without moving the grid, a room's new epoch bringing its track), the portals, the net tests (a new
rules test: a seat's travel re-epochs the room at the new world's tempo on the old grid's next bar line, the end of
play on the new grid). All pass (the net smoothness test once failed under load and passed alone and in the full run).

## Weak points

- **Nobody has listened.** Everything here is measured: the onsets on the grid, the recorded deck against the clock,
  the flashes against the beats. The conforming (rubberband, up to ±4 % beat by beat) has not been heard; nor have
  the loop seams (`docs/reports/media/music/<id>-seam.wav`), the level of the game's sounds under the tracks (set by
  integrated loudness: about 8 dB under, which says nothing about whether a footfall or a move still reads), or the
  per-bar chords the voices play from. Eric should listen to the click renders and the seams first.
- **The downbeat is the weakest measurement.** The beat is solid (89 to 97 % of beats with an onset within 20 ms in
  four tracks, 73 % in the temple's), but which beat of four is "one" won by a margin of 1.53 in the geode and only
  1.04 to 1.13 in the others. A wrong downbeat moves what lands "on a bar line" (a fusion's landing, a new world's
  track starting, the bar's chord) by a beat or more; the beat itself, the judging and the 16ths are right either way.
  There is no override yet (`TRACKS` would take one: beats to move bar 1 by).
- **Four of the five tracks are not in the key they were asked for**, and the game follows the track, not the prompt: the temple
  measured B minor (asked G major; r 0.62, G major next at 0.45), the pool E♭ major (asked C; r 0.71), the forge
  F major (asked F♯ minor; r 0.32, a weak fit: it is mostly drums and anvils), the redwoods A minor (asked D minor;
  r 0.43, weak). The tuning measured 5 cents from A440 for all five (the method's own bias, most likely: they are
  at concert pitch). The per-bar triads lean on the tonic (a tie goes to it), so the voices mostly play the tonic chord.
- **Suno drifts, and conforming has limits.** The temple's tempo runs 88 to 97 bpm through the track (an intro that
  pushes, an outro that slows), the pool's 120.2 to 122.4, the forge's 126.3 to 131.4. After conforming, the body of
  every track holds within about ±6 ms (the temple within ±16 ms), but the temple's intro (its first 10 s, 65 beats
  past the ±4 % limit) and every outro's ritardando are left as they were: there the grid and the music part (the
  loop never reaches an outro; a film that starts at bar 1 of the temple does have its first bars a little loose).
- **The temple's onsets are softer** (73 % within 20 ms against 89 to 97 % elsewhere): a berimbau and hand drums with
  long attacks and a swung (triplet-ish, 0.33 of a 16th) feel. Its judging grid is the 8ths, which the swing doesn't
  move, so the jogo is unaffected; the matter voices' 16ths are swung by the measured amount.
- **Memory on phones.** A decoded 3.5-minute track is about 70 MB (48 kHz stereo float); two stay decoded during a
  world change. Not measured on a phone; streaming segments would cut it to a few MB.
- **The first touch waits for the decode** if the touch comes in the first second or two after load (the hub's file
  is fetched and decoded as the page loads: 0 ms of waiting in every headless run here, on this machine).
- **Two players hear the same bar to within what the shared clock measures.** The online check proves both pages put
  the same moment on the room's clock at the same place in the same track (0.00 ms apart, before and after a travel),
  which leaves the clock offset's own error (the net tests' "clock |a-b|": 5 to 8 ms on a lagged link).
- **A world with no track** (none now) keeps the last world's track; a film with a file for its track runs its pages
  in the key of its first world's track.
- The net smoothness test ("B: tracks the source in real time") failed twice while renders ran on the machine and
  passed alone, and in the full `npm test`, when it was quieter (it doesn't touch the music).

## Not done

- **The masters.** Both films were rendered at `--preview` with the real tracks; the masters (1920×1080, 60 fps) are
  Eric's to render (below).
- **A downbeat override** in `TRACKS` (beats to move bar 1 by), for when the clicks say the analysis got one wrong.
- **Streaming the files in segments** (to keep a phone's memory to a few MB instead of ~70 MB a decoded track).
- **A beat map** instead of conforming: the game's clock is one tempo, so each track is stretched to one tempo. A
  clock that follows a tempo map would keep the takes untouched (the temple's pushed intro, the outros' ritardandos).
- **The jogo starting on the music already playing.** A local jogo's room starts its own epoch, so the hub's track
  restarts at bar 1 when a jogo begins from the front (online, the room's clock says where it is). A local room could
  take its epoch from the music's clock instead.
- **Listening.** None of the levels, the seams, the conforming or the chords has been heard by anyone.
- The films' `music` cues (the groove's level) are left in the timelines: under a track they only move what the
  brains hear of the music's level.
- No phone was tried (decoding, memory, iOS's AAC timing in `decodeAudioData`: the encode's priming is in the file's
  edit list, which ffmpeg honours and the headless Chrome here did, to the sample).

## Proposed lines for AGENTS.md (I did not edit it)

- In "The map", `audio/`: `the music engine (clock, harmony, engine, synth), each world's track (track.ts: the file's
  place for a beat; deck.ts: plays it where the clock says), the stone score, matter voices, the lab`; `shared/`: `the
  protocol, the jogo rules, the worlds' tracks (tracks.ts, written by scripts/music-analyze.mjs)`; `public/`: add
  `music/ (the worlds' tracks: <id>.m4a, tracks.json)`; `scripts/`: add `music-analyze.mjs (measure and encode the
  tracks), music-check.mjs and music-online.mjs (the deck against the clock; two players, one bar)`.
- Under "Run it", the flags: `?procedural` (the generative groove instead of the worlds' tracks).
- In "The contracts": `Music` (`bend.music`): each world's track is the music (docs/extending/sound.md section 5):
  `engine.track`, `trackPlace(t)`, `deck.stats()`; the clock's beat 0 is the track's bar 1; a room's tempo is its
  world's track's (`shared/rules.ts tempoOf`, `retempo` on a seat's travel); a film's `"audio": { "track": "<world>" }`
  (docs/extending/film.md).
- A new line under "Rules" or the run notes: the track files are measured, never edited by hand: change a track with
  `node scripts/music-analyze.mjs --only <id> --clicks` (the downloads stay outside the repository; their Suno ids in
  `docs/music/suno/chosen.txt`), then `node scripts/music-check.mjs --worlds <world>` against a running film-serve.
