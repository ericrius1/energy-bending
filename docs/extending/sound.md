# Sound: how matter, moves and moods are heard

Everything is on the music's clock. `src/audio/` is one system: a clock that owns time (FrameCtx.beat reads it), one
harmony that everything pitched asks, an engine that decides the groove a 16th at a time, and an instrument that
sounds it (live on an AudioContext, or written down for a film and rendered offline). This guide says how to give a
matter kind a voice, how a move gets its sound, how to add a mood, and how to measure what you made. The module map and
the measurements are in `docs/reports/1-audio.md`.

## 1. Give a matter kind a voice

A kind is heard through **ears** the music hands it. Add one method to your `MatterPasses`:

```ts
import type { MatterEars } from '../../audio/matter';

class FirePasses implements MatterPasses {
  private ears: MatterEars | null = null;
  hear(ears: MatterEars) { this.ears = ears; }          // called once, after every kind is declared
  ...
}
```

Then tell the ears what happens, whenever you know it (in `update(f)` each frame, or when a GPU readback lands):

```ts
// a held sound: restate it every frame while it lasts; stop restating it and it fades out in a quarter second
this.ears?.hold({ kind: 'fire', type: 'roar', key: `dancer${d}`, x, y, z, amount: flame, speed: limbSpeed });
// a one-off sound
this.ears?.event({ kind: 'fire', type: 'crackle', x, y, z, strength: 0.6 });
// one read back late: stamp it with the music's clock when it happened, if you kept it
this.ears?.event({ kind: 'ice', type: 'crack', x, y, z, strength: 1, when: stampedAt });
```

Positions are world metres (the ears pan and distance them from the camera). `strength` and `amount` are 0 … 1 (a
little more is allowed). `speed` is m/s. `extra` is a number a voice may read (plasma's `zap` reads the arc's length).

Fire, plasma, water, ice and steam do this now (fire.ts, plasma.ts, water/pool.ts for both water and ice,
reactions/steam.ts), from the CPU: the skeletons, each kind's own state and a field probe (`matter/core/sounding.ts`
has the helpers). Their densities are guesses that a listener should tune: fire crackles about three times a second at
full flame and flares on a limb past 6 m/s; water drips about 1.5 a second and splashes when a foot comes down; ice
ticks while a freeze climbs; plasma zaps as each hand-arc stroke starts; steam puffs on a burst past 0.35.

