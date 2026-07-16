const RELEASE="frontend-final-20260716-01";
const STATIC_CACHE=`ticket-core-static-${RELEASE}`;
const PAGE_CACHE=`ticket-core-pages-${RELEASE}`;
const OWN_CACHE=/^(?:ticket-core-(?:static|pages)-|(?:static|pages)-tc-)/;
const PAGE_SHELLS=["./","./index.html","./dashboard.html","./tickets.html","./ticket.html","./clientes.html","./cliente.html","./consolidacion-clientes.html","./alta-cliente.html","./soporte.html","./estado.html"];
const STATIC_ASSETS=[
  "./global.css?v=frontend-final-20260716-01","./global.js?v=frontend-final-20260716-01",
  "./dashboard.css?v=frontend-final-20260716-01","./dashboard.js?v=frontend-final-20260716-01",
  "./tickets.css?v=frontend-final-20260716-01","./tickets.js?v=frontend-final-20260716-01",
  "./ticket.css?v=frontend-final-20260716-01","./ticket.js?v=frontend-final-20260716-01",
  "./ticket-composer-polish.js?v=frontend-final-20260716-01","./ticket-assignment.js?v=frontend-final-20260716-01",
  "./clientes.css?v=frontend-final-20260716-01","./clientes.js?v=frontend-final-20260716-01",
  "./cliente.css?v=frontend-final-20260716-01","./cliente.js?v=frontend-final-20260716-01",
  "./consolidacion-clientes.css?v=frontend-final-20260716-01","./consolidacion-clientes.js?v=frontend-final-20260716-01",
  "./alta-cliente.css?v=frontend-final-20260716-01","./alta-cliente.js?v=frontend-final-20260716-01",
  "./soporte.css?v=frontend-final-20260716-01","./soporte.js?v=frontend-final-20260716-01",
  "./estado.css?v=frontend-final-20260716-01","./estado.js?v=frontend-final-20260716-01"
];
const cacheAllAvailable=async(cacheName,urls)=>{const cache=await caches.open(cacheName);await Promise.all(urls.map(async url=>{try{await cache.add(new Request(url,{cache:"reload"}))}catch(err){console.warn("SW_SKIP",url,err)}}))};
self.addEventListener("install",event=>event.waitUntil((async()=>{await Promise.all([cacheAllAvailable(PAGE_CACHE,PAGE_SHELLS),cacheAllAvailable(STATIC_CACHE,STATIC_ASSETS)]);await self.skipWaiting()})()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>OWN_CACHE.test(key)&&![STATIC_CACHE,PAGE_CACHE].includes(key)).map(key=>caches.delete(key)));await self.clients.claim()})()));
const isSensitive=request=>{const url=new URL(request.url);return request.headers.has("authorization")||/\/(?:auth|rest|functions|storage)\/v1(?:\/|$)/.test(url.pathname)};
const pageCacheKey=url=>new Request(new URL(url.pathname,self.location.origin).href);
const networkFirstPage=async request=>{const url=new URL(request.url),key=pageCacheKey(url);try{const response=await fetch(request,{cache:"no-store"});if(response?.ok)(await caches.open(PAGE_CACHE)).put(key,response.clone());return response}catch{const cache=await caches.open(PAGE_CACHE);return await cache.match(key)||await cache.match(pageCacheKey(new URL("./estado.html",self.location.href)))||await cache.match(pageCacheKey(new URL("./soporte.html",self.location.href)))||await cache.match(pageCacheKey(new URL("./dashboard.html",self.location.href)))||await cache.match(pageCacheKey(new URL("./index.html",self.location.href)))||new Response("Sin conexión",{status:503,headers:{"Content-Type":"text/plain;charset=UTF-8"}})}};
const cacheFirstVersionedAsset=async request=>{const cache=await caches.open(STATIC_CACHE),cached=await cache.match(request);if(cached)return cached;const response=await fetch(request,{cache:"no-store"});if(response?.ok)await cache.put(request,response.clone());return response};
self.addEventListener("fetch",event=>{const request=event.request,url=new URL(request.url);if(request.method!=="GET"||url.origin!==self.location.origin||isSensitive(request))return;if(request.mode==="navigate")return event.respondWith(networkFirstPage(request));if(url.searchParams.get("v")===RELEASE)return event.respondWith(cacheFirstVersionedAsset(request));event.respondWith(fetch(request,{cache:"no-store"}))});
