"""LINE版の結果のシェアに使う画像を描く:  python3 dev/icons/make_share.py
LINEミニアプリのカスタムシェアメッセージ（標準タイプ）のヒーロー画像。1000×650（20:13）の PNG を dev/icons/share-hero.png に書き出す。
build.js が LINE版のいちばん上の share/hero.png にコピーする（アイコンは icon-192.png を share/icon.png に）。
アプリと同じ見た目: 黒い地に、枠にはめた黒いボードとチョークの線、味方（青）と相手（赤）のマグネット、ペンの色の矢印。
文字は fonts/ のサブセット（TM Display・TM Gothic）で描くので、アプリで使っていない文字は書けない（書くと豆腐になる）。
Flex Message の画像は 1024×1024 px まで・1MB 以下がすすめ（LINE Developers）。
必要なもの: pip install playwright pillow && playwright install chromium
"""
import io
import pathlib
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'dev' / 'icons' / 'share-hero.png'
W, H = 1000, 650

# ボード: 相手ゴールが上（y=0）。枠の縦横の比（およそ 0.85）に合わせて、ハーフウェーラインの少し下まで（x 2〜66、y -2.5〜73 m）
VX, VY, VW, VH = 2, -2.5, 64, 75.5
PL_H = [(9, 32, 15), (10, 19, 31), (7, 56, 27), (8, 38, 43), (6, 27, 55), (4, 45, 63)]
PL_A = [(1, 34, 2.4), (4, 27, 17), (5, 39, 16), (3, 46, 22), (2, 15, 21), (6, 30, 30), (8, 41, 31)]
ME = (38, 43)

board = f"""<svg viewBox="{VX} {VY} {VW} {VH}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
  <rect x="{VX}" y="{VY}" width="{VW}" height="{VH}" fill="#1E2220"/>
  <g fill="none" stroke="rgba(242,242,236,.74)" stroke-width=".22">
    <rect x="0" y="0" width="68" height="105"/><path d="M0 52.5H68"/><path d="M24.85 52.5A9.15 9.15 0 0 0 43.15 52.5"/>
    <rect x="13.84" y="0" width="40.32" height="16.5"/><rect x="24.84" y="0" width="18.32" height="5.5"/>
    <path d="M26.7 16.5A9.15 9.15 0 0 0 41.3 16.5"/>
  </g>
  <circle cx="34" cy="11" r=".3" fill="rgba(242,242,236,.74)"/>
  <rect x="30.34" y="-1.6" width="7.32" height="1.6" fill="rgba(242,242,236,.14)" stroke="rgba(242,242,236,.74)" stroke-width=".22"/>
  <g fill="none" stroke="#FFD43B" stroke-linecap="round" stroke-linejoin="round">
    <path d="M39.4 41Q52 33 50 16.6" stroke-width=".6"/>
    <path d="M55.4 24.8 51.6 14.4" stroke-width=".5" stroke-dasharray="1.2 .9"/>
    <path d="M31.8 12.6 31.2 7.4" stroke-width=".5" stroke-dasharray="1.2 .9"/>
  </g>
  <g fill="#FFD43B"><path d="M49.8 14.6 48.6 17.4 51.3 17.2Z"/><path d="M51 12.8 50.7 15.8 53 14.9Z"/><path d="M31 5.8 30.1 8 32.3 7.8Z"/></g>
  <circle cx="{ME[0]}" cy="{ME[1]}" r="2.55" fill="rgba(255,212,59,.12)" stroke="#FFD43B" stroke-width=".32" stroke-dasharray=".9 .6"/>
  {''.join(f'<g transform="translate({x} {y})"><circle r="1.55" fill="#4C7DFF" stroke="rgba(255,255,255,.25)" stroke-width=".2"/><text y=".72" font-size="2.05" font-family="TM Mono" font-weight="600" fill="#fff" text-anchor="middle">{n}</text></g>' for n, x, y in PL_H)}
  {''.join(f'<g transform="translate({x} {y})"><circle r="1.55" fill="#EF5547" stroke="{"rgba(242,242,236,.74)" if n == 1 else "rgba(255,255,255,.25)"}" stroke-width="{.45 if n == 1 else .2}"/><text y=".72" font-size="2.05" font-family="TM Mono" font-weight="600" fill="#fff" text-anchor="middle">{n}</text></g>' for n, x, y in PL_A)}
  <g transform="translate({ME[0] + 1.35} {ME[1] - 1.15})"><circle r=".72" fill="#fff" stroke="#141414" stroke-width=".2"/></g>
</svg>"""

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: "TM Display"; src: url("fonts/tm-display-400.woff2"); }}
@font-face {{ font-family: "TM Gothic"; src: url("fonts/tm-gothic-700.woff2"); font-weight: 700; }}
@font-face {{ font-family: "TM Gothic"; src: url("fonts/tm-gothic-400.woff2"); font-weight: 400; }}
@font-face {{ font-family: "TM Mono"; src: url("fonts/tm-mono-600.woff2"); font-weight: 600; }}
html, body {{ margin: 0; width: {W}px; height: {H}px; background: #0B0B0B; overflow: hidden; }}
.wrap {{ position: absolute; inset: 0; display: grid; grid-template-columns: 372px 1fr; align-items: center; padding: 48px 48px 48px 56px; gap: 40px; box-sizing: border-box; }}
h1 {{ margin: 0 0 18px; font: 400 54px/1.15 "TM Display"; color: #F1F1EE; letter-spacing: .01em; }}
p {{ margin: 0; font: 400 26px/1.6 "TM Gothic"; color: #8E8E89; }}
.frame {{ height: 554px; padding: 10px; border-radius: 22px; background: #2A2A2A; border: 2px solid #363636; box-sizing: border-box; }}
.frame svg {{ display: block; width: 100%; height: 100%; border-radius: 14px; }}
</style></head><body><div class="wrap">
  <div><h1>戦術マスター</h1><p>ボードの状況を読んで<br>次のプレーを選ぶ</p></div>
  <div class="frame">{board}</div>
</div></body></html>"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': W, 'height': H})
    (ROOT / '.share-tmp.html').write_text(html, encoding='utf-8')
    try:
        pg.goto((ROOT / '.share-tmp.html').as_uri())
        pg.evaluate('document.fonts.ready')
        pg.wait_for_timeout(200)
        png = pg.screenshot(type='png')
    finally:
        (ROOT / '.share-tmp.html').unlink()
    b.close()
img = Image.open(io.BytesIO(png)).convert('RGB')
img.save(OUT, optimize=True)
print(f'{OUT.relative_to(ROOT)}: {OUT.stat().st_size // 1024} KB')
