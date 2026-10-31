#!/usr/bin/env python3
"""セキュリティ診断のうち、機械的に確かめられるものをまとめて調べる（読むだけで、何も書き換えない）。

使い方: python3 dev/test/audit.py [--artifact 読み込んだアーティファクトのファイル] [--since コミット]
  --artifact  Artifact の read で保存したファイル。dev/dist/artifact.html と中身が同じかを確かめる
  --since     このコミットから HEAD までに変わったファイルを一覧にする（前回の診断の続きを読むとき）
  環境変数 AUDIT_NAMES  探したい名前をカンマ区切りで（ユーザーに聞いた旧名など。ファイルには書かない）

個人のアカウント名は GitHub の API（gh api user）から取り、画面には件数だけを出す（名前は出さない）。
結果の行: OK / NG（直す）/ 要確認（人が見て判断する）/ 読めない（この環境では確かめられない）。NG があれば終了コード 1。
コードを人が読むこと（innerHTML に入る値・保存データの検証・新しい機能の入り口）は、このスクリプトでは代わりにならない。
"""
import base64, hashlib, json, os, re, shutil, struct, subprocess, sys, tempfile
from html.parser import HTMLParser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REPO = 'Y-s-Apps/senjutsu-master'
PREFIX = 'senjutsu-master-'
OLD_KEYS = {'tacdrill-best-v1'}  # 旧名のまま残している保存キー（変えると記録が消える）
ALLOWED_URLS = {'https://github.com/google/budoux', 'http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink'}
AUTHOR_NAMES = {'Claude'}
AUTHOR_EMAILS = {'noreply@anthropic.com'}
SECRET_RE = re.compile(rb'(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[ousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|'
                       rb'-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-ant-[A-Za-z0-9_-]{10,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})')
NOREPLY_RE = re.compile(rb'\d+\+[A-Za-z0-9-]+@users\.noreply\.github\.com')

counts = {'OK': 0, 'NG': 0, '要確認': 0, '読めない': 0}


def say(kind, text):
    counts[kind] += 1
    print(f'{kind:　<4} {text}')


def run(*cmd, cwd=ROOT, ok=False):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True)
    if p.returncode and not ok:
        raise RuntimeError(p.stderr.decode(errors='replace').strip())
    return p.stdout


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


def gh(path, jq=None):
    if not shutil.which('gh'):
        return None
    cmd = ['gh', 'api', path] + (['--jq', jq] if jq else [])
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True)
    if p.returncode:
        return None
    out = p.stdout.decode().strip()
    return out if jq else json.loads(out or 'null')


class Page(HTMLParser):
    """index.html から CSP と埋め込みの script を取り出す（正規表現で HTML を読まない）。"""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.csp, self.scripts, self.script_attrs, self._in = None, [], [], None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta' and (a.get('http-equiv') or '').lower() == 'content-security-policy':
            self.csp = a.get('content')
        if tag == 'script':
            if attrs:
                self.script_attrs.append(attrs)
            self._in = []

    def handle_data(self, data):
        if self._in is not None:
            self._in.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self._in is not None:
            self.scripts.append(''.join(self._in))
            self._in = None


def src_files():
    return [f'dev/src/{n}' for n in sorted(os.listdir(os.path.join(ROOT, 'dev/src'))) if n.endswith('.js') and n != 'budoux.js']


def section(title):
    print(f'\n■ {title}')


