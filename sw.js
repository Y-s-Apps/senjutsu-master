// 戦術マスター service worker — version 202610300114（dev/build.js が生成）
// - ページ本体（./ と index.html）はネット優先。正常な応答（200）だけを保存し、ネットが使えない・エラーのときは保存済みを出す
// - アイコン・フォントなど CORE のファイルは保存済み優先（インストール時にブラウザのキャッシュを通さず取得）
// - それ以外のリクエスト（同じサイトの別ページ・外部）には関わらず、保存もしない
const CACHE = 'senjutsu-master-202610300114';
const CORE = ['index.html', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'favicon-32.png', 'fonts/tm-display-400.woff2', 'fonts/tm-gothic-400.woff2', 'fonts/tm-gothic-500.woff2', 'fonts/tm-gothic-700.woff2', 'fonts/tm-mono-500.woff2', 'fonts/tm-mono-600.woff2'];
const PAGE = new URL('./', location).pathname;
const ASSETS = new Set(CORE.map(u => new URL(u, location).pathname));
const good = res => res.ok && res.type === 'basic';
const cached = key => caches.open(CACHE).then(c => c.match(key));
const keep = (e, key, res) => { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then(c => c.put(key, copy))); };
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('senjutsu-master-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  if (url.pathname === PAGE || url.pathname === PAGE + 'index.html') {
    e.respondWith(fetch(req).then(
      res => { if (good(res)) { keep(e, 'index.html', res); return res; } return cached('index.html').then(hit => hit || res); },
      () => cached('index.html').then(hit => hit || Response.error())));
    return;
  }
  if (ASSETS.has(url.pathname)) {
    e.respondWith(cached(url.pathname).then(hit => hit || fetch(req).then(res => { if (good(res)) keep(e, url.pathname, res); return res; })));
  }
});
