// Writes the critic's step files (scripts/steps/critic-*.json) for scripts/critic-cap.mjs: node scripts/steps/critic-gen.mjs
import { writeFileSync } from 'node:fs';
const out = (name, takes) => writeFileSync(new URL(`./critic-${name}.json`, import.meta.url), JSON.stringify(takes, null, 1));
const dusk = "bend.set('redwoods', { hour: 19.4, dayGoes: false });";
const follow = (d, fov, pitch) => `bend.set('camera', { followDist: ${d}, followFov: ${fov}, followPitch: ${pitch}, followSwing: 0 });`;

// item 2: each element alone, wide and close, in the Pool (the prototype's dark stage and mirror)
out('elements', ['fire', 'plasma', 'water', 'ice', 'gems', 'ember', 'tide', 'geodeheart'].flatMap((e) => [['wide', 6.2, 44], ['close', 2.3, 40]].map(([k, d, fov]) => ({
  name: `el-${e}-${k}`, query: `play&dress=${e}&world=pool`, fps: 30, seconds: 6, warm: 240,
  setup: `${follow(d, fov, 0.1)} bend.wake(); bend.place(0, 0, 0, Math.PI/2);`,
  cues: { '0.6': "bend.move(0,'armada')", '1.8': "bend.move(0,'meia-lua')", '3.0': "bend.move(0,'au')", '4.3': "bend.move(0,'esquiva')", '5.0': "bend.move(0,'spin')" },
  each: 'bend.camera({ yaw: 0.25 + 0.06*t });', sheet: { cols: 4, rows: 3, width: 400 }, stills: [0.3, 1.2, 3.4], timingsAt: k === 'close' ? 0.5 : undefined,
}))));

// item 3: each world empty (an orbit: the fire dancers asleep are out), and locked with two dancers on its ledges
const ledges = (id) => `const L=(bend.rig.plane?.ledges??[]).filter(l=>!l.bob).slice().sort((a,b)=>a.x0-b.x0); const cs=bend.show.dancers.map(d=>d.controller).filter(c=>c.kind==='intent'); if(L.length){ const a=L[0], b=L[L.length-1]; cs[0].character.reset((a.x0+a.x1)/2, a.y+0.15); cs[1].character.reset((b.x0+b.x1)/2, b.y+0.15);} else { bend.place(0,-2.4,0); bend.place(1,2.4,0);} console.warn('ledges ${id}', JSON.stringify(L));`;
out('worlds', ['geode', 'redwoods', 'pool', 'temple', 'forge'].flatMap((id) => [
  { name: `w-${id}-empty`, query: `world=${id}&dress=fire`, fps: 4, seconds: 12, warm: 60,
    setup: `bend.set('camera',{ shots:false, autoOrbit:false }); ${id === 'redwoods' ? dusk : ''}`,
    each: 'bend.camera({ idle:0, yaw: t*0.5236, dist: 9, pitch: 0.1, height: 1.6, fov: 50 });', sheet: { cols: 8, rows: 6, width: 300 }, stills: [0, 3, 6, 9] },
  { name: `w-${id}-lock`, query: `play&two&dress=fire,water&world=${id}`, fps: 30, seconds: 6, warm: 120,
    setup: `${id === 'redwoods' ? dusk : ''} bend.wake(); bend.lock(true);`,
    cues: { '0.2': ledges(id), '2.5': "bend.move(0,'armada')", '3.6': "bend.move(1,'meia-lua')", '4.8': "bend.move(0,'spin')" },
    sheet: { cols: 4, rows: 3, width: 400 }, stills: [2.0, 3.0, 4.2], timingsAt: 2.0 },
]));

// item 4: the capoeira moves on fire and water bodies, each side attacking in turn
const mv = ['armada', 'meia-lua', 'martelo', 'bencao', 'rasteira', 'au', 'macaco', 'role', 'spin', 'strike'];
const resp = ['esquiva', 'esquiva', 'block', 'esquiva', 'esquiva', 'esquiva', 'role', 'esquiva', 'esquiva', 'block'];
out('moves', [[0, 1, 'fire'], [1, 0, 'water']].map(([p, q, tag]) => {
  const cues = {};
  mv.forEach((n, i) => { cues[(0.5 + i * 1.5).toFixed(2)] = `bend.move(${p},'${n}')`; cues[(0.7 + i * 1.5).toFixed(2)] = `bend.move(${q},'${resp[i]}')`; });
  return { name: `moves-${tag}`, query: 'play&two&dress=fire,water&world=geode', fps: 30, seconds: 15.5, warm: 200,
    setup: `${follow(4.2, 42, 0.08)} bend.wake(); bend.place(0,-0.75,0,Math.PI/2); bend.place(1,0.75,0,-Math.PI/2);`,
    cues, each: 'bend.camera({ yaw: 0.15 });', sheet: { cols: 6, rows: 5, width: 360 }, stills: mv.map((_, i) => +(0.5 + i * 1.5 + 0.45).toFixed(2)) };
}));

