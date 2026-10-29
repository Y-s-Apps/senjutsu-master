# 戦術マスター — notes for working on this repo

戦術ボードの状況を読んで次のプレーを選び、選手の動きと解説で理由を学ぶサッカー戦術クイズ。初級・中級・上級（指導者向け）×各6問。
アプリ名は「戦術マスター」、リポジトリ名と URL は `senjutsu-master`（2026-10-29 に「サッカー戦術ドリル」／`senjutsu-drill` から変更）。自己ベストの保存キー `tacdrill-best-v1` だけは旧名由来のまま（同じドメイン y-s-apps.github.io なので、キーを変えなければブラウザの記録が引き継がれる）。
GitHub Pages で公開: https://y-s-apps.github.io/senjutsu-master/ （リポジトリ `Y-s-Apps/senjutsu-master` の `main` ブランチ直下をそのまま配信）
作者の個人の GitHub アカウント名は、公開されるファイル・URL・コミットに出さない（組織 Y-s-Apps で公開している）
同じゲームは Claude のアーティファクトとしても公開している: https://claude.ai/artifact/LvjMNJxWTMbJyGaVZTi5nt
進め方・ユーザーの好み・経緯・やり残しは `HANDOFF.md`（Claude のプロジェクト機能で開発を続けるためのメモ。プロジェクトの指示の原文もここ）。

## Layout
- repo root = 公開サイト。`index.html` と `sw.js` は `dev/build.js` の生成物なので**手で編集しない**。
  `manifest.webmanifest`・アイコン（`dev/icons/make_icons.py` が描く）・`.nojekyll` は直下に置いたまま。
- `dev/src/page.html` — CSS とページ骨格（アーティファクトの書き方: doctype/html/head/body なし、先頭に `<title>`）。
- `dev/src/app.js` — 画面・ピッチ描画・アニメーション・採点・改行処理（`phrase()`）。`dev/src/data1.js`〜`data3.js` — 問題データ（Lv.1〜3）。
- `dev/src/budoux.js` — BudouX 0.6.4（Apache-2.0）の日本語パーサを1ファイルにまとめたもの。改行位置を決めるためだけに使う。手で編集しない。
- `dev/build.js` — script をインライン化して、直下の `index.html`（PWA 用 head・CSP・service worker 登録を足した完全な HTML）・`sw.js`（バージョン＝日本時間の yyyymmddHHMM）・`dev/dist/artifact.html`（フォントを data: で埋め込んだ1ファイル）を書き出す。ソースに `fonts/` にない文字が出てきたらビルドを止めるので、`python3 dev/fonts/make_fonts.py` を実行してからビルドし直す（要 `pip install fonttools brotli`）。
- `dev/check.js` — 問題データの確認（型・ID・ベストの数・座標など。誤りがあれば終了コード 1）。
- `dev/test/fit.py` — Playwright でローカルの Web サーバーから開き（`fonts/` の実フォントで測る）、全18問・全タブについて、1画面に収まっているか（縦横どちらもスクロールなし）、行頭に助詞・句読点・閉じ括弧が来ていないか、外部への通信・CSP 違反がないか、フォントが読み込めたかを確認（`--shots` でスクショ）。
- `dev/test/move.py` — 「記録の引っこし」の確認。ファイル・コードでの持ち出しと読み込み、高いほうだけの更新、切れた・書き換えた・範囲外・HTML を仕込んだ・大きすぎるものを読まないこと。
- `dev/test/offline.py` — サイトのコピーを `/senjutsu-master/` の位置で配信し、service worker を登録して、オフライン・別ページや 404 を開いたあと・サーバーの 500・新しい版への切り替えでも正しく動くかを確認。引数にフォルダを渡すと、そのビルドを試せる。
- `fonts/` — アプリで使う文字だけを収めたフォント（woff2）。`dev/fonts/make_fonts.py` が google/fonts の決まったコミットから元のフォントを取り（SHA-256 を確認、`dev/fonts/.cache/` は git に入れない）、サブセットを作る。作った文字の一覧は `dev/fonts/chars.txt`。内部名は TM Display / TM Gothic / TM Mono（IBM Plex の予約フォント名「Plex」を使わないため）。手で編集しない。
- `licenses/` — 同梱している BudouX（Apache-2.0）とフォント（OFL 1.1）のライセンス本文。

