# 14: the duel's sound

Branch `worktree-agent-a16d19f57334ea977`, from master `ac4e6fe` (phase 2 and its film), master's phase 3 feel work
(`48d72de`: the weight of contact, the juice events, pair combos) and its hazards (`4a6d80b`: the Pool's water a
floor, the tide, the wind, the swell, the hum) merged in. The brief, in the owner's words: "dont
hear any music or audio .. should be music we made and effects like water/fire/etc as we dance and move". Make sure
the worlds' tracks and the matter voices play in the duel however it starts; give the contact dance its sounds (on the
beat where musical), the ten powers and the reactions theirs, the tiers a rising voice, the movement soft ones; keep
it a chill game of nature, healing and awe: water, wind, embers, glass bowls, chimes and breath, never an impact.

**Measured:** `npm run typecheck`; `node scripts/test-ts.mjs` (15 of 15 files); `node scripts/test-audio.mjs` (34
tests, 8 new); two bots dueling in headless Chrome on the real GPU in all four worlds, 80 s each (a whole set and the
next count-in), an AudioWorklet on the mix's buses recording peak and RMS every 100 ms and K-weighted copies for
loudness, every cue's time, every call the synth was handed; every duel sound alone, rendered offline at the duel's
balance (`audio-lab.mjs --only duel-solo`); a 23 s low-quality film clip with its score (ffmpeg's ebur128).
**Not measured:** anything by ear (nobody listened; the WAV and the clip are there to hear); Safari, iOS, Android,
Firefox; a real browser's autoplay policy (headless Chrome runs the AudioContext without a gesture whatever the flag,
so the gesture paths below are read in the code, not seen); a person playing; the CPU cost of the new voices on a phone.

## Why the duel was quiet

1. **The bots' duel made its sound outside any gesture.** `?duel&p1=bot&p2=bot` begins at load, and `begin()` makes
   the AudioContext there. A real browser holds such a context suspended until the first gesture (Live's `wake` resumes
   it on the next click, key or tap), and while it was suspended the music's clock stood still (`Music.now()` is the
   context's time): the duel's beat froze, and when the sound did start the track began at its bar 1 wherever the set
   was. Now the track is put where the set is the moment the context runs (below), and any first gesture on the page
   starts the sound inside that gesture, before any seat has joined (a click on a waiting seat; before, only a key a
   layout knew or a touch did).
2. **The duel's own sounds were the jogo's effects, at the jogo's level, under a track.** fx.ts and power-fx.ts asked
   `music.sfx` for the jogo's capoeira sounds (`clash` for a catch, `hit`, `parry`, `dodge` for a fling: struck and
   percussive), and under a world's track those sit where report 9 put the jogo's: measured in the temple, a catch
   peaked 2 dB over the track's RMS (13 dB under its peaks), a landing 20 dB under its RMS, the movement unheard. The
   matter voices (fire's roar, water's pour) were 10 dB under the track's RMS.
