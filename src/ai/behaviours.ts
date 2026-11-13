// Behaviours: small reasons to move, composed into brains. Each is a function of what the dancer sees (a Sight), its
// working memory (a Mind: it plans presses on the beat and claims the legs, never touching the Intent itself) and its
// own few knobs. A brain is a list of them called in order each frame; the Mind settles which press and which legs
// win. They are:
//
//   keepDistance  hold a distance from the partner, breathing in and out with the ginga's four beats
//   approach      walk to a point (locked: along the plane; free: on the floor), at a walk or a run
//   answer        read an attack from its start event and plan the dodge, parry or clash that meets it, a human
//                 reaction time after it starts, with a skill that sometimes misreads
//   offer         an attack with a clear wind-up, from where it will touch (or, for a partner who isn't answering,
//                 only come near), on an 8th-note line, when it is this dancer's turn
//   echo          the move just seen, a bar later (inside the rules' one-bar echo window)
//   unison        a move the partner is repeating, on its next repeat (inside a 16th: a unison)
//   merge         at full tension come together and hold merge; through the fusion stay close
//   avoidPlane    keep off a stage plane's strip (NPCs) and away from other bodies
//   wander        walk to somewhere new within an area now and then
//   watch         face a point (a jogo), groove to the music, clap on the beat
//   travel        walk up to a gate and through it
//
// Directions are world (x, z) unit vectors; distances metres; times beats on the music's clock unless named seconds.
import { COMBAT, type Capsule, type Character } from '../dancer/character';
import { MOVES, tempoScale } from '../dancer/moves';
import { RULES } from '../../shared/rules.ts';
import { planeNormal, type StagePlane } from '../engine/camera';
import type { Gate, Other, SeenMove, Sight, V3 } from './brain';
import type { Mind } from './mind';
import { ATTACKS, axisTo, busyFor, durOf, freeIn, hypotheticalEvent, nextEighth, startBeat } from './body';
import { clashAt, dodgeCovers, dodgeHolds, parryWindow, reachOf, readThreat, type Threat } from './read';
import { countersOf, exchangeFor, has, levelOf, OPTIONAL } from './vocabulary';
import { PALMAS_MEET } from './clips';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const beatsOf = (sec: number, bpm: number) => (sec * bpm) / 60;
const secsOf = (beats: number, bpm: number) => (beats * 60) / bpm;

/** the jogo's axis: toward the partner, how far (along the plane when locked) */
export function jogoAxis(s: Sight, o: Other) { return axisTo(s.self, o.root[0], o.root[2]); }

/** the other is free to answer: not in a move, not staggered */
export function free(o: Other, bpm: number) {
  // (their body itself, when it is simulated here, says so a frame before the witness does: a move started this frame)
  const m = o.character?.move;
  if (m && !m.def.loop && m.t < m.dur * 0.75) return false;
  return !liveMove(o, bpm) && !(o.flags & 16);
}

/** the partner's latest move and whether it is still going (its duration at the tempo) */
export function liveMove(o: Other, bpm: number): SeenMove | null {
  const m = o.moves[o.moves.length - 1];
  return m && m.age < durOf(m.name, bpm) ? m : null;
}

// ---------------------------------------------------------------- legs
/** walk toward a world point at `k` of a run (free: `walk` uses the walking speed, which the mocap walk matches) */
export function approach(s: Sight, m: Mind, x: number, z: number, o: { k?: number; walk?: boolean; prio?: number; arrive?: number; why?: string } = {}) {
  const a = axisTo(s.self, x, z);
  const arrive = o.arrive ?? 0.15;
  if (a.dist < arrive) return true;
  const k = (o.k ?? 0.5) * clamp(a.dist / 0.8, 0.25, 1);
  m.claim({ x: a.dir[0], z: a.dir[1], k, walk: !!o.walk, prio: o.prio ?? 0, why: o.why ?? 'approach' });
  return false;
}

/** how far a body can go along the locked plane, that way (±1), before a wall or a solid ledge at body height stops
 *  it (m; Infinity when free) */
export function roomBehind(c: Character, way: number): number {
  const pl = c.plane;
  if (!pl) return Infinity;
  const s = c.s, y = c.root[1] - pl.origin[1], hw = 0.2;
  let room = way > 0 ? pl.halfWidth - 0.25 - s : s + pl.halfWidth - 0.25;
  for (const L of pl.ledges) {
    if (!L.solid) continue;
    const top = L.y, bot = L.y - (L.thick ?? 0.4);
    if (y >= top - 1e-3 || y + 1.55 <= bot) continue;
    const d = way > 0 ? L.x0 - hw - s : s - (L.x1 + hw);
    if (d >= -0.05) room = Math.min(room, Math.max(0, d));
  }
  return room;
}

/** hold `target` metres from the partner. The distance breathes with the ginga (±`sway` m over four beats) so two
 *  dancers in ginga close and open like a conversation; backing away is done in short steps, so the body never turns
 *  its back to the partner (Character faces where it runs after faceRunDelay) */
