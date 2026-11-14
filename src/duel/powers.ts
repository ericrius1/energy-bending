// The duel's powers on the bodies (docs/design/duel.md, phase 2 "Bend"; the rules are shared/powers.ts): what each
// power does to the two Characters and the world, free in 3D or locked to the stage plane. No power hurts, pushes away
// or scatters anyone: each one lifts, carries, catches at range, gives a step in the air or turns a flight.
//
//   flare   a bloom under the feet: a rocket jump along the stick; a partner within FLARE_R rises too (toward the
//           caster's line, so the two meet in the air). Fire's form (plasma): the flare blinks first, and goes higher
//   ribbon  a dash that lays a ribbon of warm light behind it; for RIBBON_LIFE it rises as an updraft anyone crossing
//           it rides (Character.env.updraft, and the rise held up here)
//   whip    a lash WHIP_REACH along the stick (aimed at the other when the stick points near it): reaching the other
//           it reels it in and the two are joined, a catch at range through the contact (contact.ts's Link), the
//           caster's catch (or air catch) for the rules. Water's form (ice): longer, and a lash that meets nothing
//           freezes into a bar at its tip that the caster swings round
//   wave    a roll along the ground that carries whoever stands in it (free: moved with it; locked: env.carryX), and a
//           jump from its crest goes higher and further
//   step    a block of ice set in the air ahead, under the caster's feet, or under a falling partner the stick points
//           at: a temporary solid (World.solids: stood on, kicked off), STEP_LIFE. Ice's form (glacier): a stair
//   slide   an ice path along the ground: slick (env.slick) and fast along it
//   blink   a short jump through space along the stick; through the other it swaps the two
//   arc     a lightning tether to the other within ARC_R: both pulled to meet in the air, joined when they do (the
//           caster's air catch). Plasma's form (storm): further and faster
//   pillar  a crystal column rising under a point (the other the stick points at, a point ahead, or under the caster):
//           whoever stands on it rides it up and is launched. Gems' form (heart of stone): pillars in a row
//   prism   a facet in the air (on a flying partner's path when the stick points at it): a body flying into it is turned
//           toward the other, to be caught
// and the reactions (shared/powers.ts reactionOf): a flare or a ribbon in a wave is a steam geyser (a tall updraft
// both ride); fire on an ice step melts it to a slick puddle; a whip's lash on an ice step freezes into a bar the
// caster swings round. A power earns style only through the contact it makes (a whip's or an arc's catch, as the
// contact's own catch would); the rest the dance does (a launch into a catch).
//
// Launches are held up against the duel's jump cut (a rising body that isn't holding jump falls at 3.2 × gravity: a
// rocket jump fired from a power button would die in a metre): until its apex a launched body falls at plain gravity.
// Pure (no DOM, no GPU): the page (index.ts) and the Node harness (sim.ts) run it after the match's step each frame.
import { Character } from '../dancer/character';
import { solidContact } from '../dancer/solid-contact';
import { planeNormal, type Ledge, type StagePlane } from '../engine/camera';
import { box, type Solid } from '../worlds/solids';
import { crossing, drumSolid, groundUnder } from './arena';
import { CONTACT, type ContactInput, type Link } from './contact';
import type { DuelMatch } from './match';
import { duelLink, duelFlingLanded, frozen, type DuelEvent } from '../../shared/duel.ts';
import {
  newPowers, powersStep, powersCast, powersForm, powersRefund, powersReact, powersHud, inForm, reactionOf,
  type Matter, type PowerEvent, type PowerId, type PowersState, type ReactionKind,
} from '../../shared/powers.ts';

type V3 = [number, number, number];
type V2 = [number, number];

export const BEND = {
  /** flare: the caster's rise and its run along the stick (m/s), the reach to a partner it lifts (m) and how fast */
  FLARE_UP: 16, FLARE_AIM: 5.5, FLARE_R: 2.4, FLARE_LIFT: 13.5, FLARE_BLINK: 2.2,
  /** ribbon: how long it lasts (s), how long it is laid for, how wide (m), how fast it lifts (m/s), how high */
  RIBBON_LIFE: 2.3, RIBBON_LAY: 0.4, RIBBON_R: 1.0, RIBBON_UP: 8, RIBBON_H: 3.2,
  /** whip: its reach (form's), how fast it lashes out (m/s), how near it must pass, the reel's speed and longest */
  WHIP_REACH: 6.5, WHIP_BIG: 9.5, WHIP_SPEED: 45, WHIP_HIT: 0.85, REEL: 15, REEL_MAX: 0.75,
  /** wave: speed (m/s), life (s), its length along, width across and height (m), the crest's extra jump (m/s) */
  WAVE_SPEED: 6.5, WAVE_LIFE: 1.7, WAVE_LEN: 1.9, WAVE_W: 2.3, WAVE_H: 1.3, CREST: 6.5,
  /** step: half its size (m), its life (s), how far ahead and how high over the ground when set ahead */
  STEP_HALF: [0.55, 0.28, 0.55] as V3, STEP_LIFE: 4, STEP_AHEAD: 1.5, STEP_UP: 1.05,
  /** slide: its length and width (m), life (s), the push along it (m/s²) and its top speed (m/s) */
  SLIDE_LEN: 7, SLIDE_W: 1.4, SLIDE_LIFE: 5, SLIDE_ACCEL: 18, SLIDE_MAX: 11,
  /** blink: how far (m; the form's) */
  BLINK: 2.8, BLINK_BIG: 4,
  /** arc: its reach (m; the form's), how long the pull lasts (s; the form's), how far above the middle they meet,
   *  how near counts as met */
  ARC_R: 8, ARC_BIG: 12, ARC_T: 0.5, ARC_T_BIG: 0.38, ARC_UP: 1.8, ARC_MEET: 1.25,
  /** pillar: height (m), radius, growth (s), the launch (m/s), life (s), how far ahead */
  PILLAR_H: 1.7, PILLAR_R: 0.5, PILLAR_GROW: 0.22, PILLAR_LAUNCH: 15, PILLAR_LIFE: 4, PILLAR_AHEAD: 2.4,
  /** prism: its radius (m), life (s), how many bodies it turns, the speed it sends them at (m/s) */
  PRISM_R: 1.0, PRISM_LIFE: 5, PRISM_USES: 3, PRISM_SPEED: 9.5,
  /** the steam geyser: radius, height (m), its lift (m/s), life (s) */
  GEYSER_R: 1.5, GEYSER_H: 6.5, GEYSER_UP: 11.5, GEYSER_LIFE: 3.5,
  /** the melt's puddle: radius (m), life (s) */
  PUDDLE_R: 1.5, PUDDLE_LIFE: 4,
  /** the frozen bar: how long the swing lasts at most (s), its gravity (m/s²), the bar's life (s) */
  BAR_T: 1.1, BAR_G: 26, BAR_LIFE: 2.5,
  /** the form's powers are this much bigger */
  BIG: 1.2,
  /** a power's catch is held this long (s) without the grab (then it is the holder's to keep, or flung) */
  GRIP: 0.5,
  /** the stick within this angle (rad) of the other aims at it */
  CONE: 0.6,
};

/** what a seat's thumbs say to the powers this frame: the two powers and the form (edges), the stick (world x, z) */
export interface PowerInput { p1: boolean; p2: boolean; form: boolean; stick: V2 }
export const noPower = (): PowerInput => ({ p1: false, p2: false, form: false, stick: [0, 0] });

