// release 1.0.0-alpha.4 mobile-phone-layout
importScripts('./version.js');

const VERSION=self.APP_VERSION||'1.0.0-alpha.4';
const SHELL_CACHE='nooraniyya-shell-v'+VERSION;
const AUDIO_CACHE='nooraniyya-audio-v1';
const MEDIA_CACHE='nooraniyya-media-v1';

const SHELL_ASSETS=[
  './',
  './index.html',
  './version.js',
  './manifest.webmanifest',
  './audio_manifest.json',
  './audio_durations.json',
  './lesson_explanations_ar.json',
  './assets/all_lessons_data.json',
  './assets/images/lesson_list_icon.webp',
  './assets/images/icon_option_1.webp'
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

  const response=await fetch(new Request(url,{cache:'reload'}));
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
        await cacheAssetWithProgress(cache,SHELL_ASSETS[i],i,SHELL_ASSETS.length);
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
        .filter(k=>k.startsWith('nooraniyya-shell-v')&&k!==SHELL_CACHE)
        .map(k=>caches.delete(k))
    );

    await self.clients.claim();
    await broadcastUpdate({phase:'activated',progress:100});
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

async function cacheFirst(request,cacheName){
  const cache=await caches.open(cacheName);
  const cached=await cache.match(request);
  if(cached)return cached;

  const response=await fetch(request);
  if(response.ok)await cache.put(request,response.clone());
  return response;
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;

  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  if(url.pathname.endsWith('/version.js')){
    event.respondWith(
      fetch(event.request,{cache:'no-store'})
        .catch(()=>caches.match(new URL('./version.js',self.registration.scope).href))
    );
    return;
  }

  if(event.request.mode==='navigate'){
    event.respondWith(
      fetch(event.request,{cache:'no-store'})
        .then(response=>{
          const copy=response.clone();
          caches.open(SHELL_CACHE).then(cache=>
            cache.put(new URL('./index.html',self.registration.scope).href,copy)
          );
          return response;
        })
        .catch(()=>caches.match(new URL('./index.html',self.registration.scope).href))
    );
    return;
  }

  if(url.pathname.includes('/assets/audio/')&&url.pathname.endsWith('.mp3')){
    event.respondWith(
      cacheFirst(event.request,AUDIO_CACHE)
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
    caches.match(event.request).then(cached=>
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
