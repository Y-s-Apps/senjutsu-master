"""LINE版（LINEミニアプリ）の確認:  python3 dev/test/line.py [--shots]

node dev/build.js が作った dev/out/line/ を、ローカルの Web サーバーのいちばん上から開く（Cloudflare Pages と同じ位置）。
LIFF SDK（static.line-scdn.net）はテストの中でまねる（本物は読まない）。
- line.js の LIFF ID が LINE の形（数字10けた-英数字8けた）で、3つとも別                → でなければ失敗
- 3か所の index.html が同じ                                                      → でなければ失敗
- 本番用 /・審査用 /review/・開発用 /dev/ のどれも、その場所の LIFF ID で liff.init し、
  ホームが出て1問目まで遊べる。data-line-ch が場所と合い、「開発用」の印は /dev/ だけ    → でなければ失敗
- SDK が読める・LINE の中 → ready と data-line-client、LINE の外 → ready、SDK が読めない → failed、
  初期化が終わらない → 10秒で failed。どれでも SDK を待たずに画面が出て、遊べる          → でなければ失敗
- LIFF ID を空にした版（このテストの中だけで作る。CSP のハッシュも作り直す）は SDK を読まない → 読んだら失敗
- 外部への通信（SDK のほか）・CSP に止められたもの・ページのエラー・フォントが読めない    → 失敗
- Android版LINE の下のすき間（--android-safe-area-inset-bottom: 48px）で #app の下があき、問題の画面と 412x780 のホームが
  スクロールなしに収まる → でなければ失敗（390x700・360x620 のホームのはみ出しは注意だけ。HANDOFF §5）
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

m = re.search(r"liffIds: \{ prod: '([^']*)', review: '([^']*)', dev: '([^']*)' \}", (ROOT / 'dev' / 'src' / 'line.js').read_text(encoding='utf-8'))
IDS = dict(zip(('prod', 'review', 'dev'), m.groups())) if m else {}
if not m:
    fails.append(('ids', 'line.js の liffIds が読めない'))
elif not all(re.fullmatch(r'\d{10}-[A-Za-z0-9]{8}', v) for v in IDS.values()) or len(set(IDS.values())) != 3:
    fails.append(('ids', 'LIFF ID の形がちがうか、同じものがある', IDS))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve(directory):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(directory)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_port}'


def without_ids(html):
    """LIFF ID を空にした版を作る（line.js の中身が変わるので、CSP のハッシュも作り直す）"""
    old = re.findall(r'<script>(.*?)</script>', html, flags=re.S)[-1]
    new = re.sub(r"liffIds: \{[^}]*\}", "liffIds: { prod: '', review: '', dev: '' }", old)
    h = lambda s: "'sha256-" + base64.b64encode(hashlib.sha256(s.encode('utf-8')).digest()).decode() + "'"
    if h(old) not in html:
        fails.append(('csp', 'CSP に line.js のハッシュがない'))
    return html.replace(old, new).replace(h(old), h(new))


OV = """() => { const d = document.documentElement; const sc = document.querySelector('.screen');
  return Math.max(d.scrollHeight - innerHeight, d.scrollWidth - innerWidth, sc ? sc.scrollHeight - sc.clientHeight : 0); }"""
FONTS = """async () => { await document.fonts.ready;
  return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '') + ' ' + f.weight); }"""
STATE = """() => ({ line: document.documentElement.dataset.line, ch: document.documentElement.dataset.lineCh,
  client: document.documentElement.dataset.lineClient === '1', mark: getComputedStyle(document.body, '::after').content,
  init: window.__initId || null })"""


def stub(in_client=False, hang=False):
    """LIFF SDK のまね。liff.init に渡された LIFF ID を window.__initId に残す"""
    init = 'new Promise(() => {})' if hang else 'Promise.resolve()'
    return (f"window.liff = {{ init: o => {{ window.__initId = o && o.liffId; return {init}; }},"
            f" isInClient: () => {str(in_client).lower()} }};")


def page(browser, base, errors, sdk=None, w=390, h=700, inset=0):
    pg = browser.new_page(viewport={'width': w, 'height': h})
    pg.on('pageerror', lambda e: errors.append(f'エラー: {e}'))
    pg.on('console', lambda m: errors.append(f'CSP: {m.text}') if 'Content Security Policy' in m.text else None)
    if inset:
        pg.add_init_script("document.addEventListener('DOMContentLoaded', () => document.documentElement.style"
                           f".setProperty('--android-safe-area-inset-bottom', '{inset}px'))")

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


def wait_state(pg, want, tag, timeout=15000):
    try:
        pg.wait_for_function(f"() => document.documentElement.dataset.line === '{want}'", timeout=timeout)
    except Exception:
        fails.append((tag, f'data-line が {want} にならない', pg.evaluate(STATE)))


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
    # 1) 3か所とも、その場所の LIFF ID で初期化し、ふつうに遊べる（LINE の中のまね）
    for d, ch in (('/', 'prod'), ('/review/', 'review'), ('/dev/', 'dev')):
        pg = page(browser, base, errors, sdk=stub(in_client=True))
        pg.goto(base + d)
        pg.wait_for_selector('[data-start="basic"]')
        wait_state(pg, 'ready', d)
        st = pg.evaluate(STATE)
        if st['ch'] != ch or st['init'] != IDS.get(ch) or not st['client']:
            fails.append((d, '場所・LIFF ID・LINE の中の判定が合わない', st))
        if ch == 'dev' and st['mark'] != '"開発用 ready / LINE"':
            fails.append((d, '「開発用」の印と状態が出ない', st['mark']))
        if ch != 'dev' and st['mark'] not in ('none', 'normal', ''):
            fails.append((d, '開発用でないのに印が出る', st['mark']))
        loaded.update(pg.evaluate(FONTS))
        if pg.evaluate(OV) > 0:
            fails.append((d, 'ホームがスクロールする'))
        if TAKE and ch == 'dev':
            SHOTS.mkdir(parents=True, exist_ok=True)
            pg.screenshot(path=str(SHOTS / 'line-dev-home.png'))
        play_one(pg, d)
        pg.close()
    # 2) SDK の読み込みと初期化の結果ごとに（開発用で）。どれでも SDK を待たずに画面が出る
    for name, sdk, want, client in (('LINE の外', stub(), 'ready', False), ('SDK が読めない', 'abort', 'failed', False),
                                    ('初期化が終わらない', stub(in_client=True, hang=True), 'failed', False)):
        pg = page(browser, base, errors, sdk=sdk)
        pg.goto(base + '/dev/')
        pg.wait_for_selector('[data-start="basic"]')
        wait_state(pg, want, name)
        st = pg.evaluate(STATE)
        if st['client'] != client:
            fails.append((name, 'data-line-client が合わない', st))
        if want == 'failed' and not st['mark'].startswith('"開発用 failed / '):
            fails.append((name, '開発用の印に失敗の合図が出ない', st['mark']))
        play_one(pg, name)
        pg.close()
    # 3) Android版LINE の下のすき間（LINE が --android-safe-area-inset-bottom を入れる）。
    #    412x780（ふつうの Android の LINE の中の大きさ）は収まらなければ失敗。390x700・360x620 のホームは、
    #    詰める仕組み（page.html の max-height のメディアクエリ）が画面の高さで決まり、すき間を見ないので、いまは注意だけ
    for w, h in ((412, 780), (390, 700), (360, 620)):
        pg = page(browser, base, errors, sdk=stub(in_client=True), w=w, h=h, inset=48)
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

    # 4) LIFF ID を空にした版: SDK を読まずに off のまま遊べる（SDK を読んだら「外部への通信」になる）
    tmp = pathlib.Path(tempfile.mkdtemp())
    shutil.copytree(OUT, tmp / 'line')
    for d in ('', 'review', 'dev'):
        f = tmp / 'line' / d / 'index.html'
        f.write_text(without_ids(f.read_text(encoding='utf-8')), encoding='utf-8')
    srv, base = serve(tmp / 'line')
    pg = page(browser, base, errors)
    pg.goto(base + '/dev/')
    pg.wait_for_selector('[data-start="basic"]')
    pg.wait_for_timeout(300)
    st = pg.evaluate(STATE)
    if st['line'] != 'off' or pg.evaluate('() => !!window.liff') or st['mark'] != '"開発用 off"':
        fails.append(('LIFF ID なし', 'SDK を読んだか、off にならない', st))
    play_one(pg, 'LIFF ID なし')
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
