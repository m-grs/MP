const CACHE_NAME = 'mealprep-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css?v=1',
  './app.js?v=1',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Netzwerk zuerst: Updates erscheinen sofort, der Cache dient nur als Offline-Fallback
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return res;
    }).catch(() =>
      caches.match(e.request, { ignoreSearch: true })
        .then(hit => hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))
    )
  );
});
