/* Service worker của CTV Chat: nhận thông báo đẩy (kể cả khi đã đóng app) và mở đúng đoạn chat khi bấm vào thông báo. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // app đang mở và đang được dùng → app tự báo (âm thanh, số tin chưa đọc), không hiện thêm thông báo
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (!d.force && wins.some((w) => w.focused)) return;
    await self.registration.showNotification(d.title || 'CTV Chat', {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      vibrate: [80, 40, 80],
      timestamp: Date.now(),
      data: { url: d.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((x) => new URL(x.url).origin === self.location.origin);
    if (w) { await w.focus(); w.postMessage({ type: 'open', url }); return; }
    await self.clients.openWindow(url);
  })());
});