// item 6: a kick at 60 fps frame by frame, and the ginga between moves
out('motion', [
  ...['fire', 'water', 'gems'].map((e) => ({ name: `mo-${e}`, query: `play&dress=${e}&world=geode`, fps: 60, seconds: 0.8, warm: 240,
    setup: `${follow(3.0, 42, 0.06)} bend.wake(); bend.place(0,0,0,Math.PI/2); bend.camera({yaw:0});`,
    cues: { 0: "bend.move(0,'armada')" }, each: 'bend.camera({ yaw: 0 });', sheet: { cols: 8, rows: 6, width: 240 }, stills: [0.2, 0.35, 0.5] })),
  ...['fire', 'water'].map((e) => ({ name: `ginga-${e}`, query: `play&dress=${e}&world=geode`, fps: 15, seconds: 3.2, warm: 240,
    setup: `${follow(3.0, 42, 0.06)} bend.wake(); bend.place(0,0,0,Math.PI/2);`, each: 'bend.camera({ yaw: 0 });', sheet: { cols: 8, rows: 6, width: 240 } })),
]);

// item 5: the hub, a crossing each way, the other dancer seen inside a gate
out('gates', [
  { name: 'gate-geode-to-redwoods', query: 'play&dress=fire&world=geode', fps: 30, seconds: 5, warm: 200,
    setup: `${dusk} ${follow(3.6, 46, 0.12)} bend.wake(); bend.place(0,1.77,3.66,0.45); bend.camera({yaw:-2.69});`,
    cues: { '0.8': 'bend.intent(0,{ moveZ: 0.6 })', '4.0': 'bend.intent(0,{ moveZ: 0 })' }, each: 'if (t<0.8) bend.camera({yaw:-2.69});',
    sheet: { cols: 6, rows: 4, width: 400 }, stills: [0.5, 2.2, 3.0, 4.6] },
  { name: 'gate-redwoods-to-geode', query: 'play&dress=water&world=redwoods', fps: 30, seconds: 5, warm: 200,
    setup: `${dusk} ${follow(3.6, 46, 0.12)} bend.wake(); bend.place(0,-4.52,-3.81,-2.29); bend.camera({yaw:0.86});`,
    cues: { '0.8': 'bend.intent(0,{ moveZ: 0.6 })', '4.0': 'bend.intent(0,{ moveZ: 0 })' }, each: 'if (t<0.8) bend.camera({yaw:0.86});',
    sheet: { cols: 6, rows: 4, width: 400 }, stills: [0.5, 2.2, 3.0, 4.6] },
  { name: 'gate-other-inside', query: 'play&two&dress=fire,water&world=geode', fps: 30, seconds: 4, warm: 200,
    setup: `${dusk} ${follow(4.2, 44, 0.1)} bend.wake(); bend.place(0,1.5,3.0,0.45); bend.gates.place(bend.show.dancers[1],'redwoods'); bend.place(1,-4.6,-3.9,-2.29); bend.camera({yaw:-2.69});`,
    cues: { '1.0': "bend.move(1,'armada')", '2.5': "bend.move(1,'au')" }, each: 'bend.camera({yaw:-2.69});',
    sheet: { cols: 4, rows: 3, width: 400 }, stills: [0.8, 1.5, 3.0] },
  { name: 'hub', query: 'world=geode&dress=fire', fps: 4, seconds: 8, warm: 60,
    setup: "bend.set('camera',{ shots:false, autoOrbit:false });", each: 'bend.camera({ idle:0, yaw: 2.6 + t*0.25, dist: 5.5, pitch: 0.05, height: 1.4, fov: 60 });',
    sheet: { cols: 8, rows: 4, width: 300 }, stills: [0, 4, 7], timingsAt: 4 },
]);

// costs at 1280x800 and 1920x1080
out('timings', [['1280x800', '800'], ['1920x1080', '1080']].flatMap(([size, tag]) => [
  { name: `t${tag}-redwoods-close`, size, query: 'play&two&dress=fire,water&world=redwoods', fps: 30, seconds: 2, warm: 400,
    setup: `${dusk} ${follow(3.2, 46, 0.12)} bend.wake(); bend.place(0,-0.6,0.4,Math.PI/2); bend.place(1,0.6,0.4,-Math.PI/2); bend.move(0,'armada');`,
    sheet: { cols: 2, rows: 1, width: 640 }, timings: true, stills: [1] },
  { name: `t${tag}-geode-hub-pair`, size, query: 'play&two&dress=fire,water&world=geode', fps: 30, seconds: 2, warm: 400,
    setup: `${follow(5.5, 50, 0.12)} bend.wake(); bend.place(0,-0.6,1.0,Math.PI/2); bend.place(1,0.6,1.0,-Math.PI/2); bend.camera({yaw:-2.9});`,
    each: 'bend.camera({yaw:-2.9});', sheet: { cols: 2, rows: 1, width: 640 }, timings: true, stills: [1] },
  { name: `t${tag}-ice-plasma`, size, query: 'play&two&dress=plasma,ice&world=temple', fps: 30, seconds: 2, warm: 400,
    setup: `${follow(3.4, 46, 0.1)} bend.wake(); bend.place(0,-0.6,0,Math.PI/2); bend.place(1,0.6,0,-Math.PI/2);`,
    sheet: { cols: 2, rows: 1, width: 640 }, timings: true, stills: [1] },
]));
