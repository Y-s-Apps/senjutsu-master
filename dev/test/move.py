"""「記録の引っこし」の確認:  python3 dev/test/move.py

ビルド済みの index.html をローカルの Web サーバーから開き、自己ベストの持ち出しと読み込みを確かめる。
- ファイルに保存 → 別のブラウザ（＝新しい URL やホーム画面のアプリ）でファイルを選ぶと、記録が移る
- コードのコピー → 貼り付けで移る（前後の空白・改行・全角になっていても読める）
- 読み込みは「高いレベルだけ更新」で、記録が下がらない
- 途中で切れた・書き換えたコード、別のファイル、大きすぎるファイルは読まず、記録も変えない
- 範囲外の値（満点より大きい・知らないレベル）は捨てる
- HTML を仕込んだファイルを選んでも、画面に差し込まれず、実行もされない
- 外部への通信・CSP 違反・JS エラーがない
必要なもの: pip install playwright && playwright install chromium
"""
import functools
import http.server
import json
import pathlib
import sys
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
KEY = 'tacdrill-best-v1'


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{server.server_port}/'
TMP = pathlib.Path(tempfile.mkdtemp())
results, errors = [], []


def ok(name, cond, detail=''):
    results.append(bool(cond))
    print(('OK ' if cond else 'NG '), name, '' if cond else detail)


def page(browser, best=None):
    ctx = browser.new_context(viewport={'width': 390, 'height': 700}, accept_downloads=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(f'CSP: {m.text}') if 'Content Security Policy' in m.text else None)
    pg.route('**/*', lambda r: (errors.append(f'外部: {r.request.url}'), r.abort()) if not r.request.url.startswith(BASE) else r.continue_())
    pg.goto(BASE + 'index.html')
    if best is not None:
        pg.evaluate('([k, v]) => localStorage.setItem(k, v)', [KEY, json.dumps(best)])
        pg.reload()
    pg.evaluate('() => { navigator.share = undefined; navigator.canShare = undefined; }')  # 共有シートのない環境として、ダウンロードで保存させる
    return ctx, pg


def stored(pg):
    return json.loads(pg.evaluate('k => localStorage.getItem(k)', KEY) or 'null')


def take_code(pg, text):
    pg.fill('#mvIn', text)
    pg.click('#mvTake')
    return pg.inner_text('#mvMsg')


def take_file(pg, path):
    pg.set_input_files('#mvFile', str(path))
    pg.wait_for_function("() => !document.getElementById('mvMsg').textContent.startsWith('読み込んだ記録は、いまより')")
    return pg.inner_text('#mvMsg')


with sync_playwright() as p:
    b = p.chromium.launch()

    # 1) 持ち出し（ファイルとコード）
    ctx, pg = page(b, {'basic': 10, 'coach': 6})
    pg.click('#moveOpen')
    code = pg.input_value('#mvOut')
    ok('コードの形', code.startswith('SENJUTSU1:basic=10,coach=6:') and len(code) == len('SENJUTSU1:basic=10,coach=6:') + 4, code)
    with pg.expect_download() as d:
        pg.click('#mvSave')
    f = TMP / 'kiroku.txt'
    d.value.save_as(str(f))
    text = f.read_text(encoding='utf-8')
    ok('ファイル名とファイルの中身', d.value.suggested_filename == 'senjutsu-master-kiroku.txt' and code in text, (d.value.suggested_filename, text))
    ctx.close()

    # 2) 新しい場所でファイルを選ぶ → 記録が移る（ホームにも出る）
    ctx, pg = page(b)
    pg.click('#moveOpen')
    msg = take_file(pg, f)
    ok('ファイルで移る', stored(pg) == {'basic': 10, 'coach': 6} and '移しました' in msg, (stored(pg), msg))
    pg.keyboard.press('Escape')
    best = pg.locator('.lv-best b').all_inner_texts()
    ok('ホームに反映', best == ['10', '—', '6'], best)
    ctx.close()

    # 3) コードを貼り付け（空白・改行・全角）、高いほうだけ更新
    ctx, pg = page(b, {'basic': 12, 'team': 5})
    pg.click('#moveOpen')
    messy = '  ' + code.replace(':', '：', 1).replace('basic', 'ｂａｓｉｃ') + '\n\n'
    msg = take_code(pg, messy)
    ok('空白・全角でも読める／高いほうだけ更新', stored(pg) == {'basic': 12, 'team': 5, 'coach': 6} and '上級 —→6' in msg, (stored(pg), msg))
    msg = take_code(pg, code)
    ok('同じか低い記録では変わらない', stored(pg) == {'basic': 12, 'team': 5, 'coach': 6} and '変わりませんでした' in msg, msg)

    # 4) 読まないもの
    before = stored(pg)
    cases = {
        '途中で切れたコード': code[:-3],
        '書き換えたコード': code.replace('basic=10', 'basic=12'),
        '別のテキスト': 'こんにちは',
        '空': '   ',
    }
    for name, t in cases.items():
        msg = take_code(pg, t)
        ok(f'{name}は読まない', stored(pg) == before and '移しました' not in msg, msg)

    # 範囲外の値（確認用の文字は正しく作る）
    def signed(body):
        return pg.evaluate("""body => { const s = 'SENJUTSU1:' + body; let h = 0x811c9dc5;
          for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
          return s + ':' + (h % 1679616).toString(36).padStart(4, '0'); }""", body)
    msg = take_code(pg, signed('basic=99,zzz=3'))
    ok('範囲外・知らないレベルは捨てる', stored(pg) == before and '記録が入っていません' in msg, msg)
    msg = take_code(pg, signed('team=-1'))
    ok('形の違うコードは読まない', stored(pg) == before and '欠けているか' in msg, msg)
    msg = take_code(pg, signed('team=11,basic=13'))
    ok('範囲内だけを使う', stored(pg) == {**before, 'team': 11}, (stored(pg), msg))
    before = stored(pg)

    # 5) 仕込んだファイル・大きなファイル
    evil = TMP / 'evil.txt'
    evil.write_text('<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>' + signed('basic=1'), encoding='utf-8')
    msg = take_file(pg, evil)
    injected = pg.evaluate("() => ({ x: window.__pwned || 0, img: document.querySelectorAll('#app img, #app script').length })")
    ok('HTML を仕込んだファイルは差し込まれない', injected == {'x': 0, 'img': 0} and stored(pg) == before, (injected, msg))
    big = TMP / 'big.txt'
    big.write_text('x' * 5000 + code, encoding='utf-8')
    msg = take_file(pg, big)
    ok('大きすぎるファイルは読まない', stored(pg) == before and '大きすぎ' in msg, msg)

    # 6) 記録がないときは持ち出せない
    ctx.close()
    ctx, pg = page(b)
    pg.click('#moveOpen')
    ok('記録がないときは保存・コピーできない', pg.is_disabled('#mvSave') and pg.is_disabled('#mvCopy') and pg.input_value('#mvOut') == '')
    ctx.close()
    b.close()

server.shutdown()
for e in errors:
    print('ERROR', e)
bad = results.count(False) + len(errors)
print('ok' if not bad else f'{bad} fail')
sys.exit(1 if bad else 0)
