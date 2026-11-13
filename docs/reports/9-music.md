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

MEASUREMENTS

## Weak points

WEAK

## Not done

NOTDONE

## Proposed lines for AGENTS.md (I did not edit it)

AGENTS
