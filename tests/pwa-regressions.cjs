const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const BASE='https://example.test/al-qaida-nooraniyya/';
const VERSION='1.0.0-alpha.7';
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
function worker(){
 const buckets=new Map(),handlers={},requests=[];let network=async url=>new Response(url.includes('mobile-v2')?'MOBILE':'INDEX');
 const key=x=>new URL(typeof x==='string'?x:x.url,BASE).href;
 const caches={open:async n=>{if(!buckets.has(n))buckets.set(n,new Map());const b=buckets.get(n);return {match:async r=>b.get(key(r))?.clone(),put:async(r,s)=>{if(s.status===206)throw Error('partial content');b.set(key(r),s.clone())}}},keys:async()=>[...buckets.keys()],delete:async n=>buckets.delete(n),match:async r=>{for(const b of buckets.values())if(b.has(key(r)))return b.get(key(r)).clone()}};
 const ctx=vm.createContext({self:{APP_VERSION:VERSION,registration:{scope:BASE},location:{origin:new URL(BASE).origin},clients:{matchAll:async()=>[],claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(t,h)=>handlers[t]=h},importScripts:()=>{},caches,URL,Request,Response,Headers,Blob,AbortSignal,crypto:webcrypto,fetch:async r=>{requests.push(key(r));return network(key(r),r)}});
 vm.runInContext(read('sw.js'),ctx);
 return {ctx,buckets,requests,caches,network:f=>network=f,async put(cache,url,body,headers){await(await caches.open(cache)).put(url,new Response(body,{headers}))},async fetch(file,mode='navigate',headers){let promise;const req={method:'GET',url:new URL(file,BASE).href,mode,headers:new Headers(headers)};handlers.fetch({request:req,respondWith:p=>promise=p});return promise},async event(name){let p;handlers[name]({waitUntil:x=>p=x});return p}};
}
test('navigation isolates original/mobile including queries, offline and server errors',async()=>{
 const w=worker();assert.equal(await(await w.fetch('index.html')).text(),'INDEX');assert.equal(await(await w.fetch('mobile-v2.html')).text(),'MOBILE');
 w.network(async()=>{throw Error('offline')});assert.equal(await(await w.fetch('./')).text(),'INDEX');assert.equal(await(await w.fetch('mobile-v2.html?x=1')).text(),'MOBILE');
 w.buckets.get('nooraniyya-mobile-v'+VERSION).clear();const missing=await w.fetch('mobile-v2.html');assert.equal(missing.status,503);assert.match(await missing.text(),/هذه النسخة غير محفوظة/);
 w.network(async()=>new Response('error',{status:503}));assert.equal(await(await w.fetch('index.html')).text(),'INDEX');assert.equal(await w.fetch('unknown.html'),undefined);
});
test('matching legacy downloads migrate without network; only changed files refresh',async()=>{
 const w=worker();const a='assets/audio/a.mp3',b='assets/images/b.webp';await w.put('nooraniyya-shell-v'+VERSION,'asset-revisions.json',JSON.stringify({[a]:hash('same'),[b]:hash('new')}));
 await w.put('nooraniyya-audio-v1',a,'same');await w.put('nooraniyya-media-v1',b,'old');
 w.network(async()=>new Response('new'));
 assert.equal(await(await w.fetch(a,'cors')).text(),'same');assert.equal(w.requests.length,0);
 assert.equal(await(await w.fetch(b,'cors')).text(),'new');assert.equal(w.requests.length,1);
 assert.equal(await(await w.fetch(b,'cors')).text(),'new');assert.equal(w.requests.length,1);
});
test('offline and mixed-deployment revisions preserve old downloads',async()=>{
 const w=worker(),a='assets/audio/a.mp3';await w.put('nooraniyya-shell-v'+VERSION,'asset-revisions.json',JSON.stringify({[a]:hash('new')}));await w.put('nooraniyya-audio-v1',a,'old');
 w.network(async()=>{throw Error('offline')});assert.equal(await(await w.fetch(a,'cors')).text(),'old');
 w.network(async()=>new Response('unexpected'));assert.equal(await(await w.fetch(a,'cors')).text(),'old');
 w.network(async()=>new Response('new'));assert.equal(await(await w.fetch(a,'cors')).text(),'new');
});
test('Android range responses include valid suffixes and reject impossible ranges',async()=>{
 const w=worker();await w.put('nooraniyya-audio-v1','assets/audio/a.mp3','0123456789');
 for(const [range,status,body] of [['bytes=2-4',206,'234'],['bytes=-3',206,'789'],['bytes=0-',206,'0123456789'],['bytes=100-',416,''],['bytes=4-2',416,''],['bytes=-0',416,'']]){
  const r=await w.fetch('assets/audio/a.mp3','cors',{Range:range});assert.equal(r.status,status,range);assert.equal(await r.text(),body,range);
 }
});
test('optional font failure does not fail install; activation preserves downloaded media',async()=>{
 const w=worker();w.network(async url=>url.includes('/fonts/')?new Response('',{status:404}):new Response('ok'));
 await w.put('nooraniyya-shell-vOLD','index.html','old');await w.put('nooraniyya-audio-v1','assets/audio/a.mp3','saved');await w.put('another-app-cache','other','other');
 await w.event('install');await w.event('activate');assert(!w.buckets.has('nooraniyya-shell-vOLD'));assert(w.buckets.has('nooraniyya-audio-v1'));assert(w.buckets.has('another-app-cache'));assert(w.buckets.has('nooraniyya-mobile-v'+VERSION));
});
test('required shell failure aborts install',async()=>{const w=worker();w.network(async()=>new Response('',{status:404}));await assert.rejects(w.event('install'));});
test('failed version check cannot masquerade as cached online success',async()=>{
 const w=worker();await w.put('nooraniyya-shell-v'+VERSION,'version.js','cached');w.network(async()=>{throw Error('offline')});assert.equal((await w.fetch('version.js?check=1','cors')).type,'error');assert.equal(await(await w.fetch('version.js','cors')).text(),'cached');
});
function pageContext(file){
 const els=new Map(),timers=new Map();let seq=0;
 function element(){return {content:VERSION,hidden:true,textContent:'',style:{},classList:{add(){},remove(){}},listeners:{},addEventListener(t,h){this.listeners[t]=h},setAttribute(){},appendChild(){}}}
 const document={querySelector:()=>({content:VERSION}),querySelectorAll:()=>[],getElementById:id=>{if(!els.has(id))els.set(id,element());return els.get(id)},body:element(),addEventListener(){},createElement:()=>element()};
 const ctx=vm.createContext({document,navigator:{onLine:true,serviceWorker:{controller:{}}},location:{pathname:'/'+file,href:BASE+file},window:{location:{href:BASE+file}},localStorage:{getItem(){},setItem(){}},console,URL,AbortSignal,fetch:async()=>new Response(''),setTimeout:f=>{timers.set(++seq,f);return seq},clearTimeout:id=>timers.delete(id),setInterval(){}});
 const html=read(file);const start=html.indexOf('      const APP_VERSION =');const end=html.indexOf(file==='mobile-v2.html'?'      const arabicFontSelect =':'      // Startup',start);vm.runInContext(html.slice(start,end),ctx);
 return {ctx,document,els,timers,run:s=>vm.runInContext(s,ctx)};
}
for(const file of ['index.html','mobile-v2.html']){
 test(file+': syntax, embedded audio references, release identity',()=>{
  const html=read(file);for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(!/application\/json/.test(m[1]))new vm.Script(m[2]);}
  assert.match(html,new RegExp('app-build-version" content="'+VERSION.replaceAll('.','\\.')+'"'));
  const data=JSON.parse(html.match(/<script[^>]+id="embedded-data"[^>]*>([\s\S]*?)<\/script>/)[1]);for(const l of data)for(const i of l.items)for(const a of i.a||[])assert(fs.existsSync(path.join(ROOT,'assets/audio',a)),a);
 });
 test(file+': failed update/check dismisses overlay and does not report current',async()=>{
  const p=pageContext(file);p.ctx.fetch=async()=>{throw Error('network')};await p.run('checkForAppUpdate({manual:true})');assert.equal(p.document.getElementById('update-banner-title').textContent,'تعذر التحقق من الإصدار');
  p.run("showUpdateSplash({});updateSplashFromWorker({phase:'error'});");assert(p.document.getElementById('update-splash').hidden);
  p.run('showUpdateSplash({})');for(const cb of [...p.timers.values()])cb();assert(p.document.getElementById('update-splash').hidden);
  p.run('showUpdateSplash({})');p.document.getElementById('dismiss-update-btn').listeners.click();p.run('showUpdateSplash({})');assert(p.document.getElementById('update-splash').hidden);
 });
 test(file+': update rejection recovers; success is reported only after successful check',async()=>{
  const p=pageContext(file);p.ctx.fetch=async()=>new Response("self.APP_VERSION='1.0.0-alpha.8';");p.run("swRegistration={update:async()=>{throw Error('failure')}}");await p.run('checkForAppUpdate({manual:true})');assert(p.document.getElementById('update-splash').hidden);assert.equal(p.document.getElementById('update-banner-title').textContent,'تعذر إكمال التحديث');
  p.ctx.fetch=async()=>new Response("self.APP_VERSION='"+VERSION+"';");p.run('swRegistration={update:async()=>{}}');await p.run('checkForAppUpdate({manual:true})');assert.equal(p.document.getElementById('update-banner-title').textContent,'التطبيق محدث');
 });
 test(file+': blocked audio stops sequence, exposes retry and completes after user retry',async()=>{
  const p=pageContext(file),html=read(file);let reject=true,completed=0;
  const audio={style:{},setAttribute(){},pause(){},currentTime:0,play(){return reject?Promise.reject({name:'NotAllowedError'}):Promise.resolve()}};
  p.document.createElement=tag=>tag==='audio'?audio:{...p.document.body,style:{}};
  p.ctx.setVisualizerActive=()=>{};p.ctx.clearAllHighlights=()=>{};p.ctx.clearSpotlightTracking=()=>{};
  const start=html.indexOf("      const narrationAudio = document.createElement('audio');"),end=html.indexOf('      // Spotlight Modal State',start);
  vm.runInContext(html.slice(start,end),p.ctx);
  const a=html.indexOf('      function stopAudio()'),b=html.indexOf('      // Plays an item with repeat support',a);vm.runInContext(html.slice(a,b),p.ctx);
  p.run('function stopPlayAll(){isPlayingAll=false;stopAudio();}');p.ctx.done=()=>completed++;
  p.run("playAudioFiles(['f1-01.mp3'],done)");await new Promise(r=>setImmediate(r));assert.equal(completed,0);assert.match(p.document.getElementById('audio-error-text').textContent,/للسماح/);
  reject=false;p.document.getElementById('audio-retry-btn').listeners.click();audio.onended();assert.equal(completed,1);
 });
 for (const errorCode of [2, 4]) test(file+': retries the same source after media error '+errorCode,async()=>{
  const p=pageContext(file),html=read(file);
  let online=false,completed=0,loads=0,source='',started=0;
  // Media errors persist until resource selection runs again; play() alone
  // cannot recover MEDIA_ERR_SRC_NOT_SUPPORTED (HTML media play algorithm).
  const audio={style:{},setAttribute(){},pause(){},currentTime:0,error:null,
   get src(){return source},set src(value){source=value;this.error=null},
   load(){loads++;this.error=null},
   play(){if(!online)this.error={code:errorCode};if(this.error)return Promise.reject({name:'NotSupportedError'});started++;return Promise.resolve()}
  };
  p.document.createElement=tag=>tag==='audio'?audio:{...p.document.body,style:{}};
  p.ctx.setVisualizerActive=()=>{};p.ctx.clearAllHighlights=()=>{};p.ctx.clearSpotlightTracking=()=>{};
  const start=html.indexOf("      const narrationAudio = document.createElement('audio');"),end=html.indexOf('      // Spotlight Modal State',start);
  vm.runInContext(html.slice(start,end),p.ctx);
  const a=html.indexOf('      function stopAudio()');vm.runInContext(html.slice(a,html.indexOf('      // Plays an item with repeat support',a)),p.ctx);
  p.run('function stopPlayAll(){isPlayingAll=false;stopAudio();}');p.ctx.done=()=>completed++;
  p.run("playAudioFiles(['f1-01.mp3','f1-02.mp3'],done)");await new Promise(r=>setImmediate(r));
  assert.equal(completed,0);assert.equal(started,0);assert.equal(p.run('audioErrorBox.hidden'),false);
  online=true;p.document.getElementById('audio-retry-btn').listeners.click();await new Promise(r=>setImmediate(r));
  assert.equal(audio.error,null,'retry must clear the persistent media error');
  assert.equal(loads,1);assert.equal(started,1);assert(source.endsWith('/f1-01.mp3'));
  assert.equal(p.run('audioErrorBox.hidden'),true);
  audio.onended();assert(source.endsWith('/f1-02.mp3'));assert.equal(started,2);
  audio.onended();assert.equal(completed,1);assert.equal(loads,1,'healthy clips must not be reloaded');
 });
}
test('revision index and separate install identities are valid',()=>{
 const revisions=JSON.parse(read('asset-revisions.json'));for(const [file,h]of Object.entries(revisions))assert.equal(hash(fs.readFileSync(path.join(ROOT,file))),h,file);
 const original=JSON.parse(read('manifest.webmanifest')),mobile=JSON.parse(read('manifest-mobile-v2.webmanifest'));assert.notEqual(original.id,mobile.id);assert.equal(mobile.start_url,'./mobile-v2.html');
});
