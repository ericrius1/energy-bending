# Wave 1: audio

Branch `worktree-agent-a8710d3b83f6a09c8`. One music system for the 3D game: the 2D prototype's generative engine
(`sketches/dance-first-2d/js/audio.js`, 1,765 lines of JS) ported into typed modules in `src/audio/`, joined with Gem
Dancers' stone instrument, owning time (FrameCtx.beat reads its clock, live and filming), with one harmony that every
pitched sound asks, a voice for every kind of matter, the player's body as melody, and a film path that renders the
whole thing offline. Nobody listened: everything below was measured, and the WAVs are there for the owner to hear.

Measured: `npm run typecheck`, `npm run build`, `npm test` clean (20 new pure-logic tests); offline renders of every
scenario in headless Chrome with peak, RMS, crest, loudness and a coarse spectrum; a before/after against the
foundation's instrument; the determinism check; a live AudioContext in headless Chrome with the real app. Not
measured: anything by ear; CPU load of the live graph on a phone; the matter kinds' real events (they don't report yet).

## Module map

```
src/audio/
  clock.ts         MusicClock: the 16th-note grid, swing, tempo glide, beatAt/beatError/beatInfo, quantise, nudgeTo,
                   and following a shared clock (syncTo, measure, slewed 2 ms a step, re-phased on a jump). Pure.
  harmony.ts       the five moods (Ember, Midnight, Sunrise, Neon, Roda) and Harmony: the mood, its transposition, the
                   chord now and at any time (a log: chords are set a lookahead early), the melody's pool, snapping,
                   chord tones for stones, the pentatonic scale. The one harmony source. Pure.
  engine.ts        Engine: the scheduler's host, one 16th at a time: levels 0-4, the bar line (mood, place, key, chord),
                   drums, bass, the pad's colour, arps, the roda, the toque, tension, fusion, drop, release, stomp,
                   gliss, sfx entry, shared-clock jumps, events for visuals. Decides only; calls an Instrument.
  instrument.ts    the Instrument interface (every call carries the time it sounds at), the Recorder (writes calls
                   down for a film), `silent`, wav().
  score.ts         Gem Dancers' score in the engine's key and grid: feet (lithophone on the chord root), hand flicks
                   (non-players), stones (chord tones, budgeted, sorted for determinism), drips, whoosh, drone, blast,
                   prelude, rise; `place(t)`, the grid placement.
  conductor.ts     the body plays: a player's bending hand → melody; the body → intensity, lift, sway.
  sound.ts         where it is heard: Tone (unchanged), Room, the world table (mood + room per world), wetOf.
  spatial.ts       panOf / distOf from the camera.
  gate.ts          passes a held control on only when it changes (offline renders depend on it).
  live.ts          the live AudioContext, the scheduler's 25 ms timer + Worker timer, adaptive lookahead,
                   heardTime, levelMeter.
  music.ts         Music: assembles all of it for main.ts; owns `clock`; live or Recorder; players; the jogo API.
  voices.ts        Gem Dancers' rendered sounds (struck voices, rooms, noise, crackle, birds, crickets). `renderRoom`
                   gained a `bright` parameter.
  synth/           the Instrument that sounds, split as the prototype's file was organised:
    nodes.ts         seeded node helpers (_o, _gn, _bq, _envG, _link, _noiseL, _path, distance)
    mix.ts           buses, the place's water low-pass, the room (two impulses crossfading), delay, suck, duck,
                     compressor and tanh limiter
    drums.ts         kick, clap, hats, crash, tom, rim, shaker, riser, impact, crackle
    capoeira.ts      berimbau, pandeiro, atabaque
    tonal.ts         the Pad (the one chord bed + sub), bass, the seven voice palettes, tone(element), fpad
    stones.ts        the struck-voice bank and its voice cap
    ambience.ts      room tone, hearth, wind/leaves/crickets/birds, whoosh, drone, boom, per-hand breath
    jogo.ts          the 16 jogo sound effects, voice stealing per kind, make-up gains, moveNotes (pure)
    moments.ts       fusion (bus, hit, per-step texture) and tension
    synth.ts         Synth implements Instrument; renderOffline(recorder, seconds)
  matter/
    sounds.ts        the contract a kind calls (MatterEars, MatterSound, MatterHold, Voiced), the voice registry
    ears.ts          the ears: spatial, pitch from the chord, grid placement, holds and their release
    fire.ts water.ts ice.ts plasma.ts steam.ts   one voice per kind; index.ts registers them
  lab/             the audio lab (dev page): scenarios, a stand-in dancer (body.ts), measure.ts (peak, RMS, crest,
                   K-weighted loudness, clipping, correlation, six-band spectrum)
  test/            check.ts + clock / harmony / engine tests (run by scripts/test-audio.mjs)
```

## Public API

```ts
// the clock (music.clock: FrameCtx.beat is music.clock.info, refilled by music.clock.update(t) each frame)
class MusicClock { bpm; targetBpm; swing; step; origin; gridTime; info: { beats; bpm };
  beatAt(t); beatError(t, grid = 1): ms; beatInfo(t): BeatInfo; nearest(t, grid); quantise(t, ahead, behind?, grid?);
  quantTime(now, grid); nudgeTo(t); syncTo({ epoch, bpm }); unsync(); measure(serverS, heardS, dt);
  serverTimeOfStep(n); audioTimeOf(serverMs); serverTimeOf(t); advance(cur, until, host) }
// the music (bend.music)
class Music { engine; score; conductor; ears; recorder; live; players: Set<string>; clock;
  start(key); retone(); hear(dancers); frame(dt, dancers, awake, hand); now(); time();
  drop(); fusion(kind?, atServerMs?); release(); sfx(name, opts); tension; holdLevel(-1 | 0..4);
  beatError(t?, grid = 2); beatInfo(t?); heardTime(perfMs?); levelMeter('out' | 'pre') }
// moods and levels
MOODS: Mood[]; engine.setMood(i) (next bar line); engine.setPlace(moodIdx, tone, room, grooveWet); engine.setKey(midi)
engine.level (0-4), engine.intensity (0-1, from the players), engine.bright, engine.sway, engine.jogo, engine.tension
grooveParams { level: -1 | 0..4, ambientBars: 4, fireAmount: 0, grooveGain: 1 }   (bend.params.groove)
audioParams { volume, muted, stoneWindow: 0.045 }                                    (bend.params.audio)
// sfx: name 'move' | 'dodge' | 'near' | 'clash' | 'parry' | 'hit' | 'land' | 'respawn' | 'formOn' | 'formOff' |
//      'echo' | 'unison' | 'mergeReady' | 'count' | 'finale' | 'results'
music.sfx(name, { element: 'fire' | 'plasma' | 'water' | 'ice', perfect, pan, dist, vel, at, move, count, final, dur })
// fusion: 'steam' | 'prism' | 'storm' | 'aurora'
// matter voices: a kind's MatterPasses gets  hear(ears: MatterEars)  (called once)
ears.event({ kind, type, x, y, z, strength, when?, extra? });  ears.hold({ kind, type, key, x, y, z, amount, speed })
// the player's melody
music.players.add(dancerId)   (a webcam dancer, controller kind 'camera', is a player by default)
music.conductor.params = { hand: 'auto' | 'left' | 'right' | 'both', palettes: [1, 0], gain: 1 }
// spatial
panOf(listener, x, y, z) → -1..1 (side over ahead × 0.9); distOf(listener, x, y, z) → 0..1 (3 m … 28 m, eased)
```

