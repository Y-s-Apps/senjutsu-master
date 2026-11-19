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
- Android版LINE の下のすき間（--android-safe-area-inset-bottom: 48px）で #app の下があき、412x780・390x700・360x620 の
  ホームと問題の画面がスクロールなしに収まる。360・390px 幅で画面の高さ 548〜900px（使える高さ 488px 以上）のホームと
  結果（「結果を送る」つき）もスクロールしない                                                  → でなければ失敗
- 結果のシェア: LINE の中でシェアターゲットピッカーが使えるときだけ結果画面に「結果を送る」が出て、押すと
  liff.shareTargetPicker に、カスタムシェアメッセージ（標準タイプ）の決まりどおりのバブル1つを渡す（画像は /share/、ボタンと
  フッターの矢印はその場所の LIFF URL、前節の一戦はリーグ名なし）。送った・やめた・失敗でボタンの文字が変わる → でなければ失敗
- 記録の引っこし: LINE の中で共有シートにファイルを渡せないときは「ファイルに保存」を出さない。渡せるときは共有シートを使い、
  失敗しても「保存しました」と出さない。LINE の外ではいつも出る                                → でなければ失敗
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
    """LIFF ID とお問い合わせ先（CONTACT）を空にした版を作る（line.js の中身が変わるので、CSP のハッシュも作り直す）"""
    old = re.findall(r'<script>(.*?)</script>', html, flags=re.S)[-1]
    new = re.sub(r"liffIds: \{[^}]*\}", "liffIds: { prod: '', review: '', dev: '' }", old)
    new = re.sub(r'const CONTACT = "[^"]*";', 'const CONTACT = "";', new)
    h = lambda s: "'sha256-" + base64.b64encode(hashlib.sha256(s.encode('utf-8')).digest()).decode() + "'"
    if h(old) not in html:
        fails.append(('csp', 'CSP に line.js のハッシュがない'))
    return html.replace(old, new).replace(h(old), h(new))


# ポリシー・規約のページで、行頭に来たら「語の途中で折れている」とみなす文字（fit.py の BREAKS と同じ考え方）
LEGAL_BREAKS = r"""() => {
  const BAD = /[をにがはのへてゃゅょぁぃぅぇぉっァィゥェォッャュョー、。・）」』，．：！？]/;
  const out = []; let prev = null;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  while (w.nextNode()) {
    const n = w.currentNode, el = n.parentElement;
    const block = el.closest('p, li, h1, h2, h3, th, td, footer');
    for (let i = 0; i < n.length; i++) {
      r.setStart(n, i); r.setEnd(n, i + 1);
      const b = r.getBoundingClientRect(); if (!b.width) continue;
      if (prev && prev.block === block && b.top > prev.top + 4 && BAD.test(n.data[i])) out.push((prev.text + '|' + n.data.slice(i, i + 6)).trim());
      prev = { block, top: b.top, text: (prev && prev.block === block ? prev.text : '').slice(-6) + n.data[i] };
    }
  }
  return out; }"""
OV = """() => { const d = document.documentElement; const sc = document.querySelector('.screen');
  return Math.max(d.scrollHeight - innerHeight, d.scrollWidth - innerWidth, sc ? sc.scrollHeight - sc.clientHeight : 0); }"""
FONTS = """async () => { await document.fonts.ready;
  return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '') + ' ' + f.weight); }"""
STATE = """() => ({ line: document.documentElement.dataset.line, ch: document.documentElement.dataset.lineCh,
  client: document.documentElement.dataset.lineClient === '1', mark: getComputedStyle(document.body, '::after').content,
  init: window.__initId || null })"""


