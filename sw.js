/**
 * Tiendas Sam's — Service Worker
 * Versión: v3 (2026-11)
 * 
 * Estrategias:
 *  - HTML / Navegación  → Network First (fallback a cache, fallback a /index.html)
 *  - CDN (fonts/SDKs)   → Cache First
 *  - Supabase API/Auth  → Network Only (nunca cachear datos privados)
 *  - admin.html         → NO precacheado (solo online)
 * 
 * Cambios vs v2:
 *  - /admin.html eliminado del precache
 *  - Exclusión explícita de *.supabase.co
 *  - Fallback a /index.html en navegaciones offline
 *  - Manejo de métodos no-GET y esquemas no-HTTP
 *  - Limpieza de cachés viejos
 */

const CACHE_NAME = 'tiendas-sams-v3';

// Solo precacheamos lo que el cliente público necesita offline
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/portal.html',
  '/info.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js'
];

// Dominios externos permitidos para cachear (CDN de librerías y fuentes)
const CACHEABLE_CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net'
];

// Dominios que NUNCA deben ser cacheados (API, auth, storage con datos privados)
const NEVER_CACHE_HOSTS = [
  'supabase.co'
];

// ============================================================
// 1. INSTALL — precachear assets críticos
// ============================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // addAll falla si UN asset falla → usamos individuales con catch
        return Promise.all(
          PRECACHE_ASSETS.map(url =>
            cache.add(url).catch(err => {
              console.warn('[SW] No se pudo precachear:', url, err.message);
            })
          )
        );
      })
      .then(() => self.skipWaiting()) // activa inmediatamente la nueva versión
  );
});

// ============================================================
// 2. ACTIVATE — limpiar cachés viejos y tomar control
// ============================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Eliminando caché antiguo:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim()) // controla clientes abiertos sin recargar
  );
});

// ============================================================
// 3. FETCH — interceptor con estrategia según tipo de request
// ============================================================
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // ----- FILTROS PREVIOS -----
  // Solo manejamos GET
  if (request.method !== 'GET') return;

  // Solo http(s)
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // NUNCA cachear Supabase (API REST, auth, storage)
  if (NEVER_CACHE_HOSTS.some(h => url.hostname.includes(h))) {
    // Network Only — dejamos que falle naturalmente si no hay red
    return;
  }

  // NUNCA cachear admin.html (ni siquiera como fallback)
  if (url.pathname === '/admin.html') {
    return;
  }

  // ----- ESTRATEGIA SEGÚN TIPO -----

  // A) Navegación (HTML) → Network First con fallback
  const isNavigation =
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(handleNavigation(request));
    return;
  }

  // B) CDN externo permitido → Cache First
  if (CACHEABLE_CDN_HOSTS.some(h => url.hostname === h)) {
    event.respondWith(handleCacheFirst(request));
    return;
  }

  // C) Assets propios (imágenes, JS, CSS, manifest) → Cache First con update en background
  if (url.origin === self.location.origin) {
    event.respondWith(handleStaleWhileRevalidate(request));
    return;
  }

  // D) Todo lo demás → Network First (con fallback a cache si existe)
  event.respondWith(handleNetworkFirst(request));
});

// ============================================================
// HANDLERS
// ============================================================

/**
 * Navegación: intenta red primero; si falla, cache; si tampoco, /index.html
 */
async function handleNavigation(request) {
  try {
    const networkResponse = await fetch(request);
    // Cacheamos solo respuestas exitosas (200 OK)
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    // Sin red → intentar cache exacto
    const cached = await caches.match(request);
    if (cached) return cached;

    // Fallback genérico para SPA
    const fallback = await caches.match('/index.html');
    if (fallback) return fallback;

    // Último recurso: página offline mínima
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión — Tiendas Sam's</title>
      <style>body{font-family:system-ui,sans-serif;background:#fcfbf8;color:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
      h1{font-size:28px;margin:0 0 12px}p{color:#595959;margin:0 0 24px;max-width:400px}
      button{background:#111;color:#fff;border:0;padding:14px 28px;border-radius:100px;font-weight:600;font-size:15px;cursor:pointer}</style>
      </head><body><div><h1>📡 Sin conexión</h1>
      <p>No podemos cargar la tienda en este momento. Revisa tu conexión a internet e intenta de nuevo.</p>
      <button onclick="location.reload()">Reintentar</button></div></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/**
 * Cache First: buscar en cache; si no está, red y guardar
 */
async function handleCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    // Sin red y sin cache: devolver respuesta vacía controlada
    console.warn('[SW] Fallo al obtener:', request.url);
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/**
 * Stale-While-Revalidate: sirve del cache y actualiza en background
 * Perfecto para imágenes de productos y JS propios
 */
async function handleStaleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(networkResponse => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  // Si hay cache, devolvemos ya (el update corre en background)
  if (cached) return cached;

  // Sin cache → esperamos la red
  const networkResponse = await fetchPromise;
  if (networkResponse) return networkResponse;

  // Sin cache y sin red → 504
  return new Response('', { status: 504, statusText: 'Offline' });
}

/**
 * Network First: intenta red; si falla, cache; si tampoco, 504
 */
async function handleNetworkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

// ============================================================
// 4. MESSAGE — permite forzar update desde la app (opcional)
// ============================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
