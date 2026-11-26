/* Rent Desk – works offline once opened. Bump VERSION when files change. */
const VERSION = 'rentdesk-v12';
const FILES = ['./', 'index.html', 'styles.css', 'core.js', 'money.js', 'agreement.js', 'pdf.js', 'app.js', 'icon.svg', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const c = r.clone(); caches.open(VERSION).then(ch => ch.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
