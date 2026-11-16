// The dance roams (report 20-roam): the jogo plays in open 3D by default (&lock for the side view), and walking or
// dancing through a mirror or one of the hub's gates takes the pair on into that world with no cut and no menu, as the
// duel does (report 18-wayfinding). What this adds to the jogo (src/play/index.ts):
//   - the partner comes along: when one seat's dancer crosses, the other seat's (a local one: the partner brain, or a
//     second player on this screen) is brought through just behind (Portals.bring), and the one who crossed is kept
//     from crossing straight back for a moment (Portals.holdBack)
//   - the main view follows through the glass (report 24-newcomer): from the frame the pair is through, the camera's eye
//     takes the duel's way (src/duel/voyage.ts ThroughCam): round the rim onto the disc's axis behind them if it stood
//     beside it, through the disc on their line, and on round onto the follow camera's view of them in the new world,
//     one curve. Then, while the pair is still near the disc they came out of, the follow camera's view is held in
//     front of that disc with its look level (`settle`): before, the follow camera swung round behind them, met the
//     disc's back and lifted over it, looking straight down at the floor. The cut under the mirror's light
//     (Portals.arrive, flash) is kept for a locked view, or a way that hasn't brought the eye through in 6 s
//   - the way to the other worlds is said: the "mirrors" chip (labels.ts: M names every mirror) when the dance begins,
//     and while the view is locked to the side, a chip saying how to roam (V, Tab, a gamepad's View, the touch pad's
//     lock button; a click or a tap on the chip itself frees the view)
// The room hears every crossing as before (index.ts: a seat's travel moves the jogo's world and its music from the next
// bar line). Online the other seat is the other page's: it is not brought (that page's own player walks through).
import type { FrameBuilder, FrameCtx } from '../engine/frame';
import type { CameraRig } from '../engine/camera';
import type { ViewCtx } from '../engine/views';
import type { Portals, TravelEvent } from '../portals/portals';
import type { Dancer } from '../dancer/dancer';
import { ThroughCam, type Disc } from '../duel/voyage';
import { cameraParams } from '../engine/camera';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';

type V3 = [number, number, number];

export interface RoamCtx {
  gates: Portals;
  rig: CameraRig;
  main: ViewCtx;
  frame: FrameBuilder;
  /** every dancer, in the gates' numbering (show.dancers) */
  all: () => readonly Dancer[];
  /** each seat's dancer */
  seats: readonly (Dancer | null)[];
  /** is seat s this page's own (a local room: both; online: this page's seat alone) */
  local: (seat: number) => boolean;
  /** has the jogo begun */
  started: () => boolean;
  /** seat 1's body as the follow camera reads it (its facing and velocity: the camera leads it a little), or null */
  lead?: () => { yaw: number; v: ArrayLike<number> } | null;
  /** the main view's width over its height */
  aspect?: () => number;
}

/** the longest the way through may take before the view goes over under the mirror's light (s) */
const WAY_MAX = 6;
/** after the way: the follow camera's view held in front of the disc the pair came out of, at most `most` s, its eye at
 *  least `front` m in front of the disc, its look no steeper than `pitch` (rad) */
const SETTLE = { most: 5, front: 1.6, pitch: 0.3 };

const smooth = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };

type Rec = { at: number; t: number; from: string; to: string; how?: 'through' | 'flash' | 'late' | 'stayed' };

