# Brains: the partner, free dancers, the teacher

Dancers that are not people, in `src/ai/`. Every brain produces an `Intent`, the same thing a keyboard or a gamepad
produces, and dances through the same `IntentController` body, move library, rules and network as a player: nothing
downstream can tell a brain from a person. Three brains are built from one small set of behaviours: the **partner**
(plays the jogo with a person, generously), **free dancers** (wander, dance mocap, watch, form a roda, go through
gates) and the **teacher** (call and response, getting harder).

Branch: `worktree-agent-ab7d89cf871efdb04` (commits on it, not pushed or merged).

Measured: `npm run typecheck` clean, `npm run build` clean, `npm test` all pass (the limits, 4 TS test files including
the brains' 11 checks, the audio tests, the gates, the net tests). One caveat: the network's real-time smoothness
check (`test/smoothness.test.ts`, "B: tracks the source in real time") failed twice while the machine was busy with
other agents' GPU captures and passed on the final run. It measures wall-clock timing in code I didn't touch.
Headless stills and short films on the RTX 5090 (see "What the films show"). Not measured: a person playing against
the partner (no hands on a pad here), a phone, the partner online.

## The architecture

```
brain.ts      the contract: Brain, Sight (what a brain may see), BodyHints, SeenMove, Rng (seeded, mulberry32)
scene.ts      what every brain in a place sees, once a frame: each dancer, and a Witness of the moves it starts
driver.ts     one brain at one body: Sight in, Intent out, hints laid on the Character; .source() is an IntentSource
body.ts       working the body: move name → Intent (the button table), canStart / freeIn, the stick toward a point
              (locked or free, undoing the camera-relative stick), a move's replayable start event, the 8th grid
read.ts       reading an attack from its start event (Character.shapesAt): when it touches, which dodge covers it,
              the parry window, a clash of one's own; each attack's measured reach
mind.ts       working memory: presses planned on beat lines with priorities, legs claimed by priority, history
behaviours.ts keepDistance, approach, answer, offer (choose, step in, strike on the 8th), echo, unison, callPattern,
              merge, avoid, routeAround, Wander, watch, throughGate, liveGap / wouldDo, roomBehind
partner.ts    PartnerBrain + PRESETS (playful, calm, fierce, mirror)
npc.ts        NpcBrain (wander, dance, watch, roda, travel) + rodaSpot
teacher.ts    TeacherBrain (the ladder) + StudentBrain (scripted, for tests and the film)
clips.ts      the CMU clips baked as grooves (an idle) and flourishes (sampled moves), the table of roles, `palmas`
jogo.ts       a small referee: shared/rules.ts run directly + the bodies' own exchange judgement (stand-in for src/play)
sim.ts        a jogo (and NPCs) simulated in Node at 60 fps on a virtual music clock
demo.ts       the page's flags: ?play&partner, ?play&partner=two, ?roda, ?npcs=5, ?teach(&student)
test/         brains.test.ts (npm test), scripted.ts (attacker, still, pattern "humans"), probe.ts (tuning)
```

### The Brain contract

```ts
interface Brain { readonly name: string; readonly body: BodyHints; think(s: Sight): Intent }
interface Sight {
  t, dt, beat, beatPrev, bpm;                 // dance time and the music's clock
  music: { level: 0..1, breakdown: boolean };
  self: Character; seat: number; id: string;  // its own body; jogo seat (0/1) or -1
  others: Other[]; partner: Other | null;     // root, yaw, v, pose (39), flags, moves: SeenMove[], character | null
  stage: { plane, stage, terrain, gates, room };
  rules: { phase, tension, mergeReady, flow, form, fusion, events } | null;
}
interface SeenMove { name, serial, age, attack, ev /* the start event */, beat }
interface BodyHints { flourish, groove, clip, clipW, lookAt }   // what an Intent can't say
```

A brain sees another dancer's moves from their start (the Witness notices a new move serial on the body, so nobody has
to drain `Character.events`; a remote dancer's relayed start events can be handed in with `Witness.saw`), never their
plans. Behaviours don't write the Intent: they plan presses on beat lines and claim the legs, and the `Mind` turns the
winners into the frame's Intent, pressing on exactly the frame whose move start lands nearest the line (the body
starts a move in the first physics substep of its next update). How to write one: `docs/extending/brain.md`.

