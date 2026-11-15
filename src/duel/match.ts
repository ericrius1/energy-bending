// A duel between two bodies: the dance battle's rules (shared/duel.ts) and the contact physics (contact.ts) joined to
// two Characters in an arena's space, free in 3D or locked to its stage plane (whichever the bodies are in: the lock is
// an option anywhere). Pure (no DOM, no GPU), so the page (src/duel/index.ts) and the Node harness (sim.ts) run the same
// thing. Each frame, after the bodies moved:
//   - the contact: catches, the rope, the pump, flings, lifts, counters, vaults (contact.ts), each a link in the
//     combo of the dancer who made it; a fling landed is the flinger's lead
//   - the bodies' own events, links too: a wall jump, a wall run, a dash, a flip, a kick or an aú in the air (none for
//     a body while it is held: the contact carries it, and `Character.env.held` keeps it off the walls)
//   - the space's soft edge (free: near its radius a body's way out is turned along the edge, its speed kept; past it,
//     eased back)
//   - the rules' clock: the set, falls (a body below the kill floor reforms in a moment, near the other so the dance
//     goes on), combos ending, the shared energy and the merge
import { Character } from '../dancer/character';
import { MOVES } from '../dancer/moves';
import { distTo, type StagePlane } from '../engine/camera';
import type { Solid } from '../worlds/solids';
import { DUEL, newDuel, duelStep, duelLink, duelContact, duelFlingLanded, frozen, restartDuel, onBeat, type DuelEvent, type DuelState, type LinkKind } from '../../shared/duel.ts';
import { Contact, noInput, type ContactEvent, type ContactInput } from './contact';
import { TimeWarp, juiceOf, liftJuice, atGeyserTop, type Juice, type LiveLike, type PowerMoment } from './weight';
import type { Arena } from './arena';

type V3 = [number, number, number];

/** the duel's own copy of an arena's plane: its spawns are the two seats' re-forming points when locked, moved by the
 *  duel (the arena's own 3D spawns are projected onto it) */
export function duelPlane(a: Arena): StagePlane {
  const p = a.plane, pr = (v: V3): [number, number] => [(v[0] - p.origin[0]) * p.right[0] + (v[2] - p.origin[2]) * p.right[2], v[1] - p.origin[1]];
  return { ...p, spawns: [pr(a.spawns[0]), pr(a.spawns[1])], lens: a.camera?.lens ?? p.lens };
}

/** the space's soft edge (match.ts softWall): the band inside the radius where a way out is turned along it (m), how
 *  fast (a share of the way out a frame at the radius, eased in over the band), the share of the turned speed kept along
 *  the edge, how far past the radius a body is eased back each frame, and past how far it is stopped outright */
export const EDGE = { band: 1.6, turn: 0.22, keep: 0.85, ease: 0.2, hard: 1.4 };

export interface MatchOptions {
  /** the world's solids (and the arena's pieces) */
  solids?: () => readonly Solid[];
  /** a set's length (ms; default DUEL.SET_MS) */
  setMs?: number;
}

/** a wall run begun again this soon after the last (ms) is the same run */
export const WALL_RUN_GAP_MS = 500;

/** which link a body's own event is, if any */
function bodyLink(e: Record<string, unknown>): LinkKind | null {
  switch (e.type) {
    case 'wallJump': case 'walljump': return 'walljump';
    case 'wall': return e.run ? 'wallrun' : null;
    case 'dash': return 'dash';
    case 'move': {
      const m = e.move as string, air = !!e.air;
      if (m === 'au') return 'au';
      if (air && (m === 'spin' || m === 'esquiva')) return 'flip';
      if (air && MOVES[m]?.attack) return 'kick';
      return null;
    }
  }
  return null;
}

export class DuelMatch {
  readonly state: DuelState;
  readonly contact: Contact;
  /** what the last step decided: the rules' events, and the contact's */
  events: DuelEvent[] = [];
  touches: ContactEvent[] = [];
  /** the speed (m/s) the space's soft edge took from each body this frame (the flow measure's: flow.ts) */
  bounded: [number, number] = [0, 0];
  /** each body's own events of the last step, drained from the Characters */
  bodyEvents: Record<string, unknown>[][] = [[], []];
  /** every event so far with its time (ms), trimmed */
  readonly history: { t: number; e: DuelEvent }[] = [];
  bpm = 112;
  /** each seat's last wall run (ms) */
  private wallRunAt = [-1e9, -1e9];
  /** the weight of contact (weight.ts): the bodies' time, held on a catch, a fling, the lift's top, slowed on a pair
   *  tier. The page and the harness scale their dance time by `warp.step(dt)` before the bodies move */
  readonly warp = new TimeWarp();
  /** this frame's moments (juice events), also in `events` and the history once `juice` ran */
  juiceEvents: Juice[] = [];

