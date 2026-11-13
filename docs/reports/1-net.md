# Wave 1: net

The 2D prototype's room server, rules and netcode, ported to TypeScript and fitted to the 3D game: one protocol file
that the server, the client and the tests all import; binary 3D poses; rooms of two jogo seats plus six guests; a
world per dancer and a `travel` message; set pieces as shared state; `Session` and `NetController` for the game; a
`?net=ROOM` demo proved in two headless browsers. The remote dancer's smoothness was measured again, the prototype's
loosened bound characterised, and the buffer improved (error at lag 200 / jitter 80 / loss 10: rms 23 mm to 4.4 mm,
p95 48 mm to 3.6 mm, in virtual time).

Branch: `worktree-agent-a6a66f67db5efbabf` (four commits on top of `3d6405e`).

Measured: `npm run typecheck`, `npm run build`, `npm test` clean (66 checks: rules 21, room 8, codec 5, LocalNet 3,
server with real clients 18, smoothness 11, plus the limits check); the smoothness study in virtual and real time with
the CPU load recorded; the `?net` demo in two headless Chromes on the RTX 5090 at lag 200/80/10 and at lag 40; a fresh
clone of the branch: `npm ci`, `PORT=5419 npm start`, `/health` answered `ok`. Not measured: Railway itself (not
deployed, as asked), a real network between two machines, a phone, the real-time test on a quiet machine (it never was
quiet; see below).

## The layout

```
shared/protocol.ts     every message (ClientMsg, ServerMsg, RulesEvent unions), the slot counts, the binary pose codec
shared/rules.ts        the jogo (ported), guests, worlds per dancer, move extras, building; pure; route()
server/rooms.ts        startRooms({ port, host }): rooms over ws at /ws, /health, relays poses, routes JSON through rules
server/index.ts        the entry: node server/index.ts [port]; PORT env binds 0.0.0.0 (Railway)
server/tsconfig.json   the Node project: erasable syntax only, .ts imports (Node strips the types; no build step)
src/net/net.ts         Net, LocalNet, PoseBuffer, Link (conditioner), Clock: pure, imported by Node in the tests
src/net/session.ts     Session
src/net/controller.ts  NetController, standingPose
src/net/demo.ts        ?net=ROOM, with the in-page probe (window.bendNet)
test/*.test.ts         rules, room, codec, localnet, integration, smoothness (npm test); test/tsconfig.json
test/two-pages.mjs     the two-browser check (needs a GPU and a dev server; not in npm test)
railway.json           start: node server/index.ts, healthcheck /health
docs/extending/network.md   the protocol in plain words, how to add a message
```

## The protocol, as it ended up (and what changed from the prototype)

- **Version 3.** `hello { v: 3, room, create?, stage?, world?, token?, role? }`. New: `create` makes a room with a
  chosen code (3 to 8 letters or digits), `role` asks for `player`, `guest` or `any` (seats first). `joined` now
  carries `slot` (0..7), `seat` (the same number, the prototype's name) and `player`.
- **Eight slots.** `SEATS = 2` for the jogo, `GUESTS = 6`. Guests get every pose and move relayed; their moves score
  nothing, set no pending exchange, and are accepted in any phase; they can't `xch`, `form`, `merge` or `ready`, and
  can't build (`RULES.build.GUESTS`, false). A guest leaving changes nothing; a seat leaving resets the jogo (as
  before), never the set pieces. `peer { slot, present, player }` names who came or went.
- **Poses are binary** (they were JSON text): 106 bytes = magic, slot (the server writes it), flags (12 game bits,
  plus TELEPORT and three codec bits), ts float64 (server ms to 0.1 ms), root int32 mm ×3 (±2,147 km), yaw uint16
  (1/65536 turn), energy, 39 landmarks int16 mm in the dancer's frame (±32.767 m). Then up to three earlier snapshots
  (1 count byte + 88 bytes each: dt, root offset int16 mm, yaw, landmarks), the world id (1 + n bytes), and the move in
  progress (id + start time). The game sends two earlier snapshots. The server checks size and magic, stamps the slot
  and relays; it never decodes a pose.
- **The world each dancer is in** travels in every pose (a few bytes; robust to reordering, unlike a table index) and
  in the state (`slots[i].world`, set by `hello` and `travel`). `travel { world, portal? }` moves one dancer; a seat's
  travel also moves the jogo's world (`state.world`, the prototype's meaning). The receiving buffer cuts (no
  interpolation) on a new world, the `TELEPORT` flag, or a root that moved more than 3 m between two snapshots.
