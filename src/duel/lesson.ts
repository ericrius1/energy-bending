// The first duel teaches itself: a short lesson of calm prompts in the HUD's look (index.html `.dl`), offered once and
// remembered (localStorage `energybending.duel.taught`), like the jogo's teacher. Under a minute and skippable (its
// skip chip, Esc, a gamepad's Start), each prompt with the keys of the player's own device (help.ts KEYS):
//   1 catch       run to the other and catch them (the grab, held)
//   2 fling       swing them round with the stick, let go to fling
//   3 power 1     a little flow given to start with (dancing on the beat fills it), and the first power, by name
//   4 power 2     the second power (report 13: new pairs never reached for it)
//   5 a reaction  two powers that meet: the pair's own (fire in water's wave, steam; fire on an ice step, a melt;
//                 water's whip on an ice step, a bar to swing on), the virtual partner casting its half where the
//                 player can meet it, or answering the player's; a pair whose matters make none is told what does
//   6 power form  the bar filled for them, and the form (report 13: new pairs may never see it)
//   7 the end     the controls card's key
// Each step moves on when it is done (a soft "lovely") or after its own few seconds, so nobody is ever stuck, and the
// whole is cut short at LIMIT_S. It starts when the first set's play begins and stops if the set ends first. It
// changes nothing in the rules: what it gives is flow (bend.duel.flow) and the partner's casts (bend.duel.cast), as a
// generous partner would. Not offered in a film, with &go, online (&net), or to automation (navigator.webdriver: the
// playtests); &lesson asks for it anyway, &nolesson never.
import type { FrameBuilder } from '../engine/frame';
import type { DuelEvent } from '../../shared/duel.ts';
import { POWERS, POWER_NAME, type Matter, type PowerId } from '../../shared/powers.ts';
import { KEYS, POWER_SHORT, devOf, guessDev, type Action, type Dev } from './help';

const TAUGHT = 'energybending.duel.taught';
const LIMIT_S = 58;
const OK_S = 1.1;
const WELL = ['lovely', 'beautiful', 'there it is', 'yes', 'gorgeous', 'perfect'];

/** what the lesson reads of the duel (bend.duel) */
export interface LessonDuel {
  readonly state: { phase: string };
  readonly started: boolean;
  events(): DuelEvent[];
  readonly powers: {
    rules: { seats: { matter: Matter; casts: number[]; forms: number; flow: number }[]; reactions: Record<string, number> };
    /** the powers standing now (a wave's tip, a step's place) */
    live: readonly { kind: string; seat: number; at: ArrayLike<number>; tip?: ArrayLike<number>; done?: boolean }[];
  };
  cast(k: number, slot: 0 | 1 | 'form', stick?: [number, number]): void;
  flow(k: number, v?: number): number;
}
export interface LessonCtx {
  frame: FrameBuilder;
  duel: LessonDuel;
  query: URLSearchParams;
  film: boolean;
  /** the seats people play */
  humanSeats: readonly number[];
  /** is seat k a virtual player now */
  bot: (k: number) => boolean;
  /** seat k's source's name (its device) */
  device: (k: number) => string | null;
  /** seat k's body's root (world) */
  root: (k: number) => ArrayLike<number>;
  /** is seat k held by the other now (the partner caught them first) */
  held?: (k: number) => boolean;
  /** is seat k joined to the other (holding or held: no power casts then) */
  joined?: (k: number) => boolean;
}

/** whether this duel offers the lesson (and marks it offered when it does) */
export function wantsLesson(q: URLSearchParams, film: boolean): boolean {
  if (film || q.has('nolesson') || q.has('go') || q.has('net')) return false;
  if (q.has('lesson')) return true;
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
  try { return !localStorage.getItem(TAUGHT); } catch { return true; }
}

interface Step {
  id: string;
  /** what it says, and the keys under it ([action, what it does]) */
  say: string;
  keys: [Action, string][];
  /** its own time (s) before it moves on regardless */
  s: number;
  /** what it says instead, now (the partner caught them first) */
  alt?(): string | null;
  /** the moment to press is now (the partner's wave on you, their step by you): the keys glow */
  now?(): boolean;
  enter?(): void;
  tick?(t: number): void;
  /** done this frame (the frame's events, the casts and forms since it began) */
  done(ev: readonly DuelEvent[]): boolean;
}

