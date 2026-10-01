// release 1.0.0-alpha.7 android-audio-and-install-fix
importScripts('./version.js');

const VERSION=self.APP_VERSION||'1.0.0-alpha.7';
const SHELL_CACHE='nooraniyya-shell-v'+VERSION;
const INDEX_CACHE='nooraniyya-index-v'+VERSION;
const MOBILE_CACHE='nooraniyya-mobile-v'+VERSION;
const AUDIO_CACHE='nooraniyya-audio-v1';
const MEDIA_CACHE='nooraniyya-media-v1';

const SHELL_ASSETS=[
  './',
  './index.html',
  './mobile-v2.html',
  './manifest-mobile-v2.webmanifest',
  './version.js',
  './asset-revisions.json',
  './manifest.webmanifest',
  './audio_manifest.json',
  './audio_durations.json',
  './lesson_explanations_ar.json',
  './assets/all_lessons_data.json',
  './assets/images/lesson_list_icon.webp',
  './assets/images/icon_option_1.webp',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './fonts/NotoNaskhArabic.ttf',
  './fonts/AmiriQuran.ttf',
  './fonts/ArefRuqaa-Regular.ttf',
  './fonts/Katibeh-Regular.ttf',
  './fonts/NotoKufiArabic.ttf',
  './fonts/Amiri-Regular.ttf',
  './fonts/ScheherazadeNew-Regular.ttf',
  './fonts/Mada.ttf'
];

async function broadcastUpdate(payload){
  try{
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clients){
      client.postMessage({type:'UPDATE_PROGRESS',version:VERSION,...payload});
    }
  }catch{}
}

function overallProgress(index,total,fraction=0){
  return Math.max(0,Math.min(100,Math.round(((index+fraction)/Math.max(1,total))*100)));
}