export function keepDistance(s: Sight, m: Mind, o: Other, target: number, sway = 0.25, prio = 0) {
  const a = jogoAxis(s, o);
  const want = target + sway * Math.sin((s.beat * Math.PI) / 2);
  const err = a.dist - want;
  if (Math.abs(err) < 0.12) return;
  if (err > 0) m.claim({ x: a.dir[0], z: a.dir[1], k: clamp(err * 0.45, 0.08, 0.45), walk: false, prio, why: 'close in' });
  else {
    // back steps: on for an 8th, off for an 8th (well inside faceRunDelay); never into a wall or a solid shelf
    if (Math.floor(s.beat * 2) % 2 === 1 || roomBehind(s.self, -a.sign) < 0.5) return;
    m.claim({ x: -a.dir[0], z: -a.dir[1], k: clamp(-err * 0.5, 0.1, s.self.plane ? 0.4 : 0.14), walk: false, prio, why: 'open up' });
  }
}

// ---------------------------------------------------------------- answer
export interface AnswerStyle {
  /** 0 … 1: how often the read is right and the timing true */
  skill: number;
  /** seconds from an attack's start to the moment it is read (a person: about 0.2 to 0.3) */
  reaction: number;
  /** preferences among the answers (relative weights) */
  dodge: number; parry: number; clash: number;
  /** how much the showy dodges (aú, rolê, macaco) are liked over the plain esquiva */
  flair: number;
  /** chance of coming up out of a dodge (or a held block) into a counter of one's own */
  counter?: number;
}

/** how an answer leans this time (the music's mood, a director's cue): weights on the answers' levels */
export interface Lean { low: number; inverted: number; standing: number; clash: number; counter: number; /** free: the way the pair is turning (+1 to the right), which a dodge round the attack takes */ side?: number }
export const LEAN_EVEN: Lean = { low: 1, inverted: 1, standing: 1, clash: 1, counter: 1 };

interface Pending { serial: number; due: number }
/** was the attacker moving toward this body as it started (closing faster than 0.3 m/s)? */
function stepping(mv: SeenMove, me: Character) {
  const e = mv.ev, dx = me.x - e.x, dz = me.z - (e.z ?? 0), l = Math.hypot(dx, dz) || 1;
  return ((e.vx || 0) * dx + (e.vz || 0) * dz) / l > 0.3;
}
/** the attacks waiting to be read, per brain (the reaction delay of each drawn when it is first seen) */
export class Reader {
  private waiting = new Map<number, Pending>();
  /** answers given (for the brain's own book-keeping: was the last attack answered?) */
  last: { serial: number; kind: string; move: string } | null = null;
  /** a line per decision, for tuning (null: quiet) */
  log: ((msg: string) => void) | null = null;
  dueOf(m: Mind, mv: SeenMove, style: AnswerStyle, me: Character, o: Other) {
    let w = this.waiting.get(mv.serial);
    if (!w) {
      // stepping in before it is a wind-up of its own: someone who saw them come is reading sooner
      // (and under a barrage one is on guard: an attack within the last two seconds sharpens the next read)
      const guard = stepping(mv, me) ? 0.6 : 1, onGuard = o.moves.some((x) => x.attack && x.serial !== mv.serial && x.age < 2) ? 0.7 : 1;
      // (and a lead a beat or two before it, a guard raised or a dip, is a telegraph: one who saw it expects the kick
      // on the beat that follows, which is what makes the fast ones answerable)
      const lead = o.moves.some((x) => !x.attack && x.serial !== mv.serial && mv.beat - x.beat > 0.4 && mv.beat - x.beat < 2.1) ? 0.45 : 1;
      // (an attack only grows out of the ginga's back step on a strong beat: a player in the roda is ready on them)
      const strong = Math.abs(mv.beat / 2 - Math.round(mv.beat / 2)) < 0.05 ? 0.75 : 1;
      const toward = Math.min(guard, onGuard, lead, strong);
      // (a person's reaction: log-normal about the median, a tail of slow reads, a lapse now and then)
      w = { serial: mv.serial, due: m.rng.reaction(style.reaction * toward) }; this.waiting.set(mv.serial, w);
    }
    if (this.waiting.size > 32) for (const k of this.waiting.keys()) { if (k < mv.serial - 32) this.waiting.delete(k); }
    return w.due;
  }
}

interface Option { move: string; start: number; kind: 'dodge' | 'clash' | 'parry'; dir: number; w: number; toward: [number, number] }

/** read the partner's attacks and plan the answers (priority 3: above any offer); a dodge or a held block may come up
 *  into a counter (the named exchanges in vocabulary.ts) */
