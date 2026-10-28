"""アプリアイコンを描く:  python3 dev/icons/make_icons.py
戦術ボードの一部（芝・白線）に、味方（青）と相手（赤）のマグネット、黄色のペンの矢印。
リポジトリ直下に icon-192/512、icon-maskable-512、apple-touch-icon（180）、favicon-32 を書き出す。
必要なもの: pip install pillow
"""
import math
import pathlib
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[2]
S = 2048  # 下書きの大きさ（縮小してなめらかにする）
GRASS, MOW = (47, 117, 73), (42, 107, 66)
CHALK = (244, 249, 242, 215)
HOME, AWAY, PEN = (29, 78, 208), (209, 57, 43), (255, 212, 59)


def draw_icon(scale):
    """scale=1 で全面、maskable は中心へ縮めて安全圏に収める。"""
    im = Image.new('RGB', (S, S), GRASS)  # RGB の上に RGBA で描くと半透明が重なる
    d = ImageDraw.Draw(im, 'RGBA')
    band = S / 8
    for i in range(8):
        if i % 2:
            d.rectangle([0, i * band, S, (i + 1) * band], fill=MOW)

    c = S / 2
    T = lambda x, y: (c + (x - c) * scale, c + (y - c) * scale)  # noqa: E731
    w = lambda v: v * scale  # noqa: E731

    lw = int(w(22))
    # 白線: ペナルティエリア・ゴールエリア・ハーフウェーライン・センターサークル
    d.rectangle([*T(524, -1200), *T(1524, 460)], outline=CHALK, width=lw)
    d.rectangle([*T(774, -1200), *T(1274, 180)], outline=CHALK, width=lw)
    d.line([T(-2000, 1400), T(S + 2000, 1400)], fill=CHALK, width=lw)
    x0, y0 = T(1024 - 300, 1400 - 300)
    x1, y1 = T(1024 + 300, 1400 + 300)
    d.ellipse([x0, y0, x1, y1], outline=CHALK, width=lw)

    # 黄色の矢印（味方が相手の脇を回り込んで前へ）
    p0, cp, p1 = (640, 1300), (520, 620), (1060, 520)
    pts = []
    for i in range(61):
        t = i / 60
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * cp[0] + t * t * p1[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * cp[1] + t * t * p1[1]
        pts.append((x, y))
    tx, ty = p1[0] - cp[0], p1[1] - cp[1]
    L = math.hypot(tx, ty)
    ux, uy = tx / L, ty / L
    end = (p1[0] - ux * 60, p1[1] - uy * 60)
    pts = [p for p in pts if (p[0] - p1[0]) * ux + (p[1] - p1[1]) * uy < -60] + [end]
    d.line([T(*p) for p in pts], fill=PEN, width=int(w(70)), joint='curve')
    r0 = int(w(35))
    for p in (pts[0],):
        x, y = T(*p)
        d.ellipse([x - r0, y - r0, x + r0, y + r0], fill=PEN)
    tip = (p1[0] + ux * 90, p1[1] + uy * 90)
    bx, by = p1[0] - ux * 110, p1[1] - uy * 110
    nx, ny = -uy * 130, ux * 130
    d.polygon([T(*tip), T(bx + nx, by + ny), T(bx - nx, by - ny)], fill=PEN)

    # マグネット
    def magnet(x, y, r, col):
        cx, cy = T(x, y)
        rr = w(r)
        d.ellipse([cx - rr, cy - rr + w(14), cx + rr, cy + rr + w(14)], fill=(0, 0, 0, 70))
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col, outline=(0, 0, 0, 90), width=int(w(10)))
        sr = rr * 0.38
        sx, sy = cx - rr * 0.32, cy - rr * 0.36
        d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=(255, 255, 255, 70))

    magnet(1370, 860, 210, AWAY)
    magnet(640, 1440, 250, HOME)
    return im


def save(im, size, name):
    im.resize((size, size), Image.LANCZOS).convert('RGB').save(ROOT / name, optimize=True)


full = draw_icon(1.0)
save(full, 512, 'icon-512.png')
save(full, 192, 'icon-192.png')
save(full, 180, 'apple-touch-icon.png')
save(full, 32, 'favicon-32.png')
save(draw_icon(0.78), 512, 'icon-maskable-512.png')
print('icons written to', ROOT)
