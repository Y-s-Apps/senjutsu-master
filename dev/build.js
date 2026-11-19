#!/usr/bin/env node
// 公開用ファイルを組み立てる:  node dev/build.js
//   dev/src/page.html + *.js  →  index.html（リポジトリ直下・GitHub Pages 用）と sw.js
//                              →  dev/dist/artifact.html（Claude のアーティファクト用）
//                              →  dev/out/line/（LINE版＝LINEミニアプリ。Cloudflare Pages がビルドして公開する。git には入れない）
// リポジトリ直下の index.html と sw.js は生成物なので、手で編集しない。
//   node dev/build.js --chars  →  画面に出る可能性のある文字を出力する（dev/fonts/make_fonts.py が使う）
// 外部への通信はしない: フォントは fonts/ のサブセット、script はすべてインライン（CSP で許すのはそのハッシュだけ）。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const live = require('./livedata');

const APP_ID = 'senjutsu-master'; // キャッシュ名の接頭辞
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(__dirname, 'src');
// live.js はファイルではなく、dev/src/live/ の JSON（日程と節ごとの問題）から作る。
// JSON の中の "<" は \u003c にして、文の中身で </script> が閉じられないようにする。
const LIVE_JS = () => `window.LIVE = ${JSON.stringify(live.load()).replace(/</g, '\\u003c')};`;
const read = f => (f === 'live.js' ? LIVE_JS() : fs.readFileSync(path.join(SRC, f), 'utf8'));
const DATA_FILES = ['data1.js', 'data2.js', 'data3.js', 'data4.js', 'data5.js'];

