"""フォントを作る:  python3 dev/fonts/make_fonts.py

アプリで使う文字だけを収めた woff2 を作って、リポジトリ直下の fonts/ に置く。
Google Fonts から読み込むと閲覧者の IP が Google に届き、外部への通信も許すことになるため、自前で配信している。

- 元のフォントは google/fonts の決まったコミットから取り、SHA-256 が一致するものだけを使う
  （dev/fonts/.cache/ に置く。git には入れない）。
- 使う文字は `node dev/build.js --chars` が数える。build.js は fonts/ に足りない文字を見つけるとビルドを止めるので、
  そのときにこれを実行する。作った文字の一覧は dev/fonts/chars.txt。
- IBM Plex Mono は「Plex」が予約フォント名（OFL の Reserved Font Name）なので、作り直したフォントの
  内部名はすべて別名（TM Display / TM Gothic / TM Mono）にする。著作権表示とライセンスの欄は残す。
- ライセンス本文は licenses/ に置く。

必要なもの: pip install fonttools brotli
"""
import hashlib
import pathlib
import shutil
import subprocess
import sys

from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = ROOT / 'dev' / 'fonts'
CACHE = HERE / '.cache' / 'google-fonts'
OUT = ROOT / 'fonts'
LICENSES = ROOT / 'licenses'

REPO = 'https://github.com/google/fonts'
COMMIT = '9862abc066c9b83bf84c3e8ed1fc2d8d48f9bbf0'  # 2026-10-28 の main
DIRS = ['ofl/delagothicone', 'ofl/zenkakugothicnew', 'ofl/ibmplexmono']

# (元のファイル, SHA-256, 出力名, 内部のファミリー名, スタイル名)
FACES = [
    ('ofl/delagothicone/DelaGothicOne-Regular.ttf',
     '4ff87a0965f1b0505e5a2c58424bc6ad3cff27e56a82f21c2fc9d6b0e3857ee2', 'tm-display-400.woff2', 'TM Display', 'Regular'),
    ('ofl/zenkakugothicnew/ZenKakuGothicNew-Regular.ttf',
     'b840cd07a67d89cacca44249ae49aa99ee7640eb5ce623be8d8983d6aabac801', 'tm-gothic-400.woff2', 'TM Gothic', 'Regular'),
    ('ofl/zenkakugothicnew/ZenKakuGothicNew-Medium.ttf',
     '651a3f7280b7f36262601ee76d8388a8dc4372dcc67aff025a608939a562b525', 'tm-gothic-500.woff2', 'TM Gothic', 'Medium'),
    ('ofl/zenkakugothicnew/ZenKakuGothicNew-Bold.ttf',
     '0081cedabc4921982fcd061f845a005664ac7fb642af2dd34b4007bc63ccd235', 'tm-gothic-700.woff2', 'TM Gothic', 'Bold'),
    ('ofl/ibmplexmono/IBMPlexMono-Medium.ttf',
     'a9b4c49bb299e05b5f6c481e7fb5e78943d2793249a0c8874ab574a2d1ea6755', 'tm-mono-500.woff2', 'TM Mono', 'Medium'),
    ('ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf',
     'd3c38e55c78f5b0f28009fddba4834ec503278936a5986032424c9bd2d23aa46', 'tm-mono-600.woff2', 'TM Mono', 'SemiBold'),
]
LICENSE_FILES = [
    ('ofl/delagothicone/OFL.txt', 'DelaGothicOne-OFL.txt'),
    ('ofl/zenkakugothicnew/OFL.txt', 'ZenKakuGothicNew-OFL.txt'),
    ('ofl/ibmplexmono/OFL.txt', 'IBMPlexMono-OFL.txt'),
]


def git(*args, cwd=CACHE):
    subprocess.run(['git', *args], cwd=cwd, check=True)


def fetch():
    """google/fonts の決まったコミットから、必要なフォルダだけを取ってくる（取得済みなら何もしない）。"""
    ok = all((CACHE / p).exists() and sha256(CACHE / p) == h for p, h, *_ in FACES)
    if ok:
        return
    if CACHE.exists():
        shutil.rmtree(CACHE)
    CACHE.mkdir(parents=True)
    git('init', '-q')
    git('remote', 'add', 'origin', REPO)
    git('sparse-checkout', 'set', '--no-cone', *[d + '/' for d in DIRS])
    git('fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', COMMIT)
    git('-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD')


def sha256(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def used_chars():
    r = subprocess.run(['node', str(ROOT / 'dev' / 'build.js'), '--chars'], capture_output=True, text=True, check=True)
    return r.stdout


def rename(font, family, style):
    """内部名を別名にする（OFL の予約フォント名を使わないため）。著作権（0）とライセンス（13, 14）はそのまま。"""
    ribbi = style in ('Regular', 'Bold')
    ps = f"{family.replace(' ', '')}-{style}"
    names = {
        1: family if ribbi else f'{family} {style}',
        2: style if ribbi else 'Regular',
        3: f'{ps};senjutsu-master',
        4: f'{family} {style}',
        6: ps,
        16: family,
        17: style,
    }
    t = font['name']
    t.names = [n for n in t.names if n.nameID not in names]
    for i, v in names.items():
        t.setName(v, i, 3, 1, 0x409)


def main():
    fetch()
    for p, h, *_ in FACES:
        got = sha256(CACHE / p)
        if got != h:
            sys.exit(f'SHA-256 が一致しません: {p}\n  期待 {h}\n  実際 {got}')
    chars = used_chars()
    OUT.mkdir(exist_ok=True)
    for p, _, out, family, style in FACES:
        opt = subset.Options()
        opt.flavor = 'woff2'
        opt.layout_features = ['*']
        opt.name_IDs = ['*']
        opt.name_languages = ['*']
        opt.notdef_outline = True
        font = subset.load_font(str(CACHE / p), opt)
        font.recalcTimestamp = False  # 同じ文字なら同じファイルになるように
        s = subset.Subsetter(opt)
        s.populate(text=chars)
        s.subset(font)
        rename(font, family, style)
        subset.save_font(font, str(OUT / out), opt)
        print(f'{out}: {(OUT / out).stat().st_size / 1024:.0f} KB')
    LICENSES.mkdir(exist_ok=True)
    for src, dst in LICENSE_FILES:
        shutil.copyfile(CACHE / src, LICENSES / dst)
    (HERE / 'chars.txt').write_text(chars, encoding='utf-8')
    print(f'{len(chars)} 文字 → dev/fonts/chars.txt')


if __name__ == '__main__':
    main()
