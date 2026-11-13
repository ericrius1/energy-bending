// The third integration's own takes (docs/reports/8-integration.md), run one at a time with scripts/critic-cap.mjs:
//   node scripts/steps/integ-8-gen.mjs && node scripts/critic-cap.mjs scripts/steps/integ-8.json --only <take> --prefix 8 --shots shots/integ8
// The before-and-after pairs are the critic's own takes (scripts/steps/critic6.json) re-shot with --prefix 8; these
// are what the merges added: the five new moves on a contact sheet, each fusion kind through the jogo with the pair
// kept close (the fusion's pull), the partner for 30 s in the redwoods (locked) and the temple, a played dancer through
// each hub gate and back, fire in front of and behind water (the one body interface), the stage dim.
import { writeFileSync, readFileSync } from 'node:fs';

const takes = [];
const dusk = "bend.set('redwoods', { hour: 19.4, dayGoes: false }); ";
const tide = "bend.set('temple', { tideHold: 0.42 }); ";

// ---------------------------------------------------------------- the new moves (src/dancer/moves.ts), side-on
// two gem dancers (the body reads plainest in stones) 2.4 m apart, the camera square to them
takes.push({
  name: 'moves-new', query: 'play&two&dress=gems,gems&world=geode', fps: 10, seconds: 7.2, warm: 400,
  setup: "bend.set('camera', { followDist: 4.2, followFov: 40, followPitch: 0.05, followSwing: 0 }); bend.wake(); bend.place(0,-1.2,0,Math.PI/2); bend.place(1,1.2,0,-Math.PI/2);",
  cues: { '0.3': "bend.move(0,'negativa'); bend.move(1,'cocorinha')", '1.8': "bend.move(0,'compasso'); bend.move(1,'queda-de-rins')", '3.6': "bend.move(0,'cocorinha'); bend.move(1,'negativa')", '4.6': "bend.move(0,'bow'); bend.move(1,'bow')" },
  each: 'bend.camera({ yaw: 0, pitch: 0.05, dist: 4.2 });', sheet: { cols: 9, rows: 8, width: 220 }, stills: [0.7, 2.3, 2.6, 3.0, 5.6],
});
takes.push({
  name: 'moves-new-34', query: 'play&two&dress=gems,gems&world=geode', fps: 10, seconds: 3.4, warm: 400,
  setup: "bend.set('camera', { followDist: 3.6, followFov: 40, followPitch: 0.1, followSwing: 0 }); bend.wake(); bend.place(0,-1.2,0,Math.PI/2); bend.place(1,1.2,0,-Math.PI/2);",
  cues: { '0.3': "bend.move(0,'compasso'); bend.move(1,'queda-de-rins')" },
  each: 'bend.camera({ yaw: 0.8, pitch: 0.12, dist: 3.6 });', sheet: { cols: 9, rows: 4, width: 220 }, stills: [0.9, 1.2],
});

// ---------------------------------------------------------------- the one body interface: light in front of water
// the first row with the light's dancer behind the water dancer (dimmed, bent), the second in front (must not dim):
// fire, plasma's threads, and gems' sparks (no focus distance of their own)
const front = (name, dress, move) => takes.push({
  name, query: `play&two&dress=${dress}&world=temple`, fps: 5, seconds: 2, warm: 300,
  setup: "bend.set('camera', { followDist: 2.8, followFov: 40, followPitch: 0.08, followSwing: 0 }); bend.wake(); bend.place(0,-0.65,0.3,Math.PI/2); bend.place(1,0.65,0.3,-Math.PI/2);",
  cues: { '0': `bend.move(0,'${move}')`, '1': `bend.move(0,'${move}')` },
  each: 'bend.camera({ yaw: t < 1 ? 0.25 + 1.35 : 0.25 - 1.35 });', sheet: { cols: 5, rows: 2, width: 320 }, stills: [0.6, 1.6],
});
front('body-fire', 'fire,water', 'armada');
front('body-plasma', 'plasma,water', 'armada');
front('body-gems', 'gems,water', 'spin');