export function answer(s: Sight, m: Mind, o: Other, style: AnswerStyle, reader: Reader, lean: Lean = LEAN_EVEN, onAnswer?: (a: { move: string; kind: string; line: number; attack: SeenMove; counter: string | null }) => void) {
  const c = s.self, bpm = s.bpm;
  for (const mv of o.moves) {
    if (!mv.attack || m.handled.has(mv.serial)) continue;
    const def = MOVES[mv.name];
    if (!def?.active) { m.handled.add(mv.serial); continue; }
    if (mv.age > durOf(mv.name, bpm)) { m.handled.add(mv.serial); continue; }
    if (mv.age < reader.dueOf(m, mv, style, c, o)) continue;
    m.handled.add(mv.serial);
    const now = mv.age, plane = c.plane;
    const th = readThreat(mv.ev, c.hurtShapes(), plane, now);
    const cross = readThreat(mv.ev, [c.standShape()], plane, now);
    if (!th) continue;
    // nothing will touch, and it doesn't even cross where the standing body is: let it pass (it may come near)
    // (and a close pass is treated as a touch: the body sways, the kick slides; a read is never exact)
    const pad = th.first == null && th.min < 0.3 ? readThreat(mv.ev, c.hurtShapes().map((x) => ({ ...x, r: x.r + 0.2 })), plane, now) : null;
    const t = th.first != null ? th : cross && cross.first != null ? cross : pad && pad.first != null ? pad : null;
    if (!t) { reader.log?.(`${s.t.toFixed(2)} ${mv.name}#${mv.serial} age ${now.toFixed(2)}: passes (min ${th.min.toFixed(2)})`); continue; }
    const opts = options(s, m, o, mv, t, th, style, now, lean);
    reader.log?.(`${s.t.toFixed(2)} ${mv.name}#${mv.serial} age ${now.toFixed(2)} touch ${t.first?.toFixed(2)}-${t.last?.toFixed(2)} body ${th.first != null} busy ${busyFor(c).toFixed(2)}: ${opts.map((x) => `${x.move}@${x.start.toFixed(2)}`).join(' ') || 'nothing fits'}`);
    if (!opts.length) continue;
    const pick = m.rng.weighted(opts, (x) => x.w)!;
    // skill: sometimes the read is wrong (too late, or not at all)
    const r = m.rng.next(), miss = 1 - style.skill;
    if (r < miss * 0.3) { reader.last = { serial: mv.serial, kind: 'froze', move: '' }; reader.log?.('   froze'); continue; }
    let start = pick.start;
    if (r < miss * 0.8) start += m.rng.chance(0.5) ? m.rng.range(0.14, 0.3) : -m.rng.range(0.1, 0.25);
    start = Math.max(start, now);
    const line = mv.beat + beatsOf(start, bpm);
    m.cancel((p) => p.prio < 3 && Math.abs(p.line - line) < 2);
    // (a block is held through the whole touch: the body's pose in the block isn't the one the read was made
    // against, so the touch may come later than read; held, it is a parry early on and at worst near, never a hit)
    const hold = pick.move === 'block' ? Math.max(0.12, (t.last ?? t.a1) - start + 0.12) : undefined;
    m.plan({ move: pick.move, line, late: beatsOf(0.03, bpm), toward: pick.toward, prio: 3, why: `answer ${pick.kind}`, hold });
    reader.last = { serial: mv.serial, kind: pick.kind, move: pick.move };
    reader.log?.(`   -> ${pick.move} (${pick.kind}) at ${start.toFixed(2)}${start !== pick.start ? ' (misread)' : ''}`);
    const counter = pick.kind === 'clash' ? null : planCounter(s, m, o, mv, pick.move, line, style, lean, hold);
    onAnswer?.({ move: pick.move, kind: pick.kind, line, attack: mv, counter });
  }
}

/** the counter that comes up out of an answer, in the same motion: the named exchange's (a sweep out of the esquiva,
 *  a push kick out of the held block), on an 8th line once the answer's recovery may be cut, and never before the
 *  attacker has finished their own move and had a person's moment to see it coming (it is an offer too) */
function planCounter(s: Sight, m: Mind, o: Other, mv: SeenMove, answerMove: string, line: number, style: AnswerStyle, lean: Lean, hold?: number): string | null {
  const p = (style.counter ?? 0) * lean.counter;
  if (p <= 0 || !m.rng.chance(Math.min(1, p))) return null;
  const xc = exchangeFor(mv.name);
  const list = countersOf(answerMove, xc && xc.answer.includes(answerMove) ? xc.counter : []);
  if (!list.length) return null;
  const bpm = s.bpm, a = jogoAxis(s, o);
  // (the low counters when the play is low, the standing ones otherwise)
  const name = m.rng.weighted(list, (n, ) => (levelOf(n) === 'low' ? lean.low : lean.standing) * (list.indexOf(n) === 0 ? 2.5 : 1) / (1 + m.recent(n, 4)));
  if (!name) return null;
  const def = MOVES[answerMove];
  const cut = (def.active ? def.active[1] : 0.55) * durOf(answerMove, bpm) + (hold ?? 0) * 0.6;
  const theirEnd = mv.beat + beatsOf(durOf(mv.name, bpm), bpm);
  const fair = theirEnd + beatsOf(0.3 - (MOVES[name]?.windup ?? 0.3), bpm);
  const at = Math.max(line + beatsOf(cut, bpm), line + 0.75, fair, line + (xc?.after ?? 0) * 0.6);
  const l = nextEighth(at);
  const toward: [number, number] = [a.dir[0], a.dir[1]];
  // (on its frame: they are free to answer it, and it will at least come near them where they will be)
  const ok = () => free(o, bpm) && wouldReach(s, name, o) !== false;
  m.plan({ move: name, line: l, late: 0.35, toward, prio: 2.5, why: `counter (${answerMove})`, ok });
  return name;
}

