// The dance roams (report 20-roam): the jogo plays in open 3D by default (&lock for the side view), and walking or
// dancing through a mirror or one of the hub's gates takes the pair on into that world with no cut and no menu, as the
// duel does (report 18-wayfinding). What this adds to the jogo (src/play/index.ts):
//   - the partner comes along: when one seat's dancer crosses, the other seat's (a local one: the partner brain, or a
//     second player on this screen) is brought through just behind (Portals.bring), and the one who crossed is kept
//     from crossing straight back for a moment (Portals.holdBack)
//   - the main view follows: the follow camera brings the eye through the disc behind the pair; an eye that stood past
//     the mirror's plane beside its disc (it would never come through it), or one not through in 1.6 s (the dance pauses until it is), goes over at once
//     under the mirror's light (Portals.arrive, flash), as the duel's does
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
}

/** seconds a crossing may take before the main view goes over under the mirror's light */
const TRANSIT_S = 1.6;
/** frames running the eye must stand on the pair's side of the disc, off it, before the view goes over under the light */
const BESIDE_FRAMES = 6;

export function roam(o: RoamCtx) {
  const { gates, rig, main } = o;
  /** the crossing under way: the disc the pair came out of (in the new world), seconds left */
  let crossing: { at: V3; n: V3; t: number; to: string; beside: number } | null = null;
  /** every crossing (the room's seconds are the jogo's; these are the page's): from, to, how the view went over */
  const log: { at: number; from: string; to: string; how?: 'through' | 'flash' | 'late' }[] = [];
  const t0 = performance.now();

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
    const out = gates.gates.get(e.partner);
    crossing = out ? { at: [...out.at] as V3, n: [...out.n] as V3, t: TRANSIT_S, to: e.to, beside: 0 } : null;
    log.push({ at: +((performance.now() - t0) / 1000).toFixed(2), from: e.from, to: e.to });
  });

  o.frame.tick('camera', (f: FrameCtx) => {
    const c = crossing;
    if (!c) return;
    const X = log[log.length - 1];
    if (main.world === c.to) { if (X && !X.how) X.how = 'through'; crossing = null; return; }
    c.t -= f.dt;
    // the pair's middle (the seats this page has), in the new world
    let px = 0, py = 0, pz = 0, n = 0;
    for (const d of o.seats) {
      if (!d || gates.worldOf(d) !== c.to) continue;
      const J = d.skeleton.world;
      px += J[0]; py += J[1]; pz += J[2]; n++;
    }
    const side = (p: ArrayLike<number>) => (p[0] - c.at[0]) * c.n[0] + (p[1] - c.at[1]) * c.n[1] + (p[2] - c.at[2]) * c.n[2];
    // (on the pair's side for a few frames running: the frame the eye passes through the disc it is on their side too,
    // until the gates' phase carries the camera after this one, and that is a crossing, not a cut)
    const beside = n > 0 && gates.rigWorld === c.to && side(rig.eye) * side([px / n, py / n, pz / n]) > 0;
    c.beside = beside ? c.beside + 1 : 0;
    if ((c.beside >= BESIDE_FRAMES || c.t <= 0) && gates.rigWorld === c.to) {
      gates.arrive();
      gates.flash(c.to);
      if (X && !X.how) X.how = c.t <= 0 ? 'late' : 'flash';
      crossing = null;
    } else if (c.t < -2) crossing = null;
  }, 'jogo: the main view follows a crossing (or goes over under the mirror\'s light)');

  // ---------------------------------------------------------------- saying the way
  gates.names?.offer();
  const hint = lockHint(() => rig.lock(null));
  o.frame.tick('post', () => hint.show(o.started() && rig.mode === 'locked'), 'jogo: the side view says how to roam');

  return { log, stop: () => { off(); hint.remove(); } };
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
