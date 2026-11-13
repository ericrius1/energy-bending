// Writes the cameras' step files (scripts/steps/cameras-*.json) for scripts/critic-cap.mjs: node scripts/steps/cameras-gen.mjs
// The critic's takes for task 4 (critic-gates, critic-film with both gate placements, the five w-*-lock), re-staged as
// short takes at a lower frame rate (the shared GPU lock is held briefly: run one take at a time with --only), plus a
// leap and a cartwheel in the lock, and a round trip through a door with the mean brightness of every frame
// (`luma` in the take: the brightness across a crossing).
import { writeFileSync } from 'node:fs';
const out = (name, takes) => writeFileSync(new URL(`./cameras-${name}.json`, import.meta.url), JSON.stringify(takes, null, 1));
const dusk = "bend.set('redwoods', { hour: 19.4, dayGoes: false });";
const follow = (d, fov, pitch, swing = 0) => `bend.set('camera', { followDist: ${d}, followFov: ${fov}, followPitch: ${pitch}, followSwing: ${swing} });`;

// the critic's gate takes (critic-gates.json), as they were, and the same walks with the camera left to swing behind
out('gates', [
  { name: 'cam-g2r', query: 'play&dress=fire&world=geode', fps: 15, seconds: 5, warm: 200,
    setup: `${dusk} ${follow(3.6, 46, 0.12)} bend.wake(); bend.place(0,1.77,3.66,0.45); bend.camera({yaw:-2.69});`,
    cues: { '0.8': 'bend.intent(0,{ moveZ: 0.6 })', '4.0': 'bend.intent(0,{ moveZ: 0 })' }, each: 'if (t<0.8) bend.camera({yaw:-2.69});',
    sheet: { cols: 6, rows: 4, width: 400 }, stills: [2.2, 3.0, 4.6] },
  { name: 'cam-r2g', query: 'play&dress=water&world=redwoods', fps: 15, seconds: 5, warm: 200,
    setup: `${dusk} ${follow(3.6, 46, 0.12)} bend.wake(); bend.place(0,-4.52,-3.81,-2.29); bend.camera({yaw:0.86});`,
    cues: { '0.8': 'bend.intent(0,{ moveZ: 0.6 })', '4.0': 'bend.intent(0,{ moveZ: 0 })' }, each: 'if (t<0.8) bend.camera({yaw:0.86});',
    sheet: { cols: 6, rows: 4, width: 400 }, stills: [2.2, 3.0, 4.6] },
  // a walk in at an angle, the camera free to swing (the default follow): it lines up with the door on the way
  { name: 'cam-g2r-angle', query: 'play&dress=fire&world=geode', fps: 15, seconds: 6, warm: 200,
    setup: `${dusk} bend.wake(); bend.place(0,0.2,3.2,0.9); bend.camera({yaw:-2.2});`,
    cues: { '0.5': 'bend.intent(0,{ moveZ: 0.7, moveX: 0.25 })', '5.0': 'bend.intent(0,{ moveZ: 0, moveX: 0 })' },
    sheet: { cols: 6, rows: 4, width: 400 }, stills: [2.5, 3.5, 5.5] },
  { name: 'cam-other-inside', query: 'play&two&dress=fire,water&world=geode', fps: 10, seconds: 4, warm: 200,
    setup: `${dusk} ${follow(4.2, 44, 0.1)} bend.wake(); bend.place(0,1.5,3.0,0.45); bend.gates.place(bend.show.dancers[1],'redwoods'); bend.place(1,-4.6,-3.9,-2.29); bend.camera({yaw:-2.69});`,
    cues: { '1.0': "bend.move(1,'armada')", '2.5': "bend.move(1,'au')" }, each: 'bend.camera({yaw:-2.69});',
    sheet: { cols: 4, rows: 3, width: 400 }, stills: [1.5, 3.0] },
  { name: 'cam-hub', query: 'world=geode&dress=fire', fps: 4, seconds: 8, warm: 400,
    setup: "bend.set('camera',{ shots:false, autoOrbit:false });", each: 'bend.camera({ idle:0, yaw: 2.6 + t*0.25, dist: 5.5, pitch: 0.05, height: 1.4, fov: 60 });',
    sheet: { cols: 8, rows: 4, width: 300 }, stills: [0, 4, 7] },
  // the fly path through the hub's redwoods door and back (portals' ?fly): every frame's mean brightness is the
  // brightness across a crossing (ffmpeg signalstats over shots/critic/cam-fly)
  { name: 'cam-fly', query: 'world=geode&dress=fire', fps: 30, seconds: 4, warm: 300,
    setup: `${dusk} bend.set('gates', { fly: 'geode.redwoods', flySpeed: 0, flyT: -0.6, flyLength: 3 });`,
    each: "bend.set('gates', { flyT: t < 2 ? -0.6 + t * 0.6 : 0.6 - (t - 2) * 0.6 });",
    sheet: { cols: 8, rows: 4, width: 300 } },
  // ten gates in the hub's world: the farthest drop out (no warning)
  { name: 'cam-many', query: 'world=geode&dress=fire', fps: 4, seconds: 3, warm: 200,
    setup: "bend.set('camera',{ shots:false, autoOrbit:false }); for (let k = 0; k < 4; k++) bend.gates.open({ id: 'x'+k, world: 'geode', at: [-3 + k*2, 1.35, -5.5], normal: [0,0,1], radius: 0.8, to: { world: 'temple', portal: 'y'+k } }, { id: 'y'+k, world: 'temple', at: [-4 + k*2.5, 1.4, 2], normal: [0,0,-1], radius: 0.8, to: { world: 'geode', portal: 'x'+k } });",
    each: 'bend.camera({ idle:0, yaw: 0.2 + t*0.3, dist: 6, pitch: 0.1, height: 1.4, fov: 70 });',
    sheet: { cols: 4, rows: 3, width: 400 }, stills: [2] },
]);

