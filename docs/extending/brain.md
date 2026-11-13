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
behaviours.ts the reasons to move: keepDistance, approach, answer, offer, echo, unison, merge, avoid, wander, watch,
              travel (throughGate), routeAround
partner.ts    the partner (presets playful, calm, fierce, mirror)
npc.ts        free dancers (wander, dance, watch, roda, travel)
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
  music: { level: 0..1, breakdown };   // the groove's level, and whether it has fallen into a breakdown
  self: Character;                     // its own body (read it; move it only through the Intent)
  seat, id;                            // jogo seat 0/1, or -1 outside the jogo
  others: Other[]; partner: Other | null;
  stage: { plane, stage, terrain, gates, room };   // the locked plane (or null), the world's stage, the floor, gates
  rules: { phase, tension, mergeReady, flow, form, fusion, events } | null;
}
interface Other { id, seat, root, yaw, v, pose (39 world floats) | null, flags, moves: SeenMove[], character | null }
interface SeenMove { name, serial, age (s), attack, ev (the start event), beat (when it started) }
interface BodyHints { flourish, groove, clip, clipW, lookAt }   // what an Intent can't say
```

A brain sees another dancer's moves the moment they start (a `SeenMove` with its start event), and nothing of their
plans. `Character.shapesAt(seen.ev, t)` replays the move's hit capsules at any time after its start; that is how a
brain reads an attack (read.ts does it for you). Brains must be deterministic: draw randomness only from an `Rng`
seeded at construction (a `Mind` holds one), and time only from the Sight.

`BodyHints` are laid on the body by the driver before it steps: `flourish` is the move "spin with the stick up"
starts (a clip phrase, `palmas`, `pirueta`: anything registered in MOVES), `groove` the ginga's amount, `clip` a
`ClipGroove` blended in over the ginga by `clipW`, `lookAt` where to face when standing.

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
