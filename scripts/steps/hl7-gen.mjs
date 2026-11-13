// Writes scripts/steps/hl7.json: the takes for report 7 (highlights, glows and reflections), each a few seconds, run
// one at a time with scripts/critic-cap.mjs (the shared render lock is held for one take only):
//   node scripts/critic-cap.mjs scripts/steps/hl7.json --only fw-temple --prefix 7h --shots shots/hl7
// fire behind and in front of water (temple, Pool), a fire core and a plasma hand close and at game distance, bloom
// on gems and on the moon, reflections of fire, water and gem dancers at calm and at strong ripple, the locked view's
// stage dim at 0 and at a tasteful value in each world. The critic's own takes are in critic6.json.
import { writeFileSync } from 'node:fs';

const pair = 'bend.wake(); bend.place(0,-0.65,0.3,Math.PI/2); bend.place(1,0.65,0.3,-Math.PI/2);';
const close = "bend.set('camera', { followDist: 2.8, followFov: 40, followPitch: 0.08, followSwing: 0 });";
// strong ripple: pushes at each dancer's feet and round them, every frame
const stir = (world) => `const w = bend.worlds.find((x) => x.id === '${world}'); for (const d of bend.show.dancers) { const J = d.skeleton.world; for (let k = 0; k < 3; k++) w.ripple(J[0] + Math.sin(t * 9 + k * 2.1) * 0.5, J[2] + Math.cos(t * 7 + k * 2.1) * 0.5, 1.2, 0.18); }`;

