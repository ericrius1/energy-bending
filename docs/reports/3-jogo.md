# Wave 2: the jogo

`src/play/` makes the parts a game. Two dancers play a jogo through the rules (shared/rules.ts) over a `Session`: the
moves go to the rules judged against the beat, every attack is replayed and judged by the dancer it comes at, and what
the rules decide is felt in the world (a slow breath and a bright trail for a dodge, matter thrown and a ring for a
clash, a soft comic knock for a hit), the tension climbs as a thread of light between the two, the invitation draws
them together, and fusion makes them one event for eight bars on the music's bar line, then releases them. Moves on the
beat set matter into the world (ice bridges, ice spires, crystal ledges, rings of flame) shared through the room. Same
screen, against a partner (a stand-in today, src/ai's brain behind an adapter), online (two browsers proved against a
real room server at lag 150), and a scripted jogo from JSON for films and tests, deterministic with `bend.step`. The
front of the game is icons and swatches; nothing is on screen during play but the meters in the world.

Branch: `worktree-agent-a9723fd789eef43c3` (commits listed at the end). Guide: `docs/extending/play.md`.

**Measured:** `npm run typecheck` and `npm run build` clean; `npm test`: limits, every src test (the jogo's 16 checks and
its 3 script runs among them), audio, the gates' algebra (see "Tests" for a worktree note) and the net tests; a 44 s
film of the Pool jogo with its score (film.mjs, 30 fps, 1280×720), looked at as a contact sheet and as single frames of
the dodge, the hit and the fusion; stills of the HUD at rest, at full tension and at merge, of an ice bridge laid by a
cartwheel and stood on, of the results, of the menus; two headless browsers online against `server/index.ts` with the
conditioner at lag 150 (each page's history of the same exchanges, both clocks, the playback delay). **Not measured:**
anything by ear (the film has its score; nobody listened), a real gamepad (rumble is called, never felt), a second
human, a phone or touch screen, a real network, the geode film (stills only), the redwoods/temple/forge.

## How the loop works on the client

```
Room (room.ts)        a Session over Net (online, one seat) or SteppedLocalNet (both seats; the rules in the page on a
                      clock the jogo moves by each frame's dt, pumped after every message, so stepping repeats exactly)
Jogo (jogo.ts)        pure (Node-tested). Each frame:
  input  jogo.clock(dt)   the room's clock on; FrameCtx.beat = the room's music clock; the music follows it
                          (music.clock.measure + engine.syncTo, so music.fusion(kind, t0) lands on the room's bar)
  travel jogo.update()    each local Character's events (taken and cleared: nothing else drained them) →
                          moves to the rules: id, start time, every replay extra; `perfect` = |beat error| ≤
                          RULES.PERFECT_MS on the 8th-note grid (music.beatError(heardTime, 2) live; the room's grid
                          when stepped by hand, where the audio clock is not the frames'); jumps too (rate-safe)
                          exchanges: every live attack of the other seat (its relay) is replayed with Character.shapesAt
                          at (now − the playback delay of that seat − its start), resolveExchange against the local
                          defender (flattened onto the locked plane), foldExchange over the active window; hit / clash
                          / parry reported at once, dodge / near when the window closes; felt here first, the room's
                          echo not felt twice
                          merge (held + distance, on change and every 150 ms), form (the button asks; state.form
                          answers), build (when the move is done), ready (at the end)
                  then    feel, fusion, hud, flow, pieces read this frame's events
  camera                  fusion stands back; online, the pose out (20 Hz)
  post                    the jogo's glows up to the GPU
```

The jogo draws its own light with one instanced draw (`glow.wgsl`): points, segments, rings and tall faceted gems,
additive in the main view's scene after everything else that glows (added to `main.scene` after `declareScene`; the
glow phase is last). Up to `LIMITS.glows` (8,192) a frame; a frame of the Pool jogo used 77 to 130 outside fusion.

## What each exchange looks and sounds like (feel.ts)