export type LiveKind = PowerId | 'geyser' | 'puddle' | 'bar';
/** a power's effect while it lasts (what power-fx.ts draws) */
export interface Live {
  id: number; kind: LiveKind; seat: number;
  /** the powers' clock (s) when it began, how long it lasts (s), from the form */
  born: number; life: number; big: boolean;
  /** where it began, and its way (horizontal unit) */
  at: V3; dir: V2;
  /** ribbon, slide: the path; whip: the lash's tip, what it caught; step, pillar: its solid and top; prism: its face */
  pts?: V3[];
  tip?: V3; hand?: V3; target?: number; reel?: number;
  solid?: Solid | null; top?: number; r?: number; h?: number; delay?: number; riders?: Set<number>; launched?: boolean;
  n?: V3; uses?: number;
  /** bar: its pivot, the swing (radius, angle, rate), the swing's horizontal way, whether the caster has let go */
  R?: number; th?: number; om?: number; free?: boolean;
  /** tether: the meeting point */
  meet?: V3;
  /** done (power-fx fades it out), and the reactions it has made (each pops once) */
  done?: boolean; reacted?: boolean; melted?: boolean;
}

/** a moment the effects show and sound (power-fx.ts) */
export type PowerFx =
  | { k: 'cast'; seat: number; power: PowerId; at: V3; dir: V2; big: boolean; id: number }
  | { k: 'form'; seat: number; on: boolean; at: V3 }
  | { k: 'react'; kind: ReactionKind; at: V3; seats: number[] }
  | { k: 'catch'; seat: number; other: number; at: V3; power: PowerId }
  | { k: 'launch'; seat: number; at: V3; power: LiveKind }
  | { k: 'blink'; seat: number; from: V3; to: V3; swap: boolean }
  | { k: 'redirect'; seat: number; at: V3 }
  | { k: 'fizzle'; seat: number; power: PowerId; at: V3 };

export interface PowersOptions {
  /** each seat's matter (its dress) */
  matter: [Matter, Matter];
  /** the list the world's solids are read from while the duel is on (World.solids): the powers' temporary solids are
   *  added to it and taken out of it in place. Without one they are kept in `solids` only */
  sink?: Solid[];
  /** the world's floor (without its solids), and the space's kill floor */
  groundAt?: (x: number, z: number) => number;
  yKill?: number;
}