// critic-film.json's walk through the Pool's gate into the redwoods, the lock and the unlock, in two short takes per
// placement of the redwoods end: (a) in the meadow facing the stage, (b) at the world's own site (critic-film's)
const placements = {
  a: "{ id: 'rw.pool', world: 'redwoods', at: [2.5, 1.35, 4.5], normal: [-0.4, 0, -0.92], radius: 1.35, to: { world: 'pool', portal: 'pool.rw' } }",
  b: "{ id: 'rw.pool', world: 'redwoods', at: [-6.5, 1.35, -5.5], normal: [0.76, 0, 0.65], radius: 1.35, to: { world: 'pool', portal: 'pool.rw' } }",
};
const filmSetup = (k) => `${dusk} bend.set('camera', { followDist: 5.2, followFov: 46, followPitch: 0.16, followSwing: 0 }); bend.gates.close('geode.redwoods'); bend.gates.close('redwoods.geode'); bend.gates.open({ id: 'pool.rw', world: 'pool', at: [0, 1.35, -4.6], normal: [0, 0, 1], radius: 1.35, to: { world: 'redwoods', portal: 'rw.pool' } }, ${placements[k]}); bend.wake(); bend.place(0, -0.45, 0.2, Math.PI); bend.place(1, 0.45, 0.6, Math.PI); bend.camera({ yaw: 0 });`;
out('film', ['a', 'b'].map((k) => ({
  name: `cam-film-${k}`, query: 'play&two&dress=fire,water&world=pool', fps: 10, seconds: 12, warm: 240, setup: filmSetup(k),
  cues: {
    '0.2': 'bend.intent(0,{ moveZ: 0.75 }); bend.intent(1,{ moveZ: 0.75 });',
    '5.2': 'bend.intent(0,{ moveZ: 0 }); bend.intent(1,{ moveZ: 0 });',
    '5.6': 'bend.lock(true)',
    '7.0': "bend.move(0,'armada')", '7.3': "bend.move(1,'esquiva')", '8.4': "bend.move(1,'au')",
    '9.6': 'bend.lock(false)',
  },
  each: 'if (t < 0.2) bend.camera({ yaw: 0 });',
  sheet: { cols: 8, rows: 4, width: 300 }, stills: [3, 5, 7.5, 11.5],
})));

// the five worlds locked, two dancers on the outermost ledges, then moves (critic-worlds' w-*-lock), and a leap and a
// cartwheel in the redwoods and the geode
const ledges = "const L=(bend.rig.plane?.ledges??[]).filter(l=>!l.bob).slice().sort((a,b)=>a.x0-b.x0); const cs=bend.show.dancers.map(d=>d.controller).filter(c=>c.kind==='intent'); if(L.length){ const a=L[0], b=L[L.length-1]; cs[0].character.reset((a.x0+a.x1)/2, a.y+0.15); cs[1].character.reset((b.x0+b.x1)/2, b.y+0.15);} else { bend.place(0,-2.4,0); bend.place(1,2.4,0);}";
out('lock', [
  ...['geode', 'redwoods', 'pool', 'temple', 'forge'].map((id) => ({
    name: `cam-${id}-lock`, query: `play&two&dress=fire,water&world=${id}`, fps: 10, seconds: 6, warm: 120,
    setup: `${id === 'redwoods' ? dusk : ''} bend.wake(); bend.lock(true);`,
    cues: { '0.2': ledges, '2.5': "bend.move(0,'armada')", '3.6': "bend.move(1,'meia-lua')", '4.8': "bend.move(0,'spin')" },
    sheet: { cols: 4, rows: 3, width: 400 }, stills: [2.0, 4.2],
  })),
  ...['redwoods', 'geode'].map((id) => ({
    name: `cam-${id}-leap`, query: `play&two&dress=fire,water&world=${id}`, fps: 15, seconds: 5, warm: 120,
    setup: `${id === 'redwoods' ? dusk : ''} bend.wake(); bend.lock(true);`,
    cues: {
      '0.2': ledges,
      '1.5': 'bend.intent(1,{ jump: true, jumpHeld: true, moveX: -0.8 })', '1.6': 'bend.intent(1,{ jump: false })', '2.3': 'bend.intent(1,{ jump: true })', '2.4': 'bend.intent(1,{ jump: false, jumpHeld: false, moveX: 0 })',
      '2.0': "bend.move(0,'au')", '3.4': "bend.move(0,'au')",
    },
    sheet: { cols: 5, rows: 3, width: 380 }, stills: [1.9, 2.6, 3.8],
  })),
]);
