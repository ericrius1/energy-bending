// The near fade: what the camera can't fix by moving (a column right beside a dancer, a stub in a locked frame's
// foreground, a trunk in a tight follow, a blade the boom grazes, a beam in the duel's near corner) the worlds dissolve
// instead of letting it fill the frame. One mechanism for every world: each world's solid draws call `sightDrop(p, px)`
// (worlds/light.wgsl) first in their fragment shader and discard, a dither, so the depth contract holds (what is drawn
// is opaque and writes its distance; what is dropped shows what stands behind it). It needs no binding: its numbers
// ride in the worlds' light uniform as the `sight` member, and the main view marks itself with weft's per-view
// `Frame.user.x` (1), so a gate's view and the inset, which read the same uniform in the same run, fade nothing.
//
// Each frame (after the camera, so a film's camera counts too) this reads the eye, the world's solids (World.solids,
// as the rig has them) and the framed dancers as the main view sees them, and asks on the CPU: is a solid within
// `near` of the eye, does a solid cross the sight lines from the eye to a dancer's hips, chest or head, and (in the
// duel, the arena shown: worlds/fade-frame.ts) which pieces stand in the near part of the frame. Each eases a strength
// up quickly and down slowly; while all are 0 the shaders skip the fade with one uniform branch.
// On the GPU a fragment fades (worlds/light.wgsl sightFade) where it is within `near` of the eye, where the ray
// through it passes within a body's radius of a framed dancer and it is well in front of that dancer, or where it is
// inside one of the pieces the frame test hands over (whole, but for a floor's top edges near the pair: a faint line,
// `sightLit`; none on anything that is not a floor, on a piece the pair is nowhere near or on one pale already; the
// arena's rim light on a dissolved piece fades with it unless that line is kept: `holes`, report 18). Nothing
// below a dancer's feet fades across a sight line (the floor it stands on), nor near the eye below the ground under
// it; the frame test never hands over what a body stands on or is about to land on.
import type { Kit } from '@ericrius1/weft';
import type { ViewCtx } from '../engine/views';
import type { Solids } from '../engine/camera';
import { defineParams } from '../engine/params';
import { JOINT, JOINT_FLOATS, MAXJ } from '../skeleton/rig';
import { arenaFor, shownArena } from '../duel/arena';
import { lightSlot, type LightSlot } from './shared';
import { FRAME_SLOTS, FrameFade, frameParams, type FrameBody, type FrameView } from './fade-frame';

import type { Solid } from './solids';
import type { Sight, SightPiece } from './light.wgsl';

type V3 = [number, number, number];
type V4 = [number, number, number, number];

export const fadeParams = defineParams('fade', {
  /** the near fade at all */
  on: true,
  /** fade what is within this of the eye (m; the rig's sight.near) */
  near: 0.6,
  /** fade what stands in front of a framed dancer across the sight line to it */
  between: true,
  /** in the duel, dissolve a piece standing in the near part of the frame (worlds/fade-frame.ts: fadeFrame's params) */
  frame: true,
  /** how bright a dissolved piece's outline glows (× the arena's rim light; 0.35 till report 16, whose lines were
   *  brighter than the pieces had been) */
  outline: 0.2,
  /** how much of a dissolved piece's edges is kept at all (0: it dissolves whole; the measure's off switch) */
  lines: 1,
  /** how far round a dancer's middle the line of sight is kept clear (m, at least) */
  radius: 0.45,
  /** seconds to fade in and to come back */
  easeIn: 0.15,
  easeOut: 0.5,
}, {
  near: { min: 0, max: 2 },
  outline: { min: 0, max: 2 },
  lines: { min: 0, max: 1 },
  radius: { min: 0.2, max: 1.2 },
  easeIn: { min: 0, max: 1 },
  easeOut: { min: 0, max: 2 },
});

/** the joints a sight line is drawn to (generous: this only wakes the shaders' own test, which decides what fades) */
const SIGHT = [JOINT.Hips, JOINT.Spine1, JOINT.Head, JOINT.LeftLeg, JOINT.RightLeg, JOINT.LeftHand, JOINT.RightHand];
/** the outline's light where no arena names one */
const OUTLINE: V3 = [0.8, 0.8, 0.85];

/** the camera as the fade reads it (weft's Camera, after the rig has applied its pose) */
export type FadeCamera = FrameView;

/** whether a piece is a floor the pair may need to see while it is dissolved: a box standing square (one of its axes
 *  upright, so its top is flat), the only kind whose top edges the shaders keep as a line. A tilted blade, a wall's
 *  face, a trunk, a bough (a capsule: the arena's rim light keeps a bough's top, worlds/fade.ts `slots`) keep none */