export function roam(o: RoamCtx) {
  const { gates, rig, main } = o;
  /** every crossing: from, to, how the main view went over, when (`at`: the page's seconds; `t`: the frames' clock) */
  const log: Rec[] = [];
  const t0 = performance.now();
  let clock = 0;
  /** a crossing whose way is owed (the rig must have been carried with the pair first), the way under way, and the
   *  settle after it */
  let owed: { out: string; side: number; to: string; from: string; rec: Rec; wait: number } | null = null;
  let way: { cam: ThroughCam; to: string; disc: Disc; side: number; rec: Rec } | null = null;
  let settle: { disc: Disc; side: number; t: number } | null = null;
  /** the measures: ways begun, those that went round the disc first, cuts under the light, settles */
  const counts = { ways: 0, round: 0, flashes: 0, settles: 0 };
  const discOf = (g: { id: string; at: ArrayLike<number>; n: ArrayLike<number>; right: ArrayLike<number>; up: ArrayLike<number>; radius: number }): Disc =>
    ({ id: g.id, at: [g.at[0], g.at[1], g.at[2]], n: [g.n[0], g.n[1], g.n[2]], right: [g.right[0], g.right[1], g.right[2]], up: [g.up[0], g.up[1], g.up[2]], r: g.radius });

  const off = gates.on((e: TravelEvent) => {
    if (e.who !== 'dancer' || e.pair) return;
    const all = o.all(), d = all[e.dancer];
    const seat = o.seats.indexOf(d);
    if (seat < 0) return;
    const other = 1 - seat, od = o.seats[other];
    if (od && o.local(other) && gates.worldOf(od) === e.from) {
      gates.bring(all, all.indexOf(od), e.gate, { front: e.front, hold: 0.6 });
      gates.holdBack(d, 0.6);
    }
    const rec: Rec = { at: +((performance.now() - t0) / 1000).toFixed(2), t: +clock.toFixed(2), from: e.from, to: e.to };
    log.push(rec);
    // (the pair on through a second mirror before the view came through the first: that one went over under the light)
    if (way && !way.rec.how) way.rec.how = 'flash';
    if (way || settle) rig.pose = null;
    way = null; settle = null;
    owed = { out: e.partner, side: e.front ? 1 : -1, to: e.to, from: e.from, rec, wait: 2 };
  });

  /** the pair as the rig's world sees it: the follow camera's look (the middle of the two chests, or seat 1's alone once
   *  the other is far: engine/camera.ts updateFollow), the chests, how far apart */
  const pairNow = () => {
    const pts: V3[] = [];
    const k = JOINT.Spine1 * JOINT_FLOATS;
    for (const d of o.seats) {
      if (!d) continue;
      const J = gates.seen(gates.rigWorld, [d]).joints[0];
      if (J) pts.push([J[k], J[k + 1], J[k + 2]]);
    }
    if (!pts.length) return null;
    const a = pts[0], b = pts[1] ?? a, spread = Math.hypot(a[0] - b[0], a[2] - b[2]);
    const alone = pts.length > 1 ? smooth((spread - 5) / 3) : 0;
    const m: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.15, (a[2] + b[2]) / 2];
    const me: V3 = [a[0], a[1] - 0.15, a[2]];
    for (let i = 0; i < 3; i++) m[i] += (me[i] - m[i]) * alone;
    return { mid: m, pts, spread, alone };
  };

  /** the follow camera's own view of the pair in the new world, as it would stand (the same look point and lead, boom,
   *  fit of the partner, pitch), but with its eye kept SETTLE.front m in front of the disc they came out of: where the
   *  boom straight back would stand behind the disc, it swings round beside it instead, on the side the eye is now */
  const followPose = (disc: Disc, side: number) => {
    const P = pairNow();
    if (!P) return null;
    const C = cameraParams, c = o.lead?.() ?? null;
    const lead = c ? Math.min(Math.hypot(c.v[0], c.v[2]), 5) * C.followLead : 0;
    const T: V3 = [P.mid[0] + (c ? Math.sin(c.yaw) * lead : 0), P.mid[1], P.mid[2] + (c ? Math.cos(c.yaw) * lead : 0)];
    const pitch = Math.min(C.followPitch, SETTLE.pitch), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const nx = disc.n[0] * side, nz = disc.n[2] * side;
    const sT = (T[0] - disc.at[0]) * nx + (T[2] - disc.at[2]) * nz;
    // (the side of the pair the eye stands on now, across the disc's axis)
    const ex = rig.eye[0] - T[0], ez = rig.eye[2] - T[2], across = ex * -nz + ez * nx >= 0 ? 1 : -1;
    const boom = (dist: number) => {
      // straight back out of the disc's face (behind the pair as they walk out), turned aside as far as it takes for the
      // eye to stand in front of the disc
      const reach = dist * cp, want = sT - SETTLE.front;
      const turn = want >= reach ? 0 : Math.acos(Math.max(-1, Math.min(1, want / Math.max(1e-3, reach))));
      const c0 = Math.cos(turn), s0 = Math.sin(turn) * across;
      return [-nx * c0 - nz * s0, -nz * c0 + nx * s0] as const;
    };
    let dist = C.followDist + Math.min(P.spread, 5) * 0.45 * (1 - P.alone);
    let [bx, bz] = boom(dist);
    if (P.pts.length > 1 && P.alone < 1) {
      const tx = Math.tan((C.followFov * Math.PI) / 360) * Math.max(0.5, o.aspect?.() ?? 16 / 9);
      for (const w of P.pts) {
        const x = w[0] - T[0], y = w[1] - T[1], z = w[2] - T[2];
        const acr = Math.abs(x * bz - z * bx), toward = (x * bx + z * bz) * cp + y * sp;
        dist = Math.max(dist, Math.min(C.followDist + 4, toward + (acr + 0.5) / (0.8 * tx)));
      }
      [bx, bz] = boom(dist);
    }
    const eye: V3 = [T[0] + bx * cp * dist, T[1] + sp * dist, T[2] + bz * cp * dist];
    return { pose: { eye, look: T }, mid: P.mid, sT, dist };
  };

  o.frame.tick('camera', (f: FrameCtx) => {
    clock += f.dt;
    // a crossing: the way through starts from where the eye is once the rig has been carried with the pair (the main
    // view still drawn from the old world, through the gates)
    if (owed) {
      const O = owed, g = gates.gates.get(O.out);
      O.wait -= f.dt;
      if (main.world === O.to) { if (!O.rec.how) O.rec.how = 'through'; owed = null; }
      else if (gates.rigWorld !== O.to) { if (O.wait <= 0) { if (!O.rec.how) O.rec.how = 'stayed'; owed = null; } }
      else if (g && rig.mode !== 'locked' && main.world === O.from) {
        const disc = discOf(g);
        way = { cam: new ThroughCam(disc, O.side, rig.eye, rig.look), to: O.to, disc, side: O.side, rec: O.rec };
        counts.ways++;
        if (!way.cam.how.aligned) counts.round++;
        owed = null;
      } else {
        gates.arrive(); gates.flash(O.to); counts.flashes++;
        if (!O.rec.how) O.rec.how = 'flash';
        owed = null;
      }
    }
    if (way) {
      const W = way, F = followPose(W.disc, W.side), over = main.world === W.to;
      if (over && !W.rec.how) W.rec.how = 'through';
      if (!F || (!over && (W.cam.done || W.cam.t > WAY_MAX || rig.mode === 'locked'))) {
        // the rare fallback: the way didn't bring the eye through (a lock, or it ran out): a cut under the mirror's light
        if (!over && gates.rigWorld === W.to) {
          gates.arrive(); gates.flash(W.to); counts.flashes++;
          if (!W.rec.how) W.rec.how = W.cam.done ? 'flash' : 'late';
        }
        way = null; rig.pose = null;
      } else {
        const P = W.cam.update(f.dt, F.pose, F.mid);
        rig.pose = { eye: P.eye, look: P.look, fov: cameraParams.followFov };
        if (W.cam.done) { way = null; settle = { disc: W.disc, side: W.side, t: 0 }; counts.settles++; }
      }
    } else if (settle) {
      // after the way: the follow camera's view held in front of the disc until the pair is clear of it (its own boom
      // stands in front of the disc), the player turns the camera, or SETTLE.most
      const S = settle, F = followPose(S.disc, S.side);
      S.t += f.dt;
      const clear = !F || F.sT - SETTLE.front > F.dist * Math.cos(SETTLE.pitch) + 0.3;
      if (!F || clear || S.t > SETTLE.most || rig.lookIdle < 0.05 || rig.mode === 'locked') {
        settle = null; rig.pose = null;
        // (the follow camera goes on from here: its look point eases from this one rather than jumping to its own)
        (rig as unknown as { followInit: boolean }).followInit = true;
      } else rig.pose = { eye: F.pose.eye, look: F.pose.look, fov: cameraParams.followFov };
    }
  }, 'jogo: the main view through the glass after a crossing (the duel\'s way), held in front of the disc after it');

  // ---------------------------------------------------------------- saying the way
  gates.names?.offer();
  const hint = lockHint(() => rig.lock(null));
  o.frame.tick('post', () => hint.show(o.started() && rig.mode === 'locked'), 'jogo: the side view says how to roam');

  return { log, counts, stop: () => { off(); hint.remove(); if (way || settle) rig.pose = null; } };
}

