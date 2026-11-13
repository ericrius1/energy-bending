# Report 9: the films' tooling and timelines

Branch `worktree-agent-a648819b41d203241`, not pushed or merged into master (master at `7d74dc7`, the wave 7
merges so far, is merged into it). Items 1, 2 and the films' half of 13 in `8-integration.md`'s "What is left", plus
the tooling they needed.

**Measured** (RTX 5090, headless Chrome through `scripts/film-serve.mjs` on 5452, the sink on 5453, every take under
the shared render lock): both films rendered whole with `--preview` and their scores after the second merge of master, and
about a dozen `--no-score` previews of single shots before it while working; I looked at every contact sheet named
here and at extra frame grids cut from the previews (the release, the bow, film 1's opening, the fusion's end). Each
page now logs once a second where the seats stand and how far the film camera's eye is from the nearest body (a bone
or the fusion's column, its radius taken off); the distances below are from those logs, so **sampled once a second,
not every frame**. `npm run typecheck`, `npm test` (see the end). **Not measured:** anything by ear (the scores were
rendered and their levels read with `volumedetect`, nobody listened), the master quality, a second run for
determinism after the merge, any other machine.

## The tooling

| what | where | how |
|---|---|---|
| **The film camera keeps clear of the bodies** | `src/engine/filmcam.ts` (`near`, `clearOfBodies`, `Capsule`), `film-shot.ts` (`scene.bodies`) | Each frame the shot hands the camera capsules: each dancer's eleven bones (hips to chest to head, the arms, the legs; 0.15 m radius) and, while a fusion is on (`field.fusionFront.amount` > 0.05), its column from the field's helix (from the pair's floor to the helix's top × 1.4, aurora's × 2.2 with a cap 3 m higher and 1.2 m wider, because its flames rise far; radius the helix's + 0.35). The eye is pushed out to `near` metres (a key scalar, default 1.2, 0 lets it in) from every one it is inside, **on the side the camera came from** (so a body crossing the boom is gone round, not flipped through), lets go at 1.2/s when it is no longer needed and moves at most 3 m/s, so a passing body turns the camera aside instead of jerking it. A world's solid that shortens the boom (`rig.clearance`) now shortens it only as far as the bodies' clearance (film 1's fusion orbit went behind the fallen log and the boom came in to 0.9 m: inside the aurora). Four tests in `src/engine/filmcam.test.ts`: pushed to exactly `near`, a clear eye untouched, two bodies either side settle clear, an orbit swept straight through a dancer never comes within 0.8 m and never moves more than 0.12 m in a frame, a solid two thirds out stops the boom at the column's clearance |
| **A timeline that sets forms owns them** | `src/play/partner.ts` (`AiPartner.formHeld`), `film-shot.ts` | The seam is the adapter: `AiPartner.think` drops the brain's own `form` press while `formHeld` is set (any brain seated through it, its lessons too). `film-shot.ts` sets it for the whole shot when any cue has a `form`. Seen working in `9-films-film2-brain-steam-sheet.jpg`: film 2 with the calm partner still cast, forms set to 0 at 13.1, and the fusion steam (white-gold), where Report 8's run made prism |
| **A hold before the jogo's intro** | `src/play/index.ts` (`&hold=S`, a bare `&hold` waits for `bend.jogo.start()`), `scripts/film.mjs` (a shot's `"hold"`) | A script's room starts S seconds of stepped time after the first frame instead of at once; until then nobody calls `app.wake()`, so the dancers lie asleep in their heaps. A `wake` cue may wake them earlier (film 1: the gems' comet), a `dress` cue changes a seat before the intro. Seven lines |
| A place given as `[x, z]` is the film's own in a jogo | `film-shot.ts` | `bend.place` (a number is still the script's s on the stage); a cue at -9 or earlier now fires on the first frame in a jogo's lead-in too (it never fired before the grid was known) |
| A free partner's home | `src/play/partner.ts` (`AiPartner.home`) | The middle a free partner's ginga drifts back to (the stage's middle otherwise: the altar, in the temple) |
| `bend.jogo.field` | `src/play/index.ts` | The field, for the fusion's column |
| `--no-score` | `scripts/film.mjs` | Pictures only: the offline score is the slow part (about 8× real time) |
| **A race fixed** | `scripts/film.mjs` | A shot rendered without its score ended on `/end`, and the page's `/done` that follows reached the *next* shot's sink, which ended before it began (seen: c-gate rendered nothing, d-hub took its frames). The sink now always ends a shot on `/done`. The same race was possible before on any re-render whose score was cached |
| The lock polled every second | `scripts/film.mjs` | At 5 s a poll the film lost every race for the lock for 20 minutes while other agents' captures ran; the takes themselves are unchanged (released between takes) |
| The progress log | `film-shot.ts` | `film: <shot> frame k/n … beat b seats x,y,z \| x,y,z eye x,y,z nearest body d m`, once a second of film |

## Film 2, second pass (`9-film-film2-temple-sheet.jpg`)

- **The open court.** The jogo is free (`"lock": false`) and both seats are placed before the intro at (-1.2, 0.3) and
  (1.2, 0.3): on the open flagstones 2.8 m in front of the altar, the altar, the stumps, the lintel and the great gate
  behind them, the moon between them in the lead shot. On the locked stage plane there is no 2.4 m of open floor
  (stumps at ±4.2 m, the altar ±1.2 m), and its spawns are the stumps' tops, which is why Report 8's fire stood on a stub.
- **The partner is scripted now (a change of cast).** Placed and directed (`pause`, `circle: still`, `distance: 2.4`,
  `home` at the pair's middle), the calm partner still walked 2 m upstage within two bars and stood behind the fire,
  hidden by it, for the whole lead shot. A probe of its mind (`films` probe, its winning leg claims logged each beat)
  shows only tiny ginga claims (k 0.01 to 0.07) while it moved 1.8 m in two seconds, so the travel is not its legs'
  claims; I think it is its groove's clip root motion, but did not trace it. Both seats are scripted: the water
  answers the armada with an esquiva and the aú, the meia-lua with an esquiva and its own meia-lua.
- **The camera's distance.** Outside the bow, the eye stands at least 4.2 m from the nearest bone (sampled once a
  second; the lead shot at 5 m on a 27° lens to keep Report 8's framing). The bow is meant close: 3.0 to 3.2 m,
  side-on, 30°.
- **Steam**, both forms set off at 13.1 (and the partner's presses held off while it was still cast).
- **The fusion's orbit** at 5.5 m and the column's clearance; pulled back to 7 m over the release (bar 22), whose burst
  of fire and water spreads a couple of metres for half a second.
- **The bow** staged side-on at 3.7 m; with the rewritten bow from master it reads as a bow (see below).

## Film 1 (`9-film-film1-ab-jogo-sheet.jpg`, `-c-gate-`, `-d-hub-`)

- **Rows 1 and 2, the new hold.** `"hold": 9`, seat 0 cast in gems: the crane down from the canopy finds the gems'
  cairn at the clearing's middle and the fire smouldering at its spawn; at 4.2 s they wake and the gems stream into
  seat 0 as a comet and stand up (`?play`'s re-form, in the redwoods); at 9.3 s, as the intro rises, seat 0 is dressed
  in water and the gems give way to water. The shot is 23 bars (was 18) so the play after the intro is as long as before.
- **The fusion's orbit.** Pitch 0.32 to 0.36 at 5.4 to 6 m (was 0.72 to 0.78 at 4.4 to 4.6, looking down into the
  aurora's plume), and turning the other way: a probe of the world's `clear` round the fused pair found every yaw clear
  at pitch 0.2 and 0.32 except 1.2 to 1.8 rad (the fallen log), which the old orbit (+0.08 rad/s from 0.4) entered in
  its last bars; that is where the boom shortened into the column and the full-screen cyan wash came from
  (`9-films-film1-before-orbit-sheet.jpg`, the last frame, from my first pass). It now turns at -0.06 rad/s.
- **c-gate**: placed 4.5 s before the in-point (2.5 s left the water still streaming in as a comet across the first
  frames), and 4 beats instead of 4½: the last 0.27 s showed an empty meadow, the free camera left in the redwoods
  after the pair went through.
- **d-hub** (plasma and ice): placed 4.5 s early for the same reason (an ice comet across the first frame); stood
  1.9 m apart (was 1.3) and the ice's aú replaced by an esquiva and a meia-lua: the aú carried it into the plasma
  dancer and they stood one inside the other for two bars; the closing two-shot at 3.4 to 3.1 m (was 2.9 to 2.6, both
  cut by the frame's edges).

## What changed in the films with master's merges

Master was merged twice (`684ae8e`: the fusion and moves, the field, the near fade and the gates' focus; `7d74dc7`:
the temple's lock, the stage dim, the forge), both without conflict, and both films rendered again after the second.
Compared by eye, sheet against sheet, with my last pre-merge takes (not frame-diffed):

- **The bow reads now** (master's rewritten bow): in film 2's bow both dancers fold at the waist toward each other,
  side-on (`9-films-film2-bow.jpg`); before, the water leaned and the fire only bent.
- **Film 2's places are the timeline's own**, so the temple's new floor spawns and the pillars moved to ±5 m don't
  move the pair (it is placed at ±1.2 m, 3.5 m in front of the stage plane); the free camera never comes near the
  pillars.
- **Film 1's lock section** (bars 8 to 13) frames about as before at this size; the bounded dodge is not visible in it.
- The fusion: film 2's pair stands 0.27 to 0.33 m apart through the eight bars (the log's roots), one steam body;
  film 1's one aurora body. Both were one body before too, because the timelines keep travelling moves out of them.
- The violet bars (Report 8, film 1 row 2) are not in the final take; they were not in my pre-merge takes either.
- The near fade and the gates' focus: no solid came near the film camera's eye in these takes, so I saw no fade.
- Scores: film 2 mean -12.8 dB, peak -3.4 dB; film 1 mean -12.5 dB, peak -0.9 dB (`volumedetect`; not listened to).

## The final previews, shot by shot

`docs/reports/media/film/film1-preview.mp4` (70.7 s) and `film2-preview.mp4` (77.3 s), git-ignored; sheets of 24
frames: `9-film-film2-temple-sheet.jpg`, `9-film-film1-ab-jogo-sheet.jpg`, `9-film-film1-c-gate-sheet.jpg`,
`9-film-film1-d-hub-sheet.jpg`; stills `9-films-film2-lead.jpg`, `-steam.jpg`, `-bow.jpg`, `9-films-film1-comet.jpg`,
`-aurora.jpg`. Checked against Report 8's tables:

| film, shot | Report 8's fault | now |
|---|---|---|
| 2, the dolly (rows 1) | fire on a column stub, water on the altar's ledge | both on the open court's flagstones, the moon between them and its road on the water |
| 2, rows 2, 8, 12 | the camera through a dancer (full-frame flame, white-out) | the eye ≥ 4.2 m from every bone outside the bow (sampled each second), the bow 2.9 to 3.2 m as meant |
| 2, rows 3 to 9 | the pair by the altar | the lead shot on the open court, side-on, the armada's flame over the water, the moon in the great gate (`9-films-film2-lead.jpg`) |
| 2, rows 13 to 19 | prism, not steam; the camera in the body; a narrow body against the altar | steam (`9-films-film2-steam.jpg`), the eye 4.4 to 6 m from the nearest bone or the column's edge, the altar 3 m behind |
| 2, rows 20 to 24 | the bow only a lean | side-on at 3.7 m, a bow (`9-films-film2-bow.jpg`) |
| 1, row 1 | no asleep heaps | the gems' cairn and the fire smouldering under the crane, the comet at 4.2 s (`9-films-film1-comet.jpg`) |
| 1, row 2 | violet bars | not seen |
| 1, row 4 | a full-screen cyan wash at the orbit's end | one aurora body to the last frame (`9-films-film1-aurora.jpg`), the eye 3.8 m from the nearest bone |
| 1, c-gate (first preview since Report 6) | — | the water's comet in the first frames and an empty meadow at the end, both gone |
| 1, d-hub (first since Report 6) | — | an ice comet in the first frame, the pair one inside the other for two bars, the closing two-shot cut by the edges: all gone |

Faults I still see: film 2's release (bar 22) bursts fire and water across a good part of the frame for half a second
even at 6 to 7 m; film 2's steam column is a tall, very white shape with little inside it reading; in film 1 the
intro's water rise is the hard-edged rectangular column (the water's rise, Report 8 item 5); film 1's crane passes
close under a bough at 2 s (a dark bar across the top of the frame, the canopy shot, meant); faint diagonal streaks
across the whole of some film 2 frames (the bow's still shows them), not traced.

## Weak points

- The film camera keeps clear of the dancers' **bones**, not of their matter: a flame or a splash reaches past
  `near` (the release's burst in film 2 spreads about 2 m in half a second). `near` per key is the handle.
- When the bodies' clearance and a solid disagree, the bodies win: the eye stays out of the column and may stand
  inside the solid instead. A timeline must keep the orbit off solids (film 1's orbit now does).
- The push is decided from where the camera was, so between two bodies with no room between them it can stay pushed
  against one; it never happened in these films.
- Film 2 no longer has src/ai's partner in it (above); `formHeld` is exercised by film 1's playful fire and was seen
  making steam only in my working take with the calm partner.
- The water's rise in film 1's intro (seat 0 changing from gems to water) is the same hard-edged rectangular column
  of white streaks as the front's first 0.3 s (the water agent's; Report 8 item 5).
- The steam fusion in film 2 is a tall, very white column at 5.5 m: one body, but little inside it reads.

## Not done

- No master renders (the integrator renders them after the wave merges). The scores were not listened to.
- The calm partner's drift upstage is not traced.

## Files touched outside the films' own

- `src/play/index.ts`: `&hold` (seven lines), `field` on `bend.jogo`.
- `src/play/partner.ts`: `AiPartner.formHeld`, `AiPartner.home` (and `homeStage`).
Nothing in `src/play/fusion.ts`, `src/dancer/moves.ts` or the other agents' folders.

## For AGENTS.md (I did not edit it)

- In "The contracts", the film tool line: "The film tool: docs/extending/film.md (timelines, takes, filmcam with
  `near`, the dancers' and a fusion's clearance; a shot's `hold`, `&hold=S`: the jogo's room S seconds late, the
  dancers asleep; `set: { jogo: { rings: 0 } }` hides the floor rings). A timeline with `form` cues holds the partner's
  own form presses off (`AiPartner.formHeld`)."
- In the debug flags: "`&hold=S` (a script's room starts S seconds late; bare: at `bend.jogo.start()`)".

## Tests

After the second merge of master: `npm run typecheck` clean; `npm test`: limits, the binding budget, 10 TS test files
(`src/engine/filmcam.test.ts` new, 4 tests), audio, the gates' checks, and the net tests, of which the real-time
smoothness test ("B: tracks the source in real time") failed once while the machine was busy and passed when
`npm run test:net` ran again alone (all 67 net tests).