def stub(in_client=False, hang=False, share=False, result='success'):
    """LIFF SDK のまね。liff.init に渡された LIFF ID を window.__initId に、shareTargetPicker に渡したものを window.__sent に残す"""
    init = 'new Promise(() => {})' if hang else 'Promise.resolve()'
    pick = {'success': "Promise.resolve({ status: 'success' })", 'cancel': 'Promise.resolve()',
            'error': "Promise.reject(Object.assign(new Error('x'), { code: 'FORBIDDEN' }))"}[result]
    return (f"window.liff = {{ init: o => {{ window.__initId = o && o.liffId; return {init}; }},"
            f" isInClient: () => {str(in_client).lower()},"
            f" isApiAvailable: n => {str(share).lower()} && n === 'shareTargetPicker',"
            f" shareTargetPicker: (m, o) => {{ window.__sent = m; window.__opts = o; return {pick}; }},"
            f" openWindow: o => {{ window.__ow = o; }} }};")


# 共有シート（Web Share のファイル）のまね。'none' は使えない（Android の LINE）、'ok' は渡せる、'fail' は渡せるはずが失敗する
SHARE_SHEET = {
    'none': "Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });",
    'ok': "Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });"
          "Object.defineProperty(navigator, 'share', { value: () => Promise.resolve(), configurable: true });",
    'fail': "Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });"
            "Object.defineProperty(navigator, 'share', { value: () => Promise.reject(new DOMException('no', 'NotAllowedError')), configurable: true });",
}
LINE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Line/15.19.0/IAB'


def page(browser, base, errors, sdk=None, w=390, h=700, inset=0, ua=None, sheet=None, best=False):
    pg = browser.new_context(viewport={'width': w, 'height': h}, user_agent=ua).new_page() if ua else browser.new_page(viewport={'width': w, 'height': h})
    if sheet:
        pg.add_init_script(SHARE_SHEET[sheet])
    if best:
        pg.add_init_script("localStorage.setItem('tacdrill-best-v1', JSON.stringify({ basic: 10, team: 8, club: 7 }))")
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


def to_result(pg, deck='team'):
    """ホームからデッキを選び、6問に答えて結果の画面まで"""
    pg.click(f'[data-start="{deck}"]')
    while not pg.query_selector('.screen.result'):
        pg.wait_for_selector('.opt')
        pg.click('.opt >> nth=0')
        pg.click('#next')


def check_message(sent, opts, base, ch, tag):
    """LINEミニアプリのカスタムシェアメッセージ（標準タイプ）の決まり（2026-11-20 に確認）"""
    url = 'https://miniapp.line.me/' + IDS.get(ch, '')
    probs = []
    try:
        if not isinstance(sent, list) or len(sent) != 1 or sent[0].get('type') != 'flex':
            raise ValueError('Flex Message 1つでない')
        m = sent[0]
        if not (0 < len(m.get('altText', '')) <= 100):
            probs.append('altText')
        b = m['contents']
        if b.get('type') != 'bubble':
            probs.append('バブルでない（カルーセルは使わない）')
        if b.get('hero') != {'type': 'image', 'url': base + '/share/hero.png', 'size': 'full', 'aspectMode': 'cover', 'aspectRatio': '20:13'}:
            probs.append(('画像', b.get('hero')))
        body = b['body']['contents']
        t, sub, det, btns = body[0]['contents'][0], body[1]['contents'][0], body[2], body[3]
        if not (t['size'] == 'lg' and t['color'] == '#000000' and t['weight'] == 'bold' and t['wrap'] is True and '点' in t['text']):
            probs.append(('タイトル', t))
        if not (sub['size'] == 'sm' and sub['color'] == '#999999' and sub['wrap'] is True):
            probs.append(('サブタイトル', sub))
        if not (det['layout'] == 'vertical' and det['spacing'] == 'sm' and det['margin'] == 'lg' and det['flex'] == 1 and 1 <= len(det['contents']) <= 10):
            probs.append(('詳細', det))
        for r in det['contents']:
            k, v = r['contents']
            if not (r['layout'] == 'horizontal' and k['color'] == '#555555' and k['flex'] == 20 and v['color'] == '#111111' and v['flex'] == 55 and k['wrap'] is False and v['wrap'] is False):
                probs.append(('詳細の行', r))
        bt = btns['contents']
        if not (1 <= len(bt) <= 3 and bt[0]['style'] == 'primary' and bt[0]['height'] == 'md' and bt[0]['action'] == {'type': 'uri', 'label': '戦術マスターで遊ぶ', 'uri': url}):
            probs.append(('ボタン', bt))
        sep, row = b['footer']['contents']
        icon, name, arrow = row['contents']
        if sep != {'type': 'separator', 'color': '#f0f0f0'} or row['layout'] != 'horizontal' or icon['url'] != base + '/share/icon.png' \
                or name['text'] != '戦術マスター' or arrow['url'] != 'https://vos.line-scdn.net/service-notifier/footer_go_btn.png' \
                or arrow['action']['uri'] != url:
            probs.append(('フッター', b['footer']))
        import json
        if len(json.dumps(b, ensure_ascii=False).encode()) > 10000:
            probs.append('バブルが 10KB を超える')
        if not (opts or {}).get('isMultiple'):
            probs.append('isMultiple でない（グループや複数の友だちに送れない）')
    except Exception as e:
        probs.append(f'形がちがう: {e!r}')
    for x in probs:
        fails.append((tag, 'シェアのメッセージ', x))