| result | seen | heard / felt |
|---|---|---|
| dodge | the dance slows to 0.28 for 0.3 s and eases back (`danceParams.speed`; matter keeps its pace); a bright trail drawn along the path the attack's tip took (16 replayed samples), hot white into the attacker's colour, fading over 1.1 s; sparks drifting up where it passed closest | `sfx('dodge', { element, count: streak })`; rumble 0.28 |
| clash / parry | where the limbs met: each body's element thrown into the field (heat from fire, 1.6 from plasma, wet from water, cold from ice, and a ring of outward wind), so fire meeting water steams; an arc from a plasma hand through the meeting point; a white flash, a ring of light, 16 sparks in both colours falling under gravity | `sfx('clash'|'parry')`; rumble both |
| near | ten small flickering lights along the body where it passed | `sfx('near')` |
| hit | `applyKnock` away from the attacker (3 m/s along the stage, 3.2 up, 0.42 s stagger), the air round the body blown outward (its flames or water shed), three little gem-stars circling the head for a second, a soft puff | `sfx('hit')`; rumble 0.8 |
| echo / unison | rings out from both dancers' feet | `sfx('echo'|'unison')` |
| each move | (the gold ring at the feet if perfect, hud.ts) | `sfx('move', { move, element, perfect })` |

Perks, every frame, for the bodies this page plays: the form eases to state.form over 1.3 s (`formOn`/`formOff`
sounds); fire's `env.updraft` from the field's updraft under it (`field.updraft`) and from rings of flame; water's
`env.carryX` (its floor wave carries it the way it runs, 0.9 m/s) and ripples on the pool's and temple's water where it
steps or lands; ice lays frost at each step (a pale disc, cold into the field) and frost is slick (`env.slick` 0.8 for
anyone on it, 0.55 for ice itself); plasma's dodge blinks (`env.blink`), and arcs reach from its hands to the partner
within 1.5 m on 30 % of frames.

## Fusion (fusion.ts)

Scheduled by the rules when both hold merge within 0.5 m at the top; it lands on the next bar line, for 8 bars.
- **Gathering** (until the bar line): `music.fusion(kind, t0)` arms the drop for that bar; light is drawn out of both
  bodies toward the shared centre.
- **Landing:** a flash and a ring on the floor; `field.vortex('fusion')` at the centre (4.5 m/s, lift 0.7, 1.6 for
  steam), so flame, water, steam and spray turn round the pair; **the loadouts mix**: each body takes 32 % of the
  other's kinds, then 50 % from 40 % of the way (`show.setLoadout`; the water pool and flame pool re-home their
  particles, so matter visibly flows between the bodies); the locked view stands back (`CameraRig.framePad` 0.9 m), a
  free view orbits slowly.
- **The eight bars:** 180 short streaks pour out of each body (from eleven joints), twice round the shared centre and
  into the other, coloured from one body into the other through the kind's palette. The kind adds:
  steam (fire + water) heat and wet poured into the middle, a turning column of steam; prism (fire + ice) glints of every
  colour on the spiral and a white core; storm (plasma + water) arcs from the centre to both bodies and through the
  vortex, falling drops; aurora (plasma + ice) curtains of green, teal and violet rising round the pair.
- **Release** (the rules' `release`): loadouts back, the vortex off, `music.release()`, eight ripples and one big one on
  the world's water, a ring of sparks expanding on the air, outward wind, the dancers pushed apart.

The FrameCtx `tension` (and `music.tension`) is the eased tension, held at the top while the fusion lasts.

## Building (build.ts)

A flourish, not a menu: a building move that lands **perfect** sets its piece by itself once the dancer's flow is 62
or more, and before that a tap of the build button (Intent.interact: G, the d-pad up) within 0.7 s of the move asks
for it. Sent as `build` when the move is done (the path is known), checked by the rules (on the beat, flow paid), laid
by every page on `set`.

| body | move | piece |
|---|---|---|
| ice | aú (cartwheel) | an arch of set ice over the cartwheel's path, 0.45 m wide, its top 1 m up: stood on (set ice's ledges, in flat steps) |
| water | spin / pirouette | an ice spire, 2.1 m |
| gems | a jump that lands on the beat (a stomp) | a crystal ledge 1.1 m over the landing, 1.4 m long, drawn as a row of gems of light: stood on |
| fire | spin, macaco, aú | a ring of flame (tongues of light, heat into the field) that lifts anyone in it (`env.updraft`) |

Ice melts by a fire or plasma dancer near it (`setIce.warm` at once, `melt` to the room) and shatters by a kick
through it; a ring of flame is doused by water or ice (`melt`) and broken by a kick. Gem and fire pieces are this
folder's glows, not matter of their kinds (the cheap path): a real crystal ledge would be gems fixtures laid at runtime
(the gems kind places fixtures only at start), and a real ring of flame a fire emitter not on a body (the flame pool
births only at homes on capsules). Pieces of another world are kept by the room and laid again when the jogo arrives
there.

