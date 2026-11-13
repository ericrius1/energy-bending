// Water and ice, the last stretch (docs/reports/7-water.md): writes water-7.json, the takes I looked at while making
// water lit by its world and its edge break. Each take runs alone well under a minute:
//   node scripts/steps/water-7-gen.mjs
//   node scripts/critic-cap.mjs scripts/steps/water-7.json --only <take> --prefix 7 --shots shots/w7 --url http://localhost:5452/energybending/
// The critic's own takes (critic6.json: el-fw-redwoods-close, el-water-solo-close, film2-dolly, film1-rise,
// el-ip-redwoods-close, partner-temple) are re-shot from that file with --prefix 7.
import { writeFileSync } from 'node:fs';

const takes = [];
const dusk = "bend.set('redwoods', { hour: 19.4, dayGoes: false }); ";
const cam = (dist, pitch = 0.08, fov = 40) => `bend.set('camera', { followDist: ${dist}, followFov: ${fov}, followPitch: ${pitch}, followSwing: 0 }); `;
const pair = (gap) => `bend.wake(); bend.place(0,${-gap / 2},0.3,Math.PI/2); bend.place(1,${gap / 2},0.3,-Math.PI/2);`;
const short = { fps: 5, sheet: { cols: 4, rows: 2, width: 400 } };

// fire and water side by side, in each world, at rest then an armada (water) and an aú (fire)
for (const [w, extra] of [['temple', ''], ['redwoods', dusk], ['pool', ''], ['geode', '']]) {
  takes.push({
    name: `fw-${w}`, query: `play&two&dress=fire,water&world=${w}`, ...short, seconds: 2.4, warm: 300,
    setup: `${extra}${cam(2.6)}${pair(1.3)}`, cues: { '0.8': "bend.move(1,'armada')", '1.6': "bend.move(0,'au')" },
    each: 'bend.camera({ yaw: 0.25 + 0.06*t });', stills: [0.4, 1.2, 2.2],
  });
}
// one water dancer close: at rest (drips), a kick, a spin
takes.push({
  name: 'solo-moves', query: 'play&dress=water&world=temple', fps: 10, seconds: 3.6, warm: 300, sheet: { cols: 6, rows: 3, width: 320 },
  setup: `${cam(2.3, 0.1)}bend.wake(); bend.place(0, 0, 0, Math.PI/2);`, cues: { '1.0': "bend.move(0,'armada')", '2.2': "bend.move(0,'spin')" },
  each: 'bend.camera({ yaw: 0.25 });', stills: [0.6, 1.4, 1.8, 2.8, 3.4],
});
// the freeze at 0, 0.5 and 1
takes.push({
  name: 'freeze', query: 'play&dress=water&world=temple', fps: 5, seconds: 3.2, warm: 240, sheet: { cols: 8, rows: 2, width: 240 },
  setup: `${cam(3.0, 0.1, 42)}bend.wake(); bend.place(0, 0, 0, Math.PI/2); bend.form(0, 0);`, cues: { '0.4': 'bend.form(0, 0.5)', '1.6': 'bend.form(0, 1)' },
  each: 'bend.camera({ yaw: 0.25 });', stills: [0.2, 1.4, 3.0],
});
// ice beside plasma, the redwoods and the geode
takes.push({
  name: 'ice-redwoods', query: 'play&two&dress=plasma,ice&world=redwoods', ...short, seconds: 1.6, warm: 300,
  setup: `${dusk}${cam(2.6)}${pair(1.3)}`, each: 'bend.camera({ yaw: 0.25 + 0.06*t });', stills: [0.4, 1.2],
});
// asleep: the puddle, then the rise
takes.push({
  name: 'puddle', query: 'play&two&dress=fire,water&world=redwoods', fps: 4, seconds: 5, warm: 60, sheet: { cols: 5, rows: 4, width: 320 },
  setup: `${dusk}${cam(3.5, 0.4, 38)}bend.place(0,-0.8,0.3,Math.PI/2); bend.place(1,0.8,0.3,-Math.PI/2);`,
  cues: { '1.5': 'bend.wake();' }, each: 'bend.camera({ yaw: 0.3 });', stills: [0.5, 2.5, 3.5, 4.75],
});
// a heart inside water (tide)
takes.push({
  name: 'tide', query: 'play&dress=tide&world=temple', ...short, seconds: 1.2, warm: 300,
  setup: `${cam(2.3, 0.1)}bend.wake(); bend.place(0, 0, 0, Math.PI/2);`, each: 'bend.camera({ yaw: 0.25 });', stills: [0.4, 1.0],
});
// the locked game view, the Pool
takes.push({
  name: 'lock-pool', query: 'jogo=partner&world=pool&dress=fire,water', fps: 2, seconds: 4, warm: 1, sheet: { cols: 4, rows: 2, width: 400 },
  setup: 'await bend.jogo.start(); await bend.step(240);', stills: [1, 3],
});
// a set-ice bridge in the geode
takes.push({
  name: 'bridge', query: 'dress=water,gems&world=geode', fps: 5, seconds: 0.6, warm: 200, sheet: { cols: 3, rows: 1, width: 400 },
  setup: "bend.set('ice', { demo: 'bridge' }); bend.shoot('wide'); bend.camera({ yaw: 0, dist: 6 });", stills: [0.4],
});
// water through a live gate (the geode's door into the redwoods)
takes.push({
  name: 'door', query: 'gates&dress=water,water&world=geode', fps: 5, seconds: 1.0, warm: 400, sheet: { cols: 5, rows: 1, width: 400 },
  setup: `${dusk}bend.wake(); bend.shoot('wide');`, each: 'bend.camera({ yaw: 0, dist: 6.5, pitch: 0.05 });', stills: [0.8],
});

writeFileSync('scripts/steps/water-7.json', JSON.stringify(takes, null, 1));
console.log(`${takes.length} takes`);