const CSS = `
.jg-roam { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 5; pointer-events: auto; cursor: pointer;
  display: flex; align-items: center; gap: 0.55em; padding: 0.4em 1em 0.42em 0.7em; border-radius: 999px;
  font: 700 13px var(--eb-body, "Nunito Sans", system-ui, sans-serif); letter-spacing: 0.03em; color: var(--eb-parchment, #e6d7b8);
  background: linear-gradient(180deg, rgba(52,40,22,0.66), rgba(18,14,8,0.58)); border: 1px solid rgba(201,164,99,0.75);
  box-shadow: 0 0 0 1px rgba(14,10,4,0.45), inset 0 1px 0 rgba(255,240,205,0.16); opacity: 0; transition: opacity 0.6s; }
.jg-roam.on { opacity: 0.94; }
.jg-roam[hidden] { display: none; }
.jg-roam kbd { font: 800 12px var(--eb-body, system-ui, sans-serif); color: #2b1e0b; padding: 0.05em 0.5em; border-radius: 5px;
  background: linear-gradient(var(--eb-cream, #fbf4e4), #efe2c2); box-shadow: 0 0 0 1px rgba(224,154,58,0.85); }
.jg-roam svg { width: 1.4em; height: 1.4em; color: var(--eb-sun, #ffc861); }
@media (pointer: coarse) { .jg-roam kbd { display: none; } }
`;

/** the side view's chip: how to roam in 3D to the mirrors; a click or a tap on it frees the view */
function lockHint(free: () => void) {
  if (typeof document === 'undefined') return { show: (_: boolean) => {}, remove: () => {} };
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.append(st);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'jg-roam';
  b.hidden = true;
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  b.setAttribute('aria-label', 'roam in 3D to the mirrors');
  b.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M24 6l16 9v18l-16 9-16-9V15z"/><path d="M8 15l16 9 16-9M24 24v18"/></svg>`
    + (touch ? '<span>tap for 3D: walk to the mirrors</span>' : '<kbd>V</kbd><span>3D: walk to the mirrors</span>');
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => { e.stopPropagation(); free(); b.blur(); });
  document.body.append(b);
  let was = false;
  return {
    show(on: boolean) {
      if (on === was) return;
      was = on;
      if (on) { b.hidden = false; requestAnimationFrame(() => b.classList.add('on')); } else { b.classList.remove('on'); setTimeout(() => { if (!was) b.hidden = true; }, 600); }
    },
    remove() { b.remove(); st.remove(); },
  };
}
