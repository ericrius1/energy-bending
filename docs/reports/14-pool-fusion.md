# 14, follow-up: why the Pool fused so easily, and the fix

Branch `p3-pool-fusion`, from master `040beef` (phase 3 merged: feel, arenas, camera, sound, front, online). The
arenas report (14-arenas) found the Pool, its water now a floor, **fused in 31 of 40 sets** against 5 to 7 in the
other worlds. The brief: find why, and keep the fusion about 1 set in 8 at skill 0.85 in every world, without bringing
back falls and without touching the water or the hazards.

**Measured:** `node scripts/duel-measure.mjs` (the arenas agent's harness: 40 sets of 60 s per world, skill 0.85, free
3D, the dress and the styles rotated, hazards on, the time warp off as the arenas measured), before and after, with
seeds from 1 and again from 7; the Pool with the swell off; the Pool and the temple with the warp on (as the page
plays); `npm run typecheck`; `node scripts/test-ts.mjs` (18 of 18 files). The harness now also prints the first MERGE,
the longest stretch at the top, where the shared energy came from and went (links, holds' first moments, the ebbs, the
merges), the energy's sources while at 0.85 or over, the share of time apart with both combos live, and the time apart
between holds; `--duel KEY=V` tries a rule constant and `--tune world:gain:ebb` a world's energy. **Not measured:** a
person playing; the page; `npm run test:net` (not run, as asked).

## Why

| (40 sets, seeds from 1, before) | temple | redwoods | geode | Pool | Pool, swell off |
|---|---|---|---|---|---|
| fused | 5 | 6 | 7 | **31** | 11 |
| catches a minute (from the air) | 23.9 (38%) | 23.1 (40%) | 21.7 (44%) | 26.7 (**76%**) | 23.3 (64%) |
| two apart, mean | 1.6 m | 1.6 m | 1.7 m | 1.4 m | 1.6 m |
| seconds a set at 0.85 or over (20 sets) | 5.0 | | 5.7 | **19.9** | 9.2 |
| longest stretch at the top (0.9+), mean | 1.2 s | 1.3 s | 1.4 s | **6.6 s** | 2.4 s |
| apart with both combos live (20 sets) | 6% | | 18% | **31%** | 22% |
| wall jumps a player-minute (probe, 4 sets) | 11.5 | | | **33.5** | |

- **Not closeness alone.** With the swell off the two stand 1.6 m apart on average, as in every other world, and the
  Pool still fused 11 of 40, twice the others.
- **The swell** does most of it (31 against 11): its crest throws the two together, three catches in four are out of the
  air (against two in five elsewhere), and the pair meets a little more often.
- **Being in the water** does the rest, through a rule. Afloat, a body is 1.3 to 1.5 m under a stone's top: every stone
  is a wall to kick off, and the bodies wall-jump three times as often as in the temple and spend 63% of the set in
  the air (51% in the temple). So both dancers' combos stay live while they are apart, 31% of the time apart against
  6% in the temple, and the rules halved the energy's ebb apart whenever both combos were live (`EBB_LIVE`, 0.5). In the
  energy's account, the ebb apart took 1.08 a set in the Pool against 1.46 in the temple, while links and holds gave
  about the same. With the ebb halved, the energy sat at 0.85 or over for 20 s a set (5 s elsewhere) and held the top
  for the fusion's 3 s in most sets.

## The fix (shared/duel.ts, the Pool's arena)

1. **The ebb apart no longer halves while both combos are live** (`EBB_LIVE` removed). Two dancers each busy with their
   own moves side by side are not playing together; that is what the shared energy measures, and the pair combo now
   marks real togetherness. This is the loophole the water opened, and it is a rule for every world. Elsewhere it
   barely shows (fused 5, 4, 6 of 40 against 5, 6, 7), since both combos are rarely live apart there. Alone it took the
   Pool from 31 to 23 of 40.
2. **The Pool's energy** (`Arena.energy`, a new optional field read into `DuelState.tune` by `DuelMatch`): its gains ×0.93
   and its ebbs ×1.15. Even with the loophole closed, the swell and the water make the Pool's dance denser than the
   others' (a third more catches, three in four from the air), which is good play and should stay. The world's energy
   is scaled so that this density doesn't fill the energy faster than elsewhere. The water, the swell, the floating and
   the stones are as the arenas agent left them; no body moves differently (the catches and falls are identical before
   and after).

`DuelTune` is part of the rules' state, so the server and the client's prediction (both build a `DuelMatch` from the
arena) and the Node harness all play it. `restartDuel` keeps it.

## After

| | temple | redwoods | geode | Pool |
|---|---|---|---|---|
| **fused**, before → after (seeds from 1) | 5 → 5 | 6 → 4 | 7 → 6 | **31 → 3** |
| fused after, seeds from 7 | 6 | 10 | 5 | 6 |
| fused after, warp on (as the page plays) | 5 | | | 7 |
| first MERGE, soonest / mean, before | 29.2 / 41.8 s | 25.1 / 41.0 | 28.2 / 40.8 | 24.2 / 33.0 |
| first MERGE, soonest / mean, after | 29.2 / 42.0 | 25.1 / 40.1 | 28.2 / 41.6 | 27.9 / 41.1 |
| sets merged, before → after | 26 → 25 | 27 → 24 | 24 → 24 | 40 → 37 |
| catches a minute (unchanged) | 23.9 | 23.1 | 21.7 | 26.7 |
| falls a set (unchanged) | 0.00 | 0.10 | 0.10 | 0.00 |
| at the top, longest stretch, mean | 0.95 s | 0.81 | 1.14 | 1.41 |

Over the three Pool runs (seeds from 1 and 7, the warp off and on) it fused 16 of 120 (13%, about 1 in 8). The other
worlds fused 41 of 280 after (15%) against 18 of 120 before (15%, seeds from 1 only), all within the spread of 40-set
runs (seed 7's redwoods fused 10). The Pool still merges more than the others (1.3 merges a set against 0.85), and its
energy's peak is a little higher (0.91 to 0.92 against 0.85 to 0.89). The fusion, which is what was asked for, is now
as rare as elsewhere.

## Files

- `shared/duel.ts`: `EBB_LIVE` removed from the ebb apart; `DuelTune` and `DuelState.tune` (the energy's gains and
  ebbs scaled; `newDuel(now, bpm, tune)`, kept by `restartDuel`).
- `src/duel/arena.ts`: `Arena.energy?: { gain?, ebb? }`. `src/duel/match.ts`: the arena's energy into the state.
- `src/worlds/pool/arena.ts`: `energy: { gain: 0.93, ebb: 1.15 }` (only that line and its comment).
- `src/duel/measure.ts`: the pacing and the energy's account printed, `--duel`, `--tune`, `--warp`.
- `docs/design/duel.md`: the energy's ebb and the arena's energy.

## Not done, unverified

- **People.** The tuning is for virtual players at skill 0.85. People meet less in every world, and the Pool's ×0.93
  could make its fusion rarer for them than the other worlds' are.
- **The merge** stays commoner in the Pool (1.3 a set). The brief was the fusion. A Pool merge every ~45 s may still
  read as easy.
- **Noise.** 40 sets a world gives about ±3 fusions. A run from another seed moved the redwoods from 4 to 10.
