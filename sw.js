/**
 * Tiendas Sam's — Service Worker
 * Versión: v5 (2026-11) - Fix CSP y CDN Caching
 */

const CACHE_NAME = 'tiendas-sams-v5';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/portal.html',
  '/info.html',
  '/manifest.json'
];

const CACHEABLE_CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com'
];

const NEVER_CACHE_HOSTS = [
  'supabase.co'
];

// 1. INSTALACIÓN
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Solo precacheamos los archivos propios. Los CDNs se cachean on-the-fly.
      return Promise.allSettled(
        PRECACHE_ASSETS.map(url => {
          return cache.add(url).catch(err => {
            console.warn('[SW] Falló al precachear:', url, err);
          });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// 2. ACTIVACIÓN (Limpieza de versiones viejas)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Eliminando caché antigua:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. FETCH
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Ignorar Supabase
  if (NEVER_CACHE_HOSTS.some(host => url.hostname.includes(host))) return;
  if (url.pathname === '/admin.html') return;

  // A) Navegación HTML -> Network First
  const isNavigation = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then(cachedResponse => {
            return cachedResponse || caches.match('/index.html');
          });
        })
    );
    return;
  }

  // B) CDNs -> Cache First (Si falla, intenta red)
  if (CACHEABLE_CDN_HOSTS.some(host => url.hostname === host)) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        if (cachedResponse) return cachedResponse;
        return fetch(request).then(response => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          }
          return response;
        }).catch(() => new Response('', { status: 504 }));
      })
    );
    return;
  }

  // C) Assets propios -> Stale While Revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        const fetchPromise = fetch(request).then(networkResponse => {
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          }
          return networkResponse;
        }).catch(() => null);
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }
});