def wait_state(pg, want, tag, timeout=15000):
    try:
        pg.wait_for_function(f"() => document.documentElement.dataset.line === '{want}'", timeout=timeout)
    except Exception:
        fails.append((tag, f'data-line が {want} にならない', pg.evaluate(STATE)))


home = (ROOT / 'index.html').read_text(encoding='utf-8')
if 'liffIds' in home or 'shareTargetPicker' in home:  # app.js は window.TMLine を見るだけ
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
        if ch == 'dev' and not st['mark'].startswith('"開発用 ready / LINE / share:off / file:'):
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
    # 3) Android版LINE の下のすき間（LINE が --android-safe-area-inset-bottom を入れる）。詰め方は使える高さ（すき間を引いた高さ）で
    #    決まる（page.html の @container scr）ので、すき間があっても収まる
    for w, h in ((412, 780), (390, 700), (360, 620)):
        pg = page(browser, base, errors, sdk=stub(in_client=True), w=w, h=h, inset=48)
        pg.goto(base + '/')
        pg.wait_for_selector('[data-start="basic"]')
        pad = pg.evaluate("() => getComputedStyle(document.getElementById('app')).paddingBottom")
        if pad != '48px':
            fails.append((f'{w}x{h}', '#app の下が --android-safe-area-inset-bottom であかない', pad))
        ov = pg.evaluate(OV)
        if ov > 0:
            fails.append((f'{w}x{h}', '下のすき間ありでホームがスクロールする', ov))
        if TAKE and w == 360:
            pg.screenshot(path=str(SHOTS / 'line-android-home.png'))
        play_one(pg, f'{w}x{h} すき間あり')
        pg.close()
    # 3b) すき間 48px で高さを細かく変える: 使える高さ 488px 以上（画面の高さ 548px 以上）でホームと結果（「結果を送る」つき）が収まる
    for w in (360, 390):
        pg = page(browser, base, errors, sdk=stub(in_client=True, share=True), w=w, h=900, inset=48)
        pg.goto(base + '/')
        wait_state(pg, 'ready', f'{w} sweep')
        pg.evaluate('document.fonts.ready')
        for name in ('home', 'result'):
            if name == 'result':
                to_result(pg)
                if not pg.query_selector('#share'):
                    fails.append((f'{w} sweep', '結果に「結果を送る」がない'))
            bad = [h for h in range(548, 901, 8) if not pg.set_viewport_size({'width': w, 'height': h}) and pg.evaluate(OV) > 0]
            if bad:
                fails.append((f'{w}px 幅 すき間あり', name, 'はみ出す高さ', bad))
        pg.close()

    # 4) 結果のシェア: 本番用と開発用で、その場所の LIFF URL のメッセージを送る。送った・やめた・失敗でボタンが変わる
    for d, ch, result, want in (('/', 'prod', 'success', '送りました'), ('/dev/', 'dev', 'cancel', '結果を送る'), ('/dev/', 'dev', 'error', '送れませんでした')):
        tag = f'シェア {d} {result}'
        pg = page(browser, base, errors, sdk=stub(in_client=True, share=True, result=result))
        pg.goto(base + d)
        wait_state(pg, 'ready', tag)
        to_result(pg)
        if TAKE and result == 'success':
            pg.screenshot(path=str(SHOTS / 'line-result-share.png'))
        pg.click('#share')
        pg.wait_for_function(f"() => document.getElementById('share').textContent.trim() === '{want}'", timeout=3000)
        if result == 'success':
            check_message(pg.evaluate('window.__sent'), pg.evaluate('window.__opts'), base, ch, tag)
        pg.close()
    # 前節の一戦: リーグ名を出さない（カードが押せるときだけ）
    pg = page(browser, base, errors, sdk=stub(in_client=True, share=True))
    pg.goto(base + '/dev/')
    wait_state(pg, 'ready', 'シェア 前節')
    if not pg.is_disabled('[data-start="live"]'):
        to_result(pg, 'live')
        pg.click('#share')
        pg.wait_for_function("() => !!window.__sent")
        import json
        text = json.dumps(pg.evaluate('window.__sent'), ensure_ascii=False)
        if 'J1' in text or '前節の一戦 第' not in text:
            fails.append(('シェア 前節', 'リーグ名が入っているか、前節の一戦の節がない'))
    pg.close()
    # 「結果を送る」が出ない: LINE の外・シェアターゲットピッカーがオフ・SDK が読めない
    for name, sdk in (('LINE の外', stub(share=True)), ('ピッカーがオフ', stub(in_client=True)), ('SDK が読めない', 'abort')):
        pg = page(browser, base, errors, sdk=sdk)
        pg.goto(base + '/dev/')
        wait_state(pg, 'failed' if sdk == 'abort' else 'ready', name)
        to_result(pg)
        if pg.query_selector('#share'):
            fails.append((name, '「結果を送る」が出る'))
        pg.close()

    # 5) 記録の引っこし: LINE の中のファイル保存
    for name, ua, sheet, has_save, msg in (
            ('LINE の中・共有シートなし', LINE_UA, 'none', False, None),
            ('LINE の中・共有シートあり', LINE_UA, 'ok', True, '"ファイル"に保存'),
            ('LINE の中・共有シートが失敗', LINE_UA, 'fail', True, 'ここではファイルを保存できませんでした'),
            ('LINE の外', None, 'none', True, None)):
        pg = page(browser, base, errors, sdk=stub(in_client=ua is not None), ua=ua, sheet=sheet, best=True)
        pg.goto(base + '/dev/')
        wait_state(pg, 'ready', name)
        pg.click('#moveOpen')
        save = pg.query_selector('#mvSave')
        if bool(save) != has_save:
            fails.append((name, '「ファイルに保存」が' + ('出ない' if has_save else '出る')))
        if not has_save and 'ghost' in (pg.get_attribute('#mvCopy', 'class') or ''):
            fails.append((name, '「コードをコピー」が主のボタンになっていない'))
        if ua and 'LINE の中' not in pg.inner_text('.sheet-sub'):
            fails.append((name, '説明が LINE の中の文になっていない'))
        if save and msg:
            save.click()
            pg.wait_for_function("() => document.getElementById('mvMsg').textContent.includes('ファイル')", timeout=3000)
            got = pg.inner_text('#mvMsg')
            if msg not in got:
                fails.append((name, '保存のメッセージ', got))
        if TAKE and name == 'LINE の中・共有シートなし':
            pg.screenshot(path=str(SHOTS / 'line-move.png'))
        pg.close()

    # 7) プライバシーポリシー・利用規約（いちばん上の /privacy.html・/terms.html。build.js が dev/legal/ から作る）
    m2 = re.search(r"const CONTACT = \(process\.env\.CONTACT \?\? '([^']*)'\)", (ROOT / 'dev' / 'build.js').read_text(encoding='utf-8'))
    contact = m2.group(1) if m2 else ''
    if not re.fullmatch(r'https://forms\.gle/[A-Za-z0-9]+', contact):
        fails.append(('docs', 'build.js の CONTACT が Google フォームの URL でない', contact))
    for name in ('privacy', 'terms'):
        f = OUT / f'{name}.html'
        if not f.is_file():
            fails.append(('docs', f'{name}.html がない'))
            continue
        src = f.read_text(encoding='utf-8')
        if '<script' in src.lower() or "default-src 'none'" not in src or contact not in src or '<wbr>' not in src:
            fails.append(('docs', f'{name}.html: script がある・CSP がない・お問い合わせ先がない・<wbr> がない のどれか'))
        ext = set(re.findall(r'https?://[^\s"\'<>]+', src)) - {contact}
        if ext:
            fails.append(('docs', f'{name}.html にお問い合わせ先のほかの外部の URL', sorted(ext)))
        for w in (320, 360, 390):
            pg = page(browser, base, errors, w=w, h=700)
            pg.goto(base + f'/{name}.html')
            pg.wait_for_selector('footer a')
            over = pg.evaluate('() => document.documentElement.scrollWidth - innerWidth')
            if over > 0:
                fails.append(('docs', f'{name}.html {w}px: 横にはみ出す', over))
            bad = pg.evaluate(LEGAL_BREAKS)
            if bad:
                fails.append(('docs', f'{name}.html {w}px: 語の途中で改行', bad[:5]))
            if TAKE and w == 390:
                pg.screenshot(path=str(SHOTS / f'line-{name}.png'))
            pg.close()

    # 8) 記録の引っこしのいちばん下: ポリシー・規約・お問い合わせのリンクと「この端末の記録を消す」
    #    LINE の中は liff.openWindow（LINE のブラウザで上にひらく）、LINE の外は別のタブ
    for name, sdk, ua in (('LINE の中', stub(in_client=True), LINE_UA), ('LINE の外', stub(), None)):
        pg = page(browser, base, errors, sdk=sdk, ua=ua, best=True)
        pg.add_init_script("window.open = (u, t, f) => { window.__opened = [u, t, f]; return null; }")
        pg.goto(base + '/review/')
        wait_state(pg, 'ready', 'リンク ' + name)
        pg.click('#moveOpen')
        docs = pg.eval_on_selector_all('[data-doc]', 'bs => bs.map(b => b.dataset.doc + ":" + b.textContent)')
        if docs != ['privacy:プライバシーポリシー', 'terms:利用規約', 'contact:お問い合わせ']:
            fails.append(('リンク ' + name, 'リンクの並びか文字がちがう', docs))
        for doc, url in (('privacy', base + '/privacy.html'), ('terms', base + '/terms.html'), ('contact', contact)):
            pg.evaluate('() => { window.__ow = null; window.__opened = null; }')
            pg.click(f'[data-doc="{doc}"]')
            got = pg.evaluate('() => window.__ow') if ua else pg.evaluate('() => window.__opened')
            ok = (got == {'url': url, 'external': False}) if ua else (got == [url, '_blank', 'noopener'])
            if not ok:
                fails.append(('リンク ' + name, doc, got))
        pg.close()
    # 消す: もう一度たずねる・やめると何も消えない・消すとこのアプリの4つのキーだけ消える（ほかのアプリのキーは残す）
    pg = page(browser, base, errors, sdk=stub(in_client=True), ua=LINE_UA, best=True)
    pg.add_init_script("localStorage.setItem('senjutsu-master-fav-v1', 'yokohama');"
                       "localStorage.setItem('senjutsu-master-recent-v1', JSON.stringify({ basic: ['b01'] }));"
                       "localStorage.setItem('senjutsu-master-live-best-v1', JSON.stringify({ 'j1-2026-12': 8 }));"
                       "localStorage.setItem('uchinoko-test-key', '1');")
    pg.goto(base + '/')
    wait_state(pg, 'ready', '消す')
    KEYS = "() => ['tacdrill-best-v1', 'senjutsu-master-recent-v1', 'senjutsu-master-fav-v1', 'senjutsu-master-live-best-v1', 'uchinoko-test-key'].map(k => localStorage.getItem(k) !== null)"
    pg.click('#moveOpen')
    pg.click('#mvDel')
    if not pg.query_selector('#mvDelYes') or not pg.query_selector('#mvDelNo') or 'もとに戻せません' not in pg.inner_text('#mvMsg'):
        fails.append(('消す', 'もう一度たずねない'))
    pg.click('#mvDelNo')
    if pg.evaluate(KEYS) != [True] * 5 or not pg.query_selector('#mvDel'):
        fails.append(('消す', '「やめる」で記録が消えたか、元に戻らない'))
    pg.click('#mvDel')
    pg.click('#mvDelYes')
    if pg.evaluate(KEYS) != [False, False, False, False, True]:
        fails.append(('消す', '消えるキーがちがう', pg.evaluate(KEYS)))
    if not pg.is_disabled('#mvCopy') or pg.inner_text('#mvOut').strip() or '消しました' not in pg.inner_text('#mvMsg'):
        fails.append(('消す', '消したあとの画面（コピーのボタン・コード・メッセージ）'))
    pg.click('#mvClose')
    if '最高' in pg.inner_text('[data-start="basic"]') and '10' in pg.inner_text('[data-start="basic"] .lv-best'):
        fails.append(('消す', 'ホームに消した自己ベストが残っている'))
    pg.close()

    # 9) 記録の引っこしが、下のすき間 48px の Android の LINE でも収まる（いちばん下の2行がある。使える高さ 488px まで。320px 幅はできる範囲）
    pg = page(browser, base, errors, sdk=stub(in_client=True), ua=LINE_UA, best=True, inset=48)
    pg.add_init_script("localStorage.setItem('tacdrill-best-v1', JSON.stringify({ basic: 10, team: 8, coach: 6, club: 7, yokohama: 10, kashima: 9, nagoya: 11, suita: 12 }))")
    pg.goto(base + '/')
    wait_state(pg, 'ready', '引っこしの高さ')
    pg.click('#moveOpen')
    SH = "() => { const s = document.querySelector('.sheet'); return s.scrollHeight - s.clientHeight; }"
    for w in (360, 390, 412):
        for h in range(548, 901, 8):
            pg.set_viewport_size({'width': w, 'height': h})
            pg.wait_for_timeout(20)
            for st in ('ふだん', '消す前'):
                if st == '消す前':
                    pg.click('#mvDel')
                over = pg.evaluate(SH)
                if over > 0:
                    fails.append(('引っこしの高さ', f'{w}x{h} {st}', f'{over}px はみ出す'))
                if st == '消す前':
                    pg.click('#mvDelNo')
    pg.close()
    # 13 のデッキすべてに記録があり、画面もとても低いとき: 収まらない分は重ねの中のスクロールで届く（下が切れて押せない、にしない）
    pg = page(browser, base, errors, sdk=stub(in_client=True), ua=LINE_UA, w=360, h=548, inset=48)
    pg.add_init_script("localStorage.setItem('tacdrill-best-v1', JSON.stringify({ basic: 12, team: 12, coach: 12, club: 12, kashima: 12, urawa: 12,"
                       " chiba: 12, tokyo: 12, yokohama: 12, shimizu: 12, nagoya: 12, suita: 12, hiroshima: 12 }))")
    pg.goto(base + '/')
    wait_state(pg, 'ready', '引っこし 記録が多い')
    pg.click('#moveOpen')
    reach = pg.evaluate("""() => { const s = document.querySelector('.sheet'); s.scrollTop = s.scrollHeight;
      const a = s.getBoundingClientRect(), b = document.getElementById('mvDel').getBoundingClientRect();
      return getComputedStyle(s).overflowY === 'auto' && b.top >= a.top && b.bottom <= a.bottom; }""")
    if not reach:
        fails.append(('引っこし 記録が多い', '「この端末の記録を消す」に届かない'))
    pg.close()
    srv.shutdown()

    # 6) LIFF ID を空にした版: SDK を読まずに off のまま遊べる（SDK を読んだら「外部への通信」になる）
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
    pg.click('#moveOpen')
    if pg.query_selector('[data-doc]') or not pg.query_selector('#mvDel'):
        fails.append(('お問い合わせ先なし', 'リンクが出るか、「この端末の記録を消す」が出ない'))
    pg.click('#mvClose')
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