# ---- ① コード -------------------------------------------------------------
def audit_code():
    section('① コード（自前の script: ' + '・'.join(os.path.basename(f) for f in src_files()) + '）')
    bad = []
    for f in src_files():
        for i, line in enumerate(read(f).splitlines(), 1):
            if re.search(r'\beval\s*\(|new\s+Function\b|document\.write|setTimeout\s*\(\s*[\'"`]|setInterval\s*\(\s*[\'"`]|javascript:|\.outerHTML\s*=|localStorage\.clear|sessionStorage\.clear|indexedDB\.deleteDatabase', line):
                bad.append(f'{f}:{i}')
    say('NG' if bad else 'OK', '危ない書き方（eval・new Function・document.write・文字列の setTimeout・javascript:・保存データの全消去）' + (': ' + ', '.join(bad) if bad else 'なし'))

    app = read('dev/src/app.js')
    keys = set(re.findall(r"const\s+\w*KEY\s*=\s*'([^']+)'", app))
    used = len(re.findall(r'localStorage\.(?:getItem|setItem|removeItem)\(', app))
    direct = re.findall(r"localStorage\.(?:getItem|setItem|removeItem)\(\s*'([^']+)'", app)
    odd = sorted(k for k in keys | set(direct) if not k.startswith(PREFIX) and k not in OLD_KEYS)
    say('NG' if odd else 'OK', f'保存キー {sorted(keys | set(direct))}（読み書き {used} か所）' + (f'。アプリ名で始まらない: {odd}' if odd else '。どれもアプリ名で始まる'))
    if re.search(r'sessionStorage|indexedDB|document\.cookie', app):
        say('要確認', 'sessionStorage・IndexedDB・cookie を使っている。キーの名前と読み込み時の検証を確かめる')

    sinks = []
    for f in src_files():
        for i, line in enumerate(read(f).splitlines(), 1):
            if re.search(r'\.innerHTML\s*[+]?=|insertAdjacentHTML\s*\(', line):
                sinks.append(f'{os.path.basename(f)}:{i}')
    say('要確認', f'HTML を差し込む場所 {len(sinks)} か所（{", ".join(sinks)}）。新しく増えた・変わった場所の値が esc() を通るか、数値・決まった文字列だけかを読む')


# ---- ② 外部との通信・依存 ---------------------------------------------------
def audit_external():
    section('② 外部との通信・依存')
    found = {}
    for f in ['index.html', 'sw.js', 'manifest.webmanifest', 'dev/dist/artifact.html', 'dev/src/page.html'] + src_files():
        for u in re.findall(r'https?://[^\s"\'`<>()\\]+', read(f)):
            u = u.rstrip('.,;')
            if u not in ALLOWED_URLS:
                found.setdefault(u, set()).add(f)
    say('NG' if found else 'OK', '公開物と source に外部の URL' + (': ' + '; '.join(f'{u}（{", ".join(sorted(fs))}）' for u, fs in found.items()) if found else 'なし（BudouX の出典の注記と SVG の名前空間だけ）'))

    net = []
    for f in src_files():
        for i, line in enumerate(read(f).splitlines(), 1):
            if re.search(r'\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\s*\(|new\s+Worker|importScripts|<iframe|\.src\s*=', line):
                net.append(f'{f}:{i}')
    say('NG' if net else 'OK', '通信する API（fetch・XHR・WebSocket・sendBeacon・import()・Worker・src の書き換え）' + (': ' + ', '.join(net) if net else 'なし'))

    page = Page()
    page.feed(read('index.html'))
    page.close()
    if not page.csp:
        say('NG', 'index.html に CSP がない')
        return
    csp = page.csp
    hashes = set(re.findall(r"'sha256-([A-Za-z0-9+/=]+)'", csp))
    bodies = page.scripts
    actual = {base64.b64encode(hashlib.sha256(b.encode()).digest()).decode() for b in bodies}
    other = page.script_attrs
    probs = []
    if not csp.startswith("default-src 'none'"):
        probs.append("default-src 'none' でない")
    dirs = {d.split()[0]: d.split()[1:] for d in csp.split(';') if d.strip()}
    if any(re.search(r"unsafe|https?:|\*|data:|blob:", v) for v in dirs.get('script-src', ['（なし）'])) or 'script-src' not in dirs:
        probs.append('script-src がハッシュ以外も許している')
    if re.search(r"https?:|\*|unsafe-eval|wasm", csp):
        probs.append('外部のホスト・*・unsafe-eval のどれかを許している')
    if dirs.get('base-uri') != ["'none'"] or dirs.get('form-action') != ["'none'"]:
        probs.append("base-uri・form-action が 'none' でない")
    if hashes != actual:
        probs.append(f'ハッシュと埋め込みが一致しない（CSP {len(hashes)}・script {len(actual)}）')
    if other:
        probs.append(f'src などの付いた script タグ: {other}')
    say('NG' if probs else 'OK', f'CSP: ' + ('; '.join(probs) if probs else f"default-src 'none'、script は埋め込んだ {len(bodies)} 個のハッシュだけ、外部のホストなし（style の 'unsafe-inline' は style 属性のため。script は動かせない）"))

    bud = read('dev/src/budoux.js')
    ver = re.search(r'BudouX\s*v?([0-9.]+)', bud)
    say('要確認', f'同梱の BudouX は {ver.group(1) if ver else "版不明"}。新しい版に安全面の修正がないかを調べる（フォントは make_fonts.py が元の SHA-256 を確かめる）')


