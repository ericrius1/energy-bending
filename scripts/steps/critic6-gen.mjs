// The second critic's takes (docs/reports/6-critique.md), run one at a time with scripts/critic-cap.mjs --prefix 6:
//   node scripts/steps/critic6-gen.mjs && node scripts/critic-cap.mjs scripts/steps/critic6.json --only <take> --prefix 6 --shots shots/critic6
// The four fusions through the jogo (the Pool script with form presses before the merge), frame by frame round the
// landing; the elements close in the film's worlds; the partner brain in two worlds; the worlds' best angles; rough
// stagings of the films' lead shots; 1080p timings of the scenes the films need.
import { writeFileSync, readFileSync } from 'node:fs';

const takes = [];
const pool = JSON.parse(readFileSync('src/play/scripts/pool-fire-water.json', 'utf8'));
const dusk = "bend.set('redwoods', { hour: 19.4, dayGoes: false }); ";

// ---------------------------------------------------------------- the fusions, through the jogo
// fusionKinds[form0][form1]: steam (0,0), prism (0,1), storm (1,0), aurora (1,1). Form presses at beat 27.5, a beat
// before the dancers close for the merge (the script's own merge is at 29.5).
const FORMS = { steam: [], prism: [1], storm: [0], aurora: [0, 1] };
const fusionScript = (kind, world) => {
  const cues = pool.cues.filter((c) => c.at <= 60).map((c) => ({ ...c }));
  for (const s of FORMS[kind]) cues.push({ at: 27.5, seat: s, press: 'form' });
  return { name: `critic6-${kind}`, world, lock: true, dress: ['fire', 'water'], cues };
};
const report = "console.warn('jogo', JSON.stringify(bend.jogo.stats().fusion), JSON.stringify(bend.jogo.stats().form), bend.jogo.stats().phase);";
for (const kind of Object.keys(FORMS)) {
  for (const world of ['pool', 'temple']) {
    takes.push({
      name: `fusion-${kind}-${world}`, query: `jogo=script&script=none&world=${world}&dress=fire,water`, fps: 12, seconds: 9, warm: 1180,
      setup: `bend.jogo.run(${JSON.stringify(fusionScript(kind, world))});`,
      cues: { '0': report, '4': report, '8.9': report },
      sheet: { cols: 6, rows: 3, width: 330 }, stills: [0.5, 1.5, 3, 5, 7.5],
    });
  }
}
// the whole Pool script at 2 fps for the arc (tension, invitation, fusion, release) without the warm
takes.push({ name: 'jogo-arc', query: 'jogo=script&script=pool-fire-water', fps: 2, seconds: 40, warm: 1, sheet: { cols: 8, rows: 5, width: 250 }, stills: [6, 12, 19, 21, 27, 36] });

// ---------------------------------------------------------------- elements, close and at game distance, in film worlds
const pair = (name, query, dist, gap, extra = '', cues = { '0.8': "bend.move(0,'armada')", '2.0': "bend.move(1,'au')" }, seconds = 3.2, stills = [0.4, 1.2, 2.4]) =>
  takes.push({
    name, query, fps: 15, seconds, warm: 300,
    setup: `${extra}bend.set('camera', { followDist: ${dist}, followFov: 40, followPitch: 0.08, followSwing: 0 }); bend.wake(); bend.place(0,${-gap / 2},0.3,Math.PI/2); bend.place(1,${gap / 2},0.3,-Math.PI/2);`,
    cues, each: 'bend.camera({ yaw: 0.25 + 0.06*t });', sheet: { cols: 6, rows: 2, width: 330 }, stills,
  });
pair('el-fw-temple-close', 'play&two&dress=fire,water&world=temple', 2.6, 1.3);
pair('el-fw-redwoods-close', 'play&two&dress=fire,water&world=redwoods', 2.6, 1.3, dusk);
pair('el-fw-temple-wide', 'play&two&dress=fire,water&world=temple', 6.5, 1.6);
pair('el-ip-temple-close', 'play&two&dress=plasma,ice&world=temple', 2.6, 1.3);
pair('el-ip-redwoods-close', 'play&two&dress=plasma,ice&world=redwoods', 2.6, 1.3, dusk);
pair('el-water-solo-close', 'play&two&dress=water,water&world=temple', 1.9, 3.0, '', { '1.0': "bend.move(0,'meia-lua')" });

// ---------------------------------------------------------------- the partner brain, 30 s, two worlds (seat 0 by presses)
const human = {};
const seq = ['meia-lua', 'esquiva', 'armada', 'spin', 'martelo', 'au', 'block', 'meia-lua', 'role', 'armada'];
for (let i = 0; i < 18; i++) human[(4 + i * 1.5).toFixed(1)] = `bend.move(0,'${seq[i % seq.length]}')`;
takes.push({ name: 'partner-temple', query: 'jogo=partner&world=temple&dress=fire,water', fps: 5, seconds: 30, warm: 1, setup: 'await bend.jogo.start();', cues: human, sheet: { cols: 10, rows: 3, width: 260 }, stills: [8, 16, 24] });
takes.push({ name: 'partner-geode', query: 'jogo=partner&world=geode&dress=plasma,ice', fps: 5, seconds: 30, warm: 1, setup: 'await bend.jogo.start();', cues: human, sheet: { cols: 10, rows: 3, width: 260 }, stills: [8, 16, 24] });
// the same 6 s at 30 fps, to judge the motion itself
takes.push({ name: 'partner-temple-motion', query: 'jogo=partner&world=temple&dress=fire,water', fps: 20, seconds: 6, warm: 600, setup: 'await bend.jogo.start();', cues: { '0.5': "bend.move(0,'armada')", '2.5': "bend.move(0,'meia-lua')", '4.5': "bend.move(0,'au')" }, sheet: { cols: 10, rows: 4, width: 260 }, stills: [] });

