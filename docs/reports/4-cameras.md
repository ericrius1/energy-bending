# Wave 4: cameras through gates, and the game screen

Branch `worktree-agent-a47b75529ea10340f` (task 4 of `docs/reports/3-critique.md`). Owned: `src/portals/`,
`src/engine/camera.ts`, `src/engine/shots.ts` (unchanged in the end), `scripts/check-portals.mjs`, the step files
`scripts/steps/cameras-*.json` (written by `scripts/steps/cameras-gen.mjs`), this report.

Measured: `npm run typecheck`, `npm run build`, `npm test` clean (check-portals now 10,023 checks, twelve of them the
camera through a gate and the locked framing, below); the critic's takes re-staged as short takes and captured with
`scripts/critic-cap.mjs` on the RTX 5090 through headless Chrome (dev server on port 5424, one take per lock hold);
the brightness across a crossing frame by frame (mean luma of every frame, ffmpeg `signalstats`); the follow camera
through both doors read back frame by frame (eye, player, which world). Not measured: a real gamepad or a person
playing, a phone, a long soak, timings (the lock queue was long; the stills slot costs one gate view on the frames it
takes a still, at most four a second, not timed).

__RESULTS__
