# Assets

Where every file in `public/` came from, and on what terms. The code is MIT (see `LICENSE`); these files are not all
ours to relicense, so each one's terms are listed here.

| file | what | source | terms |
|---|---|---|---|
| `public/motion/motion.json`, `motion.bin` | eleven dances (salsa couple, pirouettes, grand jeté, whirl, lambada, arching arms, Indian dance, Charleston, breaking, the Twist, Macarena), packed by `scripts/mocap.mjs` | CMU Graphics Lab Motion Capture Database, BVH conversion by cgspeed; copied from Gem Dancers `public/` | free to use; see the acknowledgement below |
| `public/motion/travel.json`, `travel.bin` | eleven travelling dances (salsa travelling, a dancer's walk, jetés en tournant, small jetés, side steps, run and leap, Lindy Hop, hopscotch, rain, happy, moonwalk), for locomotion | the same, packed by `scripts/mocap.mjs ... travel` | the same |
| `public/specimens/specimens.json`, `specimens.bin` | eleven mineral specimens in three levels of detail | modelled procedurally in Blender by `scripts/specimens.py` (Eric Levin, for Gem Dancers) | ours: MIT with the code |
| `public/worlds/redwoods/bark.jpg` | redwood bark, seamless | **source to be confirmed by Eric** (from Gem Dancers `public/forest/`) | unknown until confirmed |
| `public/worlds/redwoods/bark-h.jpg` | the bark's height map | **source to be confirmed by Eric** | unknown until confirmed |
| `public/worlds/redwoods/ground.jpg` | forest floor (moss, sorrel, needles), seamless | **source to be confirmed by Eric** | unknown until confirmed |

## CMU acknowledgement

The motion capture is from the CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), created with funding from
NSF EIA-0196217. The BVH files are the cgspeed conversion of that database, released without restrictions on use. The
database asks that work using it carry this line: "The data used in this project was obtained from mocap.cs.cmu.edu.
The database was created with funding from NSF EIA-0196217."

Clips used (subject_trial): 60_01, 61_01 (salsa), 05_06, 05_17, 55_01, 55_02, 49_12, 94_01, 93_08, 90_28, 141_12,
143_35, and for travel 60_06, 05_01, 05_16, 05_07, 05_11, 49_04, 93_06, 143_31 and the rest listed in
`scripts/mocap.mjs`.

## Not in `public/`

- The webcam pose model (MediaPipe pose landmarker, Apache 2.0) is fetched from Google's CDN when "you" is turned on;
  it is never copied here.
- The sketches in `sketches/` carry their own assets and notes.
