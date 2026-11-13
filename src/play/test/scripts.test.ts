// Every scripted jogo shipped in src/play/scripts, run in Node against the real rules (a local Room) with two
// Characters on a flat stage, the hit's knock as the feel gives it: what exchanges each script makes, how the tension
// climbs, and that it reaches its fusion and release. The films (scripts/steps/jogo-*.json) are these scripts on the GPU;
// this is how a script is written without waiting for one.
import { Character } from '../../dancer/character';
import type { StagePlane } from '../../engine/camera';
import { makeIntent, type Intent } from '../../input/intent';
import { RULES, beatAt } from '../../../shared/rules.ts';
import { Room } from '../room';
import { Jogo, type Element, type JogoEvent, type SeatBody } from '../jogo';
import { JogoBuilder } from '../build';
import { ScriptRunner, type JogoScript } from '../script';
import { jogoParams } from '../params';
import { test, assert, done } from '../../dancer/test/check';
import pool from '../scripts/pool-fire-water.json';
import geode from '../scripts/geode-fire-water.json';
import bridge from '../scripts/geode-ice-bridge.json';

const DT = 1 / 60;
const PLANE: StagePlane = { id: 'test', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: [], spawns: [[-2.45, 0], [2.45, 0]] };
const ELS: Record<string, Element> = { fire: 'fire', water: 'water', ice: 'ice', plasma: 'plasma', gems: 'gems' };

/** an IntentController's script surface over a bare Intent (IntentScript: held fields stay, edges fire once) */
function controller(c: Character, it: Intent) {
  return {
    character: c,
    script: { set: (p: Partial<Intent> | null) => { if (!p) return; for (const [k, v] of Object.entries(p)) (it as unknown as Record<string, unknown>)[k] = v ?? (typeof (makeIntent() as unknown as Record<string, unknown>)[k] === 'boolean' ? false : 0); } },
    move: (n: string) => c.startMove(n),
  };
}

async function run(s: JogoScript, seconds = 60) {
  const room = new Room({ mode: 'local', world: s.world ?? 'geode' });
  const chars = [new Character({ seat: 0, plane: PLANE }), new Character({ seat: 1, plane: PLANE })];
  const intents = [makeIntent(), makeIntent()];
  const forms = [0, 0];
  const el = (seat: number): Element => {
    const base = ELS[s.dress?.[seat] ?? (seat ? 'water' : 'fire')] ?? 'gems';
    return forms[seat] > 0.5 ? (base === 'fire' ? 'plasma' : base === 'water' ? 'ice' : base) : base;
  };
  const bodies: SeatBody[] = chars.map((c, k) => ({ character: c, root: () => [c.root[0], c.root[1], c.root[2]], chest: () => [c.root[0], 1.2, c.root[2]], intent: () => intents[k], element: () => el(k) }));
  const builder = new JogoBuilder(bodies, () => room.now(), () => PLANE);
  const jogo = new Jogo(room, bodies, { judge: () => 0, plane: () => PLANE, builder });
  let from: number | null = null;
  const runner = new ScriptRunner(s, {
    controllers: () => chars.map((c, k) => controller(c, intents[k])) as never,
    beat: () => (from == null ? null : ((room.now() - from) * RULES.BPM) / 60000), arm: (k) => builder.arm(k), plane: () => PLANE,
    setTension: (v) => { (room.session.net as unknown as { session: { tension: number } }).session.tension = v; },
  });
  await room.connect();
  const log: { beat: number; e: JogoEvent }[] = [];
  const tension: [number, number][] = [];
  for (let i = 0; i < seconds * 60; i++) {
    const st = room.state;
    if (st?.phase === 'play' && from == null) from = st.sessionEnd! - RULES.SESSION_MS;
    if (st?.phase === 'intro' && i > 0 && from == null) { /* the intro: the dancers re-form at their spawns */ }
    runner.update();
    jogo.clock(DT);
    const m = room.state!.music, beat = beatAt(m, room.now());
    chars[0].lookAt = chars[1].root; chars[1].lookAt = chars[0].root;
    for (let k = 0; k < 2; k++) chars[k].update(DT, intents[k], { beats: beat, bpm: m.bpm });
    jogo.update();
    for (const it of intents) for (const k of ['jump', 'punch', 'kick', 'spin', 'dodge', 'form', 'interact'] as const) it[k] = false;
    const b = from == null ? -1 : ((room.now() - from) * RULES.BPM) / 60000;
    for (const e of jogo.events.splice(0)) {
      log.push({ beat: b, e });
      // the feel's knock on a hit
      if (e.k === 'xch' && e.res === 'hit') {
        const c = chars[e.target], o = chars[e.by], sgn = Math.sign(c.root[0] - o.root[0]) || 1;
        c.applyKnock(sgn * jogoParams.knock, jogoParams.knockUp, jogoParams.stagger, 0);
      }
    }
    for (let k = 0; k < 2; k++) forms[k] += (room.state!.form[k] - forms[k]) * Math.min(1, DT / jogoParams.formEase);
    if (i % 30 === 0 && b >= 0) tension.push([+b.toFixed(1), room.state!.tension]);
  }
  room.close();
  return { log, tension, fired: runner.fired, cues: runner.cues.length };
}

