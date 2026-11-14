// The duel's Node playtest, printed: many seeded sets of two virtual players dancing the battle through the real bodies,
// the contact physics and the rules (sim.ts), free in 3D and locked to the stage plane, and what a player would feel in
// them: combos a minute and the longest, catches (out of the air too), swings, flings, lifts, vaults, counters, time in
// the air, falls, style, the shared energy's peak, merges. Run by scripts/duel-sim.mjs (bundled with esbuild):
//   node scripts/duel-sim.mjs [--world temple,geode,pool] [--view free,locked] [--sets 6] [--styles mix|lead,flyer]
//                             [--skills 0.7,0.7] [--set-s 60] [--seed 1] [--json out.json] [-v]
import { simulateDuel, nodeArena, makeBrains, type DuelSimResult } from './sim';
import { DUEL_STYLES, STYLE_ALIAS, type DuelStyle } from '../ai/duel-brain';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const worlds = arg('world', 'temple,geode,pool').split(',');
const views = arg('view', 'free,locked').split(',');
const sets = Number(arg('sets', arg('rounds', '6')));
const setMs = Number(arg('set-s', '60')) * 1000;
const seed0 = Number(arg('seed', '1'));
const styleArg = arg('styles', 'mix');
const skills = arg('skills', '0.7,0.7').split(',').map(Number) as [number, number];
const verbose = argv.includes('-v');
const jsonOut = arg('json', '');
// (the weight of contact's time warp: holds on a catch, a beat slowed on a pair tier, as the page plays it; --warp off
// for the bodies' plain time)
const warp = arg('warp', 'on') !== 'off';

const pairs: [DuelStyle, DuelStyle][] = styleArg === 'mix'
  ? [['lead', 'flyer'], ['base', 'flyer'], ['lead', 'lead'], ['flyer', 'base']]
  : [styleArg.split(',').map((s) => STYLE_ALIAS[s] ?? s) as [DuelStyle, DuelStyle]];
for (const p of pairs) for (const s of p) if (!DUEL_STYLES.includes(s)) throw new Error(`no style ${s}`);

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const KINDS = ['catch', 'aerial', 'swing', 'fling', 'flown', 'lift', 'vault', 'counter', 'walljump', 'wallrun', 'dash', 'flip', 'kick', 'au'];