# ---- ③ Service Worker -----------------------------------------------------
def audit_sw():
    section('③ Service Worker（sw.js）')
    sw = read('sw.js')
    need = {
        "保存するのは正常な応答だけ（res.ok && res.type === 'basic'）": "res.ok && res.type === 'basic'",
        'GET 以外には関わらない': "req.method !== 'GET') return",
        '別のオリジンには関わらない': 'url.origin !== location.origin) return',
        '消すのは自分の古いキャッシュだけ': f"k.startsWith('{PREFIX}') && k !== CACHE",
    }
    miss = [k for k, v in need.items() if v not in sw]
    cache = re.search(r"const CACHE = '([^']+)'", sw)
    if not cache or not cache.group(1).startswith(PREFIX):
        miss.append('キャッシュ名がアプリ名で始まる')
    say('NG' if miss else 'OK', ('足りない: ' + '、'.join(miss)) if miss else '、'.join(need) + '。キャッシュ名 ' + cache.group(1))
    if 'caches.delete' in sw.replace("filter(k => k.startsWith('" + PREFIX + "') && k !== CACHE).map(k => caches.delete(k))", ''):
        say('NG', 'ほかにも caches.delete がある')
    print('         動きは python3 dev/test/offline.py で確かめる')


# ---- ④ 公開物と個人情報 ----------------------------------------------------
def audit_personal():
    section('④ 公開物と個人情報（作業中のファイル・全履歴・コミットの情報）')
    names = []
    me = gh('user', '.login')
    if me:
        names.append(me)
    else:
        say('読めない', 'GitHub の API で今のアカウント名を取れない（gh api user）。名前での検索は AUDIT_NAMES だけで行う')
    names += [n.strip() for n in os.environ.get('AUDIT_NAMES', '').split(',') if n.strip()]

    # 全履歴のオブジェクト（コミット・ツリー・ファイル）をまとめて読む
    objs = run('git', 'rev-list', '--all', '--objects').decode().split('\n')
    ids = '\n'.join(o.split(' ')[0] for o in objs if o) + '\n'
    p = subprocess.run(['git', 'cat-file', '--batch'], cwd=ROOT, input=ids.encode(), capture_output=True)
    blob = p.stdout
    commits = run('git', 'rev-list', '--all').decode().split()
    tree = b''
    for f in run('git', 'ls-files').decode().split('\n'):
        if f and os.path.isfile(os.path.join(ROOT, f)):
            with open(os.path.join(ROOT, f), 'rb') as fh:
                tree += fh.read() + b'\n'
    for f in run('git', 'ls-files', '--others', '--exclude-standard').decode().split('\n'):
        if f:
            say('要確認', f'git に入っていない新しいファイル: {f}（入れてよいものか）')
            with open(os.path.join(ROOT, f), 'rb') as fh:
                tree += fh.read() + b'\n'

    hits = []
    for n in names:
        rx = re.compile(re.escape(n.encode()), re.I)
        a, b = len(rx.findall(tree)), len(rx.findall(blob))
        if a or b:
            hits.append(f'{"今のアカウント名" if n == me else "AUDIT_NAMES の名前"}: ファイル {a} 件・履歴 {b} 件')
    say('NG' if hits else 'OK', f'個人のアカウント名（{len(names)} つ）' + ('が見つかった: ' + '; '.join(hits) if hits else 'はファイルにも全履歴（' + f'{len(commits)} コミット・{len(objs) - 1} オブジェクト）にもない'))

    meta = run('git', 'log', '--all', '--format=%an%x09%ae%x09%cn%x09%ce').decode().split('\n')
    people = set()
    for line in meta:
        if line:
            an, ae, cn, ce = line.split('\t')
            people |= {('名前', an), ('名前', cn), ('メール', ae), ('メール', ce)}
    odd = [(k, v) for k, v in people if (k == '名前' and v not in AUTHOR_NAMES) or (k == 'メール' and v not in AUTHOR_EMAILS)]
    say('NG' if odd else 'OK', 'コミットの作者・コミッター' + (f'に Claude 以外が {len(odd)} 件（中身は git log --all --format="%an %ae %cn %ce" で、画面に出さずに確かめる）' if odd else 'は Claude <noreply@anthropic.com> だけ'))

    for label, rx in [('GitHub の個人用 noreply メール', NOREPLY_RE), ('秘密の値（トークン・鍵の形）', SECRET_RE)]:
        a, b = len(rx.findall(tree)), len(rx.findall(blob))
        say('NG' if a or b else 'OK', f'{label}: ' + (f'ファイル {a} 件・履歴 {b} 件' if a or b else 'なし'))

    refs = run('git', 'for-each-ref', '--format=%(refname)').decode().split()
    tags = [r for r in refs if r.startswith('refs/tags/')]
    if tags:
        say('要確認', f'タグがある: {tags}')

    meta_chunks = []
    for f in run('git', 'ls-files', '*.png', '*.jpg', '*.jpeg', '*.webp', '*.gif').decode().split():
        d = open(os.path.join(ROOT, f), 'rb').read()
        if f.endswith('.png'):
            i = 8
            while i < len(d):
                n, = struct.unpack('>I', d[i:i + 4])
                t = d[i + 4:i + 8].decode('latin1')
                if t in ('tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'):
                    meta_chunks.append(f'{f}:{t}')
                i += 12 + n
        else:
            meta_chunks.append(f'{f}: PNG 以外（Exif を確かめる）')
    say('NG' if meta_chunks else 'OK', '画像のメタデータ' + (': ' + ', '.join(meta_chunks) if meta_chunks else 'なし（PNG の文字・日時・Exif の情報）'))


