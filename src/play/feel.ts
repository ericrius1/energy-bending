// How the jogo is felt: what each exchange looks, sounds and rumbles like, and the perks each element gives its body.
// It reads the jogo's events (jogo.ts) each frame and makes them events in the world:
//
//   dodge   the star. The dance takes a breath (slow motion for a few frames, then eases back), a bright trail lies
//           along the path the attack took through the air where the body was, sparks where it passed closest, the
//           dodge's sound (its count is the streak, which climbs), a light rumble
//   clash   matter thrown from both bodies where they met: a burst into the field (heat from flame, wet from water,
//   parry   cold from ice: fire meeting water steams), an arc if either is plasma, a ring of light and sparks in both
//           bodies' colours, the ring of the clash (or the parry's brighter one), a rumble for both
//   near    a shimmer of small lights along the body where it passed, a soft sound
//   hit     the dancer is knocked back (Character.applyKnock: soft, a short stagger), the air round it is blown
//           outward so its flames or water scatter, a little ring of stars turns round its head for a second (comic,
//           never cruel), the hit's sound, a rumble
//
// The perks, every frame, for the bodies this page plays: the form eases to what the rules allow (with its sound);
// fire rises on its own heat (the field's updraft under it into c.env.updraft); water's floor waves carry it
// (c.env.carryX) and ripple the world's water where it steps; ice lays frost where it steps, and frost is slick
// (c.env.slick) for anyone on it; plasma's dodge blinks (c.env.blink), and its arcs reach for the partner when close.
import { danceParams } from '../dancer/programme';
import { JOINT, JOINT_FLOATS } from '../skeleton/rig';
import type { Dancer } from '../dancer/dancer';
import type { StagePlane } from '../engine/camera';
import type { PublicState } from '../../shared/protocol.ts';
import { Jogo, type Element, type JogoEvent, type SeatBody } from './jogo';
import type { Glows, RGB } from './glow';
import { jogoParams } from './params';

type V3 = [number, number, number];

/** each element's colour (HDR: above 1 blooms) */
export const COLOURS: Record<Element, RGB> = {
  fire: [1.6, 0.62, 0.16],
  plasma: [0.85, 0.42, 1.7],
  water: [0.3, 0.78, 1.55],
  ice: [0.72, 0.95, 1.6],
  gems: [1.05, 0.72, 1.45],
};
export const mixRGB = (a: RGB, b: RGB, u: number): RGB => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

/** what the feel needs of the rest of the game (all optional where a page may not have it) */
export interface FeelCtx {
  glows: Glows;
  /** the jogo's sounds (Music.sfx) */
  sfx?: (name: string, o: Record<string, unknown>) => void;
  /** the field: bursts, updrafts */
  field?: { deposit(d: { p: V3; r: number; heat?: number; wet?: number; wind?: V3 }): void; updraft(id: string, p: V3): number } | null;
  /** plasma's arcs */
  arcs?: { add(a: ArrayLike<number>, b: ArrayLike<number>, I?: number, frames?: number): void } | null;
  /** the world's water (the pool, the temple): a ripple */
  ripple?: (x: number, z: number, strength: number, radius: number) => void;
  /** rumble the gamepad playing a seat */
  rumble?: (seat: number, strength: number, ms: number) => void;
  /** where a sound at p sits for the listener: pan -1 … 1, distance 0 … 1 */
  ear?: (p: V3) => { pan: number; dist: number };
  /** the dancer of each seat (its skeleton for joints, its form) */
  dancer(seat: number): Dancer | null;
  plane(): StagePlane | null;
  /** extra updraft at p from the jogo's own pieces (a ring of flame) */
  updraftAt?: (p: V3) => number;
  /** 0 … 1: how much a fusion holds the scene (its one body has no two elements to ring at the feet) */
  fused?: () => number;
  frame(): number;
}

interface Fx { t: number; life: number; draw(u: number, age: number): void }

const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const jointOf = (d: Dancer | null, j: number): V3 | null => {
  if (!d) return null;
  const W = d.skeleton.world, o = j * JOINT_FLOATS;
  return [W[o], W[o + 1], W[o + 2]];
};

export class Feel {
  private fx: Fx[] = [];
  private t = 0;
  /** the breath: seconds into the dodge's slow motion (-1: none) */
  private breathT = -1;
  private frost: { p: V3; t: number }[] = [];
  private shownForm = [0, 0];
  private stepCount = 0;

