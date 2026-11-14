# Phase 3, juice: online duels, server authoritative

Two people on two devices in one duel: `?duel&net=ROOM`. The room server runs the whole duel itself (the bodies, the
contact, the powers, the rules, the finale) at 60 Hz. Each page sends only its thumbs, predicts its own body at once,
plays the other back from the server's snapshots, and plays the server's events. Both pages agreed on every event in
every run measured (Node and two browsers, 0 to 200 ms of lag). The full sim on the server is cheap: a tick costs 0.2
to 0.6 ms mean and 0.5 to 1.9 ms at p99, of 16.7 ms.

Branch: `worktree-agent-af5b09554b3a71e21` (master merged in, with the front menu and the juice). Not pushed, not
deployed.

## The address, as built

```
?duel&net=ROOM[&world=temple|geode|pool][&dress=a,b][&lock | &free][&set=S][&server=wss://…/ws][&bot][&lag=&jitter=&loss=]
```

- `ROOM`: 3 to 8 letters or digits, any case (the front's `FERN42` works). The first page to come makes the room.
- `&server`: the default is the jogo's (`src/net/where.ts`): a build's `VITE_ROOMS`, else the page's own host `/ws`
  (Railway serves the page and the rooms together), else `:5417` in development.
- `&world`, `&dress`, `&set`: the first page's are the room's. A page opened on another world goes to the room's
  (`location.replace`), and the room's dresses are put on.
- `&lock` sets the side view for the room; the default is 3D (`&free` is accepted and means the same). Online the `l`
  key changes only this page's view, because the bodies are the server's.
- Seats: the first to come is seat 1 and the second seat 2. **A third joins as a watcher** (slots 2 to 7): it sees
  both bodies and the HUD and sends nothing. A ninth gets `full`. A duel's hello to a jogo's room (or the other way)
  is refused with `mode`. A world the server can't run online is refused with `duel` and a reason the page shows.
- Alone in the room, the page shows a card: the room's code, "you are dancer 1: waiting for the other", and a button
  that copies the link. The card goes when the other comes. It comes back if one leaves ("the other dancer left").
- A dropped seat keeps its body for 20 s. A reload in the same tab takes the seat back, because the token is kept in
  sessionStorage.
- `&bot` plays this page's seat with a virtual player through the same inputs a person sends (for tests and films).

## The design

**Could the server run the full sim? Yes.** The Node harness already ran whole duels, and the server needed no
alternative. `src/net/duel-authority.ts` steps the same objects as the page and `sim.ts`: two `Character`s on the
duel's profile, `DuelMatch`, `DuelPowers` and `Finale`, in the world's arena from `src/duel/stages.ts`.

Node can't run the game's TypeScript as it stands (imports without extensions, parameter properties). So
`server/duel.ts` bundles `src/net/duel-entry.ts` with esbuild (Vite's) at start-up, in about 100 ms, and imports
it. If esbuild is missing, the server still serves the jogo and the site, and a duel's hello gets `error duel`.
`DUELS=0` turns duels off.

- **The clock.** Tick n is server time t0 + n × 16.67 ms. The music's epoch is t0 at the world's tempo, so both pages'
  beats (and the music, through `music.syncTo` as the jogo does it) fall on the same bar.
- **Inputs** (binary `I`, 16 bytes each, every tick, each frame repeating the three before it). Sticks, buttons as
  bits, the camera's yaw, and `view`: the tick the sender's screen showed the other body at. The server keeps a short
  queue per seat and takes one input a tick. An empty queue repeats the last input without its presses for a quarter
  second; after that the body stands (a hidden tab sends nothing). The client leans its tick rate by up to 3 % to keep
  the queue near 3 + jitter/tick.
- **Snapshots** (binary `S`, 20 Hz, about 550 to 600 bytes). Both bodies as the jogo's pose frames (landmarks, root,
  yaw, flags, move) plus velocity, last ground and the retargeter's hints. Also the receiver's `ack` (its last input
  applied) and a JSON tail:
  - its own body's kit: the counters and timers a replay needs, as a flat array
  - the rules' fast numbers
  - the link and the fling in flight
  - the powers' live effects and their temporary solids
  - the finale
- **The rest of the rules' state** (`dst`) goes only when it changes, as the fields that changed (about 1 KB/s).
  **Events** (`dev`): each tick's rules', contact's and powers' events in one reliable message to everyone.
- **Prediction.** The page's own body is a real `Character`, stepped with the same inputs on the same tick length as
  the server's. At each snapshot the page compares its prediction for the acknowledged input with the server's body.
  If they differ by more than 2 cm, or in the kit (grounded, the air jump, the dash, the wall), the body goes back to
  the server's state and the later inputs are stepped again (`saveChar` / `loadChar`, a whole Character).
  - The shift on screen eases out over about 90 ms. A jump of metres (a fall, a reform) is a cut.
  - The body faces the other where the server has it now (the newest snapshot carried on by its velocity), not as
    shown. Facing toward the other steers moves and dashes, and facing the shown, older position was a source of
    divergence.
- **The other body** is played back by the jogo's `PoseBuffer`, about 115 to 250 ms in the past.
- **Joined or carried.** While the two are joined, or this body is carried (a power's launch, ride or reel, the
  finale), this body is shown from the snapshots too, in the same past, so the holding hands meet on screen. It eases
  in and out over 120 ms.
- **Catches feel immediate to the catcher.** A grab pressed with the predicted hand within reach of the other as
  shown is felt at once: CATCH, the sound, the flash, the HUD pop, as `local` events. The input carries the shown
  tick. When the present misses, the server judges the catch against the other body as it was at that tick: up to
  600 ms back, and only while the other is still within 2.2 m of the hands (the rope then pulls it in).
  - The server's catch event confirms the felt one and isn't played twice.
  - If both grabbed at once and the other's hand was first, the two are joined all the same ("mutual").
  - No word within rtt + 400 ms or 14 ticks is a denial. A felt catch changes nothing of the predicted body, so a
    denial costs no correction.
  - The client also keeps the server's re-grab rule (0.35 s after a fling, counter or lift), so it doesn't feel a
    catch the server would refuse.
- **The page** (`src/duel/online.ts`, joined to `index.ts` by a few lines). The page's two Characters are puppets of
  what the client shows. The hands are laid on the contact by the match's own pose pass. The server's rules' state,
  link, powers (flow, the form's time left, live effects, solids) and finale are copied into the page's `DuelMatch`,
  `DuelPowers` and `Finale` each frame. `index.ts` then plays the events as in the local duel: fx, power-fx, the HUD,
  the juice. The time warp (the weight of contact) is the page's own and is off online: the bodies' time is the
  server's, the same on both pages.

## The numbers

**The server's tick** (`/duels`, `DuelAuthority.stats()`). In process with two virtual players' inputs, a whole 20 s
set (1,490 ticks): 0.19 to 0.24 ms mean, 0.48 to 0.82 ms p99, 0.9 to 2.8 ms max. In the server process with two
clients and snapshots, the hazard included: 0.29 to 0.60 ms mean, 0.53 to 1.9 ms p99, at most 7.4 ms once. A tick is 16.7 ms, so one core could run dozens of
rooms. The machine was busy with other agents throughout, which inflates the maxima.

**Bytes a second, per page:**

| | measured |
|---|---|
| down | 10.6 to 12.6 KB/s (snapshots about 9 to 10; events and state changes 1.2 to 3.4) |
| up | 3.9 to 4.1 KB/s |
| the server, per room | 24 to 28 KB/s sent |

Wire overhead (TCP, TLS) is not counted. The jogo's pose stream is 5.8 KB/s per dancer for comparison.

**Prediction error and corrections**, measured at each acknowledged input (each snapshot), in steady play where only
this page's thumbs moved the body. A separate count covers snapshots where the other or a power moved it (the server
flags them `PUSHED`). Since master's arenas came in, the temple has its tide. The server steps the hazard, and each
page's prediction steps it on its own body.

Node, two `DuelClient`s through the real server (`node test/duel.test.ts`, the final `npm run test:net`, the temple
with its tide; 14 s measured):

| lag | page | error p50 / p95 / max (mm) | moved by the other or a power: n, max | corrections /s | catches felt / confirmed / mutual / denied | server queue: starved |
|---|---|---|---|---|---|---|
| 0 | 0 | 0.5 / 1.1 / 28 | 5, 41 mm | 0.29 | 2 / 1 / 0 / 1 | 2 |
| 0 | 1 | 0.4 / 1.1 / 1.8 | 5, 210 mm | 0.36 | 1 / 1 / 0 / 0 | 2 |
| 80 | 0 | 0.7 / 2.7 / 29 | 14, 441 mm | 1.0 | 6 / 3 / 2 / 1 | 13 |
| 80 | 1 | 0.6 / 2.0 / 427 | 15, 3.1 m (a fall) | 1.07 | 3 / 3 / 0 / 0 | 8 |
| 200 | 0 | 1.7 / 7.0 / 41 | 5, 73 mm | 0.36 | 5 / 4 / 0 / 1 | 27 |
| 200 | 1 | 0.4 / 1.5 / 3.0 | 4, 144 mm | 0.29 | 2 / 0 / 1 / 1 | 14 |

Two headless Chromes on the RTX 5090 (`node test/two-duel-pages.mjs`, `&bot` on both pages, the temple, 20 s measured
after 6 s of play, jitter a fifth of the lag). There are two runs. The first was before the arenas' hazards came in
from master; the second is after, with the tide predicted.

| lag | page | before the tide: p50 / p95 / max (mm), corrections /s | with the tide: p50 / p95 / max (mm), corrections /s | catches felt / confirmed / mutual / denied (with the tide) | delay | events alike (with the tide) |
|---|---|---|---|---|---|---|
| 0 | a | 0.6 / 1.3 / 82, 0.5 | 0.6 / 1.6 / 88, 0.6 | 7 / 5 / 2 / 0 | 119 ms | 97 of 97 |
| 0 | b | 0.4 / 1.1 / 215, 0.4 | 0.5 / 2.2 / 78, 0.75 | 1 / 1 / 0 / 0 | 118 ms | |
| 80 | a | 0.5 / 1.9 / 611, 0.5 | 0.6 / 781 / 1179, 1.9 | 5 / 3 / 2 / 0 | 164 ms | 76 of 76 |
| 80 | b | 0.5 / 1.3 / 424, 1.1 | 0.6 / 230 / 825, 2.05 | 4 / 3 / 1 / 0 | 157 ms | |
| 200 | a | 0.5 / 4.7 / 88, 0.3 | 0.6 / 139 / 866, 2.4 | 9 / 4 / 1 / 4 | 238 ms | 67 of 67 |
| 200 | b | 0.6 / 2.0 / 1154, 0.35 | 0.8 / 98 / 871, 2.75 | 0 / 0 / 0 / 0 | 243 ms | |

Rtt was 0 to 1, 82 to 87 and 196 to 217 ms. Bytes didn't change with the tide: down 12.4 to 13.3 KB/s, up 4.1 KB/s.
Stills (640×400, low quality, the HUD composited), from the run before the tide:
`docs/reports/media/duel-net-200-a.jpg` and `-200-b.jpg` (a swing at 200 ms, from both pages, at the same set clock),
`duel-net-0-a.jpg`.

What the numbers say:

- **Half the time the prediction is exact** to half a millimetre. The p95 is a few millimetres in every Node run, and
  in the browsers before the tide.
- **What's left is corrections about once a second or less.** They come from inputs the server didn't have in time:
  a starved queue repeats the last input, and the body then moves one tick more than predicted. A few come from errors
  of half a metre to a metre: a fall's reform, the other's fling at the moment of release, a vault. Most of those are
  flagged and counted apart; a few still land in the steady count.
- **With the tide, the browsers at 80 and 200 ms got worse**: p95 0.1 to 0.8 m and 2 to 2.75 corrections a second. The
  Node clients at the same lags, with the same client code and the same tide, stay at a few millimetres. I didn't find
  the cause in time. It is the first thing to look at (see "Not done").
- **Catches.** Of 38 catches felt across the first twelve page-runs, the server confirmed 23, 8 were mutual (joined
  all the same), 6 were denied and 1 was still pending when the run ended. The server judged catches where the
  catcher saw them 1 to 8 times a run. Its refusals (`refused` in `/duels`) were mostly grabs pressed out of reach
  anyway ("miss"), a link already there ("joined"), the other gone past 2.2 m ("far"), or the re-grab pause.
- **Both pages agreed on every event**, in order, in every run. That holds by construction, since one message goes to
  everyone, and the test checks it line by line.

## Checks run

- `npm run typecheck`: clean.
- `node scripts/test-ts.mjs`: 16 of 16 files pass.
- `npm run test:net`: everything passes in the final run, including the new `test/duel.test.ts` (8 checks).
- `test/smoothness.test.ts` (the jogo's real-time run B) failed its tracking bound in some runs on this loaded machine
  (frame stalls of 90 to 540 ms in the test process). It passed with `DUELS=0`, then failed and passed again with
  duels on, so I attribute it to load, not to this work. It passed in the final run.
- In a browser:
  - one page alone shows the card and its link
  - a Node client joining hides the card and starts the set on the page
  - the card comes back when the client leaves
  - a page opened with another world (`temple`) went to the room's (`geode`)

## Not done, and honest weak points

- **The browsers' prediction with the temple's tide at 80 and 200 ms** is worse than the Node clients' (above):
  probably something of the page's own world or hazard that the Node client doesn't have, but unconfirmed. The
  hazard's per-body state (in the water, a hum's lift) isn't saved for a replay either.
- **The caster's own powers aren't predicted.** A flare's rocket jump, a pillar's launch or a geyser's ride is the
  server's, so the caster's body is shown from the snapshots while it is carried. The launch therefore shows about
  rtt + playback delay late on the caster's own screen (300 to 450 ms at 200 ms of lag). Predicting them means running
  `DuelPowers` on the page for its own seat. Dashes, jumps, wall kicks and runs are predicted.
- **While joined, both bodies are shown in the past**, including the base's own. The base's thumbs pump the swing, and
  the pump is felt about a round trip late. The held body is the server's.
- **A link's own pop** (a dash, a wall jump: the rules' `link` events) comes from the server, about a round trip late.
  Only the catch is felt at once.
