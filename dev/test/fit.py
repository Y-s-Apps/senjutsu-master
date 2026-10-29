"""1画面に収まっているかの確認:  python3 dev/test/fit.py [--shots]

ビルド済みの index.html をローカルの Web サーバーから開き（fonts/ の実フォントで測る）、全18問を回答して、全タブの中身を表示する。
- ページ全体がスクロールする            → 失敗
- 回答前のパネルがはみ出す              → 失敗
- 390x700 でタブの中身がはみ出す        → 失敗（360x620 では注意だけ）
- 外部（自分のサイト以外）へ通信する    → 失敗
- CSP に止められたものがある            → 失敗
- fonts/ のフォントが読み込めない       → 失敗
- 「記録の引っこし」が画面からはみ出す・Esc で閉じない → 失敗（記録なし・ありの両方）
--shots を付けると dev/test/shots/ にスクリーンショットを保存する。
必要なもの: pip install playwright && playwright install chromium
"""
import functools
import http.server
import pathlib
import sys
import threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{server.server_port}/'
SHEET = """() => { const s = document.querySelector('.sheet'); if (!s) return null; const b = s.getBoundingClientRect();
  return { over: s.scrollHeight - s.clientHeight, out: Math.max(0, Math.ceil(b.bottom - innerHeight), Math.ceil(-b.top)) }; }"""
FONTS = """async () => { await document.fonts.ready;
  return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '') + ' ' + f.weight); }"""
SHOTS = ROOT / 'dev' / 'test' / 'shots'
TAKE = '--shots' in sys.argv
OV = """() => { const r = {}; const d = document.documentElement;
  const sc = document.querySelector('.screen');
  r.page = Math.max(d.scrollHeight - innerHeight, d.scrollWidth - innerWidth, sc ? sc.scrollHeight - sc.clientHeight : 0);
  const p = document.querySelector('.panel'); if (p) r.panel = p.scrollHeight - p.clientHeight;
  const t = document.querySelector('.tabbody'); if (t) r.tab = t.scrollHeight - t.clientHeight;
  const b = document.getElementById('board'); if (b) r.board = Math.round(b.getBoundingClientRect().height);
  return r; }"""
# 行頭に来たら「語の途中で折れている」とみなす文字（助詞・小さいかな・句読点など）
BREAKS = r"""() => {
  const BAD = /[をにがはのへてゃゅょぁぃぅぇぉっァィゥェォッャュョー、。・）」』，．：！？]/;
  const out = []; let prev = null;
  const w = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  while (w.nextNode()) {
    const n = w.currentNode, el = n.parentElement;
    if (el.closest('svg') || !el.getClientRects().length) continue;
    const block = el.closest('p, li, button, h1, h2, .lv > span, .rt > *');
    for (let i = 0; i < n.length; i++) {
      r.setStart(n, i); r.setEnd(n, i + 1);
      const b = r.getBoundingClientRect(); if (!b.width) continue;
      if (prev && prev.block === block && b.top > prev.top + 4 && BAD.test(n.data[i]))
        out.push((prev.text + '|' + n.data.slice(i, i + 6)).trim());
      prev = { block, top: b.top, text: (prev && prev.block === block ? prev.text : '').slice(-6) + n.data[i] };
    }
  }
  return out; }"""
bad_breaks = set()

SIZES = [('phone', 390, 700, 'light', True), ('small', 360, 620, 'light', False), ('desk', 1280, 760, 'dark', True)]
fails = []


def shot(pg, name):
    if TAKE:
        SHOTS.mkdir(parents=True, exist_ok=True)
        pg.screenshot(path=str(SHOTS / f'{name}.png'))


def sheet(pg, tag, name):
    """記録の引っこしを開き、はみ出し（中のスクロール・画面の外）と改行を確かめて閉じる"""
    pg.click('#moveOpen')
    r = pg.evaluate(SHEET)
    if r is None or r['over'] > 0 or r['out'] > 0:
        fails.append((tag, name, r))
    bad_breaks.update((tag, x) for x in pg.evaluate(BREAKS))
    shot(pg, f'{tag}-{name}')
    pg.keyboard.press('Escape')
    if pg.evaluate("() => !!document.getElementById('mv')"):
        fails.append((tag, name, 'Esc で閉じない'))


def run(pg, tag, strict):
    pg.goto(BASE + 'index.html')
    loaded.update(pg.evaluate(FONTS))
    r = pg.evaluate(OV)
    if r['page'] > 0:
        fails.append((tag, 'home', r))
    bad_breaks.update((tag, x) for x in pg.evaluate(BREAKS))
    shot(pg, f'{tag}-home')
    sheet(pg, tag, 'move-empty')
    for lv in range(3):
        pg.click(f'[data-start="{lv}"]')
        for qi in range(6):
            name = f'{tag} L{lv + 1}Q{qi + 1}'
            pre = pg.evaluate(OV)
            bad_breaks.update((tag, x) for x in pg.evaluate(BREAKS))
            if lv == 0 and qi == 0:
                shot(pg, f'{tag}-question')
            pg.click('.opt[data-k="A"]')
            over = {}
            for t in pg.query_selector_all('.tab'):
                t.click()
                v = pg.evaluate(OV).get('tab', 0)
                bad_breaks.update((tag, x) for x in pg.evaluate(BREAKS))
                if v > 0:
                    over[t.get_attribute('data-tab')] = v
            post = pg.evaluate(OV)
            if pre['page'] > 0 or post['page'] > 0 or pre.get('panel', 0) > 0 or (strict and over):
                fails.append((name, pre, over))
            elif over:
                print('  note', name, 'tab overflow', over)
            if pre.get('board') != post.get('board'):
                print('  note', name, 'board resized', pre.get('board'), '->', post.get('board'))
            if lv == 2 and qi == 0:
                pg.wait_for_timeout(3600)
                shot(pg, f'{tag}-feedback')
            pg.click('#next')
        r = pg.evaluate(OV)
        if r['page'] > 0:
            fails.append((f'{tag} L{lv + 1} result', r))
        bad_breaks.update((tag, x) for x in pg.evaluate(BREAKS))
        if lv == 2:
            shot(pg, f'{tag}-result')
        pg.click('#toHome')
    sheet(pg, tag, 'move')
    loaded.update(pg.evaluate(FONTS))


loaded = set()
with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []
    for tag, w, h, scheme, strict in SIZES:
        pg = browser.new_page(viewport={'width': w, 'height': h}, color_scheme=scheme)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(f'CSP: {m.text}') if 'Content Security Policy' in m.text else None)
        pg.route('**/*', lambda r: (errors.append(f'外部への通信: {r.request.url}'), r.abort()) if not r.request.url.startswith(BASE) else r.continue_())
        run(pg, tag, strict)
    browser.close()
server.shutdown()

for tag, x in sorted(bad_breaks):
    print('  break', tag, x)
fails += [('break', t, x) for t, x in bad_breaks if t == 'phone']
need = {'TM Display 400', 'TM Gothic 400', 'TM Gothic 700', 'TM Mono 600'}
if not need <= loaded:
    fails.append(('fonts', '読み込めなかったフォント', sorted(need - loaded)))
for f in fails:
    print('FAIL', *f)
for e in errors:
    print('JS ERROR', e)
print('ok' if not fails and not errors else f'{len(fails)} fail, {len(errors)} js error')
sys.exit(1 if fails or errors else 0)
