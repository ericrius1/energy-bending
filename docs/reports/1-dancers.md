# Wave 1: dancers

A playable dancer in the 3D engine. A person with a keyboard, a gamepad, a touch screen or (untested) a camera moves a
full 38-joint CMU body wearing gems, which dances capoeira: the prototype's move library, body physics and input layer
ported to TypeScript in metres, mirrored to this repo's handedness, fitted to the rig through an improved retargeter,
with motion-matched mocap walking blended in free mode, a CMU clip as a flourish, and the locked side view end to end
(ledges, the camera easing round, the dancers easing onto the plane). `?play` shows it.

Branch: `worktree-agent-a17766668550a70bb`. Measured: typecheck, build, `npm test` (50 checks in 3 files, plus the
limits), headless stills on the RTX 5090 of every move from the front and the side, locomotion, the lock with two
dancers on ledges, and two 8 s films of a scripted sequence. Not measured: a real gamepad, a touch screen, a webcam, a
phone.

## The public API

```ts
// src/input/intent.ts
interface Intent { moveX; moveY; moveZ; jump; jumpHeld; punch; kick; spin; dodge; form; merge; aimX; aimY; aimActive;
  camX; camY; lock; interact; dodgeHeld; punchHeld; auDir?; flick?; limb?; limbs?; hasLegs?; pinch?; walk?; source? }
interface IntentSource { readonly name: string; mode: 'locked' | 'free'; update(dt: number): Intent }
makeIntent(), mergeIntents(a, b), radialDeadzone, Hysteresis, PeakDetector, Buttons

// src/input/*
new KeyboardSource('solo' | 'left' | 'right', { target, mouseTarget, dancerScreen, facing })
new GamepadSource(index, { getPads }).rumble(strength, ms); new GamepadHub({ getPads, target }).on('connect'|'disconnect', fn)
new TouchSource(element).buttons /* descriptors */; new TouchPad(touchSource, canvas)   // draws them
new BotSource((dt, intent) => …)
new CameraSource(tracker, { aimHand, jumpHand }); new BodyTracker().ingest(lm, wlm, now, aspect) / .ingestHands(hands, now)
new Webcam(say).start(coarse)   // pose model + (not coarse) the hand model; tracker for CameraSource
new InputHub({ canvas, getPads, dancerScreen, facing, max }).onJoin / .onChange / .poll() / .key() / .touch()
  / .joinCamera(src) / .join(src) / .rumble(player, s, ms)

// src/dancer/character.ts (pure, Node-testable)
new Character({ seat, plane, terrain, aimHand })
  .update(dt, intent, beat | { beats, bpm }) → pose (39, world m), root, yaw, v, events
  .setPlane(plane | null)   // eases onto it   .extraLedges = () => Ledge[]   .flourish   .idle = (out, beat) => …
  .startMove(name | def, opts) .hitShapes() .hurtShapes() .standShape() .applyKnock() .setPoseFromCamera(limbs, legs)
Character.shapesAt(moveEvent, t)   resolveExchange(attack, defender, { plane })   foldExchange   capsuleDistance
PHYS, COMBAT (defineParams 'dancer', 'combat')

// src/dancer/moves.ts
MOVES[name]: MoveDef { name, dur, active, attack, hit, travel, iframes, cancelInto, airOk, evade, aimW, usesHand, hold,
  loop, style?(u, ctx) → { hands?, feet? }, pose(u, ctx, out39) }
asMove(def), registerMove(def)   // def may be { name, dur, sample(u, out39), … }: the prototype's clip adapter
LOCO.ginga/run/rise/fall/land/crouch/stagger/reform, rig(params, out), travelAt, tempoScale, gingaSteps, FU, ANKLE_H

// src/dancer/clip-move.ts
clipMove(motion, { name, piece, dancer?, from, to, dur?, travel?, extra? }) → MoveInput
pirouetteFlourish(motion) → 'pirueta' (two turns of the CMU pirouette)

// src/dancer/intent-controller.ts
new IntentController(rig, { seat, source, terrain, plane, moves /* motion matching */, at })
  .source .script (bend.intent) .inputYaw .lookAtHead .setPlane(p) .move(name) .character .intent .mocapW
blendSkeletons(a, b, w, out)

// src/skeleton/retarget.ts
fitSkeleton(lm, out, lift?, hints?: PoseHints)   // hints: ground, ankle, feet [L,R], hands [L,R], lookAt, look, curve

// src/engine/camera.ts
interface Ledge { id; x0; x1; y; solid?; thick?; bob? }
interface StagePlane { id; origin; right; halfWidth; ground: number | null; ledges: Ledge[]; spawns: [number, number][];
  ledgeY?(ledge, beat) }   // exactly the asked shape, plus the optional ledgeY the stage may supply
ledgeY(ledge, beat), planeNormal(plane), planePoint(plane, s, y)
CameraRig: .follow: FollowTarget | null (third person), .lookBy(x, y, dt); lock(plane) as before

// window.bend (engine/hooks.ts): bend.players(), bend.intent(p, patch | null), bend.move(p, name), bend.place(p, x, z, yaw?)
```