## The three brains

### The partner (`PartnerBrain`)

Each frame, in order: **answer** (read the other's attack a reaction time after it starts, plan a dodge, parry or
clash), **merge** (at full tension come within MERGE_DIST and hold merge; through the fusion stay close and dance
patterns together), **echo** (a move just seen, 3½ beats later: inside the rules' one-bar echo), **unison** (a move
the other has done twice at a steady interval, on its next repeat), **take a turn** (choose an offer, step in until
the replay says it will touch the other's body as it stands, or come within a few cm for an invitation, strike on the
next 8th; only at a partner free to answer it), **use the stage** (aú over the other to change sides, more when
backed against a wall or a solid shelf, only toward room; hop onto a ledge now and then), **call a pattern** (the
same move on three bar lines, for the other to join), **fill a silence** (two bars of nothing: an esquiva or a turn),
then the legs (the ginga's distance, breathing in and out over four beats; back steps never into a wall) and the
power form (when flow ≥ formFlow and the music's level ≥ 0.6).

How it reads an attack: `Character.shapesAt(ev, t)` against its own hurt shapes (and the standing capsule, and the
shapes padded by 20 cm, since a body sways and a kick slides) gives when and how long it touches. An evade counts as a
dodge while it lasts, but only if the attack still crosses where the body stands (an evade that carries the body
clear earns nothing), so each candidate dodge's root is followed (`dodgeHolds`); a block is held through the touch (a
parry if the touch comes within PARRY_MS of the block, at worst near); a clash is a kick of its own whose capsule
overlaps theirs for three samples before their kick reaches the body. Starts go on an 8th line when one falls inside
the window that works. Skill decides how often the read goes wrong: 30 % of the misses freeze, the rest are mistimed
by 0.1 to 0.3 s. Reaction is drawn per attack (0.8 to 1.25 × `reaction`), × 0.6 if the attacker stepped in, × 0.7
under a barrage.

How it is generous: offers prefer readable wind-ups (a wind-up under ~0.24 s is all but left out at generosity 0.8:
martelo, strike, the throw), are thrown only at a partner who is free (not mid-move, not staggered) and only if, on
the very frame, the replay still says it will do what was meant; a partner who isn't answering (`responsive` < 0.35;
it starts at 0.3 and rises with each answer) is offered invitations that pass a few cm short instead of touches; it
gives way when the other steps in to offer (the higher seat always, the lower now and then, so it's never a standoff).

Moods follow the music: still (a breakdown: it sinks into the cocorinha and only answers), calm (offers every ~4
beats from 1.95 m, ginga 0.75), flow (every 3 beats from 1.8 m), peak (every 2 from 1.55 m, flurries of two or three).

| parameter | playful (default) | calm | fierce | mirror |
|---|---|---|---|---|
| skill, reaction (s) | 0.8, 0.20 | 0.8, 0.22 | 0.85, 0.18 | 0.75, 0.21 |
| dodge / parry / clash / flair (aú, rolê, macaco) | 1 / .45 / .6 / 1.1 | 1 / .9 / .3 / .35 | .7 / 1 / 1.4 / .6 | 1 / .5 / .4 / .7 |
| generosity, flurry at the peak | 0.8, 2 | 1, 1 | 0.45, 3 | 0.9, 1 |
| echo, unison, call, initiative, stage use | .5, .75, .35, .6, .6 | .35, .6, .25, .35, .2 | .25, .45, .15, .9, .45 | .95, .95, .5, .3, .3 |
| form at flow | 40 | 60 | 32 | 45 |

### Free dancers (`NpcBrain`)

A loop of moods, each change on a bar line: **wander** (a walk the motion-matched Mover finds clips for, via the
IntentController's walk blend), **dance** (stop; a groove clip blended in from the ginga by energy and music level,
or a phrase of two or three moves on the beat ending in a clip flourish), **watch** (a jogo within 9 m: keep 3.5 to
6 m from it, face it, sway, clap on the beat with `palmas`, answer a unison or a fusion with a flourish), **roda**
(a place in a ring: walk round the end of the stage to it, keep it, watch), **travel** (walk up to a gate and through
it along its normal; the portals carry the IntentController). Always: off the stage plane's strip (1.25 m either side
of the plane and 0.6 m past its ends; routed round the ends, never across), inside the world's room, a personal space
of 0.9 m. The ring is a horseshoe behind the plane (207° to 333° round the stage's middle, 0.9 m past its ends), so it
never stands between the locked camera and the jogo. Parameters: energy, social, clap, radius, travel, grooves.

### The teacher (`TeacherBrain`)

Out of reach (2.9 m), facing the student. On a bar line it demonstrates a call; it waits two bars for the student's
same moves in the same order (inside one bar the rules count it as an echo); an answer earns two claps and the next
call; three answers in a row take it up the ladder; a call let pass three times is made easier (cut to its first
move, then the level below).

| level | calls from | length, spacing |
|---|---|---|
| 0 | esquiva, meia-lua, block, spin | 1 |
| 1 | martelo, bênção, rasteira, armada, aú, strike | 1 |
| 2 | the basics and kicks | 2, 2 beats apart |
| 3 | kicks, rolê, macaco, aú | 2, 1½ beats |
| 4 | everything but the showy evades | 3, on the beat |

## Simulated play (`npm test`, src/ai/test/brains.test.ts)

Real Characters, the move library and `shared/rules.ts` through the referee, 60 fps, a virtual music clock at 112 bpm,
on the geode's own stage plane (its shelves from `layoutShelves`, the low one solid), the music swelling between calm
and the peak with a breakdown at 118 to 127 s. Three minutes of play after the 4 s intro. Simulating 180 s takes about
2 s.

**Two partners (default preset, three seed pairs):**

| seed | fusions | dodge | clash | parry | near | hit | echo | unison | on the 8ths (±55 ms) | kinds of move | moves | longest stall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 11 | 2 | 9 | 2 | 0 | 0 | 0 | 39 | 2 | 92 % | 10 / 9 | 60 / 53 | 5.6 s |
| 12 | 3 | 11 | 0 | 0 | 4 | 2 | 46 | 3 | 90 % | 12 / 11 | 73 / 61 | 7.0 s |
| 13 | 3 | 15 | 0 | 0 | 2 | 0 | 38 | 3 | 91 % | 12 / 11 | 79 / 58 | 4.5 s |

Asserted: ≥ 2 fusions, dodges + clashes + parries ≥ 2.5 × hits, ≥ 80 % on the 8ths, ≥ 8 kinds each, never off the
stage (past its walls, below its floor or re-forming: 0 frames), no stall over 8 s (the breakdown's stillness and the
intro excluded). The same seeds play the same jogo frame for frame.

Presets against themselves (120 s): calm 1 fusion (dodge 2, near 2, hit 1, echo 24); fierce 1 (dodge 4, clash 6,
near 5, hit 0); mirror 1 (dodge 2, near 2, echo 28). Free on the floor (no plane, 120 s): 1 fusion, dodge 4, near 3,
hit 2.

**Scripted "humans" against the partner:**

- *Only attacks* (107 attacks in 120 s, one every two beats, from wherever it stands): answered dodge 53, parry 12,
  clash 2, near 11, hit 19. Dodges are the main answer; hits come from a relentless barrage arriving while the last
  answer is still being danced.
- *Stands still* (180 s): the partner made 47 moves, offers among them, every one an invitation from just out of
  reach: near 12, hit 1, nothing else (a still person gets no tension, and is not beaten).
- *Repeats a spin every bar* (60 s): 8 unisons joined.

**Teacher:** with the scripted student (copies a beat or so late, wrong a third of the time at first, less with
practice): 26 calls in 180 s, 17 answered, up to level 4 (three-move phrases). With nobody answering (90 s): 13
calls, all single moves, level 0.

**Free dancers** (two wanderers and a roda of three round two partners, 120 s): never in the strip, never outside
the room, no two within 0.4 m of each other (0.0 % of frames), wanderers walked 12 and 9 m, the ring kept within 0.54 m of its places (they follow the jogo's middle), a
groove clip showing on some dancer all the time.

**The body mapping:** every one of the rules' 13 moves a brain asks for is the move the body starts, locked and free.

## The clips and their roles

Probed in Node (limb speed in the body's own frame, root travel, turning, head height, foot strikes) and baked into
39-float landmark frames at 30 fps, on the spot. Turning stretches were chosen to end near a whole number of turns.

| name | clip, stretch | role | reads as |
|---|---|---|---|
| lambada | lambada 0.6–17.6 s | groove, calm (0.37 m/s) | a soft hip sway, almost no turn |
| arch | arch 0.4–3.2 | groove, stillness (0.22) | arms arching up and over, slow |
| macarena | macarena 1.2–5.0 | groove, calm-medium (0.45) | arm by arm, on the spot |
| salsa | salsa (lead) 2.0–4.6 | groove, medium (0.9) | the basic step |
| indian | indian 1.0–12.0 | groove, medium (0.85) | hands up and out |
| charleston | charleston 0.4–3.6 | groove, lively (1.25) | kicks and swivels, no turn |
| twist | twist 0.4–4.2 | groove, the peak (1.95) | swivelling ±60° round a steady facing |
| giro | side-steps 1.0–3.0 | flourish | two quick turns (721°) |
| volta | whirl 2.8–5.4 | flourish, calm | one slow turn, arms up (359°) |
| saltos | jete 3.3–5.3 | flourish, big | two grand jetés on the spot |
| voo | small-jetes 4.8–7.3 | flourish | arms up, a dip, two turns (715°) |
| tour | tour-jete 1.2–2.3 | flourish | one turning leap |
| quebra | breaking 2.4–5.6 | flourish, peak only | down to the floor, a breaker's spin (662°) |
| pirueta | pirouette 2.0–3.47 | flourish (the dancers agent's) | relevé and two turns |
| (walks) | walk, happy, moonwalk, rain, salsa-travel, hopscotch, lindy, leap | locomotion | left to the Mover |
| palmas | procedural | gesture | a clap in front of the chest, an 8th long |

A groove plays at the music's beat, at a rate matching the clip's own step tempo to the music's within ±15 % (the step
tempos come from counting foot strikes and are rough), looping with a 0.4 s cross-fade at the seam, blended over the
ginga by the brain's `clipW` (eased by the driver). A flourish is a sampled move reached by "spin with the stick up"
with the brain's flourish hint set to its name.

## What the films show

Captured with `node scripts/steps/brains-takes.mjs` (headless Chrome on the RTX 5090; each film made of 5 s takes,
one `shot.mjs` run each so the shared GPU lock is held about a minute at a time; frames every 4th at 60 fps, so 15
fps films). The mp4s are in `shots/` (not committed); contact sheets, one frame a second, in `docs/reports/media/`.
The headless page has no sound running, so the brains' music level is held at 0.6 (`&level=`): the jogo is in its
"flow" mood throughout, never calm, peak or a breakdown.

| film | sheet | what it shows |
|---|---|---|
| two partners, the geode, locked, 4–24 s | `3-brains-geode.jpg` | a jogo, mostly. They hold a ginga distance and breathe in and out; kicks are thrown from where they reach and pass over an esquiva or a crouch; an aú carries one to the other side; spins and turns with open arms fill the gaps; at about 23 s tension is full and they walk into each other and hold merge. It reads as a conversation: one moves, the other answers, then the other way round. Where it reads as machinery: the two are often the same height and pose at once (an echo 3½ beats later is too regular to read as a reply), and the stepping in before an offer is a visible little shuffle |
| two partners, the redwoods, locked, 4–24 s | `3-brains-redwoods.jpg` | the same jogo in the clearing: a unison (both jump with their arms up on the same beat), an aú straight through the other, a rasteira under a ginga. When an exchange is close, the gem bodies overlap and shed, which reads more as collision than as the near miss it is; nothing in the matter says "that missed" |
| the roda, free camera, 6–16 s | `3-brains-roda.jpg` | the two playing free in 3D, with the ring round them (green behind, blue and orange to one side, purple to the other) and a gate in shot. From the follow camera the ring are small figures at the edges; their sway shows, their claps don't at this size. Free, the jogo crowds more (they close in on a line that turns) |
| free dancers, `?npcs=5`, 3–13 s (before the fix below) | `3-brains-npcs.jpg` | the matter rises out of its heap and the dancers groove to clips (the Charleston and the Twist read clearly, arms out, swivelling). Two of them stood one inside the other for a while: personal space only acted on a dancer who was walking. Fixed after this film (a standing dancer steps aside within 0.7 m; the test now measures 0.0 % of frames with two within 0.4 m) and re-filmed (see below). The show's camera doesn't follow them, so some walk out of frame |
| the teacher and a scripted student, locked, 4–14 s | `3-brains-teach.jpg` | the teacher (right) kicks into the air on a bar line out of reach, the student (left) answers with the same kick a bar later. It reads as call and response, but slowly: most of the frames are ginga between calls, and the teacher's claps are small |

Re-filmed after the fix (the sheet in the repo is this take): the amber and the purple dancer still line up in front of
the camera for several seconds. The stills can't tell whether they stand together or the purple one is metres behind
in line (the simulated test, with the same brains, measures no two free dancers within 0.4 m); I did not check their
positions in the page. Treat it as unresolved.

## Weak points

- **The jogo talks mostly in echoes.** Between two partners tension comes more from echoes (35 to 45 a session) than
  from exchanges (10 to 20); offers that need the other free and at the right distance are rarer than a busy jogo
  would have. Fusions come every ~45 s of play, which is satisfying, but a person may find the partner talks back more
  than it attacks.
- **Fast attacks are mostly unanswerable** at a human reaction time (martelo, strike, the throw touch 0.21 to 0.3 s
  after they start). The partner seldom offers them (generosity), but a person using them gets hit-or-near answers.
- **Reading is pose-blind.** The read is made against the body's current hurt shapes; the body in its answer is in
  another pose. Margins (padding, holding a block, covering the whole window) absorb most of it; some parries become
  nears and some planned clashes miss.
- **Clashes are rare** (0 to 6 a session): the window where two kicks meet is narrow and the planner insists on a
  robust overlap.
- **Moves outside RULES.moves** (the clip flourishes, `palmas`) are refused by the rules (`onMove` → 'move'), so they
  score nothing and a guest's are not relayed online; NPC dances travel only as poses. Adding them to RULES.moves (with
  `echo: false`) would be the net agent's call.
- **The referee here is a stand-in** for src/play's: it reports exchanges as the rules want and knocks a hit body back,
  but it does not build, travel or play the fusion's sound. Brains only read its RulesView, so they will work with the
  real one if it fills a RulesView the same way.
- **NPCs through gates:** the IntentController is carried, but the NPC's floor is the main view's world's groundAt
  (the page demo's terrain), not the world it walked into.
- **Clip tempos are rough** (foot strikes miscounted on spins and on the couple dance); grooves can drift off the beat.
- **The quebra** ends low and the 0.25 s cross-fade back to the ginga stands the body up quickly.
- **Character.events** still grows unbounded in the page (as it did before: nobody drains it; the brains don't need it).

## Not done

- Ledge use is basic (a hop onto a reachable one-way ledge now and then, a drop off it); no jumping attacks from them.
- The partner never uses the throw's aim or the bending hand; no building.
- No learning, no network calls (as asked). The partner over the network (a remote human's relayed moves fed through
  `Witness.saw`) is designed for but not wired or tested.
- A person has not played it.

## Edits outside src/ai

- `src/dancer/play.ts`: `PlayHandle.addPlayer(source)`: seat the next player on an IntentSource (a brain's), a small
  accessor beside `addDancer` (and its import of `IntentSource`).
- `src/main.ts`: the `?play` block also opens for `?roda` and `?teach`; one line inside it for `brainsPlay`
  (`?play&partner`, `?roda`, `?teach`); one line for `npcsDemo` (`?npcs=N`).
- `docs/extending/brain.md` (new), this report, `docs/reports/media/3-brains-*.jpg`.
- `scripts/steps/brains-sim.mjs` (the probe), `brains-film.mjs` and `brains-takes.mjs` (films in short takes, the GPU
  lock released between them), `brains-check.json`, and the generated `brains-film-*.json`.
