// Task 6 of the second critique (docs/reports/7-temple-redwoods.md): the temple and the redwoods, film polish. The
// critic's takes for these two worlds re-shot with the time pinned (the temple's tide held, the redwoods at dusk, so a
// before and an after are the same moment), plus the lead shot's framing, the locks at 1080p, a close look at the log's
// end and the moon, the 1080p timings and ?baseline. One take per run (each well under a minute under the lock):
//   node scripts/steps/tr7-gen.mjs && node scripts/critic-cap.mjs scripts/steps/tr7.json --only <take> --prefix 7 --shots shots/tr7 --url http://[::1]:5456/energybending/
import { writeFileSync } from 'node:fs';

const takes = [];
const dusk = "bend.set('redwoods', { hour: 19.4, dayGoes: false }); ";
const moonrise = "bend.set('temple', { tideHold: 0.12 }); ";
const pair = (gap) => `bend.wake(); bend.place(0,${-gap / 2},0.3,Math.PI/2); bend.place(1,${gap / 2},0.3,-Math.PI/2);`;

// ---------------------------------------------------------------- the temple
// the critic's orbit at 8 m (6-w-temple), the tide held
takes.push({
  name: 'w-temple', query: 'play&two&dress=fire,water&world=temple', fps: 4, seconds: 12, warm: 300,
  setup: `${moonrise}bend.set('camera', { followDist: 8, followFov: 44, followPitch: 0.18, followSwing: 0 }); ${pair(1.6)}`,
  each: 'bend.camera({ yaw: t * 0.52 });', sheet: { cols: 8, rows: 3, width: 250 }, stills: [0, 2.5, 3, 3.5, 6, 9],
});
// the orange side at 1080p, full size: the colonnade and the lintel's columns against the afterglow, then the moon close
// (its halo and the thin cloud: banding, a hard edge)
takes.push({
  name: 'tm-orange', query: 'world=temple', size: '1920x1080', fps: 30, seconds: 5, warm: 120,
  setup: `${moonrise}bend.set('camera',{ shots:false, autoOrbit:false });`,
  each: "const V=[[1.3,8,0.18,1.6,44,[0,1,0]],[1.7,8,0.18,1.6,44,[0,1,0]],[2.4,7,0.12,1.6,44,[0,1,0]],[0.02,30,-0.12,0,16,[0.5,5.6,-30]],[0.02,30,-0.135,0,5,[1.5,5.6,-30]]]; const v=V[Math.min(V.length-1,Math.floor(t))]; bend.camera({ idle:0, target:v[5], yaw:v[0], dist:v[1], pitch:v[2], height:v[3], fov:v[4] });",
  sheet: { cols: 5, rows: 1, width: 384 }, stills: [0.9, 1.9, 2.9, 3.9, 4.9],
});
// film 2's dolly as the critic staged it (6-film2-dolly), the tide held: the lead shot is its frame at 3.6 s
takes.push({
  name: 'film2-dolly', query: 'play&two&dress=fire,water&world=temple', size: '1920x1080', fps: 10, seconds: 8, warm: 300,
  setup: `${moonrise}bend.set('camera', { followFov: 34, followSwing: 0 }); ${pair(1.8)}`,
  cues: { '3': "bend.move(0,'armada')", '5.5': "bend.move(1,'au')" },
  each: "bend.set('camera', { followDist: 8 - t*0.6, followPitch: 0.04 + t*0.01 }); bend.camera({ yaw: 0.1 + t*0.05 });",
  sheet: { cols: 8, rows: 2, width: 320 }, stills: [0.5, 3.6, 6.2, 7.9],
});
// the lead shot as the revised shot list has it (film 2, shot 3): 3 m, side-on, low, the pair 2.4 m apart, an armada
takes.push({
  name: 'tm-lead', query: 'play&two&dress=fire,water&world=temple', size: '1920x1080', fps: 10, seconds: 4, warm: 300,
  setup: `${moonrise}bend.set('camera', { followFov: 34, followSwing: 0, followDist: 4.2, followPitch: 0.03 }); ${pair(2.4)}`,
  cues: { '1': "bend.move(0,'armada')" },
  each: 'bend.camera({ yaw: 0.22 + t*0.12 });',
  sheet: { cols: 8, rows: 2, width: 320 }, stills: [0.5, 1.6, 2.2, 3.5],
});
// the locked stage, fire and water on the two broken pillars, at 1080p
const ledgesUp = (w) => `const L=(bend.rig.plane?.ledges??[]).filter(l=>!l.bob).slice().sort((a,b)=>a.x0-b.x0); const cs=bend.show.dancers.map(d=>d.controller).filter(c=>c.kind==='intent'); if(L.length){ const a=L[0], b=L[L.length-1]; cs[0].character.reset((a.x0+a.x1)/2, a.y+0.15); cs[1].character.reset((b.x0+b.x1)/2, b.y+0.15);} console.warn('ledges ${w}', JSON.stringify(L));`;
takes.push({
  name: 'tm-lock', query: 'play&two&dress=fire,water&world=temple', size: '1920x1080', fps: 10, seconds: 4, warm: 120,
  setup: `${moonrise}bend.wake(); bend.lock(true);`,
  cues: { '0.2': ledgesUp('temple'), '2.5': "bend.move(0,'armada')" },
  sheet: { cols: 8, rows: 2, width: 320 }, stills: [2, 3.5],
});

