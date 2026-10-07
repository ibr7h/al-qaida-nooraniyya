// release 1.0.0-alpha.6 android-audio-and-install-fix
importScripts('./version.js');

const VERSION=self.APP_VERSION||'1.0.0-alpha.6';
const SHELL_CACHE='nooraniyya-shell-v'+VERSION;
const AUDIO_CACHE='nooraniyya-audio-v1';
const MEDIA_CACHE='nooraniyya-media-v1';

const SHELL_ASSETS=[
  './',
  './index.html',
  './mobile-v2.html',
  './webos-tv.html',
  './schoolbook.html',
  './schoolbook_curriculum.json',
  './schoolbook_audio_map.json',
  './schoolbook_content.json',
  './manifest-mobile-v2.webmanifest',
  './version.js',
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
        asset:String((error&&error.message)||''),
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
  if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();
});

async function cacheFirst(request,cacheName){
  const cache=await caches.open(cacheName);
  const cached=await cache.match(request);
  if(cached)return cached;

  const response=await fetch(request);
  if(response.ok&&response.status===200)await cache.put(request,response.clone());
  return response;
}

// Android/Chromium frequently requests MP3 data with a Range header.
// CacheStorage cannot safely store 206 Partial Content as the canonical asset,
// so cache the complete MP3 once and synthesize 206 responses from it.
async function audioWithRangeSupport(request){
  const cache=await caches.open(AUDIO_CACHE);
  const url=request.url;
  let full=await cache.match(url);

  if(!full){
    const fullRequest=new Request(url,{
      method:'GET',
      headers:{'Accept':'audio/mpeg,audio/*;q=0.9,*/*;q=0.8'},
      credentials:'same-origin',
      cache:'no-cache'
    });
    const network=await fetch(fullRequest);
    if(!network.ok)return network;
    if(network.status===200){
      await cache.put(url,network.clone());
      full=network;
    }else{
      return network;
    }
  }

  const range=request.headers.get('range');
  if(!range)return full;

  const match=/bytes=(\d*)-(\d*)/.exec(range);
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

  start=Math.max(0,Math.min(start,size-1));
  end=Math.max(start,Math.min(end,size-1));

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
    event.respondWith(
      fetch(event.request,{cache:'no-store'})
        .catch(()=>caches.match(new URL('./version.js',self.registration.scope).href))
    );
    return;
  }

  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      const cache=await caches.open(SHELL_CACHE);
      try{
        const response=await fetch(event.request,{cache:'no-store'});
        if(response.ok){
          await cache.put(event.request,response.clone());
          const pathname=new URL(event.request.url).pathname;
          if(pathname.endsWith('/')||pathname.endsWith('/index.html')){
            await cache.put(new URL('./index.html',self.registration.scope).href,response.clone());
          }else if(pathname.endsWith('/mobile-v2.html')){
            await cache.put(new URL('./mobile-v2.html',self.registration.scope).href,response.clone());
          }else if(pathname.endsWith('/webos-tv.html')){
            await cache.put(new URL('./webos-tv.html',self.registration.scope).href,response.clone());
          }else if(pathname.endsWith('/schoolbook.html')){
            await cache.put(new URL('./schoolbook.html',self.registration.scope).href,response.clone());
          }
        }
        return response;
      }catch{
        const exact=await cache.match(event.request);
        if(exact)return exact;
        const pathname=new URL(event.request.url).pathname;
        if(pathname.endsWith('/mobile-v2.html')){
          const mobile=await cache.match(new URL('./mobile-v2.html',self.registration.scope).href);
          if(mobile)return mobile;
        }
        if(pathname.endsWith('/webos-tv.html')){
          const tv=await cache.match(new URL('./webos-tv.html',self.registration.scope).href);
          if(tv)return tv;
        }
        if(pathname.endsWith('/schoolbook.html')){
          const schoolbook=await cache.match(new URL('./schoolbook.html',self.registration.scope).href);
          if(schoolbook)return schoolbook;
        }
        return (await cache.match(new URL('./index.html',self.registration.scope).href))||Response.error();
      }
    })());
    return;
  }

  if(url.pathname.includes('/assets/audio/')&&url.pathname.endsWith('.mp3')){
    event.respondWith(
      audioWithRangeSupport(event.request)
        .catch(async()=>{
          try{return await fetch(event.request)}catch{return Response.error()}
        })
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