3. Nothing else was missing: the track played in every world from the duel's start (the deck on its clock to the
   sample, as report 9 measured), and the matter voices were there (fire's and water's held sounds about 50 a second
   each, crackles, drips, steam's hiss).

## What plays when

`src/duel/sound.ts` decides, `src/audio/synth/duel.ts` sounds it (a new `Instrument.duel(t, call)`, so a film's
recorder writes it down and its score has it). Each cue is in its seat's matter's colour (the seat's dress, kept
through the power form): **fire** a warm triangle with embers crackling in it, **water** a sine that bubbles up onto
its note, **ice** a bright inharmonic bell with a breath of frost, **plasma** two detuned sines shimmering on a soft FM,
**gems** the stones' own glass bowl and crystal bell. Every pitched note is taken from the harmony sounding when it
plays (the track's key and that bar's chord, its pentatonic for runs), so a string of catches arpeggiates the music.

| event (its name in the map) | cue | the sound | on the grid |
|---|---|---|---|
| `duel:count` 3, 2, 1 | count | a crystal tick, a chord tone higher each count | beat |
| `duel:go` | go | the chord in glass bowls opening, a crystal above, a breath | bar |
| `touch:catch` / `duel:juice` catch | catch | a bowl on the chord's root, the catcher's colour on a chord tone, the caught one's a third above, a low warm bloom under it (the catch's weight, felt not struck) | beat or 8th, 70 ms |
| `touch:aerial` / juice aerial | aerial | the catch, brighter, and three crystal chimes rising after it in 16ths | beat or 8th |
| `power:catch` / juice range | range | a glide across the gap onto the catch | beat or 8th |
| `touch:swing` (n in its hold) | swing | a gust of wind round the contact, each swing of a hold a step higher on the pentatonic | 8th |
| `touch:fling` / juice fling | fling | a breath rising, the flinger's colour, a chime going up | 8th or 16th |
| `touch:landed` (feet, wall) | landed | the flyer's colour settling a step down | 8th or 16th |
| `touch:lift`, `touch:vault` | lift | a tone climbing an octave, a bell at the top | 8th |
| `touch:counter` | counter | a flutter of wind chimes | 16th |
| `touch:release` (stretched) | release | a sigh | free |
| `duel:merge` | merge | a chord of bowls swelling, both colours inside it, a shimmer above | beat or 8th, 120 ms |
| `duel:finale` (not fused) | finale | the lift: a long breath rising, the pentatonic climbing in 8ths over a bowl, both colours at the top | bar or beat |
| `duel:finale` (fused) | fusion | a bloom over two octaves of bowls, the chord held as a pad, chimes in 16ths, both colours | bar or beat |
| `duel:juice` lift | lift (big) | the finale's lift at its top | 8th |
| `duel:done` | banner | the chord in bowls down in 8ths, the winner's colour on top, a low bowl | beat |
| `duel:tier` | tier | FLOW, BLOOM, RADIANT, SUBLIME: (2 + tier) crystal chimes in 16ths, from higher each tier, through a low-pass opening 2.4, 4.1, 6.9, 11.8 kHz, the dancer's colour on each; SUBLIME adds a bowl chord | beat or 8th |
| `duel:pairTier` | tier (pair) | DUET, CURRENT, MURMURATION, AURORA: the same run one note longer, the two colours by turns, over a chord of bowls | beat or 8th |
| `duel:combo` (6+ banked), `duel:pairCombo` | bank | two soft chimes a fifth apart (a pair's: the two colours answering) | 8th |
| `duel:fall`, `duel:ready` | fall, reform | a breath going down; a bowl's reversed swell rising into the body | free; 8th |
| `power:cast` | cast | each power's own figure in its matter: **flare** a whoomph of flame rising with embers; **ribbon** a long sizzle of embers along the dash; **whip** a liquid lash, spray and bubbles; **wave** surf swelling and drawing back for the wave's life (the wash); **step** a chord of ice bells set at once, frost; **slide** a glass glissando down the pentatonic over a hiss of frost; **blink** a blip two octaves up and a shimmer; **arc** a humming tether rising a fourth; **pillar** stone bars climbing the chord under a rising hum, a bell at the top; **prism** a facet: a high bell over a bowl. In the form (`+`) all of it louder | 8th or 16th, 60 ms |
| `power:react` | react | **STEAM!** a hiss swelling over a low bowl, a whistle rising; **MELT!** water dripping down the chord; **FREEZE!** a crackle of ice bells and frost, a bell after | beat or 8th |
| `power:form` | form | on: the matter's colour climbing four tones over a bowl chord and a rising breath; off: a sigh down two | beat or 8th |
| `power:launch`, `power:blink` (a swap), `power:redirect` | launch, swap, redirect | a puff going up; two blips crossing; a glass ping | free; free; 16th |
| `body:dash` | dash | a breath of wind with a grain of the matter (an ember, a bubble, a bell) | free |
| `body:wallJump` | walljump | a small tick of a chime and a puff | free |
| `body:land` (past 3.5 m/s) | land | a soft low bloom (no thud) and the matter's touch: a pat of water, a puff of embers, a crunch of frost, a pebble's clink; by how hard | free |
| `body:jump` (in the air) | jump | a whisper | free |

**The map** (`DUEL_SOUNDS`): every event's name is `<source>:<name>`, `duel:` the rules' events (shared/duel.ts
`DuelEvent.k`, the powers' rules events and phase 3's `juice`, `pairTier`, `pairCombo` among them), `touch:` the
contact's (`ContactEvent.kind`), `power:` the powers' moments (`PowerFx.k`), `body:` a body's own (Character events'
`type`). A line turns one event into a cue or nothing; a name not in the map is ignored (and counted:
`bend.duel.sound.stats().unmapped`). Phase 3's `juice` is keyed by its `what`: catch, aerial, range and fling are
those cues sized by the moment's `w` (it arrives in the same frame as its touch: the strongest catch a moment plays,
the twin is dropped), lift is the finale's top; its tier, pair, merge and fusion are heard from the rules' own events.