// 0) フォントの文字: ソースに出てくる文字（budoux.js は辞書なので除く）と ASCII。
//    fonts/ のサブセットに足りない文字があれば止める（make_fonts.py で作り直す）。
function usedChars() {
  const text = ['page.html', 'app.js', 'logic.js', ...DATA_FILES].map(read).join('') + live.texts();
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
//    HTML は正規表現で読まない。page.html に書いた <script src="…"></script> を決まった文字列として置き換え、
//    埋め込んだ中身（SCRIPTS）をそのまま CSP のハッシュに使う。script を足したら SCRIPT_FILES にも足す。
const SCRIPT_FILES = [...DATA_FILES, 'live.js', 'logic.js', 'budoux.js', 'app.js'];
const SW_REG = "if('serviceWorker' in navigator&&location.protocol==='https:')addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));";
const SCRIPTS = [];
const src = read('page.html');
if (src.includes('http://') || src.includes('https://')) throw new Error('page.html が外部の URL を読み込んでいます（フォントは fonts/ に置く）');
let page = src;
for (const f of SCRIPT_FILES) {
  const tag = `<script src="${f}"></script>`;
  const parts = page.split(tag);
  if (parts.length !== 2) throw new Error(`page.html に ${tag} がちょうど1つありません`);
  const body = `\n${read(f).trim()}\n`;
  if (body.toLowerCase().includes('</script')) throw new Error(`${f} に </script が含まれています`);
  SCRIPTS.push(body);
  page = parts.join(`<script>${body}</script>`);
}
if (page.includes('<script src=')) throw new Error('インライン化できない script が残っています（SCRIPT_FILES に足す）');

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
<meta name="theme-color" content="#0B0B0B">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="戦術マスター">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<style>:root{background:#0B0B0B;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${headPart}
</head>
<body>
${bodyPart}
<script>${SW_REG}</script>
</body>
</html>
`;
// CSP（GitHub Pages はヘッダーを設定できないので <meta> で）。script は、このページに埋め込んだものだけをハッシュで許す。
// 外部への通信はすべて禁止。style 属性を innerHTML で入れているので style だけ 'unsafe-inline'。
const inline = [...SCRIPTS, SW_REG];
if (html.split('<script').length - 1 !== inline.length || !inline.every(s => html.includes(`<script>${s}</script>`))) {
  throw new Error('index.html の script が、埋め込んだものと一致しません');
}
const hashes = inline.map(s => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`);
const csp = [
  "default-src 'none'", `script-src ${hashes.join(' ')}`, "style-src 'self' 'unsafe-inline'", "font-src 'self'",
  "img-src 'self'", "manifest-src 'self'", "worker-src 'self'", "connect-src 'self'", "base-uri 'none'", "form-action 'none'"
].join('; ');
html = html.replace('__CSP__', csp);
fs.writeFileSync(path.join(ROOT, 'index.html'), html);

// 5) service worker（ページ本体はネット優先＝修正がすぐ届く。オフラインでは保存済みのものを使う）
const sw = `// 戦術マスター service worker — version ${ver}（dev/build.js が生成）
// - ページ本体（./ と index.html）はネット優先。正常な応答（200）だけを保存し、ネットが使えない・エラーのときは保存済みを出す
// - アイコン・フォントなど CORE のファイルは保存済み優先（インストール時にブラウザのキャッシュを通さず取得）
// - それ以外のリクエスト（同じサイトの別ページ・外部）には関わらず、保存もしない
const CACHE = '${APP_ID}-${ver}';
const CORE = ['index.html', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'favicon-32.png', ${FONTS.map(f => `'fonts/${f}'`).join(', ')}];
const PAGE = new URL('./', location).pathname;
const ASSETS = new Set(CORE.map(u => new URL(u, location).pathname));
const good = res => res.ok && res.type === 'basic';
const cached = key => caches.open(CACHE).then(c => c.match(key));
const keep = (e, key, res) => { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then(c => c.put(key, copy))); };
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('${APP_ID}-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
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
`;
fs.writeFileSync(path.join(ROOT, 'sw.js'), sw);

// 6) LINE版（LINEミニアプリ）。ホーム画面版と同じページの最後に line.js を足す（ホーム画面版・アーティファクト版の出力は変えない）。
//    Service Worker・manifest・apple-touch-icon は入れない。外への通信は LINE の SDK（static.line-scdn.net）と API（*.line.me）だけ許す。
//    同じページを本番用＝いちばん上、審査用＝review/、開発用＝dev/ に置き、line.js がひらいた場所で LIFF ID をえらぶ
//    （LINE Developers の「ウェブアプリ設定」のエンドポイントURLとそろえる）。フォント・favicon・licenses はいちばん上にだけ置き、
//    どの場所からも /fonts/… のように同じものを指す。
//    line.js は usedChars() に入れていない（いまは画面に文字を出さない）。画面に出す文を足すときは、usedChars() に入れてフォントを作り直す。
const LINE_OUT = path.join(__dirname, 'out', 'line');
const LINE_JS = `\n${read('line.js').trim()}\n`;
if (LINE_JS.toLowerCase().includes('</script')) throw new Error('line.js に </script が含まれています');
const lineHead = headPart.split('url("fonts/').join('url("/fonts/');
if (lineHead.split('url("/fonts/').length - 1 !== FONTS.length) throw new Error('LINE版: page.html のフォントの数が fonts/ と合いません');
const SAFE_BOTTOM = 'max(12px,env(safe-area-inset-bottom,0px),var(--android-safe-area-inset-bottom,0px))';
let lineHtml = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="__CSP__">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="戦術ボードの状況を読んで次のプレーを選び、選手の動きと解説で理由を学ぶサッカー戦術クイズ。初級・中級・上級（指導者向け）の3段階。">
<meta name="theme-color" content="#0B0B0B">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<style>:root{background:#0B0B0B;padding-top:env(safe-area-inset-top,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${lineHead}
<style>
/* LINE版だけ: Android版LINE（26.3.0〜）は edge-to-edge 表示。下のナビゲーションバーの分を、LINE の変数と safe-area の大きいほうであける。
   :root ではなく、画面いっぱいの入れもの（#app と記録の引っこしの .sheet-bg）ごとに書く（うちのこ日和で、:root だと小さい Android で下が隠れた） */
html #app{padding-bottom:${SAFE_BOTTOM}}
html .sheet-bg{padding-bottom:${SAFE_BOTTOM}}
/* 開発用の画面だけ、右上のすみに小さく「開発用」 */
html[data-line-ch="dev"] body::after{content:"開発用";position:fixed;top:2px;right:6px;z-index:20;font:600 10px/1 var(--f-body);color:var(--pen);pointer-events:none}
</style>
</head>
<body>
${bodyPart}
<script>${LINE_JS}</script>
</body>
</html>
`;
const lineInline = [...SCRIPTS, LINE_JS];
if (lineHtml.split('<script').length - 1 !== lineInline.length || !lineInline.every(s => lineHtml.includes(`<script>${s}</script>`))) {
  throw new Error('LINE版の script が、埋め込んだものと一致しません');
}
const lineHashes = lineInline.map(s => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`);
const lineCsp = [
  "default-src 'none'", `script-src ${lineHashes.join(' ')} https://static.line-scdn.net`, "style-src 'self' 'unsafe-inline'",
  "font-src 'self'", "img-src 'self' https://*.line-scdn.net", "connect-src 'self' https://*.line.me https://*.line-scdn.net",
  "frame-src https://*.line.me", "base-uri 'none'", "form-action 'none'"
].join('; ');
lineHtml = lineHtml.replace('__CSP__', lineCsp);
fs.rmSync(LINE_OUT, { recursive: true, force: true });
for (const d of ['', 'review', 'dev']) {
  fs.mkdirSync(path.join(LINE_OUT, d), { recursive: true });
  fs.writeFileSync(path.join(LINE_OUT, d, 'index.html'), lineHtml);
}
fs.mkdirSync(path.join(LINE_OUT, 'fonts'));
for (const f of FONTS) fs.copyFileSync(path.join(ROOT, 'fonts', f), path.join(LINE_OUT, 'fonts', f));
fs.copyFileSync(path.join(ROOT, 'favicon-32.png'), path.join(LINE_OUT, 'favicon-32.png'));
fs.cpSync(path.join(ROOT, 'licenses'), path.join(LINE_OUT, 'licenses'), { recursive: true });
// Cloudflare Pages の HTTP ヘッダー（meta の CSP では書けないもの）。ほかのサイトの枠（iframe）に入れさせない指定は、
// うちのこ日和と同じく、まず開発用だけに入れ、iPhone の LINE でひらけるのを確かめてから全部へ広げる
fs.writeFileSync(path.join(LINE_OUT, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
/dev/*
  Content-Security-Policy: frame-ancestors 'none'
  X-Frame-Options: DENY
`);

console.log(`built ${ver}: index.html (${(html.length / 1024).toFixed(1)} KB), sw.js, dev/dist/artifact.html, dev/out/line/`);