const takes = [];
// fire behind water, then in front: the camera swung round the pair so one stands in front of the other
for (const world of ['temple', 'pool']) {
  takes.push({
    name: `fw-${world}`, query: `play&two&dress=fire,water&world=${world}`, fps: 5, seconds: 2, warm: 300,
    setup: close + pair, cues: { '0': "bend.move(0,'armada')", '1': "bend.move(0,'armada')" },
    each: 'bend.camera({ yaw: t < 1 ? 0.25 + 1.35 : 0.25 - 1.35 });',
    sheet: { cols: 5, rows: 2, width: 320 }, stills: [0.6, 1.6],
  });
}
// a fire core and a plasma hand, close and at game distance
for (const [name, dress, world] of [['core-fire', 'fire,water', 'redwoods'], ['core-plasma', 'plasma,ice', 'geode']]) {
  takes.push({
    name, query: `play&two&dress=${dress}&world=${world}`, fps: 5, seconds: 2, warm: 300,
    setup: close + pair, cues: { '0.2': "bend.move(0,'armada')", '1.2': "bend.move(0,'meia-lua')" },
    each: "bend.set('camera', { followDist: t < 1 ? 2.4 : 6 }); bend.camera({ yaw: 0.25 });",
    sheet: { cols: 5, rows: 2, width: 320 }, stills: [0.6, 1.6],
  });
}
// bloom on gems and on the moon: the Pool's locked view looks at the moon; the geode close on gems
takes.push({ name: 'bloom-pool-moon', query: 'jogo=partner&world=pool&dress=gems,fire', fps: 2, seconds: 1, warm: 360, setup: 'await bend.jogo.start();', sheet: { cols: 2, rows: 1, width: 640 }, stills: [0.5] });
takes.push({ name: 'bloom-geode-gems', query: 'play&two&dress=gems,gems&world=geode', fps: 2, seconds: 1, warm: 300, setup: close + pair, each: 'bend.camera({ yaw: 0.25 });', sheet: { cols: 2, rows: 1, width: 640 }, stills: [0.5] });
// reflections of fire, water and gem dancers at calm and at strong ripple (the locked jogo view and a low free view)
for (const world of ['pool', 'temple']) {
  for (const dress of ['fire,water', 'gems,water']) {
    takes.push({
      name: `refl-${world}-${dress.replace(',', '-')}`, query: `play&two&dress=${dress}&world=${world}`, fps: 5, seconds: 2.4, warm: 300,
      setup: "bend.set('camera', { followDist: 4.5, followFov: 40, followPitch: 0.02, followSwing: 0 });" + pair,
      cues: { '0.4': "bend.move(0,'armada')" },
      each: `bend.camera({ yaw: 0.25 }); if (t > 1.0) { ${stir(world)} }`,
      sheet: { cols: 6, rows: 2, width: 320 }, stills: [0.8, 2.2],
    });
  }
}
// the temple's waterline (film 2's opening dolly at 8 m, where the critic saw the glitter row) and the strong ripple
// there; and the partner in the temple at 24 s (the critic's fire-through-water still), fewer frames
takes.push({
  name: 'waterline-temple', query: 'play&two&dress=fire,water&world=temple', size: '1920x1080', fps: 5, seconds: 1.2, warm: 300,
  setup: "bend.set('camera', { followFov: 34, followSwing: 0, followDist: 7.7, followPitch: 0.045 }); bend.wake(); bend.place(0,-0.9,0.3,Math.PI/2); bend.place(1,0.9,0.3,-Math.PI/2);",
  each: `bend.camera({ yaw: 0.1 }); if (t > 0.5) { ${stir('temple')} }`, sheet: { cols: 6, rows: 1, width: 320 }, stills: [0.2, 1.0],
});
takes.push({ name: 'partner-temple-24', query: 'jogo=partner&world=temple&dress=fire,water', fps: 1, seconds: 3, warm: 1380, setup: 'await bend.jogo.start();', sheet: { cols: 3, rows: 1, width: 640 }, stills: [0, 1, 2] });
// the locked view's stage dim: 0, then a tasteful value, in each world
for (const world of ['geode', 'redwoods', 'pool', 'temple', 'forge']) {
  takes.push({
    name: `dim-${world}`, query: `jogo=partner&world=${world}&dress=fire,water`, fps: 2, seconds: 2, warm: 300, setup: 'await bend.jogo.start();',
    each: "bend.set('post', { stageDim: t < 1 ? 0 : 0.6 });", sheet: { cols: 4, rows: 1, width: 480 }, stills: [0.5, 1.5],
  });
}
// the post chain's cost at 1080p: the critic's scenes, timed after 150 stepped frames
takes.push({ name: 't-temple-pair', query: 'play&two&dress=fire,water&world=temple', size: '1920x1080', fps: 2, seconds: 0.5, warm: 300, setup: "bend.set('camera', { followDist: 4, followFov: 40, followPitch: 0.08 });" + pair.replace('0.65', '0.7').replace('0.65', '0.7'), timings: true, sheet: { cols: 1, rows: 1, width: 640 } });
takes.push({ name: 't-pool-pair', query: 'play&two&dress=fire,water&world=pool', size: '1920x1080', fps: 2, seconds: 0.5, warm: 300, setup: "bend.set('camera', { followDist: 4, followFov: 40, followPitch: 0.08 });" + pair, timings: true, sheet: { cols: 1, rows: 1, width: 640 } });
takes.push({ name: 't-redwoods-pair', query: 'play&two&dress=fire,water&world=redwoods', size: '1920x1080', fps: 2, seconds: 0.5, warm: 300, setup: "bend.set('camera', { followDist: 4, followFov: 40, followPitch: 0.08 });" + pair, timings: true, sheet: { cols: 1, rows: 1, width: 640 } });
takes.push({ name: 't-hub-pair', query: 'play&two&dress=fire,water', size: '1920x1080', fps: 2, seconds: 0.5, warm: 300, setup: "bend.set('camera', { followDist: 6, followFov: 40, followPitch: 0.08 });" + pair, timings: true, sheet: { cols: 1, rows: 1, width: 640 } });

// the hub's gates: timings facing four ways (the passes named glow.gN / air.gN are the live gate views)
for (const yaw of [0, 1.6, 3.1, 4.7]) {
  takes.push({ name: `t-hub-gates-${String(yaw).replace('.', 'p')}`, query: 'play&two&dress=fire,water', size: '1920x1080', fps: 2, seconds: 0.5, warm: 200, setup: "bend.set('camera', { followDist: 6, followFov: 40, followPitch: 0.08, followSwing: 0 });" + pair + `bend.camera({ yaw: ${yaw} });`, each: `bend.camera({ yaw: ${yaw} });`, timings: true, sheet: { cols: 1, rows: 1, width: 640 } });
}

writeFileSync(new URL('./hl7.json', import.meta.url), JSON.stringify(takes, null, 1) + '\n');
console.log(`${takes.length} takes: ${takes.map((t) => t.name).join(' ')}`);