- **Online worlds are the temple, the geode and the pool.** These are the worlds Node can build in
  `src/duel/stages.ts`. The redwoods need their whole layout in Node: they are refused with a reason the page shows.
- **No virtual player for an empty seat on the server.** A page alone waits.
- **The lock is the room creator's**, and `l` online only turns this page's view.
- **The time warp is off online.** It is the page's own presentation, and the server's time doesn't hold for it.
- **Not deployed.** It needs Railway to keep esbuild (a devDependency, installed for the build) at run time. If it
  doesn't, duels are refused with `error duel` and everything else works. Not tested over a real network, a phone, TLS
  (`wss`), or Safari's own JavaScript engine (prediction doesn't assume bit-identical math, only within 2 cm).
- **Watchers** are tested in Node (they get both bodies, no ack, no kit), not in a browser.
- **Test harness:** a second headless Chrome started while the first page renders can freeze the first page's frames.
  `test/two-duel-pages.mjs` launches both browsers before loading pages and works; an ad hoc script that didn't froze.
- The jogo's tracking check in `smoothness.test.ts` is flaky on a loaded machine (see Checks run).

## Files

- New:
  - `server/duel.ts`
  - `src/net/duel-authority.ts`, `src/net/duel-client.ts`, `src/net/duel-body.ts`, `src/net/duel-entry.ts`
  - `src/duel/online.ts`
  - `test/duel.test.ts`, `test/two-duel-pages.mjs`
  - this report, and `docs/reports/media/duel-net-*.jpg`
