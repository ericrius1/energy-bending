# The camera: keeping out of the world, the lock, the stick

The rig (`src/engine/camera.ts`, `CameraRig`) has three ways to look (free, follow, locked; see the file's opening
note). A film's camera (keyframes, blending into and out of the rig's follow and lock) is `src/engine/filmcam.ts`
(docs/extending/film.md). This guide is for whoever writes a world (what the camera needs from it) or a player's input
(the stick's turn).

## Solids: what the eye keeps out of

A world's big solid things, as rough shapes in its own coordinates (`Solid` in `src/worlds/solids.ts`, re-exported by
camera.ts; the same list answers `World.clear` and keeps the brains' free pair off them):

```ts
type Solid =
  | { kind: 'capsule'; a: V3; b: V3; r: number }                 // a segment and a radius (a sphere when a = b)
  | { kind: 'box'; c: V3; x: V3; y: V3; z: V3; h: V3 };          // middle, three unit axes, half extents
boxOn(foot, [w, h, d], yaw = 0, pitch = 0)                       // a box standing on `foot` (the temple's turn)
```

Each frame the portals give the rig the solids of the world it works in (`rig.solids`, a `Solids` with a bounding
sphere per shape) and its water (`rig.waterY`). **A world says its own with `World.solids: readonly Solid[]`** (static,
built once from the layout it draws from; something that moves a little, a bobbing slab, a swinging lantern, given as
where it can be; a few centimetres fat rather than thin; columns as capsules, blocks and slabs as boxes, nothing
smaller than about 30 cm). Every world but the Pool has them: the temple's stones (`temple/layout.ts solidsOf`), the
redwoods' trunks, limbs, lanterns and stage logs (`redwoods/layout.ts`, `stage.ts`), the geode's blades and big crystal
points (`geode/shelves.ts solidsOfShelves`), the forge's stage columns (`forge/layout.ts solidsOfForge`).
`src/portals/solids.ts` only wraps them. `World.clear(a, b)` answers from the same list (`clearOf`, a 40 cm margin) and
is still asked through the portals' `clearance` (the film camera's boom reads it too).

What the rig does with them (`camera.*` params):

- **Free, follow, the director's shots:** the boom (look point to eye) is swept as a sphere of `clearSoft` (0.5 m)
  where it is and where it will be as it turns (up to 0.8 s ahead at `clearAhead` 0.35). It must be in to what is
  clear by the time it gets there, and comes in no faster than 5 m/s, so it starts early: a dolly, not a jump. Out
  again slowly (1.6/s). If that is ever not enough, a hard stop at `clearHard` (0.22 m) keeps the eye out. A solid the
  look point itself stands inside (a dancer leaning on a column) is passed over. The eye stays 25 cm above the ground
  (`groundAt`) and the water.
- **Locked:** the stage's angle is kept unless a solid crosses the sight lines from the eye to the two seats (hips,
  knees, chest, head). Then, at most twice a second, it tries turns within `lockDodge` (0.4 rad) of the stage's own
  angle and eases (about a second) to the one that sees most, the smallest turn on a tie; when the stage's angle is
  clear again it eases back. `rig.dodge` is the turn now.
- **Paths:** only when the path says `avoid: true` (below).

### The near fade (asked of the worlds and the post chain; not built)

What the rig cannot fix by moving (a column right beside a dancer, a lantern hanging in a locked frame, a blade in a
tight follow), a world should fade. The rig publishes what is needed each frame:

```ts
rig.sight = { eye: V3, at: V3, near: 0.6, blocking: number[] }   // blocking: indices into rig.solids.list
```

The ask: in each world's opaque draws (or once, in the post chain's merge, by depth), dither away a fragment that is
(a) within `near` (0.6 m) of the eye, or (b) inside the capsule from the eye to `at` of radius about 0.8 m and nearer
the eye than `at`. Two `vec4f`s in the shared world light uniform (eye + near, at + radius) are enough. Until then,
`sight.blocking` is empty in every lock frame this report's checks looked at.

## The stick's turn

A free player's stick is camera-relative (`Character.inputYaw`). `rig.stickYaw(p, moveX, moveZ)` gives the turn to
read it in: the camera's yaw when the push began, **kept while the stick is held** (any direction, more than 0.2), so
the camera's own swings (behind a runner, onto a gate, the director's drift) never steer the player; the player's own
look input (`lookBy`) and a gate's carry turn it too. `src/dancer/play.ts` sets `inputYaw` from it each frame.

For scripts: `bend.intent(0, { moveZ: 1 })` walks "into the screen" (away from the camera) and holds that line;
`moveY` is up (a jump, or a crouch below -0.5), not a walk. Add `walk: true` for a walk rather than a run.

## Camera paths (removed)

The cameras agent's `bend.rig.play(path)` / `samplePath` were removed at the third integration (8-integration.md): the
films' timelines drive `src/engine/filmcam.ts`, which lays its pose over the rig's (its `mode: "rig"` and `"lock"`
blend into the rig's follow and lock) and shortens its boom by the rig's `clearance`, which now covers every world's
solids. One keyframed camera, one format: docs/extending/film.md.
