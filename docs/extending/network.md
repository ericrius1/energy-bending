# The network, in plain words

Each player's browser owns its own dancer. It sends that dancer's pose twenty times a second and tells the room
server what it did (a move, an exchange it saw, a piece of matter it set). The server owns everything that is
scored or shared: flow, tension, streak, axé, the power forms, fusion, the phases and their timers, the music's
clock, which world each dancer is in, and the set pieces. Nobody sends a meter's value; the rules
(`shared/rules.ts`) decide what each event is worth, on the server, or in the page when `LocalNet` plays alone.

The duel is the other way round (below, "The duel online"): the server runs the whole duel, bodies and all, and each
page sends only its thumbs.

```
shared/protocol.ts   every message, both ways, as one union each (ClientMsg, ServerMsg); the binary pose codec
shared/rules.ts      the jogo, guests, worlds, building: pure functions over a Session
server/rooms.ts      rooms over WebSockets at /ws, /health; relays poses, routes the rest through rules.route
server/index.ts      the entry: node server/index.ts [port]   (npm start)
src/net/net.ts       Net (the server's client), LocalNet (no server), PoseBuffer (smooth playback), Link (conditioner)
src/net/session.ts   Session: what the game holds (sendPose from a skeleton, remote(), pieces, the beat)
src/net/controller.ts NetController: a dancer posed from the network
src/net/demo.ts      ?net=ROOM
server/duel.ts       the online duels: the duel's code bundled at start-up, DuelRoom (ticks, events, snapshots)
src/net/duel-authority.ts  DuelAuthority: one room's duel stepped by the server (input queues, the judged catch)
src/net/duel-client.ts     DuelClient: one page's side (inputs, its own body predicted and replayed, the other played
                     back, catches felt at once, the events and the mirror); pure, the tests run two of them
src/net/duel-body.ts       a Character into a snapshot and back, an Intent into an input and back, the kit
src/net/duel-entry.ts      what the bundle exports (the server's authority, the tests' clients and brains)
src/duel/online.ts   ?duel&net=ROOM: the page's side (puppets, the mirror, the room's beat, the waiting card)
```

## A room