  constructor(private jogo: Jogo, private bodies: readonly SeatBody[], private ctx: FeelCtx) {}

  /** each frame, after the jogo's update: its events felt, the perks given, the effects drawn */
  update(dt: number, events: readonly JogoEvent[]) {
    this.t += dt;
    const voicedMove = new Set<number>();
    const voicedJump = new Set<number>();
    for (const e of events) {
      if (e.k === 'move') {
        if (e.move === 'jump') voicedJump.add(e.seat);
        else voicedMove.add(e.seat);
      }
      this.event(e);
    }
    this.perks(dt, voicedMove, voicedJump);
    this.breathe(dt);
    this.fx = this.fx.filter((f) => {
      const age = this.t - f.t, u = age / f.life;
      if (u >= 1) return false;
      f.draw(u, age);
      return true;
    });
  }

  private add(life: number, draw: (u: number, age: number) => void) { this.fx.push({ t: this.t, life, draw }); }
  private sfx(name: string, at: V3 | null, o: Record<string, unknown> = {}) {
    const e = at && this.ctx.ear ? this.ctx.ear(at) : { pan: 0, dist: 0 };
    this.ctx.sfx?.(name, { ...e, ...o });
  }
  private el(seat: number): Element { return this.bodies[seat]?.element() ?? 'gems'; }
  private sfxEl(seat: number) { const e = this.el(seat); return e === 'gems' ? 'ice' : e; }

  // ---------------------------------------------------------------- events
  private event(e: JogoEvent) {
    switch (e.k) {
      case 'xch': this.exchange(e); break;
      case 'move': {
        this.sfx('move', e.at, { move: e.move, element: this.sfxEl(e.seat), perfect: e.perfect, vel: e.perfect ? 0.92 : 0.8 });
        this.moveArc(e.seat, e.move, e.perfect);
        break;
      }
      case 'echo': case 'unison': {
        const a = this.bodies[0]?.chest(), b = this.bodies[1]?.chest();
        this.sfx(e.k, null);
        if (a && b) this.add(0.7, (u) => {
          for (const [p, s] of [[a, 0], [b, 1]] as [V3, number][]) this.ctx.glows.flat([p[0], p[1] - 1.05, p[2]], 0.4 + u * 0.9, COLOURS[this.el(s)], (e.k === 'unison' ? 1.6 : 1) * (1 - u) * (1 - (this.ctx.fused?.() ?? 0)), 'ring');
        });
        break;
      }
      case 'form': this.sfx(e.on ? 'formOn' : 'formOff', this.bodies[e.seat]?.chest() ?? null, { element: this.sfxEl(e.seat) }); break;
      case 'mergeReady': this.sfx('mergeReady', null); break;
    }
  }

