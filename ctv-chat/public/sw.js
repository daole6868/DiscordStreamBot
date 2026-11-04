/* Service worker của CTV Chat: nhận thông báo đẩy (kể cả khi đã đóng app) và mở đúng đoạn chat khi bấm vào thông báo. */
const OFFLINE = '/offline.html';
self.addEventListener('install', (e) => e.waitUntil(caches.open('ctv-v1').then((c) => c.add(OFFLINE)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// Mở app khi mất mạng → hiện trang "Mất kết nối" (tự thử lại) thay vì trang lỗi của trình duyệt.
// Chỉ xử lý việc mở trang; tin nhắn, ảnh, API vẫn đi thẳng tới máy chủ như bình thường.
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // LUÔN hiện thông báo: iPhone (và Chrome) thu hồi quyền thông báo nếu nhận mà không hiện.
    // Máy chủ đã không gửi khi người dùng đang dùng app; lỡ trùng lúc đang mở thì hiện lặng lẽ (không kêu).
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const using = wins.some((w) => w.focused && w.visibilityState === 'visible');
    await self.registration.showNotification(d.title || 'CTV Chat', {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: !!d.tag && !using,
      silent: using && !d.force,
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