export function isFloor(s: Solid | null | undefined): boolean {
  if (!s || s.kind !== 'box') return false;
  return Math.max(Math.abs(s.x[1]), Math.abs(s.y[1]), Math.abs(s.z[1])) >= 0.985;
}

/** whether the arena's rim light runs along a piece's top (duel/arena-segments.ts topEdges: a square box, a lying log,
 *  an upright drum): a dissolved one near the pair keeps its rim, the rest fade with it (duel/arena-lines.wgsl) */
function hasTop(s: Solid): boolean {
  if (s.kind === 'box') return isFloor(s);
  const flat = Math.hypot(s.b[0] - s.a[0], s.b[2] - s.a[2]);
  return flat < 1e-3 || Math.abs(s.b[1] - s.a[1]) / flat < 0.12;
}

/** a piece's slot in the uniform (an empty one: strength 0), with how much of its outline to keep (none unless it is a
 *  floor: report 18) */
function pieceSlot(s: Solid | null, k: number, line = 0): SightPiece {
  if (!s) return { a: [0, 0, 0, 0], x: [0, 0, 0, 0], y: [0, 0, 0, 0], h: [0, 0, 0, 0] };
  if (s.kind === 'capsule') return { a: [...s.a, k], x: [...s.b, 1], y: [0, 1, 0, 0], h: [0, 0, 0, s.r] };
  return { a: [...s.c, k], x: [...s.x, 0], y: [...s.y, isFloor(s) ? line : 0], h: [...s.h, 0] };
}

export class NearFade {
  private slot: LightSlot<Sight>;
  private near = 0;
  private bodies = [0, 0];
  /** each framed body's capsule (lo: feet and radius, hi: top and strength) and the near test's numbers */
  private lo: V4[] = [[0, 0, 0, 0], [0, 0, 0, 0]];
  private hi: V4[] = [[0, 0, 0, 0], [0, 0, 0, 0]];
  private k: V4 = [0.6, -1e9, 0, 0];
  private f: V4 = [0, 0, 0, 0];
  private glow: V4 = [0, 0, 0, 0];
  private pieces: SightPiece[] = Array.from({ length: FRAME_SLOTS }, () => pieceSlot(null, 0));
  /** the dissolved pieces for the arena's rim light (duel/arena-layer.ts), FRAME_SLOTS of 16 floats: a.xyz strength;
   *  x.xyz (a capsule's other end) 1 for a capsule; y.xyz how much of its rim to keep (near the pair, and only a top a
   *  body stands on); h.xyz half sizes, w a capsule's radius. A box's axes ride in a, x, y as the shaders' slots */
  readonly holes = new Float32Array(FRAME_SLOTS * 16);
  /** the duel's frame test (worlds/fade-frame.ts) */
  readonly frame = new FrameFade();
  /** each framed body's hips last frame (its velocity, for the frame test's path ahead) */
  private was: (V3 | null)[] = [null, null];
  /** what the last update found (for the stats and the checks): the eye near a solid, which bodies were blocked, the
   *  pieces the frame test dissolves (their strength) and how much of the frame and its corners they cover (summed) */
  readonly seen = { near: false, blocked: [false, false], pieces: [] as number[], cover: 0 };

  constructor(kit: Kit, main: ViewCtx) {
    this.slot = lightSlot(kit, 'sight');
    // weft's per-view Frame.user: the main view is the one `sight` describes (a gate's view and the inset keep 0)
    main.view.user[0] = 1;
    this.upload();
  }

  private upload() {
    this.slot.set({ body: [{ lo: this.lo[0], hi: this.hi[0] }, { lo: this.lo[1], hi: this.hi[1] }], k: this.k, piece: this.pieces, f: this.f, glow: this.glow } as Sight);
  }

  /** how strongly a solid is dissolved by the frame test now (0 … 1): a power drawn as glow (the gems' pillar) dims
   *  with it */
  strengthOf(s: Solid | null | undefined) { return this.frame.strengthOf(s); }

