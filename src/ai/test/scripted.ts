// Scripted "humans" for the brains' tests (they are brains too, the dumbest kind): one that only attacks, one that
// stands still, one that repeats a move every bar; and `summary`, the numbers a simulated jogo is reported by.
import { MOVES } from '../../dancer/moves';
import { newHints, type Brain, type Sight } from '../brain';
import { Mind } from '../mind';
import { jogoAxis, keepDistance } from '../behaviours';
import { nextEighth, startBeat } from '../body';
import type { JogoStats } from '../jogo';

/** attacks every `every` beats, whatever happens, from wherever it stands (closing in to kicking range first) */
export class AttackerBrain implements Brain {
  readonly name = 'script.attacker';
  readonly body = newHints();
  private m: Mind;
  private next = 4;
  constructor(seed = 5, private every = 2, private list = ['meia-lua', 'armada', 'martelo', 'bencao', 'rasteira']) { this.m = new Mind(seed); }
  think(s: Sight) {
    const o = s.partner!, m = this.m, ax = jogoAxis(s, o);
    if (s.beat >= this.next && !m.waiting(0)) {
      const name = m.rng.pick(this.list);
      m.plan({ move: name, line: nextEighth(startBeat(s.beatPrev, s.beat)), late: 0.5, toward: [ax.dir[0], ax.dir[1]], prio: 1, why: 'attack' });
      this.next = s.beat + this.every;
    }
    keepDistance(s, m, o, 1.5, 0);
    return m.act(s, this.body);
  }
}

/** stands in ginga where it is and never presses anything */
export class StillBrain implements Brain {
  readonly name = 'script.still';
  readonly body = newHints();
  private m = new Mind(1);
  think(s: Sight) { return this.m.act(s, this.body); }
}

/** the same move on every bar line (a pattern to join) */
export class PatternBrain implements Brain {
  readonly name = 'script.pattern';
  readonly body = newHints();
  private m = new Mind(3);
  private bar = -1;
  constructor(private move = 'spin') {}
  think(s: Sight) {
    const m = this.m, line = Math.ceil(startBeat(s.beatPrev, s.beat) / 4) * 4;
    if (line !== this.bar && line - s.beat < 1) { this.bar = line; m.plan({ move: this.move, line, late: 0.2, toward: [0, 1], prio: 1, why: 'pattern' }); }
    keepDistance(s, m, s.partner!, 2.4, 0);
    return m.act(s, this.body);
  }
}

const n = (r: Record<string, number>, k: string) => r[k] ?? 0;
/** the numbers a jogo is judged by */
export function summary(S: JogoStats) {
  const all = (k: string) => n(S.xch[0], k) + n(S.xch[1], k);
  const within = S.errors.filter((e) => e <= 55).length / Math.max(1, S.errors.length);
  const lines = [
    `moves ${S.moves[0]} / ${S.moves[1]}, distinct ${S.distinct[0].size} / ${S.distinct[1].size}, on the 8ths (±55 ms) ${(within * 100).toFixed(0)}%`,
    `exchanges: dodge ${all('dodge')}, clash ${all('clash')}, parry ${all('parry')}, near ${all('near')}, hit ${all('hit')}  (attacked seat 0: ${JSON.stringify(S.xch[0])}, seat 1: ${JSON.stringify(S.xch[1])})`,
    `echo ${S.echoes}, unison ${S.unisons}, mergeReady ${S.mergeReady}, fusions ${S.fusions}, tension max ${S.tensionMax.toFixed(0)}, longest gap ${S.maxGap.toFixed(1)} s, refused (unscored) ${S.refused}`,
    `seat 0: ${fmt(S.names[0])}`, `seat 1: ${fmt(S.names[1])}`,
  ];
  return lines.join('\n');
}
const fmt = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
export const known = (name: string) => !!MOVES[name];
