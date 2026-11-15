// Production-build phone workload audit on the host GPU. Mobile emulation and CPU throttling do not emulate an
// iPhone GPU. Keep the viewport, scale, staging and warmup identical for before/after comparisons.
// node scripts/profile-phone.mjs http://127.0.0.1:5491/energybending/ shots/phone-profile/baseline [cpu-rate]
import { launch } from './lib/browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.argv[2] ?? 'http://127.0.0.1:5491/energybending/';
const out = process.argv[3] ?? 'shots/phone-profile/run';
const rate = Number(process.argv[4] ?? 1);
mkdirSync(out, { recursive: true });
const browser = await launch({width:390,height:844});
try {
 const page = await browser.newPage();
 await page.setViewport({width:390,height:844,deviceScaleFactor:3,isMobile:true,hasTouch:true});
 const cdp=await page.createCDPSession();
 if(rate>1)await cdp.send('Emulation.setCPUThrottlingRate',{rate});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const url=new URL(base);url.search='?class=phone&baseline&play&two&world=geode&dress=fire,water&quality=0';
 await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>window.bend,{timeout:240000});
 console.log('ready',out);
 await page.evaluate(()=>{
  const k=bend.kit;k.autoRes=null;k.renderScale=.85;k.profiler.force=false;
  bend.set('camera',{autoOrbit:false,shots:false,followDist:4.6,followFov:48,followPitch:.16,followSwing:0});
  bend.set('redwoods',{hour:19.4,dayGoes:false});bend.wake();
  const P=window.__phoneProfile={frames:[],measure:false,counts:{},last:0};
  const count=(proto,name,key)=>{const fn=proto[name];proto[name]=function(...args){if(P.measure)P.counts[key]=(P.counts[key]??0)+1;return fn.apply(this,args);};};
  for(const n of ['draw','drawIndexed','drawIndirect','drawIndexedIndirect'])count(GPURenderPassEncoder.prototype,n,'draws');
  count(GPUCommandEncoder.prototype,'beginRenderPass','renderPasses');count(GPUCommandEncoder.prototype,'beginComputePass','computePasses');
  count(GPUQueue.prototype,'submit','submits');count(GPUQueue.prototype,'writeBuffer','uploads');
  const step=k.step.bind(k);k.step=(dt)=>{const a=performance.now();P.counts={};step(dt);if(P.measure)P.frames.push({wall:dt*1000,cpu:performance.now()-a,...P.counts});};
 });
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const collect=async(name,ms=7000)=>{
  await page.evaluate(()=>{__phoneProfile.frames=[];__phoneProfile.measure=true;});await wait(ms);
  return await page.evaluate(name=>{
   const P=__phoneProfile;P.measure=false;
   const dist=xs=>{xs.sort((a,b)=>a-b);return {mean:xs.reduce((a,b)=>a+b,0)/Math.max(1,xs.length),p50:xs[Math.floor(xs.length*.5)]??0,p95:xs[Math.floor(xs.length*.95)]??0,p99:xs[Math.floor(xs.length*.99)]??0};};
   const s=bend.stats(),k=bend.kit;
   const metric=key=>dist(P.frames.map(x=>x[key]??0));
   return {name,frames:P.frames.length,wall:metric('wall'),cpu:metric('cpu'),counts:Object.fromEntries(['draws','renderPasses','computePasses','submits','uploads'].map(x=>[x,metric(x).mean])),quality:s.quality,memory:k.memory(),render:s.render,matter:s.matter,errors:s.errors,failed:s.failed,gpu:{trusted:k.profiler.trusted,available:k.profiler.available,ms:k.profiler.frameMs,passes:s.passes},views:s.views};
  },name);
 };
 const results=[];
 for(const world of ['geode','temple','pool','redwoods']){
  await page.evaluate(async w=>{await bend.world(w);bend.gates.place(bend.show.dancers[0],w);bend.gates.place(bend.show.dancers[1],w);bend.place(0,-.6,.4,Math.PI/2);bend.place(1,.6,.4,-Math.PI/2);bend.camera({yaw:0});await bend.kit.ready();},world);
  await wait(16000);
  const row=await collect(world);results.push(row);console.log(JSON.stringify(row));
  if(process.env.GPU_TIMING==='1'){
   await page.evaluate(()=>bend.kit.profiler.force=true);await wait(3500);
   const timed=await collect(world+'-timed',2500);row.gpu=timed.gpu;
   await page.evaluate(()=>bend.kit.profiler.force=false);
  }
  const shot=await page.evaluate(()=>bend.grab());writeFileSync(`${out}/${world}.png`,Buffer.from(shot.split(',')[1],'base64'));
  await page.evaluate(()=>{const k=bend.kit;k.manual=false;k.loop(k.frameCb);});
 }
 // On Apple tile renderers use pass removal to establish costs; these are diagnostics, not playable variants.
 const groups=[['no-water',/^water\./],['no-world-air',/^(air|surface|merge)(\.|$)/],['no-bloom',/^bloom\./],['no-fire-curl',/^fire\.curl/],['no-sparks',/^gems\.(sparks|sparkles)/]];
 for(const [name,re] of process.env.ABLATE==='1'?groups:[]){
  await page.evaluate(source=>{const re=new RegExp(source);for(const l of bend.stats().frame){const m=l.match(/^gpu \w+: (\S+)/);if(m&&re.test(m[1]))bend.kit.overlay.disabled.add(m[1]);}},re.source);
  await wait(2000);const row=await collect(name,4000);results.push(row);console.log(JSON.stringify(row));
  await page.evaluate(()=>bend.kit.overlay.disabled.clear());
 }
 await cdp.send('Profiler.enable');await cdp.send('Profiler.start');await wait(6000);const profile=await cdp.send('Profiler.stop');writeFileSync(`${out}/cpu.cpuprofile`,JSON.stringify(profile.profile));
 const resources=await page.evaluate(()=>({adapter:bend.stats().adapter,device:bend.device,ua:navigator.userAgent,textures:[...bend.kit.textures].map(t=>({label:t.label,width:t.width,height:t.height,layers:t.layers,samples:t.samples,format:t.format})),buffers:[...bend.kit.buffers].map(b=>({label:b.label,size:b.size})),pipelines:bend.kit.pipelines.length}));
 writeFileSync(`${out}/results.json`,JSON.stringify({at:new Date().toISOString(),base,rate,viewport:{width:390,height:844,dpr:3},results,resources,errors},null,2));
 console.log('saved',out,'errors',errors.length);
}finally{await browser.close();}
