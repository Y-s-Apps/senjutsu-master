"""1画面に収まっているかの確認:  python3 dev/test/fit.py [--shots]

ビルド済みの index.html をローカルの Web サーバーから開き（fonts/ の実フォントで測る）、
レベル3つと「名将の戦術」を、全問が出るまで続けて遊ぶ。「お気に入りクラブ」は、選ぶ画面から9クラブを順に選んで1回ずつ遊ぶ。
「前節の一戦」は、問題のある節ごとに日時を合わせて遊ぶ。
全問について、回答前のパネルと、回答後の全タブの中身を確かめる。
- ページ全体がスクロールする            → 失敗
- 回答前のパネルがはみ出す              → 失敗
- 390x700 でタブの中身がはみ出す        → 失敗（360x620 では注意だけ）
- 続けて遊んだとき、前回の問題がまた出る → 失敗
- ひと回り（全体÷6 回）で全問が出ない    → 失敗
- 選択肢が並べ替えられていない（ベストがいつも同じ記号） → 失敗
- 外部（自分のサイト以外）へ通信する    → 失敗
- CSP に止められたものがある            → 失敗
- fonts/ のフォントが読み込めない       → 失敗
- 「記録の引っこし」が画面からはみ出す・Esc で閉じない → 失敗（記録なし・ありの両方）
- 出題の履歴・お気に入りクラブ（localStorage）に壊れた値が入っていると動かない → 失敗
- お気に入りクラブ: 選ぶ画面がはみ出す、選んだクラブがホームのカードに出ない、1回で6問が出ない、自己ベストが残らない → 失敗
--shots を付けると dev/test/shots/ にスクリーンショットを保存する。
必要なもの: pip install playwright && playwright install chromium
"""
import datetime
import functools
import http.server
import math
import pathlib
import sys
import threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
TODAY = datetime.datetime.fromisoformat('2026-10-30T12:00:00+09:00')  # 前節の一戦は、この日時（第12節のあと）で遊ぶ


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
      // 「3-0」の「0」のように、ハイフンの後の数字が行頭に来るのも折れている
      if (prev && prev.block === block && b.top > prev.top + 4 && (BAD.test(n.data[i]) || (/\d/.test(n.data[i]) && /-\u2060?$/.test(prev.text))))
        out.push((prev.text + '|' + n.data.slice(i, i + 6)).trim());
      prev = { block, top: b.top, text: (prev && prev.block === block ? prev.text : '').slice(-6) + n.data[i] };
    }
  }
  return out; }"""
# 前節の一戦: 問題のある節と、その節が終わった1時間後の日時（logic.js の doneAt で計算）
ROUNDS = """() => (window.LIVE || []).flatMap(lg => lg.seasons.flatMap(se => se.matchdays
  .filter(md => se.rounds[md.no]).map(md => ({ label: `${lg.name} 第${md.no}節`, t: window.TM.doneAt(md) + 3600e3,
    ids: se.rounds[md.no].q.map(q => q.id) }))))"""
bad_breaks = set()

SIZES = [('phone', 390, 700, 'light', True), ('small', 360, 620, 'light', False), ('desk', 1280, 760, 'dark', True)]
DECKS = ['basic', 'team', 'coach', 'club']
fails = []
best_pos = {'A': 0, 'B': 0, 'C': 0}


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


def session(pg, tag, deck, strict, checked, shots=()):
    """1回分（最大6問）を遊ぶ。初めての問題は、回答前のパネルと回答後の全タブを確かめる。出た問題の id を返す"""
    ids = []
    while True:
        qid = pg.get_attribute('.screen.play', 'data-qid')
        ids.append(qid)
        name = f'{tag} {deck} {qid}'
        if qid in checked:
            pg.click('.opt[data-k="A"]')
        else:
            checked.add(qid)
            pre = pg.evaluate(OV)
            bad_breaks.update((tag, x) for x in pg.evaluate(BREAKS))
            if 'question' in shots and len(ids) == 1:
                shot(pg, f'{tag}-{deck}-question')
            pg.click('.opt[data-k="A"]')
            stamp = pg.get_attribute('#stamp', 'class') or ''
            if 'v2' in stamp:
                best_pos['A'] += 1
            else:
                best_pos[pg.evaluate("() => { const g = document.querySelector('#pitch .og.r2'); return g ? g.dataset.k : 'A'; }")] += 1
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
            if 'feedback' in shots and len(ids) == 1:
                pg.wait_for_timeout(3600)
                shot(pg, f'{tag}-{deck}-feedback')
        pg.click('#next')
        if pg.query_selector('.screen.result'):
            break
    r = pg.evaluate(OV)
    if r['page'] > 0:
        fails.append((f'{tag} {deck} result', r))
    bad_breaks.update((tag, x) for x in pg.evaluate(BREAKS))
    if 'result' in shots:
        shot(pg, f'{tag}-{deck}-result')
    return ids


def play_deck(pg, tag, deck, strict, checked, shots=()):
    """全問が出るまで続けて遊ぶ（「別の問題で」）。前回の問題が続けて出ないこと、ひと回りで全問が出ることを確かめる"""
    pool = set(pg.evaluate("id => (id === 'club' ? window.CLUB : window.LEVELS.find(L => L.id === id)).q.map(q => q.id)", deck))
    need = math.ceil(len(pool) / 6)
    pg.click(f'[data-start="{deck}"]')
    seen, prev = set(), set()
    for k in range(need):
        ids = session(pg, tag, deck, strict, checked, shots if k == 0 else ())
        if len(ids) != min(6, len(pool)) or len(set(ids)) != len(ids):
            fails.append((tag, deck, '1回の問題の数・重複', ids))
        if prev & set(ids):
            fails.append((tag, deck, '前回の問題がまた出た', sorted(prev & set(ids))))
        prev = set(ids)
        seen.update(ids)
        if seen == pool:
            break
        pg.click('#retry')
    if seen != pool:
        fails.append((tag, deck, f'{need} 回で全問が出ない', sorted(pool - seen)))
    pg.click('#toHome')


def play_fav(pg, tag, strict, checked):
    """お気に入りクラブ: 選ぶ画面から9クラブを順に選んで1回ずつ遊ぶ。ホームのカード・自己ベスト・選ぶ画面を確かめる"""
    clubs = pg.evaluate("() => window.FAV.clubs.map(c => ({ id: c.id, name: c.name, ids: c.q.map(q => q.id) }))")
    card = pg.inner_text('.levels')
    if 'クラブを選ぶ' not in card:
        fails.append((tag, 'fav', '未設定（壊れた値）のときに「クラブを選ぶ」が出ない'))
    pg.click('[data-pick]')
    for i, c in enumerate(clubs):
        r = pg.evaluate(OV)
        if r['page'] > 0:
            fails.append((tag, 'fav pick', r))
        bad_breaks.update((tag, x) for x in pg.evaluate(BREAKS))
        if i in (0, 1):
            shot(pg, f'{tag}-fav-pick' + ('' if i == 0 else '-set'))
        pg.click(f'[data-fav="{c["id"]}"]')
        ids = session(pg, tag, c['id'], strict, checked, ('question',) if i == 0 else ())
        if sorted(ids) != sorted(c['ids'][:6]):
            fails.append((tag, c['id'], '1回で6問が出ない', ids))
        pg.click('#toHome')
        head = pg.inner_text('.lv-fav')
        best = pg.evaluate("id => (JSON.parse(localStorage.getItem('tacdrill-best-v1')) || {})[id]", c['id'])
        if c['name'] not in head or best is None or f'{best}/12' not in head.replace('\n', ''):
            fails.append((tag, c['id'], 'ホームのカードにクラブ名・自己ベストが出ない', head, best))
        if i == 0:
            r = pg.evaluate(OV)
            if r['page'] > 0:
                fails.append((tag, 'home fav', r))
            bad_breaks.update((tag, x) for x in pg.evaluate(BREAKS))
            shot(pg, f'{tag}-home-fav')
        if i < len(clubs) - 1:
            pg.click('.lv-chg')


def run(pg, tag, strict):
    pg.clock.set_fixed_time(TODAY)
    pg.goto(BASE + 'index.html')
    # 出題の履歴は同じドメインのほかのページからも書き換えられる。壊れた値が入っていても動くこと（知らない id は無視される）
    pg.evaluate("() => localStorage.setItem('senjutsu-master-recent-v1', JSON.stringify({ basic: ['<img src=x onerror=alert(1)>', 5, null], club: 'x', team: {} }))")
    pg.evaluate("() => localStorage.setItem('senjutsu-master-fav-v1', '<img src=x onerror=alert(1)>')")
    pg.reload()
    loaded.update(pg.evaluate(FONTS))
    r = pg.evaluate(OV)
    if r['page'] > 0:
        fails.append((tag, 'home', r))
    bad_breaks.update((tag, x) for x in pg.evaluate(BREAKS))
    shot(pg, f'{tag}-home')
    sheet(pg, tag, 'move-empty')
    checked = set()
    for deck in DECKS:
        shots = ('question', 'result') if deck == 'basic' else ('question', 'feedback') if deck == 'coach' else ('question',) if deck == 'club' else ()
        play_deck(pg, tag, deck, strict, checked, shots)
    play_fav(pg, tag, strict, checked)
    sheet(pg, tag, 'move')
    # 前節の一戦: 問題のある節ごとに、その節が終わった1時間後に合わせる
    for rd in pg.evaluate(ROUNDS):
        pg.clock.set_fixed_time(rd['t'] / 1000)
        pg.goto(BASE + 'index.html')
        card = pg.inner_text('[data-start="live"]')
        if rd['label'] not in card or pg.is_disabled('[data-start="live"]'):
            fails.append((tag, rd['label'], 'ホームのカードに出ない', card))
            continue
        bad_breaks.update((tag, x) for x in pg.evaluate(BREAKS))
        if rd['t'] / 1000 <= TODAY.timestamp() < rd['t'] / 1000 + 7 * 86400:
            shot(pg, f'{tag}-home')
        pg.click('[data-start="live"]')
        ids = session(pg, tag, rd['label'], strict, checked, ('question', 'result'))
        if set(ids) != set(rd['ids'][:6]) and len(rd['ids']) <= 6:
            fails.append((tag, rd['label'], '節の問題がすべて出ない', ids))
        pg.click('#toHome')
    loaded.update(pg.evaluate(FONTS))
    return checked


loaded = set()
with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []
    for tag, w, h, scheme, strict in SIZES:
        pg = browser.new_page(viewport={'width': w, 'height': h}, color_scheme=scheme)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(f'CSP: {m.text}') if 'Content Security Policy' in m.text else None)
        pg.route('**/*', lambda r: (errors.append(f'外部への通信: {r.request.url}'), r.abort()) if not r.request.url.startswith(BASE) else r.continue_())
        n = len(run(pg, tag, strict))
        print(f'{tag}: {n} 問を確認')
    browser.close()
server.shutdown()

for tag, x in sorted(bad_breaks):
    print('  break', tag, x)
fails += [('break', t, x) for t, x in bad_breaks if t == 'phone']
need = {'TM Display 400', 'TM Gothic 400', 'TM Gothic 700', 'TM Mono 600'}
if not need <= loaded:
    fails.append(('fonts', '読み込めなかったフォント', sorted(need - loaded)))
total = sum(best_pos.values())
print('ベストの記号', best_pos)
if total and max(best_pos.values()) / total > 0.6:
    fails.append(('shuffle', '選択肢が並べ替えられていない', best_pos))
for f in fails:
    print('FAIL', *f)
for e in errors:
    print('JS ERROR', e)
print('ok' if not fails and not errors else f'{len(fails)} fail, {len(errors)} js error')
sys.exit(1 if fails or errors else 0)
