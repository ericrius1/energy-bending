# The jogo: how play works, and how to change it

`src/play/` makes the parts a game. The rules (flow, tension, streak, axé, forms, fusion, phases, set pieces) are the
server's, in `shared/rules.ts`; the client tells them what happened and makes what they decide felt. Everything here
runs on one clock (the room's) so a jogo stepped with `bend.step` repeats exactly.

```
src/play/
  index.ts     registerPlay(app): main.ts's one line. Reads the address (?jogo=same|partner|online|script), builds a jogo
  room.ts      Room: a Session over the room server (Net) or the rules in the page (SteppedLocalNet: on a stepped clock)
  jogo.ts      Jogo: moves to the rules (perfect judged), exchanges replayed and reported, merge, form, build, ready
  feel.ts      Feel: each exchange felt (breath, trails, bursts, arcs, knock, sound, rumble); the elements' perks
  fusion.ts    Fusion: the gathering, the landing, eight bars of streams and the kind's own matter, the release
  build.ts     JogoBuilder (when a move sets a piece, and its shape) and Pieces (set ice, crystal ledges, rings of flame)
  hud.ts       Hud: the meters in the world (the thread, its beads, the feet's arcs, the beat's pulse)
  flow.ts      Flow: waiting, the intro's re-form and count-in, the finale, the results' gems
  partner.ts   Brain, BrainSource (any brain as a device), AiPartner (src/ai's PartnerBrain through a BrainDriver: the
               default partner), StandIn (the small built-in one, &partner=standin)
  script.ts    ScriptRunner: a jogo from JSON (scripts/*.json)
  menu.ts      the front of the game, the lobby, the room's code (DOM; styles in index.html)
  glow.ts, glow-draw.ts, glow.wgsl   the jogo's own light in the world (points, segments, rings, gems), one draw
  params.ts    jogoParams (bend.params.jogo)
```

## The frame

| phase | what the jogo does |
|---|---|
| input | `jogo.clock(dt)`: the room's clock moves on (a local room's by dt); `FrameCtx.beat` is set from the room's music clock; the music follows it (`clock.measure` + `engine.syncTo`); `FrameCtx.tension` and `music.tension`; a script's cues |
| dancers | (main.ts) the IntentControllers move the bodies; their Characters push events |
| travel | (after the gates carried anyone) `jogo.update()`: the bodies' events become moves for the rules, the exchanges are judged; then `feel`, `fusion`, `hud`, `flow`, `pieces` each read this frame's events |
| camera | (after dancer/play.ts aims the follow camera) the fusion stands back; online, the pose goes out |
| post | the glows to the GPU |

## Add a move to the jogo

A move in the library (`docs/extending/move.md`) becomes part of the jogo by name in `RULES.moves` (shared/rules.ts):
whether it is an attack (it can be answered) and the flow it earns. A move the rules call by another name (the CMU
pirouette is a `spin`) goes in `RULES_NAME` in jogo.ts. Its exchange geometry is the move's own `hit` capsule, replayed
by `Character.shapesAt` from the start event; nothing else is needed.

## Change how an exchange feels

`Feel.exchange` in feel.ts, one case per result. The pieces it has: `this.add(life, draw)` (an effect drawn each frame
for `life` seconds, `u` 0 … 1 through it), `this.ctx.glows` (`dot`, `seg`, `flat`, `arc`, `line`: shapes `soft`,
`ring`, `gem`, `spark`), `this.burst(p, element, k)` (the element thrown into the field), `this.ctx.arcs`,
`this.ctx.sfx(name, { element, count, pan, dist })`, `this.ctx.rumble(seat, strength, ms)`, `this.breathT = 0` (the
slow-motion breath). Numbers worth tuning are in `jogoParams`.

## Give an element a perk

`Feel.perks`: each frame, for each body this page plays, set its `character.env` (`updraft`, `slick`, `carryX`,
`blink`) and read its raw events (`jogo.raw[seat]`: steps, landings, blinks).

## Add a kind of set piece

