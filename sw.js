/* 菜單拍照計算機 — Service Worker
 *
 * 目的：讓店家斷網時仍能開啟頁面（離線租期／30 天倒數的前提）。
 * 策略：
 *   1. 頁面本身（navigate）→ 先連網拿最新版，失敗才用快取 → 更新不會卡住。
 *   2. 同源靜態檔與 Firebase SDK / lz-string CDN → 先快取，沒有才連網。
 *   3. Firestore / Auth / QR API → 一律不攔，直接走網路（避免快取到資料或授權）。
 *
 * 改版時只要改下面的 CACHE_NAME（例如 mpc-cache-v2），
 * 舊快取會在 activate 時自動清掉。
 */
const CACHE_NAME = 'mpc-cache-v2';

const SHELL = [
  './',
  './index.html',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js',
  'https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js'
];

// 絕不快取的網域（資料 / 授權 / 外部服務）
const NEVER_CACHE = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebaseapp.com',
  'api.qrserver.com'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.all(SHELL.map(function(url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function(err) {
          console.warn('[SW] 預快取失敗：', url, err && err.message);
        });
      }));
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; })
                            .map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (NEVER_CACHE.some(function(h) { return url.hostname === h || url.hostname.endsWith('.' + h); })) return;

  // 1. 頁面：先連網，失敗才用快取
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function(res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(c) { c.put('./index.html', copy); });
        return res;
      }).catch(function() {
        return caches.match('./index.html').then(function(r) {
          return r || caches.match('./');
        });
      })
    );
    return;
  }

  // 2. 同源資源 + 已知 CDN：先快取，沒有才連網並存起來
  if (url.origin === self.location.origin || url.hostname === 'www.gstatic.com' || url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(res) {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(CACHE_NAME).then(function(c) { c.put(req, copy); });
          }
          return res;
        }).catch(function() { return cached; });
      })
    );
  }
});