export class Lesson {
  readonly root: HTMLElement;
  private steps: Step[] = [];
  private i = -1;
  private t = 0;
  private stepT = 0;
  private okT = -1;
  private on = false;
  private over = false;
  private keysAt = -1;
  private base = { casts: [[0, 0], [0, 0]] as number[][], forms: [0, 0], reacts: 0 };

  constructor(private o: LessonCtx) {
    this.root = document.createElement('div');
    this.root.className = 'dl';
    this.root.setAttribute('role', 'status');
    this.root.innerHTML = `<div class="dl-dots"></div><p class="dl-say"></p><div class="dl-keys"></div><button type="button" class="dl-skip">skip</button>`;
    const skip = this.root.querySelector<HTMLButtonElement>('.dl-skip')!;
    skip.addEventListener('pointerdown', (e) => e.stopPropagation());
    skip.addEventListener('click', (e) => { e.stopPropagation(); this.skip(); });
    o.frame.tick('post', (f) => this.update(f.dt), 'duel: the first duel\'s lesson');
  }

  active() { return this.on && !this.over; }
  /** stop it now (the skip chip, Esc, Start) */
  skip() { if (this.on && !this.over) this.end(); }

  /** the seats the prompts speak to: people with a device now (else the first human seat) */
  private people() { const h = this.o.humanSeats.filter((k) => !this.o.bot(k)); return h; }
  private dev(k: number): Dev { return devOf(this.o.device(k)) ?? guessDev(); }
  private matter(k: number): Matter { return this.o.duel.powers.rules.seats[k].matter; }

  private build() {
    const D = this.o.duel, P = this.people(), h = P[0] ?? 0, other = 1 - h;
    const two = P.length > 1;
    const casts = (slot: number) => P.some((k) => D.powers.rules.seats[k].casts[slot] > this.base.casts[k][slot]);
    const linked = (ev: readonly DuelEvent[], kinds: string[]) => ev.some((e) => e.k === 'link' && P.includes(e.seat) && kinds.includes(e.kind));
    const give = (v: number) => { for (const k of P) D.flow(k, Math.max(D.flow(k), v)); };
    const p1 = POWERS[this.matter(h)].powers[0], p2 = POWERS[this.matter(h)].powers[1];
    const named = (p: PowerId) => `${POWER_NAME[p]}: ${POWER_SHORT[p]}`;
    // (a power waits while the two are joined: say so rather than let a press do nothing)
    const apart = () => (P.some((k) => this.o.joined?.(k)) ? 'Let go first: the powers wait while you two are joined' : null);
    this.steps = [
      { id: 'catch', s: 14, say: two ? 'Run to each other, and catch' : 'Run to your partner, and catch them',
        keys: [['move', 'move'], ['jump', 'jump'], ['catch', 'hold to catch']], done: (ev) => linked(ev, ['catch', 'aerial']),
        alt: () => (P.some((k) => this.o.held?.(k)) ? 'They caught you first! Jump to spin out, then catch them back' : null) },
      { id: 'fling', s: 11, say: 'Holding on? Swing them round with the stick, then let go to fling',
        alt: () => (P.some((k) => this.o.held?.(k)) ? 'Held? Jump to spin out, then catch them, swing, and let go' : null),
        keys: [['catch', 'let go to fling']], done: (ev) => linked(ev, ['fling']) },
      { id: 'power1', s: 9, say: `Dancing on the beat fills your flow. Here is a little. Power 1, ${two ? 'your first power' : named(p1)}`,
        keys: [['power1', two ? 'power 1' : POWER_NAME[p1]]], enter: () => give(0.55), done: () => casts(0), alt: apart },
      { id: 'power2', s: 9, say: `And power 2, ${two ? 'your second' : named(p2)}`,
        keys: [['power2', two ? 'power 2' : POWER_NAME[p2]]], enter: () => give(0.55), done: () => casts(1), alt: apart },
      this.reaction(h, other, two),
      { id: 'form', s: 9, say: 'Your bar is full: take the power form. Six seconds, every power free and bigger',
        keys: [['form', 'power form']], enter: () => { for (const k of P) D.flow(k, 1); }, done: () => P.some((k) => D.powers.rules.seats[k].forms > this.base.forms[k]) },
      { id: 'end', s: 4, say: 'That is the dance. Catch on the beat, and keep it flowing', keys: [['help', 'the controls, any time']], done: () => false },
    ];
  }

