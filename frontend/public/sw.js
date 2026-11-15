// Minimal service worker to enable PWA installability.
// No offline caching — network requests pass through untouched.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Passthrough: let the browser handle the request normally.
});