- **Moves carry their replay.** `MoveExtras` in protocol.ts: `yaw`, `aim3`, `fdir`, `vx/vy/vz`, `air`, `bpm`, `hand`,
  all optional and typed; the rules check and clamp those and drop a malformed one; any other field is relayed as
  it came (`from` and `t` can't be forged). Moves go to every other slot (`'others'`), not just the other seat.
- **Building** (new): `build { move, kind, points, width, life? }`, `melt { id }`, `shatter { id }`; events `set
  { piece }`, `expire { id, reason: life | melt | cap }`, `melt { id, by, at, tEnd }`, `shatter { id, by }`; refusals
  as `no { of: 'build' | 'melt' | 'shatter', id, reason }`. A `SetPiece` is `{ id, kind, world, by, t, points (flat
  xyz, integer mm, up to 16 points), width (mm), life (ms), melt? }`. A joiner gets `pieces { list }` right after
  `joined` (and again on a reconnect); `state` carries only `pieces` (the count) and `piecesRev`, so the list isn't
  resent every second.
- **Server responses** otherwise as before: `state` on every change and at least once a second (4 Hz while a form
  drains or a fusion runs), `xch`, `ev`, `no`, `fx`, `pong`, `error { full | bad | gone }`.

## The rules, as they ended up

Everything from the prototype is kept and still tested (its 21 rule tests are ported nearly verbatim). Changes:

- `MERGE_DIST` 0.25 → **0.5 m** (two roots 25 cm apart means bodies inside each other in 3D; 0.5 m is touching).
  `COORD_MAX` 1000 world units → 100,000 m. `STAGE_MOODS` adds `geode` and `redwoods`.
- Per-slot rate limits (moves 100 ms, travel 1 s, melt/shatter 100 ms) live in arrays on the session, so they hold
  whether or not the slot is present (the prototype's world test relies on that).
- `used` move ids are forgotten after 60 s (the prototype kept them for the session; harmless at 3 minutes, a slow leak
  in a room that stays open with guests).
- **Building, in `RULES.build`**: a piece is set from one of the dancer's own moves of the last `MOVE_TTL_MS` (4 s), one
  piece per move, whose start was within `BEAT_MS` (70 ms) of an 8th-note line (`GRID` 2) of the room's music. It
  costs `kind.cost × (BASE 4 + PER_M 2 × length m + PER_W 4 × width m)` flow (a 2 m ice bridge 30 cm wide costs 9.2;
  a perfect armada earns 10.5). Kinds: `ice` (cost ×1, life 90 s, melts and shatters), `gems` (×1.25, 180 s, shatters
  only). Caps: 64 per world, 16 per dancer; past either, the oldest goes (`expire`, reason `cap`). A melt takes
  `MELT_MS` (2.5 s); melt or shatter reports are accepted from any dancer in the piece's world. Pieces set in the
  dancer's own world and outlive the jogo's resets.

## The API

```ts
// src/net/net.ts (pure; Node runs it)
new Net(url?, { lag?, jitter?, loss?, buffer?: Partial<BufferParams>, redundant?: number })
  connect({ room?, create?, stage?, world?, role? }): Promise<OpenInfo>      // OpenInfo { room, slot, seat, player, stage, world }
  now(); rtt; jitter; connected; slot; seat (null for a guest); room; world; state; delay; peers(); buffer(slot)
  sendPose(pose: { p, root, yaw }, { flags?, energy?, world?, move?, teleport? })   // every frame; sends at 20 Hz
  remotePose(out: PoseSink, slot = the other seat): { ok, age, flags, energy, world, move, slot }
  send(msg: ClientMsg); on(type, fn) -> off; close(); onPose (a probe hook)
new LocalNet({ stage?, world?, partner?, lag?, jitter?, loss? })   // the same surface; rules in the page
  connect(); sendAs(seat, msg); partner contract: attach(api), pose(out) -> { flags, energy, world, move }
PoseBuffer, BUFFER_PARAMS, PROTOTYPE_BUFFER, Link, Clock, packPose, unpackPose, NET_PARAMS

// src/net/session.ts
new Session({ url?, local?, partner?, room?, create?, stage?, world?, role?, ...NetOptions })
  connect(); slot; seat; player; room; state; connected; now(); on(type, fn); send(msg)
  move({ move, x, y, z?, dir, perfect?, ...extras })   // id and ts filled in
  sendPose(skeleton, { world?, flags?, energy?, move?, teleport?, ground? })   // via landmarksFromSkeleton
  remote(rig, slot?): NetController
  pieces: Map<string, SetPiece>                        // kept from 'pieces' and the set/melt/expire/shatter events
  beats(); beat(f.beat)                                // FrameCtx.beat from state.music (no FrameCtx change needed)

// src/net/controller.ts
new NetController(rig, net, slot = null)   // a LandmarkController fed from net.remotePose; stands in standingPose()
  info: RemoteInfo; seen: boolean          // until the first pose arrives
```

`FrameCtx` was not changed: the demo fills `f.beat` from the room's clock in an `input`-phase tick
(`session.beat(f.beat)`), after main.ts's local clock and before anything reads it.

## Bytes per second (20 Hz)

| | payload per frame | payload per second | on the wire per second (est.) |
|---|---|---|---|
| this game (pose + 2 earlier snapshots + world `geode`) | 289 B | 5.8 KB/s | about 7.3 KB/s |
| without the repeated snapshots | 112 B | 2.2 KB/s | about 3.8 KB/s |
| the prototype (JSON, 26 numbers) | about 150 to 200 B | 3 to 4 KB/s | |

The wire estimate adds 4 to 8 bytes of WebSocket header, 40 of TCP/IPv4 and about 29 of TLS per frame (not measured on
a real link). That is per dancer, per direction. A full room of eight: each client sends 7.3 KB/s and receives about
51 KB/s; the server sends about 410 KB/s. Events and the 1 Hz state are small beside that (not measured).

## Smoothness: before and after

The test (`test/smoothness.test.ts`) keeps the prototype's: one landmark coordinate moving as 0.3 sin(2π·2t) m (peak
3.8 m/s, a fast hand), sampled by the receiver at 60 Hz, error measured against the source at the playback time (so
the delay itself is not counted as error; it is reported in ms). Run A is virtual time (the conditioner's model,
seeded, exact 60 Hz, a 1 s sender outage at 8 s); run B is real time, two `Net` clients through `server/index.ts`.

### What the error was made of (the prototype's buffer, virtual time, 3 seeds × 14 s)

At lag 200 / jitter 80 / loss 10, 21.9 % of frames are lost end to end (10 % on each leg) and 22 of 260 arrive out of
order. Pure delay costs nothing (lag 200 with no jitter or loss: rms 0.9 mm, the interpolation's own error). Jitter
alone costs little (rms 1.4 mm). **Loss is the whole problem**: with loss, 73 % of frames were being shown while a
correction blended in, and those frames carried 90 % of the squared error (rms 26 mm inside them); frames across a
lost snapshot 6 %, past the newest 2 %. Tracing one lost frame showed why: the playback point sits about two intervals
behind the newest snapshot, so after a loss it is already inside the segment that ends at the newest knot, whose
tangent was one-sided (a chord back to the previous knot, behind the curve by half an interval of curvature). When the
next frame arrived the curve changed under the playback point, and the correction blended the old error out over
100 to 300 ms. That is the error the prototype's bound had to be loosened twice to admit.

### What was tried, one change at a time (lag 200 / jitter 80 / loss 10, virtual, pooled over 3 seeds; metres)

| buffer | rms | p95 | max | max step / source | max accel / source | delay |
|---|---|---|---|---|---|---|
| before (the prototype's) | 0.0230 | 0.0477 | 0.160 | 1.39 | 2.84 | 350 ms |
| + repeat 1 earlier snapshot | 0.0126 | 0.0162 | 0.161 | 1.43 | 2.37 | 350 ms |
| + repeat 2 earlier snapshots | 0.0115 | 0.0086 | 0.161 | 1.43 | 2.37 | 350 ms |
| parabola tangents + fading bend, no repeats | 0.0094 | 0.0198 | 0.070 | 1.26 | 1.92 | 350 ms |
| **after** (both) | **0.0044** | **0.0036** | **0.069** | **1.24** | **1.78** | 350 ms |

- **Repeating earlier snapshots** in each frame: a loss of one (or two) frames costs nothing as long as the next frame
  arrives before the playback point reaches the lost one, which at this delay it nearly always does. A third repeated
  snapshot changed nothing measurable (the sweep in `node test/smoothness.test.ts sweep`), so the game sends two.
- **Velocity-aware tangents** (`TANGENT: 'fd'`): each knot's slope is the slope of the parabola through it and two
  neighbours, also at the newest knot (through the two behind it), and extrapolation continues along that same slope
  (so interpolation hands over to extrapolation without a kink), plus the curve's bend (its second derivative) for
  `BEND_MS` = 60 ms, fading to nothing. Extrapolation now stops after 80 ms (was 120).
- What remains is bursts of three or more lost frames (past the newest, 1 % of frames, 10 % of the error) and their
  corrections. Raising the delay would cut it; I left `MAX_DELAY` at 350 ms.
- **Three bugs found on the way**, all mine, all fixed: the repeated snapshots fed the transit estimate (each arrives
  one interval "late"), which pushed the delay at lag 40 from 156 to 252 ms; the bend left a velocity behind when it
  stopped, which a later correction integrated into a snap (recovery acceleration 11× the source on one seed); and the
  buffer trimmed old knots down to the two behind the playback point while the parabola needs three, so a hold value
  changed formula mid-outage.
- Not fitted to one tone: the same sweep on a mix of five sines (0.4 to 3 Hz) picks the same settings; on that signal
  the error went from rms 4.3 mm / p95 9.6 mm (before) to 1.2 / 1.5 mm (after).

Other conditions (virtual, pooled; before → after):

| conditions | rms (mm) | p95 (mm) | max (mm) | delay |
|---|---|---|---|---|
| lag 200, no jitter, no loss | 0.9 → 0.9 | 1.6 → 1.6 | 1.6 → 1.6 | 321 ms |
| lag 200, jitter 80 | 1.4 → 1.0 | 2.1 → 1.6 | 10 → 3 | 350 ms |
| lag 200, loss 10 | 16.3 → 4.8 | 37.6 → 7.6 | 85 → 36 | 343 → 321 ms |
| **lag 40, jitter 10** | 0.9 → 0.9 | 1.6 → 1.6 | 1.6 → 1.6 | 156 ms |
| lag 40, jitter 10, loss 2 | 8.6 → 1.4 | 23.2 → 2.7 | 49 → 7 | 161 → 156 ms |
| 1 s outage + recovery, 3 seeds (max accel / source) | 2.19, 3.25, 2.24 → 1.59, 1.74, 1.39 | | | |

At lag 40 the delay is 156 ms: 40 ms of transit, 100 ms of lead (two send intervals) and the jitter margin. A lead of
1.5 intervals gives 131 ms at three times the error (2.8 mm rms); one interval gives 106 ms but extrapolates on every
jitter spike (5.7 mm). I kept two.

The test's bounds are now tighter than the prototype's own: after must have, per seed, rms under 8 mm and p95 under
6 mm (the prototype's loosened bound was 35 mm and 90 mm, which its buffer still meets and is still asserted), steady
step under 1.3× and acceleration under 2.5× the source's, recovery under 1.5× and 6×, and at lag 40 rms under 2 mm with
the delay under 170 ms. Yaw spinning at 5 rad/s through ±π turns the short way every frame (max step 0.0998 rad
against the source's 0.0833) with a fifth of the frames lost and none repeated.

### Real time (run B), and the machine's load

This PC never became quiet during the session: Windows' processor counter read 93 to 97 % at the start, 100 % in the
middle and 92 to 97 % before the last run (32 logical cores; an ffmpeg encode that ran the whole time, other agents'
sessions). I ran B three times:

- **At 90 % busy** (its own 2 s CPU sample), frame pacing held (1 to 3 frames over 25 ms out of about 645), so it was
  judged. Steady frames, after the 1 s outage excluded: before rms 46 mm / p95 74 mm / max 327 mm; **after rms 2.0 mm /
  p95 3.4 mm / max 17 mm**, step 1.05×, acceleration 2.29×, delay 344 to 350 ms; measured rtt 188 to 219 ms, receiver
  jitter 31 ms, the two clocks within 21 ms; the sender's reconnect back in 445 ms. All four B checks passed.
- **At 99 % busy** (the `npm test` run): 43 (before) and 65 (after) frames over 25 ms, stalls up to 517 ms, measured
  jitter 147 to 327 ms, four times the conditioner's. The test judged smoothness on the unstalled frames (passed:
  step 1.29×, acceleration 1.46×) and declined to judge tracking ("machine too loaded"), as it should. On those frames
  the after buffer still did better (rms 107 mm against 169 mm), but those numbers measure the scheduler, not the buffer.

So: the real-time run was judged once, at 90 % CPU, and agreed with virtual time. It was not run on a quiet machine.

## Two browsers

`node test/two-pages.mjs` starts the room server on 5417, opens `?net=ROOM&<conditions>&server=ws://127.0.0.1:5417/ws`
from the dev server on 5407 in two separate headless Chromes on the RTX 5090 (two browsers, so neither page is a
throttled background tab), wakes both, lets them dance 8 s, resets the probe, measures 20 s in real time, and reads
`window.bendNet.stats()` from inside each page. Each page dances one partner of the salsa couple on the room's clock
and shows the other through a `NetController`. It holds the render lock throughout. The machine was at 92 to 100 % CPU.

| run | page | delay | transit | jitter | rtt | pose error rms / p95 / max (mm) | remote vs sender accel p99 (m/s²) | frames per s |
|---|---|---|---|---|---|---|---|---|
| lag 200/80/10 | a (seat 0) | 350 ms | 185 ms | 45 ms | 200 ms | 5.7 / 3.8 / 67 | 151 vs 183 | 58 |
| | b (seat 1) | 350 ms | 216 ms | 36 ms | 191 ms | 8.7 / 3.7 / 108 | 186 vs 169 | 59 |
| lag 200/80/10 (first run) | a | 350 ms | 219 ms | 38 ms | 225 ms | 6.0 / 5.8 / 54 | 149 vs 155 | 57 |
| | b | 350 ms | 186 ms | 27 ms | 212 ms | 10.2 / 3.7 / 163 | 139 vs 175 | 57 |
| lag 40/10/0 | a | 160 ms | 47 ms | 5.5 ms | 55 ms | 0.8 / 1.4 / 6.3 | 153 vs 239 | 64 |
| | b | 157 ms | 45 ms | 4.7 ms | 45 ms | 0.9 / 0.9 / 11.6 | 209 vs 170 | 64 |

- **Pose error** is the mean distance over the 13 landmarks between what the page showed at an instant (interpolated
  between frames) and the true pose for that instant, which arrives later (frames and their repeated snapshots). At
  those instants interpolation passes through the data, so this measures extrapolation and corrections, not the
  curve between snapshots; it is the honest measure a page can make of itself.
- **Acceleration**: the 99th percentile of the landmarks' acceleration as shown (remote) and as the sender's own dancer
  made it (local). They match (139 to 209 against 155 to 239): the remote dancer moves as hard as the real one, not
  smoothed into mush and not jerkier.
- **Outliers**: an earlier lag-40 run (not in the table, conditioner and code identical) had single errors of 200 and
  400 mm. In every run the large errors and the remote's largest accelerations coincide with spikes in the *sender's
  own* landmarks (local max 1,550 to 2,850 m/s² against a p99 near 200), i.e. real jumps in the source: page stalls on
  a 100 %-loaded machine (the mocap runs on the room's wall clock, so a stalled page jumps ahead) and the clip's fast
  ending (the worst moments of the tagged run fell 0.3 to 1 s before the 18.5 s clip loops). The buffer smooths a jump
  in the source over 100 to 300 ms instead of snapping, which is what makes the error large at that instant. I
  attributed these from that coincidence; I did not prove each one.
- **Stills** (side-on camera set the same on both pages before the grab; 960×600, read back with `bend.grab`):
  `docs/reports/media/net-200-page-a.jpg`, `net-200-page-b.jpg` (lag 200/80/10) and `net-40-page-a.jpg`,
  `net-40-page-b.jpg` (lag 40). Each shows both dancers: seat 0 in Violet, seat 1 in Sky, on both pages, dancing the
  couple together. The first run's still from page a, from the director's own angle, had one partner almost hidden
  behind the other, so the script now sets the camera.
- Console: no errors or warnings from either page; `net: room T64225, slot 0 (a jogo seat), server
  ws://127.0.0.1:5417/ws, conditioner {"lag":200,"jitter":80,"loss":10}` on each.

## Running and deploying the server

```bash
npm install
npm start                      # node server/index.ts: 127.0.0.1:5417 (an argument picks the port)
PORT=8080 npm start            # what Railway does: binds 0.0.0.0:$PORT
curl localhost:5417/health     # ok
npm test                       # everything (the integration and smoothness tests start their own server on 5418)
```

Node 22.18 or later runs the TypeScript as it is (type stripping, no flag, no warning on 22.23); `engines` says so.
There is no build step for the server; `railway.json` sets a no-op build command (so Railway doesn't run the game's
Vite build, which needs weft from git), `startCommand: node server/index.ts`, the `/health` check, restart on failure.
`ROOM_GRACE_MS` shortens the reconnect grace (the tests use it). The game finds the server with `&server=wss://…/ws`
in the demo; the default is the page's host on 5417. **Fresh clone check**: cloned the branch into an empty folder,
`npm ci` (2 minutes, weft from git included), `PORT=5419 npm start` printed `Energy Bending rooms on
http://0.0.0.0:5419`, `/health` answered `ok`. Not deployed (as asked), so Railway's own build is untested.

## Honest weak points

- **The loss model is the conditioner's, not TCP's.** A WebSocket never loses a frame; TCP resends it late and holds
  everything behind it (head-of-line blocking), which arrives as a burst. The repeated snapshots help with a future
  unreliable channel (WebRTC data channel) and with the conditioner; on real TCP the buffer's jitter handling matters
  more. Not tested on a real lossy link.
- **The delay is large on a bad link**: 350 ms at lag 200 (the cap), 156 ms at lag 40. For a jogo, where a kick and its
  dodge are one move by two people, the rules already let the dancer being attacked judge the exchange on their own
  screen; still, the other dancer is a third of a second in the past.
- **The in-page pose error only sees the instants that have data.** Errors between snapshots (the interpolation's own)
  are only measured in the Node test, on synthetic signals.
- **Clock sync** under lag 200 / jitter 80 leaves the two clients' clocks 10 to 28 ms apart (min-RTT filtering cannot
  see asymmetric jitter). It moves the beat by that much between the two players.
- **Set pieces are not drawn.** The server and Session keep them; nothing renders or collides with them yet (wave 2,
  and the matter kinds). Nor does anything send `build`, `melt` or `shatter` except the tests.
- **The music clock**: the demo writes `f.beat` from the room's clock, but the audio engine still runs its own clock;
  joining them is the audio agent's.
- **Guests** can't build and have no meters; whether they should is a design question left open (`RULES.build.GUESTS`).
- **Move extras**: I typed what the prototype's author listed; their meaning (for instance `hand` as `'L' | 'R'`, the
  dancer's own side) needs the dancers agent's confirmation.
- `npm test` now takes about 90 s (mostly real time: the intro phases and the 2 × 14 s real-time run).
- The build warns that the main chunk is 500.7 kB (just over Vite's 500 kB line). The net code itself is a separate
  40 kB chunk loaded only with `?net`; I did not check whether the warning was there before my one-line change.

## Not done

- No `wss://` behind TLS tested (the demo used `ws://` on loopback); no Tailscale link for the demo (the brief asked
  for headless checks only).
- Spectator mode without a dancer (a guest is a dancer slot); room listing; authentication; persistence of rooms or
  pieces across a server restart.
- The real-time smoothness test on a quiet machine.
- The prototype's static file serving: the room server serves no files now (the game is a static site elsewhere).

## Edits outside my folders

- `src/main.ts`: one line, the `?net` demo beside `?landmarks` and `?wander` (a dynamic import, so the net code is only
  loaded with the flag).
- `tsconfig.json`: `allowImportingTsExtensions: true` (src/net imports shared/*.ts by its file name, which Node needs)
  and `"shared"` added to `include`.
- `package.json`: scripts `start` and `server` (`node server/index.ts`), `typecheck` now also checks `server/` and
  `test/`, `test` runs the net tests after the limits check; dependency `ws` ^8.23.0 (the server's; it was already
  installed through puppeteer); devDependencies `@types/node` ^22.20.5, `@types/ws` ^8.18.2; `engines.node` >= 22.18.
  `package-lock.json` follows. The client bundle doesn't import `ws`.
- `docs/reports/media/net-*.jpg`: the four stills.

## Commits (on `worktree-agent-a6a66f67db5efbabf`)

1. Net in TypeScript: shared protocol and rules, the room server, Net and LocalNet, ported tests.
2. Smoother remote dancers: repeat two earlier snapshots per pose frame, parabola tangents, a fading bend.
3. NetController, Session and the ?net demo; railway.json and the network guide.
4. The report, the stills, and the demo's probe tagging its worst moments with the clip's time.
