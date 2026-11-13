// Water, wave 7 (docs/reports/9-water.md): writes water-9.json, the takes I looked at while making water read at game
// distance against bright air, rise from the floor in the front's first second, and lose its blocks and terraces close
// up. Each take runs alone well under a minute:
//   node scripts/steps/water-9-gen.mjs
//   node scripts/critic-cap.mjs scripts/steps/water-9.json --only <take> --prefix 9 --shots shots/w9 --url http://127.0.0.1:5457/energybending/
// The critic's own takes (critic6.json: t-redwoods-jogo, el-fw-redwoods-close, el-water-solo-close and the 1080p
// timings) are re-shot from that file with --prefix 9.
import { writeFileSync } from 'node:fs';

const takes = [];
const dusk = "bend.set('redwoods', { hour: 19.4, dayGoes: false }); ";
const cam = (dist, pitch = 0.08, fov = 40) => `bend.set('camera', { followDist: ${dist}, followFov: ${fov}, followPitch: ${pitch}, followSwing: 0 }); `;
const pair = (gap) => `bend.wake(); bend.place(0,${-gap / 2},0.3,Math.PI/2); bend.place(1,${gap / 2},0.3,-Math.PI/2);`;
const worlds = [['geode', ''], ['redwoods', dusk], ['pool', ''], ['temple', ''], ['forge', '']];

// fire and water at game distance (about the locked jogo's), the camera low so the heads stand against the far air;
// an armada (water) half way
for (const [w, extra] of worlds) {
  takes.push({
    name: `g-${w}`, query: `play&two&dress=fire,water&world=${w}`, fps: 5, seconds: 2, warm: 300, sheet: { cols: 5, rows: 2, width: 384 },
    setup: `${extra}${cam(7.5, 0.04)}${pair(1.6)}`, cues: { '1.0': "bend.move(1,'armada')" },
    each: 'bend.camera({ yaw: 0.25 });', stills: [0.4, 1.4],
  });
}
// the same close (the critic's el-fw distance), for every world
for (const [w, extra] of worlds) {
  takes.push({
    name: `c-${w}`, query: `play&two&dress=fire,water&world=${w}`, fps: 5, seconds: 2, warm: 300, sheet: { cols: 5, rows: 2, width: 384 },
    setup: `${extra}${cam(2.6)}${pair(1.3)}`, cues: { '0.8': "bend.move(1,'armada')" },
    each: 'bend.camera({ yaw: 0.25 + 0.06*t });', stills: [0.4, 1.2],
  });
}
// ice beside plasma, close and at game distance, in the redwoods (bright air) and the temple
for (const [w, extra] of [['redwoods', dusk], ['temple', '']]) {
  takes.push({
    name: `ice-${w}`, query: `play&two&dress=plasma,ice&world=${w}`, fps: 5, seconds: 1.2, warm: 300, sheet: { cols: 3, rows: 2, width: 400 },
    setup: `${extra}${cam(2.6)}${pair(1.3)}`, each: 'bend.camera({ yaw: 0.25 + 0.06*t });', stills: [0.4, 1.0],
  });
  takes.push({
    name: `ice-g-${w}`, query: `play&two&dress=plasma,ice&world=${w}`, fps: 5, seconds: 1.2, warm: 300, sheet: { cols: 3, rows: 2, width: 400 },
    setup: `${extra}${cam(7.5, 0.04)}${pair(1.6)}`, each: 'bend.camera({ yaw: 0.25 });', stills: [0.4],
  });
}
// an arm across the body, close: two water dancers in the temple (the critic's el-water-solo-close distance), a kick
takes.push({
  name: 'arms', query: 'play&dress=water&world=temple', fps: 10, seconds: 2, warm: 300, sheet: { cols: 5, rows: 4, width: 384 },
  setup: `${cam(1.7, 0.08)}bend.wake(); bend.place(0, 0, 0, Math.PI/2);`, cues: { '0.4': "bend.move(0,'armada')" },
  each: 'bend.camera({ yaw: 0.6 });', stills: [0.2, 0.8, 1.2, 1.8],
});
// the front's first second: the rise, frame by frame
takes.push({
  name: 'first-rise', query: '', fps: 20, seconds: 1.2, warm: 1, sheet: { cols: 6, rows: 4, width: 320 }, stills: [0.1, 0.2, 0.3, 0.5, 0.8],
});
// a body changed on the front: the fire dancer made water (its new matter rises from the floor at its feet, no rain)
takes.push({
  name: 'redress', query: '', fps: 10, seconds: 1.6, warm: 120, sheet: { cols: 4, rows: 4, width: 320 },
  setup: "const i = bend.show.dress.indexOf('fire'); bend.show.redress(i < 0 ? 1 : i, 'water');", stills: [0.2, 0.5, 1.0],
});

writeFileSync(new URL('./water-9.json', import.meta.url), JSON.stringify(takes, null, 1) + '\n');
console.log(`${takes.length} takes`);
