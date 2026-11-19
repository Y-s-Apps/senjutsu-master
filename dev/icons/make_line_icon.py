"""LINEミニアプリのチャネルアイコンを描く:  python3 dev/icons/make_line_icon.py  →  dev/icons/line-icon-130.png
アプリアイコン（make_icons.py。黒地に明朝の「戦」、ピッチのライン、ボール）と同じ絵を、LINE の決まりの大きさに縮めたもの
（2026-11-20 の候補 I1。ほかは「戦」だけ・センターサークルの「戦」）。
LINE の決まり（https://developers.line.biz/ja/docs/line-mini-app/design/line-mini-app-icon/ 、2026-11-20 に確認）:
背景 130×130 px、ロゴ 54〜90 px（おすすめ 54〜76 px）、PNG か JPEG、LINEミニアプリのロゴを入れない、背景は自動で切り抜かれる。
ここでは絵の外枠を約 74×71 px にして、まんなかに置く。LINE Developers の「チャネル基本設定」→「チャネルアイコン」にオーナーが入れる
（ページには置かない。認証のあとに変えると再審査）。
必要なもの: pip install playwright pillow && playwright install chromium
"""
import io
import pathlib
import sys
from PIL import Image
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from make_icons import BG, INK, LINE, BALL, GLYPH  # noqa: E402  字形と色はアプリアイコンと同じもの

OUT = pathlib.Path(__file__).resolve().parent / 'line-icon-130.png'
SCALE = 0.86  # 絵（1024 の中の外枠 196〜866 × 217〜860、中心 531,538）を 1040 の 0.86 倍にして中心へ

SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 1040" width="1040" height="1040">
  <rect width="1040" height="1040" fill="{BG}"/>
  <g transform="translate(520 520) scale({SCALE}) translate(-531 -538)">
    <path transform="translate(222 700) scale(.58 -.58)" fill="{INK}" d="{GLYPH}"/>
    <line x1="196" y1="820" x2="760" y2="820" stroke="{LINE}" stroke-width="26" stroke-linecap="round"/>
    <circle cx="826" cy="820" r="40" fill="{BALL}"/>
  </g>
</svg>"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1040, 'height': 1040})
    page.set_content(f'<body style="margin:0">{SVG}</body>')
    im = Image.open(io.BytesIO(page.locator('svg').screenshot())).convert('RGB').resize((130, 130), Image.LANCZOS)
    browser.close()
im.save(OUT, optimize=True)
px, bg = im.load(), im.getpixel((2, 2))
pts = [(x, y) for x in range(130) for y in range(130) if sum(abs(a - b) for a, b in zip(px[x, y], bg)) > 40]
w = max(x for x, _ in pts) - min(x for x, _ in pts) + 1
h = max(y for _, y in pts) - min(y for _, y in pts) + 1
assert 54 <= max(w, h) <= 76, f'ロゴの大きさが LINE のおすすめ（54〜76px）を外れています: {w}x{h}'
print(f'{OUT.name}: 130x130, ロゴ {w}x{h}px')
