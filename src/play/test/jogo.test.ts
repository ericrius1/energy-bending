// The jogo's client loop without a GPU: two Characters (dancer/character.ts) on a test stage, a local Room (the rules in
// the page on a stepped clock), the Jogo between them. Exchanges reported across an attack's active window, perfect
// timing against the room's grid, the whole session flow (intro, play, a fusion and its release, the finale, the
// results, ready again), set pieces round-tripping through the rules (ice, gems, fire; standing on one, shattering,
// melting), travel, the stand-in partner, and a scripted jogo run twice to the same result.
import { Character } from '../../dancer/character';
import { MOVES, tempoScale } from '../../dancer/moves';
import type { StagePlane } from '../../engine/camera';
import { makeIntent, type Intent } from '../../input/intent';
import { RULES, gridError, beatAt, barMs, sessionMs } from '../../../shared/rules.ts';
import type { Session as RulesSession } from '../../../shared/rules.ts';
import { Room } from '../room';
import { Jogo, type Element, type JogoEvent, type SeatBody } from '../jogo';
import { JogoBuilder, Pieces } from '../build';
import { Glows } from '../glow';
import { StandIn } from '../partner';
import { ScriptRunner, type JogoScript } from '../script';
import { test, assert, near, done } from '../../dancer/test/check';

const I = (o: Partial<Intent> = {}): Intent => Object.assign(makeIntent(), o);
const PLANE: StagePlane = { id: 'test', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5, ground: 0, ledges: [], spawns: [[-0.51, 0], [0.51, 0]] };
const DT = 1 / 60;

interface Bench {
  room: Room; jogo: Jogo; chars: [Character, Character]; intents: [Intent, Intent]; els: [Element, Element];
  events: JogoEvent[]; pieces: Pieces; builder: JogoBuilder;
  step(n?: number, fn?: (i: number) => void): void;
  rules(): RulesSession;
  until(pred: () => boolean, max?: number): number;
}

async function bench(els: [Element, Element] = ['fire', 'water']): Promise<Bench> {
  const room = new Room({ mode: 'local', world: 'geode' });
  const chars: [Character, Character] = [new Character({ seat: 0, plane: PLANE }), new Character({ seat: 1, plane: PLANE })];
  const intents: [Intent, Intent] = [I(), I()];
  const bodies: SeatBody[] = chars.map((c, s) => ({
    character: c, root: () => [c.root[0], c.root[1], c.root[2]], chest: () => [c.root[0], c.root[1] + 1.2, c.root[2]],
    intent: () => intents[s], element: () => b.els[s],
  }));
  const builder = new JogoBuilder(bodies, () => room.now(), () => PLANE);
  const jogo = new Jogo(room, bodies, { judge: () => (room.state ? gridError(room.state.music, room.now()) : 999), plane: () => PLANE, builder });
  const pieces = new Pieces({ setIce: null, field: null, glows: new Glows(), world: () => 'geode', now: () => room.now(), send: (s, m) => room.send(s, m) });
  for (const c of chars) c.extraLedges = () => pieces.ledges(c.plane);
  const events: JogoEvent[] = [];
  const b: Bench = {
    room, jogo, chars, intents, els, events, pieces, builder,
    step(n = 1, fn) {
      for (let i = 0; i < n; i++) {
        fn?.(i);
        jogo.clock(DT);
        const m = room.state?.music, beat = m ? beatAt(m, room.now()) : 0;
        chars[0].lookAt = chars[1].root; chars[1].lookAt = chars[0].root;
        chars[0].update(DT, intents[0], { beats: beat, bpm: m?.bpm ?? 112 });
        chars[1].update(DT, intents[1], { beats: beat, bpm: m?.bpm ?? 112 });
        jogo.update();
        const ev = jogo.events.splice(0);
        for (const e of ev) {
          if (e.k === 'set') pieces.lay(e.piece);
          else if (e.k === 'unset' && e.how !== 'melt') pieces.unlay(e.id, e.how === 'shatter');
        }
        events.push(...ev);
        pieces.update(DT, [0, 1].map((s) => ({ seat: s, c: chars[s], el: b.els[s] })));
        // edges last one frame
        for (const it of intents) for (const k of ['jump', 'punch', 'kick', 'spin', 'dodge', 'form', 'interact'] as const) it[k] = false;
      }
    },
    rules: () => (room.session.net as unknown as { session: RulesSession }).session,
    until(pred, max = 60 * 400) { let n = 0; while (!pred() && n < max) { this.step(); n++; } assert(pred(), 'gave up waiting'); return n; },
  };
  await room.connect();
  return b;
}

