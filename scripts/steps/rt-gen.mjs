// The redwoods' and the temple's re-take (report 4): the critic's world takes (critic-worlds.json) under new names, at a
// lower frame rate where only stills and sheets are wanted, plus the hours of the redwoods, the temple's tides and moon,
// gem dancers and ?baseline. Writes scripts/steps/rt-worlds.json:
//   node scripts/steps/rt-gen.mjs && node scripts/critic-cap.mjs scripts/steps/rt-worlds.json --url http://[::1]:5428/energybending/ --only rt-rw-hours
// Each take's sheet and stills land as docs/reports/media/3-<name>-*.jpg (critic-cap's naming); the report copies the
// ones it keeps to 4-*.
import { writeFileSync } from 'node:fs';

const orbit = 'bend.camera({ idle:0, yaw: t*0.5236, dist: 9, pitch: 0.1, height: 1.6, fov: 50 });';
const onLedges = (w) => `const L=(bend.rig.plane?.ledges??[]).filter(l=>!l.bob).slice().sort((a,b)=>a.x0-b.x0); const cs=bend.show.dancers.map(d=>d.controller).filter(c=>c.kind==='intent'); if(L.length){ const a=L[0], b=L[L.length-1]; cs[0].character.reset((a.x0+a.x1)/2, a.y+0.15); cs[1].character.reset((b.x0+b.x1)/2, b.y+0.15);} console.warn('ledges ${w}', JSON.stringify(L));`;
const dusk = "bend.set('redwoods', { hour: 19.4, dayGoes: false });";
const free = "bend.set('camera',{ shots:false, autoOrbit:false });";
// a list of views, one a second: [yaw, dist, pitch, height, fov, js run first]
const views = (vs) => `const V=${JSON.stringify(vs.map((v) => v.slice(0, 5)))}; const X=[${vs.map((v) => `async()=>{${v[5] ?? ''}}`).join(',')}]; const i=Math.min(V.length-1, Math.round(t)); await X[i](); const [yaw,dist,pitch,height,fov]=V[i]; bend.camera({ idle:0, yaw, dist, pitch, height, fov });`;

const lock = (name, world, extra = {}) => ({
  name, query: `play&two&dress=${extra.dress ?? 'fire,water'}&world=${world}${extra.q ?? ''}`, fps: extra.fps ?? 10, seconds: extra.seconds ?? 6, warm: 120,
  setup: `${extra.setup ?? ''} bend.wake(); bend.lock(true);`,
  cues: { '0.2': onLedges(world), ...(extra.moves === false ? {} : { '2.5': "bend.move(0,'armada')", '3.6': "bend.move(1,'meia-lua')", '4.8': "bend.move(0,'spin')" }) },
  sheet: { cols: 4, rows: 3, width: 400 }, stills: extra.stills ?? [2, 3, 4.2], ...(extra.timings === false ? {} : { timingsAt: 2 }),
});

