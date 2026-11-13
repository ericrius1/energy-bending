# net (wave 1: net)

`Net` and `LocalNet`: the room server's client, a jitter buffer for the other player's poses (13 landmarks at 20 Hz,
src/skeleton/landmarks.ts), move start events, and the shared music clock (src/audio/clock.ts `BeatClock.syncTo`).
The remote player is a `NetController` (a LandmarkController fed from the buffer). The message types live in
`shared/protocol.ts`, the server in `server/`.
