/* Preview service worker: cache-first for static shell assets,
   network-only for anything that looks like an API call. */
const CACHE = 'tether-shell-v2';
const ASSETS = [
  './index.html', './app.js', './manifest.webmanifest',
  './styles/tokens.css', './styles/base.css', './styles/glass.css', './styles/app.css',
  './pip/pip.css', './pip/pip.js', './island/island.css', './island/island.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.includes('/api/')) return; // never cache API
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
