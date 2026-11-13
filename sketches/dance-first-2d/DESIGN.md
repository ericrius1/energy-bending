# Dance First: the Jogo (design v2)

Plan of record. Agents implement against this file. Version 1 of this file described a health-bar
"Duel"; that is **gone**. If you built against v1, the sections "Jogo rules" and "Protocol" below replace
it. If something here turns out wrong, fix the code the simplest way and say so in your report; do not
silently change an interface another agent depends on.

## The idea

Two dancers on one screen, one of **fire**, one of **water**, in a place with ledges and levels to move
through. The model is capoeira: a *jogo*, a game played inside the music, part dance and part sparring.
Nobody is trying to hurt anybody. A kick that almost lands and a dodge that slips under it are one
beautiful thing made by two people. The jogo breathes between **duality** (two elements apart, tension
rising through exchanges) and **unity** (the two merge into one new element, the music drops, and for a
few bars they make something neither could alone), then they part and it begins again.

There is no health, no KO, no winner. There is a shared score (**axé**), a shared **tension** meter that
the two fill together, and each dancer's own **flow**.

Everything stays 2D, on one fixed screen, built on the existing fluid sim: bodies of simulated fire and
water, sparks, a pool that ripples. The picture must stay beautiful first.

## What exists (single player, working)

Static site, ES modules, no build step. `index.html` + `js/`:

- `fire.js`: WebGL2 fluid sim and renderer. Fire field (temperature, smoke, chroma), water field, a wave
  pool for the floor, embers/droplets, bloom. Emit API in world units: `seg()`, `burst()`, `ember()`,
  `ripple()`. `step(dt, time)`, `render(time, fx)`.
- `skeleton.js`: 13-joint layout `J` (head, shoulders, elbows, wrists, hips, knees, ankles; "L/R" = screen
  left/right for a figure facing the viewer), `emitDancer(fire, pose, vel, opts)`, `ik2`, `TUNE`.
- `audio.js`: `Music`, a generative engine on a 16th-note grid; levels 0..4 from `intensity`; `drop()`.
- `conductor.js`: `Conductor` turns a pose stream into notes and gesture events.
- `puppet.js`: the old stand-in-place procedural dancer. `pose.js`: camera tracking (MediaPipe pose).
- `ghost.js`: loop layers. `main.js`: input, frame loop, UI. `_dev.js`: test helpers.
- **World units**: x in [-aspect/2, aspect/2], y in [0, 1] (screen heights). 16:9 gives x in +-0.89.