  /** the reaction step for this pair: who casts what, and the partner's half */
  private reaction(h: number, b: number, two: boolean): Step {
    const D = this.o.duel, P = this.people(), mine = this.matter(h), theirs = this.matter(b);
    const has = (x: Matter, y: Matter) => (mine === x && theirs === y) || (mine === y && theirs === x);
    const reacted = () => Object.values(D.powers.rules.reactions).reduce((a, n) => a + n, 0) > this.base.reacts;
    const helper = !two && this.o.bot(b);
    const toward = (from: number, to: number): [number, number] => {
      const a = this.o.root(from), c = this.o.root(to), dx = c[0] - a[0], dz = c[2] - a[2], l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    };
    const cast = (slot: 0 | 1) => { D.flow(b, Math.max(D.flow(b), 0.6)); D.cast(b, slot, toward(b, h)); };
    const give = () => { for (const k of P) D.flow(k, Math.max(D.flow(k), 0.6)); };
    // the partner's half: theirs first (a wave to you, a step for you), every few seconds; or an answer to your cast
    let next = 0.6, answers: number[] = [], seen = 0;
    const leads = (slot: 0 | 1) => (t: number) => { if (helper && t >= next) { cast(slot); next = t + 3.6; } };
    const answer = (mySlot: 0 | 1, theirSlot: 0 | 1) => (t: number) => {
      if (!helper) return;
      const n = D.powers.rules.seats[h].casts[mySlot];
      if (n > seen) { seen = n; answers = [t + 0.3, t + 0.75, t + 1.25]; }
      while (answers.length && t >= answers[0]) { answers.shift(); cast(theirSlot); }
    };
    // (the flow kept up through the step: a cast mistimed is never the end of it)
    const keepUp = (then?: (t: number) => void) => (t: number) => { for (const k of P) if (D.flow(k) < 0.3) D.flow(k, 0.3); then?.(t); };
    const step = (say: string, keys: [Action, string][], tick?: (t: number) => void, now?: () => boolean): Step => ({
      id: 'react', s: 13, say, keys, tick: keepUp(tick), now, done: reacted,
      enter: () => { give(); seen = D.powers.rules.seats[h].casts[keys[0]?.[0] === 'power2' ? 1 : 0]; },
    });
    /** the partner's `kind` standing within r (m, along the ground) of the player */
    const near = (kind: string, r: number) => () => {
      const me = this.o.root(h);
      return D.powers.live.some((L) => L.seat === b && L.kind === kind && !L.done && Math.hypot((L.tip ?? L.at)[0] - me[0], (L.tip ?? L.at)[2] - me[2]) < r);
    };
    if (two && (has('fire', 'water') || has('fire', 'ice') || has('water', 'ice'))) {
      const what = has('fire', 'water') ? "Fire in water's wave makes steam that lifts you both" : has('fire', 'ice') ? 'Fire on an ice step melts it' : "Water's whip on an ice step freezes into a bar to swing on";
      return step(`Powers that meet react. ${what}: try it together`, [['power1', 'power 1'], ['power2', 'power 2']]);
    }
    if (has('fire', 'water')) {
      return mine === 'fire'
        ? step('A wave rolls toward you. Flare as it reaches you: the steam lifts you both', [['power1', 'Flare in the wave']], leads(1), near('wave', 1.6))
        : step('Roll a wave at them, and they flare in it: steam', [['power2', 'Wave toward them']], answer(1, 0));
    }
    if (has('fire', 'ice')) {
      return mine === 'fire'
        ? step('An ice step for you. Flare on it, and it melts', [['power1', 'Flare by the ice']], leads(0), near('step', 1.8))
        : step('Set an ice step by them, and their fire melts it', [['power1', 'Step by them']], answer(0, 0));
    }
    if (has('water', 'ice')) {
      return mine === 'water'
        ? step('An ice step for you. Whip it, and the rope freezes into a bar to swing on', [['power1', 'Whip the step']], leads(0), near('step', 6))
        : step('Set an ice step by them, and their whip freezes on it into a bar', [['power1', 'Step by them']], answer(0, 0));
    }
    return { id: 'react', s: 7, say: "When powers meet they react: fire in water's wave makes steam, fire melts ice, water's whip freezes on ice. Try other bodies on the front", keys: [], done: reacted };
  }