A room has eight slots. Slots 0 and 1 are the jogo's seats; 2 to 7 are guests, who dance in the same world, are
relayed every pose and move, and take no part in the meters (their moves score nothing, they can't answer or be
answered in an exchange, and they can't build unless `RULES.build.GUESTS`). `hello` asks for a `role`: `player`,
`guest`, or `any` (seats first). A room is made by `hello` with `room: null` (a fresh 4-letter code) or with a code and
`create: true`. A dropped slot is kept for 20 s for its `token`.

## Poses

Binary frames, little-endian: 106 bytes for 13 landmarks (int16 mm in the dancer's frame), the root (int32 mm in the
world), the yaw (a uint16 fraction of a turn), the time (float64 server ms), flags and energy; then the two previous
snapshots (89 bytes each), so that one or two lost frames cost nothing; then the world's id. About 290 bytes a frame,
5.8 KB/s a dancer at 20 Hz (see the report for the wire overhead). The server writes the sender's slot into byte 1 and
relays the frame to everyone else; it never decodes it.

The receiver plays each dancer back about two send intervals plus its jitter behind the newest pose (`PoseBuffer`):
cubic between snapshots, carried on past the newest along its own curve for a short while if the stream runs dry,
held, and every correction blended in so nothing jumps. A new world, a `TELEPORT` flag or a root that moves more than
3 m between snapshots is a cut (a portal), not a slide.

## Events

JSON, reliable, in order. The client sends `move`, `xch`, `form`, `merge`, `fx`, `ready`, `travel`, `build`, `melt`,
`shatter`. The server answers with `state` (on every change and at least once a second), relayed `move`s (with
`from`), `xch` results, `ev` events (`echo`, `unison`, `mergeReady`, `fusion`, `release`, `formOff`, `travel`, `set`,
`expire`, `melt`, `shatter`), `no` (a refusal, with `reason` and for builds `of`), `peer`, `pieces` (the whole list,
once on joining) and `fx`.

A `move` carries what its replay needs. The named extras (`yaw`, `aim3`, `fdir`, `vx`, `vy`, `vz`, `air`, `bpm`,
`hand`: `MoveExtras` in protocol.ts) are type-checked and clamped; any other field is relayed as it came.

## Building

`build { move, kind, points, width, life? }` sets matter into the dancer's world from one of its moves of the last
4 s, which must have started within `RULES.build.BEAT_MS` of an 8th-note line of the room's music, and costs flow
(`pieceCost`: per kind, a base plus per metre of length and of width). `points` is a short polyline in integer mm.
The server keeps the list, caps it per world and per dancer (the oldest goes), expires pieces after their life, and
lets any dancer in the same world `melt` (ice) or `shatter` (ice, gems) one. A late joiner gets the whole list in
`pieces`; `Session.pieces` keeps it current.

## The music's clock

`state.music` is `{ epoch, bpm, mood }`: step 0 of the music at server time `epoch`. `Session.beat(f.beat)` fills
`FrameCtx.beat` from it, so both players hear and see the beat at the same instant (each client's `Net.now()` is the
server's clock, synchronised by pings).

## Adding a message

1. Add it to `ClientMsg` (or `ServerMsg`) in `shared/protocol.ts`, and any event to `RulesEvent`.
2. If it changes shared state, add a handler in `shared/rules.ts` (pure: the session, the slot, the message, now ->
   `{ ok, events }`) and a case in `route()`. Anything a slot may do too often gets a per-slot rate limit there.
3. Test it in `test/rules.test.ts` or `test/room.test.ts` (pure), then over the wire in `test/integration.test.ts`.
4. The server and `LocalNet` both go through `route()`, so nothing else changes. A purely cosmetic message can use
   `fx`, which is relayed as it is.

## Testing with a bad network

Every client honours `?lag=200&jitter=80&loss=10` (ms, ms, percent; loss applies to poses only), or the same
options to `new Net(url, { lag, jitter, loss })`. `npm test` runs the rules, the codec, LocalNet, the server with real
clients, and the smoothness test (virtual time, and real time through the server). `node test/two-pages.mjs` runs the
`?net` demo in two headless browsers against a dev server and reads the measurements from inside each page.

## The duel online

`?duel&net=ROOM` (the front's online duel opens `?duel&net=<ROOM>&world=<w>&dress=<a,b>`, with `&lock` for the side
view; 3D is the default, `&free` is accepted too), optionally `&server=wss://…/ws` (default: the page's own host, as
the jogo's: `src/net/where.ts`), `&set=S` (a set's length), `&bot` (this page's seat played by a virtual player, for
films and tests) and the conditioner. The first to come is seat 1, the second seat 2, anyone after watches (slots 2 to
7: both bodies shown, no thumbs), and past eight the room is full. One alone sees a card with the room's code and its
link to share; it goes when the other comes and comes back if one leaves (a dropped seat keeps its body for the grace,
20 s, and a reload in the same tab takes it back: the token is kept in sessionStorage). The first page's world,
dresses, lock and set length are the room's; a page opened on another world goes to the room's.

**The server is the authority.** `server/duel.ts` bundles `src/net/duel-entry.ts` with esbuild (Vite's) when it starts
(about 100 ms; without esbuild duels are off and a duel's hello gets `error duel`; `DUELS=0` turns them off) and each
duel room runs a `DuelAuthority`: the game's own `Character`s on the duel's profile in the world's arena, `DuelMatch`
(the contact and the rules), `DuelPowers` and the finale's `Finale`, stepped at 60 Hz on the room's clock (tick n is
server time t0 + n × 16.7 ms; the music's epoch is t0 at the world's tempo, so both pages hear the same bar). Online
worlds are those Node can build (`src/duel/stages.ts` NODE_WORLDS: all four); another is refused with a clear reason.
The arena's gentle hazard (the tide, the wind, the swell, the hum) runs on the server after the powers, and each page's
prediction runs it on its own body. The arenas are made once per process and shared, so before a room steps it puts
its own beat and the Pool's stones back on the hazard (`poseHazard`), and a page predicts in the server's own world
(`worldFor`, not the page's World.solids, which is the page's to draw with). The time warp (`match.warp`, the weight of
contact) is the page's own and is off online. `esbuild` is a dependency (not only Vite's) because the server bundles
with it at run time.

**Inputs** (binary, `I`): each tick a page samples its Intent into a numbered input (sticks, buttons as bits, the
camera's yaw, and `view`: the server tick its screen showed the other body at) and sends it with the three before it,
so a lost frame costs nothing (6 + 16 bytes each, 3.9 to 4.1 KB/s up). The server queues them per seat and takes one a
tick; an empty queue repeats the last input without its presses (for a quarter second; then the body stands, so a
hidden tab doesn't run on); past ten the oldest is folded into the next. The client leans its tick rate a few percent
to keep the queue near 3 + jitter / tick.

**Snapshots** (binary, `S`, 20 Hz, about 550 bytes): each body as a pose frame (the jogo's codec: landmarks in its frame,
root, yaw, flags, its move) with its velocity, last ground and the retargeter's hints; `ack`, the receiver's last input
applied; and a JSON tail: the receiver's own body's kit (`kitOf`: the counters and timers a replay needs), its queue,
the rules' fast numbers (energy, merge, peak, the stretch near the top, each seat's ground), the link, the fling in
flight, the powers' clock and live effects (with their temporary solids), the finale. **The rest of the rules' state**
(`dst`, JSON, reliable) goes only when it changes, as the fields that changed (`full` on joining). **Events** (`dev`,
JSON, reliable): each tick's rules', contact's and powers' events and the powers' moments, one message to everyone,
so every page plays the same events in the same order. `droom`: who sits and whether the set runs.

**On the page** (`DuelClient`, `src/duel/online.ts`): this seat's body is a real `Character` stepped with the same
inputs at the same tick as the server's, so it answers at once. At each snapshot the prediction for the acknowledged
input is compared with the server's body; off by more than 2 cm (or in the kit: grounded, the air jump, the dash, the
wall), the body goes back to the server's state there and the later inputs are stepped again, the shift on screen
eased out over about 90 ms (a jump of metres is a cut). The other body is played back by the jogo's `PoseBuffer`
(about two snapshot intervals plus jitter in the past). While the two are joined or this body is carried (a power,
the finale), this body is shown from the snapshots too, in the same past as the other, so the hands that hold meet on
screen. The page's two `Character`s are puppets of what is shown; the server's rules' state, link, powers and finale
are copied into the page's `DuelMatch`, `DuelPowers` and `Finale` each frame, and index.ts plays the server's events
exactly as it plays the local duel's.

**Catches** are judged where the catcher saw them. A grab pressed with this body's hand within reach of the other as
shown is felt at once (its CATCH, its sound, its flash: `local` events), and the input carries the tick that was
shown; the server tests the catch against the other body as it was at that tick (up to 600 ms back, and only while the
other is still within 2.2 m of the hands: the rope then pulls it in) when the present misses it. The server's own catch
event then confirms it and is not played twice; a mutual catch (both at once, the other's hand first) joins all the
same; no confirmation within rtt + 400 ms or 14 ticks is a denial (nothing of the body was changed for it).

**Measuring.** `node test/duel.test.ts [seconds]` (in `npm run test:net`): codecs, a whole set in the authority (the
tick's cost), two virtual players over the real server at 0, 80 and 200 ms of lag (bytes, the prediction's error at
each acknowledged input, corrections, catches felt and confirmed, the two event logs compared), watchers, refusals, a
dropped seat. `node test/two-duel-pages.mjs --lags 0,80,200` does the same with two headless Chromes on the GPU
(`bend.duel.net.stats()` in each page, `/duels` on the server). docs/reports/14-online.md has the numbers.

**Adding to it.** A rule or a power changes in `shared/duel.ts`, `shared/powers.ts`, `src/duel/*`: the server runs the
same code (restart it). A new field the page must see goes in the authority's `shared()` (each snapshot) or
`slowParts()` (when it changes) and in the client's mirror; a new kind of event is already carried (`dev` takes them
as they come). A new world online needs a Node build of it in `src/duel/stages.ts`.