/** the answers that would work, each with its best start (on an 8th line when one fits) and a weight */
function options(s: Sight, m: Mind, o: Other, mv: SeenMove, t: Threat, th: Threat, style: AnswerStyle, now: number, lean: Lean): Option[] {
  const c = s.self, bpm = s.bpm, out: Option[] = [];
  const lag = secsOf(s.beat - startBeat(s.beatPrev, s.beat), bpm);
  const freeFor = (name: string) => now - lag + freeIn(c, name);
  const free = freeFor('esquiva');
  const away = jogoAxis(s, o), back: [number, number] = [-away.dir[0], -away.dir[1]], at: [number, number] = [away.dir[0], away.dir[1]];
  /** the best start in [lo, hi] (s after the attack's start): an 8th line if one falls inside, else the earliest */
  const best = (lo: number, hi: number) => {
    lo = Math.max(lo, free);
    if (hi < lo) return null;
    const b0 = mv.beat + beatsOf(lo, bpm), b1 = mv.beat + beatsOf(hi, bpm), line = nextEighth(b0);
    return line <= b1 ? { at: secsOf(line - mv.beat, bpm), grid: true } : { at: lo, grid: false };
  };
  const g = (x: { grid: boolean }) => (x.grid ? 1.6 : 1);
  const variety = (name: string) => 1 / (1 + 1.2 * m.recent(name, 5));
  // dodges: an evade covers the touch from its first frame to its last
  const pressed = o.moves.filter((x) => x.attack && x.age < 3).length >= 2, flair = style.flair * (pressed ? 0.25 : 1);
  // (the answer the named exchange calls for is the one a capoeirista falls into: liked well above the rest)
  const xc = exchangeFor(mv.name), named = (n: string) => (xc && xc.answer.find(has) === n ? 2.5 : 1);
  const lv = (n: string) => (levelOf(n) === 'low' ? lean.low : levelOf(n) === 'inverted' ? lean.inverted : lean.standing) * named(n);
  // (free, straight back is the least of them: the side ones below carry the pair round the ring)
  const fb = c.plane ? 1 : 0.7;
  const dodges: [string, number, [number, number]][] = [['esquiva', (pressed ? 2 : 1) * fb, back], ['role', flair * fb, back], ['macaco', flair * 0.6, back]];
  // aú toward the partner goes over the attack and comes down on the other side (only from close enough to pass);
  // close, the rolê goes under it and through them the same way
  if (away.dist < 1.7 && c.grounded) dodges.push(['au', flair * 0.9, at]);
  else dodges.push(['au', flair * 0.4, back]);
  if (away.dist < 1.25 && c.grounded) dodges.push(['role', flair * 0.8, at]);
  // free: round it, to the side the pair is turning (the game moves round the roda)
  if (!c.plane) {
    const sg = lean.side ?? 1, side: [number, number] = [-away.dir[1] * sg, away.dir[0] * sg], sideB: [number, number] = [side[0] * 0.7 + back[0] * 0.7, side[1] * 0.7 + back[1] * 0.7];
    dodges.push(['role', flair * 1.6, side], ['au', flair * 0.8, [side[0] * 0.8 + at[0] * 0.6, side[1] * 0.8 + at[1] * 0.6]], ['esquiva', pressed ? 2.4 : 1.4, sideB]);
  }
  // the low and inverted answers the library may have (requested from src/dancer: used once registered)
  for (const n of [OPTIONAL.negativa, OPTIONAL.cocorinha]) if (has(n)) dodges.push([n, flair * 0.9, back]);
  if (has(OPTIONAL.queda)) dodges.push([OPTIONAL.queda, flair * 0.6, back]);
  for (const [name, w0, toward] of dodges) {
    const w = w0 * lv(name);
    if (w <= 0) continue;
    if (!c.grounded && name !== 'esquiva') continue;
    const d = durOf(name, bpm);
    const lo = (t.last ?? t.first!) + 0.02 - d, hi = t.first! - 0.01;
    const b = best(Math.max(lo, now, freeFor(name)), hi);
    if (b && dodgeCovers(name, b.at, t, bpm) && dodgeHolds(c, name, b.at, toward, mv.ev, t, bpm, c.plane)) {
      const whole = b.at + d >= t.a1 + 0.02 ? 2 : 1;
      out.push({ move: name, start: b.at, kind: 'dodge', dir: 1, w: style.dodge * w * g(b) * variety(name) * whole, toward });
    }
  }
  // a parry: the block raised just before the touch (only against a real touch of the body)
  if (th.first != null && c.grounded) {
    const pw = parryWindow(th, bpm);
    if (pw) { const b = best(Math.max(pw[0], freeFor('block')), pw[1]); if (b && b.at <= pw[1]) out.push({ move: 'block', start: b.at, kind: 'parry', dir: 1, w: style.parry * lean.standing * named('block') * g(b) * variety('block'), toward: back }); }
  }
  // a clash: a kick of one's own that meets theirs in the air
  if (c.grounded && style.clash * lean.clash > 0) {
    for (const name of ['meia-lua', 'martelo', 'armada', 'bencao']) {
      const def = MOVES[name], d = durOf(name, bpm);
      // starts from now to just before their touch, on the 8ths first
      const lo = Math.max(now, freeFor(name)), hi = (t.first ?? t.a1) - def.active![0] * d + 0.05;
      const cands: number[] = [];
      for (let line = nextEighth(mv.beat + beatsOf(lo, bpm)); secsOf(line - mv.beat, bpm) <= hi; line += 0.5) cands.push(secsOf(line - mv.beat, bpm));
      cands.push(lo);
      for (const st of cands) {
        if (clashAt(c, name, st, mv.ev, t, bpm, c.plane, away.sign) != null) {
          const grid = Math.abs(beatsOf(st, bpm) + mv.beat - Math.round((beatsOf(st, bpm) + mv.beat) * 2) / 2) < 0.02;
          out.push({ move: name, start: st, kind: 'clash', dir: away.sign, w: style.clash * lean.clash * (grid ? 1.6 : 1) * variety(name), toward: at });
          break;
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- offer
export interface OfferStyle {
  /** how much a long, readable wind-up is preferred (0: any attack, 1: the slow ones) */
  generosity: number;
  /** relative liking for each attack */
  likes: Partial<Record<string, number>>;
  /** at the peak, chain this many attacks (a flurry) */
  flurry: number;
}

/** what the offer should do to the partner: touch them (they must answer) or come near (an invitation) */
export type OfferAim = 'touch' | 'near';

/** the band of distances (m, root to root) at which an attack does what is wanted: touches the standing body, or
 *  passes within COMBAT.NEAR of it without touching */
export function bandOf(name: string, want: OfferAim): [number, number] | null {
  const r = reachOf(name);
  if (!r.touch) return null;
  const [t0, t1] = r.touch;
  // (the throw's stream reaches across the stage: offered close, like a kick)
  const top = name === 'throw' ? Math.min(t1, 1.6) : t1;
  const band: [number, number] = want === 'touch' ? [Math.max(t0 + 0.1, top - 0.45), top - 0.06] : [t1 + 0.02, Math.min(r.near - 0.02, t1 + 0.14)];
  return band[1] > band[0] + 0.02 ? band : null;
}

/** an attack worth offering now: the liked ones, readable wind-ups preferred, the big ones as the music rises,
 *  repeats avoided */
export function chooseOffer(style: OfferStyle, m: Mind, level: number, want: OfferAim, d = NaN): string | null {
  return m.rng.weighted(ATTACKS.filter((n) => bandOf(n, want)), (name) => {
    // (the ones that fit where the dancer stands now are worth more: less walking before the offer)
    const band = bandOf(name, want)!, off = Number.isFinite(d) ? Math.max(0, band[0] - d, d - band[1]) : 0, near = 1 / (1 + 4 * off);

    const like = style.likes[name] ?? 1;
    if (like <= 0) return 0;
    const windup = MOVES[name].windup;
    // generous: a wind-up a person can read (0.2 s and more); calm music prefers the small kicks, the peak the big
    const readable = clamp((windup - 0.12) / 0.25, 0.15, 1.4);
    // a wind-up shorter than a person can read (about 0.24 s) is all but left out by a generous dancer
    const fair = 1 - style.generosity * (1 - clamp((windup - 0.22) / 0.04, 0, 1)) * 0.95;
    const big = name === 'armada' || name === 'rasteira' || name === 'throw' ? 1 : 0;
    const mood = big ? 0.5 + level : 1.2 - 0.4 * level;
    return like * fair * near * (1 - style.generosity + style.generosity * readable) * mood / (1 + 1.5 * m.recent(name, 5));
  });
}

/** how close (m; negative: overlapping by that much, roughly) `name` started now would come to the other's body as
 *  it stands (null when their body isn't simulated here) */
export function liveGap(s: Sight, name: string, o: Other): number | null {
  const oc = o.character;
  if (!oc) return null;
  const ax = jogoAxis(s, o), ev = hypotheticalEvent(s.self, name, s.bpm, ax.sign);
  const hurt = whereThen(o, name, s.bpm);
  const th = readThreat(ev, hurt, s.self.plane);
  if (!th) return null;
  if (th.first == null) return th.min;
  // overlapping: how much further it could be and still touch (the hurt shapes padded until it no longer does)
  for (const pad of [0.04, 0.08, 0.12, 0.16]) {
    const t2 = readThreat(ev, hurt.map((x) => ({ ...x, r: Math.max(0.001, x.r - pad) })), s.self.plane);
    if (!t2 || t2.first == null) return -pad;
  }
  return -0.2;
}

/** would `name`, started now, do what is wanted to the other as they stand? (the live check, by the replay against
 *  their own hurt shapes; null when their body isn't simulated here, so only the distance can say) */
export function wouldDo(s: Sight, name: string, want: OfferAim, o: Other): boolean | null {
  const oc = o.character;
  if (!oc) return null;
  const ax = jogoAxis(s, o), ev = hypotheticalEvent(s.self, name, s.bpm, ax.sign);
  const th = readThreat(ev, whereThen(o, name, s.bpm), s.self.plane);
  if (!th) return false;
  if (want === 'touch') return th.first != null;
  // (an invitation must above all not land, even with the ginga's sway: 8 cm to spare; coming near is the hope,
  // passing is no harm)
  return th.first == null && th.min > 0.08 && th.min <= COMBAT.NEAR + 0.25;
}

/** would `name`, started now, touch the other or at least come near them (a counter: either is an exchange)? */
export function wouldReach(s: Sight, name: string, o: Other): boolean | null {
  const oc = o.character;
  if (!oc) return null;
  const ax = jogoAxis(s, o), ev = hypotheticalEvent(s.self, name, s.bpm, ax.sign);
  const th = readThreat(ev, whereThen(o, name, s.bpm), s.self.plane);
  return !!th && (th.first != null || th.min <= COMBAT.NEAR + 0.2);
}

/** the other's hurt shapes where they will be when `name` (started now) reaches them: carried on the way they are
 *  moving through the attack's wind-up, at most half a metre (a read of where they are going, not where they stand) */
export function whereThen(o: Other, name: string, bpm: number): Capsule[] {
  const hurt = o.character!.hurtShapes();
  const t = (MOVES[name]?.windup ?? 0.3) * tempoScale(bpm) + 0.05;
  let dx = o.v[0] * t, dz = o.v[2] * t;
  const l = Math.hypot(dx, dz);
  if (l < 0.01) return hurt as Capsule[];
  if (l > 0.5) { dx *= 0.5 / l; dz *= 0.5 / l; }
  return hurt.map((x) => ({ ...x, ax: x.ax + dx, az: x.az + dz, bx: x.bx + dx, bz: x.bz + dz }));
}

/** plan `name` at the next 8th line toward the partner (and, for a flurry, the next attacks in each one's recovery) */
export function offer(s: Sight, m: Mind, o: Other, name: string, want: OfferAim, style: OfferStyle, onStart?: (name: string) => void) {
  const a = jogoAxis(s, o);
  const sb = startBeat(s.beatPrev, s.beat), line = nextEighth(sb + 0.05);
  const toward: [number, number] = [a.dir[0], a.dir[1]];
  // (generous: thrown only at a partner free to answer it, and only if it still does what it was meant to)
  const ok = () => free(o, s.bpm) && wouldDo(s, name, want, o) !== false;
  m.plan({ move: name, line, late: 0.1, toward, prio: 1, why: `offer ${want}`, ok, done: (started) => { if (started) onStart?.(name); } });
  let at = line + beatsOf(durOf(name, s.bpm) * ((MOVES[name].active?.[1] ?? 0.6) + 0.04), s.bpm);
  let prev = name;
  for (let k = 1; k < style.flurry; k++) {
    const next = m.rng.weighted(ATTACKS.filter((n) => n !== prev && n !== 'throw' && MOVES[prev].cancelInto.includes(n) && (style.likes[n] ?? 1) > 0 && bandOf(n, want)), (n) => style.likes[n] ?? 1);
    if (!next) break;
    const l = nextEighth(at);
    const n2 = next;
    m.plan({ move: next, line: l, late: 0.12, toward, prio: 1, why: 'flurry', ok: () => wouldDo(s, n2, want, o) !== false });
    at = l + beatsOf(durOf(next, s.bpm) * ((MOVES[next].active?.[1] ?? 0.6) + 0.04), s.bpm);
    prev = next;
  }
}

// ---------------------------------------------------------------- echo and unison
/** moves the rules count for echo and unison */
export const echoable = (name: string) => Object.hasOwn(RULES.moves, name) && RULES.moves[name].echo !== false && name !== 'jump';

/** the partner's move, danced back a bar later (on the 8th line nearest 3½ beats after it: inside the rules' bar) */
export function echo(s: Sight, m: Mind, o: Other, p: number, seen: Set<number>) {
  for (const mv of o.moves) {
    if (seen.has(mv.serial) || mv.age > 0.6) continue;
    seen.add(mv.serial);
    if (!echoable(mv.name) || !m.rng.chance(p)) continue;
    // their move was an echo of mine: don't bounce it back forever
    if (m.mine.some((x) => x.name === mv.name && mv.beat - x.beat > -0.3 && mv.beat - x.beat < 4.2)) continue;
    // a reply, not a delay line: after one beat and a half to three and a half (inside the rules' bar), and not always
    // the same move: mirrored (the other way round), or lower, or answered with its counter (those two earn no echo)
    const delay = m.rng.pick([1.5, 2, 2, 2.5, 3, 3, 3.5]);
    const line = Math.round((mv.beat + delay) * 2) / 2;
    if (line < startBeat(s.beatPrev, s.beat) + 0.25) continue;
    const a = jogoAxis(s, o);
    const v = m.rng.next();
    let name = mv.name, mirror = false, why = 'echo';
    if (v < 0.22 && (name === 'au' || name === 'role' || name === 'spin' || name === 'esquiva')) { mirror = true; why = 'echo mirrored'; }
    else if (v < 0.36 && LOWER[name] && has(LOWER[name])) { name = LOWER[name]; why = 'echo lower'; }
    else if (v < 0.48 && exchangeFor(name)) { const c = exchangeFor(name)!.counter.find(has); if (c) { name = c; why = 'echo with its counter'; } }
    const back = name === 'role' || name === 'macaco';
    const toward: [number, number] = back !== mirror ? [-a.dir[0], -a.dir[1]] : [a.dir[0], a.dir[1]];
    // an echoed attack still has to be safe for them: only from a distance it would touch at most where it can be read
    const attack = !!MOVES[name]?.attack;
    if (attack && reachOf(name).touch && a.dist < reachOf(name).touch![0]) continue;
    // (off the strong beats when they are close: those are where attacks grow out of the ginga, theirs included)
    const l2 = a.dist < 1.8 ? offBeat(line) : line;
    m.plan({ move: name, line: l2, late: 0.12, toward, prio: 1.2, why, ok: attack ? () => free(o, s.bpm) : undefined });
  }
}
/** a line moved off the strong beats (0 and 2 of the bar, the ginga's back steps, where the attacks come) onto the 8th
 *  after it: what isn't an attack keeps out of an attack's way */
export const offBeat = (line: number) => (Math.abs(line / 2 - Math.round(line / 2)) < 1e-6 ? line + 0.5 : line);
/** an attack's lower counterpart (an echo danced lower) */
const LOWER: Record<string, string> = { 'meia-lua': 'rasteira', armada: 'compasso', martelo: 'meia-lua', spin: 'role', block: 'esquiva', au: 'role' };

/** a move the partner has done twice at a steady interval, joined on its next repeat */
export function unison(s: Sight, m: Mind, o: Other, p: number, joined: Set<number>) {
  const ms = o.moves.filter((x) => echoable(x.name));
  if (ms.length < 2) return;
  const b = ms[ms.length - 1], a = ms[ms.length - 2];
  if (a.name !== b.name || joined.has(b.serial)) return;
  joined.add(b.serial);
  const I = b.beat - a.beat;
  if (I < 1 || I > 8.5 || !m.rng.chance(p)) return;
  const line = b.beat + I, sb = startBeat(s.beatPrev, s.beat);
  if (line < sb + 0.1) return;
  const ax = jogoAxis(s, o);
  // (an attack danced in unison at a distance it reaches lands on both: only from out of its reach)
  if (MOVES[b.name]?.attack && ax.dist < (reachOf(b.name).touch?.[1] ?? 0) + 0.25) return;
  m.plan({ move: b.name, line, late: 0.08, toward: [ax.dir[0], ax.dir[1]], prio: 1.5, why: 'unison' });
}

/** start a pattern the partner can join: the same move on two bar lines running */
export function callPattern(s: Sight, m: Mind, o: Other, name: string) {
  const sb = startBeat(s.beatPrev, s.beat), bar = Math.ceil(sb / 4 + 1e-6) * 4, ax = jogoAxis(s, o);
  const toward: [number, number] = [ax.dir[0], ax.dir[1]];
  m.plan({ move: name, line: bar, late: 0.1, toward, prio: 0.9, why: 'call' });
  m.plan({ move: name, line: bar + 4, late: 0.1, toward, prio: 0.9, why: 'call' });
  m.plan({ move: name, line: bar + 8, late: 0.1, toward, prio: 0.9, why: 'call' });
}

// ---------------------------------------------------------------- merge
/** at full tension come close and hold merge (the rules fuse when both hold within MERGE_DIST); through the fusion
 *  stay close. Returns true while it has the dancer's attention */
export function merge(s: Sight, m: Mind, o: Other): boolean {
  const r = s.rules;
  if (!r) return false;
  const a = jogoAxis(s, o);
  if (r.mergeReady && r.phase === 'play') {
    m.cancel((p) => p.prio < 3);
    const close = a.dist < RULES.MERGE_DIST * 0.7;
    if (!close) m.claim({ x: a.dir[0], z: a.dir[1], k: clamp(a.dist * 0.5, 0.15, 0.6), walk: false, prio: 5, why: 'merge: come together', merge: a.dist < 1.5 });
    // (holding, the two keep turning about each other, slowly: free, a step to the side; locked that is no step at all)
    else m.claim({ x: -a.dir[1], z: a.dir[0], k: s.self.plane ? 0 : 0.05, walk: false, prio: 5, why: 'merge: hold', merge: true });
    return true;
  }
  if (r.phase === 'fusion' || (r.phase === 'finale' && r.fusion)) {
    if (a.dist > 0.9) m.claim({ x: a.dir[0], z: a.dir[1], k: 0.3, walk: false, prio: 4, why: 'fusion: stay close' });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- the world
/** a stage plane's strip a dancer outside the jogo must not enter (m either side of the plane, plus the ends) */
export function inStrip(p: StagePlane, x: number, z: number, margin: number) {
  const dx = x - p.origin[0], dz = z - p.origin[2], n = planeNormal(p);
  const s = dx * p.right[0] + dz * p.right[2], d = dx * n[0] + dz * n[2];
  return Math.abs(d) < margin && Math.abs(s) < p.halfWidth + 0.6;
}

/** steer around a strip and away from other bodies: changes the direction of a leg claim in place */
export function avoid(s: Sight, m: Mind, strip: { plane: StagePlane; margin: number } | null, personal = 0.9) {
  const L = m.legs;
  if (!L || L.k <= 0) return;
  const c = s.self;
  let x = L.x, z = L.z;
  for (const o of s.others) {
    const dx = c.x - o.root[0], dz = c.z - o.root[2], d = Math.hypot(dx, dz);
    if (d < personal && d > 1e-3) { const k = (personal - d) / personal * 1.5; x += (dx / d) * k; z += (dz / d) * k; }
  }
  if (strip) {
    const p = strip.plane, n = planeNormal(p), look = 0.9;
    const ax = c.x + x * look, az = c.z + z * look;
    if (inStrip(p, ax, az, strip.margin)) {
      // push back to the side of the plane the body is on, or (rounding an end) out past the end
      const side = (c.x - p.origin[0]) * n[0] + (c.z - p.origin[2]) * n[2] >= 0 ? 1 : -1;
      const s = (c.x - p.origin[0]) * p.right[0] + (c.z - p.origin[2]) * p.right[2];
      if (Math.abs(s) > p.halfWidth) { const o = s < 0 ? -1 : 1; x += p.right[0] * o * 1.6; z += p.right[2] * o * 1.6; }
      else { x += n[0] * side * 1.6; z += n[2] * side * 1.6; }
    }
  }
  const l = Math.hypot(x, z) || 1;
  L.x = x / l; L.z = z / l;
}

/** a waypoint toward (x, z) that goes round the ends of a strip rather than across it */
export function routeAround(c: Character, p: StagePlane, x: number, z: number, margin: number): [number, number] {
  const n = planeNormal(p);
  const side = (q: [number, number]) => (q[0] - p.origin[0]) * n[0] + (q[1] - p.origin[2]) * n[2];
  const along = (q: [number, number]) => (q[0] - p.origin[0]) * p.right[0] + (q[1] - p.origin[2]) * p.right[2];
  const from: [number, number] = [c.x, c.z], to: [number, number] = [x, z];
  const s0 = side(from), s1 = side(to), end = p.halfWidth + 1.0;
  // the same side of the plane (or the target out past an end): straight there
  if (Math.sign(s0) === Math.sign(s1) || Math.abs(along(to)) > end - 0.1) return to;
  const at = (s: number, d: number): [number, number] => [p.origin[0] + p.right[0] * s + n[0] * d, p.origin[2] + p.right[2] * s + n[2] * d];
  const e = (along(from) + along(to) >= 0 ? 1 : -1) * end;
  // out past the end already: round it, onto the target's side
  if (Math.abs(along(from)) > end - 0.6) return at(e + Math.sign(e) * 0.25, Math.sign(s1) * (margin + 0.3));
  // else to the end first, staying on this side, clear of the strip
  return at(e, Math.sign(s0 || 1) * (margin + 0.3));
}

/** walk to somewhere new within `radius` of a centre (keeping off a strip) now and then; true while walking */
export class Wander {
  goal: [number, number] | null = null;
  nextAt = 0;
  pick(s: Sight, m: Mind, cx: number, cz: number, radius: number, strip: { plane: StagePlane; margin: number } | null) {
    const c = s.self;
    for (let k = 0; k < 12; k++) {
      const a = m.rng.range(0, Math.PI * 2), d = radius * Math.sqrt(m.rng.next());
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (strip && inStrip(strip.plane, x, z, strip.margin + 0.6)) continue;
      if (Math.hypot(x - c.x, z - c.z) < 1.2 || Math.hypot(x, z) > s.stage.room - 0.8) continue;
      this.goal = [x, z];
      return;
    }
  }
}

/** face a point and groove: the body hints' lookAt and groove; clap on the beat if asked (palmas, a named move) */
export function watch(s: Sight, m: Mind, at: V3, clap: boolean, groove: number, body: { lookAt: V3 | null; groove: number; clapAt: number }) {
  body.lookAt = at;
  body.groove = groove;
  if (clap && MOVES.palmas && !m.presses.some((p) => p.why === 'palmas' || p.prio > 0.5)) {
    // pressed so the hands meet on the beat (the clap's meeting is part-way through it)
    const sb = startBeat(s.beatPrev, s.beat), lead = beatsOf(durOf('palmas', s.bpm) * PALMAS_MEET, s.bpm);
    const beat = Math.ceil(sb + lead + 0.05), line = beat - lead;
    const tMeet = s.t + secsOf(beat - s.beat, s.bpm);
    if (line - sb < 0.9) m.plan({ move: 'palmas', line, late: 0.06, toward: [0, 1], prio: 0.5, why: 'palmas', done: (st) => { if (st) body.clapAt = tMeet; } });
  }
}

/** walk up to a gate, then through it along its normal (the portals carry the body to the other world) */
export function throughGate(s: Sight, m: Mind, g: Gate, phase: { inFront: boolean }): boolean {
  const c = s.self, front: [number, number] = [g.at[0] + g.normal[0] * 1.6, g.at[2] + g.normal[2] * 1.6];
  if (!phase.inFront) {
    if (approach(s, m, front[0], front[1], { k: 0.32, walk: true, arrive: 0.35, prio: 1, why: 'to the gate' })) phase.inFront = true;
    return true;
  }
  // through: toward the disc's middle and on past it
  const past: [number, number] = [g.at[0] - g.normal[0] * 1.5, g.at[2] - g.normal[2] * 1.5];
  const done = approach(s, m, past[0], past[1], { k: 0.35, walk: true, arrive: 0.3, prio: 1, why: 'through the gate' });
  void c;
  return !done;
}