What a matter kind must call, per kind, is in `docs/extending/sound.md` (table) and in each voice file's opening
comment. In short: fire `hold roar` + `event crackle | flare`; water `hold pour` + `event splash | drip`; ice
`event tick | crack | shatter`; plasma `hold buzz` + `event zap (extra: arc length)`; steam `hold hiss` + `event puff`.
Holds must be restated every frame; they fade in 0.25 s when they stop.

## How it fits together

- **Deciding and sounding are split.** Everything that decides (engine, score, conductor, ears) calls an
  `Instrument` with the time each sound plays. Live, that is the Synth; for a film, a Recorder; after the last frame
  the calls are replayed in order into a Synth on an OfflineAudioContext. The deciding side never reads Web Audio
  state back, and both sides use seeded generators (no `Math.random` anywhere in `src/audio` outside the lab's
  measurement), so a film script gives one call list.
- **One owner of time.** `music.clock` is FrameCtx.beat. Before the first touch it runs on the page's clock; at the
  first touch it is rebased onto the AudioContext's so the beat does not jump. In a film it runs on the film's clock.
- **One harmony.** The engine's pad is the chord bed: at level 0 it is Gem Dancers' bed (a chord every four bars, a
  2.4 s swell, the filter opened by the dancers' energy, the sub under it, the bed's send into the room as before);
  above it, the groove's pad (0.045 s changes, the prototype's colour). Stones, feet, drips, the melody, sfx and matter
  all take notes from `Harmony` at their own time.
- **Level 0 is Gem Dancers.** No drums, bass, arps or twinkles; the berimbau stays silent at level 0 unless the groove
  played in the last eight bars (a breakdown). The level only rises from players' dancing (or `holdLevel`), so the
  current show (mocap dancers, nobody marked as a player) stays ambient, as it was.
- **Worlds.** `sound.ts` WORLD_SOUND: geode → Ember, the cave room (8 s, 6.2 s decay, wavering through water, the
  groove at 0.7 of its send); redwoods → Midnight, the glade (3 s, 1.6 s), the wood's birds, crickets and wind kept
  (they are on the world bus, not ducked); pool → Sunrise, a long soft wavering hall; temple → Roda, a stone room
  (2.6 s); forge → Neon, a short dark room (1.1 s). Unknown worlds: mood from their mood number, room from their tone.
  A change (`music.retone()`, which `setWorld` already calls) applies on the next bar line: mood, swing and tempo
  (gliding 6 % a step), tone, and the room crossfading over that bar.

## Quantisation: what was chosen and why

When the groove runs (level ≥ 1 or a fusion), a stone, a foot, a drip, a hand flick or a pitched matter event that
falls up to **45 ms before** a 16th waits for it; one up to **12 ms after** a 16th sounds at once (it is already heard
on it); everything else plays free. With no groove, everything is free (Gem Dancers). The window is
`audio.stoneWindow` (0 … 120 ms in the panel).

Why forward only: live, nothing can be played in the past, and pulling sounds back is impossible; the choice is only
how long to make them wait. Measured on a uniform spread of event times at 120 bpm (`npm test`, clock.test.ts):

| window | on the grid | mean wait (snapped) |
|---|---|---|
| 0 ms (free, plus the 12 ms grace) | 10 % | 0 ms |
| 20 ms | 25 % | 6.2 ms |
| 30 ms | 33 % | 10.7 ms |
| **45 ms** | **46 %** | **17.9 ms** |
| 60 ms | 57 % | 25.0 ms |
| 90 ms | 82 % | 39.8 ms |

45 ms is about where a sound starts to feel late against what it is attached to (a stone seen landing), and it puts
almost half of everything on the grid while the rest keeps the cascade's texture. In the lab's scripted 20 s of
everything at once: 86 of 176 placed sounds snapped (49 %), mean wait 15.6 ms; in the melody run 12 of 34; in the
portal run 20 of 46. Fully quantised (90 ms+) was rejected: at 112 bpm a 16th is 134 ms, so a fully quantised cascade
of stones becomes a machine-gun of chords on every 16th and visibly lags the stones.

## Measurements

All offline at 48 kHz, stereo, through the real mix. Columns: peak dBFS, RMS dBFS, crest dB, loudness (K-weighted,
ungated "LUFS"), clipped samples, then each band's share of the energy in dB (sub <60, bass 60-250, mud 250-500, mid
500-2k, harsh 2-6k, air 6k+). Moods were rendered in a plain open place (no water, a 2 s room) so they compare.

### Before the fixes (first full run)

