# Adding a controller

A controller is whoever moves a skeleton: motion capture, the webcam, landmarks off the network, a player's intent,
a brain. It poses the 38-joint rig each frame; the dancer commits the pose (velocities, the GPU layout), and the
matter it wears follows.

```ts
export interface Controller {
  readonly kind: string;                                  // a name for stats
  readonly rig: Rig;                                      // the rig it poses (motion.skeletons[0] is the CMU rig)
  update(dt: number, ctx: FrameCtx, out: Skeleton): void; // write out.pos[k] and out.rot[k], world space
}
```

`dt` is dance time (slowed or sped by `danceParams.speed`); `ctx.t` the dance time now, `ctx.beat` the music's clock,
`ctx.dancers` everyone (dancers update in slot order, so dancer 1 can read dancer 0's pose this frame).

## Three ways to pose

1. **Forward kinematics from local rotations** (`forward(out, root, rootRot, local, at)` in skeleton/rig.ts), as
   `MocapController` does with a clip's sample.
2. **Landmarks** (the light description everything speaks): fill a `LandmarkPose` (13 points in the dancer's frame,
   a root on the floor under the hips, a yaw) and let a `LandmarkController` fit the rig:

   ```ts
   const c = new LandmarkController(motion.skeletons[0]);
   c.ground = 0.035;                       // keep the feet on the floor (null: trust the landmarks' heights)
   c.source = (pose, f) => { /* write pose.p (39 floats), pose.root, pose.yaw */ };
   ```

   The order is head, L/R shoulder, elbow, wrist, hip, knee, ankle (`LM` in skeleton/landmarks.ts); x across the
   body with the dancer's left at +x, y up, z forward. `landmarksFromSkeleton(skeleton, pose)` goes the other way
   (`?landmarks` round-trips a mocap dancer through it).
3. **Motion matching** (`skeleton/locomotion`): a `Mover` finds the clip frame that goes where it's asked. Set its
   `goalX`, `goalZ`, `face`, `energy`, `maxSpeed` each frame and call `mover.update(dt, out)`. `WanderController`
   (dancer/wander.ts) is the smallest example; a brain is the same shape with better reasons for its goals.

## Putting it on stage

A `Dancer` is `new Dancer(id, controller, loadout)`. The show's cast is `show.dancers`; a debug flag can replace the
programme's cast with a function (`show.castOverride = (program, show) => Dancer[]`, see dancer/demos.ts), and
`show.stage(show.program)` re-dresses the stage. To change who drives a dancer mid-dance, `dancer.setController(c)`.

Check it with a still: add a flag like `?mine` in main.ts's demo lines (the one place demos are wired), or set the cast
from `bend.show` in a steps file, then `node scripts/shot.mjs shots/mine`.
