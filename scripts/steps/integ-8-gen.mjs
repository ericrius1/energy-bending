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

writeFileSync('scripts/steps/integ-8.json', JSON.stringify(takes, null, 1));
console.log(`${takes.length} takes: ${takes.map((t) => t.name).join(', ')}`);