**The beat** (`onGrid`): a cue goes to the nearest line of the coarsest of its grids within its window (a line that
far ahead is waited for, one passed less than 25 ms ago counts as on it), else at once. Live nothing can be played in
the past, so the window looks forward and is small: over a uniform spread of event times at 94 bpm a catch waits
for the grid 30 % of the time (mean 26 ms), a cast 53 % (21 ms), the merge 45 % (50 ms); in the duels below 18 to
30 % of all cues snapped, with a mean wait of 18 to 29 ms. Movement is never held back.

**Twins:** one catch a moment (at range over in the air over on the ground), a cue from the same seat inside its gap
(0.1 to 2 s by cue) is the same moment; the old jogo effects fx.ts and power-fx.ts still ask for are dropped
(`sound.jogo()`; `keepJogo` passes them on, for comparison).

## The set on the music

The duel's set clock and the track were unrelated: a set began whenever the last banner ended, ran 60 s of the
bodies' time, and its count-in, "go" and finale fell anywhere in the track's bars. Now (`SetMusic`):

- **A set is whole phrases** of its world's track (`phraseSetMs`, 4-bar phrases nearest a minute): the temple 24 bars
  (61.26 s), the geode 28 (60.31), the redwoods 28 (59.44), the Pool 32 (63.44). Not in a film or with `&set=`.
- **Each set's count-in places the track** so its "go" lands on a phrase's downbeat: the first set on the track's bar 1
  (its count-in in the file's own lead-in, the deck held until its first sample: the music comes in on GO), each later
  set on the phrase line nearest where the music had got to (at most two bars away; the deck crossfades half a second
  at the count-in) — so a duel walks through its song set by set and round the loop.
- **The set's clock keeps with the music.** The weight's holds (phase 3: a catch holds the bodies' time a few frames,
  a pair tier slows them for a beat) hold the rules' clock with the bodies, 3.7 to 5.1 s a set (measured), and a frame hitch loses
  a little more. `SetMusic.nudge` adds back up to 12 % of each ordinary frame's time to the set's clock (never during
  a hold), so the set catches the music up and the finale lands at or near its phrase line; one line in index.ts.
- **A big drift moves the music**: more than two beats in play (a context that woke at a late first gesture, a tab
  that came back) or an eighth of a beat in the count-in and the banner, and the track is put back where the set is.
- Not in a film (its track is laid under it and its clock anchored by the film tool) or on a room's shared clock (an
  online duel: the room says where the track is).

Measured, the count-ins: the counts within 0.08 of beats −3, −2, −1 and "go" on beat 0.005 to 0.03 (set 1) or on the
next phrase line (set 2: beat 112, 128, 152 or 128 by world), all on the grid. The finales land 0.03 to 0.43 beats
after their phrase line (the table below): the set's clock made up 3.7 to 5.1 s of holds a set at 12 %, and what is left
is the last seconds' holds. Before (the first runs, no nudge) the temple's finale fell 0.18 beats off; with a nudge of
8 % and the holds moving the plan, 1 to 2 beats off.

## The arenas' hazards

Master's hazards (src/duel/hazards.ts, merged in last) act on the music's 4-bar phrase and show themselves before
they act; `HazardSound` gives each a soft sound once a phrase, timed to its own beat (`CueReq.beat`), on the motion
bus under the music:

| hazard | when | the sound |
|---|---|---|
| the redwoods' wind | from the gust's warning, 3 beats before its phrase line, through its rise, hold and fall | leaves and needles rustling on the air (small bursts of high band noise), then the wind swelling and easing (a low band of noise) from the side it blows from |
| the Pool's swell | from its phrase line, over the 12 beats it crosses | surf gathering and drawing back, panned across as it rolls, a low tone under it |
| the geode's hum | through its 8-beat warning before the line; its column on the line | a rubbed glass bowl's two close tones swelling; then a chord of glass bowls blooming and a tone climbing |
| the temple's tide | each phrase line while the tide is in (over 15 % of its height) | a slow wash coming in and drawing back over the phrase, as deep as the tide, a few bubbles |
| a body landing in the water (`hazard:splash`) | at once | a splash by how hard it came down, bubbles climbing the chord |
| a jump off the swell's crest (`hazard:crest`), a body lifted by the hum (`hazard:lift`) | crest on a 16th | foam lifting with the matter's colour; a puff going up |