// ---------------------------------------------------------------- the first thing anyone sees, and the worlds
takes.push({ name: 'first', query: '', fps: 4, seconds: 8, warm: 1, sheet: { cols: 8, rows: 4, width: 250 }, stills: [0.25, 4, 7.75] });
takes.push({ name: 'first-play', query: 'play', fps: 4, seconds: 8, warm: 1, setup: 'bend.wake();', sheet: { cols: 8, rows: 4, width: 250 }, stills: [1, 7.75] });
const orbit = (w, extra = '', dist = 8, pitch = 0.18) => takes.push({
  name: `w-${w}`, query: `play&two&dress=fire,water&world=${w}`, fps: 4, seconds: 12, warm: 300,
  setup: `${extra}bend.set('camera', { followDist: ${dist}, followFov: 44, followPitch: ${pitch}, followSwing: 0 }); bend.wake(); bend.place(0,-0.8,0.3,Math.PI/2); bend.place(1,0.8,0.3,-Math.PI/2);`,
  each: 'bend.camera({ yaw: t * 0.52 });', sheet: { cols: 8, rows: 3, width: 250 }, stills: [0, 3, 6, 9],
});
for (const w of ['geode', 'pool', 'temple', 'forge']) orbit(w);
orbit('redwoods', dusk);

// ---------------------------------------------------------------- rough stagings of the films' lead shots
// Film 2's single take: the temple, fire and water facing on the drowned court, the camera dollying in low and arcing
takes.push({
  name: 'film2-dolly', query: 'play&two&dress=fire,water&world=temple', size: '1920x1080', fps: 10, seconds: 8, warm: 300,
  setup: "bend.set('camera', { followFov: 34, followSwing: 0 }); bend.wake(); bend.place(0,-0.9,0.3,Math.PI/2); bend.place(1,0.9,0.3,-Math.PI/2);",
  cues: { '3': "bend.move(0,'armada')", '5.5': "bend.move(1,'au')" },
  each: "bend.set('camera', { followDist: 8 - t*0.6, followPitch: 0.04 + t*0.01 }); bend.camera({ yaw: 0.1 + t*0.05 });",
  sheet: { cols: 8, rows: 2, width: 320 }, stills: [0.5, 3.6, 6.2, 7.9],
});
// Film 1's opening: the redwoods at dusk, two heaps rising
takes.push({
  name: 'film1-rise', query: 'play&two&dress=fire,water&world=redwoods', size: '1920x1080', fps: 10, seconds: 8, warm: 60,
  setup: `${dusk}bend.set('camera', { followFov: 38, followSwing: 0 }); bend.place(0,-0.8,0.3,Math.PI/2); bend.place(1,0.8,0.3,-Math.PI/2);`,
  cues: { '1.5': 'bend.wake();' },
  each: "bend.set('camera', { followDist: 6.5 - t*0.35, followPitch: 0.35 - t*0.03 }); bend.camera({ yaw: 0.3 + t*0.04 });",
  sheet: { cols: 8, rows: 2, width: 320 }, stills: [0.5, 3, 5, 7.9],
});
// the shot of the idea: a dancer walking through a live gate, half in each world (the cameras' take, at 1080p)
takes.push({
  name: 'film1-gate', query: 'play&dress=fire', size: '1920x1080', fps: 10, seconds: 7, warm: 120,
  setup: "bend.wake(); bend.set('camera', { followDist: 3.6, followFov: 44, followPitch: 0.1 });",
  each: "bend.intent(0, { moveY: 1 });",
  sheet: { cols: 7, rows: 2, width: 320 }, stills: [2, 4, 6],
});

// ---------------------------------------------------------------- 1080p timings for the films' scenes
const t1080 = (name, query, setup) => takes.push({ name, query, size: '1920x1080', fps: 2, seconds: 1, warm: 300, setup, timings: true, sheet: { cols: 2, rows: 1, width: 640 }, stills: [0.5] });
t1080('t-temple-pair', 'play&two&dress=fire,water&world=temple', "bend.set('camera', { followDist: 4, followFov: 40, followPitch: 0.08 }); bend.wake(); bend.place(0,-0.7,0.3,Math.PI/2); bend.place(1,0.7,0.3,-Math.PI/2);");
t1080('t-redwoods-pair', 'play&two&dress=fire,water&world=redwoods', `${dusk}bend.set('camera', { followDist: 4, followFov: 40, followPitch: 0.08 }); bend.wake(); bend.place(0,-0.7,0.3,Math.PI/2); bend.place(1,0.7,0.3,-Math.PI/2);`);
t1080('t-redwoods-jogo', 'jogo=partner&world=redwoods&dress=fire,water', `${dusk}await bend.jogo.start();`);
t1080('t-hub-pair', 'play&two&dress=fire,water', "bend.set('camera', { followDist: 6, followFov: 44, followPitch: 0.2 }); bend.wake();");
takes.push({ name: 't-fusion-pool', query: 'jogo=script&script=none&world=pool&dress=fire,water', size: '1920x1080', fps: 2, seconds: 1, warm: 1300, setup: `bend.jogo.run(${JSON.stringify(fusionScript('steam', 'pool'))});`, timings: true, sheet: { cols: 2, rows: 1, width: 640 }, stills: [0.5] });

writeFileSync('scripts/steps/critic6.json', JSON.stringify(takes, null, 1));
console.log(`scripts/steps/critic6.json: ${takes.length} takes`);