  constructor(readonly chars: readonly [Character, Character], readonly arena: Arena, readonly plane: StagePlane, now = 0, bpm = 112, readonly o: MatchOptions = {}) {
    this.bpm = bpm;
    this.state = newDuel(now, bpm, arena.energy);
    this.contact = new Contact(chars);
    // the pose pass: after each body posed itself, the hands on the contact (IntentController fits the rig to the
    // Character's landmarks after its update, so this lands in the frame's pose)
    chars.forEach((c, k) => {
      const up = c.update.bind(c);
      c.update = (...a: Parameters<Character['update']>) => { up(...a); this.contact.pose(k); };
    });
  }

  get locked() { return !!this.chars[0].plane; }
  frozen(seat: number) { return frozen(this.state, seat); }
  restart(now: number) { restartDuel(this.state, now, this.bpm); }
  /** the shared energy, the merge charge (0 … 1) */
  get energy() { return this.state.energy; }

  /** is a body against a wall it can kick off (for the stats when the body says nothing of it) */
  againstWall(c: Character): boolean {
    if (c.onWall) return true;
    const S = this.o.solids?.() ?? [];
    const p: V3 = [c.root[0], c.root[1] + 1, c.root[2]];
    return S.some((s) => distTo(s, p) < 0.6);
  }

  /** each frame, after the bodies moved */
  step(now: number, beat: number, bpm: number, dt: number, inputs: readonly [ContactInput, ContactInput] = [noInput(), noInput()]): DuelEvent[] {
    this.bpm = bpm;
    const out: DuelEvent[] = [], d = this.state, beatOn = onBeat(beat, bpm);
    // the contact (nothing in the count-in, or for a body reforming)
    const live = (k: number) => !frozen(d, k);
    const ins: [ContactInput, ContactInput] = [live(0) ? inputs[0] : noInput(), live(1) ? inputs[1] : noInput()];
    const setMs = this.o.setMs ?? DUEL.SET_MS;
    if (d.phase === 'play') {
      this.touches = this.contact.step(ins, dt / 1000, beatOn);
      for (const t of this.touches) {
        if (t.kind === 'landed') out.push(...duelFlingLanded(d, t.seat));
        else if (t.kind !== 'release') out.push(...duelLink(d, t.seat, t.kind, t.perfect, now, setMs));
      }
    } else { this.touches = []; if (this.contact.link) this.contact.link = null; }
    const L = this.contact.link;
    duelContact(d, !!L, now, L ? L.held : -1);
    // the bodies' own events: links. A body held (when it moved this frame, or now) made none of its own: the contact
    // carried it, and dragged along a solid's face it would start and end a wall run every frame (report 12). The
    // body is told it is held (Character.env.held) so it starts no wall slide or run while carried
    for (let k = 0; k < 2; k++) {
      const c = this.chars[k], ev = c.events; c.events = [];
      this.bodyEvents[k] = ev;
      const carried = !!c.env.held || this.contact.held(k);
      if (!carried) for (const e of ev) {
        const B = bodyLink(e);
        if (!B) continue;
        // (a wall run met again within WALL_RUN_GAP_MS is the same run: a body flickering on a face is one link)
        if (B === 'wallrun') { const again = now - this.wallRunAt[k] < WALL_RUN_GAP_MS; this.wallRunAt[k] = now; if (again) continue; }
        out.push(...duelLink(d, k, B, beatOn, now, setMs));
      }
      c.env.held = this.contact.held(k);
      this.bounded[k] = 0;
      if (!c.plane) this.bounded[k] = this.softWall(c);
    }
    const body = (c: Character) => ({ y: c.root[1], grounded: c.grounded, x: c.root[0], z: c.root[2] });
    const ev = duelStep(d, now, dt, [body(this.chars[0]), body(this.chars[1])], { yKill: this.arena.space.yKill, bpm, setMs: this.o.setMs });
    for (const e of ev) this.apply(e);
    out.push(...ev);
    this.events = out;
    for (const e of out) this.history.push({ t: Math.round(now), e });
    if (this.history.length > 800) this.history.splice(0, this.history.length - 500);
    return out;
  }