## The levels

The balance under a world's track (`DUEL_BALANCE`, through `Instrument.under`'s new optional levels: the duel's bus
2.6 and the movement bus 3.4 times their level without a track, where the jogo's sfx sits at 1.6; the matter voices
keep the jogo's). Two bots (skill 0.85, seed 3), 80 s each: a whole set, its finale and banner, the next count-in.
"At the speakers" is each bus's tap carried through the master (×0.17 under a track), the tanh's small-signal gain and
the output's 0.72 (the compressor left out: it only lowers the loudest); loudness is K-weighted and ungated.

| | temple (fire, water) | redwoods (plasma, gems) | Pool (water, ice) | geode (ice, fire) |
|---|---|---|---|---|
| the track: loudness, RMS, peak at the speakers | −19.8 LUFS, −22.3, −7.4 dBFS | −20.4, −23.2, −7.7 | −17.5, −20.4, −8.2 | −18.4, −21.3, −7.3 |
| the game's sounds, all (LU from the track) | −6.0 | −4.0 | −7.8 | −7.1 |
| the matter voices and stones (the world's bus) | −9.6 | −6.5 | −12.9 | −11.2 |
| the duel's moments (its bus) | −9.6 | −7.4 | −9.9 | −10.1 |
| the movement and the hazards (the motion bus) | −27.2 | −19.1 | −24.9 | −22.5 |
| a catch: median peak (dBFS), over the track's RMS there | −17.2, +4.9 dB | −15.8, +6.7 | −15.6, +5.7 | −16.1, +4.9 |
| an air catch | −15.5, +7.7 | −15.7, +8.4 | −15.4, +4.2 | −15.5, +7.5 |
| a swing, a landing, a dash (median peaks) | −22.5, −28.6, −33.0 | −20.1, −25.5, −35.0 | −21.5, −26.8, −27.3 | −21.1, −30.1, −34.1 |
| the hazard (median peak in its first 0.4 s) | tide −31.6, splash −25.5 | gust −33.8 | swell −33.4, splash −25.6 | hum −46.1 (it swells), its lift −17.5 |
| before the tanh: the loudest peak, the tanh's gain reduction there | −8.2 dBFS, 1.0 dB | −7.5, 1.2 | −7.3, 1.2 | −9.3, 0.8 |
| cues a minute (moments, movement and hazards) | 222 (137, 85) | 199 (124, 75) | 263 (157, 106) | 231 (144, 87) |
| on the grid, the mean wait | 18 %, 29 ms | 30 %, 25 ms | 27 %, 18 ms | 22 %, 23 ms |
| the finale's beat (its phrase line) | 96.03 (96), on the grid | 112.08 (112) | 128.24 (128), fused | 112.43 (112) |
| the set's clock made up (s) | 4.2 | 3.7 | 5.1 | 4.3 |

- **The music** is the loudest thing, as it should be: the game's own sounds 4 to 8 LU under it (the matter voices 6.5
  to 13 LU under, the duel's moments 7.4 to 10 LU under), the movement and the hazards 19 to 27 LU under (soft taps,
  breaths, washes that come forward when nothing else plays).