// ---------------------------------------------------------------- the redwoods
// the critic's jogo at 1080p (6-t-redwoods-jogo-0p5), with its timings
takes.push({ name: 't-redwoods-jogo', query: 'jogo=partner&world=redwoods&dress=fire,water', size: '1920x1080', fps: 2, seconds: 1, warm: 300, setup: `${dusk}await bend.jogo.start();`, timings: true, sheet: { cols: 2, rows: 1, width: 640 }, stills: [0.5] });
// the integration's lock (5-ba-w-redwoods-lock), at 1080p: the dancers on the log and the low bough
takes.push({
  name: 'rw-lock', query: 'play&two&dress=fire,water&world=redwoods', size: '1920x1080', fps: 10, seconds: 4, warm: 120,
  setup: `${dusk}bend.wake(); bend.lock(true);`,
  cues: { '0.2': ledgesUp('redwoods'), '2.5': "bend.move(0,'armada')" },
  sheet: { cols: 8, rows: 2, width: 320 }, stills: [0.5, 2, 3.5],
});
// the log's broken end, close, from the front and from its side, and the log in the dusk light from the lock's side
takes.push({
  name: 'rw-logend', query: 'world=redwoods', size: '1920x1080', fps: 30, seconds: 4, warm: 120,
  setup: `${dusk}bend.set('camera',{ shots:false, autoOrbit:false });`,
  each: "const V=[[1.2,3.2,0.12,0.6,40],[0.5,3.6,0.18,0.6,40],[2.0,3.0,0.1,0.6,40],[0.1,7,0.08,1.0,40]]; const v=V[Math.min(V.length-1,Math.floor(t))]; bend.camera({ idle:0, target:[-2.2,0,-0.25], yaw:v[0], dist:v[1], pitch:v[2], height:v[3], fov:v[4] });",
  sheet: { cols: 4, rows: 1, width: 480 }, stills: [0.9, 1.9, 2.9, 3.9],
});

// ---------------------------------------------------------------- cost and the baseline
const t1080 = (name, query, setup) => takes.push({ name, query, size: '1920x1080', fps: 2, seconds: 1, warm: 300, setup, timings: true, sheet: { cols: 2, rows: 1, width: 640 }, stills: [0.5] });
t1080('t-temple-pair', 'play&two&dress=fire,water&world=temple', `${moonrise}bend.set('camera', { followDist: 4, followFov: 40, followPitch: 0.08 }); ${pair(1.4)}`);
t1080('t-redwoods-pair', 'play&two&dress=fire,water&world=redwoods', `${dusk}bend.set('camera', { followDist: 4, followFov: 40, followPitch: 0.08 }); ${pair(1.4)}`);
takes.push({ name: 'base', query: 'world=temple&dress=fire&baseline', fps: 1, seconds: 2, warm: 120, setup: `${moonrise}${dusk}bend.set('camera',{ shots:false, autoOrbit:false });`, each: "if (t > 0.5) await bend.world('redwoods'); bend.camera({ idle:0, yaw: t > 0.5 ? 0.3 : 0, dist: 9, pitch: 0.1, height: 1.6, fov: 50 });", sheet: { cols: 2, rows: 1, width: 640 }, stills: [0, 1] });

writeFileSync('scripts/steps/tr7.json', JSON.stringify(takes, null, 1));
console.log(`scripts/steps/tr7.json: ${takes.length} takes`);