| render / stretch | peak | rms | crest | lufs | clip | sub | bass | mud | mid | harsh | air |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ambient-geode | -3.8 | -15.8 | 12 | -14.1 | 0 | -22.9 | -1.5 | -8.9 | -8.1 | -24.6 | -60.4 |
| ambient-redwoods | -4.2 | -15.4 | 11.2 | -14.9 | 0 | -4.5 | -2.7 | -11.1 | -15.1 | -26.1 | -39.3 |
| portal | -3.6 | -11.8 | 8.2 | -10.5 | 0 | -13.3 | -0.4 | -15.6 | -17 | -30.5 | -32.4 |
| &nbsp;&nbsp;crossing | -3.6 | -11.4 | 7.8 | -10.1 | 0 | -13.2 | -0.4 | -15.9 | -17.6 | -31.2 | -34.6 |
| melody | -3.5 | -11.8 | 8.3 | -10.5 | 0 | -15.7 | -0.3 | -16.1 | -17.6 | -28.1 | -34.7 |
| &nbsp;&nbsp;still | -4.3 | -14.4 | 10.1 | -13 | 0 | -18.6 | -0.3 | -16.4 | -15.5 | -27.9 | -40.4 |
| &nbsp;&nbsp;rising | -3.8 | -11.7 | 7.9 | -10.3 | 0 | -18 | -0.3 | -15.3 | -17.4 | -27.5 | -32.1 |
| &nbsp;&nbsp;wild | -3.5 | -11 | 7.5 | -9.8 | 0 | -13.7 | -0.4 | -16.8 | -17.8 | -27.4 | -35.5 |
| barrage | -3.5 | -12.1 | 8.6 | -10.2 | 0 | -18.1 | -0.8 | -13.7 | -10.8 | -17.7 | -19.8 |
| sfx-solo | -5.2 | -27.5 | 22.3 | -24.5 | 0 | -11.9 | -6.5 | -9.8 | -3.2 | -10.6 | -14 |
| matter | -4.9 | -25.3 | 20.4 | -22 | 0 | -13.6 | -3.3 | -10.9 | -8 | -8.4 | -9.7 |
| &nbsp;&nbsp;fire | -8.1 | -25.2 | 17.1 | -22.4 | 0 | -11.7 | -3.2 | -8.9 | -7.8 | -10.2 | -12.2 |
| &nbsp;&nbsp;water | -8.6 | -24.6 | 16 | -21.5 | 0 | -14.8 | -4.3 | -9.8 | -5 | -7.6 | -23.3 |
| &nbsp;&nbsp;ice | -4.9 | -25.2 | 20.3 | -21.5 | 0 | -14.3 | -3.9 | -12.2 | -6.7 | -6.3 | -13 |
| &nbsp;&nbsp;plasma | -7.2 | -27.2 | 20 | -25.2 | 0 | -12.4 | -1.4 | -11.5 | -12.2 | -12.4 | -14.7 |
| &nbsp;&nbsp;steam | -5.6 | -24.5 | 19 | -20 | 0 | -15.1 | -4 | -14.4 | -21.7 | -7.8 | -4.4 |
| everything | -3.3 | -12.1 | 8.9 | -10.6 | 0 | -10.5 | -1.2 | -13.9 | -10.2 | -20.3 | -23.2 |
| mood-ember | -3.6 | -12.1 | 8.5 | -10.8 | 0 | -13.6 | -0.4 | -16.5 | -19.4 | -31.7 | -30.1 |
| &nbsp;&nbsp;L1 | -4 | -12.5 | 8.5 | -11.2 | 0 | -18 | -0.2 | -15.9 | -21.3 | -36.7 | -38.2 |
| &nbsp;&nbsp;L2 | -3.8 | -11 | 7.2 | -9.8 | 0 | -13.6 | -0.3 | -17.4 | -19.6 | -32.3 | -31.9 |
| &nbsp;&nbsp;L3 | -3.6 | -11.3 | 7.7 | -10 | 0 | -12.8 | -0.4 | -16.4 | -19 | -31.4 | -29.5 |
| &nbsp;&nbsp;L4 | -3.7 | -11.4 | 7.7 | -10.1 | 0 | -12.7 | -0.4 | -16.5 | -18.7 | -30 | -27.4 |
| mood-midnight | -3.6 | -12 | 8.4 | -10.6 | 0 | -14.2 | -0.4 | -14.9 | -19.3 | -31.9 | -28.4 |
| &nbsp;&nbsp;L1 | -4 | -12.4 | 8.4 | -10.9 | 0 | -18.8 | -0.2 | -15.4 | -21.6 | -37.6 | -37.4 |
| &nbsp;&nbsp;L2 | -3.8 | -11.1 | 7.3 | -9.6 | 0 | -14.2 | -0.3 | -16.7 | -19.6 | -32.5 | -30.3 |
| &nbsp;&nbsp;L3 | -3.6 | -11.3 | 7.7 | -10 | 0 | -13.4 | -0.5 | -14.2 | -18.7 | -31.6 | -28.1 |
| &nbsp;&nbsp;L4 | -3.7 | -11.3 | 7.7 | -9.9 | 0 | -13.4 | -0.5 | -13.9 | -18.4 | -30 | -25.6 |
| mood-sunrise | -3.6 | -12.1 | 8.5 | -10.8 | 0 | -13.4 | -0.4 | -16.3 | -19.4 | -31.4 | -27.6 |
| &nbsp;&nbsp;L1 | -3.9 | -12.4 | 8.5 | -11.1 | 0 | -17.9 | -0.2 | -15.7 | -21.1 | -36.6 | -36.1 |
| &nbsp;&nbsp;L2 | -3.6 | -11.1 | 7.5 | -9.9 | 0 | -13.3 | -0.4 | -17.4 | -19.7 | -31.8 | -29.1 |
| &nbsp;&nbsp;L3 | -3.8 | -11.4 | 7.6 | -10 | 0 | -12.6 | -0.4 | -15.5 | -18.9 | -31 | -27.1 |
| &nbsp;&nbsp;L4 | -3.6 | -11.4 | 7.8 | -10.1 | 0 | -12.6 | -0.4 | -16.5 | -18.9 | -29.8 | -24.8 |
| mood-neon | -3.6 | -12.1 | 8.5 | -10.9 | 0 | -13.2 | -0.4 | -16.7 | -19.8 | -31.5 | -29.8 |
| &nbsp;&nbsp;L1 | -4 | -12.6 | 8.5 | -11.4 | 0 | -17.7 | -0.2 | -16.5 | -22.3 | -37.6 | -38.1 |
| &nbsp;&nbsp;L2 | -3.8 | -11.1 | 7.2 | -9.8 | 0 | -13.1 | -0.4 | -17.4 | -19.7 | -32 | -31.8 |
| &nbsp;&nbsp;L3 | -3.7 | -11.3 | 7.6 | -10.1 | 0 | -12.4 | -0.4 | -17.3 | -19.5 | -31.3 | -29 |
| &nbsp;&nbsp;L4 | -3.6 | -11.3 | 7.7 | -10 | 0 | -12.4 | -0.5 | -15.7 | -19 | -29.6 | -27.1 |
| mood-roda | -3.4 | -12.4 | 8.9 | -11 | 0 | -16 | -0.3 | -15.1 | -18.8 | -31.7 | -30.3 |
| &nbsp;&nbsp;L1 | -4.2 | -12.4 | 8.2 | -10.9 | 0 | -26.8 | -0.2 | -15.5 | -20.7 | -35.1 | -34 |
| &nbsp;&nbsp;L2 | -3.9 | -11.8 | 7.8 | -10.5 | 0 | -18.1 | -0.2 | -16.7 | -18.7 | -32 | -29.1 |
| &nbsp;&nbsp;L3 | -3.5 | -11.6 | 8.1 | -10.1 | 0 | -14.3 | -0.4 | -13.8 | -18.2 | -31.4 | -33.3 |
| &nbsp;&nbsp;L4 | -3.4 | -11.6 | 8.2 | -10.3 | 0 | -14.1 | -0.4 | -15 | -18.5 | -30.5 | -28.5 |
| fusion-steam | -3.3 | -10.5 | 7.2 | -9.2 | 0 | -15.6 | -0.3 | -15.3 | -19 | -30.9 | -30 |
| &nbsp;&nbsp;groove | -3.3 | -11.3 | 8 | -10 | 0 | -13 | -0.4 | -17.2 | -19.5 | -25.3 | -23.4 |
| &nbsp;&nbsp;fusion | -3.6 | -9.6 | 6 | -8.2 | 0 | -17.3 | -0.3 | -14.7 | -19.1 | -33.9 | -34.1 |
| &nbsp;&nbsp;back | -3.8 | -10.9 | 7.1 | -9.7 | 0 | -13.6 | -0.4 | -16.5 | -19 | -33.1 | -34.8 |
| fusion-prism | -3.2 | -11.8 | 8.6 | -10.5 | 0 | -13 | -0.5 | -16.2 | -16.1 | -27.1 | -26.9 |
| &nbsp;&nbsp;groove | -3.2 | -11.6 | 8.4 | -10.4 | 0 | -12.4 | -0.5 | -18 | -17.9 | -23.5 | -22.1 |
| &nbsp;&nbsp;fusion | -3.7 | -11.4 | 7.7 | -10.1 | 0 | -13.3 | -0.5 | -15.6 | -15.2 | -27.9 | -28.7 |
| &nbsp;&nbsp;back | -3.8 | -11.3 | 7.4 | -10 | 0 | -13 | -0.4 | -17.3 | -19 | -32.3 | -34.6 |
| fusion-storm | -3.4 | -12 | 8.7 | -10.7 | 0 | -12 | -0.6 | -13.6 | -18 | -28.3 | -27.5 |
| &nbsp;&nbsp;groove | -3.4 | -11.7 | 8.3 | -10.5 | 0 | -11.5 | -0.5 | -18.1 | -19 | -24.6 | -22.6 |
| &nbsp;&nbsp;fusion | -3.6 | -11.7 | 8.1 | -10.3 | 0 | -12 | -0.7 | -12.2 | -17.6 | -29.6 | -29.5 |
| &nbsp;&nbsp;back | -3.7 | -11.2 | 7.5 | -10 | 0 | -12.9 | -0.4 | -17.3 | -19.1 | -32.7 | -34.4 |
| fusion-aurora | -3.3 | -10.5 | 7.2 | -9.2 | 0 | -17.1 | -0.3 | -14.9 | -18.3 | -30.1 | -28.5 |
| &nbsp;&nbsp;groove | -3.3 | -11 | 7.8 | -9.8 | 0 | -13.5 | -0.4 | -17.8 | -20.2 | -25.7 | -23.2 |
| &nbsp;&nbsp;fusion | -3.8 | -9.6 | 5.9 | -8.3 | 0 | -21 | -0.3 | -14.1 | -17.8 | -31.9 | -30.4 |
| &nbsp;&nbsp;back | -3.9 | -10.8 | 6.9 | -9.5 | 0 | -14 | -0.3 | -17.1 | -19.7 | -32.4 | -32.8 |