const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
/** the nearest distance from p to the segment a-b, and where along it (0 … 1) */
function segDist(p: V3, a: V3, b: V3): [number, number] {
  const d = sub(b, a), L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const u = L2 > 1e-9 ? clamp(((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / L2, 0, 1) : 0;
  return [Math.hypot(p[0] - a[0] - d[0] * u, p[1] - a[1] - d[1] * u, p[2] - a[2] - d[2] * u), u];
}
/** the same, across the ground only (x, z) */
function segDist2(p: ArrayLike<number>, a: V3, b: V3): [number, number] {
  const dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz;
  const u = L2 > 1e-9 ? clamp(((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / L2, 0, 1) : 0;
  return [Math.hypot(p[0] - a[0] - dx * u, p[2] - a[2] - dz * u), u];
}

export class DuelPowers {
  readonly rules: PowersState;
  /** the effects while they last (done ones linger LINGER s for the drawing) */
  readonly live: Live[] = [];
  /** the powers' temporary solids (ice steps, pillars, the frozen bar), and a count that moves when they change */
  readonly solids: Solid[] = [];
  version = 0;
  /** this frame's: what to show, the rules' power events, and the rules' events the powers' contact made */
  fx: PowerFx[] = [];
  events: PowerEvent[] = [];
  duelEvents: DuelEvent[] = [];
  /** every power event so far with its duel time (ms), trimmed */
  readonly history: { t: number; e: PowerEvent }[] = [];
  /** what the bodies felt this duel (the tests and the harness read it): launches, catches made, rides, carries */
  readonly felt = { launches: 0, catches: 0, rideS: 0, carriedS: 0, redirects: 0, swaps: 0, bars: 0, standS: 0, slideS: 0, reels: 0 };
  private t = 0;
  private now = 0;
  private beatOn = false;
  private nextId = 1;
  /** launched bodies held against the jump cut (their rise), the ride an updraft gives (m/s), the grip after a power's
   *  catch (until, s), who is carried by a power (a reel, a tether, a bar) */
  private boost: ({ vy: number } | null)[] = [null, null];
  private ride: (number | null)[] = [null, null];
  private grip = [-1, -1];
  private carried: (Live | null)[] = [null, null];
  private turned = [0, 0];
  private crest = [new Set<number>(), new Set<number>()];

  constructor(readonly chars: readonly [Character, Character], readonly match: DuelMatch, readonly o: PowersOptions) {
    this.rules = newPowers(o.matter[0], o.matter[1]);
    // the locked plane's own ledges: each temporary solid's top where it crosses the plane (one-way, as a body expects
    // of a thing it jumps up onto)
    for (const c of chars) {
      const prev = c.extraLedges;
      c.extraLedges = () => { const p = c.plane, a = prev ? prev() : []; return p && this.solids.length ? [...a, ...this.ledgesIn(p)] : a; };
    }
  }

  /** the solids' tops as ledges of a stage plane (its own coordinates) */
  ledgesIn(plane: StagePlane): Ledge[] {
    const out: Ledge[] = [];
    this.solids.forEach((s, i) => {
      const x = crossing(plane, s);
      if (x && x.s1 - x.s0 > 0.2) out.push({ id: `power.${i}`, x0: x.s0, x1: x.s1, y: x.y1 - plane.origin[1] });
    });
    return out;
  }

  /** the powers' own clock (s): each effect's `born` is on it */
  get clock() { return this.t; }
  /** a seat's powers as the HUD shows them (flow, the form left, each power's readiness) */
  hud(k: number) { return powersHud(this.rules, k, this.now, this.joined(k)); }
  /** in the power form now */
  inForm(k: number) { return inForm(this.rules, k, this.now); }
  /** what a virtual player knows of the powers */
  sight() { return [0, 1].map((k) => { const h = this.hud(k); return { flow: h.flow, form: h.form, ids: h.powers.map((p) => p.id) as [PowerId, PowerId], ready: h.powers.map((p) => p.ready) as [boolean, boolean], matter: this.rules.seats[k].matter }; }); }

  /** what a virtual player sees of the effects standing now (a wave to set alight, a step to lash or melt) */
  liveSight() {
    return this.live.filter((L) => !L.done && (L.kind === 'wave' || L.kind === 'step' || L.kind === 'geyser' || L.kind === 'ribbon' || L.kind === 'pillar'))
      .map((L) => ({ kind: L.kind as string, seat: L.seat, at: (L.kind === 'wave' ? L.tip! : L.kind === 'step' || L.kind === 'pillar' ? [L.at[0], L.top!, L.at[2]] : L.at) as [number, number, number] }));
  }
  /** a power's catch is held by the caster a moment without the grab (the contact reads this frame's grab from here) */
  gripInputs(ins: ContactInput[]) {
    for (let k = 0; k < 2; k++) if (this.t < this.grip[k] && this.match.contact.holding(k) && ins[k]) ins[k].grab = true;
  }

  private joined(k: number) { const C = this.match.contact; return C.holding(k) || C.held(k) || !!this.carried[k]; }
  private ground(x: number, z: number, y: number, up = 0.45) {
    const S = this.chars[0].terrain.solids ?? [];
    return groundUnder(S, x, z, y, this.o.groundAt ? this.o.groundAt(x, z) : this.chars[0].terrain.groundAt(x, z), up);
  }
  private chest(k: number): V3 { const c = this.chars[k]; return [c.root[0], c.root[1] + 1.1, c.root[2]]; }
  /** a direction kept in a locked body's plane */
  private flat(c: Character, v: V3): V3 {
    if (!c.plane) return v;
    const n = planeNormal(c.plane), d = v[0] * n[0] + v[2] * n[2];
    return [v[0] - n[0] * d, v[1], v[2] - n[2] * d];
  }
  private setV(c: Character, v: V3) {
    const f = this.flat(c, v);
    c.v = [f[0], f[1], f[2]];
    if (f[1] > 0.5 && c.grounded) { c.grounded = false; c.support = null; }
  }
  /** a launch: the body rises at vy, held against the jump cut until its apex */
  private launch(k: number, v: V3, why: LiveKind) {
    const c = this.chars[k];
    this.setV(c, v);
    c.grounded = false; c.support = null;
    this.boost[k] = { vy: c.v[1] };
    this.felt.launches++;
    this.fx.push({ k: 'launch', seat: k, at: [c.root[0], c.root[1], c.root[2]], power: why });
  }
  /** the stick's way (horizontal unit; none: the facing), kept along a locked plane */
  private aim(k: number, stick: V2): { dir: V2; aimed: boolean } {
    const c = this.chars[k], l = Math.hypot(stick[0], stick[1]);
    let dir: V2 = l > 0.25 ? [stick[0] / l, stick[1] / l] : c.plane ? [c.plane.right[0] * c.dir, c.plane.right[2] * c.dir] : [Math.sin(c.yaw), Math.cos(c.yaw)];
    if (c.plane) { const R = c.plane.right, s = dir[0] * R[0] + dir[1] * R[2]; const sg = Math.abs(s) > 0.05 ? Math.sign(s) : c.dir || 1; dir = [R[0] * sg, R[2] * sg]; }
    return { dir, aimed: l > 0.25 };
  }
  /** whether the aim points at the other (within CONE, nearer than `reach`): the other's distance, or -1 */
  private atOther(k: number, dir: V2, reach: number, aimed: boolean) {
    const a = this.chars[k].root, b = this.chars[1 - k].root, dx = b[0] - a[0], dz = b[2] - a[2], d = Math.hypot(dx, dz);
    if (this.chars[1 - k].reforming) return -1;
    if (Math.hypot(d, b[1] - a[1]) > reach) return -1;
    if (d < 0.4) return d;
    const cos = (dx * dir[0] + dz * dir[1]) / d;
    return cos > Math.cos(aimed ? BEND.CONE : BEND.CONE * 1.5) ? d : -1;
  }
  private add(L: Omit<Live, 'id' | 'born'>): Live {
    const x: Live = { ...L, id: this.nextId++, born: this.t };
    this.live.push(x);
    return x;
  }
  private putSolid(s: Solid) { this.solids.push(s); this.o.sink?.push(s); this.version++; }
  private dropSolid(s: Solid | null | undefined) {
    if (!s) return;
    const i = this.solids.indexOf(s); if (i >= 0) this.solids.splice(i, 1);
    const j = this.o.sink ? this.o.sink.indexOf(s) : -1; if (j >= 0) this.o.sink!.splice(j, 1);
    this.version++;
  }
  private swapSolid(L: Live, s: Solid) {
    if (L.solid) {
      const i = this.solids.indexOf(L.solid); if (i >= 0) this.solids[i] = s;
      const j = this.o.sink ? this.o.sink.indexOf(L.solid) : -1; if (j >= 0) this.o.sink![j] = s;
    } else this.putSolid(s);
    L.solid = s; this.version++;
  }
  private end(L: Live) {
    if (L.done) return;
    L.done = true; L.life = Math.min(L.life, this.t - L.born + 0.35);
    this.dropSolid(L.solid); L.solid = null;
    for (let k = 0; k < 2; k++) if (this.carried[k] === L) this.carried[k] = null;
  }
  /** everything gone (a new set) */
  clear() {
    for (const L of this.live) { this.dropSolid(L.solid); L.solid = null; }
    this.live.length = 0;
    this.carried = [null, null]; this.boost = [null, null]; this.ride = [null, null]; this.grip = [-1, -1];
    for (const c of this.chars) { c.env.updraft = 0; c.env.slick = 0; c.env.carryX = 0; }
  }

  /** the two joined by a power (the caster holds): the contact's link, as its own catch makes one, and the rules'
   *  catch for the caster (an air catch when the other is off the ground) */
  private join(holder: number, at: V3, why: PowerId): boolean {
    const C = this.match.contact, held = 1 - holder;
    if (C.link || this.match.state.phase !== 'play') return false;
    const H = this.chars[holder], F = this.chars[held];
    const centre: V3 = [F.root[0], F.root[1] + 1.0, F.root[2]];
    const p0: V3 = [H.root[0], H.root[1] + 1.3, H.root[2]], d = sub(centre, p0), dl = len(d) || 1;
    const pivot: V3 = [p0[0] + (d[0] / dl) * 0.3, p0[1] + (d[1] / dl) * 0.3, p0[2] + (d[2] / dl) * 0.3];
    const rest = clamp(len(sub(centre, pivot)), CONTACT.REST_MIN, CONTACT.REST_MAX);
    // (the contact's clock: a link's age is read against it)
    const since = (C as unknown as { t: number }).t;
    const link: Link = { holder, held, part: 'hand', rest, since, arc: 0, swings: 0, beatPump: false, at, flying: !F.grounded, c: centre, v: [F.v[0], F.v[1], F.v[2]], sense: 1 };
    C.link = link;
    const aerial = !F.grounded;
    if (C.flown && C.flown.flyer === held) { this.duelEvents.push(...duelFlingLanded(this.match.state, C.flown.flinger)); C.flown = null; }
    this.duelEvents.push(...duelLink(this.match.state, holder, aerial ? 'aerial' : 'catch', this.beatOn, this.now));
    this.grip[holder] = this.t + BEND.GRIP;
    this.boost[held] = null; this.boost[holder] = null;
    this.felt.catches++;
    this.fx.push({ k: 'catch', seat: holder, other: held, at, power: why });
    return true;
  }

  /** each frame, after the match's step: the rules (flow from this frame's links, the form), the casts, the effects */
  step(now: number, dtMs: number, inputs: readonly PowerInput[], duelEvents: readonly DuelEvent[], beatOn = false) {
    const dt = dtMs / 1000;
    this.now = now; this.t += dt; this.beatOn = beatOn;
    this.fx = []; this.duelEvents = [];
    // (flow is for dancing: a body carried, held by the other or by a power, gets none for the links the carrying
    // makes; the held body's own lift and counter are its own)
    const own = duelEvents.filter((e) => e.k !== 'link' || e.kind === 'lift' || e.kind === 'counter' || !(this.match.contact.held(e.seat) || this.carried[e.seat]));
    this.events = powersStep(this.rules, now, own);
    const d = this.match.state;
    for (const e of duelEvents) {
      if (e.k === 'set') this.clear();
      else if (e.k === 'fall') this.release(e.seat);
    }
    for (const e of this.events) if (e.k === 'form' && !e.on) this.fx.push({ k: 'form', seat: e.seat, on: false, at: this.chest(e.seat) });
    // ---- casts
    if (d.phase === 'play') {
      for (let k = 0; k < 2; k++) {
        const I = inputs[k];
        if (!I || frozen(d, k) || this.chars[k].reforming) continue;
        if (I.form) { const e = powersForm(this.rules, k, now); if (e) { this.events.push(e); this.fx.push({ k: 'form', seat: k, on: true, at: this.chest(k) }); } }
        if (I.p1) this.cast(k, 0, I.stick);
        else if (I.p2) this.cast(k, 1, I.stick);
      }
    }
    // ---- the effects
    const lift: number[] = [0, 0], slick = [0, 0], carry = [0, 0];
    for (const L of this.live) if (!L.done) this.tick(L, dt, lift, slick, carry);
    for (let i = this.live.length - 1; i >= 0; i--) {
      const L = this.live[i];
      if (this.t - L.born >= L.life) { this.end(L); this.live.splice(i, 1); }
    }
    // ---- the bodies: updrafts ridden, launches held up, the floor's slick and carry for the next step
    for (let k = 0; k < 2; k++) {
      const c = this.chars[k];
      if (c.reforming || this.match.contact.held(k) || this.carried[k]) { this.ride[k] = null; this.boost[k] = null; }
      else if (lift[k] > 0) {
        // (an updraft: the rise eases up to its speed and holds there; gravity can't take it back)
        const r = this.ride[k] ?? Math.min(c.v[1], 0);
        this.ride[k] = r + (lift[k] - r) * (1 - Math.exp(-12 * dt));
        if (c.v[1] < this.ride[k]!) { c.v = [c.v[0], this.ride[k]!, c.v[2]]; if (c.grounded && c.v[1] > 0.5) { c.grounded = false; c.support = null; } }
        this.felt.rideS += dt;
        this.boost[k] = { vy: c.v[1] };
      } else this.ride[k] = null;
      const B = this.boost[k];
      if (B && lift[k] <= 0) {
        if (c.grounded || c.onWall || this.match.contact.link) this.boost[k] = null;
        else {
          const want = B.vy - c.phys.gravity * dt;
          // (and the height the cut took this frame given back)
          if (c.v[1] < want && c.v[1] > want - 4.5) { c.root = [c.root[0], c.root[1] + (want - c.v[1]) * dt * 0.5, c.root[2]]; c.v = [c.v[0], want, c.v[2]]; }
          B.vy = c.v[1];
          if (B.vy <= 0) this.boost[k] = null;
        }
      }
      c.env.updraft = lift[k] > 0 ? 1 : 0;
      c.env.slick = slick[k];
      c.env.carryX = carry[k];
      // (carried by a power, a reel, a tether, a bar: held, as the contact holds a body: no wall runs, no links of its own)
      if (this.carried[k]) c.env.held = true;
    }
    for (const e of this.events) this.history.push({ t: Math.round(now), e });
    if (this.history.length > 400) this.history.splice(0, this.history.length - 300);
  }

  /** a body re-forming: whatever a power was doing with it lets go */
  private release(k: number) {
    for (const L of this.live) if (!L.done && (this.carried[k] === L || (L.target === k && L.kind === 'whip') || (L.kind === 'arc' && (L.seat === k || L.target === k)))) this.end(L);
    this.carried[k] = null; this.boost[k] = null; this.ride[k] = null;
  }

  // ---------------------------------------------------------------- casting
  private cast(k: number, slot: 0 | 1, stick: V2) {
    const ev = powersCast(this.rules, k, slot, this.now, this.joined(k));
    if (!ev) return;
    const { dir, aimed } = this.aim(k, stick);
    const L = this.spawn(k, ev.power, ev.big, dir, aimed);
    if (!L) {
      powersRefund(this.rules, k, slot, ev.free);
      this.fx.push({ k: 'fizzle', seat: k, power: ev.power, at: this.chest(k) });
      return;
    }
    this.events.push(ev);
    this.fx.push({ k: 'cast', seat: k, power: ev.power, at: L.at, dir, big: ev.big, id: L.id });
  }

  /** a power's effect begun (null: it had nothing to act on, and is given back) */
  private spawn(k: number, power: PowerId, big: boolean, dir: V2, aimed: boolean): Live | null {
    const c = this.chars[k], o = 1 - k, O = this.chars[o], B = big ? BEND.BIG : 1, r = c.root;
    const foot: V3 = [r[0], r[1], r[2]];
    switch (power) {
      case 'flare': {
        // (fire's form: the flare blinks first, along the stick)
        if (big) this.blinkBy(k, dir, BEND.FLARE_BLINK);
        const at: V3 = [c.root[0], c.root[1], c.root[2]];
        const s = aimed ? BEND.FLARE_AIM : 1.2;
        this.launch(k, [c.v[0] * 0.4 + dir[0] * s, BEND.FLARE_UP * B, c.v[2] * 0.4 + dir[1] * s], 'flare');
        // a partner close by rises too, toward the caster's line (the two meet in the air)
        const dx = O.root[0] - at[0], dz = O.root[2] - at[2], dy = O.root[1] - at[1];
        if (!O.reforming && Math.hypot(dx, dz) < BEND.FLARE_R * B && dy > -1 && dy < 2) {
          const tx = at[0] + dir[0] * s * 0.35 - O.root[0], tz = at[2] + dir[1] * s * 0.35 - O.root[2], tl = Math.hypot(tx, tz);
          const k2 = tl > 0.05 ? Math.min(4, tl * 2.5) / tl : 0;
          this.launch(o, [tx * k2, BEND.FLARE_LIFT * B, tz * k2], 'flare');
        }
        const L = this.add({ kind: 'flare', seat: k, life: 1.0, big, at, dir });
        this.reactAt(L, at);
        return L;
      }
      case 'ribbon': {
        const ch = this.chest(k);
        if (c.phys.dash) {
          // (a dash, as the body's own but given here: it leaves the ribbon behind)
          c.dashV = this.flat(c, [dir[0] * c.phys.dashSpeed, 0, dir[1] * c.phys.dashSpeed]);
          c.dashT = c.phys.dashTime * 1.2; c.dashAge = 0;
          if (c.grounded) c.root = [c.root[0], c.root[1] + 0.02, c.root[2]];
        } else this.setV(c, [dir[0] * 9, Math.max(c.v[1], 2), dir[1] * 9]);
        return this.add({ kind: 'ribbon', seat: k, life: BEND.RIBBON_LIFE * (big ? 1.3 : 1), big, at: ch, dir, pts: [ch] });
      }
      case 'whip': {
        // aimed at the other when the stick points near it (its chest), else at an ice step it points near (its top),
        // else level along the stick
        const reach = big ? BEND.WHIP_BIG : BEND.WHIP_REACH;
        const hand: V3 = [r[0] + dir[0] * 0.3, r[1] + 1.35, r[2] + dir[1] * 0.3];
        let aim3: V3 = [dir[0], 0.02, dir[1]];
        const at = (p: V3) => { const t = sub(p, hand), tl = len(t) || 1; aim3 = [t[0] / tl, t[1] / tl, t[2] / tl]; };
        if (this.atOther(k, dir, reach, aimed) >= 0) at(this.chest(o));
        else {
          let best = reach;
          for (const W of this.live) {
            if (W.kind !== 'step' || !W.solid || W.done) continue;
            const p: V3 = [W.at[0], W.top! - 0.1, W.at[2]], t = sub(p, hand), d = len(t), hd = Math.hypot(t[0], t[2]);
            if (d < best && hd > 0.3 && (t[0] * dir[0] + t[2] * dir[1]) / hd > Math.cos(BEND.CONE)) { best = d; at(p); }
          }
        }
        return this.add({ kind: 'whip', seat: k, life: 1.2, big, at: hand, dir, hand, tip: [hand[0], hand[1], hand[2]], n: aim3, h: reach, target: -1 });
      }
      case 'wave': {
        const y = this.ground(r[0], r[2], r[1] + 0.3);
        return this.add({ kind: 'wave', seat: k, life: BEND.WAVE_LIFE * (big ? 1.3 : 1), big, at: [r[0] - dir[0] * 0.4, y, r[2] - dir[1] * 0.4], dir, tip: [r[0] - dir[0] * 0.4, y, r[2] - dir[1] * 0.4] });
      }
      case 'step': {
        // under a falling (or flying) partner the stick points at; under the caster's own feet in the air; else ahead
        const H = BEND.STEP_HALF, n = big ? 3 : 1;
        let x: number, z: number, top: number;
        const od = this.atOther(k, dir, 5, aimed);
        if (aimed && od >= 0 && !O.grounded && !this.joined(o)) {
          x = O.root[0] + O.v[0] * 0.12; z = O.root[2] + O.v[2] * 0.12; top = O.root[1] + Math.min(0, O.v[1]) * 0.1 - 0.05;
        } else if (!c.grounded && !aimed) {
          x = r[0] + c.v[0] * 0.06; z = r[2] + c.v[2] * 0.06; top = r[1] + Math.min(0, c.v[1]) * 0.06 - 0.04;
        } else {
          x = r[0] + dir[0] * BEND.STEP_AHEAD; z = r[2] + dir[1] * BEND.STEP_AHEAD;
          top = c.grounded ? this.ground(x, z, r[1] + 0.4) + BEND.STEP_UP : r[1] - 0.05;
        }
        top = Math.max(top, this.ground(x, z, top) + 0.35);
        let first: Live | null = null;
        for (let i = 0; i < n; i++) {
          const yaw = Math.atan2(dir[0], dir[1]);
          const s = box([x + dir[0] * i * 1.05, top + i * 0.7 - H[1], z + dir[1] * i * 1.05], H, yaw);
          const L = this.add({ kind: 'step', seat: k, life: BEND.STEP_LIFE * (big ? 1.25 : 1), big, at: [x + dir[0] * i * 1.05, top + i * 0.7, z + dir[1] * i * 1.05], dir, top: top + i * 0.7, solid: null, delay: i * 0.08 });
          this.swapSolid(L, s);
          first ??= L;
        }
        return first;
      }
      case 'slide': {
        const pts: V3[] = [[r[0], this.ground(r[0], r[2], r[1] + 0.3), r[2]]];
        for (let s = 0.5; s <= BEND.SLIDE_LEN * (big ? 1.3 : 1) + 1e-6; s += 0.5) {
          const x = r[0] + dir[0] * s, z = r[2] + dir[1] * s, prev = pts[pts.length - 1], y = this.ground(x, z, prev[1] + 0.45);
          if (y < (this.o.yKill ?? -1e9) + 0.5 || Math.abs(y - prev[1]) > 0.45) break;
          pts.push([x, y, z]);
        }
        if (pts.length < 3) return null;
        return this.add({ kind: 'slide', seat: k, life: BEND.SLIDE_LIFE * (big ? 1.25 : 1), big, at: pts[0], dir, pts });
      }
      case 'blink': {
        const from: V3 = [r[0], r[1], r[2]];
        const swap = this.blinkBy(k, dir, big ? BEND.BLINK_BIG : BEND.BLINK);
        return this.add({ kind: 'blink', seat: k, life: 0.6, big, at: from, dir, pts: [from, [c.root[0], c.root[1], c.root[2]]], target: swap ? o : -1 });
      }
      case 'arc': {
        const reach = big ? BEND.ARC_BIG : BEND.ARC_R, a = this.chest(k), b = this.chest(o);
        if (O.reforming || this.joined(o) || len(sub(b, a)) > reach) return null;
        if (aimed && this.atOther(k, dir, reach, true) < 0) return null;
        const meet: V3 = [(a[0] + b[0]) / 2, Math.min((a[1] + b[1]) / 2 + BEND.ARC_UP, Math.max(a[1], b[1]) + 2.2), (a[2] + b[2]) / 2];
        const L = this.add({ kind: 'arc', seat: k, life: big ? BEND.ARC_T_BIG : BEND.ARC_T, big, at: a, dir, meet, target: o });
        this.carried[k] = L; this.carried[o] = L;
        return L;
      }
      case 'pillar': {
        // under the other the stick points at (on the ground or near it), a point ahead, or under the caster
        let x = r[0], z = r[2];
        const od = this.atOther(k, dir, 4.5, aimed);
        if (aimed && od >= 0 && O.root[1] - this.ground(O.root[0], O.root[2], O.root[1] + 0.2) < 0.8) { x = O.root[0]; z = O.root[2]; }
        else if (aimed) { x = r[0] + dir[0] * BEND.PILLAR_AHEAD; z = r[2] + dir[1] * BEND.PILLAR_AHEAD; }
        let first: Live | null = null;
        for (let i = 0; i < (big ? 3 : 1); i++) {
          const px = x + dir[0] * i * 1.4, pz = z + dir[1] * i * 1.4, g = this.ground(px, pz, foot[1] + 0.4 + i * 0.6);
          const L = this.add({ kind: 'pillar', seat: k, life: BEND.PILLAR_LIFE, big, at: [px, g, pz], dir, r: BEND.PILLAR_R, h: BEND.PILLAR_H + i * 0.6, top: g, delay: i * 0.14, solid: null, riders: new Set() });
          first ??= L;
        }
        return first;
      }
      case 'prism': {
        // on a flying partner's path when the stick points at it; else ahead of the caster at chest height
        let at: V3;
        const od = this.atOther(k, dir, 7, aimed);
        if (aimed && od >= 0 && !O.grounded) {
          // (where its flight puts it in a moment: falling as a body falls)
          const ch = this.chest(o), ahead = Math.min(0.2, 2.5 / Math.max(1, len(O.v as unknown as V3)));
          at = [ch[0] + O.v[0] * ahead, ch[1] + O.v[1] * ahead - 0.5 * O.phys.gravity * ahead * ahead, ch[2] + O.v[2] * ahead];
          at[1] = Math.max(at[1], this.ground(at[0], at[2], at[1] + 0.3) + 1.0);
        } else { const ch = this.chest(k); at = [ch[0] + dir[0] * 2.6, ch[1] + 0.45, ch[2] + dir[1] * 2.6]; }
        const toC = sub(this.chest(k), at), tl = Math.hypot(toC[0], toC[2]) || 1;
        return this.add({ kind: 'prism', seat: k, life: BEND.PRISM_LIFE, big, at, dir, n: [toC[0] / tl, 0, toC[2] / tl], uses: BEND.PRISM_USES });
      }
    }
  }

  /** move a body along a way through space (stopped short of a solid); through the other it swaps the two */
  private blinkBy(k: number, dir: V2, dist: number): boolean {
    const c = this.chars[k], O = this.chars[1 - k], from: V3 = [c.root[0], c.root[1], c.root[2]];
    const S = c.terrain.solids ?? [], ct = { d: 0, n: [0, 0, 0] as V3 };
    let go = dist;
    for (let i = 1; i <= 10; i++) {
      const s = (dist * i) / 10, x = from[0] + dir[0] * s, z = from[2] + dir[1] * s;
      if (S.some((q) => { solidContact(q, x, from[1] + 0.9, z, ct); return ct.d < c.phys.bodyR; })) { go = (dist * (i - 1)) / 10; break; }
    }
    const to: V3 = [from[0] + dir[0] * go, from[1], from[2] + dir[1] * go];
    // through the other: the two change places
    const [od, u] = segDist2(O.root, from, to);
    if (!O.reforming && od < 0.7 && Math.abs(O.root[1] - from[1]) < 1.4 && u > 0.05 && !this.joined(1 - k)) {
      const p: V3 = [O.root[0], O.root[1], O.root[2]];
      O.root = [from[0], from[1], from[2]]; c.root = p;
      c.blinkT = 0.16; O.blinkT = 0.16;
      this.felt.swaps++;
      this.fx.push({ k: 'blink', seat: k, from, to: p, swap: true });
      return true;
    }
    c.root = to; c.blinkT = 0.16;
    this.fx.push({ k: 'blink', seat: k, from, to, swap: false });
    return false;
  }

  /** a fire power at p: in a wave, a steam geyser; on an ice step, it melts */
  private reactAt(L: Live, p: V3): boolean {
    let made = false;
    for (const W of this.live) {
      if (W.done || W === L) continue;
      if (W.kind === 'wave' && !W.reacted && reactionOf(L.kind as PowerId, 'wave') && this.inWave(W, p, 0.6)) {
        W.reacted = true;
        const g = this.ground(p[0], p[2], p[1] + 0.3);
        this.add({ kind: 'geyser', seat: L.seat, life: BEND.GEYSER_LIFE, big: false, at: [p[0], g, p[2]], dir: W.dir, r: BEND.GEYSER_R, h: BEND.GEYSER_H });
        this.react('geyser', [p[0], g, p[2]], [L.seat, W.seat]);
        made = true;
      } else if (W.kind === 'step' && W.solid && !W.melted && reactionOf(L.kind as PowerId, 'step')) {
        const ct = { d: 0, n: [0, 0, 0] as V3 };
        solidContact(W.solid, p[0], p[1], p[2], ct);
        if (ct.d < (L.kind === 'flare' ? 1.4 : 0.7)) { this.melt(W, L.seat); made = true; }
      }
    }
    return made;
  }
  private react(kind: ReactionKind, at: V3, seats: number[]) {
    const e = powersReact(this.rules, kind, [...new Set(seats)]);
    this.events.push(e);
    this.fx.push({ k: 'react', kind, at, seats: [...new Set(seats)] });
  }
  /** an ice step melted by fire: gone, and a slick puddle on the floor under it */
  private melt(W: Live, by: number) {
    W.melted = true;
    const at = W.at, g = this.ground(at[0], at[2], at[1] - 0.6, 0.1);
    this.end(W);
    this.add({ kind: 'puddle', seat: W.seat, life: BEND.PUDDLE_LIFE, big: false, at: [at[0], g, at[2]], dir: W.dir, r: BEND.PUDDLE_R });
    this.react('melt', [at[0], W.top ?? at[1], at[2]], [by, W.seat]);
  }
  private inWave(W: Live, p: ArrayLike<number>, pad = 0) {
    const c = W.tip!, dx = p[0] - c[0], dz = p[2] - c[2];
    const along = dx * W.dir[0] + dz * W.dir[1], across = -dx * W.dir[1] + dz * W.dir[0], dy = p[1] - c[1];
    const k = W.big ? 1.25 : 1;
    return Math.abs(along) < (BEND.WAVE_LEN * k) / 2 + pad && Math.abs(across) < (BEND.WAVE_W * k) / 2 + pad && dy > -0.4 && dy < BEND.WAVE_H * k + pad;
  }

  // ---------------------------------------------------------------- each effect, each frame
  private tick(L: Live, dt: number, lift: number[], slick: number[], carry: number[]) {
    const age = this.t - L.born, C = this.chars;
    switch (L.kind) {
      case 'ribbon': {
        const c = C[L.seat];
        if (age < BEND.RIBBON_LAY && !c.reforming) {
          const p = this.chest(L.seat), last = L.pts![L.pts!.length - 1];
          if (len(sub(p, last)) > 0.2) L.pts!.push(p);
        }
        // a fire power: in a wave, the geyser; across an ice step, a melt
        if (!L.reacted) for (const p of L.pts!) if (this.reactAt(L, [p[0], p[1] - 0.8, p[2]])) { L.reacted = true; break; }
        if (age < 0.1 || age > L.life - 0.15 || L.pts!.length < 2) break;
        const U = BEND.RIBBON_UP * (L.big ? BEND.BIG : 1);
        for (let k = 0; k < 2; k++) {
          if (k === L.seat && age < 0.55) continue;
          const b = C[k].root;
          for (let i = 1; i < L.pts!.length; i++) {
            const a = L.pts![i - 1], q = L.pts![i], [hd, u] = segDist2(b, a, q), y = a[1] + (q[1] - a[1]) * u;
            if (hd < BEND.RIBBON_R && b[1] > y - 1.7 && b[1] < y + BEND.RIBBON_H) { lift[k] = Math.max(lift[k], U); break; }
          }
        }
        break;
      }
      case 'geyser': {
        const U = BEND.GEYSER_UP, a = L.at;
        if (age > 0.15 && age < L.life - 0.2) for (let k = 0; k < 2; k++) {
          const ch = C[k], b = ch.root;
          if (Math.hypot(b[0] - a[0], b[2] - a[2]) < L.r! && b[1] > a[1] - 0.6 && b[1] < a[1] + L.h!) {
            lift[k] = Math.max(lift[k], U);
            // (the column holds its riders: drawn in toward its middle, their drift across it eased)
            const e = Math.exp(-2.5 * dt), f = this.flat(ch, [(a[0] - b[0]) * 7 * dt, 0, (a[2] - b[2]) * 7 * dt]);
            ch.v = [ch.v[0] * e + f[0], ch.v[1], ch.v[2] * e + f[2]];
          }
        }
        break;
      }
      case 'whip': this.whip(L, age, dt); break;
      case 'bar': this.bar(L, age, dt); break;
      case 'wave': {
        const k0 = L.big ? 1.25 : 1, sp = BEND.WAVE_SPEED * k0, c = L.tip!;
        const nx = c[0] + L.dir[0] * sp * dt, nz = c[2] + L.dir[1] * sp * dt, ny = this.ground(nx, nz, c[1] + 0.45);
        // (it breaks over a drop or against a wall)
        if (ny < (this.o.yKill ?? -1e9) + 0.5 || ny - c[1] > 0.45) { this.end(L); break; }
        L.tip = [nx, ny, nz];
        for (let k = 0; k < 2; k++) {
          const ch = C[k], b = ch.root;
          if (ch.reforming || this.match.contact.held(k) || !this.inWave(L, b)) continue;
          // a jump from its crest goes higher and on with it
          const jumped = (this.match.bodyEvents[k] ?? []).some((e) => e.type === 'jump' && !e.air);
          if (jumped && !this.crest[k].has(L.id)) {
            this.crest[k].add(L.id);
            this.launch(k, [ch.v[0] + L.dir[0] * 3, ch.v[1] + BEND.CREST * k0, ch.v[2] + L.dir[1] * 3], 'wave');
            continue;
          }
          if (b[1] - ny > 0.4) continue;
          if (ch.plane) carry[k] = sp * (L.dir[0] * ch.plane.right[0] + L.dir[1] * ch.plane.right[2]);
          else ch.root = [b[0] + L.dir[0] * sp * dt, b[1], b[2] + L.dir[1] * sp * dt];
          this.felt.carriedS += dt;
        }
        break;
      }
      case 'step': {
        // (how long bodies stand on the steps)
        if (L.solid) for (let k = 0; k < 2; k++) {
          const ch = C[k];
          if (ch.grounded && Math.abs(ch.root[1] - L.top!) < 0.08 && Math.hypot(ch.root[0] - L.at[0], ch.root[2] - L.at[2]) < 0.9) this.felt.standS += dt;
        }
        if (L.solid && age > L.life - 0.25) { this.dropSolid(L.solid); L.solid = null; }
        break;
      }
      case 'slide': {
        const P = L.pts!, W = BEND.SLIDE_W / 2;
        for (let k = 0; k < 2; k++) {
          const ch = C[k];
          if (!ch.grounded || ch.reforming) continue;
          for (let i = 1; i < P.length; i++) {
            const [hd, u] = segDist2(ch.root, P[i - 1], P[i]), y = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * u;
            if (hd > W || Math.abs(ch.root[1] - y) > 0.3) continue;
            slick[k] = 1;
            const vd = ch.v[0] * L.dir[0] + ch.v[2] * L.dir[1];
            if (Math.abs(vd) > 1) {
              const sg = Math.sign(vd), nv = clamp(Math.abs(vd) + BEND.SLIDE_ACCEL * dt, 0, BEND.SLIDE_MAX) * sg - vd;
              ch.v = [ch.v[0] + L.dir[0] * nv, ch.v[1], ch.v[2] + L.dir[1] * nv];
              this.felt.slideS += dt;
            }
            break;
          }
        }
        break;
      }
      case 'puddle': {
        for (let k = 0; k < 2; k++) {
          const b = C[k].root;
          if (C[k].grounded && Math.hypot(b[0] - L.at[0], b[2] - L.at[2]) < L.r! && Math.abs(b[1] - L.at[1]) < 0.3) slick[k] = 1;
        }
        break;
      }
      case 'arc': this.arc(L, age); break;
      case 'pillar': this.pillar(L, age, dt); break;
      case 'prism': {
        for (let k = 0; k < 2; k++) {
          const ch = C[k], v = ch.v as unknown as V3, sp = len(v);
          if (ch.grounded || ch.reforming || sp < 3.5 || this.t < this.turned[k] || this.match.contact.held(k)) continue;
          const p = this.chest(k);
          if (len(sub(p, L.at)) > BEND.PRISM_R * (L.big ? BEND.BIG : 1)) continue;
          // turned toward the other (where it will be in a moment), a little up: to be caught
          const O = C[1 - k], q = this.chest(1 - k), tgt: V3 = [q[0] + O.v[0] * 0.2, q[1] + 0.6, q[2] + O.v[2] * 0.2];
          const d = sub(tgt, p), dl = len(d) || 1, s = Math.max(sp * 1.05, BEND.PRISM_SPEED * (L.big ? BEND.BIG : 1));
          this.launch(k, [(d[0] / dl) * s, (d[1] / dl) * s + 2.5, (d[2] / dl) * s], 'prism');
          this.turned[k] = this.t + 0.6;
          this.felt.redirects++;
          this.fx.push({ k: 'redirect', seat: k, at: [L.at[0], L.at[1], L.at[2]] });
          L.uses = (L.uses ?? 1) - 1;
          if (L.uses <= 0) this.end(L);
        }
        break;
      }
    }
  }

  /** the whip: out along its aim; the other within reach of the lash is reeled in and caught; an ice step it meets
   *  freezes it into a bar; in water's form, a lash that meets nothing freezes at its tip */
  private whip(L: Live, age: number, dt: number) {
    const k = L.seat, c = this.chars[k], o = 1 - k, O = this.chars[o];
    if (c.reforming) { this.end(L); return; }
    L.hand = [c.root[0] + L.dir[0] * 0.3, c.root[1] + 1.35, c.root[2] + L.dir[1] * 0.3];
    if (L.target === o) {
      // the reel: the other drawn in toward the caster's hands, then the two are joined
      const p = this.chest(o), d = sub(L.hand, p), dl = len(d) || 1;
      L.tip = p;
      if (dl < CONTACT.REST_MAX + 0.35 || (L.reel ?? 0) > BEND.REEL_MAX) {
        if (dl < CONTACT.REST_MAX + 0.6) this.join(k, [(L.hand[0] + p[0]) / 2, (L.hand[1] + p[1]) / 2, (L.hand[2] + p[2]) / 2], 'whip');
        this.carried[o] = null;
        this.end(L);
        return;
      }
      L.reel = (L.reel ?? 0) + dt;
      const s = Math.min(BEND.REEL, dl * 6);
      this.setV(O, [(d[0] / dl) * s, (d[1] / dl) * s + 2.2, (d[2] / dl) * s]);
      O.grounded = false; O.support = null;
      return;
    }
    if (L.target === -2) return; // (frozen: the bar has it)
    const reach = L.h!, ext = Math.min(reach, BEND.WHIP_SPEED * age), n = L.n!;
    const tip: V3 = [L.hand[0] + n[0] * ext, L.hand[1] + n[1] * ext, L.hand[2] + n[2] * ext];
    L.tip = tip;
    // the other within reach of the lash
    if (!O.reforming && !this.joined(o) && !this.match.contact.link) {
      const pts = [this.chest(o), [O.root[0], O.root[1] + 0.4, O.root[2]] as V3, [O.root[0], O.root[1] + 1.6, O.root[2]] as V3];
      if (pts.some((p) => segDist(p, L.hand!, tip)[0] < BEND.WHIP_HIT)) { L.target = o; L.reel = 0; this.carried[o] = L; L.life = age + BEND.REEL_MAX + 0.4; this.felt.reels++; return; }
    }
    // an ice step it meets: the rope freezes into a bar there
    const ct = { d: 0, n: [0, 0, 0] as V3 };
    for (const W of this.live) {
      if (W.kind !== 'step' || !W.solid || W.done) continue;
      for (let i = 1; i <= 6; i++) {
        const u = i / 6, p: V3 = [L.hand[0] + (tip[0] - L.hand[0]) * u, L.hand[1] + (tip[1] - L.hand[1]) * u, L.hand[2] + (tip[2] - L.hand[2]) * u];
        solidContact(W.solid, p[0], p[1], p[2], ct);
        if (ct.d < 0.45) { this.freeze(L, p, [W.seat, k], 'freeze'); return; }
      }
    }
    // water's form: the lash out to its end and nothing met: it freezes at its tip
    if (L.big && ext >= reach - 1e-6 && age > 0.05) { this.freeze(L, tip, [k], null); return; }
    if (ext >= reach && age > reach / BEND.WHIP_SPEED + 0.15) this.end(L);
  }
  /** the lash frozen into a bar at p: the caster swings round it, and lets go at the top of the swing */
  private freeze(L: Live, p: V3, seats: number[], react: ReactionKind | null) {
    const k = L.seat, c = this.chars[k];
    L.target = -2; L.tip = p; this.end(L); L.life = this.t - L.born + 0.2;
    const ch = this.chest(k), d = sub(ch, p), hx = Math.hypot(d[0], d[2]);
    const u: V2 = hx > 0.2 ? [-d[0] / hx, -d[2] / hx] : L.dir;
    const x = d[0] * -u[0] + d[2] * -u[1], y = d[1];
    // (the swing's bottom keeps the chest a body's crouch over the floor; a bar too low to swing under is vaulted)
    const floor = this.ground(p[0], p[2], p[1] - 0.2, 0.1), room = p[1] - floor - 0.75;
    if (room < 0.8) {
      L.target = -2; L.tip = p; this.end(L); L.life = this.t - L.born + 0.2;
      this.launch(k, [u[0] * 6, 12.5, u[1] * 6], 'bar');
      if (react) this.react(react, p, seats);
      return;
    }
    const R = clamp(Math.hypot(x, y), 1.1, Math.min(2.4, room)), th = Math.atan2(-x, -y);
    // (its swing rate from the body's speed round it, at least a good swing's)
    const vu = c.v[0] * u[0] + c.v[2] * u[1], om0 = (vu * Math.cos(th) + c.v[1] * Math.sin(th)) / R, om = (Math.sign(om0) || 1) * Math.max(Math.abs(om0), 3.4);
    const B = this.add({ kind: 'bar', seat: k, life: BEND.BAR_LIFE, big: L.big, at: p, dir: u, R, th, om, free: false });
    // the bar itself: a short rod of ice across the swing (stood on, too)
    const ax: V3 = [-u[1], 0, u[0]];
    B.solid = null;
    this.swapSolid(B, { kind: 'capsule', a: [p[0] - ax[0] * 0.6, p[1], p[2] - ax[2] * 0.6], b: [p[0] + ax[0] * 0.6, p[1], p[2] + ax[2] * 0.6], r: 0.09 });
    this.carried[k] = B;
    this.boost[k] = null;
    this.felt.bars++;
    if (react) this.react(react, p, seats);
  }
  private bar(L: Live, age: number, dt: number) {
    const k = L.seat, c = this.chars[k];
    if (L.free) { if (L.solid && age > L.life - 0.3) { this.dropSolid(L.solid); L.solid = null; } return; }
    if (c.reforming || this.carried[k] !== L) { L.free = true; this.carried[k] = null; return; }
    const R = L.R!, u = L.dir;
    L.om! += (-(BEND.BAR_G / R) * Math.sin(L.th!)) * dt;
    L.om! *= 1 + 0.3 * dt;
    L.th! += L.om! * dt;
    const th = L.th!, om = L.om!;
    const x = R * Math.sin(th), y = -R * Math.cos(th);
    const ch: V3 = [L.at[0] + u[0] * x, L.at[1] + y, L.at[2] + u[1] * x];
    c.root = [ch[0], ch[1] - 1.1, ch[2]];
    const tx = Math.cos(th) * R * om, ty = Math.sin(th) * R * om;
    c.v = [u[0] * tx, ty, u[1] * tx];
    c.grounded = false; c.support = null;
    // let go at the swing's front, rising (or when it has gone on long enough): flung off the bar on its tangent
    if ((age > 0.45 && th * Math.sign(om) > 0.95) || age > BEND.BAR_T) {
      L.free = true; this.carried[k] = null;
      this.launch(k, [u[0] * tx * 1.15, Math.max(ty * 1.15, 0) + 3, u[1] * tx * 1.15], 'bar');
    }
  }

  /** the arc: both drawn to meet in the air; joined when they do (the caster's air catch) */
  private arc(L: Live, age: number) {
    const k = L.seat, o = L.target!, C = this.chars;
    if (C[k].reforming || C[o].reforming) { this.end(L); return; }
    const a = this.chest(k), b = this.chest(o), d = len(sub(b, a));
    if (d < BEND.ARC_MEET) {
      this.carried[k] = null; this.carried[o] = null;
      this.join(k, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], 'arc');
      this.end(L);
      return;
    }
    const T = Math.max(0.1, L.life - age), M = L.meet!;
    for (const s of [k, o]) {
      const p = this.chest(s), v = sub(M, p), vl = len(v) / T, kk = vl > 15 ? 15 / vl : 1;
      this.setV(C[s], [(v[0] / T) * kk, (v[1] / T) * kk, (v[2] / T) * kk]);
      C[s].grounded = false; C[s].support = null;
    }
    if (age >= L.life - 1e-3) { this.carried[k] = null; this.carried[o] = null; }
  }

  /** the pillar: grows from the floor, carrying whoever stands on it, then launches them; stands, then sinks */
  private pillar(L: Live, age: number, dt: number) {
    const u = age - (L.delay ?? 0);
    if (u < 0) return;
    const g = L.at[1], H = L.h!, R = L.r!, sink = L.life - 0.4;
    const grow = smooth(u / BEND.PILLAR_GROW), down = age > sink ? 1 - smooth((age - sink) / 0.4) : 1;
    const top = g + Math.max(0.05, H * grow * down), was = L.top!;
    L.top = top;
    if (top - g > 0.08) this.swapSolid(L, drumSolid([L.at[0], g, L.at[2]], top, R));
    else if (L.solid) { this.dropSolid(L.solid); L.solid = null; }
    if (u <= BEND.PILLAR_GROW + 1e-6) {
      // riders: whoever stands over its foot (or on its top) goes up with it
      for (let k = 0; k < 2; k++) {
        const ch = this.chars[k], b = ch.root;
        if (ch.reforming || this.match.contact.held(k) || Math.hypot(b[0] - L.at[0], b[2] - L.at[2]) > R + 0.2) { L.riders!.delete(k); continue; }
        if (!L.riders!.has(k) && !(b[1] > was - 0.3 && b[1] < was + 0.5 && ch.v[1] < 3)) continue;
        L.riders!.add(k);
        ch.root = [b[0], Math.max(b[1], top), b[2]];
        ch.v = [ch.v[0] * 0.5, Math.max(ch.v[1], (top - was) / Math.max(1e-3, dt)), ch.v[2] * 0.5];
        ch.grounded = false; ch.support = null;
      }
    } else if (!L.launched) {
      L.launched = true;
      for (const k of L.riders!) {
        const ch = this.chars[k];
        this.launch(k, [ch.v[0] + L.dir[0] * 1.5, BEND.PILLAR_LAUNCH * (L.big ? 1.1 : 1), ch.v[2] + L.dir[1] * 1.5], 'pillar');
      }
    }
  }
}
