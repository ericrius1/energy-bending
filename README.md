# Energy Bending

A dance for two, in bodies of fire and ice. **Play it: [ericlevin.dev/energybending](https://www.ericlevin.dev/energybending/)**

A two-player 3D dance game on WebGPU. Dancers are skeletons (motion-captured, 38 joints) wearing matter: fire,
water, ice, plasma, gems and steam, GPU particles sprung to the body that answer the music and each other. Water
freezes beside ice and boils beside flame; two dancers who hold close long enough fuse into one body (steam, prism,
storm or aurora). You play capoeira's game, the jogo, with a friend on the same screen, someone far away, or an AI
partner who circles, answers and can teach you the first moves, across four worlds (a geode, a redwood clearing at
dusk, a still pool under the moon, a tide temple) joined by live gates you can walk through. Each world
has its own music, and everything that lands on the beat lands on that track's beat.

```bash
npm install
npm run dev        # http://localhost:5391/energybending/
npm run build      # dist/
npm start          # the room server, serving dist/ too when it's built (http://127.0.0.1:5417/energybending/)
npm run typecheck
npm test
```

Press any key, click or touch to begin; the front offers a game against the partner, two players on one screen, or a
room online. `w` changes world, `l` locks the view to the stage, `f` fullscreen, `/` opens the tuning panel. AGENTS.md
lists every address flag (`?jogo=…`, `?world=…`, `?dress=fire,water`, …).

Read next: `AGENTS.md` (how it fits together, how to run, capture and extend it), `docs/PLAN.md` (how it was made and
where it is going), `docs/reports/` (each stage of building it, with what was measured), `docs/extending/` (adding a
matter kind, a world, a move, a brain, a film), `docs/ASSETS.md` and `docs/music/` (where the data and the music came
from).

Code: MIT (`LICENSE`). Built on [weft](https://github.com/ericrius1/weft). Motion capture from the CMU Graphics Lab
Motion Capture Database (mocap.cs.cmu.edu), created with funding from NSF EIA-0196217. Music made with Suno
(`docs/music/suno-prompts.md`).
