// TRYDON service worker — offline read-only mode.
// Static assets: cache-first. App shell + /api/state GET: network-first with
// cache fallback so the deck opens (read-only) with the last synced state.
const CACHE = 'trydon-v2';
const PRECACHE = [
  '/', '/dc-runtime.js', '/trydon-bridge.js', '/manifest.webmanifest', '/icon.svg',
  '/vendor/react.production.min.js', '/vendor/react-dom.production.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // network-first for the app shell and state (fresh when online, cached offline)
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/api/state' || url.pathname === '/trydon-bridge.js') {
    e.respondWith(
      fetch(e.request).then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  if (url.pathname.startsWith('/api/')) return; // other API calls: network only

  // cache-first for static assets (fonts, images, vendor, runtime)
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }))
  );
});