## 変更の流れ
1. `dev/src/` を編集
2. `node dev/check.js` → `node dev/build.js` → 画面を変えたら `python3 dev/test/fit.py`、service worker（`build.js` の sw 部分）を変えたら `python3 dev/test/offline.py`、自己ベストや記録の引っこしを変えたら `python3 dev/test/move.py`
3. コミットして `main` に push（Pages が1〜2分で更新）。アーティファクトも合わせるなら `dev/dist/artifact.html` を上記 URL へ publish。
- service worker はページ本体（`./` と `index.html`）をネット優先で取得するので、push 後は再読み込みで新しい版になる。保存するのは正常な応答（200）だけで、ネットが使えない・エラーのときは保存済みのページを出す。アイコン・フォントなど CORE のファイルは保存済み優先。それ以外（`licenses/` などの別ページ）には関わらず、保存もしない。新しい版が有効になると古い版の保存データ（`senjutsu-master-<版>`）を消す。
- y-s-apps.github.io は組織 Y-s-Apps の Pages すべて（senjutsu-master・uchinoko-biyori・shinpan-dojo・kuratsuku・kamiashi）が共有する1つのオリジン。localStorage・IndexedDB・Cache Storage・service worker は、組織のほかの Pages（とくに `y-s-apps.github.io` という名前のリポジトリを作るとサイト全体の直下になる）からも触れる。保存キーとキャッシュ名はアプリ名で始め、ほかのアプリのものを消さない（2026-10-29 に5つとも確認済み）。ほかの人が書いたものを組織の Pages で公開しない。

## 問題データの書き方（`window.LEVELS[n].q[]`）
- 座標はメートル。ピッチは 68×105、`y=0` が相手ゴール、味方は常に**上へ**攻める（守備の問題も同じ向き）。
- `t` 状況の見出し（答えを言わない）、`ph` 'atk'|'def'|'tr'|'coach'、`me` 'h6' など（「あなた」リング）、`view` [x, y, w, h]（ボードに映す範囲）。
- `h` 味方 / `a` 相手: `[背番号, x, y]`。1番は GK の見た目。`ball` [x, y]（表示は足元へ少しずらす）。
- `line` オフサイドラインの y（任意）、`lanes: true` で5レーンを表示（任意）。
- `s` 状況、`q` 問い、`hint`（Lv.1 は必須）、`ex` 解説、`key` [用語, 説明]、`coach`・`drill`（Lv.3 は必須）。
- `opts`: `{ k, l, sc, why, ar?, mk?, at? }`。`sc` は 2=ベスト（**各問ちょうど1つ**）/1=悪くない/0=要注意。
  `ar` 矢印 `[[始点], [終点], 'pass'|'run'|'drib'|'look', [制御点]?]` の配列、`mk` 立ち位置の印 [x, y]、`at` 記号（A/B/C）の位置を手で指定。
- `play`: 回答後のアニメーション。`[{ m: { h9: [x, y], a4: [x, y] }, b: [x, y] }, …]` を約1秒ずつ順に再生。
- 記号の表記はコーチの板書の慣習: パス＝実線、走る＝破線、ドリブル＝波線、見る＝点線。