  private exchange(e: Extract<JogoEvent, { k: 'xch' }>) {
    const att = e.by, def = e.target, A = this.ctx.dancer(att), D = this.ctx.dancer(def);
    const colA = COLOURS[this.el(att)], colD = COLOURS[this.el(def)];
    const path = e.move ? Jogo.path(e.move, 16) : [];
    const tips: V3[] = path.map((c) => [c.bx, c.by, c.bz]);
    const chestD = this.bodies[def]?.chest() ?? jointOf(D, JOINT.Spine1) ?? [0, 1, 0];
    // where the attack came closest to the body
    let close: V3 = tips[Math.floor(tips.length / 2)] ?? chestD, best = Infinity;
    for (const p of tips) { const d = Math.hypot(p[0] - chestD[0], p[1] - chestD[1], p[2] - chestD[2]); if (d < best) { best = d; close = p; } }
    const G = this.ctx.glows, rum = jogoParams.rumble;
    const mine = (s: number) => this.bodies[s]?.character != null;
    switch (e.res) {
      case 'dodge': {
        this.breathT = 0;
        this.sfx('dodge', close, { element: this.sfxEl(def), count: e.streak });
        if (mine(def)) this.ctx.rumble?.(def, 0.28 * rum, 70);
        const life = jogoParams.trailLife;
        const hot = mixRGB(colA, [1.6, 1.5, 1.4], 0.45);
        this.add(life, (u) => {
          const k = 1 - smooth(u);
          // the trail: drawn on along the path in the first tenth, then it fades
          const n = Math.max(2, Math.ceil(tips.length * Math.min(1, u * 10)));
          for (let i = 1; i < n; i++) {
            const w = i / (tips.length - 1);
            G.seg(tips[i - 1], tips[i], 0.022, hot, 2.2 * k * (0.4 + 0.6 * w), 'soft');
            G.seg(tips[i - 1], tips[i], 0.075, colA, 0.35 * k, 'soft');
          }
          // sparks where it passed closest, drifting up
          for (let j = 0; j < 7; j++) {
            const a = j * 2.39 + att, r = 0.06 + u * 0.35;
            G.dot([close[0] + Math.cos(a) * r, close[1] + u * 0.3 + Math.sin(a * 1.3) * r * 0.5, close[2] + Math.sin(a) * r], 0.025, colD, 1.6 * k, 'spark');
          }
        });
        break;
      }
      case 'clash': case 'parry': {
        // where they met: between the striking limb and the nearest of the other's hands or feet
        const meet = this.meeting(close, D);
        const elA = this.el(att), elD = this.el(def);
        this.sfx(e.res, meet, { element: this.sfxEl(def) });
        for (const s of [att, def]) if (mine(s)) this.ctx.rumble?.(s, (e.res === 'parry' ? 0.5 : 0.65) * rum, 120);
        for (const el of [elA, elD]) this.burst(meet, el, 1);
        if (elA === 'plasma' || elD === 'plasma') {
          const P = elA === 'plasma' ? A : D, other = elA === 'plasma' ? D : A;
          const h1 = jointOf(P, JOINT.RightHand), h2 = jointOf(other, JOINT.LeftHand);
          if (h1) this.ctx.arcs?.add(h1, meet, 1.6, 10);
          if (h2) this.ctx.arcs?.add(meet, h2, 1.1, 7);
        }
        const big = e.res === 'parry' ? 1.25 : 1;
        this.add(0.75, (u, age) => {
          const k = 1 - u;
          G.dot(meet, 0.12 + 0.05 * Math.sin(age * 40), [1.6, 1.5, 1.4], 2.2 * Math.pow(k, 3), 'spark');
          G.dot(meet, 0.1 + u * 0.5 * big, mixRGB(colA, colD, 0.5), 0.6 * k * k, 'ring');
          for (let j = 0; j < 16; j++) {
            const a = j * 2.39996, up = Math.cos(j * 1.7) * 0.6 + 0.4, sp = 2.4 + (j % 5) * 0.4;
            const x = meet[0] + Math.cos(a) * sp * age, y = meet[1] + up * sp * age - 4.9 * age * age, z = meet[2] + Math.sin(a) * sp * age * 0.6;
            G.dot([x, y, z], 0.02, j % 2 ? colA : colD, 1.5 * k, 'spark');
          }
        });
        break;
      }
      case 'near': {
        this.sfx('near', close, { element: this.sfxEl(def) });
        const seed = def * 7 + 1;
        this.add(0.7, (u, age) => {
          const k = Math.sin(Math.PI * u);
          for (let j = 0; j < 10; j++) {
            const a = j * 2.39 + seed, f = 0.5 + 0.5 * Math.sin(age * 30 + j * 1.9);
            G.dot([close[0] + Math.cos(a) * 0.18, close[1] + Math.sin(a * 0.7) * 0.22, close[2] + Math.sin(a) * 0.18], 0.018, [1.4, 1.4, 1.5], 1.2 * k * f, 'spark');
          }
        });
        break;
      }
      case 'hit': {
        this.sfx('hit', chestD, { element: this.sfxEl(def) });
        const c = this.bodies[def]?.character;
        // knocked away from the attacker: along the stage when locked, along the line between them when free
        const ra = this.bodies[att]?.root(), rd = this.bodies[def]?.root();
        if (c && ra && rd) {
          const P = this.ctx.plane();
          let dx = rd[0] - ra[0], dz = rd[2] - ra[2];
          if (P) { const s = Math.sign(dx * P.right[0] + dz * P.right[2]) || 1; dx = P.right[0] * s; dz = P.right[2] * s; }
          const l = Math.hypot(dx, dz) || 1;
          c.applyKnock((dx / l) * jogoParams.knock, jogoParams.knockUp, jogoParams.stagger, (dz / l) * jogoParams.knock);
          this.ctx.rumble?.(def, 0.8 * rum, 180);
        }
        // its matter blown off it: the air round it pushed outward
        const F = this.ctx.field;
        if (F) for (let j = 0; j < 6; j++) {
          const a = (j / 6) * Math.PI * 2;
          F.deposit({ p: [chestD[0] + Math.cos(a) * 0.3, chestD[1] + Math.sin(j) * 0.2, chestD[2] + Math.sin(a) * 0.3], r: 0.45, wind: [Math.cos(a) * 6, 2.5, Math.sin(a) * 6] });
        }
        this.add(1.2, (u, age) => {
          const head = jointOf(D, JOINT.Head) ?? chestD;
          const k = 1 - smooth((u - 0.6) / 0.4);
          // a little ring of stars round the head
          for (let j = 0; j < 3; j++) {
            const a = age * 7 + (j * Math.PI * 2) / 3;
            G.seg([head[0] + Math.cos(a) * 0.2, head[1] + 0.22 + Math.sin(a * 2) * 0.03 - 0.03, head[2] + Math.sin(a) * 0.2],
              [head[0] + Math.cos(a) * 0.2, head[1] + 0.22 + Math.sin(a * 2) * 0.03 + 0.03, head[2] + Math.sin(a) * 0.2], 0.035, [1.6, 1.35, 0.8], 1.2 * k, 'gem');
          }
          // a soft puff where it landed on the body
          G.dot(chestD, 0.2 + u * 0.5, colD, 0.5 * (1 - u) * (1 - u), 'soft');
        });
        break;
      }
    }
  }