## Session flow (flow.ts)

waiting (a ring breathing at the feet; online, the room's code top right) → intro (the dancers re-form at their spawns,
matter rising; the last bar counts in: four ticks on the beat, four pulses of light) → play → fusion → release →
finale (its sound) → over: the results with no text. The axé is a count of gems (one per 40, 6 to 140) raining into a
ring round the dancers along the stage, fusions as larger gold gems, the best streak as a ribbon of light winding up
round the ring; the locked view stands back for it. Both pressing jump, strike or kick says ready (each ready dancer's
ring lights), and the next jogo starts.

## Travel

A seat's dancer crossing a gate pauses the jogo (no moves or exchanges go to the rules) and frees the view; when both
seats' dancers are in the world the main view shows, the jogo goes on there: locked again to that world's stage if it
was locked, its set pieces laid. Online, this page's own crossing is sent as `travel`. Tested in Node (the message, the
pause); **not run** in a browser with two dancers walking through a gate.

## Modes and the front (index.ts, menu.ts)

- `?jogo=same`: a lobby (two cards; the first device to press plays dancer 1, its glyph shows; the jogo starts 1.6 s
  later); dancer 2 is the partner until a second device presses, then it is theirs.
- `?jogo=partner`: the same, dancer 2's card shows the partner.
- `?jogo=online&room=CODE[&create][&watch]`: one seat; the other through a `NetController`; each page tells the other
  what it wears (a relayed `fx`); `&watch` dances as a free guest with both seats shown.
- `?jogo=script&script=NAME`, `bend.jogo.run(obj)`.
- `&world=`, `&dress=a,b` (seat order), `&free` (3D; the side view is the default).
- A plain page shows the front over the show: four modes (together, partner, online, solo = `?play`), five worlds (the
  geode hub first: walking through its gates is the level select), a row of living swatches per dancer (the presets),
  side / 3d, go; online: new room (code and link), join by code, watch. Esc goes back from anywhere.

The partner adapter: `Brain { think(view: PartnerView): Intent }`, `BrainSource` makes any brain a device, and
`bend.jogo.setPartner(brain)` swaps it in. The stand-in keeps 0.95 m, answers on the 8th lines (a kick, a cartwheel, a
spin, a strike now and then), dodges 80 % of attacks after a 60 to 120 ms "reaction", takes its form past 45 flow,
comes in and holds merge at the invitation, says ready at the end. Deterministic (choices from the beat).

## The HUD (hud.ts)

The tension is a thread between the dancers' chests, slack when calm, filling from both ends in each dancer's colour;
at the top it draws taut and light runs along it from both ends to the middle on every beat, gold while both hold
merge (that is the invitation). The streak is beads on the thread (the newest flashes). Each dancer's flow is an arc on
the floor round its feet (brighter past the form's threshold, a breathing full ring in form). Each beat pulses the
arcs; a perfect move sends a gold ring out from the feet. Full brightness locked, 0.45 free; hidden during a fusion and
between worlds.

## Scripted play

`src/play/scripts/*.json`: `{ world, lock, dress, cues: [{ at (beats from play), seat (0, 1, "both"), move, press,
hold + for, goto, place, build, tension }] }` (docs/extending/play.md). A script waits for the first frame stepped by
hand, so frame 0 of a capture is the room's first. Shipped: `pool-fire-water` and `geode-fire-water` (the same jogo;
in the geode, water takes its ice form at beat 24, so the fusion is prism), `geode-ice-bridge`.

## Tests

`npm test`: limits (14 caps), the src tests (dancers 28 + 4, input 18, **jogo 16, scripts 3**), audio 20, the gates'
algebra, the net tests. Two notes, honestly: (1) in this worktree `check-portals.mjs` could not find weft's sources
(the worktree has no `node_modules` of its own; it resolves `<worktree>/node_modules/@ericrius1/weft/src`); with a
junction to the main checkout's `node_modules` it passed (10,012 checks). (2) The net tests' real-time smoothness
check `B: no discontinuity on unstalled frames` failed once while my film was rendering (the machine was busy; the
net report describes this test as load-sensitive); the other ten passed. Not re-run on a quiet machine.

