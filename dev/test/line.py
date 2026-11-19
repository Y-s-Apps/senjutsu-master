"""LINE版（LINEミニアプリ）の確認:  python3 dev/test/line.py [--shots]

node dev/build.js が作った dev/out/line/ を、ローカルの Web サーバーのいちばん上から開く（Cloudflare Pages と同じ位置）。
- 本番用 /・審査用 /review/・開発用 /dev/ のどれも、ホームが出て、1問目まで遊べる  → でなければ失敗
- 3か所の index.html が同じ                                                      → でなければ失敗
- data-line-ch が場所と合う。「開発用」の印は /dev/ だけ                           → でなければ失敗
- LIFF ID が空のあいだは SDK を読まない（data-line="off"）                          → 読んだら失敗
- 外部への通信・CSP に止められたもの・ページのエラー・フォントが読めない            → 失敗
- Android版LINE の下のすき間（--android-safe-area-inset-bottom: 48px）で、#app の下があき、問題の画面と 412x780 のホームがスクロールなしに収まる
  → でなければ失敗（390x700・360x620 のホームのはみ出しは注意だけ）
- LIFF ID を入れた版（このテストの中だけで作る。CSP のハッシュも作り直す）で:
  SDK が読める・LINE の中 → ready と data-line-client、LINE の外 → ready、SDK が読めない → failed、
  初期化が終わらない → 10秒で failed。どれでもホームから遊べる                       → でなければ失敗
- ホーム画面版の index.html に line.js が入っていない                              → 入っていたら失敗
--shots を付けると dev/test/shots/ に LINE版のスクリーンショットを保存する。
"""
import base64
import functools
import hashlib
import http.server
import pathlib
import re
import shutil
import sys
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'dev' / 'out' / 'line'
SDK = 'https://static.line-scdn.net/liff/edge/2/sdk.js'
SHOTS = ROOT / 'dev' / 'test' / 'shots'
TAKE = '--shots' in sys.argv
fails = []


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve(directory):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(directory)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_port}'


def with_ids(html):
    """LIFF ID を入れた版を作る（line.js の中身が変わるので、CSP のハッシュも作り直す）"""
    blocks = re.findall(r'<script>(.*?)</script>', html, flags=re.S)
    old = blocks[-1]
    if "liffIds: { prod: '', review: '', dev: '' }" not in old:
        fails.append(('ids', 'line.js の liffIds が空でない（このテストは空のときに書いてある）'))
        return html
    new = old.replace("liffIds: { prod: '', review: '', dev: '' }", "liffIds: { prod: '1-prod', review: '1-review', dev: '1-dev' }")
    h = lambda s: "'sha256-" + base64.b64encode(hashlib.sha256(s.encode('utf-8')).digest()).decode() + "'"
    if h(old) not in html:
        fails.append(('ids', 'CSP に line.js のハッシュがない'))
    return html.replace(old, new).replace(h(old), h(new))


OV = """() => { const d = document.documentElement; const sc = document.querySelector('.screen');
  return Math.max(d.scrollHeight - innerHeight, d.scrollWidth - innerWidth, sc ? sc.scrollHeight - sc.clientHeight : 0); }"""
FONTS = """async () => { await document.fonts.ready;
  return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '') + ' ' + f.weight); }"""


def page(browser, base, errors, sdk=None, w=390, h=700):
    pg = browser.new_page(viewport={'width': w, 'height': h})
    pg.on('pageerror', lambda e: errors.append(f'エラー: {e}'))
    pg.on('console', lambda m: errors.append(f'CSP: {m.text}') if 'Content Security Policy' in m.text else None)

    def route(r):
        u = r.request.url
        if u.startswith(base):
            return r.continue_()
        if u == SDK and sdk is not None:
            return r.abort() if sdk == 'abort' else r.fulfill(status=200, content_type='application/javascript', body=sdk)
        errors.append(f'外部への通信: {u}')
        r.abort()
    pg.route('**/*', route)
    return pg


def play_one(pg, tag):
    """ホームからレベル1を選び、1問目に答えるところまで"""
    pg.click('[data-start="basic"]')
    pg.wait_for_selector('.screen.play')
    pg.click('.opt[data-k="A"]')
    pg.wait_for_selector('.tab')
    if pg.evaluate(OV) > 0:
        fails.append((tag, '問題の画面がスクロールする'))


def stub(in_client, hang=False):
    init = 'new Promise(() => {})' if hang else 'Promise.resolve()'
    return f"window.liff = {{ init: () => {init}, isInClient: () => {str(in_client).lower()} }};"


home = (ROOT / 'index.html').read_text(encoding='utf-8')
if 'TMLine' in home or 'liffIds' in home:
    fails.append(('home', 'ホーム画面版の index.html に line.js が入っている'))
pages = [(OUT / d / 'index.html').read_bytes() for d in ('', 'review', 'dev')]
if len(set(pages)) != 1:
    fails.append(('copies', '本番用・審査用・開発用の index.html が同じでない'))