const takes = [
  { name: 'rt-rw-empty', query: 'world=redwoods&dress=fire', fps: 4, seconds: 12, warm: 60, setup: free + dusk, each: orbit, sheet: { cols: 8, rows: 6, width: 300 }, stills: [0, 3, 6, 9] },
  lock('rt-rw-lock', 'redwoods', { setup: dusk }),
  lock('rt-rw-lock-gems', 'redwoods', { setup: dusk, dress: 'gems,gems', moves: false, seconds: 3, stills: [2], timings: false }),
  // the hours, and the things the critique named, close: day, dusk, night with the lanterns
  {
    name: 'rt-rw-hours', query: 'world=redwoods&dress=fire', fps: 1, seconds: 8, warm: 60, setup: free + dusk,
    each: views([
      [0.3, 9, 0.1, 1.6, 50, "bend.set('redwoods',{hour:12.5})"],
      [0.3, 9, 0.1, 1.6, 50, "bend.set('redwoods',{hour:19.4})"],
      [0.3, 9, 0.1, 1.6, 50, "bend.set('redwoods',{hour:21.6})"],
      [2.2, 6, -0.25, 2.2, 30, "bend.set('redwoods',{hour:21.6})"],
      [1.2, 5, 0.15, 1.2, 40, "bend.set('redwoods',{hour:19.4})"],
      [3.6, 6, 0.05, 1.4, 45, "bend.set('redwoods',{hour:19.4})"],
      [4.6, 8, 0.05, 2.0, 50, "bend.set('redwoods',{hour:19.4})"],
      [-1.4, 9, 0.12, 2.5, 50, "bend.set('redwoods',{hour:21.6})"],
    ]),
    sheet: { cols: 4, rows: 2, width: 480 }, stills: [0, 1, 2, 3, 4, 5, 6, 7],
  },
  { name: 'rt-rw-base', query: 'world=redwoods&dress=fire&baseline', fps: 1, seconds: 1, warm: 120, setup: free + dusk, each: 'bend.camera({ idle:0, yaw: 0.3, dist: 9, pitch: 0.1, height: 1.6, fov: 50 });', sheet: { cols: 1, rows: 1, width: 640 }, stills: [0] },
  { name: 'rt-tm-empty', query: 'world=temple&dress=fire', fps: 4, seconds: 12, warm: 60, setup: free, each: orbit, sheet: { cols: 8, rows: 6, width: 300 }, stills: [0, 3, 6, 9] },
  lock('rt-tm-lock', 'temple'),
  lock('rt-tm-lock-gems', 'temple', { dress: 'gems,gems', moves: false, seconds: 3, stills: [2], timings: false }),
  {
    name: 'rt-tm-tides', query: 'world=temple&dress=fire', fps: 1, seconds: 7, warm: 60, setup: free,
    each: views([
      [0, 9, 0.12, 1.6, 50, "bend.set('temple',{tideHold:0})"],
      [0, 9, 0.12, 1.6, 50, "bend.set('temple',{tideHold:0.5})"],
      [0.5, 5, 0.05, 1.2, 35, "bend.set('temple',{tideHold:0.25})"],
      [0, 14, -0.08, 1.2, 22, "bend.set('temple',{tideHold:0.4})"],
      [2.6, 9, 0.12, 1.6, 50, "bend.set('temple',{tideHold:0.3})"],
      [3.4, 6, 0.2, 1.4, 45, "bend.set('temple',{tideHold:0.1})"],
      [-0.7, 4, 0.05, 1.0, 40, "bend.set('temple',{tideHold:0.45})"],
    ]),
    sheet: { cols: 4, rows: 2, width: 480 }, stills: [0, 1, 2, 3, 4, 5, 6],
  },
  { name: 'rt-tm-base', query: 'world=temple&dress=fire&baseline', fps: 1, seconds: 1, warm: 120, setup: free, each: 'bend.camera({ idle:0, yaw: 0, dist: 9, pitch: 0.12, height: 1.6, fov: 50 });', sheet: { cols: 1, rows: 1, width: 640 }, stills: [0] },
  // the cost: gem dancers (the show's own), a wide free view at dusk / at moonrise, the profiler over 150 frames
  { name: 'rt-rw-time', query: 'world=redwoods', fps: 1, seconds: 1, warm: 240, setup: free + dusk, each: 'bend.camera({ idle:0, yaw: 0.3, dist: 9, pitch: 0.1, height: 1.6, fov: 50 });', sheet: { cols: 1, rows: 1, width: 640 }, stills: [0], timings: true },
  { name: 'rt-tm-time', query: 'world=temple', fps: 1, seconds: 1, warm: 240, setup: free, each: 'bend.camera({ idle:0, yaw: 0, dist: 9, pitch: 0.12, height: 1.6, fov: 50 });', sheet: { cols: 1, rows: 1, width: 640 }, stills: [0], timings: true },
];
writeFileSync(new URL('./rt-worlds.json', import.meta.url), JSON.stringify(takes, null, 1) + '\n');
console.log(takes.map((t) => t.name).join(' '));