### What the numbers showed, and the fixes

1. **The groove was pinned at the limiter.** Every groove stretch had a crest of 7.1 to 8.5 dB with peaks at −3.6
   dBFS against the tanh's ceiling of −2.85, and loudness −10 LUFS, 4 LU over the ambient bed. Lowering the kick 2 dB
   and raising the hats 5 dB (fix 1a) changed the output by 0.1 to 1 dB: proof the output was the limiter's, not the
   mix's. **Fix:** the groove bus into the master at 0.55 (−5 dB). After (Ember): crest 9.0 to 9.5 dB at levels 2-4
   (11 at level 1), peaks −4.9 to −5.6 dBFS, loudness −13.0 to −13.2 LUFS, 1.5 LU over the ambient bed (−14.6). The
   hat and clap changes were kept (right in principle; the measurement could not see them under the limiter).
2. **Steam and aurora fusions squashed the mix** (crest 5.6 to 6 dB, 1.8 dB louder than the groove they come from).
   **Fix:** their pad targets 0.2 → 0.15 and 0.22 → 0.16, and the fusion bus at 0.75. After (with fix 1): crest 7.4
   and 7.5 dB, still 1.6 to 1.8 LU over the groove before them. Left so: a fusion lands as a drop and is meant to be
   bigger, but it is the most compressed part of the music.
3. **Sound effects spread over 8.7 dB of peak** (−5.2 to −13.9 dBFS alone at vel 0.8); `near` was 4 dB under the
   next quietest. **Fix:** make-up gain `near` 3.5 → 6.2, `move:esquiva` 2.8 → 3.7. After: −5.2 to −10.8.
