// sw.js - SmartFlow as an app on the home screen (вход через браузер; решения владелицы 23 нояб.).
// Part 1: nothing is cached here — the app always takes the fresh version from the network (as inside Telegram);
// a fetch handler must exist for the browser to offer «Установить».
// Part 2: notifications (Web Push). The server sends { title, body, url, tag }; a tap opens SmartFlow on that screen
// (an open SmartFlow window is reused).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // The network answers as usual
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(self.registration.showNotification(data.title || 'SmartFlow', {
    body: data.body || 'Новое в SmartFlow',
    icon: 'images/icon-192.png',
    badge: 'images/icon-192.png',
    tag: data.tag || 'smartflow',
    renotify: true,
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  // Only our own address opens (the server always sends one)
  const target = url.origin === self.location.origin ? url.href : self.location.origin + '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
        await w.focus();
        if ('navigate' in w) return w.navigate(target).catch(() => null);
        return null;
      }
    }
    return self.clients.openWindow(target);
  })());
});
