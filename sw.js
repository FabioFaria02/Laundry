// Network-first for the app shell so updates show up right away; cache is only an offline fallback.
const CACHE = 'laundry-v11';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'store.js', 'i18n.js', 'reminders.js', 'config.js', 'manifest.webmanifest', 'icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // no-cache: always revalidate with the server instead of reusing GitHub Pages' 10-minute HTTP cache
  const fresh = e.request.mode === 'navigate'
    ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(
    fetch(fresh)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});

// reminders pushed by the GitHub Action (push/send.mjs) while the app is closed
self.addEventListener('push', e => {
  let msg = {};
  try { msg = e.data.json(); } catch { msg = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(msg.title || 'Money Laundry', {
    body: msg.body || '',
    tag: msg.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    vibrate: [200, 100, 200],
  }));
});

// tapping a reminder opens (or focuses) the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const open = list.find(c => c.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(self.registration.scope);
    }),
  );
});