4. **Level 0 lost Gem Dancers' depth.** Rendered against the foundation's own instrument (its `sound.ts`/`score.ts`
   from the foundation commit, driven by the same script: a gem dancer, stones, prelude, rise, two blasts in the geode):

   | geode, level 0, 39 s | peak | rms | crest | lufs | sub | bass | mud | mid | harsh | air |
   |---|---|---|---|---|---|---|---|---|---|---|
   | foundation (Gem Dancers) | −2.6 | −14.2 | 11.6 | −13.6 | −4.0 | −3.7 | −11.8 | −9.8 | −27.9 | −67.3 |
   | new, first run | −3.8 | −15.8 | 12.0 | −14.1 | −22.9 | −1.5 | −8.9 | −8.1 | −24.6 | −60.4 |
   | new, after fixes | −3.9 | −16.0 | 12.1 | −14.6 | −8.8 | −2.4 | −8.7 | −8.0 | −24.3 | −60.2 |

   Loudness within 0.5 LU and the same crest: the bed is as loud and as dynamic as before. But there is far less
   below 60 Hz: the foundation's sub and its feet and booms sat lower (it played in F around midi 34-41; Ember's sub
   sat an octave higher, at the pad's lowest note − 12). **Fix:** the sub on the chord's root near midi 38 (55-98 Hz),
   the feet and the blasts' boom near midi 38 too. The mood's own key is the remaining difference (the foundation
   moved through six keys by programme; now a programme's key transposes the mood on the next bar line). After: the
   band under 60 Hz is −8.8 dB (from −22.9; the foundation's −4.0), loudness −14.6 LUFS (the foundation's −13.6),
   crest 12.1 dB (11.6). Level 0 is within 1 LU and 0.5 dB of crest of what it was; the spectrum is close, not the
   same (the stones now ring chord tones of the mood rather than the pentatonic of the programme's key).

### After the fixes (final code)

| render / stretch | peak | rms | crest | lufs | clip | sub | bass | mud | mid | harsh | air |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ambient-geode | -3.9 | -16 | 12.1 | -14.6 | 0 | -8.8 | -2.4 | -8.7 | -8 | -24.3 | -60.2 |
| ambient-redwoods | -4.3 | -15.5 | 11.2 | -15.1 | 0 | -4.4 | -2.8 | -11.1 | -15 | -26 | -39.2 |
| everything | -3.5 | -13.6 | 10.1 | -12.1 | 0 | -8 | -2.1 | -13.1 | -8.1 | -18.5 | -21.5 |
| fusion-prism | -3.5 | -14.9 | 11.4 | -13.6 | 0 | -14.1 | -0.4 | -16.9 | -16.9 | -25.5 | -25.9 |
| &nbsp;&nbsp;groove | -3.5 | -14.4 | 10.9 | -13.1 | 0 | -12.4 | -0.5 | -19.1 | -18.2 | -21.2 | -21.7 |
| &nbsp;&nbsp;fusion | -5.1 | -14.5 | 9.4 | -13.1 | 0 | -14.9 | -0.4 | -16.3 | -16.2 | -27.2 | -27.4 |
| &nbsp;&nbsp;back | -5.4 | -14.5 | 9.2 | -13.2 | 0 | -14.4 | -0.3 | -18 | -19 | -30.8 | -31.5 |
| fusion-storm | -3.5 | -15.3 | 11.8 | -14 | 0 | -12.5 | -0.5 | -14.2 | -18.2 | -26.4 | -24.8 |
| &nbsp;&nbsp;groove | -3.5 | -14.5 | 11 | -13.3 | 0 | -10.5 | -0.6 | -19.2 | -19.4 | -22.6 | -22 |
| &nbsp;&nbsp;fusion | -4.9 | -15.2 | 10.4 | -13.8 | 0 | -13.1 | -0.6 | -12.5 | -17.7 | -27.9 | -25 |
| &nbsp;&nbsp;back | -5.3 | -14.5 | 9.2 | -13.2 | 0 | -14.4 | -0.3 | -18 | -19.1 | -31.1 | -31.4 |
| mood-midnight | -5 | -15.3 | 10.4 | -13.8 | 0 | -15.5 | -0.4 | -14.7 | -19.2 | -30.6 | -25.1 |
| &nbsp;&nbsp;L1 | -6 | -16.4 | 10.5 | -14.9 | 0 | -18.4 | -0.2 | -15.4 | -21.2 | -37.3 | -34.5 |
| &nbsp;&nbsp;L2 | -5 | -14.4 | 9.4 | -12.9 | 0 | -15.6 | -0.3 | -17.2 | -19.6 | -31.2 | -28.3 |
| &nbsp;&nbsp;L3 | -5 | -14.4 | 9.4 | -13 | 0 | -15.1 | -0.4 | -13.8 | -18.7 | -30.2 | -23.9 |
| &nbsp;&nbsp;L4 | -5 | -14.4 | 9.4 | -12.8 | 0 | -15.1 | -0.4 | -13.6 | -18.4 | -29 | -22.8 |
| mood-neon | -5 | -15.5 | 10.5 | -14.2 | 0 | -14.5 | -0.3 | -16.8 | -19.6 | -30 | -26.2 |
| &nbsp;&nbsp;L1 | -5.7 | -16.6 | 10.9 | -15.4 | 0 | -17.5 | -0.2 | -16.5 | -22.1 | -36.8 | -35.1 |
| &nbsp;&nbsp;L2 | -5.4 | -14.4 | 9.1 | -13.1 | 0 | -14.5 | -0.3 | -18 | -19.7 | -30.5 | -29.5 |
| &nbsp;&nbsp;L3 | -5.1 | -14.4 | 9.4 | -13.2 | 0 | -14 | -0.3 | -17.5 | -19.4 | -29.5 | -24.8 |
| &nbsp;&nbsp;L4 | -5 | -14.4 | 9.4 | -13 | 0 | -14.1 | -0.4 | -15.6 | -18.8 | -28.4 | -23.8 |
| mood-sunrise | -5 | -15.4 | 10.4 | -14.1 | 0 | -14.7 | -0.3 | -16.5 | -19.1 | -29.9 | -24.2 |
| &nbsp;&nbsp;L1 | -5.9 | -16.6 | 10.7 | -15.2 | 0 | -17.6 | -0.2 | -15.8 | -20.1 | -35.6 | -33.2 |
| &nbsp;&nbsp;L2 | -5 | -14.4 | 9.4 | -13.2 | 0 | -14.6 | -0.3 | -18.2 | -19.5 | -30.4 | -27.2 |
| &nbsp;&nbsp;L3 | -5.1 | -14.4 | 9.3 | -13 | 0 | -14.3 | -0.4 | -15.4 | -18.9 | -29.4 | -23 |
| &nbsp;&nbsp;L4 | -5 | -14.4 | 9.4 | -13.1 | 0 | -14.2 | -0.4 | -16.7 | -18.8 | -28.5 | -21.8 |
| sfx-solo | -5.2 | -27.4 | 22.2 | -24.4 | 0 | -11.9 | -6.5 | -9.8 | -3.2 | -10.4 | -14 |
| barrage | -3.8 | -14.2 | 10.5 | -11.9 | 0 | -18.9 | -1.5 | -11.6 | -8 | -14.7 | -16.4 |
| mood-ember | -5 | -15.4 | 10.5 | -14.1 | 0 | -14.7 | -0.3 | -16.8 | -19.2 | -30.3 | -26.6 |
| &nbsp;&nbsp;L1 | -5.6 | -16.6 | 11 | -15.3 | 0 | -17 | -0.2 | -16.1 | -20.3 | -35.9 | -35.3 |
| &nbsp;&nbsp;L2 | -5.4 | -14.4 | 9 | -13.2 | 0 | -14.8 | -0.3 | -18.2 | -19.3 | -30.8 | -29.8 |
| &nbsp;&nbsp;L3 | -5.1 | -14.4 | 9.4 | -13 | 0 | -14.5 | -0.3 | -16.6 | -18.9 | -29.9 | -25.3 |
| &nbsp;&nbsp;L4 | -5 | -14.4 | 9.5 | -13.1 | 0 | -14.4 | -0.3 | -16.7 | -18.8 | -28.8 | -24.3 |
| fusion-steam | -3.6 | -13.4 | 9.7 | -12.1 | 0 | -16.2 | -0.3 | -16 | -20.1 | -29.3 | -27.8 |
| &nbsp;&nbsp;groove | -3.6 | -14.1 | 10.5 | -12.8 | 0 | -13 | -0.4 | -18.2 | -19.8 | -22.8 | -22.5 |
| &nbsp;&nbsp;fusion | -4.9 | -12.4 | 7.4 | -11 | 0 | -17.9 | -0.2 | -15.5 | -20.5 | -33.9 | -29.8 |
| &nbsp;&nbsp;back | -5.6 | -14.2 | 8.6 | -12.8 | 0 | -14.9 | -0.3 | -17.2 | -19.2 | -31.6 | -31.7 |
| fusion-aurora | -3.6 | -13.5 | 9.9 | -12.2 | 0 | -17.6 | -0.3 | -15.9 | -19.5 | -28.8 | -27.5 |
| &nbsp;&nbsp;groove | -3.6 | -13.7 | 10.1 | -12.4 | 0 | -13.8 | -0.3 | -18.9 | -20.7 | -23.7 | -22.8 |
| &nbsp;&nbsp;fusion | -5.2 | -12.7 | 7.5 | -11.3 | 0 | -21.1 | -0.2 | -15.1 | -19.3 | -31.6 | -29.4 |
| &nbsp;&nbsp;back | -5.5 | -13.8 | 8.3 | -12.5 | 0 | -15.5 | -0.3 | -17.8 | -19.8 | -31 | -30.7 |
| portal | -4.8 | -14.8 | 10 | -13.4 | 0 | -14.8 | -0.5 | -13.9 | -14.8 | -28.3 | -30.9 |
| &nbsp;&nbsp;crossing | -4.8 | -14.4 | 9.6 | -13.1 | 0 | -14.7 | -0.5 | -14.3 | -15.4 | -28.7 | -31.8 |
| melody | -4.6 | -14.9 | 10.4 | -13.7 | 0 | -11.3 | -0.5 | -16.2 | -17.7 | -27.9 | -33.3 |
| &nbsp;&nbsp;still | -6.1 | -17.9 | 11.8 | -16.4 | 0 | -17.4 | -0.4 | -14.7 | -14.2 | -28.3 | -38.5 |
| &nbsp;&nbsp;rising | -4.9 | -15.1 | 10.2 | -13.9 | 0 | -11.4 | -0.6 | -15.2 | -17.7 | -27.6 | -31.6 |
| &nbsp;&nbsp;wild | -4.6 | -13.2 | 8.6 | -12.2 | 0 | -9.4 | -0.7 | -17.2 | -18.6 | -27.6 | -33.6 |
| mood-roda | -4.7 | -15.7 | 10.9 | -14.3 | 0 | -17.1 | -0.3 | -14.9 | -18.7 | -31.6 | -30.2 |
| &nbsp;&nbsp;L1 | -5.7 | -16.4 | 10.7 | -15 | 0 | -23.1 | -0.2 | -15.4 | -20.4 | -35 | -34.3 |
| &nbsp;&nbsp;L2 | -5.7 | -15.1 | 9.4 | -13.8 | 0 | -18.9 | -0.2 | -17.2 | -18.8 | -32.2 | -29.1 |
| &nbsp;&nbsp;L3 | -4.9 | -14.6 | 9.8 | -13.1 | 0 | -16.1 | -0.4 | -13.4 | -18.1 | -31.2 | -32.6 |
| &nbsp;&nbsp;L4 | -4.7 | -14.6 | 9.8 | -13.3 | 0 | -15.8 | -0.3 | -14.8 | -18.5 | -30.4 | -28.5 |
| matter | -5.1 | -27.1 | 22 | -23.1 | 0 | -8.2 | -7.9 | -11.7 | -6.2 | -6.6 | -7.9 |

(sfx-solo's stretches are in the next table, matter's in the one after.)

### Loudness balance between moods (LUFS, levels 1-4, plain place, final code)

| mood | L1 | L2 | L3 | L4 |
|---|---|---|---|---|
| midnight | -14.9 | -12.9 | -13 | -12.8 |
| neon | -15.4 | -13.1 | -13.2 | -13 |
| sunrise | -15.2 | -13.2 | -13 | -13.1 |
| ember | -15.3 | -13.2 | -13 | -13.1 |
| roda | -15 | -13.8 | -13.1 | -13.3 |

The moods sit within 0.5 LU of each other at each level (Roda's level 2 is 0.9 LU under the rest: its roda percussion replaces the kit), and level 0 (the ambient bed, −14.6 to −15.1) sits 1.5 to 2 LU under levels 2-4. The prototype's balance between moods holds. All of them are bass-heavy by
the bands (80-95 % of the energy under 250 Hz: the kick, the bass and the pad's lowest voices), with 2-6 kHz 29 to 36
dB down. That is darker than most dance mixes (where that band is nearer 15 dB down), and it is the prototype's
character; I left it after the hat change, and flag it below.

### Each sound effect alone (vel 0.8, nothing under it, after the fixes)

| sound (fire unless noted) | peak dBFS | lufs |
|---|---|---|
| move:meia-lua:fire | -8.1 | -29.8 |
| move:armada:fire | -10.7 | -28.2 |
| move:martelo:fire | -8.7 | -30.6 |
| move:bencao:fire | -9.2 | -29.7 |
| move:rasteira:fire | -8.2 | -25.3 |
| move:au:fire | -9.3 | -27.3 |
| move:macaco:fire | -10.2 | -27.4 |
| move:role:fire | -10.4 | -27.3 |
| move:strike:fire | -8.1 | -30 |
| move:throw:water | -9.7 | -27.2 |
| move:spin:fire | -7.3 | -27 |
| move:jump:fire | -10.6 | -32.1 |
| move:esquiva:fire | -9.5 | -27.6 |
| dodge:fire | -5.8 | -17.1 |
| near:fire | -9.4 | -24.4 |
| clash:fire | -8.2 | -24.8 |
| parry:fire | -6.9 | -24.4 |
| hit:fire | -9.5 | -27 |
| land:fire | -10.8 | -33.1 |
| respawn:fire | -10.4 | -24.2 |
| formOn:fire | -9.4 | -33.2 |
| formOn:water | -7.5 | -20.4 |
| formOff:fire | -8 | -28.6 |
| formOff:water | -9.9 | -23.5 |
| echo:fire | -7.2 | -20.5 |
| unison:fire | -5.9 | -25.4 |
| mergeReady:fire | -10.5 | -25.1 |
| count:fire | -10.2 | -31.9 |
| finale:fire | -5.2 | -18.1 |
| results:fire | -8.6 | -18.8 |


### Each matter voice (held sounds rising and falling across 8 s, events now and then, moving left to right)

| render / stretch | peak | rms | crest | lufs | clip | sub | bass | mud | mid | harsh | air |
|---|---|---|---|---|---|---|---|---|---|---|---|
| &nbsp;&nbsp;fire | -8.7 | -26.8 | 18.1 | -23.7 | 0 | -5.8 | -8.7 | -8.5 | -6.3 | -8.6 | -10.6 |
| &nbsp;&nbsp;water | -8.8 | -25.8 | 17 | -22.3 | 0 | -11.7 | -7.5 | -10.3 | -3.8 | -6.3 | -22 |
| &nbsp;&nbsp;ice | -5.1 | -26.8 | 21.7 | -22.5 | 0 | -10.8 | -8.3 | -15.3 | -5 | -4.6 | -11.1 |
| &nbsp;&nbsp;plasma | -7.4 | -30.6 | 23.2 | -27.9 | 0 | -7.9 | -3.9 | -12.6 | -8.1 | -8.4 | -11.2 |
| &nbsp;&nbsp;steam | -5.6 | -26 | 20.4 | -20.7 | 0 | -9.1 | -9.6 | -18.1 | -21.3 | -6.3 | -2.9 |


## Determinism

`node scripts/audio-lab.mjs … --only everything --twice` renders the scripted 20 s sequence (two dancers, one a
player; stones; a drop at 5 s; a storm fusion at 14 s; every sfx; a fire roar; water drips; rising tension) twice,
from scratch each time, and compares the WAVs.

- **The score is identical**: the same 2,299 calls in the same order with the same arguments (the engine test checks
  JSON equality of two runs; the census of both lab renders matches).
- **The audio is not bit-identical.** First run: 2,835 of 2.2 M 16-bit samples differ, all by 1 LSB
  (`d0e46dc1…` vs `5b4b8c4c…`). After the fixes: 19,159 differ, by 1 LSB everywhere except seconds 2 to 4 (where the
  bed swells in under the first flood of stones), where the largest is 8 LSB (−72 dBFS) (`7d4163ab…` vs
  `a02e67d5…`). In float, the first pair differed everywhere by up to 5 × 10⁻⁶ (−106 dBFS). I ran it
  three ways to find the cause: rendering one recorded call list twice (differs), with the `onended` disconnects
  disabled (differs, up to 1.5 × 10⁻⁶), and with no reverb at all (differs, up to 2.1 × 10⁻⁶). So it is Chrome's
  OfflineAudioContext, not this code: its renders of one graph are not bit-exact (most likely SIMD summation order
  in its mixing, carried a little way by the compressor's level detection). At worst −72 dBFS for two seconds:
  inaudible. I did not isolate it further.
- **The film path.** `node scripts/film.mjs docs/reports/media/audio/film-a --seconds 20` (the `short` cut: prelude,
  wake, a swirl through the couple, a hold and a blast, then ten seconds more), run twice from scratch on the real
  GPU under the render lock (film B with `--port 5418`: another agent's film sink held the default 5398, which made
  my first attempt at B fail on `listen`). Both muxed a correct score: h264 + aac, 20.0 s each; the score peaks at
  −4.2 dBFS, RMS −13.6. The two `score.wav` files (`6ff0175a…`, `4193142c…`, 4,032,044 bytes each) differ in 1,948
  of 2,016,000 samples, by 1 LSB at most, spread evenly over the 21 s: the same renderer floor as above. So the
  whole path (GPU stone events read back and sorted, the score, the Recorder, the offline render) repeats for a given
  film script. The `onStones` events' order from the GPU does not matter any more: the score sorts them first.

## The live check

In headless Chrome (the real app on the GPU, render lock held), `bend.wake()` without any flag or gesture, a real
mouse click, and `--autoplay-policy=no-user-gesture-required` all gave a running AudioContext (headless Chrome does
not hold audio for a gesture). Then the groove at level 2, a dodge, an ice tick, a drop, an aurora fusion, sampled
once a second for 12 s: the output meter read 0.10 to 0.36 RMS with peaks 0.42 to 0.60, the level went 2 → 4 at the
drop, the fusion came in, the beat clock advanced at 112 bpm, the scheduler's lookahead settled at 120 ms, and the
page logged no errors. Underruns were not measured (Chrome exposes no counter to a page).

## The WAVs (docs/reports/media/audio/, git-ignored)

All rendered by the final code unless noted; 48 kHz, 16-bit stereo. `measurements.json` holds the numbers of the last
run (`measurements-final-geode-matter.json` the geode and matter renders, `measurements-before-fixes.json` the first).

| file | what |
|---|---|
| `ambient-geode.wav` | (a) level 0 in the geode: a gem dancer, stones, the prelude, a rise, two blasts (39 s) |
| `ambient-redwoods.wav` | level 0 in the redwoods by day: birds, wind, stones, a blast (33 s) |
| `mood-ember.wav`, `mood-midnight.wav`, `mood-sunrise.wav`, `mood-neon.wav`, `mood-roda.wav` | (b) two bars of level 0, then six bars each of levels 1, 2, 3, 4 |
| `barrage.wav` | (c) every move and exchange in four elements over the Roda groove at level 2 with the jogo toque and rising tension |
| `sfx-solo.wav` | (c) each sound effect alone, 1.6 s apart (every move, both sides of the forms) |
| `fusion-steam.wav`, `fusion-prism.wav`, `fusion-storm.wav`, `fusion-aurora.wav` | (d) two bars of groove, the fusion's eight bars, its bar back |
| `matter.wav` | (e) fire, water, ice, plasma, steam: 8 s each, held sounds swelling, events, moving left to right |
| `melody.wav` | the body plays: a player still, rising, wild, letting go (the groove follows) |
| `portal.wav` | the geode's groove, a crossing to the redwoods at 10 s, the change on the next bar line |
| `everything.wav` | the 20 s determinism script |
| `determinism-a.wav`, `determinism-b.wav` | the determinism pair (made before the last two small fixes: feet/boom pitch, plasma level) |
| `film-a/`, `film-b/` | the 20 s films (`energybending.mp4` with the score muxed, `score.wav`) |

## Honest weak points

- **Offline renders are slow**: 1 to 7 times real time on this (shared) PC; the barrage's 27 s took 200 s, Roda's
  30 s took 400 s. Chrome's OfflineAudioContext runs every node on one thread; the cave's 8 s convolver alone costs a
  quarter of real time, and each stone strike and each groove note is a handful of nodes. A 60 s film's score will
  take one to several minutes to render after the frames. Live, the same graph ran in the check above with no errors,
  but I did not measure its CPU on a laptop or a phone.
- **Bass-heavy, dark groove** (see the mood table). It is the prototype's balance; a listener should decide.
- **The groove is still compressed** at level 4 and in fusions (crest 9-10 dB): fine for dance music, but the tanh is
  working.
- **Not bit-exact** across renders (1 to 8 LSB, in Chrome's renderer), as above.
- **Plasma is the quietest kind** (−27.9 LUFS against −20.7 to −23.7 for the others); raising its buzz 4 dB did not
  move the segment, so its zaps set it. Not fixed further.
- **Matter voices are designed against synthetic events.** The levels and densities the real kinds will produce are
  unknown; a kind sending hundreds of events a frame must thin them first (the guide says so).
- **The conductor's thresholds** are the prototype's, doubled for metres, and tested only on a stand-in dancer of sine
  waves (91 notes in 30 s as it rose from still to wild). Real mocap and webcam bodies will need tuning.
- **Level from players only**: the current show (no players) never grooves. That is the requirement (level 0 is Gem
  Dancers), but nothing in the show marks a player yet except the webcam.
- **A programme's key** now transposes the mood on the next bar line, within a tritone; the foundation's KEYS order is
  kept but the bed's voicings are the mood's, not Gem Dancers' add9/maj7 voicings.
- **Gem Dancers' wind never gusted** (its gust LFO went to a node connected to nothing). I connected it, so the wood's
  wind now swells; a small change to "as it sounded".
- `audioParams.stoneWindow` sets the score's window; the matter ears use the score's placement, so both move together.

## Not done

- No CPU or underrun measurement of the live graph; no phone.
- The shared-clock path (`syncTo` / `measure`) is tested against a fake clock (locked within 0.1 ms, slew ≤ 2 ms a
  step, re-phase on a jump) but not wired to a network clock (wave 1 net owns that).
- No tempo-follow from a player's bounce (the prototype's `_bounce`; `clock.nudgeTo` is there to build it on).
- Stomps from players' feet (the prototype's `stomp`) are not triggered automatically; feet play the stones' notes.
- `pollEvents` exists for visuals but nothing reads it yet.

## Edits outside src/audio

- `src/main.ts`: Music takes the camera (the listener) and the kinds (for their ears); the camera pan function moved
  into `audio/spatial.ts`; `beat` is `music.clock` (FrameCtx.beat now reads the music engine). 8 lines.
- `src/engine/film.ts`: imports `wav`/`Recorder` from `audio/instrument` and renders with `renderOffline`. 3 lines.
- `package.json`: `npm test` also runs `scripts/test-audio.mjs`.
- `scripts/test-audio.mjs` (new): bundles and runs `src/audio/test/*.test.ts` with esbuild.
- `scripts/audio-lab.mjs` (new): drives the lab, writes WAVs and `measurements.json`.
- `docs/extending/sound.md` (new), this report.
- `scripts/film.mjs`: unchanged (its audio path posts the WAV the page renders; nothing there needed to change).