```
ok  a kick that lands on a stander is reported once, as a hit, by the dancer attacked  (hit at 0.267 s, tension 2)
ok  an esquiva under the kick is a dodge, reported when the active window is over (folded)  (dodge at 0.417 s (window ends 0.335 s); streak 1, tension 12)
ok  a block raised just before the push lands is a parry (reported at once: decisive)  (parry at 0.350 s, streak 2)
ok  an attack that comes nowhere near is not reported
ok  two attacks at once: each defender reports the other's, and each one is reported once  (1->0:hit, 0->1:clash)
ok  a move on an 8th-note line is perfect; 100 ms off is not (RULES.PERFECT_MS)  (on -4.8 ms → perfect; off 107.1 ms → not)
ok  the room starts in intro and plays from a bar line at least 3 s later  (phases intro → play; play from bar 2)
ok  at the top: the invitation, then both holding merge within reach fuses on the next bar line for 8 bars  (steam, released)
ok  the session plays out: finale, over with results, and both ready starts again
ok  an ice dancer's perfect cartwheel at high flow sets an ice bridge through the rules  (7 points, top 1.00 m, flow paid)
ok  a shatter goes through the room and takes it away for everyone
ok  a gem dancer's stomp on the beat (the build button tapped) grows a crystal ledge another dancer stands on  (ledge at 1.10 m; dancer 2 on it)
ok  a fire dancer's perfect spin sets a ring of flame that lifts whoever is in it, doused by ice  (updraft at its middle 1.00)
ok  travel moves the jogo's world; while paused nothing goes to the rules  (world pool)
ok  the stand-in partner dances a jogo: moves of its own, and the kicks at it answered  (27 moves, 11 exchanges, tension 72)
ok  a scripted jogo stepped twice gives the same moves, exchanges and positions
ok  pool-fire-water: dodge, echo, near, hit, clash, unison, dodges, parry, invitation at beat 25.8, steam fusion, release at 64.1
ok  geode-fire-water: the same, water's form on at 24, prism fusion
ok  geode-ice-bridge: the cartwheel lays a bridge (beat 12)
```

## What the captures show (docs/reports/media/3-jogo-*.jpg)

