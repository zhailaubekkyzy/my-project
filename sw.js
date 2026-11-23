// sw.js - SmartFlow as an app on the home screen (вход через браузер, часть 1; решения владелицы 23 нояб.).
// Nothing is cached here: the app always takes the fresh version from the network (as inside Telegram).
// A fetch handler must exist for the browser to offer «Установить». Part 2 adds the notifications (push).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // The network answers as usual
});
