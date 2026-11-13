# Writing a brain (and a behaviour)

A brain is a dancer that is not a person. It decides an `Intent` each frame, exactly what a keyboard or a gamepad
would produce (`docs/extending/input.md`), and the same body, moves, rules and network carry it out: nothing downstream
can tell a brain from a player. Brains live in `src/ai/`.

```
brain.ts      the contract: Brain, Sight (what a brain may see), BodyHints, SeenMove, Rng
body.ts       working the body: the Intent that starts a named move, whether the body is free to, the stick toward a
              point (locked or free), a move's replayable start event, the 8th-note grid and the frame to press on
read.ts       reading an attack from its start event (Character.shapesAt): when it touches, which dodge, parry or
              clash meets it, each attack's reach against a standing body
mind.ts       a brain's working memory: presses planned on the beat, the legs claimed by priority, what it did lately
behaviours.ts the reasons to move: keepDistance, approach, answer (and the counter out of it), offer, echo, unison,
              merge, avoid, wander, watch (the clap on the beat), travel (throughGate), routeAround
ginga.ts      the legs of the jogo: the distance breathing with the ginga, the pair circling its shared centre (free),
              arriving for an attack on its beat, drifting back to the roda's middle
vocabulary.ts levels (standing, low, inverted), which back step each kick grows from, the named exchanges (attack,
              answer, counter), feints, telegraphs, and the moves the library may not have yet (used when registered)
direct.ts     a director's loose intentions from a film timeline (Sight.direction), below
partner.ts    the partner (presets playful, calm, fierce, mirror)
npc.ts        free dancers (wander, dance, watch, roda, travel, buying the game)
teacher.ts    the call-and-response teacher, and a scripted student
clips.ts      the CMU clips as grooves (Character.idle) and flourishes (sampled moves), with the table of roles
scene.ts      what every brain in a place sees (Witness: the moves each dancer started)
driver.ts     one brain at one body: the Sight in, the Intent out, the hints applied; `.source()` is an IntentSource
jogo.ts       a small referee (the shared rules + the bodies' exchange judgement) for tests and demos
sim.ts        a jogo simulated in Node; demo.ts the page's demo flags
```

## The contract

```ts
interface Brain { readonly name: string; readonly body: BodyHints; think(s: Sight): Intent }

interface Sight {
  t, dt, beat, beatPrev, bpm;          // dance time; the music's clock (beats now and last frame)
  music: { level: 0..1, breakdown, mood? };   // the groove's level, a breakdown, the mood's name (Roda …)
  self: Character;                     // its own body (read it; move it only through the Intent)
  seat, id;                            // jogo seat 0/1, or -1 outside the jogo
  others: Other[]; partner: Other | null;
  stage: { plane, stage, terrain, gates, room };   // the locked plane (or null), the world's stage, the floor, gates
  rules: { phase, tension, mergeReady, flow, form, fusion, events } | null;
  direction?: Direction | null;        // a director's loose intentions (direct.ts), below
}
interface Other { id, seat, root, yaw, v, pose (39 world floats) | null, flags, moves: SeenMove[], character | null }
interface SeenMove { name, serial, age (s), attack, ev (the start event), beat (when it started) }
interface BodyHints { flourish, groove, clip, clipW, lookAt, low, clapAt }   // what an Intent can't say
```

A brain sees another dancer's moves the moment they start (a `SeenMove` with its start event), and nothing of their
plans. `Character.shapesAt(seen.ev, t)` replays the move's hit capsules at any time after its start; that is how a
brain reads an attack (read.ts does it for you). Brains must be deterministic: draw randomness only from an `Rng`
seeded at construction (a `Mind` holds one), and time only from the Sight.

`BodyHints` are laid on the body by the driver before it steps: `flourish` is the move "spin with the stick up"
starts (a clip phrase, `palmas`, `pirueta`: anything registered in MOVES), `groove` the ginga's amount, `clip` a
`ClipGroove` blended in over the ginga by `clipW`, `lookAt` where to face when standing, `low` how far the ginga sinks
toward the cocorinha (Angola's ginga baixa), `clapAt` the dance time of the last clap's meeting of the hands (for
whatever wants to light it).

## The Mind: plan presses, claim legs

Behaviours don't write the Intent. They plan presses and claim the legs:

```ts
m.plan({ move: 'meia-lua', line: nextEighth(startBeat(s.beatPrev, s.beat)), late: 0.1, toward: [dx, dz], prio: 1,
         why: 'offer', ok: () => free(o, s.bpm) });          // ok: checked on the frame it would start
m.claim({ x: dx, z: dz, k: 0.4, walk: false, prio: 0, why: 'close in' });
return m.act(s, this.body);                                   // this frame's Intent
```

`line` is a beat on the music's clock; the Mind presses on exactly the frame whose start lands nearest it (the body
starts a move in the first physics substep of its next update), so a move planned on an 8th line is judged perfect.
A higher-priority press within ¾ beat of a lower one replaces it (answers are 3, offers 1, fills under 1). While a
press of priority 2 or more waits close by, the legs stand still (it was planned from where the body is). `late` is how
long past the line it may still start; past that it is dropped.