| file | what it shows | verdict |
|---|---|---|
| `3-jogo-pool-film-sheet.jpg` | the 44 s Pool film, one frame a second (the take before the last fusion and results changes) | the jogo reads: spawns, re-form, exchanges, the thread filling, the gathering, the fusion, the release, the beads of the streak. Weak: the fusion's 16 s held one static composition (the dancers stood still holding merge and the streams were a dense knot): since changed (the script lets go of merge after the bar, the dancers step apart and spin, macaco, in unison; streams wider and drawn as streaks), re-checked only in a still |
| `3-jogo-dodge-sheet.jpg` | 1.2 s at 10 fps round the first dodge: water drops under the fire's martelo, the trail lies along the kick | **lands**: the trail is the clearest thing on screen and stays a second. The slow breath can't be judged in stills |
| `3-jogo-hit.jpg` | water's meia-lua lands on fire: fire knocked back, the thread and beads, the gold perfect rings | the knock reads; the perfect rings were too big here (made smaller and dimmer since) |
| `3-jogo-fusion-steam.jpg` | mid-fusion (old take): both bodies wearing both elements, a steam column, ripples | **the strongest image**: the loadout mix really shows (orange through blue); but the two bodies were one blob |
| `3-jogo-hud-full.jpg`, `3-jogo-hud-results.jpg` | the HUD at rest (a slack dim thread, the feet's arcs) and at tension 86 (bright thread, beads; a dodge trail); results (first version) | the meters read in the locked view and stay small. The first results were broken (the big gems near the camera as gold candles): the ring now lies along the stage, a third as deep, smaller gems, the view stands back. See the re-shot results below |
| `3-jogo-ice-bridge.jpg` | the ice dancer's cartwheel; the arch of set ice laid along it; the water dancer jumping onto it; standing on it (read back: y 1.045 m, grounded) | **lands** |
| `3-jogo-menus.jpg` | the front (together), the front (online), the lobby with a keyboard joined, an online room waiting (its code top right; no server in that capture) | clean, icons only. The online row showed in every mode (a `hidden` attribute beaten by `display:flex`): fixed, not re-shot |
| `3-jogo-online-two-pages.jpg` | the two browsers a moment after an exchange: page a (fire, seat 0) and page b (water, seat 1), each with the other through the network | both dancers, the thread, the arcs on both pages. The remote dancer's feet ring floated low on page a (its ground was guessed from the hips): now from its toes, not re-shot |

## Online: two browsers, a real room server, lag 150

`server/index.ts` on 5412, the built game from `vite preview` on 5392, two headless Chromes on the RTX 5090 (live,
not stepped), `?jogo=online&room=J…&lag=150`. Both joined (a seat 0, b seat 1), the intro ran on the room's clock and
both reached play. Each page placed its own dancer, then:

| exchange | page b's view | page a's view |
|---|---|---|
| a's martelo at b standing | b judged **hit** (mine) at room time …5613 | a heard **hit** from the room at …5779 (166 ms later) |
| b's martelo at a, a dodging 110 ms after | b heard **dodge** at …9570 | a judged **dodge** (mine) at …9412 |

Round trip 154 to 156 ms on both, the other dancer shown 260 to 295 ms behind (the jitter buffer), the two pages' room
clocks equal to the millisecond when read one after the other. Tension 2 → 12, streak 0 → 1 on both pages. **A bug
this found and fixed:** on the first runs every exchange after the first came back empty: online the page's dancer
never faced the other (dancer/play.ts pairs only its own controllers, so a NetController partner left `lookAt` null and
the seat-1 dancer kicked away from its partner). The jogo now points each local dancer at the remote one before the
dancers move. A third exchange (with stills) went unjudged: grabbing a still steps the page by hand and stops its live
loop, so the attack's window passed with no frames; the stills are of that moment, the judging of it is not.

## Weak points

- **The fusion is judged on stills and one old take.** The 44 s film predates the changes to the fusion's streams and
  the dancers' movement in it; a new film was not rendered (the shared GPU lock: long holds were asked to stop).
- The dodge's slow breath slows only the dancers (danceParams.speed): matter and the music go on.
- The locked view frames the pair closely when they are close (a metre apart the bodies fill the frame); the "game
  screen" (safe areas, a rim) is another agent's task now.
- In the Pool a dark rectangle cuts the fire body at the horizon (the Pool's horizon hole, the critic's item, not
  this folder's).
- Gem and fire pieces are light, not matter. Set pieces of the room carry no "how melted" for fire rings beyond the
  rules' melt time.
- The music follows the room's clock by `engine.syncTo` + `clock.measure`: right in films (both clocks are sums of the
  frames' dt); live it re-phases the groove once at the jogo's start; never listened to.
- `perfect` is judged against the room's grid whenever the page is stepped by hand; live, against the music as heard.
  Live with real audio latency was not tried.
- Online, the remote dancer's ground is estimated from its toes; guests see both seats but nothing judges for them.
- The stand-in partner is simple and a bit repetitive (meia-lua heavy).
- The fusion's loadout mix re-homes both bodies' particles twice; on a phone that may be a visible hitch (not measured).

## Not done

- A second film (geode, prism) and a film of the release and results: stills only.
- Real gamepads (rumble never felt), a second human, a phone or touch screen, the camera body in a jogo.
- Travel through a gate with two dancers in a browser (Node only).
- Living 3D previews of the bodies in the menu (swatches that move instead).
- A storm or aurora fusion was not captured (both are written; only steam was seen and prism probed).

## Every edit outside src/play

| file | what |
|---|---|
| `src/main.ts` | one line registering the jogo (`registerPlay(app)`, after the gates); `tension: 0` in the FrameCtx literal |
| `src/engine/frame.ts` | `FrameCtx.tension` (0 … 1, for the worlds' light) |
| `src/engine/camera.ts` | `CameraRig.framePad`: extra margin round what a locked view frames (fusion and results stand back) |
| `src/engine/limits.ts` | `LIMITS.glows` (8,192) |
| `src/engine/film.ts` | a `jogo` cut (the film only wakes the music; the jogo plays itself) |
| `src/net/session.ts` | `SessionOptions.net`: a transport made elsewhere (the stepped LocalNet) |
| `shared/rules.ts` | `RULES.build.kinds.fire` (a ring of flame: cost 1, 30 s, melts = doused, shatters) |
| `index.html` | the menus' styles (`.jg…`) |
| `scripts/steps/jogo-*.json`, `jogo-menus.mjs`, `jogo-online.mjs` | the captures |
| `docs/extending/play.md` | the guide |

## Commits (on `worktree-agent-a9723fd789eef43c3`, not pushed)

See `git log 8086e12..`: the jogo's client loop and its parts; the scripts, the film cut, the capture steps and the
guide; judging by the room's grid when stepped, wider fusion streams, the dancers dancing through it; the results ring
along the stage and the front's hidden rows; the online facing fix and this report.
