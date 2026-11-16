# Phase 6: the online prediction made close again

Branch `p6-predict`, from master `c59f64b`. The problem: `npm run test:net`'s step "two virtual players in one room at
0 ms of lag" failed its check `at no lag the prediction is close` (p95 < 60 mm) in some runs. One page's p95 was 67 to
217 mm, against about 2 mm at the end of Phase 5. Only this agent ran test:net (port 5418).

## The cause: not the edge, not the mirrors

The guess was that the virtual players now dance by the arena's rim and the mirrors, where the server applies the soft
edge or the crossing hold-back and the page doesn't. **The measures say no.**

**First probe.** Each acknowledged input's error was tagged by where it happened:
- near the rim;
- in a mirror's lane;
- under the crossing hold;
- during a power;
- by the other's distance and facing.

The probe used the 0 ms step over real sockets, 10 runs. The worst acks were almost never in the soft edge's band
(0 to 2 of 9 to 31 big errors a run). Several bad runs had no crossing at all. The test's sight gives the players no
voyage (`DuelSight.voyage`), so they don't head for mirrors on purpose.

**Second probe.** The same step was run with the server and both pages in one process. That is deterministic and free
of machine load. Every tick it traced:
- what the server did to each body after the body's own step (the contact, the edge, the powers, the hazard, a
  crossing);
- the whole state the server stepped with: the intent, the beat, the env, lookAt, and the body's fields.

The big errors had **no** server step after the body's own. The server's `Character.update` and the page's differed,
from different starting states and different inputs to the step:

1. **A flung body's flight wasn't in the kit (the main one).** p6-flow (report 18-flow) added `Character.flightT`.
   `contact.ts` sets it through `carry()` on a fling or a lift, at the server only. It keeps the jump's cut off a body
   flown from outside. The kit a seat's snapshot carries didn't have it, nor `vaultT` or `faceT`. So every replay
   after a correction cut the flung body's rise: gravity × (cutMul − 1) × 3 ticks = 40 × 2.2 × 0.05 = **4.4 m/s**. That
   is exactly the velocity error measured, ack after ack for the 0.8 s of the flight: errors of 100 to 130 mm with
   nothing else differing.
2. **A hold let go was still held in the prediction.** The holder's own grab released flings at the server on the
   tick that input is stepped. The page kept the last snapshot's link for the inputs after it, so their stick was
   zeroed (`splitIntent` holding). The fling's event arrives a queue too late: the prediction runs about 4 ticks
   ahead of the server.