## A behaviour

A behaviour is a plain function of `(s: Sight, m: Mind, …its knobs)`. For example, a brain that answers a spin with a
spin a beat later:

```ts
export function spinBack(s: Sight, m: Mind, o: Other, seen: Set<number>) {
  for (const mv of o.moves) {
    if (mv.name !== 'spin' || seen.has(mv.serial)) continue;
    seen.add(mv.serial);
    m.plan({ move: 'spin', line: Math.round((mv.beat + 1) * 2) / 2, late: 0.1, toward: [0, 1], prio: 1, why: 'spin back' });
  }
}
```

Keep it small and say why in a comment. Use `pressMove`'s names (the rules' moves, or any registered move: it goes
through the flourish hint), `jogoAxis(s, o)` for toward and away (along the plane when locked, the line between the two
when free), `stickFor` / `approach` for walking, `canStart` / `freeIn` / `busyFor` for what the body can do.

## A brain

```ts
export class Clapper implements Brain {
  readonly name = 'clapper';
  readonly body = newHints();
  private m = new Mind(1);
  think(s: Sight) {
    const jogo = s.partner?.root ?? null;
    if (jogo) watch(s, this.m, [jogo[0], 1.3, jogo[2]], true, 0.6, this.body);
    return this.m.act(s, this.body);
  }
}
```

## Running it

- In Node: `simulate({ plane, seats: [brainA, brainB], npcs: [{ brain, at }], seconds })` (sim.ts) plays a jogo with
  the real body and rules and returns the referee's numbers; `node scripts/steps/brains-sim.mjs` prints them
  (`two`, `attacker`, `still`, `pattern`, `free`; `-v` a timeline, `-a` every read and exchange). Put checks in
  `src/ai/test/brains.test.ts` (run by `npm test`).
- In the page: a `BrainDriver` over a `Scene` gives an IntentSource (`driver.source()`) for any IntentController:
  `controller.source = new BrainDriver(brain, body, scene, stageView).source()`. demo.ts does this for the flags
  `?play&partner`, `?roda`, `?npcs=5`, `?teach`.

## The rules the brains keep

- Everything starts on an 8th line when it can (answers when a line falls inside the window that works).
- A generous attack is thrown only at a partner free to answer it, from where it touches them (or, while they aren't
  answering, from where it only comes near), with a wind-up a person can read.
- Moves outside RULES.moves (clip flourishes, `palmas`) are the body's own: the rules refuse them and they score
  nothing. Brains use them for colour, not for the jogo.
- Attacks grow out of the ginga: they start on the strong beats (0 and 2 of the bar, where the ginga has the kicking
  leg stepped back: `vocabulary.ts nextBackStep`), the breath having come in to meet them on that beat; everything
  that isn't an attack keeps off those beats when the two are close (`offBeat`). Openings take turns a bar at a time
  (seat 0 the even bars, seat 1 the odd; half a bar at the peak); answers and counters come whenever they come.
- A fast attack (a wind-up under 0.24 s: martelo, strike) is offered only behind a lead a beat before it (a guard
  raised, a dip), which the other's read takes as a telegraph.
- Free, the pair turns about its centre (`ginga.ts`), both stepping to their own right or left by the music's shared
  clock (`circleSense`), and drifts back to the roda's middle; locked, they change sides over or through each other.

## The partner's jogo (partner.ts, vocabulary.ts)

