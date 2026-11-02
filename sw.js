// 黑客书架 Service Worker：静态资源与封面缓存优先，数据 JSON 网络优先，离线时回退缓存。
const VERSION = 'hb-v9'; // v8: 版本化静态资源缓存优先 + 首屏数据 preload + 今日书架限量 120 本；v7: 字体子集全量重制
const STATIC = [
  './',
  'index.html',
  'app.js',
  'app.css',
  'fonts/fonts.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/icon-180.png',
  'assets/reward-qr.png',
  'assets/wechat-qr.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // 封面与图标：缓存优先（内容不变）
  if (url.pathname.includes('/covers/') || url.pathname.includes('/icons/')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
        if (r.ok) { const c = r.clone(); caches.open(VERSION).then((cache) => cache.put(e.request, c)); }
        return r;
      }))
    );
    return;
  }

  // 带版本号的静态资源与字体：缓存优先（发版靠 URL 版本失效，回访零网络等待）
  if (url.pathname.startsWith('/fonts/') ||
      ((url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) && url.search.startsWith('?v='))) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
        if (r.ok) { const c = r.clone(); caches.open(VERSION).then((cache) => cache.put(e.request, c)); }
        return r;
      }))
    );
    return;
  }

  // 数据 JSON / HTML / 其余：网络优先，失败回退缓存（保证离线可浏览已缓存部分）
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok && (url.pathname.startsWith('/data/') || e.request.mode === 'navigate')) {
        const c = r.clone();
        caches.open(VERSION).then((cache) => cache.put(e.request, c));
      }
      return r;
    }).catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('./') : undefined)))
  );
});