Plane coordinates: s along `right` from `origin`, y up from the origin's height; `ground` and ledges are in them;
spawns are [s, y]. The locked camera's lens is `camera.lockLens` (18°); how far back it may stand comes from the
world's `room` (the old per-plane `lens`, `maxDistance`, `normal`, `height` are gone: normal = right × up).

## The buttons, as they ended up

| button | keyboard (solo) | gamepad | touch | camera body |
|---|---|---|---|---|
| move | A D (free: W S depth) | left stick | left-half stick | lean / step |
| jump | W, Space (free: Space) | A | jump | jump, or pinch (jump hand) |
| crouch / drop | S (free: C) | stick down (free: d-pad down) | stick down | crouch |
| strike / throw | J, left click | X; a right-stick flick | strike | a real punch |
| kick | K | B | kick | a real kick |
| spin / aú | L | Y; LB/RB aú left/right | spin | twist the shoulders |
| dodge / block | Shift | RT | dodge | duck |
| form | E | LT | form | pinch (other hand) |
| merge | F (hold) | both sticks, or Y held | merge | hands together overhead |
| lock | Tab, V | View | lock | — |
| walk (free) | Q | the stick's tilt | the stick's tilt | — |
| hand / look | mouse / right-drag | right stick (free: LB + stick) | right-half drag | the real hand |

Player two: the arrows , . / right Shift Enter right Ctrl ] (the keyboard splits), or any second device.

Which move a button means (`Character._choose`; tested):

| button | in the air | stick down | stick up | toward / away | standing |
|---|---|---|---|---|---|
| punch | strike | strike | strike | strike | strike; hand aimed far: throw; held: strike → throw |
| kick | martelo | rasteira | martelo | bênção / armada | meia-lua |
| spin | spin | macaco | `pirueta` (the clip) | aú that way | spin |
| dodge | esquiva | esquiva | block | rolê that way | block (held: holds) |

## Tuning, in metres

The prototype's world unit is 6.38 m (its body 0.26 tall → about 1.6 m; the CMU rig stands about 1.55 m). FU, the
move keyframes' figure unit, is 2.296 m (the CMU leg over the prototype's), so every pose's limbs are the rig's own.

| | prototype | here |
|---|---|---|
| run | 0.62 /s | 4.0 m/s (walk modifier 1.3 m/s) |
| full jump | 0.30 (0.42 s up) | 2.0 m (0.42 s up): gravity 22.7 m/s², jumpV 9.53 m/s; measured apex 1.98 m |
| air jump | +0.23 | +1.5 m: airJumpV 8.25; measured double-jump apex 3.46 m |
| short hop | ~0.12 | measured 1.02 m |
| ground accel / decel / turn | 3.4 / 4.5 / 7 | 22 / 29 / 45 m/s² |
| body height / half width | 0.24 / 0.03 | 1.55 / 0.2 m |
| ledge margin, solid thickness, wall margin | 0.012, 0.06, 0.04 | 0.08, 0.4, 0.25 m |
| blink | 0.22 | 1.4 m |
| bending hand reach | 0.225 FU | 0.47 m |
| near (jogo) | 0.022 | 0.14 m |
| hit radii, travel, stream | figure units × scale | × FU (meia-lua capsule 0.14 m; aú travels 1.8 m) |