# ---- 公開物がソースのビルドと同じか --------------------------------------------
def audit_build():
    section('公開物とソースの一致（HEAD をビルドし直して比べる）')
    head = run('git', 'rev-parse', '--short', 'HEAD').decode().strip()
    tmp = tempfile.mkdtemp(prefix='audit-')
    try:
        arc = run('git', 'archive', 'HEAD')
        subprocess.run(['tar', '-x', '-C', tmp], input=arc, check=True)
        p = subprocess.run(['node', 'dev/build.js'], cwd=tmp, capture_output=True)
        if p.returncode:
            say('NG', 'ビルドが止まった: ' + p.stderr.decode(errors='replace').strip()[-300:])
            return
        diff = []
        for f in ['index.html', 'dev/dist/artifact.html']:
            if open(os.path.join(tmp, f), 'rb').read() != run('git', 'show', f'HEAD:{f}'):
                diff.append(f)
        strip = lambda s: re.sub(r'\d{12}', 'V', s)
        if strip(open(os.path.join(tmp, 'sw.js'), encoding='utf-8').read()) != strip(run('git', 'show', 'HEAD:sw.js').decode()):
            diff.append('sw.js（版の番号以外）')
        say('NG' if diff else 'OK', f'HEAD（{head}）の ' + ('次がソースのビルドと違う: ' + '、'.join(diff) if diff else 'index.html・artifact.html・sw.js はソースからのビルドと同じ'))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    run('git', 'fetch', '-q', 'origin', ok=True)
    remote = run('git', 'rev-parse', '--short', 'origin/main', ok=True).decode().strip()
    say('OK' if remote == head else '要確認', f'GitHub の main は {remote or "不明"}、手元の HEAD は {head}' + ('' if remote == head else '（push 前か、手元が古い）'))


