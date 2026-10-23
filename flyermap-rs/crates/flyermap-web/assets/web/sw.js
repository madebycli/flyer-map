// Verteil-Flyer: the app shell, offline. One cache per build (BUILD is a hash of the files, set by scripts/rs-web-sw.mjs), filled all or nothing when the worker
// installs; the files of the shell come from it first, a page load gets the cached index (which then asks for the same files), and everything else (the API,
// a map server) goes to the network untouched. A new build installs next to the old one and takes over for the next load; open pages are not changed under their feet.
const BUILD = '__BUILD__';
const CACHE = `fm-shell-${BUILD}`;
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fm-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || url.pathname.includes('/api/')) return;
  if (request.mode === 'navigate') {
    const index = new URL('index.html', self.registration.scope).href;
    event.respondWith(caches.match(index, { cacheName: CACHE }).then((hit) => hit || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(request)));
});