async function cacheAssetWithProgress(cache,asset,index,total){
  const url=new URL(asset,self.registration.scope).href;
  await broadcastUpdate({
    phase:'downloading',
    asset,
    completed:index,
    total,
    progress:overallProgress(index,total,0)
  });

  const response=await fetch(new Request(url,{cache:'reload',signal:AbortSignal.timeout(20000)}));
  if(!response.ok)throw new Error('HTTP '+response.status+' '+asset);

  const length=Number(response.headers.get('content-length'))||0;
  if(response.body&&length>0){
    const reader=response.body.getReader();
    const chunks=[];
    let received=0,last=-1;

    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      chunks.push(value);
      received+=value.byteLength;
      const fraction=Math.min(1,received/length);
      const progress=overallProgress(index,total,fraction);
      if(progress!==last){
        last=progress;
        await broadcastUpdate({
          phase:'downloading',
          asset,
          completed:index,
          total,
          progress,
          assetReceived:received,
          assetTotal:length
        });
      }
    }

    const headers=new Headers(response.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    const cached=new Response(new Blob(chunks),{
      status:response.status,
      statusText:response.statusText,
      headers
    });
    await cache.put(url,cached);
  }else{
    await cache.put(url,response.clone());
  }

  await broadcastUpdate({
    phase:'downloading',
    asset,
    completed:index+1,
    total,
    progress:overallProgress(index+1,total,0)
  });
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(SHELL_CACHE);
    await broadcastUpdate({phase:'start',completed:0,total:SHELL_ASSETS.length,progress:0});
    try{
      for(let i=0;i<SHELL_ASSETS.length;i++){
        const asset=SHELL_ASSETS[i];
        const target=asset==='./mobile-v2.html'?await caches.open(MOBILE_CACHE)
          :(asset==='./'||asset==='./index.html')?await caches.open(INDEX_CACHE):cache;
        // Fonts improve offline rendering but must not block either app's update.
        try { await cacheAssetWithProgress(target,asset,i,SHELL_ASSETS.length); }
        catch(error) { if(!asset.startsWith('./fonts/')) throw error; }

      }
      await broadcastUpdate({
        phase:'installed',
        completed:SHELL_ASSETS.length,
        total:SHELL_ASSETS.length,
        progress:100
      });
      await self.skipWaiting();
    }catch(error){
      await broadcastUpdate({
        phase:'error',
        asset:String(error?.message||''),
        completed:0,
        total:SHELL_ASSETS.length,
        progress:0
      });
      throw error;
    }
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    await broadcastUpdate({phase:'activating',progress:100});
    const keys=await caches.keys();

    // Only obsolete application shells are removed.
    // Downloaded audio/media remain available across app updates.
    await Promise.all(
      keys
        .filter(k=>['nooraniyya-shell-v','nooraniyya-index-v','nooraniyya-mobile-v'].some(prefix=>k.startsWith(prefix))&&![SHELL_CACHE,INDEX_CACHE,MOBILE_CACHE].includes(k))
        .map(k=>caches.delete(k))
    );

    await self.clients.claim();
    await broadcastUpdate({phase:'activated',progress:100});
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

let revisionsPromise;
async function assetRevision(url) {
  if(!revisionsPromise) revisionsPromise=(async()=>{
    const shell=await caches.open(SHELL_CACHE);
    const response=await shell.match(new URL('./asset-revisions.json',self.registration.scope).href);
    return response?response.json():{};
  })();
  const revisions=await revisionsPromise;
  return revisions[new URL(url).pathname.slice(new URL(self.registration.scope).pathname.length)];
}
async function sha256(response) {
  const digest=await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer());
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function tagged(response,revision) {
  const headers=new Headers(response.headers);
  headers.set('X-Nooraniyya-Revision',revision);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(await response.clone().arrayBuffer(),{status:200,headers});
}
async function cacheFirst(request,cacheName){
  const cache=await caches.open(cacheName);
  const url=typeof request==='string'?request:request.url;
  const cached=await cache.match(url);
  const revision=await assetRevision(url);
  if(cached){
    if(!revision||cached.headers.get('X-Nooraniyya-Revision')===revision)return cached;
    // Migrate existing downloads by checking their bytes; do not download them again.
    if(await sha256(cached)===revision){
      const verified=await tagged(cached,revision);
      try{await cache.put(url,verified.clone());}catch{}
      return verified;
    }
  }
  try{
    const response=await fetch(new Request(url,{cache:'no-cache',credentials:'same-origin',signal:AbortSignal.timeout(20000)}));
    if(!response.ok||response.status!==200){
      if(cached)return cached;
      return response;
    }
    if(revision&&await sha256(response)!==revision)throw new Error('Asset revision mismatch');
    const verified=revision?await tagged(response,revision):response;
    // Storage quota failures must not prevent streaming while online.
    try{await cache.put(url,verified.clone());}catch{}
    return verified;
  }catch(error){
    if(cached)return cached;
    throw error;
  }
}

// Android/Chromium frequently requests MP3 data with a Range header.
// CacheStorage cannot safely store 206 Partial Content as the canonical asset,
// so cache the complete MP3 once and synthesize 206 responses from it.
async function audioWithRangeSupport(request){
  const full=await cacheFirst(request.url,AUDIO_CACHE);
  if(!full.ok||full.status!==200)return full;

  const range=request.headers.get('range');
  if(!range)return full;

  const match=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!match)return full;

  const buffer=await full.clone().arrayBuffer();
  const size=buffer.byteLength;
  let start=match[1]?Number(match[1]):0;
  let end=match[2]?Number(match[2]):size-1;

  if(!match[1]&&match[2]){
    const suffix=Number(match[2]);
    start=Math.max(0,size-suffix);
    end=size-1;
  }

  if(!size||(!match[1]&&!match[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start||(!match[1]&&Number(match[2])===0)){
    return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`,'Accept-Ranges':'bytes'}});
  }
  end=Math.min(end,size-1);

  const headers=new Headers(full.headers);
  headers.set('Accept-Ranges','bytes');
  headers.set('Content-Range',`bytes ${start}-${end}/${size}`);
  headers.set('Content-Length',String(end-start+1));
  if(!headers.get('Content-Type'))headers.set('Content-Type','audio/mpeg');

  return new Response(buffer.slice(start,end+1),{
    status:206,
    statusText:'Partial Content',
    headers
  });
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;

  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  if(url.pathname.endsWith('/version.js')){
    event.respondWith(fetch(event.request,{cache:'no-store',signal:AbortSignal.timeout(15000)}).catch(async()=>{
      // A failed online version check is not proof that the app is up to date.
      if(url.searchParams.has('check'))return Response.error();
      const cache=await caches.open(SHELL_CACHE);
      return (await cache.match(new URL('./version.js',self.registration.scope).href))||Response.error();
    }));
    return;
  }

  if(event.request.mode==='navigate'){
    const root=new URL(self.registration.scope).pathname;
    const mobile=url.pathname===root+'mobile-v2.html';
    const original=url.pathname===root||url.pathname===root+'index.html';
    if(!mobile&&!original)return;
    event.respondWith((async()=>{
      const cache=await caches.open(mobile?MOBILE_CACHE:INDEX_CACHE);
      const canonical=new URL(mobile?'./mobile-v2.html':'./index.html',self.registration.scope).href;
      try{
        const response=await fetch(event.request,{cache:'no-store',signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error('Navigation HTTP '+response.status);
        try{await cache.put(canonical,response.clone());}catch{}
        return response;
      }catch{
        return (await cache.match(canonical))||new Response(
          '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>الاتصال مطلوب</title><h1>هذه النسخة غير محفوظة على الجهاز</h1><p>اتصل بالإنترنت ثم أعد فتح هذه الصفحة. لن يتم فتح نسخة أخرى بدلًا منها.</p><button onclick="location.reload()">إعادة المحاولة</button></html>',
          {status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
      }
    })());
    return;
  }

  if(url.pathname.includes('/assets/audio/')&&url.pathname.endsWith('.mp3')){
    event.respondWith(
      audioWithRangeSupport(event.request)
        .catch(()=>Response.error())
    );
    return;
  }

  if(
    url.pathname.includes('/assets/images/')||
    url.pathname.includes('/assets/content/lessons/')||
    url.pathname.includes('/assets/audio_master/')
  ){
    event.respondWith(
      cacheFirst(event.request,MEDIA_CACHE)
        .catch(()=>Response.error())
    );
    return;
  }

  event.respondWith(
    caches.open(SHELL_CACHE).then(cache=>cache.match(event.request)).then(cached=>
      cached||fetch(event.request).then(response=>{
        if(response.ok){
          const copy=response.clone();
          caches.open(SHELL_CACHE).then(cache=>cache.put(event.request,copy));
        }
        return response;
      })
    )
  );
});
