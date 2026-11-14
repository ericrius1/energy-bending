// The duel's Node playtest, printed: many seeded rounds of two virtual players through the real bodies and the duel's
// rules (sim.ts), free in 3D and locked to the stage plane, and what a player would feel in them: how long a KO takes,
// hits per KO, how long a round is, which moves get used, wall jumps a minute, time in the air, the flow dancing built.
// Run by scripts/duel-sim.mjs (bundled with esbuild):
//   node scripts/duel-sim.mjs [--world temple,forge] [--view free,locked] [--rounds 8] [--styles mix|aggressive,evasive]
//                             [--skills 0.7,0.7] [--seed 1] [--json out.json] [-v]
import { simulateDuel, nodeArena, makeBrains, type DuelSimResult } from './sim';
import { DUEL_STYLES, type DuelStyle } from '../ai/duel-brain';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const worlds = arg('world', 'temple,forge').split(',');
const views = arg('view', 'free,locked').split(',');
const rounds = Number(arg('rounds', '8'));
const seed0 = Number(arg('seed', '1'));
const styleArg = arg('styles', 'mix');
const skills = arg('skills', '0.7,0.7').split(',').map(Number) as [number, number];
const verbose = argv.includes('-v');
const jsonOut = arg('json', '');

const pairs: [DuelStyle, DuelStyle][] = styleArg === 'mix'
  ? [['aggressive', 'aggressive'], ['aggressive', 'evasive'], ['showy', 'aggressive'], ['evasive', 'showy']]
  : [styleArg.split(',') as [DuelStyle, DuelStyle]];
for (const p of pairs) for (const s of p) if (!DUEL_STYLES.includes(s)) throw new Error(`no style ${s}`);

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
const pct = (x: number[], q: number) => { if (!x.length) return NaN; const s = [...x].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-');

const report: Record<string, unknown>[] = [];
for (const world of worlds) for (const view of views) {
  const { arena, world: W } = nodeArena(world);
  for (const pair of pairs) {
    const all: DuelSimResult[] = [];
    for (let r = 0; r < rounds; r++) {
      const seed = seed0 + r * 101;
      const res = simulateDuel({ arena, world: W, locked: view === 'locked', brains: makeBrains(pair, skills, [seed, seed + 7]), rounds: 1, seconds: 400 });
      all.push(res);
      if (verbose) {
        const R = res.rounds[0];
        console.log(`  ${world} ${pair.join(' v ')} seed ${seed}: ${R ? `seat ${R.winner} won ${R.kos.join('-')} in ${f1(R.ms / 1000)} s` : `unfinished at ${f1(res.seconds)} s`}, hits ${res.stats.hits} (perfect ${res.stats.perfect}), falls ${res.stats.falls}, clashes ${res.stats.clashes}, blocks ${res.stats.blocks}, dodges ${res.stats.dodges}`);
      }
    }
    const roundLen = all.flatMap((r) => r.rounds.map((x) => x.ms / 1000));
    const ko = all.flatMap((r) => r.koTimes), hpk = all.flatMap((r) => r.hitsPerKo);
    const secs = all.reduce((a, r) => a + r.seconds, 0);
    const moves: Record<string, number> = {};
    let wall = 0, air = 0, airJ = 0, jumps = 0, hits = 0, perfect = 0, falls = 0, kos = 0, flips = 0;
    const flowEnd: number[] = [], flowMax: number[] = [], spread = all.flatMap((r) => r.spread);
    const brain: Record<string, number> = {};
    const wins = [0, 0];
    for (const r of all) {
      for (const x of r.rounds) wins[x.winner]++;
      for (const s of r.seats) {
        for (const [k, v] of Object.entries(s.moves)) moves[k] = (moves[k] ?? 0) + v;
        for (const [k, v] of Object.entries(s.brain)) brain[k] = (brain[k] ?? 0) + v;
        flowEnd.push(s.flow); flowMax.push(s.flowMax); flips += s.flips;
        wall += s.wallJumps; air += s.airTime; airJ += s.airJumps; jumps += s.jumps; hits += s.hits; perfect += s.perfect; falls += s.falls; kos += s.kos;
      }
    }
    const playerMin = (secs * 2) / 60;
    const line = {
      world, view, styles: pair.join(' v '), skills: skills.join(','), rounds: all.length, finished: roundLen.length, wins,
      roundS: { mean: mean(roundLen), p10: pct(roundLen, 0.1), p90: pct(roundLen, 0.9) },
      koS: { mean: mean(ko), p50: pct(ko, 0.5), p90: pct(ko, 0.9) }, hitsPerKo: mean(hpk), kos, falls,
      hitsPerMin: hits / playerMin, perfectShare: hits ? perfect / hits : 0,
      wallJumpsPerMin: wall / playerMin, flipsPerMin: flips / playerMin, flowEnd: mean(flowEnd), flowMax: mean(flowMax), spread: { p50: pct(spread, 0.5), p90: pct(spread, 0.9) }, airJumpsPerMin: airJ / playerMin, jumpsPerMin: jumps / playerMin, airShare: air / (secs * 2),
      movesPerMin: Object.fromEntries(Object.entries(moves).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / playerMin).toFixed(1)])),
      brain,
    };
    report.push(line);
    console.log(`\n${world}: ${line.styles} (skill ${line.skills}), ${line.rounds} rounds (${line.finished} finished), wins ${wins.join('-')}`);
    console.log(`  round ${f1(line.roundS.mean)} s (p10 ${f1(line.roundS.p10)}, p90 ${f1(line.roundS.p90)}); KO every ${f1(line.koS.mean)} s (median ${f1(line.koS.p50)}, p90 ${f1(line.koS.p90)}); ${f2(line.hitsPerKo)} hits per KO; ${kos} KOs, ${falls} by falling`);
    console.log(`  per player-minute: ${f1(line.hitsPerMin)} hits (${(line.perfectShare * 100).toFixed(0)}% perfect), ${f1(line.jumpsPerMin)} jumps, ${f1(line.airJumpsPerMin)} air jumps, ${f1(line.wallJumpsPerMin)} wall jumps, ${f1(line.flipsPerMin)} flips; ${(line.airShare * 100).toFixed(0)}% of the time in the air; apart ${f1(line.spread.p50)} m (p90 ${f1(line.spread.p90)}); flow at the end ${f1(line.flowEnd)} (most ${f1(line.flowMax)})`);
    console.log(`  moves a minute: ${Object.entries(line.movesPerMin).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (verbose) console.log(`  brain: ${Object.entries(brain).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
}
if (jsonOut) { const fs = await import('node:fs'); fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1)); console.log(`\nwrote ${jsonOut}`); }
