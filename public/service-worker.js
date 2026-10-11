// Replaced at build time with the deploy's commit (see swVersionPlugin in
// vite.config.js), so every deploy installs a new worker and clears old caches.
const VERSION = 'dev';
const CACHE_NAME = `our-kitchen-chronicles-shell-${VERSION}`;

const urlsToCache = [
  '/',
  '/index.html',
  '/site.webmanifest.json',
  '/img/icon/prod/wooden-spoon-32.png',
  '/img/icon/prod/wooden-spoon-192.png',
];

self.addEventListener('install', function (event) {
  // Take over from an older worker right away instead of waiting for every
  // tab to close — an older worker may serve a stale page.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(urlsToCache).catch(function (error) {
        console.warn('Failed to cache some resources:', error);
        // Don't fail the install if some resources can't be cached
        return Promise.resolve();
      });
    }),
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (cacheNames) {
        return Promise.all(
          cacheNames.map(function (cacheName) {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener('fetch', function (event) {
  // Pages (the app shell) come from the network first, so a deploy reaches
  // everyone on their next load; the saved copy is only an offline fallback.
  // A cache-first page would keep pointing at an old build's code files.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(function (response) {
          if (response && response.status === 200 && response.type === 'basic') {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put('/', copy);
            });
          }
          return response;
        })
        .catch(function () {
          return caches.match('/').then(function (cached) {
            return cached || caches.match('/index.html');
          });
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (response) {
      // Cache hit - return response
      if (response) {
        return response;
      }

      // IMPORTANT: Clone the request. A request is a stream and
      // can only be consumed once.
      var fetchRequest = event.request.clone();

      return fetch(fetchRequest)
        .then(function (response) {
          // Check if we received a valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // IMPORTANT: Clone the response. A response is a stream
          // and because we want the browser to consume the response
          // as well as the cache consuming the response, we need
          // to clone it so we have two streams.
          var responseToCache = response.clone();

          // Check if the request is for an image in the optimized folder
          if (event.request.url.includes('/img/category-jars/optimized/')) {
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, responseToCache);
            });
          }

          return response;
        })
        .catch(function (error) {
          console.warn('Fetch failed for:', event.request.url, error);
          // Return a generic response or cached fallback
          return new Response('Resource not available', {
            status: 404,
            statusText: 'Not Found',
          });
        });
    }),
  );
});