What each kind can say today (the voices are in `src/audio/matter/<kind>.ts`; the file's opening comment lists them):

| kind | held (`hold`) | one-off (`event`) | pitched, on the grid |
|---|---|---|---|
| `fire` | `roar` (amount: flame, speed: the limb through it) | `crackle`, `flare` (a kick throwing flame) | no (fire is not in time) |
| `water` | `pour` (amount: flow; bubbles on chord tones) | `splash` (landing), `drip` | drip |
| `ice` | | `tick`, `crack` (freezing), `shatter` | tick |
| `plasma` | `buzz` (amount: charge; on the chord's root) | `zap` (extra: arc length) | zap |
| `steam` | `hiss` (amount: steam) | `puff` | no |
| `gems` | | (their GPU batch goes to `score.stones`, budgeted: see below) | always in the chord |

An event of a pitched voice is given a tone of the chord sounding at its time. While the groove runs (level 1 or
more), one that falls within `audio.stoneWindow` (45 ms) before a 16th waits for it, one up to 12 ms after a 16th
sounds at once, and the rest play free. Unknown kinds or types are ignored with one console warning.

**Many events a frame?** Don't send thousands: the gems report every stone, and the score rings a budget of them
(about two a second, more when something happens). If your kind can make hundreds of events a frame, pick a few
(the loudest, or at random from a seeded generator) before calling `event`.

**A new sound for a kind** is a new type in its voice file:

```ts
// src/audio/matter/water.ts, inside events:
gush: {
  note: (h, t, seed) => h.chordTone(t, 72, seed * 6),   // optional: pitched from the chord at time t
  grid: true,                                          // optional: on the 16th when the groove runs
  play(n, m, t, p) {                                    // n: node helpers (synth/nodes.ts), m: the mix, p: MatterPlay
    const out = n.gn(p.strength);
    eventOut(n, m, out, p);                             // pan, distance, the room, into the world's bus
    n.link(n.noiseL(t, 0.5), n.bq('bandpass', 1200, 0.8), n.envG(t, 0.3, 0.02, 0.4), out);
  },
},
```

A **new kind's voice** is a new file in `src/audio/matter/` that calls `matterVoices.register({ id, events, holds })`,
imported from `src/audio/matter/index.ts`. A held voice is `make(n, m)` returning `{ set(t, p) }`: build its nodes
once (use `holdOut(n, m)` for the level, distance and pan), then move their parameters in `set`. Never call
`Math.random` in a voice: use `n.r()` (seeded), or a film's score will differ from one render to the next.

## 2. Give a move (or an exchange) its sound

The jogo's sounds are `music.sfx(name, opts)` (`src/audio/engine.ts`): `move`, `dodge`, `near`, `clash`, `parry`,
`hit`, `land`, `respawn`, `formOn`, `formOff`, `echo`, `unison`, `mergeReady`, `count`, `finale`, `results`.

```ts
music.sfx('move', { move: 'armada', element: 'fire', perfect: beatErrorMs < 40, pan, dist, vel: 0.8 });
music.sfx('dodge', { element: 'water', count: streak });
```

Each is pitched from the chord sounding when it plays, so a volley of moves arpeggiates the harmony. A move the
sounds don't know by name plays as a strike. To give a new move its own sound, add its name to a family in
`src/audio/synth/jogo.ts` (`KICKS`, `SWEEPS`, `RUNS`) or a branch of its own in `Jogo.move`, a make-up gain in
`SFX_GAIN` (render `sfx-solo` in the lab and match the others' peaks), and, if it is pitched, its notes in
`moveNotes` (the test checks every one is a chord tone). Judge timing with `music.beatError(t, 2)` (signed ms to the
nearest 8th, as heard).

The bigger moments: `music.drop()`, `music.fusion('steam' | 'prism' | 'storm' | 'aurora')`, `music.release()`, and
`music.tension = 0 … 1`. A player's body plays by itself once the game marks the dancer: `music.players.add(id)`.

## 3. Add a mood

A mood is data in `src/audio/harmony.ts` `MOODS`: a name, a key, a tempo, a swing, the pentatonic pitch classes (the
first is the root), the bottom of the melody's range, and four chords (`bass` midi, four `pad` voices, the chord's
`tones` as pitch classes). Keep every pad voice a tone of its chord (or its ninth) and the bass on the root:
`npm test` checks. `capo: true` makes the roda's instruments carry the groove.

To make a world play in it, add the world to `WORLD_SOUND` in `src/audio/sound.ts` with its mood's name and a room
(the reverb: `seconds`, `rt60`, `pre`-delay, how `bright` the tail stays, how much it `waver`s). A world not in the
table gets a mood from its `mood` number and a room from its `tone()`.

## 4. Measure it (nobody can listen)

```bash
PORT=5408 npm run dev
node scripts/audio-lab.mjs --url http://localhost:5408/energybending/                  # every scenario
node scripts/audio-lab.mjs --url http://localhost:5408/energybending/ --only matter,mood-ember
node scripts/audio-lab.mjs --url http://localhost:5408/energybending/ --only everything --twice   # determinism
```

The lab (`src/audio/lab/`) assembles the real `Music` in film mode around stand-in worlds and dancers, renders
offline, saves WAVs to `docs/reports/media/audio/` (git-ignored) and prints peak, RMS, crest factor, loudness
(K-weighted, ungated), clipped samples and the energy share in six bands, per stretch. Add a scenario to `SCENARIOS`
in `lab.ts` for anything new. What to look for: peaks under −1 dBFS and no clipped samples; a crest factor of 8 to 14
dB for music (under 6 is squashed, over 18 spiky); the mud band (250-500 Hz) not above the bass band; the harsh band
(2-6 kHz) not far above the others; moods within 2 dB of each other in loudness at the same level.
