# Wave 7: the fusion as one body, the moves at film distance, the ring's claps

Items 3, 10 and the moves' half of 13 in `8-integration.md`'s "What is left". Branch
`worktree-agent-ab3268626a408019f`.

**Measured:** `npm run typecheck`; `npm test` (limits, the binding budget, 9 TS test files with the new
`src/play/test/fusion.test.ts`, audio, the gates' algebra, the net tests: see "Tests" for the run); every still
below captured on the RTX 5090 through headless Chrome (muted), one take per run of `scripts/critic-cap.mjs`, each
holding the shared render lock for its take only. The first fusion takes ran against a dev server on 5455; the rest
against a production build served by `vite preview` on 5456 (three takes of the first batch produced nothing, most
likely because I edited source while the dev server hot-reloaded their pages; they were re-shot on the build). Steps:
`scripts/steps/fm9-gen.mjs` → `fm9.json` (`--prefix 9-fm`; the files were shot as `9-…` and renamed `9-fm-…`). I looked at every sheet and still named here. **Not measured:** a person playing a fusion, an online
fusion (the start event carries the change, see below, but no two pages were run), a laptop or a phone, anything by
ear, the films re-rendered with these changes.

## 1. The fusion stays one body

**The decision taken (the owner's):** during a fusion only, the pull wins over a move's travel.

- `Character.env.still` (src/dancer/character.ts). While it is set, a move started plays where it starts: its travel
  direction is zero (the start event's `fdir` is `[0, 0]`) and it starts with no ground velocity (`vx`, `vz` 0; a move
  in the air keeps its vertical), so `Character.shapesAt` replays exactly what was danced (the network, the rules'
  judging and the brains' reading all go through the event). The stick still turns the body but does not walk it (the
  run target is 0 on the ground, no air steering, no water's carry): a goto or a held stick waits until the release.
  Jumps, knocks and staggers are unchanged.
- `Fusion.pull` (src/play/fusion.ts) sets `still` on both seats from two seconds before the bar line until the release
  (only while `jogoParams.fusionPull > 0`), and clears it otherwise. Before the landing the pull is the gentle draw it
  was (0.45 m/s each); from the landing it may close a gap at 1.2 m/s each (`PULL_HELD`): only a hit's knock can part
  the pair now, and it closes that within about half a second. Still never during a move (a move's root is the move's).
  The release knocks them apart as before.
- **The test** (`src/play/test/fusion.test.ts`, new): the Pool script with the critic's prism press, the real rules,
  two Characters on a flat stage and the jogo's own `Fusion`. Before the change the pair stood 0.28 m apart until the
  first macaco, then 3.04 m apart for the rest of the eight bars (the script's spins, then two macacos; the pull gave up
  past 3 m) and 3.84 m by the release. After: **0.28 m mean and 0.28 m at most** from a second after the landing to the
  release, through the spins and both macacos; 1.25 m apart after the release (the parting knock and the script's last
  gotos). `FUSION_VERBOSE=1 node scripts/test-ts.mjs fusion.test` prints the distance every tenth of a second.

**Seen** (the integration's takes re-shot: the Pool script with the form presses, 2 fps over 22 s; landing 3 s,
middle 9 s, release 19.5 s; `9-fm-fu-<kind>-<world>-sheet.jpg` and `-3`, `-9`, `-19p5`):

| | Pool | temple |
|---|---|---|
| steam | `9-fm-fu-steam-pool-*`: one white-gold column from the landing to the release, in every one of the 44 frames | `9-fm-fu-steam-temple-*`: one body, pale against the moonlit side |
| prism | `9-fm-fu-prism-pool-*`: one iridescent body, the helix round it | `9-fm-fu-prism-temple-*`: one body |
| storm | `9-fm-fu-storm-pool-*`: one violet body with its threads | `9-fm-fu-storm-temple-*`: one body |
| aurora | `9-fm-fu-aurora-pool-*`: one cyan-green body into violet curtains | `9-fm-fu-aurora-temple-*`: one body |

- `9-fm-ba-pool-mid.jpg`: the four kinds at 9 s in the Pool, Report 8's take above (two figures 1.4 m either side,
  joined by the helix's arch), this build's below (one figure). `9-fm-four-kinds.jpg`: the four at 9 s, Pool over
  temple.
- The probes logged at 3, 6, 7, 9, 12, 13 and 15 s read both roots 0.28 m apart (x −0.17 / −0.16 and 0.11 / 0.12)
  at every probe of the takes whose logs I kept (steam Pool and temple, prism Pool and temple, storm Pool); the other
  three were judged from their sheets.
- **Release:** each body's own matter back from the feet, fire and water a step apart (the knock), as before.

**Weak points:**
- In the temple the pair still stands behind the altar block (the script's places on the court; the stage agent's
  ledges), so the block hides the fused body's legs in every temple frame, and on the moonlit side every kind is faint
  (additive light on a bright backdrop), as Report 8 said.
- A move that travels now plays in place for eight bars: a macaco mid-fusion is a back handspring on the spot, two
  dancers 0.28 m apart flipping through each other's matter. It reads as one body doing it (that was the aim); it is
  not what the move would do outside a fusion. A player holding the stick during a fusion turns but does not walk:
  play is different there, by the owner's decision, and nobody has played it yet.
- The partner brain and the roda don't know about `still`: a brain that walks toward a spot during a fusion presses
  the stick for nothing until the release. Harmless, unseen.

## 2. A ring dancer's hands lit on its clap

- `Dancer.clapAt` (src/dancer/dancer.ts): when its hands last met (FrameCtx.t). The roda's PageBrains
  (src/ai/demo.ts, `claps(f)`, in the roda's input tick and `see`) sets it from the body itself: a `palmas` move past
  its meeting (`PALMAS_MEET`), once per clap (by the move's serial), so both kinds of clap light it, the ring keeping time on the beat (`BodyHints.clapAt`'s)
  and the cheers after a dodge (which never set `BodyHints.clapAt`). `bend.roda.npcs()` shows both (`clapAt` the
  brain's, `clapped` the body's).
- **No binding added:** the flash rides in the gems' `Sim` uniform, whose `caps` array (one vec4 per dancer × capsule)
  had its `w` free. `gems.ts` writes `exp(−since / clapFade)` there on the hands' capsules (1) and the forearms' (0.5)
  of a dancer that clapped in the last ~1 s; `draw.wgsl` reads it in the vertex stage for stones on the body
  (`homes[pid].place.x` is the slot), swells those stones up to 30 % and adds a warm white tinted by the stone's own
  crystal (`clapLight`, × `look.clap`, the Look struct's old pad); the floor's reflection gets half. `npm test`'s binding
  check passes with the gems' draw unchanged (5 / 7 uniform, 5 / 0 storage) and sim and cull still 7 of 8 storage.
  One more inter-stage variable in the gems' draw (13 of 16 locations).
- New params: `gems.clapGlow` 3, `gems.clapFade` 0.16 s (panel: "clap flash", "clap fade (s)").
- **Seen** (`clap-roda`: the jogo with its roda of four in the Pool, the lock let go so the follow camera stands back
  7 m over the pair and the ring, 20 fps for 6 s; the frames a clap lands on are logged by the take): one ring dancer
  (the one behind the pair) cheered with palmas 11 times in the 6 s. `9-fm-clap-close.jpg`: six frames round one clap
  (frames 36 to 41, 50 ms apart), cropped: the hands meet over its head and flash white, then part as two fading white
  points. `9-fm-clap-1p9.jpg` is the whole frame at the flash: at that distance it is a small white spark on a dim gem
  figure behind the pair, visible but not loud. `9-fm-clap-roda-sheet.jpg` (on) and `9-fm-clap-roda-off-sheet.jpg`
  (`clapGlow` 0): the A/B is **not frame-exact** (the jogo's play differs between runs, so the camera and the dancers
  are elsewhere by then); in the off run the same dancer's hands meet with no flash (`9-fm-clap-off-1p95.jpg`).
- **Weak points:** in 6 s only one of the four ring dancers clapped (the cheers after a dodge; the ring's on-beat
  stretches came in other takes: the geode jogo's log had three dancers clapping at once at 8.8 s). In the jogo's own
  locked view the ring stands outside the frame in the Pool and the geode (the stage's 18° lens frames the pair), so
  the flash is for the free camera, the films and the redwoods' and temple's wider locks; not seen in those. The
  flash's colour leans white for every suite (40 % of the stone's own hue); on a pale suite it is a brightening more
  than a colour.

## 3. The new moves at film distance

- **Queda de rins** (src/dancer/moves.ts) rewritten as the balanced side-handstand. It was the body tipped 72° sideways
  (`rotZ`) about a point near the floor with the legs tucked under: from the side (where a locked or film camera sees a
  jogo) a low crumpled tuck, the head at 0.47 m, hips 0.33, ankles 0.08 / 0.49. Now the body first turns its left side
  to the way it goes (a quarter turn), then tips past level about the hips (`rotX` 2.05 rad) so the figure the side
  camera sees is the whole balance: both hands on the floor ahead (the left elbow bent back into the hip, the right a
  hand's width further on), the head low (0.42 m), the hips up on the elbow (0.66), the legs bent together and raised
  high behind (ankles 0.95 / 1.27 m), opening a little through the hold. Same duration, travel, iframes and cancels.
- **The bow** rewritten from a 35° lean (the head at 1.09 m) to a deep bow from the hips: the torso near level (pitch
  1.2–1.25), the hips back over the heels, the legs straight, the head tucked (0.73–0.81 m), the right hand to the belly
  and the left arm swept out and back. Same timing (2.4 s: in, held from 0.42 to 0.68, up).
- Negativa, cocorinha and compasso unchanged.
- I drew each pose as a stick figure from the front and the side in Node before rendering (a throwaway script, not
  committed), then rendered.

**Seen** (two gem dancers 2.4 m apart in the Pool, the integration's cues: negativa / cocorinha at 0.3 s, compasso /
queda de rins at 1.8, cocorinha / negativa at 3.6, both bow at 4.6; 10 fps; the queda's hold at 2.6 s, the bow's at
5.6 s):

| take | file | reads |
|---|---|---|
| square-on, 6 m | `9-fm-moves-6m-sheet.jpg`, `-2p6`, `-5p6` | queda: the body tipped head-down on its arm, legs raised high behind it, a diagonal balance, not a tuck. The bow: both bent deep at the hips, heads down, plainly a bow |
| square-on, 9 m | `9-fm-moves-9m-sheet.jpg`, `-2p6`, `-5p6` | the same, small: the queda is still a figure upside down on its hands with the legs up; the bow still a bow |
| three-quarter, 6 m | `9-fm-moves-6m-34-sheet.jpg`, `-2p6`, `-5p6` | queda: one arm to the floor, the legs out and up to the side: the clearest side-handstand of the set; the bow reads |
| fire and water, temple, 8 m | `9-fm-moves-fw-temple-8m-sheet.jpg`, `-2p6`, `-5p6` | water's queda reads (legs up); water's bow reads as a bow; **fire's bow does not** (a flame bent over is a flame) |
| before / after, the geode at the integration's distance | `9-fm-ba-queda.jpg`, `9-fm-ba-bow.jpg` (Report 8's still left, this build's right) | the bow from a crouched lean to a bow; the queda from an upright figure with a leg up to one upside down |

Negativa, cocorinha and compasso, unchanged, still read on all four sheets (negativa low on one hand with a leg out,
cocorinha a squat, compasso hands down with the heel swinging high).

**Weak points:** the cues have both dancers travel toward each other (compasso and queda), so at 2.6 s the two
overlap at 6 and 9 m and the queda is read against the other body; a film should part them. From straight in front
(the dancer facing the camera) the queda is now a narrow upright column (the balance is in the side plane): the side
and three-quarter views are the ones it was made for. The geode's sheets (`9-fm-moves-geode-*`) were meant to be 6 and
9 m but the geode's room shortens the follow camera's boom to about 4.5 m, so they are the integration's distance;
the Pool ones are the film-distance takes.

## Tests

- `npm run typecheck`: clean.
- `npm test`: limits agree (14 caps), bindings within the baseline (137 entry points), **9 of 9** TS test files (the
  brains' 17, the character's 28, the jogo's 16, the scripts' 3, the new fusion test's 3, the rest as before), audio,
  the gates' algebra, the net tests: all pass but the net's real-time smoothness test (`B: tracks the source in real
  time`), which failed once while other agents' captures held the GPU and CPU, and passed run alone
  (`node test/smoothness.test.ts`: 12 of 12). **The brains' seeded tests did not change** with the moves rewritten
  (the queda's and the bow's timings, travel and windows are as they were); nothing was refitted.

## Files touched outside my area

- `src/dancer/character.ts` (the dancer's body physics: `env.still`, four lines in the move start and the physics) and
  `src/dancer/dancer.ts` (`clapAt`): shared files, small additions; anyone who replaces `Character.env` wholesale (the
  character test does) loses `still` for that frame, which is the intent.
- `src/ai/demo.ts` (the roda's clap, one field in `bend.roda.npcs()`).
- Nothing in filmcam, films/*.json, water, the field, post, portals or the stage files.

## Not done

- The films were not re-rendered: film 1 and film 2 keep their pairs close and give no travelling move during a fusion,
  so they should not change, but a director who now cues a macaco mid-fusion gets it in place.
- An online fusion (two pages) was not run. The change is carried by the start event (its `fdir` and velocity), so the
  other page and the room replay the same in-place move; the protocol already accepts a `[0, 0]` fdir.
- The fused pair's place on the temple's court (behind the altar block) is the script's and the stage's, not changed.

## Proposed lines for AGENTS.md

- Under the contracts, after `Controller`: "`Character.env.still` (a fusion holds the pair as one body: a move plays
  where it starts, the stick turns without walking; play/fusion.ts sets it from two seconds before the bar line to the
  release)."
- In the binding-budget paragraph: "The gems' `Sim.caps` w is a clap's flash on the hands (Dancer.clapAt); caps' xyzw
  are all used now."