Solo mode (today's experience) must keep working.

## Modes

1. **Jogo, same screen**: two players on one device (two gamepads, or keyboard + gamepad, or two halves
   of a keyboard). The easiest way to play and to test.
2. **Jogo, online**: two devices, a room code or link.
3. **Jogo, with a partner bot**: one player and an AI partner that plays the jogo properly (answers,
   dodges, offers attacks with clear tells). Fully local.
4. **Solo**: today's free dance. Unchanged.

## The dancer

A character is the existing 13-joint figure, drawn smaller (body about 0.26 screen heights, so
`scale` about 0.36 of today's size), with a physical root: position, velocity, grounded, facing.

- **Moving**: run, jump (variable height), one air jump, drop through thin ledges, fast fall, a dodge
  roll. Falling out of the stage is not a punishment: the dancer re-forms at a spawn point in a bloom of
  their element.
- **Ginga**: the idle is the capoeira sway, in time with the beat. Standing still is already dancing.
- **Moves** (procedural animations on the skeleton, each with a visible wind-up so it can be answered):
  - kicks: *meia-lua* (crescent), *armada* (spinning), *martelo* (snap), *bênção* (push)
  - *rasteira* (low sweep)
  - hand strikes and a **bending throw**: a stream of the dancer's element from the hand along the aim
  - *aú* (cartwheel, travels), *macaco* (back handspring), *rolê*
  - *esquiva* (low dodge with a short invulnerable window), a block/parry
  - a spin flourish
- **The bending hand**: one hand is always an instrument. It follows the aim (right stick, mouse, a
  dragging finger, or the player's real hand on camera), leaves a trail of element and plays the melody
  through the existing `Conductor`.
- Moves started within `PERFECT_MS` of a 16th-note line are **perfect**: brighter, bigger, worth more.

### Elements and forms

Seat 0 is fire, seat 1 is water. Each has a **power form**, entered by spending flow:

| | Base | Power form |
|---|---|---|
| Seat 0 | **Fire**: buoyant, rising; an updraft under the dancer gives a longer, floatier jump | **Plasma**: violet-white filaments, arcs between the hands and to anything near; faster, tighter; the dodge becomes a short blink |
| Seat 1 | **Water**: heavy, falling, splashing; floor waves carry whoever stands in them | **Ice**: crystalline; trails freeze into short-lived ledges anyone can stand on; frost makes the ground slick |

The elements act on each other and on the stage: fire melts ice ledges and frost; water on fire makes
steam, and steam is an updraft that lifts both dancers; plasma arcs to water.

## Jogo rules (authoritative on the server, or in `LocalNet` for local play)

All numbers live in `RULES` in `shared/rules.js`.

- **Flow** (per seat, 0..100): rises with every move, more for perfect timing, less for repeating the
  same move three times running. Spent to hold the power form (enter needs 30; drains 6 per second; the
  form ends at 0). A landed hit costs the dancer who was hit 10.
- **Exchanges** fill the shared **tension** (0..100). An exchange is one dancer's attack meeting the
  other dancer. The dancer *being attacked* reports what happened:
  - `dodge`: the attack's path crossed them while they were in a dodge, a jump or a move that carried
    them clear. The best outcome: tension +10.
  - `clash` / `parry`: limbs or elements met (a block timed within `PARRY_MS`, two kicks crossing, a
    fire throw meeting a water throw). Tension +8.
  - `near`: it passed within a hand's width and missed. Tension +4.
  - `hit`: it landed. Not damage: the dancer who was hit is knocked back and staggers, their element
    scatters. Tension +2 only, and the shared **streak** resets. A clean dodge is worth five hits.
  - `dodge`, `clash`, `parry` and `near` extend the streak; the streak multiplies axé (x1 + 0.1 per
    link, capped at x3).
- **Echo and unison** (found by the server from the two move streams): the same move by both dancers
  within one bar is an **echo** (tension +6); within one 16th it is a **unison** (tension +12).
- **Axé** (shared score) grows with every exchange, echo, unison and perfect move.
- **Merge**: at tension 100 the state flag `mergeReady` is set. When both dancers hold *merge* and are
  within 0.25 world units of each other, **fusion** begins on the next bar line.
- **Fusion** lasts 8 bars. Its kind comes from the two forms at that moment:
  fire + water = **steam**; fire + ice = **prism**; plasma + water = **storm**; plasma + ice = **aurora**.
  During fusion axé counts double, tension drains to 0, and the clients draw the two bodies as one
  shared element. Then one bar of **release** and back to play.
- A session is 3 minutes of play. At the end comes a 4-bar **finale** (an automatic last fusion if
  tension is at least 50), then `over` with shared results: axé, fusions, best streak, and per dancer the
  count of perfect moves, dodges and distinct moves used.
- Phases: `waiting` -> `intro` (at least 3 s, ends on a bar line) -> `play` <-> `fusion` -> `release`
  -> ... -> `finale` -> `over`. Both `ready` after `over` starts a new session.

## Stages

Stage geometry is data in `js/stages.js` (written by the planner, read by physics and rendering):
ground height or a pit, ledges (one-way unless `solid`), spawn points, a `twist`, a music mood.
Stages: **Void** (the black mirror pool, flat), **Redwoods** (a fallen log, two boughs), **Tide Temple**
(broken pillars, a tide that rises and falls), **Sky Forge** (floating basalt over a glow, no ground,
ledges that bob with the bass). More can be added as data.

The view is a fixed 16:9 window of world space. On other aspect ratios the stage is fitted inside the
screen (uniform scale `K = min(1, aspect / 1.6)`); phones in portrait are asked to turn sideways for the
Jogo.

### How worlds are drawn (efficiently)

- Each world is a few **parallax layers baked once** into textures (procedural shaders run at load and on
  resize, not per frame). Per frame the scene shader only composites them with small offsets plus one or
  two cheap animated terms (mist drift, god rays, fireflies as particles).
- **The dancers light the world.** The bloom chain already holds a blurred picture of all the emission;
  the background layers are multiplied by `ambient + that light`. Trunks and stone glow in firelight for
  free.
- Ledges and ground are an **obstacle mask** texture (drawn once per stage) that the fluid sim respects:
  flames lick around a ledge, water lands on it, pools and pours off the edge. The hard-coded floor in the
  sim becomes this mask.
- The redwoods come from Eric's Gem Dancers project
  (`C:\Users\ericr\codeprojects\weft-migration\GemDancers`: `src/forest.ts`, `src/shaders/forest.wgsl`,
  `trunks.wgsl`, `ferns.wgsl`, `motes.wgsl`, `public/forest/bark.jpg`, `bark-h.jpg`, `ground.jpg`). That
  scene is a live 3D WebGPU forest. Here it becomes a 2D painting of the same place: the fairy ring of old
  trunks, mist, hanging paper lanterns, the day going by, using its palette and its bark textures, baked
  into layers. Read it for the look, do not port the renderer.

## Controls

One `Intent` per player per frame, whatever the device:
`{ moveX, moveY, jump, jumpHeld, punch, kick, spin, dodge, form, merge, aimX, aimY, aimActive }`.

| | Keyboard (solo player) | Gamepad (Xbox layout) | Touch | Camera body |
|---|---|---|---|---|
| Move | A / D | left stick | left virtual stick | lean or step left/right |
| Jump | W or Space | A | Jump button | jump, or pinch thumb to index finger |
| Drop / crouch | S | stick down | stick down | crouch |
| Strike / throw | J or click | X | button | a real punch |
| Kick | K | B | button | a real kick |
| Spin, cartwheel | L | Y, bumpers for aú left/right | button | twist the shoulders |
| Dodge / block | Shift | right trigger | button | duck |
| Power form | E | left trigger | button | pinch with the other hand |
| Merge | F (hold) | both stick clicks, or hold Y | button | both hands together overhead |
| Bending hand | mouse | right stick | drag on the right half | the player's real hand |

Same-screen play: player two uses the arrow keys with `,` `.` `/` and right Shift, or any second device.
Gamepads hot-join. Rumble on impacts where the browser supports it.

On camera, the player's real limbs drive the figure's limbs directly; moves are recognised from limb
speed and the hit shape rides the real limb.

## Architecture

- Each client runs its **own** fluid sim. The sim is never synchronised; it is only a renderer. This is
  why low bandwidth cannot make the picture stutter.
- Each client is authoritative for **its own dancer** (position, pose, moves). The network carries poses
  (13 joints, world frame, 20 Hz), move events, exchange reports and server state.
- The server is authoritative for flow, tension, streak, axé, forms, phases, timers and the music clock.
- A move is **deterministic from its event** (which move, start time, root position, facing, aim), so both
  clients draw the same motion and the same hit shapes regardless of pose lag.
- Exchanges are decided by the client of the dancer **being attacked** (it has its own exact position),
  reported to the server, which applies the rules and broadcasts the result.
- Remote poses play back from a jitter buffer with interpolation, bounded extrapolation and smooth error
  correction. They must never snap.

## File ownership (do not edit files you do not own)

Phase one (running):

| Agent | Owns |
|---|---|
| A1 net | `server.js`, `package.json`, `shared/rules.js`, `js/net.js`, `test/`, `.gitignore`, `railway.json` |
| A2 visuals | `js/fire.js`, `js/skeleton.js` |
| A3 audio | `js/audio.js` |
| B2 characters | `js/character.js`, `js/moves.js`, `js/input.js`, `js/pose.js`, `dev/` |

Phase two:

| Agent | Owns |
|---|---|
| B1 worlds (after A2) | `js/fire.js`, `js/skeleton.js`, `js/world.js`, `assets/` |
| B3 jogo (after everyone) | `js/jogo.js`, `js/bot.js`, `js/main.js`, `index.html`, `js/puppet.js`, `js/conductor.js`, `js/_dev.js` |

`js/stages.js` belongs to the planner; ask for changes in your report.

## Protocol (JSON text frames over WebSocket at `/ws`)

All `ts` values are **server time in ms** (`Net.now()`). Seats are 0 (fire) and 1 (water).

Client to server:

- `{t:'hello', v:2, room:string|null, stage?:string, token?:string}`. `room:null` creates a room with a
  4-letter code (A-Z without I and O) on the given stage. A `token` from an earlier `joined` reclaims
  that seat for 20 s after a disconnect.
- `{t:'ping', c:number}`.
- `{t:'pose', ts, p:number[26], f:number, e:number, m?:[moveId:string, startTs:number]}`. `p` is world
  units * 1000, rounded. `f` bit flags: 1 dodging, 2 airborne, 4 blocking, 8 facing left, 16 staggered.
  `e` is energy 0..255. `m` names the move in progress. Relayed to the other seat unvalidated.
- `{t:'move', id, move, ts, x, y, dir, perfect, aim?:[x,y]}`. `id` is `seat + '-' + counter`. `move` is a
  move name from `RULES.moves`. `x, y` root position in world units, `dir` +1 or -1.
- `{t:'xch', id, res}` from the dancer **being attacked**, about the other seat's move `id`.
  `res` is `'dodge'|'clash'|'parry'|'near'|'hit'`.
- `{t:'form', on:boolean}`.
- `{t:'merge', held:boolean, dist:number}` (distance between the two roots as this client sees it).
- `{t:'fx', k, ...}` cosmetic, relayed verbatim to the other seat.
- `{t:'ready'}` after a session ends.

Server to client:

- `{t:'joined', room, seat, stage, token, now}`; `{t:'error', code}` with code `full|bad|gone`.
- `{t:'peer', present:boolean}`.
- `{t:'pong', c, s}`.
- `{t:'state', phase, tension, axe, streak, flow:[n,n], form:[0|1,0|1], mergeReady, fusion, stage, tEnd,
  results, music:{epoch,bpm,mood}}` on every change and at least once a second. `fusion` is
  `{kind, t0, tEnd}` or null. `tEnd` is the server time the current phase ends, or null. `results` is set
  in `over`. `music.epoch` is the server time of step 0; phase changes land on bar lines of that clock.
- `{t:'move', from, ...}` relayed to the other seat. `{t:'no', id}` to the sender if rejected.
- `{t:'xch', id, by, target, res, tension, axe, streak, flow}` to both.
- `{t:'ev', k:'echo'|'unison'|'mergeReady'|'fusion'|'release'|'formOff', ...}` to both.
- `{t:'fx', from, ...}`.

Server rules: accept `move` and `xch` only in `play`, `fusion` and `finale`; at most one `move` per 100 ms
per seat; `xch` only from the seat that is not the mover, once per move id; a move id expires after 4 s;
all meter changes come from `rules.js`, never from the client.

## Interfaces between agents

`shared/rules.js` (ES module, runs in Node and the browser, no dependencies):

```js
export const RULES   // { SESSION_MS, PERFECT_MS, PARRY_MS, FUSION_BARS, FORM_ENTER, FORM_DRAIN, moves: { 'meia-lua': { attack:true, flow:6 }, ... }, xch: { dodge:{tension,axe}, ... }, fusionKinds }
export function createSession(stage, nowMs)          // -> session state
export function tick(s, nowMs)                       // advance phases, timers, drains; -> array of events (may be empty)
export function onMove(s, seat, msg, nowMs)          // -> { ok, events }
export function onExchange(s, seat, msg, nowMs)      // -> { ok, result, events }   result = the 'xch' broadcast body
export function onForm(s, seat, on, nowMs)           // -> { ok, events }
export function onMerge(s, seat, held, dist, nowMs)  // -> { ok, events }
export function onReady(s, seat, nowMs)              // -> { ok, events }
export function publicState(s)                       // -> the 'state' message body
```

`js/net.js`:

```js
export class Net {            // real server
  constructor(url)            // defaults to same origin, /ws
  connect({ room, stage })    // -> Promise<{ room, seat, stage }>; auto-reconnects with the token
  now()                       // estimated server time, ms
  rtt; jitter; connected; seat; room; state   // state = last 'state' body
  sendPose(pose26, flags, energy, move)   // call every frame; rate-limits and quantises internally
  remotePose(out26)           // writes the interpolated remote pose; -> { ok, age, flags, energy, move }
  send(msg)                   // reliable event (move, xch, form, merge, fx, ready)
  on(type, fn)                // 'state','move','no','xch','ev','fx','peer','open','close'
  close()
}
export class LocalNet { ... } // same surface, no server: runs rules.js in the page. constructor({ stage, partner })
                              // partner (optional) supplies the other seat: partner.attach(api) receives
                              // { now, send(msg) as seat 1, on(type, fn) } and partner.pose(out26) -> { flags, energy, move }
                              // each frame. With no partner, seat 1 is driven by the game calling net.sendAs(1, msg).
```

Both honour a network conditioner for testing, read from the URL: `?lag=150&jitter=60&loss=5`
(ms, ms, percent; loss applies to pose frames only).

`js/skeleton.js` / `js/fire.js` (A2): `emitDancer` elements 0 fire, 1 water, 2 fire + water, 3 ice,
4 plasma. `fire.look = { ice: 0..1, plasma: 0..1 }` morph the water field toward ice and the fire field
toward plasma (one fire dancer and one water dancer per match, so a global morph is enough).
`fire.arc(x0, y0, x1, y1, intensity)` draws a lightning arc. `fire.frost(x, radius, amount)`.
`render(time, fx)` accepts `fx.hurt`, `fx.hurtHue`, `fx.zoom`, `fx.zoomX`, `fx.zoomY`, `fx.chroma`.

`js/audio.js` (A3): `music.syncTo({ epoch, bpm, mood }, nowFn)`, `music.unsync()`, `music.beatError()`,
`music.beatInfo()`, `music.sfx(name, opts)`, `music.fusion(kind)`, `music.release()`, `music.tension`.

`js/character.js`, `js/moves.js`, `js/input.js` (B2): see that agent's brief; summarised here once built.

## Testing notes

- A static copy of the app is served at http://127.0.0.1:5372/ by the old server. Do not stop it. Start
  anything you need on your own port (A1: 5380, B2: 5382, B1: 5383, B3: 5381) and stop it when you finish.
- The built-in Browser pane, when hidden, throttles `requestAnimationFrame` to about 2 fps and timers
  to 1 Hz. Use `await import('/js/_dev.js')` then `drive(seconds, fn)` to run frames and the music
  scheduler at 60 Hz, and `snap()` to capture the canvas into an overlay image before a screenshot.
  The pane has no camera and no gamepad. Only one agent may use the Browser pane at a time.
- Never claim something works that you did not run. Say what you could not verify.
- No marketing copy on screen: buttons, meters and menus only.
