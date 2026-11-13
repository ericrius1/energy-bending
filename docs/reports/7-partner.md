# Wave 6, task 7: the partner plays capoeira

The partner brain (`src/ai/`) rebuilt around the ginga: the pair circles the centre it shares, attacks grow out of the
ginga's back step on the beat, answers go under or round the attack and come up into a counter in the same motion
(named exchanges), inversions are how it travels and changes sides, echoes are seasoning, and a director can shape a
take from a film timeline without replacing the brain. The ring claps together on the beat, cheers a good exchange and
one of them can buy the game.

Branch: `worktree-agent-a6b5e800c71beb6cf` (commits on it; not pushed or merged).

**Measured:** `npm run typecheck`, `npm run build`, `npm test` (all of it: limits, bindings, every TS test file with the
brains' 16 checks, audio, gates, the net tests) clean, except that the net's wall-clock smoothness check ("B: tracks
the source in real time") failed once on the final full run (rms 0.038) and passed when run again alone, as in every
earlier report (code I did not touch). Simulated play in Node (three seeded three-minute sessions locked
on the geode's stage and three free, plus scripted "humans"). Contact sheets at 5 fps on the RTX 5090 from a production
build served by `vite preview` on port 5457, one take per `critic-cap.mjs` run, each holding the shared render lock
about 20 s (most of the wall time was waiting for other projects' holds).
**Not measured:** a person playing it (nobody can play it for me: see the checklist at the end), anything by ear, the
music's live levels (the captures hold the level at 0.6: the "flow" mood throughout, never calm, peak or a breakdown),
a phone, the network.

## What changed in how the partner plays

1. **Circling** (`src/ai/ginga.ts`). In the free view the pair turns about its shared centre. Each dancer steps to its
   own right or left (the same for both brains, because the sense comes from the shared music clock: `circleSense`,
   which turns back three phrases in ten, every 16 bars). Each gives half the turn, plus whatever the other isn't
   giving, so it circles a person who stands still. The distance breathes with the ginga, nearest on the bar's strong
   beat. The pair drifts back toward the roda's middle and never leaves the world. Speeds stay under 0.6 m/s, so the
   body keeps facing the other. Free dodges go round the attack, to the side the pair is turning (a sideways rolê, a
   diagonal aú). While holding merge the two keep turning slowly. Locked, sides change by going over or through each
   other (aú, rolê, a queda de rins once it exists), never by walking past.
2. **Flow from the ginga** (`partner.ts`, `vocabulary.ts`). The step-in shuffle is gone. An opening attack is placed
   on the next ginga back step for its kicking leg: the left leg is back on beat 0 (armada), the right on beat 2
   (meia-lua, martelo, bênção, rasteira). The breath comes in to arrive just before that beat and plants for the last
   8th, so the kick doesn't slide. Openings take turns a bar at a time (seat 0 the even bars, seat 1 the odd; half a
   bar at the peak). Answers chain into counters through six **named exchanges**:
   - meia-lua → esquiva → rasteira
   - armada → cocorinha → meia-lua de compasso
   - martelo → held block → bênção
   - bênção → rolê → armada
   - rasteira → aú → meia-lua
   - strike → esquiva → rasteira

   A counter comes out of the answer's recovery on an 8th. It only comes once the attacker has finished and had a
   person's moment to see it. The other then answers it in turn, so exchanges run two to four moves. Feints: esquiva
   into martelo, spin into armada, block into bênção. A fast kick comes only behind a telegraph (a block or an esquiva
   a beat before), and the reader takes that lead as a cue.
3. **Inversions and levels.** Three levels are counted: standing, low (esquiva, rasteira, rolê, cocorinha, negativa,
   compasso) and inverted (aú, macaco, queda de rins). A turn may be taken by inverting: travelling round the circle,
   or over the other to change sides. Fills, keep-talking moves and answers lean on aú, rolê and macaco. The ginga can
   sink toward the cocorinha (`BodyHints.low`, the ginga baixa, in the Roda and calm moods). The four missing moves
   are used as soon as they are registered (requests below; a test with stand-ins confirms all four get danced).
4. **Timing with life.** Echoes now come after a varied 1½ to 3½ beats. Some are mirrored, some lower, some answered
   with the move's counter (those last two earn no echo). Reactions are log-normal about the median with lapses
   (median 0.22 s, 90th percentile 0.30 s, 99th 0.45 s). A lead move and an attack on a strong beat are anticipated.
   A finished exchange may end in a pause that holds a look for a bar. Offers are read against where the other will be
   (their velocity through the wind-up, at most 0.5 m). Planning takes in the body's own sliding speed, which fixed
   invitations that used to land. Other moves stay off the strong beats when the two are close (`offBeat`). Most
   importantly, a brain reads the other's body directly, so two players no longer start attacks on the same frame.
5. **Music** (`moodOf`, `MOOD`).
   - `still` (breakdown): the cocorinha, answers only.
   - `calm` and `roda` (the Roda mood): close (1.4 to 1.5 m), low, slow circling, low answers.
   - `flow`: the default.
   - `peak`: closer, faster circling, standing and inverted answers, flurries, half-bar turns.
   - From a tension of 60, both close in and circle faster toward the merge, and patterns and unisons rise.

   `MusicView.mood` carries the mood's name. The brains' demos fill it in; src/play does not yet (requested below).
6. **The roda** (`npc.ts`, `clips.ts`).
   - Ring dancers face the pair and sway.
   - They clap together on the beat, four bars in six. The bar count is shared and each decides per stretch whether to
     join. `palmas` is now a big swing that meets at the face exactly on the beat.
   - `BodyHints.clapAt` gives the moment the hands meet, so the matter can light them (requested).
   - They cheer a dodge under an attack, a unison or a fusion with a jump, a flourish or a double clap.
   - One of them can buy the game: `NpcBrain.buy([x, z])`, `release()`, and `bend.roda.buy(k, seat)` in the page. It
     is exposed but not wired into src/play.
   - The `?roda` demo's ring now wears its own gems (it wore the second seat's dress).
7. **Direction from a timeline** (`direct.ts`, `Sight.direction`, `Scene.direct(id, dir)`): format below and in
   `docs/extending/brain.md`. Seeded determinism holds: the tests replay the same seeds frame for frame.

## The numbers, before and after

Node, 60 fps, a virtual clock at 112 bpm, the music swelling between calm and the peak with a breakdown. Three
seeded three-minute sessions, two playful partners each. Run with `node scripts/steps/brains-sim.mjs measure 180`;
the same checks are asserted in `npm test`. "Circled" counts only the smooth turning of two bodies apart: one
passing over the other flips the line between them, and that is counted as a side change.

| session | fusions | dodge / clash / parry / near / hit | tension from exchanges (xch / echo / unison) | on the 8ths | kinds | inversions /min | standing / low / inverted | circled in the least 30 s | sides changed | longest stall |
|---|---|---|---|---|---|---|---|---|---|---|
| **before** locked 11 | 2 | 9 / 2 / 0 / 0 / 0 | 29 % (106 / 234 / 24) | 92 % | 10/9 | 18.1 | 45 / 17 / 53 | — | 17 | 5.6 s |
| **before** locked 12 | 3 | 11 / 0 / 0 / 4 / 2 | 29 % (130 / 276 / 36) | 90 % | 12/11 | 20.5 | 56 / 19 / 60 | — | 25 | 7.0 s |
| **before** locked 13 | 3 | 15 / 0 / 0 / 2 / 0 | 37 % (158 / 228 / 36) | 91 % | 12/11 | 18.8 | 60 / 27 / 55 | — | 21 | 4.5 s |
| **before** free 11 | 3 | 13 / 0 / 1 / 1 / 0 | 33 % (142 / 240 / 48) | 95 % | 11/10 | 14.7 | 55 / 26 / 43 | 0° | 23 | 6.4 s |
| **before** free 12 | 3 | 11 / 2 / 1 / 2 / 0 | 32 % (142 / 234 / 72) | 92 % | 11/12 | 12.6 | 67 / 17 / 37 | 0° | 16 | 4.8 s |
| **before** free 13 | 2 | 6 / 0 / 1 / 2 / 3 | 26 % (82 / 156 / 72) | 94 % | 11/11 | 13.0 | 48 / 32 / 38 | 0° | 25 | 4.6 s |
| **after** locked 11 | 3 | 18 / 2 / 0 / 6 / 0 | 53 % (220 / 126 / 72) | 92 % | 11/11 | 13.3 | 56 / 34 / 39 | — | 21 | 5.1 s |
| **after** locked 12 | 3 | 14 / 0 / 4 / 9 / 2 | 52 % (212 / 144 / 48) | 90 % | 12/13 | 13.0 | 64 / 29 / 38 | — | 14 | 5.3 s |
| **after** locked 13 | 2 | 16 / 0 / 2 / 8 / 6 | 60 % (220 / 120 / 24) | 90 % | 12/13 | 10.9 | 54 / 29 / 32 | — | 21 | 7.5 s |
| **after** free 11 | 3 | 18 / 0 / 0 / 7 / 1 | 51 % (210 / 180 / 24) | 93 % | 11/11 | 11.6 | 52 / 48 / 34 | 205° (2183° in all) | 7 | 5.1 s |
| **after** free 12 | 2 | 16 / 0 / 3 / 3 / 2 | 57 % (200 / 126 / 24) | 93 % | 11/11 | 9.6 | 49 / 48 / 28 | 353° (2629°) | 13 | 5.1 s |
| **after** free 13 | 2 | 11 / 0 / 1 / 5 / 1 | 47 % (140 / 132 / 24) | 97 % | 11/11 | 10.6 | 61 / 24 / 31 | 233° (2505°) | 3 | 5.9 s |

Nobody left the stage or the world in any session, before or after (0 frames).

**The split:** tension from exchanges rose from 26 to 37 % to 47 to 60 %. The rest is echoes (about 30 %) and unisons
(5 to 15 %). Exchanges are now the larger part, though in one session (free 13) not by much: echoes are seasoning, but
generous seasoning.

**Against scripted "humans"** (free, 120 s):
- Only attacks (one every two beats): before, dodge 60 / parry 8 / clash 2 / near 15 / hit 14. After, dodge 48 /
  parry 7 / near 10 / hit 23.
- Stands still: before, near 9 / hit 2. After, near 4 / hit 0.
- Presses a move every 1.6 s without walking (the films' stand-in, new): dodge 22 / parry 2 / near 4 / hit 11. It
  circled only 41° in its weakest 30 s.
- Repeats a spin each bar: 8 unisons joined.

**What got worse, honestly:**
- **Hits rose.** They went from 0 to 3 to 0 to 6 per session between two partners, and against the relentless attacker
  from 14 to 23. The jogo has about twice as many real attacks now. Offers aim at where the other will be. Counters
  come quickly. Most of the hits I traced are the skill model's misreads, deliberately left in (playful skill went
  0.8 → 0.88 to compensate).
- **Inversions went down** in partner-against-partner: about 11 to 13 per minute, against 13 to 20 before. Before,
  the inversions came mostly from echoes (aú echoing aú). Against a person they are now offered as travel and side
  changes rather than echoed back. This is not "far more often" by the counter; the sheets show three or more in
  every 30 s take.
- **Clashes are still rare**: 0 to 2 a session.

## What the sheets show (5 fps, `docs/reports/media/7-p7-*`)

Takes are in `scripts/steps/partner7.json`, generated by `partner7-gen.mjs`. They were run against a production
build on port 5457 with `node scripts/critic-cap.mjs scripts/steps/partner7.json --only <take> --prefix 7 --shots shots/partner7 --url http://127.0.0.1:5457/energybending/`.
Every run held the lock 13 to 20 s after waiting for it. The level is held at 0.6 (flow) throughout. Each take also
logged the two seats' positions once a second into the run's warnings, and the pair's angle below is read from them.

| sheet | what it shows | capoeira or machinery? |
|---|---|---|
| `7-p7-redwoods-roda-sheet.jpg` (two partners free, `?roda`, a high still camera, 30 s) | The pair turns steadily clockwise: from 49° at 15 s to −170° at 28 s, **219° in 13 s**, plus a turn before it. There is an aú with a spray of water (frames 4 and 14), a rolê at 5 s and a macaco at 28 s, so **at least three inversions in 30 s**. The ring now in its own colours (pink, green, gold) stands round them at about 3.8 m apart. | Reads as two players going round each other, which it never did before. Weak: from this height at dusk the bodies are small; the fire is often hidden behind the water in frame; a lantern drifts across mid-take. |
| `7-p7-redwoods-free-sheet.jpg` (the game's jogo, `&free`, seat 0 pressed by a script, 30 s) | The water partner goes round the stationary fire dancer by about 66° in 7 s at a time, broken by aú crossings. It dodges low and answers. | Partly. The person here never walks, so only the partner circles. **It drifts into the redwoods' fallen log** (`7-p7-redwoods-free-16.jpg`, its legs inside it): brains don't know a world's solids. The follow camera behind seat 0 keeps putting the water body in front of the fire. |
| `7-p7-redwoods-lock-sheet.jpg` (locked, 30 s) | A conversation from the side. The partner slips under kicks, changes sides through the other (row 2), throws an aú, and keeps its distance with a lower ginga. A green ring dancer jumps with arms up at the end, the cheer. | The best take for the game screen, and the closest to capoeira. Weak: the scripted fire dancer stands at the frame's left edge by the log. |
| `7-p7-temple-lock-sheet.jpg` (locked, 30 s) | The scripted fire dancer hops onto a column stub and plays from up there for a third of the take while the partner plays low below. A column crosses the dancers later. | The same faults the critic found: ledges and occluders belong to the temple and camera tasks. The partner's play itself is low and answering. |
| `7-p7-roda-game-sheet.jpg` (`jogo=partner`, geode, the game's roda, 16 s) | The ice partner low under a plasma aú, the clash rings on the floor. The ring is placed (nearest two 3.7 to 4.0 m apart) and clapping in sync: two of them met their hands at the same instant, 8.20 s. | **From the game camera's distance the ring barely reads**: one gold figure on a shelf at the left edge. The clap's bigger gesture can't be judged at this size, and the hands aren't lit yet (requested). |
| `7-p7-direct-sheet.jpg` (the partner directed, 20 s) | The page applies the timeline without an error. The partner travels round the still fire dancer to the camera's side and inverts twice. | The armada on 3.1 could not be confirmed from a once-a-second log or 5 fps frames. The cues are verified frame-exact only in Node (the direction test). |

**Would a capoeirista recognise it?**
- In the locked view, and with two brains in the free view: yes, as a jogo. They circle (free), go under and come up,
  invert to travel, and take turns.
- Where it still reads as machinery: both bodies drop into the same low crouch often. The phrases are regular (a turn
  a bar). The partner circling a person who only presses buttons looks like it orbits a statue. Nothing in the bodies
  is malícia (the cheek, the hand held out, the ginga that teases). The flourishes are dance clips, not capoeira.

## Move requests for src/dancer (the brains use these the moment they exist)

Register each under exactly this name, and add it to `RULES.moves` in `shared/rules.ts` so it scores (that file is
the net/play owner's). A test registers stand-ins under these names and confirms all four get danced.

| name | kind | what it should be | data |
|---|---|---|---|
| `negativa` | evade (low) | Drop to the floor on one side: one hand and the opposite foot down, the other leg stretched out low along the floor, the head turned away from the kick, then back up into the ginga. Reachable as dodge + stick down + toward (or by name). | about 0.8 s at 112 bpm, `evade: true`, iframes about [0.1, 0.7], `cancelInto: ['rasteira', 'compasso', 'au', 'role', 'esquiva', 'jump']`, hands `['floor', 'open']`. Procedural: a rig track like the esquiva's but with the hip at about 0.08 FU. |
| `cocorinha` | evade (low) | The squat on the balls of the feet, knees open, one forearm guarding the head (`LOCO.crouch`'s pose as a move), a beat long. | 0.6 s, `evade: true`, iframes [0.05, 0.9], `cancelInto: ['compasso', 'rasteira', 'meia-lua', 'au', 'esquiva', 'jump']`. Trivial from `LOCO.crouch`. |
| `compasso` (meia-lua de compasso) | attack (low, turning) | From a low step the body turns its back, both hands go to the floor, and the heel of the straight back leg sweeps a full circle at head height. | about 1.1 s, `active` about [0.45, 0.75], `hit: { a: 'RK', b: 'RA', r: R(0.07) }` (or the left leg to match the armada's back step on beat 0), `cancelInto` like the armada's, hands `['floor', 'floor']` through the active window. The armada's track with the torso pitched to the floor. The "breaking" or "jete" CMU stretches are a weak alternative; the procedural move will read better. |
| `queda-de-rins` | evade / inversion | One elbow tucked into the hip, the head and that hand on the floor, the body tilted and balanced sideways with the legs in the air, then back down. Used to change sides and to travel. | about 1.2 s, `evade: true`, `travel: { z: 0.4 FU }`, iframes [0.2, 0.8], `cancelInto: ['compasso', 'meia-lua', 'au', 'jump']`. Procedural (no CMU clip has it). |

## Requests for others

- **src/play**:
  - `AiPartnerCtx.music()` should pass `mood: music.engine.mood.name` and a real `breakdown` (today it always sends
    `breakdown: false` and no mood), so the partner plays the Roda mood in the temple and stillness in a breakdown.
  - Expose `bend.jogo.partner.direct(dir)` (today a film reaches it through `bend.jogo.partner.scene.direct('seat.1', dir)`).
  - Optionally use `bend.roda.buy(k, seat)` to let a ring dancer buy the game between sessions, and seat it.
- **Matter (gems)**: light a ring dancer's hands on its clap. `BodyHints.clapAt` is the dance time the hands met (on
  the brain's `body`), and the clap is `palmas` on the body's move.
- **Worlds / camera**: brains need to know the world's solids (the redwoods' log, the temple's columns). A
  `World.clear(a, b)`-like query on the Sight would let the free jogo keep off them. Today the free pair drifts into
  the log.

## The direction-from-timeline format

Cues live on the brain's input (`Sight.direction`) and are set per dancer on the brains' Scene:

```ts
scene.direct('seat.1', { origin: 64, cues: [
  { at: '1.1', bars: 2, circle: 'left' },      // circle to its own left for two bars
  { at: '3.1', offer: 'armada' },              // offer an armada on bar 3, beat 1
  { at: '3.1', bars: 2, answer: 'low' },       // answer low meanwhile
  { at: '5.1', bars: 1, pause: true },         // hold a look
  { at: '6.1', move: 'au' },                   // any move on a line
  { at: '7.1', side: 'change' },               // change sides
  { at: 32, bars: 4, level: 'low', mood: 'calm', distance: 1.3 },
] });
```

| field | meaning |
|---|---|
| `at` | `"bar.beat"` counted from 1 (`"3.2+"` means the 8th after), or beats from `origin` (which defaults to the beat it is first seen) |
| `bars` / `beats` | how long it lasts |
| `circle` | `left` / `right` / `still` |
| `offer` | an attack |
| `move` | any registered move |
| `answer` | `low` / `inverted` / `standing` / `clash` / `none` |
| `level` | `standing` / `low` / `inverted` |
| `pause` | hold a look |
| `distance` | the ginga's distance (m) |
| `side` | `change` |
| `mood` | `still` / `calm` / `flow` / `peak` |

The brain still answers, stays generous and keeps the music. A cue that can't be honoured where the dancers stand is
done as near its moment as possible, or let go.

Where to set it:
- In Node: `simulate({ directions })`.
- In the game: `bend.jogo.partner.scene.direct('seat.1', …)`.
- In the brains' demos: `brains.scene.direct(…)`, or `bend.roda.direct(id, …)`.

Tested: with the cues above the partner stepped 0.37 m to its left in the two bars, threw the armada on beat 23.99
(cue: 24), started nothing of its own in the pause bar, and threw an aú on beat 36.00 (cue: 36).

## The owner's five-minute checklist (nobody has played it: this is for a person with a pad or keyboard)

Open `?jogo=partner&world=redwoods&free` (free view), then the same without `&free` (locked); `&world=temple` for
the Roda mood. Keys: A/D (and W/S free) move, J strike, K kick, L spin/aú, Shift dodge, F merge. A pad: stick, X/B/Y/RT.

1. **Stand still for 30 s.** It should go round you (at least half a turn), breathing in and out on the bar. It
   should throw kicks that pass just short of you (invitations, never a hit) and cartwheel or roll past now and then.
   It should never stand square and still for more than about 8 s.
2. **Ginga yourself, without pressing anything, for a bar or two, then start answering.** When you dodge one of its
   kicks, the next ones should start touching (it now "trusts" you to answer). Each kick should come on a strong beat,
   out of its step, not after a shuffle.
3. **Kick it on the beat** (K, meia-lua). It should duck under (esquiva) and, about a beat and a half later, sweep at
   your legs (rasteira). Dodge that (Shift + down) and you have made an exchange: the tension bar should jump.
4. **Throw an armada** (K + away). Expect a low answer, then a turning kick back. **Throw a martelo** (K + up): expect
   a held guard, then a push kick (bênção).
5. **Watch for its telegraphs.** Before a fast kick it raises its guard or dips a beat early. You should be able to
   dodge its martelo when you watch for that.
6. **Attack relentlessly for 20 s.** It should mostly dodge, sometimes get hit, and never freeze in place.
7. **Let the tension fill.** As it climbs past about 60 it should come closer and circle faster; at full tension it
   walks in and holds merge. Hold F with it.
8. **In the temple** (Roda mood, once src/play passes the mood): lower, closer, slower, more floor play.
9. **Look at the ring behind**: clapping together on the beat, turning toward you, cheering when you slip under a kick.
10. **Judge:** does it feel like being played with or like a machine? Note when it was dull (both standing), when it
    hit you without warning, when it walked away, and when it crouched too much.

## The critique's "Done when", item by item

- **"30 s at 5 fps in the redwoods free view shows the pair circling through at least 180° and three inversions":**
  **met with two brains** (`7-p7-redwoods-roda-sheet.jpg`: 219° in 13 s; aú, rolê, aú, macaco). **Not met** against
  the button-pressing stand-in person in the game's free jogo (`7-p7-redwoods-free-sheet.jpg`: under 180° of smooth
  turning in 30 s, broken by crossings, and it walks into the log).
- **"A person has played it for five minutes (reported in their words)": not met.** Nobody can play it for me. The
  checklist above is for the owner.
- Task 7's list:
  - Circling: met in Node and in the brains' page demo.
  - Inversions offered more often: met against a person (travel and side changes). Between two brains the count went
    down from the old echo-driven figure.
  - Echoes on varied delays: met.
  - The step-in shuffle replaced by the ginga's own step: met.
  - The ring claps and turns toward the pair: met (in sync on the beat), but small at the game camera's distance.

## Weak points

- Hits rose (above). The skill model's misreads make a partner-against-partner jogo land a kick or two a minute.
- Brains don't know the world's solids: the free pair can walk into the redwoods' log.
- Against a person who presses moves and never walks, the partner circles little, because it is busy answering.
- The ginga baixa is a 35 % blend toward the cocorinha pose: it reads as "lower", not as Angola's ginga.
- The brains do not hear the music in captures (level held at 0.6). The calm, Roda, peak and breakdown moods were
  measured only in Node.
- The roda at the game camera's distance is a few small figures. The clap's size and the cheer read in the redwoods'
  locked view, not in the geode's.
- Tuning is sensitive: the free fusions are 2 to 3 per session and the least-30-s circling (205° to 353°) is near its
  180° bar in one seed.

## Edits outside src/ai

- `docs/extending/brain.md`: the new modules, the contract's new fields, the partner's jogo, the direction format,
  the roda.
- `scripts/steps/partner7-gen.mjs` and `partner7.json`: my step files.
- `docs/reports/7-partner.md` (this report) and `docs/reports/media/7-*.jpg`.

Nothing in `src/dancer`, `src/play`, `shared/` or anyone else's folder was edited. Stand-in moves are registered only
inside a test.

## Commits

On `worktree-agent-a6b5e800c71beb6cf` (`git log d070f8d..`), not pushed or merged.
