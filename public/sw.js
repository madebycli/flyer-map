/*
 * Service worker of the app shell (ADR-0038). It keeps the pages and their hashed files so the installed app starts without a network;
 * it never touches /api/, other origins or the version file, and navigations are network-first: online, the HTML is always the newest.
 * Registered as /sw.js?v=<build>, so every build installs its own copy and its own page cache.
 */
const BUILD = new URL(self.location.href).searchParams.get('v') || '0';
const PAGES = `vf-pages-${BUILD}`;
const FILES = 'vf-files';
const NAVIGATION_WAIT_MS = 4000;

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== PAGES && name !== FILES) await caches.delete(name);
    await self.clients.claim();
  })());
});

/** One cached page per path: the query (?campaign=…) and the fragment never change the shell. */
const pageKey = (url) => new Request(new URL(url.pathname, url.origin).href);

async function networkFirstPage(request, url) {
  const pages = await caches.open(PAGES);
  const cached = () => pages.match(pageKey(url));
  const fetched = fetch(request).then((response) => {
    if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) pages.put(pageKey(url), response.clone());
    return response;
  });
  // slow or no network: after a short wait the cached shell wins (if there is one); the network answer still refreshes the cache
  const wait = new Promise((resolve) => setTimeout(resolve, NAVIGATION_WAIT_MS, null));
  try {
    const first = await Promise.race([fetched.catch(() => null), wait]);
    if (first) return first;
    return (await cached()) || (await fetched);
  } catch {
    return (await cached()) || Response.error();
  }
}

async function cacheFirstFile(request) {
  const files = await caches.open(FILES);
  const hit = await files.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) files.put(request, response.clone());
  return response;
}

async function networkFirstFile(request) {
  const files = await caches.open(FILES);
  try {
    const response = await fetch(request);
    if (response.ok) files.put(request, response.clone());
    return response;
  } catch {
    return (await files.match(request)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/version.json' || url.pathname === '/sw.js') return;
  if (request.mode === 'navigate') { event.respondWith(networkFirstPage(request, url)); return; }
  if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirstFile(request)); return; }
  event.respondWith(networkFirstFile(request));
});
