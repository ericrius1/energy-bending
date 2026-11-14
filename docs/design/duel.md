# The duel: Energy Bending as a fast two-player arena game

> **Second correction from the owner (13 Nov 2026). It overrides the hits, KOs and damage below.**
> **Nobody gets knocked out or hurt.** It is a **dance battle**, like contact improvisation: you run at each other,
> jump, **catch** each other, **swing** each other through the air, **fling** each other the other way, up, or
> around things, **jump on and off each other**, and the two **energies merge**. It is competitive the way a dance
> battle is (style, combos, who leads), not the way a fight is. Hits, hit pips, KO counts, "first to 5 KOs",
> scattering and damage are all gone. See "The contact dance" below; it replaces "Hits, KOs and rounds".
>
> ## The contact dance
>
> **Contact moves.** All of them work in free 3D and in the lock, mid-air as well as on the ground.
> - **Catch / grab**: reach the other body (hand to hand, hand to wrist, waist, ankle). The two bodies are joined
>   by a soft link, a spring through the contact point. Either can grab. Catching someone in the air is the best
>   move in the game.
> - **Swing**: while joined, one body (the base, often the one on the ground or on a wall) swings the other round
>   the contact: an orbit with momentum, pumped by the stick and on the beat, like a dancer swung by the arms.
> - **Fling / release**: let go mid-swing. The flown body leaves on the swing's tangent, faster than it came. Flings
>   go up, across, over the other's head, onto a ledge, or off a wall into a wall jump.
> - **Lift / base**: one body holds the other up (a high catch, a shoulder stand). The top can launch from the
>   base's hands or shoulders, a partner launch higher than any jump.
> - **Vault / step**: a body is a platform. Land on the other's shoulders or back, run up them, bounce off them.
> - **Counter-flow**: a held body can spin out of a grab, redirect the swing, or turn a fling into its own aú or wall
>   run. Neither player is ever stuck.
> - **Merge**: sustained contact merges the energies. Fire and water steam round the link, the bodies' matter
>   mixes, and a long enough flow becomes the fusion as a finale.
>
> **Combos and style.** A combo chains moves without touching the ground for long: run, jump, catch, swing, fling,
> wall run, catch again. Each link adds to a multiplier; on the beat it counts double; variety counts more than
> repetition. Both dancers build a **shared energy**, the dance's intensity, which only rises when you play
> together. Each also earns **style**, the battle's score, mostly for leading: starting catches, landing flings, and
> catching the other. A round is a set on the music (a section of the world's track, about 45–90 s). The higher
> style wins it, and the shared energy at its peak decides the finale (the fusion).
>
> **Falling** off the space or into a drop costs a little style and the body reforms in a moment. It is never a KO.
>
> **Virtual players** play this: they seek contact, time catches, pump swings on the beat, aim flings at ledges and
> walls, and chain combos. Some are generous leads, some showy flyers.
>
> **The HUD** shows each dancer's style and combo (with its multiplier and the links as small icons), the shared
> energy between them, the beat, the set's time, and pops for named moves ("CATCH", "SWING", "FLING ×3",
> "PERFECT", "MERGE"). No hit pips, no KO marks.
>
> **The HUD's state, version 2.** This replaces the per-player `hits`, `hitsMax` and `kos` and the round below. Old
> fields may stay optional for the jogo.
> ```ts
> interface HudState {
>   mode: 'duel' | 'jogo' | 'none';
>   players: {
>     seat: 0 | 1; name: string; color: string; matter: string;
>     style: number;                  // the battle's score this set
>     combo: { n: number; mult: number; links: string[]; live: boolean; perfect: number };
>       // n moves chained, the multiplier, the last few links ('catch'|'swing'|'fling'|'lift'|'vault'|'walljump'|
>       // 'wallrun'|'dash'|'flip'|'kick'|'aerial'), live while the combo is going, perfect = links on the beat
>     dash: number;                   // 0..1 ready
>     holding: boolean; held: boolean; // in a link: this one holds (the base) / is held (the flyer)
>     reforming: number;              // 0..1 after a fall, else 0
>     screen?: [number, number];
>   }[];
>   link: { on: boolean; energy: number; from?: [number, number]; to?: [number, number] }; // the two joined, on screen
>   shared: { energy: number; peak: number; merge: number };  // 0..1: the dance's intensity, its peak this set, the
>                                                             // merge (fusion) charge
>   set: { time: number; length: number; phase: 'intro' | 'play' | 'finale' | 'done'; countdown?: number;
>          winner?: number };
>   beat: { phase: number; bpm: number; window: number };
>   pops: { text: string; seat?: number; at: [number, number]; age: number;
>           kind: 'catch' | 'swing' | 'fling' | 'perfect' | 'combo' | 'merge' | 'info' }[];
> }
> ```
> Optional fields, adopted after the HUD's first build. When the game fills them, the HUD stops guessing:
> `combo.beats?: boolean[]` (aligned with `links`: which were on the beat), `combo.ended?: 'cashed' | 'dropped'`
> and `combo.cashed?: number` (set for the frame a combo ends), `players[].lead?: number` (0..1: how much of the
> set this dancer led), `players[].best?: number` (the best combo this set, for the banner), `pops[].id?: number`
> and `pops[].dir?: [number, number]` (a fling's direction on screen). `link.from` is the holder's contact point and
> `link.to` the held's.

> **Correction from the owner (13 Nov 2026), which overrides anything below that reads otherwise.**
> It is still a dance, and it is **3D native**. It is not a 2D arena brawler.
> - **The view.** You move freely in the world, with a third-person camera framing both players. The 2D lock
>   (`l`) is an option you can switch to anywhere, as it is today.
> - **Walls and terrain.** Wall slides, wall jumps and dashes work in 3D, against the world's real solids
>   (`World.solids`: columns, trunks, blades, slabs) and terrain. They also work in the lock, against the
>   plane's walls.
> - **Dancing is fighting.** Capoeira's moves are the attacks and the evasions, and they flow into each other: run
>   into a jump into a kick into a dash, cancelled and chained on the music. Fluid, never stop-start.
> - **Dancing well gives you power.** On the beat, varied, and moving through the world as dance (wall runs, flips,
>   aús) builds flow. Flow fuels the spells and the super.
> - **Arenas.** An arena is a 3D play space in each world, with things to climb, kick off and fall from. A stage plane
>   runs through it for the lock.
> - **Samurai Gunn** is the reference for pace and feel: snappy, quick hits, quick reforms, jumps and falls. It is not
>   the reference for the camera or the dimension.

The owner's direction (13 Nov 2026): keep the dance, but make it a game that is fun and fast. Jump around, kick off
walls, fall, cast spells, use powers and effects; two players first. Inspiration: Samurai Gunn's feel (tiny arenas,
one or two hits, wall jumps everywhere, instant respawns, a round over in seconds), in our look: bodies of matter that
answer the music. Each phase that feels like a level-up ends in a 30-second film played by virtual players, seen as
a player sees it, the HUD on screen.

