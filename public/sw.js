const CACHE_NAME = 'anurags-gpt-cache-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-512.png'
];

// 1. Install & Cache
self.addEventListener('install', event => {
  self.skipWaiting(); // Forces the new service worker to activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// 2. Activate & Clean Up Old Caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Clearing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Network-First Fetch Strategy
self.addEventListener('fetch', event => {
  // Never intercept API calls, Firebase auth, or OpenRouter requests
  if (event.request.url.includes('/api/') || event.request.url.includes('firestore') || event.request.url.includes('identitytoolkit')) {
    return; 
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // If the network fetch is successful, clone it and update the cache
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // If the user is offline, fall back to the cached version
        return caches.match(event.request);
      })
  );
});