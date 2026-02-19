// Service Worker for instant loading on repeat visits
// CACHE_VERSION is updated at build time or on deploy to bust stale caches.
// Vite hashes JS/CSS assets, but index.html is not hashed — bumping this
// version ensures the shell HTML is refreshed after each deployment.
const CACHE_VERSION = '__BUILD_TIME__';
const CACHE_NAME = `roadmap-${CACHE_VERSION}`;

// Assets to cache immediately on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html'
];

// Install: cache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  // Activate immediately — don't wait for existing clients to close
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  // Take control immediately
  self.clients.claim();
});

// Fetch: network-first for navigation (HTML), stale-while-revalidate for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip Firebase/API requests (always fetch fresh)
  if (request.url.includes('firebaseio.com') ||
      request.url.includes('googleapis.com') ||
      request.url.includes('firebase')) {
    return;
  }

  // Navigation requests (HTML pages): network-first so new deploys load immediately
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          const cache = caches.open(CACHE_NAME).then((c) => {
            c.put(request, networkResponse.clone());
            return networkResponse;
          });
          return cache;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Other assets: stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(request);

      // Fetch fresh version in background
      const fetchPromise = fetch(request).then((networkResponse) => {
        // Cache successful responses
        if (networkResponse.ok) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(() => cachedResponse); // Fallback to cache on network error

      // Return cached immediately, update in background
      return cachedResponse || fetchPromise;
    })
  );
});