## 守ること
- **プレイヤーに画面をスクロールさせない**（ユーザーの要望）。html/body/#app を画面の高さに固定し、ボードが残りの高さを埋める。回答後の解説はタブ（理由・解説・用語・指導・練習・ほかの選択肢）に分けて同じ場所に収め、ボードの大きさを変えない（縦並びでは `lockPanel()` が、どの選択肢・どのタブの解説でも収まる高さを問題の表示時に測ってパネルを固定する）。文を足したら `dev/test/fit.py` で確認する（390×700 で全タブが収まること）。
- 横長の画面（幅 720px 以上かつ 5:4 より横長）はボード左・問題右の2列。
- 戦術に唯一の正解はない、という立場。「悪くない」選択肢には、それが有効になる状況も書く。
- **配色は黒ベースの1テーマ**（ユーザーの指定）。端末のライト/ダーク設定に合わせて変えない。色はすべて `page.html` 冒頭の `:root` トークンから取り、ライト用の定義は作らない。manifest・theme-color（`dev/build.js`）も同じ `#0E1310`。
- **改行位置に気をつける**（ユーザーの指定）。日本語は文節の境目でだけ折り返す: body は `word-break: keep-all`、描画後に `phrase()` が BudouX で文節の間に `<wbr>` を入れ、助詞などで始まる文節は前につなげ、閉じ括弧の直後は U+2060 でつなぐ。innerHTML で文を差し込んだら、その要素に `phrase()` をかける。1行のラベルは `white-space: nowrap`（`phrase()` は nowrap の要素を飛ばす）。見出しとリード文は `text-wrap: balance`、本文は `pretty`。「…」で省略せず、折り返して収める。
- 自己ベストは localStorage（キー `tacdrill-best-v1`）。キーを変えると記録が消える。同じドメイン y-s-apps.github.io の組織のほかの Pages からも読み書きできるので、`loadBest()` は `cleanBest()` を通して「知っているレベルの id と 0〜満点の整数」だけを残し、それ以外は捨てる。
- **記録の引っこし**（ホームの「記録の引っこし」）: localStorage は URL（オリジン）・ホーム画面のアプリと Safari・端末ごとに別なので、自己ベストをファイルかコードで持ち出し、読み込めるようにしている（クラつくで長い引き継ぎコードが貼り付けで壊れ、移せなかったことから）。
  - コードは `SENJUTSU1:basic=10,coach=6:xxxx`（記録のあるレベルだけ。末尾4文字は FNV-1a の確認用で、欠け・書き換えを見つける）。ファイル `senjutsu-master-kiroku.txt` は説明2行とこのコード。
  - 保存は、アーティファクトではホストの保存確認（`downloads` の capability。publish のときに `capabilities: {downloads: true}` を宣言する）、ホーム画面のアプリ・Safari では共有シート（「"ファイル"に保存」）、どちらもなければ通常のダウンロード。
  - 読み込んだものは信用しない: 4096 文字・バイトまで、NFKC と空白の除去のあと形と確認用の文字を確かめ、`cleanBest()` を通す。今の記録より高いレベルだけを更新する（読み込みで記録は下がらない）。メッセージは textContent で出す。
  - レベルを足すときは、id（英小文字）をコードにそのまま使うので、既存の id を変えない。`dev/test/move.py` で確かめる。
- **外部へ通信しない**。フォントは `fonts/`、script はすべてインライン。`index.html` の CSP（`dev/build.js` が作る `<meta>`）は外部への通信をすべて禁止し、script は埋め込んだもののハッシュだけを許す。外部の URL を読み込むと、ビルドが止まり（page.html）、`fit.py` も失敗する。GitHub Pages はヘッダーを設定できないので、`frame-ancestors` などヘッダーでしか効かない指定は使えない。アーティファクトはホスト側の仕組みがあるので CSP を入れない。
- **innerHTML に差し込む文は `esc()` を通す**（問題データ・自己ベストを含めてすべて）。座標・点数・記号 A/B/C はそのまま SVG や class に入るので、`dev/check.js` がデータの型（文は文字列、座標は数値、記号は A/B/C の順）を確かめる。HTML のタグを文に書かない。
- コミットの末尾に付ける行は、そのセッションで指示されたものに従う。
