# Adding a move

A move is something a dancer does on purpose: a kick, a dodge, a cartwheel, a flourish. It is a pose over time on the
13 landmarks (`skeleton/landmarks.ts`), plus what the jogo's rules need to know about it (when it is dangerous, where it
hits, when it can't be hit, what it may be cancelled into). The Character (`dancer/character.ts`) plays it, moves the
root along its `travel`, and the IntentController fits the 38-joint rig to it. Moves live in `MOVES`
(`dancer/moves.ts`); `registerMove(def)` adds one, procedural or sampled from a clip, without touching anything else.

## The definition

```ts
interface MoveInput {
  name: string;
  dur: number;                         // seconds at 112 bpm (times tempoScale(bpm) at other tempos)
  active?: [u0, u1] | null;            // the dangerous window, in progress u (0..1)
  attack?: boolean;
  hit?: { a, b, r, stream? } | null;   // the hit capsule: landmark a → b ('RK', 'RA', … or 'HAND'/'ELBOW'), radius r (m)
  travel?: { z?, y?, u0, u1 } | null;  // root motion (m) along the facing and up, eased over u0..u1
  iframes?: [u0, u1] | null;           // can't be hit
  cancelInto?: string[];               // what may cut its recovery short ('jump', move names, '*')
  airOk?: boolean; evade?: boolean;    // may start in the air; carries the dancer clear (a dodge, for the rules)
  aimW?: number; usesHand?: boolean;   // how much the bending hand may follow the aim; the move uses that hand
  hold?: { u };                        // progress waits at u while dodge is held (the block)
  style?: (u, ctx) => MoveStyle;       // hints: hands 'relaxed' | 'fist' | 'open' | 'floor', feet 'auto' | 'point' | 'flex'
  pose?: (u, ctx, out39) => out39;     // procedural: write the pose at progress u
  sample?: (u, out39) => void;         // or sampled: the same, from a clip
}
```

A pose is 39 floats: head, L/R shoulder, elbow, wrist, hip, knee, ankle, each (x, y, z) in **metres** in the dancer's
own frame: x across the body with the dancer's **own left at +x**, y up from the ground under the hips, z forward. A
foot on the floor has its ankle `ANKLE_H` (0.075 m) above it. `ctx` is `{ hand, aim, air, beat, groove, t }`: which
hand strikes (+1 the right), the aim in the dancer's frame, in the air or not, the music's beat.

The rules a move must keep (the tests check them for every attack, `src/dancer/test/character.test.ts`): a wind-up of
at least 150 ms before `active` even at 140 bpm, a hit capsule only inside `active`, and a pose that depends only on
`(u, ctx)` so `Character.shapesAt(event, t)` can replay it from its start event (that is what the network sends).

## Procedural

Most of the library is keyframes through the body rig `rig(params, out)`: a hip position, the body's yaw, pitch, roll
and twist, and targets for the hands and feet, solved with two-bone IK to the CMU rig's own lengths. The keyframes are
written in the 2D prototype's figure units and its frame (`rig` converts: FU metres per unit, x mirrored), so moves
ported from `sketches/dance-first-2d/js/moves.js` keep their numbers. A new move can use the same `track([[u, {…}],
…])` helper:

```ts
const tesoura = track([
  [0.0, base()],
  [0.4, { hip: [0, 0.2, 0], pitch: 0.6, rf: [0.3, 0.3, 0.2], lh: [-0.2, 0.05, 0.1] }],
  [1.0, base()],
]);
registerMove({ name: 'tesoura', dur: 0.9, active: [0.35, 0.6], attack: true, hit: { a: 'RK', b: 'RA', r: 0.14 },
  style: () => ({ feet: ['auto', 'point'], hands: ['floor', 'fist'] }), pose: (u, _c, out) => rig(tesoura(u), out) });
```

## From motion capture

`clipMove(motion, { name, piece, dancer?, from, to, dur?, travel?, extra? })` (`dancer/clip-move.ts`) turns a stretch
of a CMU clip into a sampled move: the clip is posed on its rig at each `u`, read back as landmarks
(`landmarksFromSkeleton`) in the frame it faced when the stretch began, on the spot unless `travel`. The repo ships one:
`pirouetteFlourish(motion)`, two turns of the CMU pirouette, registered by `?play` as `pirueta`.

```ts
registerMove(clipMove(motion, { name: 'pirueta', piece: 'pirouette', from: 2.0, to: 3.47,
  extra: { cancelInto: ['jump', 'esquiva'], style: () => ({ hands: ['open', 'open'] }) } }));
```

Pick the stretch with a probe of the clip (head height, the shoulders' turn over time): the loop cross-fade covers the
first 0.6 s of a clip, and a stretch that ends facing another way than it began will be turned back by the cross-fade
to the ginga. Replace a procedural move with a clip by registering the clip under its name; replace the ginga with
`character.idle = (out, beat) => …`.

## Reaching it

The buttons choose a move from the stick and the state (`Character._choose`). As it ended up:

| button | in the air | stick down | stick up | stick toward / away (or moving) | otherwise |
|---|---|---|---|---|---|
| punch | strike | strike | strike | strike | strike; with the hand aimed far: throw; held: strike becomes throw |
| kick | martelo | rasteira | martelo | toward: bênção; away: armada | meia-lua |
| spin | spin | macaco | the flourish (`pirueta`) | aú (that way; LB/RB on a pad) | spin |
| dodge | esquiva | esquiva | block | rolê (that way) | block (held: it holds) |

Toward/away is along the facing (locked: along the plane, toward the partner); free, the stick is camera-relative. A
camera body's real punch or kick (`Intent.limb`) starts the strike or martelo at its active window, its capsule on the
real limb. Scripts start anything by name: `bend.move(player, name)`.

## Checking it

`node scripts/steps/dancers.mjs` writes capture steps for every move from the front and the side at wind-up, active and
recovery; add your move's name and duration to its `MOVES` table, run
`node scripts/shot.mjs shots/moves scripts/steps/dancers-moves.json --url …`, and look at it on the gem body. A move
should read as itself from the side (the locked view) and from the front.