const fmt = (l: { beat: number; e: JogoEvent }) => {
  const e = l.e, b = l.beat.toFixed(1);
  if (e.k === 'xch') return `${b} ${e.by}→${e.target} ${e.res}`;
  if (e.k === 'echo' || e.k === 'unison') return `${b} ${e.k} ${e.move}`;
  if (e.k === 'fusion') return `${b} FUSION ${e.kind}`;
  if (e.k === 'release') return `${b} release`;
  if (e.k === 'mergeReady') return `${b} invitation`;
  if (e.k === 'set') return `${b} set ${e.piece.kind}`;
  if (e.k === 'form') return `${b} form ${e.seat} ${e.on ? 'on' : 'off'}`;
  return '';
};
const verbose = typeof process !== 'undefined' && !!process.env.SCRIPTS_VERBOSE;

await (async () => {
  for (const [name, s, wantKind] of [['pool-fire-water', pool, 'steam'], ['geode-fire-water', geode, 'prism']] as [string, JogoScript, string][]) {
    const r = await run(s, 50);
    const lines = r.log.map(fmt).filter(Boolean);
    if (verbose) console.log(`${name}:\n  ${lines.join('\n  ')}\n  tension ${r.tension.map((t) => t.join(':')).join(' ')}`);
    test(`${name}: every cue fires; dodges, a clash, a hit, an echo; the invitation, a ${wantKind} fusion and its release`, () => {
      assert(r.fired === r.cues, `cues ${r.fired}/${r.cues}`);
      const x = r.log.map((l) => l.e).filter((e) => e.k === 'xch') as Extract<JogoEvent, { k: 'xch' }>[];
      const has = (res: string) => x.some((e) => e.res === res);
      assert(has('dodge') && has('hit') && (has('clash') || has('parry')), 'exchanges: ' + x.map((e) => e.res).join(','));
      assert(r.log.some((l) => l.e.k === 'echo' || l.e.k === 'unison'), 'no echo');
      assert(r.log.some((l) => l.e.k === 'mergeReady'), 'no invitation');
      const f = r.log.find((l) => l.e.k === 'fusion');
      assert(f && (f.e as { kind: string }).kind === wantKind, 'fusion: ' + JSON.stringify(f?.e));
      assert(r.log.some((l) => l.e.k === 'release'), 'no release');
      return lines.join('; ');
    });
  }
  {
    const r = await run(bridge as JogoScript, 30);
    const set = r.log.find((l) => l.e.k === 'set');
    test('geode-ice-bridge: the cartwheel lays a bridge', () => {
      assert(set && (set.e as Extract<JogoEvent, { k: 'set' }>).piece.kind === 'ice', r.log.map(fmt).filter(Boolean).join('; '));
      return fmt(set!);
    });
  }
  done();
})();