Times, buffers, coyote time, turn rate, PERFECT_MS and PARRY_MS are unchanged. Playing, the gems' spring is stiffened
(`play.gemStiffness` 700, damped near critical; their default 130 lags 0.8 m behind a 9.5 m/s jump) and the dance runs
at speed 1 (the gem show's is 0.72).

## Tests (`npm test`)

```
limits agree (6 caps checked)
# src/dancer/test/character.test.ts   28 passed, 0 failed
  the prototype's 26 checks in metres (stands, jump apex 1.98 m, double jump 3.46 m, one-way and solid ledges, a bobbing
  ledge ridden with 0 error over 264 frames, the pit and re-forming, every attack's wind-up ≥ 150 ms at 140 bpm, live
  and replayed hit capsules within 4e-16 m, the button mapping, perfect timing, every exchange result, real duels,
  a 60 s soak on every stage locked and free, frame-rate independence within 1.3 cm, a rotated plane identical to
  3e-14 m, free movement on a slope, camera-relative sticks, sampled moves, element hooks, knockback, the camera body)
  plus: BONE matches the CMU rig; landmarks keep the dancer's own left at +x; extra ledges from a callback; locking
  eases a free dancer onto the plane (moved 1.0 m in the first 50 ms from 2.5 m off it; on it, inside the walls)
# src/dancer/test/rig.test.ts   4 passed, 0 failed
  hints keep every bone its length (1.9e-16 m), toes on the floor (0.041 m), a pointed kicking foot (cos 0.94);
  the head turns to look; IntentController end to end (mocap weight 1.00 at a walk, 0.00 at a run, toes on a 1.5 m
  ledge at 1.54 m); the pirouette clip as a move: 663° in place, danced through by a controller
# src/input/test/input.test.ts   18 passed, 0 failed
  the prototype's 15 (keyboard, mouse, gamepad with fakes, hot-plug, touch, bot, merge, peaks, camera gestures, the
  pinch, BodyTracker) with limbs in metres (not mirrored), plus the hand model's fine pinch and the hub (join order,
  the keyboard split, a gamepad joining on its first press, touch, rumble)
3 of 3 test file(s) passed
```

Two of the prototype's numbers moved and the tests say so: the bênção meets a stander later on the CMU body (its
longer thigh), so the "timed block parries" duel raises the block 0.15 s before contact instead of at 0.2 s; and the
lock-ease test waits 2.5 s for the 0.22 s ease to finish.

## The sheets I looked at, and what changed

All 1280×800 from `bend.grab()`, headless Chrome on the RTX 5090 (adapter printed: `nvidia blackwell … RTX 5090`),
`node scripts/steps/dancers.mjs` then `shot.mjs` with `scripts/steps/dancers-*.json`. Contact sheets (center crops) in
`docs/reports/media/`:

| sheet | what it shows | verdict, and what I changed |
|---|---|---|
| `1-dancers-sticks.jpg` | every move as landmark stick figures, 13 moments, front and side (no GPU: a Node dump, for fast iteration) | the prototype's "rough back handspring" lay flat on the floor at its quarter turns (the lowest point was glued to the floor all the way round). Changed: the hips fly an arc and the floor only catches the feet, then the hands at the handstand, then the feet |
| `1-dancers-kicks.jpg` | meia-lua, armada, martelo, bênção: wind-up, active, recovery × front, side | all four read as themselves on the gem body: the crescent sweeping over at head height, the armada's leg out behind after the turn, the martelo's chambered snap, the bênção's sole driving forward (a little low: hip height) |
| `1-dancers-sweep-hands-au.jpg` | rasteira, strike, throw, aú | rasteira (low on one leg, hand down, the other leg sweeping) and aú (inverted, side-on) read well; the strike reads from the side, weakly from the front; the guard hand rides above the head (see weak points) |
| `1-dancers-dodges.jpg` | macaco, rolê, esquiva, block | esquiva and block read; macaco and rolê are fast enough (a full turn in 0.4 to 0.6 s) that the gems smear, even stiffened; the macaco's handstand moment is not legible at gem resolution |
| `1-dancers-spins.jpg` | spin and the CMU pirouette | both read; the mocap pirouette (relevé, passé, two turns) is the best-looking move in the set |
| `1-dancers-lock.jpg` | free with two, the follow camera, the lock at 0 / 12 / 37 / 107 frames, jumping onto the test ledges, the high bobbing ledge, a kick, unlocking | the camera eases round to side-on with no cut and back; both dancers end on the plane facing each other, stand on the 1.1 m ledges and the high one. The ledges themselves are invisible (nothing draws them yet) |
| loco (not committed: shots/loco) | ginga front and side, run, mocap walk and turn, jump ready → land, crouch | ginga is right. The first jump captures showed the body exploding into streaks and leaving the frame top: two changes, the follow camera rises faster (7/s up) and the gems' spring is stiffened while playing; the apex now holds together, the fall at 10 m/s still streaks |

## The film

`dancers-film-free.json` and `dancers-film-locked.json`: 8 s at 30 fps of the same script (ginga; meia-lua answered by
an esquiva; aú; player two runs and jumps; armada against a spin), free with the follow camera and locked side-on,
stitched with ffmpeg into `shots/film-*.mp4` (not committed: media/ keeps only jpgs) with contact sheets
`docs/reports/media/1-dancers-film-free.jpg`, `1-dancers-film-locked.jpg`.

