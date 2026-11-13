# net

The game's side of the network (protocol and rules in `shared/`, the room server in `server/`, the whole story in
`docs/extending/network.md`).

- `net.ts`: `Net` (the room server's client), `LocalNet` (the rules in the page), `PoseBuffer` (smooth playback of
  another dancer's poses), `Link` (the conditioner, `?lag=&jitter=&loss=`). Pure: Node runs it in the tests.
- `session.ts`: `Session`, what the game holds: `connect`, `slot` / `seat`, `state`, `on`, `move`, `send`,
  `sendPose(skeleton)`, `remote(rig, slot?)`, `pieces`, `beat(f.beat)`.
- `controller.ts`: `NetController`, a `LandmarkController` fed from `net.remotePose(slot)`: the remote player is
  just another dancer.
- `demo.ts`: `?net=ROOM` (two pages, one room, the salsa couple across the network, measured from inside the page).
