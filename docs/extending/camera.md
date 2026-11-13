# The camera: keeping out of the world, the lock, the stick, camera paths

The rig (`src/engine/camera.ts`, `CameraRig`) has three ways to look (free, follow, locked; see the file's opening
note) and, over all of them, an optional **camera path** (`src/engine/shots.ts`, `CameraPath`). This guide is for
whoever writes a world (what the camera needs from it), a film or a cut scene (paths), or a player's input (the
stick's turn).

## Solids: what the eye keeps out of

A world's big solid things, as rough shapes in its own coordinates (`Solid` in camera.ts):

```ts
type Solid =
  | { kind: 'capsule'; a: V3; b: V3; r: number }                 // a segment and a radius (a sphere when a = b)
  | { kind: 'box'; c: V3; x: V3; y: V3; z: V3; h: V3 };          // middle, three unit axes, half extents
boxOn(foot, [w, h, d], yaw = 0, pitch = 0)                       // a box standing on `foot` (the temple's turn)
```

Each frame the portals give the rig the solids of the world it works in (`rig.solids`, a `Solids` with a bounding
sphere per shape) and its water (`rig.waterY`). **A world says its own with an optional `solids(): Solid[]`** (static;
something that moves a little, a bobbing slab, a swinging lantern, given as where it can be; a few centimetres fat
rather than thin; columns as capsules, blocks and slabs as boxes, nothing smaller than about 30 cm). Until a world
does, `src/portals/solids.ts` reads them from what the world already lays out (the temple's stones, the geode's
blades and crystal points, the redwoods' trunks, limbs, lanterns and stage logs, the forge's stage columns); if that
reading fails it warns once and the camera avoids only the gates there. `World.clear(a, b)` (the redwoods' trunks) is
still asked, through the portals' `clearance`.

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

## Camera paths

A path is a shot as keyframes in the rig's own terms. `bend.rig.play(path)` plays it over whatever the rig is doing,
blending in over `blendIn` seconds; `bend.rig.release(seconds?)` blends back out; `bend.rig.path` says
`{ t, w, done, path }` (null when none). Another `play` replaces the path, blending from where the camera is. The
path's clock is the rig's (it steps with `bend.step`, so films are deterministic).

```ts
interface CameraPath {
  keys: PathKey[];
  space?: 'world' | { dancer: number; turn?: boolean } | { pair: true } | { stage: true | StagePlane };
  blendIn?: number;   // s (default 1; 0 cuts)
  blendOut?: number;  // s (default 1), on release
  avoid?: boolean;    // keep the eye out of the solids, above the ground and the water (as the free camera does)
  end?: 'hold' | 'release' | 'loop';   // after the last key (default hold)
  lag?: number;       // s the space's origin lags what it follows (default 0.25; 0 exact)
}
interface PathKey {
  t: number;                           // s from the path's start
  eye?: V3;                            // the eye in the path's space, or
  orbit?: [yaw, pitch, dist];          // the eye about `at` (the rig's convention: yaw 0 puts the eye at +z)
  at?: V3;                             // looked at (default [0, 1, 0])
  fov?: number; roll?: number;         // degrees top to bottom; rad
  focus?: number;                      // the distance in focus (default: to `at`)
  stop?: boolean;                      // arrive and leave at rest (the first and last keys do by default)
}
```

Spaces, resolved every frame: `'world'` (carried with the rig through a gate); `{ dancer: i }` the ground under seat
i's hips (with `turn`, +z ahead of them, +x to their left); `{ pair: true }` the ground under the middle of seats 0
and 1, +x toward seat 1; `{ stage }` a stage plane (+x along its right, +z toward the locked camera's side; `true` is
the plane locked to). A key that leaves a channel out holds its neighbours'. Every channel runs on a cubic through the
keys (Catmull-Rom tangents over the keys' own times); a path whose keys all give `orbit` interpolates the orbit (it
circles, the short way between two keys), otherwise the eye's position. The lens, roll and focus go to weft's camera
and the post chain's focus (`rig.focus`) as they blend.

Example: a slow push and half orbit round the pair, rising, a little roll at the end, avoiding the columns, then back
to the follow camera.

```js
bend.rig.play({
  space: { pair: true }, avoid: true, blendIn: 1.5, end: 'release', blendOut: 2,
  keys: [
    { t: 0, orbit: [0.3, 0.12, 6.5], at: [0, 1.1, 0], fov: 38 },
    { t: 4, orbit: [1.4, 0.25, 4.2], at: [0, 1.2, 0] },
    { t: 8, orbit: [2.6, 0.4, 3.6], at: [0, 1.3, 0], fov: 32, roll: 0.04, focus: 3.4 },
  ],
});
```

`samplePath(path, t)` (shots.ts) gives a path's pose in its own space without a rig, for drawing a path or checking
one. `scripts/check-portals.mjs` checks a path's keys, its hold, its release and that it never jumps.
