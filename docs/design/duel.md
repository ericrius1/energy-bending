# The duel: Energy Bending as a fast two-player arena game

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
  world: string;            // the world id
  plane: StagePlane;        // the duel's stage plane, with its ledges and walls
  spawns: [number, number][]; // [s, y] points to (re)form at, at least 4
  bounds: { s0: number; s1: number; yKill: number; yTop: number }; // falling below yKill is a KO
  camera?: { minDist?: number; maxDist?: number; lens?: number };
}
// arenas.register(arena); arenaFor(worldId) → Arena | null
```

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