- Changed:
  - `shared/protocol.ts`: the duel's wire (`DUEL_NET`, `DuelHello`/`DuelWelcome`, input and snapshot codecs, `dev`,
    `dst`, `droom`, error codes `mode` and `duel` with a `why`)
  - `server/rooms.ts`: duel rooms, `/duels`, the duel pump
  - `server/index.ts`: `DUELS=0`
  - `src/net/net.ts`: `sendBinary`, `onFrame`, `connect({ duel })`, `Net.duel`
  - `src/net/README.md`
  - `docs/extending/network.md`: "The duel online"
- Outside my folders, by necessity:
  - `src/duel/index.ts`, the online branch: `startOnline` after the seats are made, the travel tick's `net.frame`,
    no bots, lobby or warp online, `bend.duel.net`
  - `src/main.ts`, one line: `?duel&net` no longer also starts the mocap `?net` demo, which would have joined the same
    room code as a jogo
  - `package.json`: `test:net` runs `test/duel.test.ts`
- Master merged in twice: the front menu and the juice, then the arenas' hazards. Online the lobby is the room's card,
  the time warp is off, and the server steps the hazard (`DuelHazards`) after the powers, as `sim.ts` does.
- No change to `shared/duel.ts`, `contact.ts`, `match.ts`, `sim.ts`, the hazards or the powers. The authority reads a few private
  fields of `Contact`, `DuelPowers` and `Character` by name: the judged catch makes its link as `Contact` does, as
  `DuelPowers.join` already did.
