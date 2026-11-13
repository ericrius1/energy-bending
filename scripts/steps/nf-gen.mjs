// The near fade and the gates' depth of field (docs/reports/9-near-fade.md): staged takes (a fixed eye, a solid between it
// and the pair; a: off, b: on, one stepped frame apart) and the timings. node scripts/steps/nf-gen.mjs
import { writeFileSync, readFileSync } from 'node:fs';
const ab = { a: "bend.set('fade',{on:false})", b: "bend.set('fade',{on:true})" };
const stage = (name, world, idx, DD, EE, H = 1.3, extra = '') => ({
  name, query: `play&two&dress=fire,water&world=${world}`, fps: 2, seconds: 1, warm: 40, ab,
  setup: `${extra} bend.set('fade',{easeIn:0,easeOut:0}); bend.wake(); await bend.step(3);
const W=bend.worldOf(), J=bend.show.dancers[0].skeleton.world, g0=W.groundAt(J[0],J[2]), list=bend.rig.solids.list;
// (idx < 0: the nearest box 2 to 7 m from the player that stands above its floor, as the forge's raised slabs do)
const top=(s)=>s.kind==='box'?s.c[1]+Math.abs(s.h[1]*s.y[1]):Math.max(s.a[1],s.b[1])+s.r, bot=(s)=>s.kind==='box'?s.c[1]-Math.abs(s.h[1]*s.y[1]):Math.min(s.a[1],s.b[1])-s.r;
const mid=(s)=>s.kind==='box'?[s.c[0],s.c[2]]:[(s.a[0]+s.b[0])/2,(s.a[2]+s.b[2])/2];
const pick=${idx}>=0?${idx}:list.map((s,i)=>[i,Math.hypot(mid(s)[0]-J[0],mid(s)[1]-J[2])]).filter(([i,d])=>d>2&&d<7&&top(list[i])>g0+0.6&&bot(list[i])<g0+1.4).sort((a,b)=>a[1]-b[1])[0]?.[0];
console.warn('stage solid', pick, 'ground', g0.toFixed(2));
const S=list[pick]; let c,R; if(S.kind==='capsule'){c=[(S.a[0]+S.b[0])/2,(S.a[2]+S.b[2])/2];R=S.r}else{c=[S.c[0],S.c[2]];R=Math.max(S.h[0],S.h[2])}
let dx=-c[0],dz=-c[1]; const L=Math.hypot(dx,dz)||1; dx/=L; dz/=L; const px=-dz,pz=dx, D=R+${DD}, E=R+${EE};
const y0=Math.atan2(px,pz);
bend.place(0,c[0]+dx*D-px*0.6,c[1]+dz*D-pz*0.6,y0); bend.place(1,c[0]+dx*D+px*0.6,c[1]+dz*D+pz*0.6,y0+Math.PI);
const g=W.groundAt(c[0]+dx*D,c[1]+dz*D), eye=[c[0]-dx*E,g+${H},c[1]-dz*E], at=[c[0]+dx*D,g+1.0,c[1]+dz*D];
const ap=bend.rig.apply.bind(bend.rig); bend.rig.apply=(cam,w,h)=>{ap(cam,w,h); cam.lookAt(eye,at); cam.update(w,h);};`,
  each: "const s=bend.fade.seen; console.warn('fade', t, JSON.stringify(s))",
  sheet: { cols: 2, rows: 1, width: 640 }, stills: [0.5],
});
const out = [
  stage('nf-temple-stub', 'temple', 11, 2.2, 1.6),
  stage('nf-temple-near', 'temple', 11, 2.2, 0.3),
  stage('nf-redwoods-trunk', 'redwoods', 111, 2.2, 1.6, 1.3, "bend.set('redwoods', { hour: 19.4, dayGoes: false });"),
  stage('nf-redwoods-near', 'redwoods', 111, 2.2, 0.3, 1.3, "bend.set('redwoods', { hour: 19.4, dayGoes: false });"),
  stage('nf-geode-blade', 'geode', 34, 2.2, 1.6),
  stage('nf-geode-near', 'geode', 34, 2.2, 0.3),
  stage('nf-forge-slab', 'forge', -1, 2.2, 1.6),
  stage('nf-forge-near', 'forge', -1, 2.2, 0.3),
];
// the depth of field through a gate: the player in the hub before its gate to the redwoods, the partner standing in the
// redwoods beyond the disc; a: the gates' window off, b: on (the lens's focus eased at once)
const gab = { a: "bend.set('gates',{focus:false})", b: "bend.set('gates',{focus:true})" };
// (the hub's gate to `to`: the player 3 m in front of it and to one side, the partner `behind` m beyond the disc in the
// far world, seen through it; a fixed eye `back` m out on the gate's axis)
const gate = (name, to, behind, back, extra = '', side = 2.6) => ({
  name, query: 'play&two&dress=fire,water&world=geode', size: '1920x1080', fps: 2, seconds: 1, warm: 20, ab: gab,
  setup: `bend.set('redwoods', { hour: 19.4, dayGoes: false }); bend.set('post', { focusEase: 0 }); bend.wake(); await bend.step(200);
const G=bend.worlds.find((w)=>w.id==='geode').portals.find((p)=>p.to.world==='${to}'), a=G.at, n=G.normal, r=[n[2],0,-n[0]];
bend.place(0,a[0]+n[0]*${side}+r[0]*1.1,a[2]+n[2]*${side}+r[2]*1.1,Math.atan2(-n[0],-n[2]));
const d=bend.show.dancers[1]; bend.gates.place(d,'${to}'); const f=bend.gates.pt(G.id,[a[0]-n[0]*${behind},a[1],a[2]-n[2]*${behind}]);
const fz=bend.gates.dir(G.id,[n[0],0,n[2]]); bend.place(1,f[0],f[2],Math.atan2(fz[0],fz[2]));
const eye=[a[0]+n[0]*${back},a[1]+0.3,a[2]+n[2]*${back}], at=[a[0],a[1]-0.2,a[2]];
const ap=bend.rig.apply.bind(bend.rig); bend.rig.apply=(cam,w,h)=>{ap(cam,w,h); cam.lookAt(eye,at); cam.update(w,h);}; ${extra}`,
  sheet: { cols: 2, rows: 1, width: 640 }, stills: [0.5],
});
out.push(gate('nf-gate-dof', 'redwoods', 3, 5.5));
// (the player behind the eye: the lens frames only the partner, through the disc; a: the window off, so the partner's
// pixels read as the disc's distance while the focus is the partner's)
out.push(gate('nf-gate-window', 'redwoods', 3, 5.5, '', 7.5));
writeFileSync('scripts/steps/nf-stage.json', JSON.stringify(out, null, 1));
// the timings (1920x1080, the profiler over 150 frames at the end): the critic's five scenes and three of the above,
// with nothing in them that the build before this one lacks
const critic = JSON.parse(readFileSync('scripts/steps/critic6.json', 'utf8')).filter((t) => t.name.startsWith('t-'));
const timed = (t) => ({ ...t, name: `t-${t.name.replace(/^nf-/, '')}`, size: '1920x1080', fps: 2, seconds: 1, ab: undefined, each: t.each?.includes('fade') ? undefined : t.each,
  setup: t.setup.replace("bend.set('fade',{easeIn:0,easeOut:0}); ", '').replace(" bend.set('post', { focusEase: 0 });", ''), timings: true, stills: [0.5] });
writeFileSync('scripts/steps/nf-timings.json', JSON.stringify([...critic, ...['nf-temple-stub', 'nf-redwoods-trunk', 'nf-gate-dof'].map((n) => timed(out.find((t) => t.name === n)))], null, 1));
