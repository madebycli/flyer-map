self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Offline data caching is intentionally deferred to the dedicated offline-sync milestone.
// This service worker currently establishes the PWA lifecycle without risking stale app data.