What I saw in them. Free (`1-dancers-film-free.jpg`): the meia-lua and the esquiva under it read as one exchange; the
aú wheels; player two's run and 2 m jump hold together as a body at the apex; the armada against the spin reads; the
follow camera swings round behind player one as they move, with no cut. Locked (`1-dancers-film-locked.jpg`): the
same script side-on; the aú reads best from this side; player two lands on the right test ledge and dances there,
standing on nothing visible; the framing eases too slowly at the start (the first frames cut player one at the left
edge) and when player two leaps (cropped at the right edge for a few frames). No page errors in either run (the one
console warning is weft's powerPreference notice, as in the foundation). 8 s each, 240 frames at 30 fps, 1280×800.

## Unverified

- **The camera body.** No webcam here (headless has none). What runs is the pure part: gestures from synthetic
  landmark streams, BodyTracker on synthetic MediaPipe output, the fine pinch on synthetic hand landmarks, and the limbs
  driving the Character in a test. The Webcam class (getUserMedia, the pose and hand landmarkers from the CDN, version
  1.1.0, URLs checked to answer 200) has never seen a picture. The hand-to-wrist matching, the fine-pinch thresholds
  (0.22 / 0.36), and whether worn limbs plus gesture locomotion feel right are guesses until someone dances in front of
  it. `c` in ?play starts it.
- **A real gamepad** (mapping, hot-join, rumble): only fakes. **A touch screen** and `TouchPad`: never touched.
  **The mouse aim** from the projected shoulder: typechecks, not driven. **Keyboard joining and splitting**: the hub's
  logic is tested; the DOM wiring (capture-phase keydown) was not driven headless.
- **A phone**: not run. The hand model is skipped on `coarse` devices by design.

## Honest weak points

- **The gems lag fast moves.** At 4 m/s and in a 9.5 m/s jump the body trails and sheds; rolê and macaco smear. The
  stiffer spring in ?play helps; the matter's speed shed and streaks are the gems' (another folder).
- **Hand heights.** The keyframes were written for the prototype's longer torso; on the CMU body the guard and the
  ginga's face-crossing arm ride 5 to 8 cm high. Not re-authored.
- **The ledges are invisible**: physics only. Drawing them (and set ice) belongs to the worlds.
- **The locked camera** frames hips, head, hands and toes; a jump to the high ledge briefly crops the top until the
  framing eases (2.2/s).
- **Motion matching in play** shows only at a walk (the walk modifier, a gentle stick): at 4 m/s the procedural run
  takes over (the CMU database has no running), and the ginga idle is procedural. The mocap walk's feet slide a little,
  because the physics owns the root and the clip is pinned under it.
- **Feet and hands from hints** are defaults, not solved contact: a flat foot is level along the knee's direction; the
  palm direction assumes the CMU rig's palms face down at rest, which I could not check at gem resolution.
- **The pirouette** stretch was chosen by probing the clip (head height, the shoulders' turn); it measures 663°, not
  720°, so the cross-fade back to the ginga turns the last 57°.
- The clip adapter samples the CMU rig through FK and `landmarksFromSkeleton` each frame: fine for one flourish, not
  measured for many.
- Footfall and jump/land events are produced (Character.events) but nothing listens yet (sound, sparks: wave 2).

## Edits outside my folders

- `src/main.ts`: one line, `?play` (with the other demo lines).
- `src/worlds/geode/geode.ts`, `src/worlds/redwoods/redwoods.ts`: each stage plane literal in the new StagePlane shape
  (one line each; the worlds agent is writing these too, so expect a trivial conflict).
- `scripts/shot.mjs`: a step may carry `js` (an async body run in the page with B = bend) before stepping.
- `scripts/test-ts.mjs` (new): bundles every `src/**/*.test.ts` with esbuild and runs it under Node.
- `package.json`: `npm test` also runs `scripts/test-ts.mjs`.
- Mine: src/dancer (new: character, moves, intent-controller, clip-move, play, test/), src/input (all new), src/skeleton
  /retarget.ts, src/engine/camera.ts and hooks.ts, scripts/steps/dancers*.{mjs,json}, docs/extending/move.md and
  input.md, this report.

## Commits

On `worktree-agent-a17766668550a70bb`, not pushed: the physics and moves; the input, controller and retargeter; ?play,
hooks and steps; the tuning after looking and this report (`git log`).