The jogo stays (the dance mode). The duel is a new mode beside it, on the same bodies (`Character`), the same worlds
and the same music.

## The feel, in numbers to aim for

- Side view (the 2D lock on a world's stage plane). The camera frames both players and pushes in when they're close.
- **Run**: top speed in about 0.1 s, stop in about 0.08 s; the stick's direction change is near-instant on the ground,
  a little looser in the air.
- **Jump**: variable height (released early = short hop), one air jump, coyote time and a jump buffer (both exist).
- **Wall slide and wall jump**: pushing into a wall while falling slides down it slowly. Jump from it kicks off up
  and away. Wall jumps refresh the air jump, so a player can climb a shaft by kicking between walls.
- **Dash**: a quick burst in any of 8 directions (about 0.15 s, a few metres), one per airtime (refreshed on landing
  or a wall). A dash-jump keeps the dash's speed. During its first frames the body is hard to hit.
- **Fast fall** (down in the air) and **drop through** a thin platform (down on it).
- Momentum carries: nothing about moving should feel floaty or sticky. Landing has no lag unless the fall was huge.

## Hits, KOs and rounds

- A body is matter. **Three hits scatter it** (a KO). The matter streams back and the body reforms at a spawn
  point in about 1.5 s, with a moment of invulnerability.
- The first to **5 KOs** wins the round. A round should take 60 to 120 seconds between evenly matched players.
- **Melee**: the capoeira strikes we have (kicks, punches, spins), fast with short reach, knock back. A strike that
  meets an incoming projectile **deflects** it (Samurai Gunn's parry).
- **On the beat**: an action within the beat window is *perfect*: more knockback, a bigger effect, and it fills the
  **super** meter. This is what makes it a dance: the music is a weapon.

## Spells and powers (phase 2)

Each body's matter decides its spells. Two each, plus the super:

| matter | spell 1 | spell 2 | super (power form) |
|---|---|---|---|
| fire | fireball (projectile, 3 charges, recharge) | flame dash (the dash leaves a burning trail) | plasma: blink and arcs |
| water | water whip (medium-reach lash that pulls) | wave (rolls along the ground) | ice: shards and walls |
| ice | ice shard (fast projectile) | ice wall (a set-ice block: cover and a ledge) | glacier |
| plasma | arc bolt (short chain) | blink (exists) | storm |
| gems | stone throw | crystal shield | heart of stone |

**Reactions** when matter meets matter: fire on water is a steam burst (area knockback); fire on ice shatters it;
water on fire douses the flame dash. Two projectiles that meet clash. Pickups (element orbs) spawn and grant a spell
for a while.

## Juice (phase 3)

Hit-stop (a few frames frozen on a hit), screen shake, slow motion on a round's last KO, words that pop ("PERFECT",
"PARRY", "STEAM!"), hits heard on the beat, hazards per arena (the forge's lava, the temple's tide, falling things in
the redwoods), online duels with the server authoritative.

## The contracts the parallel work shares

These are the seams between phase 1's agents. Change one only by agreement, and say so in your report.

### Walls in a stage plane (`src/engine/camera.ts`, where `StagePlane` and `Ledge` live)

```ts
interface Wall {
  id: string;
  /** position along the plane's right axis (metres from its origin), and the side that faces the player:
   *  +1 the wall's face looks toward +s (the player stands at s > wall), -1 toward -s */
  s: number; side: 1 | -1;
  /** height span in world y */
  y0: number; y1: number;
  /** can be slid on and kicked off (default true) */
  climb?: boolean;
}
// StagePlane gains: walls?: Wall[]. The plane's own ends (±halfWidth) count as walls too (climbable, full height).
```

Ledges stay as they are (`solid` = can't pass from below; otherwise a one-way platform you can drop through).

### The arena (`src/duel/arena.ts`, filled per world)

```ts
interface Arena {
  world: string;              // the world id
  /** the 3D play space: where the duel happens in free movement (a box or a circle on the ground plus a height);
   *  leaving it sideways is a soft wall, falling below yKill is a KO */
  space: { center: [number, number, number]; radius: number; yKill: number; yTop: number };
  /** where bodies (re)form, in 3D, at least 4, spread out */
  spawns: [number, number, number][];
  /** extra climbable and standable geometry the duel adds to the world (also in World.solids while the duel is on) */
  pieces?: Solid[];
  /** the stage plane through the space for the 2D lock, with its ledges and walls */
  plane: StagePlane;
  camera?: { minDist?: number; maxDist?: number; lens?: number };
}
// arenas.register(arena); arenaFor(worldId) → Arena | null
```

Movement against walls works in both views. In free 3D the walls are the world's solids (boxes and capsules,
`src/worlds/solids.ts`: their vertical faces), plus the arena's pieces. In the lock they are the plane's `walls`.

### Movement intents (`src/input/intent.ts`)

`Intent` gains `dash` (edge). Dash direction is the move stick (8-way; no direction means facing). Keyboard: Shift
or K; gamepad: right trigger or B. Spells later take `spell1` / `spell2` (edges) and `aim` (the existing aimX/aimY).

### The HUD (`src/hud/`)

A 2D canvas laid over the WebGPU canvas, drawn each frame from one plain object, and **composited into every
captured frame** (`bend.grab`, `grabYuv`, the film tool), so films show what a player sees.

```ts
interface HudState {
  mode: 'duel' | 'jogo' | 'none';
  players: {
    seat: 0 | 1; name: string; color: string;      // CSS colour
    matter: string;                                 // 'fire' | 'water' | …
    hits: number; hitsMax: number;                  // hits taken this life, of hitsMax (3)
    kos: number;                                    // KOs scored this round
    dash: number;                                   // 0..1 ready
    charges: { spell: string; n: number; max: number; ready: number }[]; // phase 2
    superMeter: number;                             // 0..1
    reforming: number;                              // 0..1 while the body reforms, else 0
    screen?: [number, number];                      // the player's head on screen (0..1), for its tag
  }[];
  round: { koTarget: number; time: number; phase: 'countdown' | 'play' | 'ko' | 'won'; countdown?: number; winner?: number };
  beat: { phase: number; bpm: number; window: number };  // phase 0..1 within the beat; window: the perfect window (s)
  pops: { text: string; seat?: number; at: [number, number]; age: number; kind: 'perfect' | 'parry' | 'ko' | 'react' | 'info' }[];
}
// hud.set(state) each frame; hud.visible; bend.hud
```

### Virtual players (`src/ai/duel-brain.ts`)

A `Brain` (docs/extending/brain.md) that plays the duel through Intents only, as a person would: it reads the
arena, both bodies and the beat, then runs, jumps, wall-jumps, dashes, strikes, and later casts. It has a skill knob
and a style (aggressive, evasive, showy). Two of them play each other for playtests and films. A playtest harness
also drives the real page with real key presses in real time, to measure what a person would feel.

## Phases and their films

1. **Move**: the movement kit, the arenas, the duel's core (hits, KOs, reform, rounds), the HUD, the virtual players.
   Film: two virtual players' first duel, wall jumps and all.
2. **Bend**: spells, projectiles, parries, reactions, the beat's perfect bonus, the super, pickups.
3. **Juice**: hit-stop, shake, slow motion, pops, sound, hazards, online duels, the front's menus for the duel.

Each phase's film: about 30 s, 720p60 (`docs/reports/media/film/duel-<n>.mp4`), the duel played by two virtual
players, the HUD on screen, cut like a highlight reel (the camera the players' own, with a few creative cuts:
a slow-motion KO, a split second from a player's tag).
