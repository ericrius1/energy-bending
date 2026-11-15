// Unpaced production-build throughput, measured by queue completion over batches. This is host-GPU capacity,
// not an iPhone FPS prediction; use alongside profile-phone.mjs (real rAF pacing and CPU throttling).
import { launch } from './lib/browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const base=process.argv[2],out=process.argv[3],level=Number(process.argv[4]??0);mkdirSync(out,{recursive:true});
const browser=await launch({width:390,height:844});
try {
 const page=await browser.newPage();await page.setViewport({width:390,height:844,deviceScaleFactor:3,isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(base+'?class=phone&baseline&play&two&world=geode&dress=fire,water&quality='+level,{waitUntil:'domcontentloaded',timeout:120000});await page.waitForFunction(()=>window.bend,{timeout:240000});
 await page.evaluate(()=>{const k=bend.kit;k.manual=true;k.autoRes=null;k.renderScale=.85;k.profiler.force=false;bend.wake();bend.set('camera',{autoOrbit:false,shots:false,followDist:4.6,followFov:48,followPitch:.16,followSwing:0});bend.set('redwoods',{hour:19.4,dayGoes:false});bend.set('gates',{stills:false});});
 await new Promise(r=>setTimeout(r,15000));
 const results=[];
 for(const world of ['geode','temple','pool','redwoods']){
  await page.evaluate(async w=>{await bend.world(w);for(const d of bend.show.dancers)bend.gates.place(d,w);bend.place(0,-.6,.4,Math.PI/2);bend.place(1,.6,.4,-Math.PI/2);bend.camera({yaw:0});await bend.kit.ready();for(let i=0;i<600;i++)bend.kit.step(1/60);await bend.kit.queue.onSubmittedWorkDone();},world);
  const measure=async name=>page.evaluate(async name=>{
   const k=bend.kit;const batch=async n=>{const a=performance.now();for(let i=0;i<n;i++)k.step(1/60);await k.queue.onSubmittedWorkDone();return (performance.now()-a)/n;};
   await batch(60);const ms=[];for(let i=0;i<8;i++)ms.push(await batch(30));ms.sort((a,b)=>a-b);
   return {name,medianMs:ms[4],minMs:ms[0],maxMs:ms[7],samples:ms,render:[...k.size.render],memory:k.memory(),quality:bend.stats().quality,matter:bend.stats().matter,errors:bend.stats().errors,views:bend.stats().views};
  },name);
  const r=await measure(world);results.push(r);console.log(JSON.stringify(r));
  const shot=await page.evaluate(()=>bend.grab());writeFileSync(`${out}/${world}.png`,Buffer.from(shot.split(',')[1],'base64'));
  if(world==='redwoods' && process.env.ABLATE==='1'){
   for(const [label,re] of [['no-water','^water\\.'],['no-air','^air($|\\.)'],['no-bloom','^bloom\\.'],['no-sparks','^gems\\.(sparks|sparkles)'],['no-curl','^fire\\.curl'],['no-foliage','^redwoods\\.(grass|flowers|ferns|spires)$']]){
    await page.evaluate(source=>{const re=new RegExp(source);for(const p of bend.kit.passes??[]){if(re.test(p.label))bend.kit.overlay.disabled.add(p.label);}for(const l of bend.stats().frame){const m=l.match(/^gpu \w+: (\S+)/);if(m&&re.test(m[1]))bend.kit.overlay.disabled.add(m[1]);}
     // Draw switches are independent of pass switches; find draws through the views' scene targets.
     const all=[bend.post.main,...bend.gates.views].filter(Boolean);window.__ablate=[];for(const v of all)for(const pass of [v.scene,v.glow])for(const d of pass.draws){if(re.test(d.label)){__ablate.push([d,d.enabled]);d.enabled=false;}}
    },re);
    const r=await measure(label);results.push(r);console.log(JSON.stringify(r));
    await page.evaluate(()=>{bend.kit.overlay.disabled.clear();for(const [d,on] of __ablate)d.enabled=on;});
   }
  }
 }
 writeFileSync(`${out}/results.json`,JSON.stringify({base,level,results,errors},null,2));
}finally{await browser.close();}
