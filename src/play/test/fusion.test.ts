// The fusion as one body, in Node: the Pool script (the critic's form presses too) against the real rules, two
// Characters on a flat stage, and the jogo's own Fusion (src/play/fusion.ts) pulling them together. During the eight
// bars both dance moves that travel (spins, two macacos: 1.4 m back each); the pull wins over that travel (the move
// plays where it starts) and over the stick's walking, so the two roots stay about PULL_TO apart from a second after
// the landing to the release. `FUSION_VERBOSE=1 node scripts/test-ts.mjs fusion.test` prints the distance over time.
import { Character } from '../../dancer/character';
import type { StagePlane } from '../../engine/camera';
import { makeIntent, type Intent } from '../../input/intent';
import { RULES, beatAt } from '../../../shared/rules.ts';
import { Room } from '../room';
import { Jogo, type Element, type SeatBody } from '../jogo';
import { JogoBuilder } from '../build';
import { ScriptRunner, type JogoScript } from '../script';
import { Fusion } from '../fusion';
import { jogoParams } from '../params';
import { test, assert, done } from '../../dancer/test/check';
import pool from '../scripts/pool-fire-water.json';

const DT = 1 / 60;
const PLANE: StagePlane = { id: 'test', origin: [0, 0, 0], right: [1, 0, 0], halfWidth: 5.75, ground: 0, ledges: [], spawns: [[-2.45, 0], [2.45, 0]] };

function controller(c: Character, it: Intent) {
  return {
    character: c,
    script: { set: (p: Partial<Intent> | null) => { if (!p) return; for (const [k, v] of Object.entries(p)) (it as unknown as Record<string, unknown>)[k] = v ?? (typeof (makeIntent() as unknown as Record<string, unknown>)[k] === 'boolean' ? false : 0); } },
    move: (n: string) => c.startMove(n),
  };
}

interface Sample { t: number; d: number; moves: string }

/** the script with extra cues, run for `seconds`: the roots' distance each tenth of a second while a fusion lands,
 *  holds and lets go, and when those happened (room ms) */
async function run(s: JogoScript, seconds: number) {
  const room = new Room({ mode: 'local', world: s.world ?? 'pool' });
  const chars = [new Character({ seat: 0, plane: PLANE }), new Character({ seat: 1, plane: PLANE })];
  const intents = [makeIntent(), makeIntent()];
  const bodies: SeatBody[] = chars.map((c, k) => ({ character: c, root: () => [c.root[0], c.root[1], c.root[2]], chest: () => [c.root[0], 1.2, c.root[2]], intent: () => intents[k], element: (): Element => (k ? 'water' : 'fire') }));
  const builder = new JogoBuilder(bodies, () => room.now(), () => PLANE);
  const jogo = new Jogo(room, bodies, { judge: () => 0, plane: () => PLANE, builder });
  let frame = 0;
  const fusion = new Fusion(bodies, {
    glows: { dot() {}, seg() {} } as never, rig: { framePad: 0, follow: null } as never, dancer: () => null,
    now: () => room.now(), frame: () => frame,
  });
  let from: number | null = null;
  const runner = new ScriptRunner(s, {
    controllers: () => chars.map((c, k) => controller(c, intents[k])) as never,
    beat: () => (from == null ? null : ((room.now() - from) * RULES.BPM) / 60000), arm: (k) => builder.arm(k), plane: () => PLANE,
    setTension: (v) => { (room.session.net as unknown as { session: { tension: number } }).session.tension = v; },
  });
  await room.connect();
  const samples: Sample[] = [];
  let t0: number | null = null, tEnd: number | null = null, released: number | null = null, kind = '';
  for (let i = 0; i < seconds * 60; i++, frame++) {
    const st = room.state;
    if (st?.phase === 'play' && from == null) from = st.sessionEnd! - RULES.SESSION_MS;
    runner.update();
    jogo.clock(DT);
    const m = room.state!.music, beat = beatAt(m, room.now());
    chars[0].lookAt = chars[1].root; chars[1].lookAt = chars[0].root;
    for (let k = 0; k < 2; k++) chars[k].update(DT, intents[k], { beats: beat, bpm: m.bpm });
    jogo.update();
    for (const it of intents) for (const k of ['jump', 'punch', 'kick', 'spin', 'dodge', 'form', 'interact'] as const) it[k] = false;
    for (const e of jogo.events.splice(0)) {
      fusion.event(e);
      if (e.k === 'fusion') { t0 = e.t0; tEnd = e.tEnd; kind = e.kind; }
      if (e.k === 'release') released = room.now();
      if (e.k === 'xch' && e.res === 'hit') {
        const c = chars[e.target], o = chars[e.by], sgn = Math.sign(c.root[0] - o.root[0]) || 1;
        c.applyKnock(sgn * jogoParams.knock, jogoParams.knockUp, jogoParams.stagger, 0);
      }
    }
    fusion.update(DT);
    if (i % 6 === 0 && t0 != null) samples.push({ t: room.now(), d: Math.abs(chars[1].root[0] - chars[0].root[0]), moves: chars.map((c) => c.move?.name ?? '-').join('/') });
  }
  room.close();
  return { samples, t0, tEnd, released, kind };
}

await (async () => {
  // the critic's prism: seat 1's form pressed at beat 27.5 (as the integration's captures do)
  const s = { ...(pool as JogoScript), cues: [...(pool as JogoScript).cues, { at: 27.5, seat: 1, press: 'form' }] } as JogoScript;
  const r = await run(s, 75);
  const verbose = typeof process !== 'undefined' && !!process.env.FUSION_VERBOSE;
  if (verbose) console.log(r.samples.filter((_x, i) => i % 3 === 0).map((x) => `${((x.t - (r.t0 ?? 0)) / 1000).toFixed(1)}s ${x.d.toFixed(2)} ${x.moves}`).join('\n'));
  test('the pool script fuses and lets go', () => {
    assert(r.t0 != null && r.released != null, `fusion ${r.t0} release ${r.released}`);
    return `${r.kind}, ${((r.released! - r.t0!) / 1000).toFixed(1)} s`;
  });
  test('the pair stays one body from a second after the landing to the release, through spins and two macacos', () => {
    const mid = r.samples.filter((x) => x.t > r.t0! + 1000 && x.t < r.released! - 50);
    assert(mid.length > 50, `samples ${mid.length}`);
    const worst = mid.reduce((a, x) => (x.d > a.d ? x : a), mid[0]);
    const mean = mid.reduce((a, x) => a + x.d, 0) / mid.length;
    const moved = new Set(mid.flatMap((x) => x.moves.split('/')).filter((m) => m !== '-'));
    assert(moved.has('macaco'), 'no macaco mid-fusion: ' + [...moved].join(','));
    assert(worst.d < 0.45, `apart ${worst.d.toFixed(2)} m at ${((worst.t - r.t0!) / 1000).toFixed(1)} s (${worst.moves})`);
    return `mean ${mean.toFixed(2)} m, most ${worst.d.toFixed(2)} m; moves ${[...moved].join(', ')}`;
  });
  test('after the release they part', () => {
    const after = r.samples.filter((x) => x.t > r.released! + 1500);
    assert(after.length && after[after.length - 1].d > 0.6, `apart ${after[after.length - 1]?.d.toFixed(2)}`);
    return `${after[after.length - 1].d.toFixed(2)} m`;
  });
  done();
})();

declare const process: { env: Record<string, string | undefined> } | undefined;