What it does between the music and the other dancer, in the order it decides each frame: answers (a dodge, a parry
or a clash read a log-normal human reaction time after the attack starts, preferring the answer the named exchange
calls for, and from a dodge or a held block a counter in the same motion), the merge, echoes (seasoning: after one
and a half to three and a half beats, sometimes mirrored, lower, or answered with the move's counter), unison, a
director's cues, then its own turn: an opening attack chosen for the exchange it opens and for where the breath can
bring the two by its beat; a feint (a fake cut into the real move from its recovery); or an inversion to travel or
change sides. Then a pattern called for the other to join (more as the tension climbs toward the merge), a silence
filled, and the legs. A finished exchange may end in a held look (a pause: a bar or so with no moves of its own and no
circling).

The named exchanges (`EXCHANGES`): meia-lua → esquiva → rasteira; armada → cocorinha → meia-lua de compasso; martelo →
held block → bênção; bênção → rolê → armada; rasteira → aú → meia-lua; strike → esquiva → rasteira. A move the library
lacks (`OPTIONAL`: `queda-de-rins`, `cocorinha`, `compasso`, `negativa`) is skipped until it is registered, then used.

Moods (`moodOf`): `still` (a breakdown: it sinks into the cocorinha and only answers), `calm` and `roda` (the Roda
mood: slow, low and close; the ginga baixa, low answers and counters preferred), `flow`, `peak` (faster, closer, the
standing and inverted answers, flurries, turns half a bar long). From a tension of 60 both close in and turn faster
toward the merge.

## Direction: shaping a take from a film timeline (direct.ts)

A director can shape what a brain means to do without replacing it: `Sight.direction` carries a list of cues, set per
dancer on the brains' `Scene`. The brain still keeps the music, reads and answers what comes at it, stays generous
(an offer still waits for the other to be free and in reach) and fills whatever the timeline leaves out; a cue that
can't be honoured where the dancers stand is done as near its moment as the dance allows, or let go.

```ts
scene.direct('seat.1', {
  origin: 64,                                   // the beat "1.1" stands for; left out, the beat it is first seen
  cues: [
    { at: '1.1', bars: 2, circle: 'left' },     // circle to its own left for two bars (free view)
    { at: '3.1', offer: 'armada' },             // offer an armada on the first beat of bar 3
    { at: '3.1', bars: 2, answer: 'low' },      // and answer low (go under) for two bars
    { at: '5.1', bars: 1, pause: true },        // hold a look for a bar
    { at: '6.1', move: 'au' },                  // an aú on bar 6
    { at: '7.1', side: 'change' },              // change sides with the other (aú, rolê, queda de rins)
    { at: 32, bars: 4, level: 'low', mood: 'calm', distance: 1.3 },   // `at` may be beats from the origin
  ],
});
```

| field | meaning |
|---|---|
| `at` | when: `"bar.beat"` counted from 1 (`"3.2+"` is the 8th after bar 3's second beat), or beats from `origin` |
| `bars` / `beats` | how long a holding cue lasts (default a bar); `offer`, `move` and `side` are moments |
| `circle` | `left` / `right` (to the dancer's own side as it faces the other: the pair turns that way) / `still` |
| `offer` | an attack to offer on that line (from the ginga, at a partner free to answer it) |
| `move` | any registered move on that line (a flourish, `palmas`, an inversion) |
| `answer` | how attacks are answered meanwhile: `low`, `inverted`, `standing`, `clash`, `none` (let it come) |
| `level` | `standing`, `low` (the ginga baixa, low answers) or `inverted` (more inversions) |
| `pause` | hold a look: no moves of its own, no circling, the ginga quiet |
| `distance` | the ginga's distance from the other (m) |
| `side` | `change`: over or round the other |
| `mood` | play as if the music were `still`, `calm`, `flow` or `peak` |

Where to set it: in Node, `simulate({ …, directions: { 'seat.1': dir } })`; in the game, the partner's scene is
`bend.jogo.partner.scene` (`bend.jogo.partner.scene.direct('seat.1', dir)`); in the brains' demos (`?play&partner`,
`?roda`), `brains.scene.direct(…)`, and with a roda `bend.roda.direct(id, dir)` for any dancer the brains see
(`'npc.N'` for the ring). Seeded determinism holds: the same seeds and the same direction play the same take.

## The roda (npc.ts)

Ring dancers (`?roda`, and `rodaForJogo` round the game's jogo) face the pair, sway with the music, and clap together on the beat in stretches
of four bars in six (each decides per stretch whether it joins); the clap (`palmas`, clips.ts) is a wide arm swing
meeting at the face, timed so the hands meet on the beat, and `BodyHints.clapAt` says when they met (for the matter to
light the hands: requested). A dodge under or round an attack, a unison or a fusion gets a cheer (a jump, a flourish or
a double clap). One of them can buy the game: `npc.buy([x, z])` walks it into the roda to that spot (ignoring the
strip it otherwise keeps off) to wait in ginga, `release()` sends it back; in the page `bend.roda.buy(k, seat)`,
`bend.roda.bought(k)`, `bend.roda.release(k)`. Seating it is the game's business (src/play).
