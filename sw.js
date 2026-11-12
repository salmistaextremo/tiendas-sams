/**
 * Tiendas Sam's — Service Worker
 * Versión: v4 (2026-11)
 * 
 * CAMBIOS CLAVE v4:
 *  - Versión de caché actualizada para forzar actualización en móviles.
 *  - Instalación tolerante a fallos (usa Promise.allSettled).
 *  - Exclusión total de rutas de Supabase y de admin.html.
 *  - Limpieza agresiva de cachés antiguas (v1, v2, v3).
 */

const CACHE_NAME = 'tiendas-sams-v4';

// Solo precacheamos lo crítico para que la tienda funcione offline
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/portal.html',
  '/info.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js'
];

// Dominios permitidos para cachear (CDNs)
const CACHEABLE_CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net'
];

// Dominios que NUNCA deben ser cacheados (API de Supabase)
const NEVER_CACHE_HOSTS = [
  'supabase.co'
];

// 1. INSTALACIÓN
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Usamos Promise.allSettled para que si un archivo falla, los demás se guarden igual
      return Promise.allSettled(
        PRECACHE_ASSETS.map(url => {
          return cache.add(url).catch(err => {
            console.warn('[SW] Falló al precachear:', url, err);
          });
        })
      );
    }).then(() => {
      // Forzar a que el nuevo SW tome el control inmediatamente
      return self.skipWaiting();
    })
  );
});

// 2. ACTIVACIÓN
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Eliminar cualquier caché que no sea la v4
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Eliminando caché antigua:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Tomar el control de todas las pestañas abiertas inmediatamente
      return self.clients.claim();
    })
  );
});

// 3. INTERCEPTOR DE RED (FETCH)
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Ignorar métodos no-GET
  if (request.method !== 'GET') return;

  // Ignorar esquemas que no son HTTP/HTTPS (ej. chrome-extension)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // NUNCA cachear Supabase (REST, Auth, Storage)
  if (NEVER_CACHE_HOSTS.some(host => url.hostname.includes(host))) {
    return; // Dejar que vaya directo a la red
  }

  // NUNCA cachear admin.html
  if (url.pathname === '/admin.html') {
    return; 
  }

  // A) NAVEGACIÓN (HTML) -> Network First con fallback
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
          // Si no hay red, buscar en caché
          return caches.match(request).then(cachedResponse => {
            if (cachedResponse) return cachedResponse;
            // Si no está en caché, ir al index.html por defecto (SPA fallback)
            return caches.match('/index.html');
          }).then(fallbackResponse => {
            if (fallbackResponse) return fallbackResponse;
            // Página offline ultra-básica si todo falla
            return new Response(
              '<html><body style="text-align:center; padding:50px; font-family:sans-serif;"><h1>📡 Sin conexión</h1><p>No se pudo cargar la tienda. Revisa tu conexión a internet.</p><button onclick="location.reload()">Reintentar</button></body></html>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          });
        })
    );
    return;
  }

  // B) CDNs externos (Fuentes, JS de terceros) -> Cache First
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
        }).catch(() => new Response('', { status: 504, statusText: 'Offline' }));
      })
    );
    return;
  }

  // C) Assets propios (Imágenes, CSS) -> Stale While Revalidate
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

  // D) Todo lo demás -> Network First
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || new Response('', { status: 504 })))
  );
});

// 4. MENSAJES (Permite forzar la actualización desde el frontend)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
