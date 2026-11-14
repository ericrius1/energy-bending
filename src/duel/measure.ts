// Phase 3's measure of the arenas, the hazards and the virtual players (docs/reports/14-arenas.md): many seeded sets per
// world through the real bodies, the contact, the rules and the powers (sim.ts), the dress rotated so each matter plays
// as often as the others, and what a player would see of them:
//   falls a set, catches a minute (both seats), the share of each of the ten powers and each matter's second power to
//   its first, reactions a set (steam, melt, freeze), the ice step used as a ledge (stands on one, seconds stood), how
//   often each hazard is ridden (rides and seconds: the tide floated on, a gust ridden in the air, the crystals' lift,
//   the swell), and seconds spent in water.
//   node scripts/duel-measure.mjs [--world temple,redwoods,geode,pool] [--sets 20] [--skills 0.85,0.85] [--hazards 1]
//                                 [--seed 1] [--view free] [--json out.json]
import { simulateDuel, nodeArena, makeBrains, type DuelSimResult } from './sim';
import type { DuelStyle } from '../ai/duel-brain';
import { DUEL } from '../../shared/duel.ts';

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const worlds = arg('world', 'temple,redwoods,geode,pool').split(',');
const sets = Number(arg('sets', '20'));
const skills = arg('skills', '0.85,0.85').split(',').map(Number) as [number, number];
const hazards = arg('hazards', '1') !== '0';
const seed0 = Number(arg('seed', '1'));
const view = arg('view', 'free');
const jsonOut = arg('json', '');
// the weight of contact's time warp, as the page plays it (--warp 1), and rule constants to try (--duel KEY=V,KEY=V:
// shared/duel.ts DUEL, for tuning)
const warp = arg('warp', '0') !== '0';
for (const kv of arg('duel', '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); (DUEL as unknown as Record<string, number>)[k] = Number(v); }

/** each matter in two pairs; the pairs that can react (steam: fire and water, freeze: water and ice, melt: ice and
 *  fire) among them */
const DRESS: [string, string][] = [['fire', 'water'], ['water', 'ice'], ['ice', 'fire'], ['plasma', 'gems'], ['gems', 'plasma']];
const STYLES: [DuelStyle, DuelStyle][] = [['lead', 'flyer'], ['base', 'flyer'], ['lead', 'lead'], ['flyer', 'base']];
const POWERS = ['flare', 'ribbon', 'whip', 'wave', 'step', 'slide', 'blink', 'arc', 'pillar', 'prism'];
const PAIRS: [string, string, string][] = [['fire', 'flare', 'ribbon'], ['water', 'whip', 'wave'], ['ice', 'step', 'slide'], ['plasma', 'blink', 'arc'], ['gems', 'pillar', 'prism']];
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-');

const report: Record<string, unknown>[] = [];
for (const world of worlds) {
  const { arena, world: W } = nodeArena(world);
  // (--tune world:gain:ebb: a world's energy to try, in place of its arena's)
  for (const t of arg('tune', '').split(',').filter(Boolean)) { const [w, g, e] = t.split(':'); if (w === world) arena.energy = { gain: Number(g), ebb: Number(e) }; }
  const all: DuelSimResult[] = [];
  const ledge = { stands: 0, s: 0 };
  const rides: Record<string, { n: number; s: number }> = {};
  let waterS = 0;
  // the shared energy's sources (summed over the sets): what links gave (or took), what holds' first moments gave, what
  // ebbed apart and held on, and the merges' spend; seconds joined, apart within NEAR_M, and of play
  const gaps: number[] = [];
  const E = { link: 0, hold: 0, ebbApart: 0, ebbHeld: 0, spend: 0, joinedS: 0, nearS: 0, playS: 0, topS: 0, top: { link: 0, hold: 0, ebb: 0, aerial: 0, catch: 0 } as Record<string, number>, liveApartS: 0, apartS: 0 };
  for (let r = 0; r < sets; r++) {
    const seed = seed0 + r * 101, dress = DRESS[r % DRESS.length], styles = STYLES[Math.floor(r / DRESS.length) % STYLES.length];
    // (the ice step stood on: a body grounded on a step's top, counted once each time it lands there)
    const onStep = [false, false];
    let eWas = 0, wasJoined = false, apartAt = -1, tNow = 0;
    const res = simulateDuel({
      arena, world: W, locked: view === 'locked', dress, hazards, warp, brains: makeBrains(styles, skills, [seed, seed + 7]), sets: 1, setMs: 60000, seconds: 90,
      each: ({ powers, bodies, match, events }) => {
        const d = match.state;
        if (d.phase === 'play') {
          const de = d.energy - eWas, linked = events.some((e) => e.k === 'link'), merged = events.some((e) => e.k === 'merge');
          if (merged) E.spend += de; else if (linked) E.link += de; else if (d.joined) { if (de > 0) E.hold += de; else E.ebbHeld += de; } else E.ebbApart += de;
          E.playS += 1 / 60;
          if (!d.joined) { E.apartS += 1 / 60; if (d.seats[0].combo.live && d.seats[1].combo.live) E.liveApartS += 1 / 60; }
          if (eWas >= 0.85) { E.topS += 1 / 60; if (merged) { /* */ } else if (linked) { E.top.link += de; for (const e of events) if (e.k === "link" && (e.kind === "aerial" || e.kind === "catch")) E.top[e.kind] += 1; } else if (de > 0) E.top.hold += de; else E.top.ebb += de; }
          if (d.joined) E.joinedS += 1 / 60;
          else if (Math.hypot(bodies[0].root[0] - bodies[1].root[0], bodies[0].root[2] - bodies[1].root[2]) < 2.5) E.nearS += 1 / 60;
        }
        eWas = d.energy; tNow += 1 / 60;
        if (d.phase === "play" && d.joined && !wasJoined && apartAt >= 0) gaps.push(tNow - apartAt);
        if (!d.joined && wasJoined) apartAt = tNow;
        wasJoined = d.joined;
        if (!powers || match.state.phase !== 'play') return;
        for (let k = 0; k < 2; k++) {
          const c = bodies[k];
          const on = c.grounded && powers.live.some((L) => L.kind === 'step' && !!L.solid && Math.abs(c.root[1] - L.top!) < 0.1 && Math.hypot(c.root[0] - L.at[0], c.root[2] - L.at[2]) < 0.9);
          if (on && !onStep[k]) ledge.stands++;
          if (on) ledge.s += 1 / 60;
          onStep[k] = on;
        }
      },
    });
    all.push(res);
    if (res.hazards) {
      for (const [k, v] of Object.entries(res.hazards.rides)) { const R = (rides[k] ??= { n: 0, s: 0 }); R.n += v.n; R.s += v.s; }
      waterS += res.hazards.waterS;
    }
  }
  const play = all.reduce((a, r) => a + r.play, 0), min = play / 60, nSets = all.length;
  let falls = 0, catches = 0, aerials = 0;
  const casts: Record<string, number> = {}, reacts: Record<string, number> = {};
  let powerCatches = 0, peak = 0, fused = 0, merges = 0;
  for (const r of all) {
    for (const s of r.seats) { falls += s.falls; catches += (s.links.catch ?? 0) + (s.links.aerial ?? 0); aerials += s.links.aerial ?? 0; }
    if (r.powers) {
      for (const c of r.powers.casts) for (const [k, v] of Object.entries(c)) casts[k] = (casts[k] ?? 0) + v;
      for (const [k, v] of Object.entries(r.powers.reactions)) reacts[k] = (reacts[k] ?? 0) + v;
      powerCatches += r.powers.felt.catches;
    }
    for (const x of r.sets) { peak += x.peak; if (x.fused) fused++; merges += x.merges; }
  }
  const totalCasts = Object.values(casts).reduce((a, b) => a + b, 0) || 1;
  const spread = all.flatMap((r) => r.spread), meanSpread = spread.reduce((a, b) => a + b, 0) / Math.max(1, spread.length);
  const share = Object.fromEntries(POWERS.map((p) => [p, +((casts[p] ?? 0) / totalCasts).toFixed(3)])) as Record<string, number>;
  const second = Object.fromEntries(PAIRS.map(([m, a, b]) => [m, +((casts[b] ?? 0) / Math.max(1, casts[a] ?? 0)).toFixed(2)])) as Record<string, number>;
  const rideOut = Object.fromEntries(Object.entries(rides).map(([k, v]) => [k, { n: v.n, perSet: +(v.n / nSets).toFixed(2), s: +v.s.toFixed(1) }]));
  const line = {
    world, view, hazards, sets: nSets, skills,
    fallsPerSet: falls / nSets, catchesPerMin: catches / min, aerialShare: aerials / Math.max(1, catches), powerCatchesPerMin: powerCatches / min,
    castsPerMin: totalCasts / min, share, casts: Object.fromEntries(POWERS.map((p) => [p, casts[p] ?? 0])), secondToFirst: second,
    reactionsPerSet: Object.values(reacts).reduce((a, b) => a + b, 0) / nSets, reactions: reacts,
    ledge: { stands: ledge.stands, perSet: ledge.stands / nSets, seconds: +ledge.s.toFixed(1) },
    rides: rideOut, waterS: +(waterS / nSets).toFixed(1), spread: +meanSpread.toFixed(2),
    peak: peak / nSets, fused, merges,
  };
  report.push(line);
  console.log(`\n${world} (${view}, hazards ${hazards ? 'on' : 'off'}): ${nSets} sets of 60 s, skill ${skills.join(',')}, dress rotated`);
  console.log(`  falls ${f2(line.fallsPerSet)} a set; catches ${f1(line.catchesPerMin)} a minute (${(line.aerialShare * 100).toFixed(0)}% from the air, ${f1(line.powerCatchesPerMin)} by a power); apart ${f1(line.spread)} m on average`);
  console.log(`  casts ${f1(line.castsPerMin)} a minute: ${POWERS.map((p) => `${p} ${(share[p] * 100).toFixed(0)}%`).join(', ')}`);
  console.log(`  second power to first: ${PAIRS.map(([m]) => `${m} ${f2(second[m])}`).join(', ')}`);
  console.log(`  reactions ${f2(line.reactionsPerSet)} a set ${JSON.stringify(reacts)}; the ice step as a ledge: ${ledge.stands} stands (${f2(line.ledge.perSet)} a set), ${f1(ledge.s)} s`);
  console.log(`  hazards ridden: ${Object.entries(rideOut).map(([k, v]) => `${k} ${v.n} (${v.perSet} a set, ${v.s} s)`).join(', ') || 'none'}; ${line.waterS} s a set in water`);
  console.log(`  peak ${f2(line.peak)}, ${fused} fused, ${merges} merges`);
  // the pacing: each set's first MERGE (s into its play), the longest stretch at FUSE_AT, the energy's sources
  const firsts = all.map((r) => r.merges[0]?.[0]).filter((x): x is number => x != null);
  const highs = all.map((r) => r.sets[0]?.high ?? 0), mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
  const per = (v: number) => f2(v / nSets);
  Object.assign(line, { firstMerge: firsts.length ? Math.min(...firsts) : null, firstMergeMean: mean(firsts), setsMerged: firsts.length, highMean: mean(highs), energy: { ...E } });
  console.log(`  first MERGE ${firsts.length ? `${f1(Math.min(...firsts))} s soonest, ${f1(mean(firsts))} mean` : 'never'} (${firsts.length} of ${nSets} merged); at the top ${f2(mean(highs))} s on average (longest stretch)`);
  { const g = [...gaps].sort((a, b) => a - b), q = (p: number) => f2(g[Math.floor(p * (g.length - 1))] ?? NaN); console.log(`  apart between holds: median ${q(0.5)} s, quartiles ${q(0.25)} / ${q(0.75)}; under 1 s ${(100 * g.filter((x) => x < 1).length / Math.max(1, g.length)).toFixed(0)}%`); }
  console.log(`  near the top (0.85+): ${per(E.topS)} s a set: links ${per(E.top.link)}, holds ${per(E.top.hold)}, ebb ${per(E.top.ebb)}; catches there ${per(E.top.catch)} + air ${per(E.top.aerial)} a set; apart with both combos live ${(100 * E.liveApartS / Math.max(1e-9, E.apartS)).toFixed(0)}% of apart`);
  console.log(`  energy a set: links ${per(E.link)}, holds' first moments ${per(E.hold)}, ebb apart ${per(E.ebbApart)}, ebb held ${per(E.ebbHeld)}, merges ${per(E.spend)}; joined ${(100 * E.joinedS / E.playS).toFixed(0)}% of play, apart but near ${(100 * E.nearS / E.playS).toFixed(0)}%`);
  if (argv.includes('-v')) {
    const B: Record<string, number> = {};
    for (const r of all) for (const s of r.seats) for (const [k, v] of Object.entries(s.brain)) B[k] = (B[k] ?? 0) + v;
    console.log(`  brains: ${Object.entries(B).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
}
if (jsonOut) { const fs = await import('node:fs'); fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1)); console.log(`\nwrote ${jsonOut}`); }