  /** the space's soft edge (phase 5, report 18-flow: it was a wall that took a body's outward speed at the radius,
   *  a stop): from EDGE.band inside the radius a body's way out is turned along the edge, more the further out, its
   *  speed kept (most of it), so a run at the edge curves round it as a skater's would; past the radius it is eased back
   *  in as before; far past it (a fling at full speed), stopped as before. Returns the speed taken (m/s) */
  private softWall(c: Character) {
    const S = this.arena.space, dx = c.root[0] - S.center[0], dz = c.root[2] - S.center[2], d = Math.hypot(dx, dz);
    const E = EDGE, inner = S.radius - E.band;
    if (d <= inner || d < 1e-6) return 0;
    const nx = dx / d, nz = dz / d, over = d - S.radius;
    if (over > 0) { c.root[0] -= nx * over * E.ease; c.root[2] -= nz * over * E.ease; }
    const out = c.v[0] * nx + c.v[2] * nz;
    if (out <= 0) return 0;
    if (over > E.hard) { c.v[0] -= nx * out; c.v[2] -= nz * out; return out; }
    // (how much of the way out is turned this frame: none at the band's inner edge, all of it at the radius)
    const k = Math.min(1, (d - inner) / E.band), turn = out * Math.min(1, k * k * E.turn + (over > 0 ? 1 : 0));
    let tx = c.v[0] - nx * out, tz = c.v[2] - nz * out, tl = Math.hypot(tx, tz);
    // (straight out: turned toward the way the body faces, else either way)
    if (tl < 0.3) { const f = Math.sin(c.yaw) * -nz + Math.cos(c.yaw) * nx >= 0 ? 1 : -1; tx = -nz * f; tz = nx * f; tl = 0; } else { tx /= tl; tz /= tl; }
    const along = tl + turn * E.keep;
    c.v[0] = tx * along + nx * (out - turn); c.v[2] = tz * along + nz * (out - turn);
    return turn * (1 - E.keep);
  }

  /** where a seat (re)forms: its home (free) and its plane spawn (locked), standing at the spawn's own height (free,
   *  Character.spawn puts it on the world's groundAt, which knows nothing of the arena's pieces) */
  private formAt(k: number, at: readonly number[]) {
    const p = this.plane, c = this.chars[k];
    p.spawns[k] = [(at[0] - p.origin[0]) * p.right[0] + (at[2] - p.origin[2]) * p.right[2], at[1] - p.origin[1]];
    c.home = [at[0], at[1], at[2]];
    c.spawn();
    if (!c.plane) { c.root[1] = at[1]; c.lastGroundY = at[1]; }
  }
  /** after a fall: the spawn nearest the other body, but not on top of it (the dance goes on at once) */
  private nearOther(k: number): V3 {
    const o = this.chars[1 - k].root;
    let best = this.arena.spawns[k], bd = Infinity;
    for (const s of this.arena.spawns) {
      const dd = Math.hypot(s[0] - o[0], s[2] - o[2]);
      if (dd >= 2.5 && dd < bd) { bd = dd; best = s; }
    }
    return [best[0], best[1], best[2]];
  }

  private unheld() { for (const c of this.chars) c.env.held = false; }

  private apply(e: DuelEvent) {
    switch (e.k) {
      case 'fall': if (this.contact.link) this.contact.link = null; this.unheld(); this.formAt(e.seat, this.nearOther(e.seat)); break;
      case 'set': for (let k = 0; k < 2; k++) this.formAt(k, this.arena.spawns[k]); this.contact.link = null; this.unheld(); break;
    }
  }

  /** after the step and the powers' step: the frame's moments of weight (juice events) from the match's events and
   *  touches, the powers' rules events (`extra`: a power's catch, a tier it made) and moments (`power`: a catch at
   *  range), the powers' live effects (a geyser's top), and the finale's lift at its top (`lift`: base, flyer, where).
   *  They hold or slow the warp and go into the history; the caller adds them to the frame's event stream (the step's
   *  events, which the powers' were added to already or are passed here: each is read once) */
  juice(now: number, extra: readonly DuelEvent[] = [], power: readonly PowerMoment[] = [], live: readonly LiveLike[] = [], lift?: { base: number; flyer: number; at: V3 } | null): Juice[] {
    const chest = (k: number): V3 => { const r = this.chars[k].root; return [r[0], r[1] + 1.1, r[2]]; };
    const all = [...new Set([...this.events, ...extra])];
    if (all.some((e) => e.k === 'set')) this.warp.reset();
    const j = juiceOf(all, this.touches, power, {
      bpm: this.bpm, at: chest, geyserTop: live.length ? (k) => atGeyserTop(live, chest(k)) : undefined,
    });
    if (lift) j.push(liftJuice(lift.base, lift.flyer, lift.at));
    for (const e of j) { this.warp.add(e); this.history.push({ t: Math.round(now), e }); }
    this.juiceEvents = j;
    return j;
  }

  /** the set's clock: seconds of play, and the count showing */
  clock(now: number) {
    const d = this.state;
    return { time: d.phase === 'intro' ? 0 : (d.phase === 'play' ? now : d.playFrom + (this.o.setMs ?? DUEL.SET_MS)) - d.playFrom, count: d.count };
  }
}

export { DUEL };
