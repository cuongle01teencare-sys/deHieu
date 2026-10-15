/* Arb Ops service worker — thông báo đẩy + mở đúng màn khi bấm thông báo.
 * OneSignal dùng worker riêng ở /push/onesignal/OneSignalSDKWorker.js, không import ở đây.
 * Không cache HTML (trang cần phiên đăng nhập); dữ liệu offline dùng bản chụp trong localStorage. */
self.addEventListener('install', () => {});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// payload: { title, body, url }
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Arb Ops', {
      body: d.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: d.tag,
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin);
  target.searchParams.set('from', 'push');
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.navigate(target.href).then((w) => w && w.focus());
      return self.clients.openWindow(target.href);
    }),
  );
});
