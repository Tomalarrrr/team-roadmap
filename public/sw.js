// Service Worker for instant loading on repeat visits
// CACHE_VERSION is stamped at build time by vite.config.ts swVersionPlugin.
const CACHE_VERSION = '__BUILD_TIME__';
const CACHE_NAME = `roadmap-${CACHE_VERSION}`;

// Install: skip waiting to activate immediately
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Activate: clean ALL old caches, take control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip Firebase/API requests — always go to network
  const url = request.url;
  if (url.includes('firebaseio.com') ||
      url.includes('googleapis.com') ||
      url.includes('firebase')) {
    return;
  }

  // Navigation requests (HTML): network-first, cache fallback for offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache the fresh HTML for offline fallback
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Hashed assets (/assets/*): network-first with cache fallback.
  // This prevents stale HTML from loading 404'd old assets.
  if (url.includes('/assets/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          // If asset 404s, clear all caches and tell clients to reload
          if (response.status === 404) {
            caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
            self.clients.matchAll().then((clients) => {
              clients.forEach((client) => client.postMessage({ type: 'CACHE_BUSTED' }));
            });
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Other static assets (images, fonts): cache-first for speed
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