  /** each frame, after the camera: the camera (its eye, axes and lens; a film's included), the world's solids (null:
   *  none) and the framed dancers' joints as the main view sees them (JOINT_FLOATS a joint), and the ground's height
   *  under a point */
  update(dt: number, cam: FadeCamera, solids: Solids | null, dancers: readonly Float32Array[], groundAt: (x: number, z: number) => number) {
    const P = fadeParams, eye = cam.position, E: V3 = [eye[0], eye[1], eye[2]];
    const ease = (v: number, want: number) => {
      const tau = want > v ? P.easeIn : P.easeOut;
      const n = tau <= 0 ? want : v + (want - v) * (1 - Math.exp(-dt / tau));
      return Math.abs(n - want) < 1e-3 ? want : n;
    };
    const on = P.on && !!solids;
    this.seen.near = on && P.near > 0 && solids!.inside(E, P.near + 0.15);
    this.near = ease(this.near, this.seen.near ? 1 : 0);
    let feet = Infinity;
    const framed: FrameBody[] = [];
    for (let k = 0; k < 2; k++) {
      const J = dancers[k], lo4 = this.lo[k], hi4 = this.hi[k];
      let blocked = false;
      if (J) {
        // an upright capsule round the dancer: its lowest and highest joint, its widest reach from the hips
        let lo = Infinity, hi = -Infinity, reach = 0;
        const hx = J[0], hz = J[2], pts: V3[] = [];
        for (let j = 0; j < MAXJ; j++) {
          const o = j * JOINT_FLOATS, y = J[o + 1];
          if (y < lo) lo = y;
          if (y > hi) hi = y;
          reach = Math.max(reach, Math.hypot(J[o] - hx, J[o + 2] - hz));
          if (j % 3 === 0 || y === lo) pts.push([J[o], y, J[o + 2]]);
        }
        feet = Math.min(feet, lo);
        lo4[0] = hx; lo4[1] = lo; lo4[2] = hz; lo4[3] = Math.max(P.radius, Math.min(0.9, reach * 0.8 + 0.1));
        hi4[0] = hx; hi4[1] = Math.max(hi, lo + 0.5); hi4[2] = hz;
        if (on && P.between) for (const j of SIGHT) {
          const o = j * JOINT_FLOATS;
          if (solids!.sweep(E, [J[o], J[o + 1], J[o + 2]], 0.2) < 0.98) { blocked = true; break; }
        }
        // (its velocity from the hips' step; none across a jump of more than a few metres: a reform, a cut)
        const mid: V3 = [J[0], J[1], J[2]], w = this.was[k];
        let vel: V3 = [0, 0, 0];
        if (w && dt > 1e-4) {
          vel = [(mid[0] - w[0]) / dt, (mid[1] - w[1]) / dt, (mid[2] - w[2]) / dt];
          if (Math.hypot(...vel) > 25) vel = [0, 0, 0];
        }
        this.was[k] = mid;
        framed.push({ mid, pts, vel });
      } else { this.was[k] = null; lo4[3] = 0; }
      this.seen.blocked[k] = blocked;
      this.bodies[k] = J ? ease(this.bodies[k], blocked ? 1 : 0) : 0;
      hi4[3] = this.bodies[k];
    }
    // the duel's frame test: the pieces standing in the near part of the frame
    const duel = shownArena();
    this.frame.update(dt, cam, solids, framed, on && P.frame && duel !== null);
    const top = this.frame.top(FRAME_SLOTS);
    for (let i = 0; i < FRAME_SLOTS; i++) {
      const s = top[i]?.solid ?? null, P4 = (this.pieces[i] = pieceSlot(s, top[i]?.k ?? 0, top[i]?.line ?? 0));
      [P4.a, P4.x, P4.y, P4.h].forEach((v, r) => { for (let c = 0; c < 4; c++) this.holes[i * 16 + r * 4 + c] = (v as ArrayLike<number>)[c]; });
      this.holes[i * 16 + 11] = s && hasTop(s) ? top[i].line : 0;
    }
    this.seen.pieces = top.map((p) => Math.round(p.k * 100) / 100);
    this.seen.cover = top.reduce((a, p) => a + p.cover + p.corner, 0);
    const rim = (duel !== null ? arenaFor(duel)?.rim : null) ?? OUTLINE;
    this.f[0] = this.frame.far; this.f[1] = frameParams.lineNear; this.f[2] = Math.max(frameParams.lineFar, frameParams.lineNear + 0.01); this.f[3] = top.length ? 1 : 0;
    this.glow[0] = rim[0] * P.outline; this.glow[1] = rim[1] * P.outline; this.glow[2] = rim[2] * P.outline; this.glow[3] = P.lines;
    const g = groundAt(E[0], E[2]);
    // (the floor under the eye: the rig keeps the eye 25 cm over it, so a "ground" above that is a raised slab the eye
    // stands beside, which is what should fade)
    const floor = Math.min(Number.isFinite(g) && g > -1e4 ? g : Number.isFinite(feet) ? feet : -1e9, E[1] - 0.25);
    const any = this.near > 0 || this.bodies[0] > 0 || this.bodies[1] > 0 || top.length > 0;
    this.k[0] = P.near; this.k[1] = floor + 0.1; this.k[2] = this.near; this.k[3] = any ? 1 : 0;
    this.upload();
  }
}
