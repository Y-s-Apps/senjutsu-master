#!/usr/bin/env node
// 公開用ファイルを組み立てる:  node dev/build.js
//   dev/src/page.html + *.js  →  index.html（リポジトリ直下・GitHub Pages 用）と sw.js
//                              →  dev/dist/artifact.html（Claude のアーティファクト用）
// リポジトリ直下の index.html と sw.js は生成物なので、手で編集しない。
//   node dev/build.js --chars  →  画面に出る可能性のある文字を出力する（dev/fonts/make_fonts.py が使う）
// 外部への通信はしない: フォントは fonts/ のサブセット、script はすべてインライン（CSP で許すのはそのハッシュだけ）。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_ID = 'senjutsu-master'; // キャッシュ名の接頭辞
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(__dirname, 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

// 0) フォントの文字: ソースに出てくる文字（budoux.js は辞書なので除く）と ASCII。
//    fonts/ のサブセットに足りない文字があれば止める（make_fonts.py で作り直す）。
function usedChars() {
  const text = ['page.html', 'app.js', 'data1.js', 'data2.js', 'data3.js'].map(read).join('');
  const set = new Set([...text].filter(c => c >= ' '));
  for (let i = 0x20; i < 0x7f; i++) set.add(String.fromCharCode(i));
  return [...set].sort().join('');
}
if (process.argv.includes('--chars')) { process.stdout.write(usedChars()); process.exit(0); }
{
  const f = path.join(__dirname, 'fonts', 'chars.txt');
  const have = new Set(fs.existsSync(f) ? [...fs.readFileSync(f, 'utf8')] : []);
  const lack = [...usedChars()].filter(c => !have.has(c));
  if (lack.length) {
    console.error(`フォントのサブセットにない文字があります: ${lack.join('')}\n→ python3 dev/fonts/make_fonts.py を実行してから、もう一度ビルドしてください`);
    process.exit(1);
  }
}
const FONTS = fs.readdirSync(path.join(ROOT, 'fonts')).filter(f => f.endsWith('.woff2')).sort();

// 1) 外部 script をインライン化（1ファイルにすると、更新がすぐ届く）
const page = read('page.html').replace(/<script src="([\w.-]+)"><\/script>/g,
  (_, f) => `<script>\n${read(f).trim()}\n</script>`);
if (/<script src=/.test(page)) throw new Error('インライン化できない script が残っています');
if (/https?:\/\//.test(page.replace(/<script>[\s\S]*?<\/script>/g, ''))) throw new Error('page.html が外部の URL を読み込んでいます（フォントは fonts/ に置く）');

// 2) バージョン（日本時間 yyyymmddHHMM）
const jst = new Date(Date.now() + 9 * 3600e3).toISOString();
const ver = jst.slice(0, 16).replace(/[-T:]/g, '');

// 3) アーティファクト用（骨組みはアーティファクト側が付ける）。1ファイルで公開するので、フォントは data: で埋め込む
const artifact = page.replace(/url\("fonts\/([\w.-]+\.woff2)"\)/g,
  (_, f) => `url("data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, 'fonts', f)).toString('base64')}")`);
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), artifact);

// 4) GitHub Pages 用の完全な HTML
const cut = page.indexOf('<div id="app">');
if (cut < 0) throw new Error('page.html に <div id="app"> が見つかりません');
const headPart = page.slice(0, cut).replace(/<meta name="claude:[^>]*>\n?/g, '').trim();
const bodyPart = page.slice(cut).trim();
let html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="__CSP__">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="戦術ボードの状況を読んで次のプレーを選び、選手の動きと解説で理由を学ぶサッカー戦術クイズ。初級・中級・上級（指導者向け）の3段階。">
<meta name="theme-color" content="#0E1310">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="戦術マスター">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<style>:root{background:#0E1310;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${headPart}
</head>
<body>
${bodyPart}
<script>if('serviceWorker' in navigator&&location.protocol==='https:')addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));</script>
</body>
</html>
`;
// CSP（GitHub Pages はヘッダーを設定できないので <meta> で）。script は、このページに埋め込んだものだけをハッシュで許す。
// 外部への通信はすべて禁止。style 属性を innerHTML で入れているので style だけ 'unsafe-inline'。
const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(m => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
const csp = [
  "default-src 'none'", `script-src ${hashes.join(' ')}`, "style-src 'self' 'unsafe-inline'", "font-src 'self'",
  "img-src 'self'", "manifest-src 'self'", "worker-src 'self'", "connect-src 'self'", "base-uri 'none'", "form-action 'none'"
].join('; ');
html = html.replace('__CSP__', csp);
fs.writeFileSync(path.join(ROOT, 'index.html'), html);

// 5) service worker（ページ本体はネット優先＝修正がすぐ届く。オフラインでは保存済みのものを使う）
const sw = `// 戦術マスター service worker — version ${ver}（dev/build.js が生成）
const CACHE = '${APP_ID}-${ver}';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'favicon-32.png', ${FONTS.map(f => `'fonts/${f}'`).join(', ')}];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('${APP_ID}-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' || (url.origin === location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('index.html')))) {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); return res; }).catch(() => caches.match('index.html')));
    return;
  }
  if (url.origin === location.origin) { e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; }))); return; }
});
`;
fs.writeFileSync(path.join(ROOT, 'sw.js'), sw);

console.log(`built ${ver}: index.html (${(html.length / 1024).toFixed(1)} KB), sw.js, dev/dist/artifact.html`);