3. **The beat was 2 ticks early.** Each input was stepped on `now + rtt/2 + queue`, not on the tick it will be stepped
   on (the last ack's tick plus the inputs since, which the crossing judge already used).
4. **The partner's place (`lookAt`) was stale by the queue.** A body slower than 0.7 m/s turns to face the other, and
   the turn steers the moves that follow. The page faced the newest snapshot, carried on to *now*. During a replay it
   faced that same point for every input, though the server steps them 4 or more ticks on. It was off 0.2 to 1 m in
   75% of the acks.
5. **Load: ticks with no input.** When the page's inputs are late (a busy machine, a stall), the server repeats the
   last one (`take`) for those ticks. The page didn't know, and compared its prediction with a body that had moved
   1 to 6 ticks more. In the bad real-socket runs the server starved a seat 150 to 220 times in 20 s.

Why Phase 6: (1) arrived with p6-flow. The virtual players' swings and flings go through it, and 1, 2 and 4 all happen
around a swing, which is the lead's whole style. (5) grew with the machine's load: the film agents' GPU captures.

## The fix (the page predicts what the server does)

- `src/net/duel-body.ts`: the kit carries `flightT`, `vaultT`, `faceT` and `faceN`.
- `src/net/duel-client.ts` `predict`, on the server tick T the input will be stepped on:
  - the beat is T's;
  - `lookAt` is the other's root at the end of T − 1, as the server points it. It is taken between the other's kept
    snapshots, or carried on past the newest by its last steps.
  - the count-in and a reform end on the rules' clock (`frozenAt`), not when a snapshot says so;
  - a link ends after a fling, release or counter event's tick, and after this seat's own grab is let go while it
    holds.
- **Ticks without input.** The server tells each seat how many ticks it has stepped since its ack with no input
  (`r` in the snapshot, `DUEL_NET.STILL_TICKS` shared). The page steps those repeats on its prediction before comparing,
  then replays from the server's state. More than 6 (a stall) are taken as the server's, unmeasured. Without that cap,
  re-stepping a long stall at every snapshot slowed a page that was already behind.
- **Ticks without input that no snapshot saw.** These are found from the ticks two acks were applied on, against the
  inputs between them (`regap`). They are stepped again from the server's state at the earlier ack, up to 15, with
  the inputs after them on their own ticks.
- **New test** `src/net/duel-predict.test.ts` (in `npm test`, 5 s): the step's scene in one process, deterministic. It
  runs seeds 31, 61 and 71 at 0 ms, seed 31 at 80 ms, and a page that stalls 12 frames every 3 s. Each page's p95 must
  be under 20 mm. With only the `lookAt` change, the same scene's p95 was 17 to 122 mm on one page or the other
  (seeds 31, 41 and 51).

The thresholds in test/duel.test.ts are unchanged, and the mirrors are open.

**The soft edge is still not predicted.** It didn't show in these measures. When it acts, the server flags the body
PUSHED, and those acks count apart. Report 20-online's corrections near the redwoods' mirrors remain a separate issue.

## Numbers

**The deterministic in-process scene** (both pages' p95 at the acks, mm):

| seed | the `lookAt` change only | + flight in the kit, the input's own tick | + holds let go (this branch) |
|---|---|---|---|
| 31 | 35 / 23 | 1.5 / 1.7 | 3.8 / 3.2 |
| 41 | 17 / 106 | 17 / 1.8 | 0.7 / 1.1 |
| 51 | 2.2 / 122 | 2.2 / 8.9 | 2.2 / 8.9 |
| 61 | | 16 / 13 | 1.5 / 0.6 |
| 71 | | 24 / 97 | 4.8 / 16.5 |

**test:net, the 0 ms step** (`at no lag the prediction is close`: each page's p95 under 60 mm), real sockets. The
machine was shared with GPU films and other agents' Node processes, at 12 to 100% CPU. The worst page's p95 for each
run, in mm:

| | runs | the check passed | worst page's p95, run by run | median |
|---|---|---|---|---|
| master `c59f64b` | 15 | 10 (67%) | 27, 38, 38, 791, 12, 21, 54, 650, 113, 12, 217, 217, 39, 39, 29 | 38 |
| `c8960f1` (all but regap) | 12 | 10 | 0.7, 1.4, 8.3, 169, 1.4, 1.6, 10, 10, 1.2, 2.8, 1.3, 108 | 2.2 |
| `7e8d074` (this branch) | 3 | 3 | 11, 5.5, 2.5 | 5.5 |

- **Master's 15** are 1 test:net run, 10 probe runs of the same step (same seeds, same scene, real sockets) and 4
  `test/duel.test.ts` runs interleaved with the branch's, so both met the same load.
- **The two failures at `c8960f1`** came with the server starved 113 times or more in 14 s. The server's own tick went
  to 194 ms. The gaps those ticks left are what regap now steps again.
- **Not counted:** three runs while my own probes ran beside them, and six probe runs with the machine at 90% or more
  CPU (folds of 24 to 28 inputs). Those were bad on any code.

The other test:net steps on this branch (runs 7 and 8, the last two):
- **80 and 200 ms:** p95 0.8 to 7.3 mm.
- **Crossings, seat 1's page near a crossing, p95:** 19 / 14 / 10 mm and 21 / 16 / 13 mm at 0 / 80 / 200 ms.
  Master's interleaved runs: 17 to 21 mm at 0 ms, 10 to 19 mm at 80 ms.

## Tests

- **`npm run typecheck`:** clean.
- **`node scripts/test-ts.mjs`:** 31 of 31 files pass. Two are of note:
  - `duel-predict.test.ts` is new: 5 of 5;
  - `duel-cross.test.ts`: 4 of 4, with the same numbers as report 20.
- **`npm run test:net`, runs on this branch's code:**
  - the last two (`7e8d074`) passed every file. The 0/80/200 ms crossing steps passed, and so did the watcher,
    refusal and rejoin steps.
  - one more `7e8d074` run passed its 0 ms step, then its test process ended with exit 1 and no output, mid-80 ms
    step. Three probe runs of that step showed no exception. A process killed from outside fits, as other sessions run
    Node on this machine.
  - **Earlier runs (`c8960f1`):** 2 of 6 passed everything. The failures:
    - load checks: the authority's tick p99 at 127 ms, snapshots under 15/s;
    - one 0 ms run at 169 mm (starved);
    - one 0 ms crossing step at p95 107 mm against 100, under the same load.
- **`test/two-duel-cross.mjs`:** not run (GPU).

## Not done

- **Inputs the server folds away.** When a burst overfills the server's queue (`QUEUE_MAX`), it folds its oldest
  inputs into the next: their movement is skipped and their presses kept. The page doesn't foresee that. It took the
  machine at 90% or more CPU to see it, with 24 to 28 inputs folded at once and errors of metres. That is one
  correction each.
- **A link broken by distance or by its time** (`CONTACT.BREAK`, `HOLD_MAX`) is not foreseen. The held body's counter
  and lift are the other's input. Each is one correction.
- **The powers' riding and launching** (updrafts, `boost`) are not predicted. Those bodies are shown from the server
  (CARRIED) and counted apart, as before.
- **`test/two-duel-cross.mjs` was not run.** It needs a GPU, and the GPU was in use by another agent's film.