/** into play, the two dancers placed `gap` apart, standing still a moment */
async function playing(gap = 1.02, els?: [Element, Element]) {
  const b = await bench(els);
  b.until(() => b.room.state?.phase === 'play');
  b.chars[0].reset(-gap / 2); b.chars[1].reset(gap / 2);
  b.step(20);
  b.events.length = 0;
  return b;
}

/** an attack by seat 0 (started now), seat 1 doing `def(t)`; returns the exchange events and when they came (s after
 *  the move started) */
function duel(b: Bench, move: string, def: ((t: number) => Partial<Intent>) | null = null, gap = 1.02) {
  b.chars[0].reset(-gap / 2); b.chars[1].reset(gap / 2); b.step(20);
  b.events.length = 0;
  b.chars[0].startMove(move);
  const t0 = b.room.now(), out: { res: string; at: number; mine: boolean }[] = [];
  for (let i = 0; i < 120; i++) {
    b.step(1, () => { if (def) Object.assign(b.intents[1], I(def(i * DT))); });
    for (const e of b.events.splice(0)) if (e.k === 'xch') out.push({ res: e.res, at: (b.room.now() - t0) / 1000, mine: e.mine });
  }
  Object.assign(b.intents[1], I());
  return out;
}

await (async () => {
  // ---------------------------------------------------------------- exchanges
  {
    const b = await playing();
    const hit = duel(b, 'martelo');
    test('a kick that lands on a stander is reported once, as a hit, by the dancer attacked', () => {
      assert(hit.length === 1, 'reports: ' + JSON.stringify(hit));
      assert(hit[0].res === 'hit' && hit[0].mine, JSON.stringify(hit));
      const st = b.room.state!;
      assert(st.streak === 0 && st.tension === RULES.xch.hit.tension, `streak ${st.streak}, tension ${st.tension}`);
      return `hit at ${hit[0].at.toFixed(3)} s, tension ${st.tension}`;
    });
    b.step(60);
    const dodge = duel(b, 'martelo', (t) => ({ dodge: t < DT, moveY: -1 }));
    test('an esquiva under the kick is a dodge, reported when the active window is over (folded)', () => {
      assert(dodge.length === 1 && dodge[0].res === 'dodge', JSON.stringify(dodge));
      const d = MOVES.martelo, end = d.active![1] * d.dur * tempoScale(112);
      assert(dodge[0].at >= end, `reported at ${dodge[0].at.toFixed(3)} s, the window ends at ${end.toFixed(3)} s`);
      const st = b.room.state!;
      assert(st.streak === 1, 'streak ' + st.streak);
      return `dodge at ${dodge[0].at.toFixed(3)} s (window ends ${end.toFixed(3)} s); streak ${st.streak}, tension ${st.tension}`;
    });
    b.step(60);
    const parry = duel(b, 'bencao', (t) => ({ dodge: t > 0.25 && t < 0.267, dodgeHeld: t > 0.25 }));
    test('a block raised just before the push lands is a parry (reported at once: decisive)', () => {
      assert(parry.length === 1 && parry[0].res === 'parry', JSON.stringify(parry));
      return `parry at ${parry[0].at.toFixed(3)} s, streak ${b.room.state!.streak}`;
    });
    b.room.close();
  }
  {
    const b = await playing(3.2);
    const far = duel(b, 'meia-lua', null, 3.2);
    test('an attack that comes nowhere near is not reported', () => { assert(far.length === 0, JSON.stringify(far)); });
    b.room.close();
  }
  {
    const b = await playing();
    // both attack into each other: the kicks meet
    b.events.length = 0;
    b.chars[0].startMove('meia-lua'); b.chars[1].startMove('meia-lua');
    const res: string[] = [];
    for (let i = 0; i < 90; i++) { b.step(); for (const e of b.events.splice(0)) if (e.k === 'xch') res.push(`${e.by}->${e.target}:${e.res}`); }
    test('two attacks at once: each defender reports the other\'s, and each one is reported once', () => {
      assert(res.length === 2, JSON.stringify(res));
      assert(res.some((r) => r.startsWith('0->1')) && res.some((r) => r.startsWith('1->0')), JSON.stringify(res));
      return res.join(', ');
    });
    b.room.close();
  }

  // ---------------------------------------------------------------- perfect timing
  {
    const b = await playing(3);
    const onLine = () => Math.abs(gridError(b.room.state!.music, b.room.now())) < 9;
    b.until(onLine);
    b.events.length = 0;
    b.chars[0].startMove('meia-lua');
    b.jogo.update();
    const on = b.jogo.events.splice(0).find((e) => e.k === 'move') as Extract<JogoEvent, { k: 'move' }> | undefined;
    b.step(70);
    b.until(() => { const e = gridError(b.room.state!.music, b.room.now()); return e > 95 && e < 115; });
    b.chars[0].startMove('armada');
    b.jogo.update();
    const off = b.jogo.events.splice(0).find((e) => e.k === 'move') as Extract<JogoEvent, { k: 'move' }> | undefined;
    test('a move on an 8th-note line is perfect; 100 ms off is not (RULES.PERFECT_MS)', () => {
      assert(on && on.perfect, 'on the line: ' + JSON.stringify(on));
      assert(off && !off.perfect, 'off the line: ' + JSON.stringify(off));
      // the rules paid the perfect move half as much again
      return `on ${on!.err.toFixed(1)} ms → perfect; off ${off!.err.toFixed(1)} ms → not; flow ${b.room.state!.flow[0]}`;
    });
    b.room.close();
  }

  // ---------------------------------------------------------------- the session's flow
  {
    const b = await bench();
    const phases: string[] = [];
    const log = () => { for (const e of b.events.splice(0)) if (e.k === 'phase') phases.push(e.phase); };
    b.until(() => { log(); return b.room.state?.phase === 'play'; });
    const st0 = b.room.state!;
    test('the room starts in intro and plays from a bar line at least 3 s later', () => {
      const playFrom = st0.sessionEnd! - sessionMs(st0.music), bar = barMs(st0.music);
      const k = (playFrom - st0.music.epoch) / bar;
      near(k, Math.round(k), 1e-6, 'play begins on a bar line');
      assert(playFrom - st0.music.epoch >= RULES.INTRO_MIN_MS, 'intro too short');
      return `phases ${phases.join(' → ')}; play from bar ${Math.round(k)}`;
    });
    // the tension to the top: exchanges (a dodge each), then the last one invites
    b.rules().tension = 95;
    b.chars[0].reset(-0.51); b.chars[1].reset(0.51); b.step(20); b.events.length = 0;
    duel(b, 'martelo', (t) => ({ dodge: t < DT, moveY: -1 }));
    const ready = b.room.state!.mergeReady;
    // both come together and hold merge
    b.chars[0].reset(-0.2); b.chars[1].reset(0.2); b.step(4);
    b.intents[0].merge = b.intents[1].merge = true;
    let fusion: Extract<JogoEvent, { k: 'fusion' }> | null = null;
    b.until(() => { for (const e of b.events.splice(0)) { if (e.k === 'fusion') fusion = e; if (e.k === 'phase') phases.push(e.phase); } return !!fusion; }, 600);
    b.intents[0].merge = b.intents[1].merge = false;
    let release: Extract<JogoEvent, { k: 'release' }> | null = null;
    b.until(() => { for (const e of b.events.splice(0)) { if (e.k === 'release') release = e; if (e.k === 'phase') phases.push(e.phase); } return !!release; }, 60 * 30);
    test('at the top: the invitation, then both holding merge within reach fuses on the next bar line for 8 bars', () => {
      assert(ready, 'mergeReady');
      const f = fusion!, m = b.room.state!.music, bar = barMs(m);
      near((f.t0 - m.epoch) / bar, Math.round((f.t0 - m.epoch) / bar), 1e-6, 'on a bar line');
      near((f.tEnd - f.t0) / bar, RULES.FUSION_BARS, 1e-6, 'eight bars');
      assert(release!.kind === f.kind, 'released the same kind');
      return `fusion ${f.kind} (fire + water), released; phases ${phases.join(' → ')}`;
    });
    b.until(() => { for (const e of b.events.splice(0)) if (e.k === 'phase') phases.push(e.phase); return b.room.state?.phase === 'over'; }, 60 * 200);
    const res = b.room.state!.results!;
    b.intents[0].jump = true; b.step(1); b.intents[1].jump = true; b.step(3);
    for (const e of b.events.splice(0)) if (e.k === 'phase') phases.push(e.phase);
    test('the session plays out: finale, over with results, and both ready starts again', () => {
      assert(phases.includes('finale') && phases.includes('over'), phases.join(','));
      assert(res.fusions >= 1 && res.axe > 0, JSON.stringify(res));
      assert(b.room.state!.phase === 'intro', 'after both ready: ' + b.room.state!.phase);
      return `results ${JSON.stringify(res)}; then ${b.room.state!.phase}`;
    });
    b.room.close();
  }

  // ---------------------------------------------------------------- building
  {
    const b = await playing(3, ['ice', 'water']);
    b.rules().flow[0] = 90;
    b.until(() => Math.abs(gridError(b.room.state!.music, b.room.now())) < 9);
    b.chars[0].startMove('au');
    let set: Extract<JogoEvent, { k: 'set' }> | null = null;
    b.until(() => { for (const e of b.events.splice(0)) if (e.k === 'set') set = e; return !!set; }, 200);
    const piece = set!.piece;
    test('an ice dancer\'s perfect cartwheel at high flow sets an ice bridge through the rules', () => {
      assert(piece.kind === 'ice' && piece.by === 0 && piece.world === 'geode', JSON.stringify(piece));
      const ys = []; for (let i = 1; i < piece.points.length; i += 3) ys.push(piece.points[i] / 1000);
      assert(Math.max(...ys) > 0.9 && ys[0] < 0.4, 'an arch: ' + ys.map((y) => y.toFixed(2)).join(' '));
      assert(b.room.session.pieces.has(piece.id), 'the session holds it');
      assert(b.room.state!.flow[0] < 90, 'flow paid');
      return `${piece.points.length / 3} points, top ${Math.max(...ys).toFixed(2)} m, flow now ${b.room.state!.flow[0]}`;
    });
    b.room.send(1, { t: 'shatter', id: piece.id });
    b.step(2);
    test('a shatter goes through the room and takes it away for everyone', () => {
      assert(!b.room.session.pieces.has(piece.id), 'still there');
      assert(b.events.some((e) => e.k === 'unset' && e.id === piece.id && e.how === 'shatter'), 'no event');
    });
    b.room.close();
  }
  {
    const b = await playing(3, ['gems', 'water']);
    b.rules().flow[0] = 90;
    b.until(() => Math.abs(gridError(b.room.state!.music, b.room.now())) < 9);
    b.builder.arm(0);
    b.intents[0].jump = true; b.intents[0].jumpHeld = true;
    let set: Extract<JogoEvent, { k: 'set' }> | null = null;
    b.until(() => { for (const e of b.events.splice(0)) if (e.k === 'set') set = e; return !!set; }, 200);
    b.intents[0].jumpHeld = false;
    const p = set!.piece;
    b.step(60);
    // seat 1 jumps up onto the crystal ledge from below it
    const sx = p.points[0] / 2000 + p.points[3] / 2000;
    b.chars[1].reset(sx, 0); b.step(5);
    b.step(1, () => { b.intents[1].jump = true; b.intents[1].jumpHeld = true; });
    b.step(70);
    b.intents[1].jumpHeld = false;
    test('a gem dancer\'s stomp on the beat (the build button tapped) grows a crystal ledge another dancer stands on', () => {
      assert(p.kind === 'gems', p.kind);
      const L = b.pieces.ledges(PLANE).find((l) => l.id === `gem.${p.id}`);
      assert(L, 'no ledge');
      assert(b.chars[1].grounded && Math.abs(b.chars[1].y - L!.y) < 1e-6, `standing at ${b.chars[1].y.toFixed(3)} (ledge ${L!.y.toFixed(3)})`);
      return `ledge at ${L!.y.toFixed(2)} m, from ${L!.x0.toFixed(2)} to ${L!.x1.toFixed(2)}; dancer 2 on it`;
    });
    b.room.close();
  }
  {
    const b = await playing(3, ['fire', 'ice']);
    b.rules().flow[0] = 90;
    b.until(() => Math.abs(gridError(b.room.state!.music, b.room.now())) < 9);
    b.chars[0].startMove('spin');
    let set: Extract<JogoEvent, { k: 'set' }> | null = null;
    b.until(() => { for (const e of b.events.splice(0)) if (e.k === 'set') set = e; return !!set; }, 200);
    const p = set!.piece, c: [number, number, number] = [p.points[0] / 1000, p.points[1] / 1000, p.points[2] / 1000];
    b.step(40);
    const up = b.pieces.updraftAt(c), outside = b.pieces.updraftAt([c[0] + 2, c[1], c[2]]);
    // the ice dancer walks into the ring: water and ice douse fire
    b.chars[1].reset(c[0] + 0.1);
    let melt = false;
    b.until(() => { for (const e of b.events.splice(0)) if (e.k === 'unset' && e.how === 'melt' && e.id === p.id) melt = true; return melt; }, 60);
    test('a fire dancer\'s perfect spin sets a ring of flame that lifts whoever is in it, doused by ice', () => {
      assert(p.kind === 'fire', p.kind);
      assert(up > 0.5 && outside === 0, `updraft in ${up.toFixed(2)}, outside ${outside}`);
      assert(melt, 'not doused');
      return `updraft at its middle ${up.toFixed(2)}; doused when the ice dancer stepped in`;
    });
    b.room.close();
  }

  // ---------------------------------------------------------------- travel
  {
    const b = await playing(3);
    b.room.send(0, { t: 'travel', world: 'pool', portal: 'pool.to-geode' });
    b.step(2);
    const tr = b.events.find((e) => e.k === 'travel') as Extract<JogoEvent, { k: 'travel' }> | undefined;
    const flow0 = b.room.state!.flow[0];
    b.jogo.paused = true;
    b.chars[0].startMove('meia-lua');
    b.step(30);
    const paused = b.room.state!.flow[0] === flow0;
    b.jogo.paused = false;
    test('travel moves the jogo\'s world; while paused nothing goes to the rules', () => {
      assert(tr && tr.world === 'pool' && tr.by === 0, JSON.stringify(tr));
      assert(b.room.state!.world === 'pool', 'world ' + b.room.state!.world);
      assert(paused, 'a move was scored while paused');
      return `world ${b.room.state!.world}`;
    });
    b.room.close();
  }

  // ---------------------------------------------------------------- the stand-in partner
  {
    const b = await playing(1.2);
    const brain = new StandIn();
    let moves1 = 0, xch = 0;
    for (let i = 0; i < 60 * 40; i++) {
      const m = b.room.state!.music;
      Object.assign(b.intents[1], brain.think({ dt: DT, beat: { beats: beatAt(m, b.room.now()), bpm: m.bpm }, me: b.chars[1], them: { root: b.chars[0].root, move: b.chars[0].move?.name ?? null, moveT: b.chars[0].move?.t ?? 0, character: b.chars[0] }, state: b.room.state, seat: 1, plane: PLANE }));
      // dancer 1 kicks on every second bar's downbeat
      if (i % 240 === 120) b.chars[0].startMove('meia-lua');
      b.step();
      for (const e of b.events.splice(0)) { if (e.k === 'move' && e.seat === 1) moves1++; if (e.k === 'xch' && e.mine) xch++; }
    }
    test('the stand-in partner dances a jogo: moves of its own, and the kicks at it answered', () => {
      assert(moves1 > 5, 'its moves ' + moves1);
      assert(xch >= 3, 'exchanges ' + xch);
      return `${moves1} moves of its own, ${xch} exchanges, tension ${b.room.state!.tension}, streak ${b.room.state!.streak}`;
    });
    b.room.close();
  }

  // ---------------------------------------------------------------- a script, twice
  const script: JogoScript = {
    cues: [
      { at: 0, seat: 0, place: -0.51 }, { at: 0, seat: 1, place: 0.51 },
      { at: 1, seat: 0, move: 'martelo' },
      { at: 3, seat: 0, move: 'martelo' }, { at: 3, seat: 1, press: 'dodge', hold: { moveY: -1 }, for: 0.5 },
      { at: 5, seat: 1, move: 'meia-lua' },
      { at: 7, seat: 0, move: 'meia-lua' }, { at: 7, seat: 1, move: 'meia-lua' },
      { at: 9, seat: 1, goto: -0.2 },
    ],
  };
  const runOnce = async () => {
    const b = await bench();
    let from: number | null = null;
    const ctl = b.chars.map((c) => ({ character: c, script: { set: (p: Partial<Intent> | null) => { const it = b.intents[b.chars.indexOf(c)]; if (p) for (const [k, v] of Object.entries(p)) (it as unknown as Record<string, unknown>)[k] = v ?? (typeof (makeIntent() as unknown as Record<string, unknown>)[k] === 'boolean' ? false : 0); } }, move: (n: string) => c.startMove(n) }));
    const r = new ScriptRunner(script, {
      controllers: () => ctl as never, beat: () => (from == null ? null : ((b.room.now() - from) * b.room.state!.music.bpm) / 60000), arm: () => {}, plane: () => PLANE,
    });
    const log: string[] = [];
    for (let i = 0; i < 60 * 14; i++) {
      const st = b.room.state;
      if (st?.phase === 'play' && from == null) from = st.sessionEnd! - sessionMs(st.music);
      r.update();
      b.step();
      for (const e of b.events.splice(0)) if (e.k === 'xch' || e.k === 'move' || e.k === 'echo' || e.k === 'unison') log.push(`${i}:${e.k}:${'res' in e ? e.res : 'move' in e ? e.move : ''}`);
    }
    const out = { log, x: b.chars.map((c) => +c.x.toFixed(6)), tension: b.room.state!.tension, fired: r.fired };
    b.room.close();
    return out;
  };
  const r1 = await runOnce(), r2 = await runOnce();
  test('a scripted jogo stepped twice gives the same moves, exchanges and positions', () => {
    assert(JSON.stringify(r1) === JSON.stringify(r2), `differ:\n${JSON.stringify(r1)}\n${JSON.stringify(r2)}`);
    assert(r1.fired === script.cues.length, 'cues fired ' + r1.fired);
    assert(r1.log.some((l) => l.includes(':xch:')), 'no exchange in ' + r1.log.join(' '));
    return `${r1.log.length} events (${r1.log.filter((l) => l.includes('xch')).map((l) => l.split(':')[2]).join(', ')}), tension ${r1.tension}`;
  });

  done();
})();
