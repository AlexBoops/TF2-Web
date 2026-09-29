/**
 * Universal Service Worker for TF2 / Source Engine Web Ports
 * Features:
 *  - Injects COOP/COEP for SharedArrayBuffer & Atomics support
 *  - Caches heavy WebAssembly, .so, and .data chunks
 *  - Normalizes sub-repository base paths
 */

const CACHE_NAME = 'source-engine-assets-v1';

// File extensions to cache in CacheStorage for instant replays
const CACHEABLE_EXTENSIONS = [
  '.wasm',
  '.data',
  '.so',
  '.bsp',
  '.vpk',
  '.mp3',
  '.wav',
  '.png',
  '.jpg'
];

self.addEventListener('install', (event) => {
  // Activate worker immediately without waiting for page refresh
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clean up stale caches
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
      // Claim clients immediately so the first visit is isolated
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Ignore non-GET and chrome-extension/internal requests
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    (async () => {
      const url = new URL(request.url);

      // Check if URL matches game binary / asset chunks
      const shouldCache = CACHEABLE_EXTENSIONS.some((ext) => url.pathname.endsWith(ext));

      if (shouldCache) {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          // Serve from cache with headers injected
          return addIsolationHeaders(cachedResponse);
        }

        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.status === 200) {
            // Clone and store in cache
            cache.put(request, networkResponse.clone());
          }
          return addIsolationHeaders(networkResponse);
        } catch (err) {
          if (cachedResponse) return addIsolationHeaders(cachedResponse);
          throw err;
        }
      }

      // Default network request with COOP/COEP isolation headers attached
      try {
        const response = await fetch(request);
        return addIsolationHeaders(response);
      } catch (err) {
        return fetch(request);
      }
    })()
  );
});

/**
 * Injects Cross-Origin Isolation headers required for SharedArrayBuffer & WASM multi-threading
 */
function addIsolationHeaders(response) {
  if (!response || response.status === 0 || response.type === 'opaque') {
    return response;
  }

  const newHeaders = new Headers(response.headers);
  newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
  newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
  newHeaders.set('Access-Control-Allow-Origin', '*');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