- **The moments** stand out of it: a catch's median peak 5 to 7 dB over the track's RMS there (8 to 10 dB under the
  track's own peaks), an air catch 4 to 8 dB over; a swing about level with the track's RMS; a landing 2 to 8 dB under
  it, a dash 7 to 13 under. Before (the jogo's effects at the jogo's level) a catch peaked 2 dB over the RMS.
- **The limiter** (Live.levelMeter('pre'): the compressor's output, before the tanh) peaks at −7.3 to −9.3 dBFS, where the
  tanh takes off 0.8 to 1.2 dB; at the 95th percentile of each second's peak 0.7 to 1.0 dB. Before this work (the
  jogo's effects) it peaked at −11 dBFS (0.6 dB).
- **How many:** 200 to 260 duel cues a minute (125 to 160 moments, 75 to 105 movement and hazard sounds), against about 7,500 held-matter
  updates a minute (fire's roar, water's pour, steam's hiss, restated each frame), 380 matter events (crackles, drips,
  flares, splashes, ticks), 300 stones, 640 melody notes from the players' hands (the conductor: both seats are
  players) and 13,000 hand-breath updates.

### Each sound alone

At the duel's balance (no track, no bed), `docs/reports/media/audio/duel-solo.wav` (git-ignored, 2.2 s apart):

| sound | peak dBFS | LUFS | sound | peak | LUFS | sound | peak | LUFS |
|---|---|---|---|---|---|---|---|---|
| count:fire:3 | -18.5 | -28.7 | tier:water:2 | -14.6 | -25.7 | dash:fire | -30.4 | -53 |
| count:fire:2 | -19 | -29.5 | tier:water:3 | -14 | -24.2 | walljump:fire | -29.6 | -49.1 |
| count:fire:1 | -18.3 | -29 | tier:water:4 | -12.3 | -21.3 | land:fire | -26.1 | -47.4 |
| go:fire | -11.3 | -22.6 | bank:fire | -20.6 | -31.7 | dash:water | -29.5 | -52 |
| catch:fire | -10.6 | -26.7 | fall:fire | -28.7 | -44.6 | walljump:water | -28.7 | -50.1 |
| catch:water | -12 | -26.4 | reform:fire | -33.4 | -46.4 | land:water | -26.7 | -46.7 |
| catch:ice | -11.7 | -26.3 | cast:flare:fire | -13.5 | -31.3 | dash:ice | -29.6 | -50.8 |
| catch:plasma | -11.3 | -26.5 | cast:ribbon:fire | -16.3 | -30.5 | walljump:ice | -28.3 | -48.4 |
| catch:gems | -12.5 | -25.6 | cast:whip:water | -13.9 | -34.4 | land:ice | -27.9 | -49.2 |
| aerial:water | -12.3 | -24.6 | cast:wave:water | -13.6 | -32.3 | dash:plasma | -27.6 | -49.1 |
| range:water | -12.5 | -25.9 | cast:step:ice | -13.1 | -31.6 | walljump:plasma | -31.3 | -50.6 |
| swing:fire:1 | -24.8 | -41.6 | cast:slide:ice | -14.4 | -27.2 | land:plasma | -27.5 | -46.6 |
| swing:fire:3 | -30 | -49.2 | cast:blink:plasma | -14.6 | -35 | dash:gems | -28.9 | -48.9 |
| fling:fire | -23.2 | -34.4 | cast:arc:plasma | -14.8 | -28.3 | walljump:gems | -28.6 | -44.1 |
| fling:water | -23.3 | -32.5 | cast:pillar:gems | -14.8 | -26.6 | land:gems | -22.9 | -41.9 |
| landed:water | -25.7 | -41.3 | cast:prism:gems | -14.4 | -24.4 | jump:fire | -40.9 | -52.9 |
| lift:ice | -23.8 | -31.2 | react:geyser:fire | -11.9 | -25 | splash:water:0.8 | -22.8 | -43.6 |
| counter:plasma | -22.6 | -34.5 | react:melt:fire | -16.1 | -32.5 | crest:water | -26.9 | -46.6 |
| release:fire | -38.2 | -54.9 | react:freeze:water | -18.4 | -29.2 | tide:water:1 | -24.8 | -43.3 |
| merge:fire | -12.5 | -25 | form:fire | -15.1 | -27.8 | gust:fire:0.6 | -21.1 | -32.6 |
| finale:fire | -13.7 | -23.3 | form:fire:off | -24.7 | -38.6 | swell:water | -22.4 | -40.7 |
| fusion:fire | -10 | -20.5 | launch:gems | -38.6 | -58.7 | hum:gems | -22.9 | -33.1 |
| banner:water | -11.1 | -20.2 | swap:plasma | -27.5 | -45.2 | humlift:gems | -18.8 | -31 |
| tier:water:1 | -12 | -23.6 | redirect:gems | -26.5 | -34.8 |  |  |

The catches sit together in every matter (−10.6 to −12.5 dBFS peak) and differ in colour (ice's 2 to 6 kHz band 13
dB over fire's, gems' glass brightest in the mids). The ten powers, measured alone, were 4 to 7 dB apart (the flare,
ribbon, blink and arc the quietest); each now has its own gain inside the cast and all ten peak within 3 dB (−13.1 to
−16.3). The tiers rise in brightness (SUBLIME's 2 to 6 kHz band 21 dB over FLOW's) at about one loudness.

### A clip with sound

A 23 s preview (640×360, 30 fps) of a temple duel from its count-in, with the temple's track from bar 1 and the
duel's recorded score under it (`scripts/film.mjs` on a one-shot timeline):

`docs/reports/media/film/14-sound-clip.mp4` (git-ignored; rendered after the juice merge, before the hazards'
sounds): **−15.8 LUFS integrated, true peak −3.5 dBFS, LRA 2.2 LU**. The shot's recorded score alone (the duel's
sounds, the matter voices, the stones, the hands' melody) is −22.2 LUFS (peak −8.1), the temple's track over the same
23 s −18.1 LUFS: the game's sounds about 4 LU under the music, as in the page. (Report 13's film: −14.4 LUFS.) Before
the balance was set by loudness (the first clip, with the duel's bus at 3.6 and the matter voices raised) the score was
−18.7 LUFS, level with the track: that is why the balance came down.

## Files

- `src/duel/sound.ts` (new): the map, the beat, DuelSound, SetMusic, `duelSound` (joined to the page), `phraseSetMs`,
  `DUEL_BALANCE`.
- `src/audio/synth/duel.ts` (new): DuelVoices, the cues' patches and make-up gains.
- `src/audio/instrument.ts`: `DuelCue`, `DuelCall`, `MOTION_CUES`, `Instrument.duel`, `UnderLevels` and `under`'s
  optional levels. `src/audio/synth/synth.ts` (`duel`, `under` with levels), `mix.ts` (the duel's and the motion
  bus, `UNDER.duel`, `UNDER.motion`), `stones.ts` (`voice()`: the bank's buffers lent to the duel's bowls),
  `deck.ts` (`stop(fade)`), `lab/lab.ts` (the `duel-solo` render).
- `src/duel/index.ts` (the hook: 8 lines changed): the set's length in phrases, fx.ts's and power-fx.ts's effects through
  `sound.jogo`, the sound made beside `bend.duel` (and on it: `bend.duel.sound`), the set clock's nudge.
- `src/audio/test/duel.test.ts` (new, 8 tests: the map with the juice and pair names, the beat, a frame through a
  Recorder, the hazards' phrase sounds, the tiers, every cue's timing, gain and voice, the phrases, the set on the music).

## Unverified

- **Heard by nobody.** Everything here is levels and timings; a listener should judge the colours, the swings' wind
  (the most frequent sound), and whether the moments sit right over each track.
- **Safari, iOS, Android, Firefox and a real Chrome's autoplay policy:** the gesture paths (any first gesture starts
  the sound inside it; a suspended context resumes on Live's own wake; the track then put where the set is) are read in
  the code and covered by a unit test of the placement, not seen in a browser that enforces the policy.
- **Phones:** the voices are a few to twenty Web Audio nodes each, about 3 a second; not measured on a phone's CPU.
- **Online duels:** on a room's clock the track placement is off by design; the cues play but were not run online.
- **The front's duel** (another agent's): its `begin` goes through the same `startDuel`, so the same paths, untried.
- **The hit-stop** holds the rules' clock with the bodies; the sound and the music keep the page's time, so a catch
  is heard on its frame, and the set's clock catches the music up afterwards (12 % of an ordinary frame at most).

## Not done

- The melody the conductor plays from the two seats' hands (both are players: 640 notes a minute, 25 LU under the
  track) is untouched; whether a duel wants it is a listening question.
- The swing's gust is the most frequent cue (37 to 56 a minute); it was lowered once and may want thinning by ear.
- `bend.duel.stop()` leaves the duel's balance on the music (one more line in index.ts would put the jogo's back).
- The hazards' sounds were measured in one 80 s run per world, after the rest was tuned; the hum's and the gust's
  swells are long and their levels by ear unchecked. The tide's water under the bodies makes splashes in the temple too
  (26 a run).
- The clip predates the hazards' sounds; no clip was rendered after them.
- The lab's solo render plays without a track; the live numbers are the ones under each world's track.
