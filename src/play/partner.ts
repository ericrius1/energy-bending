// The partner: a brain playing the other seat. The brains (src/ai, another agent's) decide an Intent each frame from
// what they can see; this file holds the thin adapter that makes any such brain a device the jogo can seat
// (`BrainSource`, an IntentSource), the view it is handed (`PartnerView`), and a small built-in stand-in so the jogo has
// a partner today. When src/ai has its partner, it drops in here: anything with `think(view): Intent` will do.
//
// The stand-in keeps a conversational distance, gingas, answers on the beat (an attack now and then, a cartwheel, a
// spin), dodges most of what comes at it (esquiva under a kick), takes its form when it has the flow, comes in and holds
// merge when the invitation shows, and says ready at the end. It is deterministic: its choices come from the beat
// number, never Math.random, so a stepped jogo against it repeats.
import type { Character } from '../dancer/character';
import { MOVES } from '../dancer/moves';
import { makeIntent, type Intent, type IntentSource, type InputMode } from '../input/intent';
import type { StagePlane } from '../engine/camera';
import { RULES } from '../../shared/rules.ts';
import type { PublicState } from '../../shared/protocol.ts';

type V3 = [number, number, number];

/** what a partner brain sees each frame */
export interface PartnerView {
  dt: number;
  /** the music's beat (fractional) and tempo */
  beat: { beats: number; bpm: number };
  /** its own body, and the other dancer's where it stands, what move it is in (if this page knows) */
  me: Character;
  them: { root: V3; move: string | null; moveT: number; character: Character | null };
  /** the room's state (phase, tension, flow, form, mergeReady …) and which seat it plays */
  state: PublicState | null;
  seat: number;
  /** the plane the jogo is locked to (moveX is along it), or null free */
  plane: StagePlane | null;
}

/** a brain: decides an Intent from what it sees (src/ai's partner will be one) */
export interface Brain { think(view: PartnerView): Intent }

/** any brain as an input device for the jogo's seat */
export class BrainSource implements IntentSource {
  mode: InputMode = 'locked';
  constructor(readonly name: string, public brain: Brain, private view: (dt: number) => PartnerView | null) {}
  update(dt: number): Intent {
    const v = this.view(dt);
    return v ? this.brain.think(v) : makeIntent();
  }
}

const hash = (n: number) => { const x = Math.sin(n * 91.345 + 3.7) * 43758.5453; return x - Math.floor(x); };

/** the built-in stand-in partner */
export class StandIn implements Brain {
  private lastBeat = -1;
  private lastEighth = -1;
  private sawMove: string | null = null;
  private dodgeIn = -1;
  private holdDodge = 0;
  private formAsked = -1e9;
  private readied = false;
  /** how far it likes to stand from the other (m) */
  distance = 0.95;
  /** how often it dodges what comes at it */
  answer = 0.8;

  think(v: PartnerView): Intent {
    const it = makeIntent(), me = v.me, st = v.state;
    const s = (p: V3) => (v.plane ? (p[0] - v.plane.origin[0]) * v.plane.right[0] + (p[2] - v.plane.origin[2]) * v.plane.right[2] : p[0]);
    const gap = s(v.them.root) - s(me.root), dist = Math.abs(gap), toward = Math.sign(gap) || 1;
    const beat = v.beat.beats, b = Math.floor(beat), e8 = Math.floor(beat * 2);
    const phase = st?.phase ?? 'waiting';
    const playing = phase === 'play' || phase === 'fusion' || phase === 'finale';
    if (phase === 'over') { if (!this.readied && hash(b) < 0.5) { it.jump = true; this.readied = true; } return it; }
    this.readied = false;
    if (!playing) return it;
    // the invitation: come in and hold merge
    if (st?.mergeReady || phase === 'fusion') {
      if (dist > 0.4) it.moveX = toward * Math.min(1, (dist - 0.3) * 1.5);
      it.merge = true;
      return it;
    }
    // something coming: dodge under it a moment after it starts (a person's reaction)
    const m = v.them.move;
    if (m && m !== this.sawMove && MOVES[m]?.attack && dist < 2.6) {
      this.dodgeIn = hash(e8 * 1.3 + 0.5) < this.answer ? 0.06 + 0.06 * hash(e8) : -1;
    }
    this.sawMove = m;
    if (this.dodgeIn >= 0) {
      this.dodgeIn -= v.dt;
      if (this.dodgeIn < 0) { it.dodge = true; it.moveY = -1; this.holdDodge = 0.2; }
      return it;
    }
    if (this.holdDodge > 0) { this.holdDodge -= v.dt; it.moveY = -1; return it; }
    // keep the distance
    if (dist > this.distance + 0.12) it.moveX = toward * Math.min(0.8, 0.3 + dist - this.distance);
    else if (dist < this.distance - 0.35) it.moveX = -toward * 0.6;
    // the form when it has the flow
    const flow = st?.flow[v.seat as 0 | 1] ?? 0;
    if (flow > RULES.FORM_ENTER + 15 && !st?.form[v.seat as 0 | 1] && beat - this.formAsked > 16) { it.form = true; this.formAsked = beat; }
    // on the 8th lines, now and then, something of its own
    if (e8 !== this.lastEighth) {
      this.lastEighth = e8;
      const r = hash(e8);
      if (b !== this.lastBeat && !me.move && me.grounded) {
        if (r < 0.1 && dist < 2.4) it.kick = true;
        else if (r < 0.14) { it.spin = true; it.moveX = -toward; it.auDir = -toward; }
        else if (r < 0.17) it.spin = true;
        else if (r < 0.19 && dist < 1.6) { it.punch = true; }
        if (it.kick || it.spin || it.punch) this.lastBeat = b;
      }
    }
    return it;
  }
}