  private update(dt: number) {
    const D = this.o.duel;
    if (this.over) return;
    if (!this.on) {
      if (!D.started || D.state.phase !== 'play') return;
      this.begin();
    }
    if (D.state.phase !== 'play') { this.end(); return; }
    this.t += dt; this.stepT += dt;
    const ev = D.events();
    if (this.okT >= 0) {
      this.okT += dt;
      if (this.okT >= OK_S) { this.okT = -1; this.next(); }
      return;
    }
    const S = this.steps[this.i];
    if (!S) { this.end(); return; }
    S.tick?.(this.stepT);
    if (S.done(ev)) { this.root.classList.remove('now'); this.ok(); return; }
    this.root.classList.toggle('now', !!S.now?.());
    // (the keys shown follow the devices: a second player who joins, a pad picked up; the words follow the hold)
    if (this.t - this.keysAt > 0.25) {
      this.keys(S);
      const say = S.alt?.() ?? S.say, el = this.root.querySelector('.dl-say')!;
      if (el.textContent !== say) el.textContent = say;
    }
    if (this.stepT >= S.s || (this.t > LIMIT_S - 4 && S.id !== 'end')) {
      if (this.t > LIMIT_S - 4 && S.id !== 'end') this.i = this.steps.length - 2;
      this.next();
    }
  }

  private begin() {
    this.on = true;
    try { localStorage.setItem(TAUGHT, String(Date.now())); } catch { /* no storage */ }
    this.build();
    this.root.querySelector('.dl-dots')!.innerHTML = this.steps.map(() => '<i></i>').join('');
    const d = this.dev(this.people()[0] ?? 0);
    this.root.querySelector('.dl-skip')!.innerHTML = d === 'pad' ? 'skip <kbd>Start</kbd>' : d === 'touch' ? 'skip' : 'skip <kbd>Esc</kbd>';
    document.body.append(this.root);
    requestAnimationFrame(() => this.root.classList.add('in'));
    this.next();
  }
  private next() {
    this.i++;
    const S = this.steps[this.i];
    if (!S) { this.end(); return; }
    this.stepT = 0;
    const R = this.o.duel.powers.rules;
    this.base = { casts: R.seats.map((s) => [...s.casts]), forms: R.seats.map((s) => s.forms), reacts: Object.values(R.reactions).reduce((a, n) => a + n, 0) };
    S.enter?.();
    this.root.classList.remove('ok');
    this.root.querySelector('.dl-say')!.textContent = S.say;
    this.keys(S);
    this.root.querySelectorAll('.dl-dots i').forEach((d, j) => { d.classList.toggle('done', j < this.i); d.classList.toggle('on', j === this.i); });
    this.root.classList.remove('fresh'); void this.root.offsetWidth; this.root.classList.add('fresh');
  }
  private ok() {
    this.okT = 0;
    this.root.classList.add('ok');
    this.root.querySelector('.dl-say')!.textContent = WELL[this.i % WELL.length];
    this.root.querySelector('.dl-keys')!.innerHTML = '';
  }
  private keys(S: Step) {
    this.keysAt = this.t;
    const P = this.people(), seats = P.length ? P : [this.o.humanSeats[0] ?? 0];
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    const html = S.keys.map(([a, what]) => `<span>${seats.map((k) => `${seats.length > 1 ? `<b>${k + 1}</b>` : ''}<kbd>${esc(KEYS[this.dev(k)][a])}</kbd>`).join(' ')} ${esc(what)}</span>`).join('');
    const box = this.root.querySelector('.dl-keys')!;
    if (box.innerHTML !== html) box.innerHTML = html;
  }
  private end() {
    this.over = true;
    this.root.classList.remove('in');
    setTimeout(() => this.root.remove(), 700);
  }
  /** for probes: where it is */
  get stats() { return { on: this.on, over: this.over, step: this.steps[this.i]?.id ?? null, t: +this.t.toFixed(2), stepT: +this.stepT.toFixed(2) }; }
}

/** the lesson for this duel, or null when it isn't offered */
export function startLesson(o: LessonCtx): Lesson | null {
  if (typeof document === 'undefined' || !o.humanSeats.length || !wantsLesson(o.query, o.film)) return null;
  return new Lesson(o);
}