1. `RULES.build.kinds` (shared/rules.ts): its cost, life, and whether it melts or shatters.
2. `buildKindFor(element, move)` and `JogoBuilder.shape` (build.ts): which body builds it from which move, and its
   polyline (mm, up to 16 points) and width.
3. `Pieces`: how it is drawn (`lay`, or a `draw…` each frame), its `ledges` if it can be stood on, and what melts or
   shatters it (`update`).

## Add a fusion kind

The kind comes from the two seats' forms (`RULES.fusionKinds`). Its look is the field's (`field.fuse({ dancers, kind,
amount, strength, tightness })`, matter/field: the helix of both auras round a vortex and the steam's kind look, in
`FUSION_KINDS` and the steam shaders); the jogo's streams use `FUSION_COLOURS`, and anything the jogo adds on top is a
case in `Fusion.kindFrame` (storm's arcs and drops); the music's texture is `music.fusion(kind)` (src/audio).

## A partner brain

The partner is src/ai's `PartnerBrain` (docs/extending/brain.md) by default, preset `playful`; `&partner=calm|fierce|
mirror` or `bend.jogo.preset(name)` changes it, `&partner=standin` seats the jogo's own little stand-in. In
`?jogo=partner|same` free dancers ring the stage (src/ai's roda) as the device's budget allows (`Budget.roda`:
desktop 4, laptop 2, phone none; `&roda=N`). Any other brain:

```ts
import type { Brain, PartnerView } from '../play/partner';
const mine: Brain = { think(v: PartnerView) { const it = makeIntent(); /* … */ return it; } };
bend.jogo.setPartner(mine);       // or, in code, the `partner` the jogo seats on dancer 2
```

`PartnerView` holds the beat, its own Character, where the other dancer is and what move it is in, the room's state
(phase, tension, flow, form, mergeReady), its seat and the stage plane. A brain presses buttons the way a person would;
the jogo judges it the same.

## Script a jogo

`src/play/scripts/NAME.json`, opened with `?jogo=script&script=NAME` (or `bend.jogo.run(object)`):

```json
{ "world": "pool", "lock": true, "dress": ["fire", "water"],
  "cues": [
    { "at": 0, "seat": 0, "place": -0.52 },
    { "at": 1, "seat": 0, "move": "martelo" },
    { "at": 1, "seat": 1, "press": "dodge", "hold": { "moveY": -1 }, "for": 0.6 },
    { "at": 9, "seat": 1, "goto": 0.5 },
    { "at": 24, "seat": 1, "press": "form" },
    { "at": 29.5, "seat": "both", "hold": { "merge": true }, "for": 42 } ] }
```

`at` is in beats from the first beat of play (the bar the intro ends on). `move` starts a move now; `press` fires an
edge (jump, punch, kick, spin, dodge, form, interact); `hold` sets Intent fields until `for` beats later; `goto` walks
to a place on the stage; `place` stands a dancer there now; `build` arms the build button; `tension` (a local room
only) sets the rules' tension, for a film that can't wait. A script waits for the first frame stepped by hand
(`kit.manual`), so a capture's frame 0 is the room's. `src/play/test/scripts.test.ts` runs every shipped script in
Node and prints what each makes (`SCRIPTS_VERBOSE=1 node scripts/test-ts.mjs scripts.test`): write a script there first.

## Captures

```bash
node scripts/shot.mjs shots/jogo scripts/steps/jogo-smoke.json --url http://127.0.0.1:5392/energybending/
node scripts/film.mjs shots/film --url http://127.0.0.1:5392/energybending/ --cut jogo --fps 30 --seconds 44 \
  --query "jogo=script&script=pool-fire-water&world=pool"
node scripts/steps/jogo-menus.mjs shots/menus --url http://127.0.0.1:5392/energybending/
node scripts/steps/jogo-online.mjs shots/online --url http://127.0.0.1:5392/energybending/ --cond lag=150
```

`bend.jogo` in a page: `stats()`, `state`, `phase`, `history` (events with the room's time and the frame), `beat()`,
`run(script)`, `setPartner(brain)`, `endIn(ms)` (a local room: the finale now, for capturing the results).
