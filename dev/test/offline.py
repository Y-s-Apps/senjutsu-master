"""Service Worker（オフライン）の確認:  python3 dev/test/offline.py [サイトのフォルダ]

ビルド済みのサイト（既定はリポジトリ直下）を一時フォルダの /senjutsu-master/ にコピーして配信し、
Service Worker を登録したうえで、次の場面でもアプリが正しく開くかを確かめる。
- 一度開いたあと、オフラインで開き直す（フォントも出る）
- 同じサイトの別ページ（licenses/ のライセンス本文）を開いたあと、オフラインで開き直す
- 存在しないページ（404）を開いたあと、オフラインで開き直す
- サーバーが一時的にエラー（500）を返す
- 一度 404 だったファイルが、あとで置かれたら取れる（エラーの応答を保存しない）
本番（https）では index.html が自動で登録するが、ここは http://127.0.0.1 なのでテストから登録する。
必要なもの: pip install playwright && playwright install chromium
"""
import functools
import http.server
import pathlib
import shutil
import sys
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
SITE = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT
FILES = ['index.html', 'sw.js', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
         'icon-maskable-512.png', 'favicon-32.png', 'fonts', 'licenses']

MODE = {'v': 'online'}  # online / offline / error500


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')  # ブラウザのキャッシュではなく Service Worker の働きを測る
        super().end_headers()

    def do_GET(self):
        if MODE['v'] == 'offline':
            self.close_connection = True  # 何も返さずに切る＝ネットワークの失敗
            return
        if MODE['v'] == 'error500' and self.path.split('?')[0] in ('/senjutsu-master/', '/senjutsu-master/index.html'):
            self.send_error(500)
            return
        super().do_GET()


APP = """async () => { await document.fonts.ready; return {
  app: document.querySelectorAll('.lv').length === 3,
  font: [...document.fonts].some(f => f.family.includes('TM Gothic') && f.status === 'loaded'),
  text: document.body.innerText.slice(0, 40) }; }"""


def main():
    tmp = pathlib.Path(tempfile.mkdtemp())
    site = tmp / 'senjutsu-master'
    site.mkdir()
    for f in FILES:
        src = SITE / f
        if src.is_dir():
            shutil.copytree(src, site / f)
        elif src.exists():
            shutil.copy(src, site / f)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(tmp)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{srv.server_port}/senjutsu-master/'
    results = []

    def check(name, r, want_app=True, want_font=True):
        ok = r['app'] == want_app and (not want_font or r['font'])
        results.append(ok)
        print(('OK ' if ok else 'NG '), name, '' if ok else r)

    with sync_playwright() as p:
        browser = p.chromium.launch()

        def fresh():
            MODE['v'] = 'online'
            ctx = browser.new_context(service_workers='allow')
            pg = ctx.new_page()
            pg.goto(base)
            pg.evaluate("async () => { await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; }")
            pg.reload()
            pg.wait_for_function('() => !!navigator.serviceWorker.controller')
            return ctx, pg

        # 1) 一度開いたあと、オフラインで開き直す
        ctx, pg = fresh()
        MODE['v'] = 'offline'
        pg.reload()
        check('オフラインで開き直す', pg.evaluate(APP))
        ctx.close()

        # 2) 同じサイトの別ページを開いたあと、オフライン
        ctx, pg = fresh()
        pg.goto(base + 'licenses/BudouX-Apache-2.0.txt')
        MODE['v'] = 'offline'
        pg.goto(base)
        check('別ページを開いたあと、オフラインで開く', pg.evaluate(APP))
        ctx.close()

        # 3) 404 のページを開いたあと、オフライン
        ctx, pg = fresh()
        pg.goto(base + 'nope/')
        MODE['v'] = 'offline'
        pg.goto(base)
        check('404 を開いたあと、オフラインで開く', pg.evaluate(APP))
        ctx.close()

        # 4) サーバーが一時的に 500 を返す → 保存済みのページを出す。直ったあとオフラインでも正しく開く
        ctx, pg = fresh()
        MODE['v'] = 'error500'
        pg.goto(base)
        check('サーバーが 500 のとき', pg.evaluate(APP))
        MODE['v'] = 'offline'
        pg.goto(base)
        check('500 のあと、オフラインで開く', pg.evaluate(APP))
        ctx.close()

        # 5) 一度 404 だったファイルが、あとで置かれたら取れる
        ctx, pg = fresh()
        later = site / 'later.txt'
        s1 = pg.evaluate("async () => (await fetch('later.txt')).status")
        later.write_text('ok')
        s2 = pg.evaluate("async () => (await fetch('later.txt')).status")
        later.unlink()
        ok = s1 == 404 and s2 == 200
        results.append(ok)
        print(('OK ' if ok else 'NG '), '404 だったファイルが、あとで取れる', '' if ok else (s1, s2))
        ctx.close()

        # 6) 新しい版を公開したら切り替わり、古い版の保存データは消える
        ctx, pg = fresh()
        sw = site / 'sw.js'
        old = sw.read_text(encoding='utf-8')
        sw.write_text(old.replace("const CACHE = 'senjutsu-master-", "const CACHE = 'senjutsu-master-next"), encoding='utf-8')
        pg.evaluate("""async () => { const r = await navigator.serviceWorker.getRegistration();
          const changed = new Promise(ok => navigator.serviceWorker.addEventListener('controllerchange', ok, { once: true }));
          await r.update(); await changed; }""")
        keys = pg.evaluate("""async () => { for (let i = 0; i < 30; i++) {  // 削除は切り替えの少しあとに見えるので、最大3秒待つ
          const k = await caches.keys(); if (k.length === 1) return k; await new Promise(r => setTimeout(r, 100)); }
          return caches.keys(); }""")
        sw.write_text(old, encoding='utf-8')
        ok = len(keys) == 1 and 'next' in keys[0]
        results.append(ok)
        print(('OK ' if ok else 'NG '), '新しい版に切り替わり、古い保存データが消える', '' if ok else keys)
        ctx.close()

        browser.close()
    srv.shutdown()
    shutil.rmtree(tmp)
    print('ok' if all(results) else f'{results.count(False)} fail')
    sys.exit(0 if all(results) else 1)


if __name__ == '__main__':
    main()