const report: Record<string, unknown>[] = [];
for (const world of worlds) for (const view of views) {
  const { arena, world: W } = nodeArena(world);
  for (const pair of pairs) {
    const all: DuelSimResult[] = [];
    for (let r = 0; r < sets; r++) {
      const seed = seed0 + r * 101;
      const res = simulateDuel({ arena, world: W, locked: view === 'locked', brains: makeBrains(pair, skills, [seed, seed + 7]), sets: 1, setMs, seconds: setMs / 1000 + 30, warp });
      all.push(res);
      if (verbose) {
        const S = res.sets[0];
        console.log(`  ${world} ${view} ${pair.join(' & ')} seed ${seed}: ${S ? `seat ${S.winner} won ${S.style.join('-')}, peak ${S.peak.toFixed(2)}${S.fused ? ' (fused)' : ''}` : 'unfinished'}; ${JSON.stringify(res.stats)}`);
        console.log(`    brains: ${res.seats.map((x) => JSON.stringify(x.brain)).join(' || ')}`);
      }
    }
    const play = all.reduce((a, r) => a + r.play, 0), playerMin = (play * 2) / 60, min = play / 60;
    const links: Record<string, number> = {};
    let combos = 0, comboLinks = 0, longest = 0, air = 0, falls = 0;
    const wins = [0, 0], styles: number[] = [];
    for (const r of all) {
      for (const x of r.sets) { wins[x.winner]++; styles.push(...x.style); }
      for (const s of r.seats) {
        for (const [k, v] of Object.entries(s.links)) links[k] = (links[k] ?? 0) + v;
        combos += s.combos; comboLinks += s.comboLinks; longest = Math.max(longest, s.longest); air += s.airTime; falls += s.falls;
      }
    }
    const holds = all.flatMap((r) => r.holds);
    const ends: Record<string, number> = {};
    for (const r of all) for (const [k, v] of Object.entries(r.ends)) ends[k] = (ends[k] ?? 0) + v;
    const peaks = all.flatMap((r) => r.sets.map((x) => x.peak)), fused = all.reduce((a, r) => a + r.sets.filter((x) => x.fused).length, 0);
    const merges = all.reduce((a, r) => a + r.stats.merges, 0);
    // the pacing: each set's first MERGE (s into its play; none: past the set), the combos' lengths, the pops
    const firsts = all.map((r) => r.merges[0]?.[0] ?? null), hit = firsts.filter((x): x is number => x != null);
    const lens = all.flatMap((r) => r.combos).sort((a, b) => b - a);
    const popsMax = Math.max(...all.map((r) => r.pops.max)), popUpdates = all.reduce((a, r) => a + r.pops.updates, 0);
    const line = {
      world, view, styles: pair.join(' & '), skills: skills.join(','), sets: all.length, wins,
      combosPerMin: combos / playerMin, linksPerCombo: comboLinks / Math.max(1, combos), longest,
      catchesPerMin: ((links.catch ?? 0) + (links.aerial ?? 0)) / min, aerialShare: (links.aerial ?? 0) / Math.max(1, (links.catch ?? 0) + (links.aerial ?? 0)),
      flingsPerMin: (links.fling ?? 0) / min, swingsPerMin: (links.swing ?? 0) / min, liftsPerMin: (links.lift ?? 0) / min, vaultsPerMin: (links.vault ?? 0) / min,
      countersPerMin: (links.counter ?? 0) / min, wallJumpsPerMin: (links.walljump ?? 0) / playerMin, holdS: mean(holds),
      firstMerge: hit.length ? Math.min(...hit) : null, firstMergeMean: hit.length ? mean(hit) : null, setsMerged: hit.length,
      mergesPerMin: merges / min, fusedShare: fused / Math.max(1, all.length), longestEach: all.map((r) => Math.max(r.seats[0].longest, r.seats[1].longest)),
      top5: lens.slice(0, 5), popsMax, popUpdates, highs: all.map((r) => r.sets[0]?.high ?? 0), peaks,
      airShare: air / (play * 2), fallsPerMin: falls / min, style: mean(styles), peak: mean(peaks), fused, merges,
      ends,
      linksPerMin: Object.fromEntries(KINDS.filter((k) => links[k]).map((k) => [k, +(links[k] / min).toFixed(1)])),
    };
    report.push(line);
    console.log(`\n${world} ${view}: ${line.styles} (skill ${line.skills}), ${line.sets} sets of ${setMs / 1000} s, wins ${wins.join('-')}`);
    console.log(`  per minute of play: ${f1(line.catchesPerMin)} catches (${(line.aerialShare * 100).toFixed(0)}% out of the air), ${f1(line.swingsPerMin)} swings, ${f1(line.flingsPerMin)} flings, ${f1(line.liftsPerMin)} lifts, ${f1(line.vaultsPerMin)} vaults, ${f1(line.countersPerMin)} counters; a hold ${f1(line.holdS)} s (ended by ${Object.entries(ends).map(([k, v]) => `${k} ${v}`).join(', ')})`);
    console.log(`  combos: ${f1(line.combosPerMin)} a player-minute, ${f1(line.linksPerCombo)} links each, the longest ${longest}; ${(line.airShare * 100).toFixed(0)}% of the time in the air; ${f1(line.wallJumpsPerMin)} wall jumps a player-minute; ${f1(line.fallsPerMin)} falls a minute`);
    console.log(`  style ${f1(line.style)} a dancer a set; the shared energy's peak ${line.peak.toFixed(2)}; ${fused} of ${all.length} finales fused; ${merges} merges`);
    console.log(`  pacing: first MERGE ${hit.length ? `${f1(Math.min(...hit))} s at the soonest, ${f1(mean(hit))} on average` : 'never'} (${hit.length} of ${all.length} sets merged), ${f1(merges / min)} MERGE a minute; ${fused} of ${all.length} fused; longest each set ${line.longestEach.join(', ')}; pops: at most ${popsMax} new in a second (${popUpdates} updated in place)`);
    console.log(`  links a minute: ${Object.entries(line.linksPerMin).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
}
if (jsonOut) { const fs = await import('node:fs'); fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1)); console.log(`\nwrote ${jsonOut}`); }