# ---- ⑤ GitHub の設定 -------------------------------------------------------
def audit_github():
    section('⑤ GitHub の設定（この環境の API で読めるものだけ）')
    r = gh(f'repos/{REPO}')
    if not r:
        say('読めない', 'リポジトリの情報を API で読めない。ユーザーに画面で確かめてもらう')
        return
    probs = []
    if r.get('visibility') != 'public': probs.append(f"公開範囲が {r.get('visibility')}")
    if r.get('has_wiki'): probs.append('Wiki がオン')
    if r.get('has_projects'): probs.append('Projects がオン')
    if r.get('default_branch') != 'main': probs.append(f"既定のブランチが {r.get('default_branch')}")
    say('NG' if probs else 'OK', 'リポジトリ: ' + ('、'.join(probs) if probs else '公開・Wiki と Projects はオフ・既定は main'))

    sa = r.get('security_and_analysis') or {}
    st = {k: (sa.get(k) or {}).get('status') for k in ('secret_scanning', 'secret_scanning_push_protection', 'dependabot_security_updates')}
    off = [k for k, v in st.items() if v != 'enabled']
    if not sa:
        say('読めない', '秘密の値の検出などの設定が読めない')
    else:
        say('NG' if off else 'OK', '秘密の値の検出・push protection・Dependabot の更新: ' + ('オフ: ' + ', '.join(off) if off else 'オン'))

    br = gh(f'repos/{REPO}/branches', '[.[].name]')
    br = json.loads(br) if br else None
    say('OK' if br == ['main'] else ('読めない' if br is None else 'NG'), f'ブランチ: {br}' + ('' if br in (None, ['main']) else '（main 以外は消してもらう）'))

    rs = gh(f'repos/{REPO}/rulesets') or []
    good = False
    for x in rs:
        d = gh(f'repos/{REPO}/rulesets/{x["id"]}') or {}
        rules = {y['type'] for y in d.get('rules', [])}
        inc = (d.get('conditions') or {}).get('ref_name', {}).get('include', [])
        if d.get('enforcement') == 'active' and {'deletion', 'non_fast_forward'} <= rules and ('~DEFAULT_BRANCH' in inc or 'refs/heads/main' in inc):
            good = True
            bypass = d.get('bypass_actors') or []
    say('OK' if good else 'NG', 'ruleset: ' + ('main の削除と強制 push を禁止（有効）' + (f'、例外 {len(bypass)} 件' if good and bypass else '') if good else 'main の削除と強制 push を禁止する有効な ruleset がない'))

    act = gh(f'repos/{REPO}/activity?per_page=100', '[.[].activity_type]')
    if act:
        act = json.loads(act)
        c = {t: act.count(t) for t in sorted(set(act))}
        risky = {t: n for t, n in c.items() if t in ('force_push', 'branch_deletion')}
        say('要確認' if risky else 'OK', f'最近の操作 {len(act)} 件: {c}' + ('。強制 push・ブランチの削除は、心当たりがあるかユーザーに確かめる' if risky else '。強制 push・ブランチの削除はない'))

    runs = gh(f'repos/{REPO}/commits/main/check-runs', '[.check_runs[]|[.name,.conclusion]]')
    if runs:
        runs = json.loads(runs)
        bad = [f'{n}: {c}' for n, c in runs if c != 'success']
        say('NG' if bad else 'OK', 'main の最新コミットの確認（Pages の公開・CodeQL）: ' + ('、'.join(bad) if bad else '、'.join(n for n, _ in runs) + ' がすべて成功'))
    dep = gh(f'repos/{REPO}/deployments?per_page=1', '.[0]|[.environment,.sha[0:7]]')
    head = run('git', 'rev-parse', '--short=7', 'origin/main', ok=True).decode().strip()
    if dep:
        env, sha = json.loads(dep)
        say('OK' if sha == head else '要確認', f'最新の公開（{env}）は {sha}' + ('（main と同じ）' if sha == head else f'（main は {head}。公開を待つか、失敗していないか確かめる）'))
    say('読めない', 'code scanning・Dependabot の指摘と組織の設定はこの環境では読めない。ユーザーに https://github.com/' + REPO + '/security の「Code scanning」が 0 Open かを見てもらう')


def main():
    args = sys.argv[1:]
    art = args[args.index('--artifact') + 1] if '--artifact' in args else None
    since = args[args.index('--since') + 1] if '--since' in args else None
    print(f'セキュリティ診断（自動の部分） {REPO} @ {run("git", "rev-parse", "--short", "HEAD").decode().strip()}')
    if since:
        section(f'前回（{since}）からの変更')
        print(run('git', 'diff', '--stat', f'{since}..HEAD').decode().rstrip() or '（変更なし）')
        print(run('git', 'log', '--format=  %h %s', f'{since}..HEAD').decode().rstrip())
    audit_code()
    audit_external()
    audit_sw()
    audit_personal()
    audit_build()
    audit_github()
    section('⑥ アーティファクト')
    if art:
        pub = open(art, encoding='utf-8').read()
        mine = read('dev/dist/artifact.html').strip()
        say('OK' if mine in pub else 'NG', 'Artifact の read で取った中身は dev/dist/artifact.html と' + ('同じ' if mine in pub else '違う（publish し直す）'))
    else:
        say('読めない', 'Artifact の read の結果がない（--artifact で渡す）。公開範囲が「自分だけ」・capability が downloads だけかも read の見出しで確かめる')
    print('\n' + '・'.join(f'{k} {v}' for k, v in counts.items()))
    sys.exit(1 if counts['NG'] else 0)


if __name__ == '__main__':
    main()
