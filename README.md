# Energy Bending

A two-player dance game in 3D, on WebGPU. Dancers are skeletons wearing matter (gems now; fire, water, ice and plasma
to come) that answers the music. This repository is at its foundation: Gem Dancers' dancers of stone, in the geode
and the redwoods, rebuilt into the structure the game will grow in.

```bash
npm install
npm run dev        # http://localhost:5391/energybending/
npm run build      # dist/
npm run typecheck
```

Click or touch to wake the dancers (and the sound). Move through them, hold and let go, drag to turn. `w` changes
world, `l` locks the view to the stage, `/` opens the tuning panel.

Read next: `AGENTS.md` (how it fits together, how to run, capture and extend it), `docs/PLAN.md` (where it is going),
`docs/extending/` (adding a matter kind, a world, a controller), `docs/ASSETS.md` (where the data came from).

Code: MIT (`LICENSE`). Built on [weft](https://github.com/ericrius1/weft). Motion capture from the CMU Graphics Lab
Motion Capture Database (mocap.cs.cmu.edu), created with funding from NSF EIA-0196217.