// ---------------------------------------------------------------- the fusion through the jogo with the pull, every kind
// the Pool script with the critic's form presses (6-critique), the pair's gotos during the fusion left as the script
// has them (±0.42 and ±0.3: the fusion's pull is what keeps them close now); landing (3 s), middle (9), release (19.5)
const pool = JSON.parse(readFileSync('src/play/scripts/pool-fire-water.json', 'utf8'));
const FORMS = { steam: [], prism: [1], storm: [0], aurora: [0, 1] };
for (const kind of Object.keys(FORMS)) for (const world of ['pool', 'temple']) {
  const cues = pool.cues.filter((c) => c.at <= 80).map((c) => ({ ...c }));
  for (const st of FORMS[kind]) cues.push({ at: 27.5, seat: st, press: 'form' });
  takes.push({
    name: `fu-${kind}-${world}`, query: `jogo=script&script=none&world=${world}&dress=fire,water`, fps: 2, seconds: 22, warm: 1100,
    setup: `${world === 'temple' ? tide : ''}bend.jogo.run(${JSON.stringify({ name: `integ8-${kind}`, world, lock: true, dress: ['fire', 'water'], cues })});`,
    cues: { '3': "console.warn('fusion', JSON.stringify(bend.jogo.stats().fusion), JSON.stringify(bend.jogo.stats().seats))", '9': "console.warn('fusion', JSON.stringify(bend.jogo.stats().fusion), JSON.stringify(bend.jogo.stats().seats))", '15': "console.warn('fusion', JSON.stringify(bend.jogo.stats().fusion), JSON.stringify(bend.jogo.stats().seats))" },
    sheet: { cols: 11, rows: 4, width: 220 }, stills: [3, 9, 19.5],
  });
}

// ---------------------------------------------------------------- 30 s against the new partner (seat 0 by presses)
const human = {};
const seq = ['meia-lua', 'esquiva', 'armada', 'spin', 'martelo', 'au', 'block', 'meia-lua', 'role', 'armada'];
for (let i = 0; i < 18; i++) human[(4 + i * 1.5).toFixed(1)] = `bend.move(0,'${seq[i % seq.length]}')`;
human['15'] = "console.warn('partner', JSON.stringify(bend.jogo.stats().seats), bend.music.engine.mood.name)";
takes.push({ name: 'partner-redwoods-lock', query: 'jogo=partner&world=redwoods&dress=fire,water', fps: 5, seconds: 30, warm: 1, setup: `${dusk}await bend.jogo.start();`, cues: human, sheet: { cols: 10, rows: 3, width: 260 }, stills: [8, 16, 24] });
takes.push({ name: 'partner-temple-lock', query: 'jogo=partner&world=temple&dress=fire,water', fps: 5, seconds: 30, warm: 1, setup: `${tide}await bend.jogo.start();`, cues: human, sheet: { cols: 10, rows: 3, width: 260 }, stills: [8, 16, 24] });

// ---------------------------------------------------------------- ?baseline (WebGPU's default limits) in every world
for (const w of ['geode', 'pool', 'temple', 'redwoods', 'forge']) takes.push({
  name: `baseline-${w}`, query: `play&two&dress=fire,water&world=${w}&baseline`, fps: 2, seconds: 1, warm: 300,
  setup: "bend.set('camera', { followDist: 4, followFov: 40, followPitch: 0.1 }); bend.wake(); bend.place(0,-0.7,0.3,Math.PI/2); bend.place(1,0.7,0.3,-Math.PI/2);",
  sheet: { cols: 2, rows: 1, width: 640 }, stills: [0.5],
});

writeFileSync('scripts/steps/integ-8.json', JSON.stringify(takes, null, 1));
console.log(`${takes.length} takes: ${takes.map((t) => t.name).join(', ')}`);