loaded = set()
with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []
    srv, base = serve(OUT)
    # 1) LIFF ID が空のまま（いまの形）: 3か所とも、SDK を読まずにふつうに遊べる
    for d, ch in (('/', 'prod'), ('/review/', 'review'), ('/dev/', 'dev')):
        pg = page(browser, base, errors)
        pg.goto(base + d)
        pg.wait_for_selector('[data-start="basic"]')
        st = pg.evaluate("() => ({ line: document.documentElement.dataset.line, ch: document.documentElement.dataset.lineCh,"
                         " mark: getComputedStyle(document.body, '::after').content, liff: !!window.liff })")
        if st['line'] != 'off' or st['liff']:
            fails.append((d, 'LIFF ID がないのに SDK を読んだ', st))
        if st['ch'] != ch:
            fails.append((d, 'data-line-ch が場所と合わない', st))
        if (st['mark'] == '"開発用"') != (ch == 'dev'):
            fails.append((d, '「開発用」の印が合わない', st))
        loaded.update(pg.evaluate(FONTS))
        if pg.evaluate(OV) > 0:
            fails.append((d, 'ホームがスクロールする'))
        if TAKE and ch == 'dev':
            SHOTS.mkdir(parents=True, exist_ok=True)
            pg.screenshot(path=str(SHOTS / 'line-dev-home.png'))
        play_one(pg, d)
        pg.close()
    # 2) Android版LINE の下のすき間（LINE が --android-safe-area-inset-bottom を入れる）。
    #    412x780（ふつうの Android の LINE の中の大きさ）は収まらなければ失敗。390x700・360x620 のホームは、
    #    詰める仕組み（page.html の max-height のメディアクエリ）が画面の高さで決まり、すき間を見ないので、いまは注意だけ（HANDOFF §5）
    for w, h in ((412, 780), (390, 700), (360, 620)):
        pg = page(browser, base, errors, w=w, h=h)
        pg.add_init_script("document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('--android-safe-area-inset-bottom', '48px'))")
        pg.goto(base + '/')
        pg.wait_for_selector('[data-start="basic"]')
        pad = pg.evaluate("() => getComputedStyle(document.getElementById('app')).paddingBottom")
        if pad != '48px':
            fails.append((f'{w}x{h}', '#app の下が --android-safe-area-inset-bottom であかない', pad))
        ov = pg.evaluate(OV)
        if ov > 0 and w == 412:
            fails.append((f'{w}x{h}', '下のすき間ありでホームがスクロールする', ov))
        elif ov > 0:
            print(f'  note {w}x{h} 下のすき間ありでホームが {ov}px はみ出す')
        if TAKE and w == 360:
            pg.screenshot(path=str(SHOTS / 'line-android-home.png'))
        play_one(pg, f'{w}x{h} すき間あり')
        pg.close()
    srv.shutdown()

    # 3) LIFF ID を入れた版: SDK の読み込みと初期化の結果ごとに
    tmp = pathlib.Path(tempfile.mkdtemp())
    shutil.copytree(OUT, tmp / 'line')
    for d in ('', 'review', 'dev'):
        f = tmp / 'line' / d / 'index.html'
        f.write_text(with_ids(f.read_text(encoding='utf-8')), encoding='utf-8')
    srv, base = serve(tmp / 'line')
    cases = [
        ('LINE の中', stub(True), 'ready', True, 15000),
        ('LINE の外', stub(False), 'ready', False, 15000),
        ('SDK が読めない', 'abort', 'failed', False, 15000),
        ('初期化が終わらない', stub(True, hang=True), 'failed', False, 15000),
    ]
    for name, sdk, want, client, wait in cases:
        pg = page(browser, base, errors, sdk=sdk)
        pg.goto(base + '/dev/')
        pg.wait_for_selector('[data-start="basic"]')  # SDK を待たずに画面が出る
        try:
            pg.wait_for_function(f"() => document.documentElement.dataset.line === '{want}'", timeout=wait)
        except Exception:
            fails.append((name, f'data-line が {want} にならない', pg.evaluate('() => document.documentElement.dataset.line')))
        got = pg.evaluate('() => document.documentElement.dataset.lineClient === "1"')
        if got != client:
            fails.append((name, 'data-line-client が合わない', got))
        play_one(pg, name)
        pg.close()
    srv.shutdown()
    shutil.rmtree(tmp)
    browser.close()

need = {'TM Display 400', 'TM Gothic 400', 'TM Gothic 700', 'TM Mono 600'}
if not need <= loaded:
    fails.append(('fonts', '読み込めなかったフォント', sorted(need - loaded)))
for e in errors:
    fails.append(('errors', e))
for f in fails:
    print('FAIL', *f)
print('LINE版: OK' if not fails else f'LINE版: {len(fails)} 件の失敗')
sys.exit(1 if fails else 0)
