// The fusion agent's takes (docs/reports/7-fusion.md), run one at a time with scripts/critic-cap.mjs --prefix 7:
//   node scripts/steps/fusion7-gen.mjs && node scripts/critic-cap.mjs scripts/steps/fusion7.json --only <take> --prefix 7 --shots shots/fusion7
// The four fusions through the jogo, as the critic drove them (critic6-gen.mjs: the Pool script with form presses at
// beat 27.5, so the kinds are steam, prism, storm, aurora), each from its gathering through its eight bars to its
// release at 2 fps; the same round the landing at 12 fps; the two core stills for fire's and plasma's shoulder; and a
// 1080p timing mid-fusion.
import { writeFileSync, readFileSync } from 'node:fs';

const takes = [];
const pool = JSON.parse(readFileSync('src/play/scripts/pool-fire-water.json', 'utf8'));
const dusk = "bend.set('redwoods', { hour: 19.4, dayGoes: false }); ";
const FORMS = { steam: [], prism: [1], storm: [0], aurora: [0, 1] };
const fusionScript = (kind, world) => {
  const cues = pool.cues.filter((c) => c.at <= 80).map((c) => ({ ...c }));
  for (const s of FORMS[kind]) cues.push({ at: 27.5, seat: s, press: 'form' });
  return { name: `fusion7-${kind}`, world, lock: true, dress: ['fire', 'water'], cues };
};
const report = "console.warn('jogo', JSON.stringify(bend.jogo.stats().fusion), bend.jogo.stats().phase);";
for (const kind of Object.keys(FORMS)) {
  for (const world of ['pool', 'temple']) {
    const setup = `bend.jogo.run(${JSON.stringify(fusionScript(kind, world))});`;
    const q = `jogo=script&script=none&world=${world}&dress=fire,water`;
    // the whole fusion: gathering, landing, eight bars, release (2 fps)
    takes.push({
      name: `${kind}-${world}`, query: q, fps: 2, seconds: 22, warm: 1100, setup,
      cues: { '0': report, '3': report, '11': report, '19': report, '21.5': report },
      sheet: { cols: 11, rows: 4, width: 240 }, stills: [3, 5, 9, 13, 17, 19.5],
    });
    // round the landing, 12 fps
    takes.push({
      name: `${kind}-${world}-land`, query: q, fps: 12, seconds: 4, warm: 1180, setup,
      cues: { '0': report, '3.9': report }, sheet: { cols: 8, rows: 3, width: 300 }, stills: [1.5, 2.5],
    });
  }
}
// the cores (fire's and plasma's shoulder): the critic's two stills, re-shot
const pair = (name, query, dist, gap, extra = '', cues = { '0.8': "bend.move(0,'armada')", '2.0': "bend.move(1,'au')" }, seconds = 3.2, stills = [0.4, 1.2, 2.4]) =>
  takes.push({
    name, query, fps: 15, seconds, warm: 300,
    setup: `${extra}bend.set('camera', { followDist: ${dist}, followFov: 40, followPitch: 0.08, followSwing: 0 }); bend.wake(); bend.place(0,${-gap / 2},0.3,Math.PI/2); bend.place(1,${gap / 2},0.3,-Math.PI/2);`,
    cues, each: 'bend.camera({ yaw: 0.25 + 0.06*t });', sheet: { cols: 6, rows: 2, width: 330 }, stills,
  });
pair('el-fw-redwoods-close', 'play&two&dress=fire,water&world=redwoods', 2.6, 1.3, dusk);
const human = {};
const seq = ['meia-lua', 'esquiva', 'armada', 'spin', 'martelo', 'au', 'block', 'meia-lua', 'role', 'armada'];
for (let i = 0; i < 12; i++) human[(4 + i * 1.5).toFixed(1)] = `bend.move(0,'${seq[i % seq.length]}')`;
takes.push({ name: 'partner-geode', query: 'jogo=partner&world=geode&dress=plasma,ice', fps: 5, seconds: 18, warm: 1, setup: 'await bend.jogo.start();', cues: human, sheet: { cols: 9, rows: 2, width: 260 }, stills: [16] });
// 1080p timings mid-fusion, each kind in the Pool
for (const kind of Object.keys(FORMS)) {
  takes.push({ name: `t-${kind}-pool`, query: 'jogo=script&script=none&world=pool&dress=fire,water', size: '1920x1080', fps: 2, seconds: 1, warm: 1500, setup: `bend.jogo.run(${JSON.stringify(fusionScript(kind, 'pool'))});`, timings: true, sheet: { cols: 2, rows: 1, width: 640 }, stills: [0.5] });
}

writeFileSync('scripts/steps/fusion7.json', JSON.stringify(takes, null, 1));
console.log(`scripts/steps/fusion7.json: ${takes.length} takes`);
