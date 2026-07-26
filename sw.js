// Service Worker mínimo para cumplir los criterios de instalación PWA en Chrome/Android
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through fetch directo a la red (sin cacheo agresivo para evitar bugs de actualización)
  event.respondWith(fetch(event.request));
});