  /** where two bodies met: the striking limb's tip and the nearest hand or foot of the other, halfway */
  private meeting(tip: V3, D: Dancer | null): V3 {
    let best: V3 = tip, bd = Infinity;
    for (const j of [JOINT.LeftHand, JOINT.RightHand, JOINT.LeftFoot, JOINT.RightFoot, JOINT.Head]) {
      const p = jointOf(D, j);
      if (!p) continue;
      const d = Math.hypot(p[0] - tip[0], p[1] - tip[1], p[2] - tip[2]);
      if (d < bd) { bd = d; best = p; }
    }
    return [(tip[0] + best[0]) / 2, (tip[1] + best[1]) / 2, (tip[2] + best[2]) / 2];
  }

  /** an element thrown into the air at p: its heat, wet or cold, and the wind of the throw */
  burst(p: V3, el: Element, k: number) {
    const F = this.ctx.field;
    if (!F) return;
    const heat = el === 'fire' ? 1.2 : el === 'plasma' ? 1.6 : el === 'ice' ? -1 : 0;
    const wet = el === 'water' ? 1.2 : el === 'ice' ? 0.3 : 0;
    F.deposit({ p, r: 0.55 * k, heat: heat * k, wet: wet * k, wind: [0, 3.5 * k, 0] });
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * Math.PI * 2 + 0.4;
      F.deposit({ p: [p[0] + Math.cos(a) * 0.25, p[1], p[2] + Math.sin(a) * 0.25], r: 0.35 * k, wind: [Math.cos(a) * 5 * k, 1.5 * k, Math.sin(a) * 5 * k] });
    }
  }

  // ---------------------------------------------------------------- the breath (slow motion)
  private breathe(dt: number) {
    if (this.breathT < 0) return;
    // (the breath runs on real time: it is what slows dance time)
    this.breathT += dt;
    const B = jogoParams.breath, lo = jogoParams.slowmo;
    const k = this.breathT < B ? 1 : 1 - smooth((this.breathT - B) / B);
    danceParams.speed = 1 - (1 - lo) * k;
    if (this.breathT >= 2 * B) { this.breathT = -1; danceParams.speed = 1; }
  }
  /** the dance's speed now (1 outside a breath) */
  get breathing() { return this.breathT >= 0; }

  /** live elemental limb/body ribbon for a dance move (uses existing Glows buffer — zero extra GPU passes) */
  private moveArc(seat: number, move: string, perfect: boolean) {
    const d = this.ctx.dancer(seat);
    if (!d) return;
    const col = COLOURS[this.el(seat)];
    const gold: RGB = [1.7, 1.45, 0.75];
    const mv = move.toLowerCase();
    const isKick = mv === 'meia-lua' || mv === 'armada' || mv === 'martelo' || mv === 'bencao' || mv === 'rasteira';
    const isSpin = mv === 'spin' || mv === 'au' || mv === 'macaco' || mv === 'role' || mv === 'pirueta';
    const joint = isKick ? JOINT.RightFoot : mv === 'strike' || mv === 'throw' ? JOINT.RightHand : JOINT.LeftHand;
    const trail: V3[] = [];
    const life = isSpin ? 0.42 : isKick ? 0.36 : 0.28;
    const G = this.ctx.glows;
    this.add(life, (u) => {
      const p = jointOf(d, joint);
      if (p && u < 0.78) {
        const last = trail[trail.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 0.04) {
          trail.push([p[0], p[1], p[2]]);
          if (trail.length > 10) trail.shift();
        }
      }
      const fade = (1 - u) * (1 - u * 0.5);
      const cMain = perfect ? mixRGB(col, gold, 0.45) : col;
      for (let i = 1; i < trail.length; i++) {
        const w = i / trail.length;
        G.seg(trail[i - 1], trail[i], (0.014 + 0.012 * w) * (perfect ? 1.25 : 1), cMain, (0.95 + (perfect ? 0.5 : 0)) * w * fade, 'soft');
      }
      if (isSpin && p) {
        const chest = jointOf(d, JOINT.Spine1);
        if (chest) G.flat([chest[0], chest[1] - 0.15, chest[2]], 0.32 + u * 0.42, cMain, 0.42 * fade, 'ring');
      }
    });
  }

  // ---------------------------------------------------------------- the perks
  private perks(dt: number, voicedMove: ReadonlySet<number>, voicedJump: ReadonlySet<number>) {
    const st = this.jogo.state, G = this.ctx.glows;
    this.frost = this.frost.filter((f) => this.t - f.t < 7);
    for (let seat = 0; seat < 2; seat++) {
      const b = this.bodies[seat], d = this.ctx.dancer(seat);
      if (!b || !d) continue;
      this.ease(seat, d, st, dt);
      const c = b.character;
      if (!c) continue;
      const el = b.element(), raw = this.jogo.raw[seat] ?? [];
      const r = c.root;
      // fire rises on its own heat; anyone rises in a ring of flame
      const up = el === 'fire' || el === 'plasma' ? Math.min(1, (this.ctx.field?.updraft(`jogo.up${seat}`, [r[0], r[1] + 0.2, r[2]]) ?? 0) / 2.2) : 0;
      c.env.updraft = Math.max(el === 'fire' ? 0.35 : 0, up, this.ctx.updraftAt?.([r[0], r[1], r[2]]) ?? 0);
      // water rides its own floor wave (it carries it the way it is going) and ripples the world's water as it steps
      const it = b.intent();
      c.env.carryX = el === 'water' && c.grounded && it && Math.abs(it.moveX) > 0.3 ? Math.sign(it.moveX) * 0.9 : 0;
      // plasma's dodge is a blink
      c.env.blink = el === 'plasma';
      // ice lays frost where it steps; frost is slick
      let slick = el === 'ice' ? 0.55 : 0;
      for (const f of this.frost) if (Math.hypot(f.p[0] - r[0], f.p[2] - r[2]) < 0.45 && Math.abs(f.p[1] - r[1]) < 0.3) slick = Math.max(slick, 0.8);
      c.env.slick = slick;
      for (const ev of raw) {
        if (ev.type === 'step' || ev.type === 'land') {
          const p: V3 = [ev.x as number, ev.y as number, ev.z as number];
          if (el === 'ice') { this.frost.push({ p, t: this.t }); this.ctx.field?.deposit({ p: [p[0], p[1] + 0.1, p[2]], r: 0.3, heat: -0.8 }); }
          if (el === 'water' || el === 'ice') this.ctx.ripple?.(p[0], p[2], ev.type === 'land' ? 0.6 : 0.25, 0.35);
          else if (ev.type === 'land') this.ctx.ripple?.(p[0], p[2], 0.35, 0.3);
          if (ev.type === 'land' && ((ev.impact as number) ?? 0) >= 3) {
            const imp = Math.min(1, ((ev.impact as number) - 2) / 10);
            this.sfx('land', p, { element: this.sfxEl(seat), vel: 0.4 + 0.5 * imp });
            const cLand = COLOURS[el];
            this.add(0.32, (u) => { G.flat([p[0], p[1] + 0.02, p[2]], 0.18 + u * 0.48, cLand, 0.45 * (1 - u) * (1 - u), 'ring'); });
          }
          this.stepCount++;
        } else if (ev.type === 'jump') {
          const p: V3 = [ev.x as number, (ev.y as number) + 0.03, ev.z as number];
          const air = !!ev.air;
          if (air || !voicedJump.has(seat)) this.sfx('move', p, { move: 'jump', element: this.sfxEl(seat), perfect: air, vel: air ? 0.85 : 0.72 });
          const cJump = air ? mixRGB(COLOURS[el], [1.6, 1.5, 1.1], 0.4) : COLOURS[el];
          this.add(0.32, (u) => { G.flat(p, 0.22 + u * 0.5, cJump, 0.65 * (1 - u) * (1 - u), 'ring'); });
        } else if (ev.type === 'dash') {
          const p: V3 = [ev.x as number, (ev.y as number) + 0.9, ev.z as number];
          const dir = (ev.dir as V3 | undefined) ?? [0, 0, 1];
          this.sfx('move', p, { move: 'dash', element: this.sfxEl(seat), vel: 0.88 });
          const cDash = mixRGB(COLOURS[el], [1.7, 1.55, 1.15], 0.35);
          this.add(0.34, (u) => {
            const k = 1 - u;
            G.seg([p[0] - dir[0] * 0.4, p[1] - dir[1] * 0.4, p[2] - dir[2] * 0.4], [p[0] + dir[0] * (0.4 + u * 1.1), p[1] + dir[1] * (0.4 + u * 1.1), p[2] + dir[2] * (0.4 + u * 1.1)], 0.03 * k + 0.008, cDash, 1.3 * k, 'soft');
            G.flat([p[0], p[1] - 0.85, p[2]], 0.25 + u * 0.55, cDash, 0.55 * k * k, 'ring');
          });
        } else if (ev.type === 'move' && !voicedMove.has(seat)) {
          const p: V3 = [ev.x as number, (ev.y as number) + 1, ev.z as number];
          const mv = String(ev.move ?? 'strike');
          this.sfx('move', p, { move: mv, element: this.sfxEl(seat), perfect: !!ev.perfect, vel: ev.perfect ? 0.88 : 0.75 });
          this.moveArc(seat, mv, !!ev.perfect);
        } else if (ev.type === 'blink') {
          // the way it went, as plasma's own lightning (jagged, forked again each frame, flickering out): this was three
          // straight capsules of glow at fixed heights, which drew as hard horizontal violet bars across whoever stood
          // in the blink's path (film 1, the forms' shift: 8-integration.md, what is left, item 6)
          const a = ev.from as number[], bb = ev.to as number[];
          this.add(0.3, (u) => {
            for (const h of [0.55, 1.1]) {
              if (hash(this.ctx.frame() * 7 + Math.round(h * 10)) < 0.25 + 0.6 * u) continue;
              this.ctx.arcs?.add([a[0], a[1] + h, a[2]], [bb[0], bb[1] + h, bb[2]], 1.1 * (1 - u));
            }
          });
        }
      }
      // plasma reaches for the partner when close
      if (el === 'plasma') {
        const o = this.bodies[1 - seat]?.chest(), h = jointOf(d, (this.ctx.frame() >> 3) & 1 ? JOINT.RightHand : JOINT.LeftHand);
        if (o && h && Math.hypot(o[0] - h[0], o[1] - h[1], o[2] - h[2]) < 1.5 && hash(this.ctx.frame() + seat * 13) < 0.3) this.ctx.arcs?.add(h, o, 0.7);
      }
    }
    // the frost on the floor
    for (const f of this.frost) {
      const k = 1 - (this.t - f.t) / 7;
      G.flat([f.p[0], f.p[1] + 0.005, f.p[2]], 0.22, [0.45, 0.7, 1.0], 0.22 * k, 'soft');
    }
  }

  /** a dancer's form eases to what the rules say (state.form: 0 or 1) */
  private ease(seat: number, d: Dancer, st: PublicState | null, dt: number) {
    const want = st ? st.form[seat as 0 | 1] : 0;
    const v = this.shownForm[seat] + Math.sign(want - this.shownForm[seat]) * Math.min(Math.abs(want - this.shownForm[seat]), dt / Math.max(0.05, jogoParams.formEase));
    this.shownForm[seat] = v;
    d.form = smooth(v);
  }
  /** set a seat's shown form at once (a script, a reset) */
  setForm(seat: number, v: number) { this.shownForm[seat] = v; }

  stats() { return { fx: this.fx.length, frost: this.frost.length, breathing: this.breathT >= 0, steps: this.stepCount }; }
}

const hash = (n: number) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
