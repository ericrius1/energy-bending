# The network, in plain words

Each player's browser owns its own dancer. It sends that dancer's pose twenty times a second and tells the room
server what it did (a move, an exchange it saw, a piece of matter it set). The server owns everything that is
scored or shared: flow, tension, streak, axé, the power forms, fusion, the phases and their timers, the music's
clock, which world each dancer is in, and the set pieces. Nobody sends a meter's value; the rules
(`shared/rules.ts`) decide what each event is worth, on the server, or in the page when `LocalNet` plays alone.

```
shared/protocol.ts   every message, both ways, as one union each (ClientMsg, ServerMsg); the binary pose codec
shared/rules.ts      the jogo, guests, worlds, building: pure functions over a Session
server/rooms.ts      rooms over WebSockets at /ws, /health; relays poses, routes the rest through rules.route
server/index.ts      the entry: node server/index.ts [port]   (npm start)
src/net/net.ts       Net (the server's client), LocalNet (no server), PoseBuffer (smooth playback), Link (conditioner)
src/net/session.ts   Session: what the game holds (sendPose from a skeleton, remote(), pieces, the beat)
src/net/controller.ts NetController: a dancer posed from the network
src/net/demo.ts      ?net=ROOM
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
