// Minimal PWA Service Worker to satisfy Chrome / Android Installability requirements
const CACHE_NAME = 'online-clipboard-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network-first pass-through for real-time clipboard and API calls
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
