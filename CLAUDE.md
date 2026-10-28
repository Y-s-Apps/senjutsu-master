# サッカー戦術ドリル — notes for working on this repo

戦術ボードの状況を読んで次のプレーを選び、選手の動きと解説で理由を学ぶサッカー戦術クイズ。初級・中級・上級（指導者向け）×各6問。
GitHub Pages で公開: https://y-s-apps.github.io/senjutsu-drill/ （`main` ブランチの直下をそのまま配信）
作者の個人の GitHub アカウント名は、公開されるファイル・URL・コミットに出さない（組織 Y-s-Apps で公開している）
同じゲームは Claude のアーティファクトとしても公開している: https://claude.ai/artifact/LvjMNJxWTMbJyGaVZTi5nt
進め方・ユーザーの好み・経緯・やり残しは `HANDOFF.md`（Claude のプロジェクト機能で開発を続けるためのメモ。プロジェクトの指示の原文もここ）。

## Layout
- repo root = 公開サイト。`index.html` と `sw.js` は `dev/build.js` の生成物なので**手で編集しない**。
  `manifest.webmanifest`・アイコン（`dev/icons/make_icons.py` が描く）・`.nojekyll` は直下に置いたまま。
- `dev/src/page.html` — CSS とページ骨格（アーティファクトの書き方: doctype/html/head/body なし、先頭に `<title>`）。
- `dev/src/app.js` — 画面・ピッチ描画・アニメーション・採点・改行処理（`phrase()`）。`dev/src/data1.js`〜`data3.js` — 問題データ（Lv.1〜3）。
- `dev/src/budoux.js` — BudouX 0.6.4（Apache-2.0）の日本語パーサを1ファイルにまとめたもの。改行位置を決めるためだけに使う。手で編集しない。
- `dev/build.js` — script をインライン化して、直下の `index.html`（PWA 用 head と service worker 登録を足した完全な HTML）・`sw.js`（バージョン＝日本時間の yyyymmddHHMM）・`dev/dist/artifact.html` を書き出す。
- `dev/check.js` — 問題データの確認（誤りがあれば終了コード 1）。
- `dev/test/fit.py` — Playwright で全18問・全タブを開き、1画面に収まっているか（縦横どちらもスクロールなし）と、行頭に助詞・句読点・閉じ括弧が来ていないかを確認（`--shots` でスクショ）。

## 変更の流れ
1. `dev/src/` を編集
2. `node dev/check.js` → `node dev/build.js` → 画面を変えたら `python3 dev/test/fit.py`
3. コミットして `main` に push（Pages が1〜2分で更新）。アーティファクトも合わせるなら `dev/dist/artifact.html` を上記 URL へ publish。
- service worker はページ本体をネット優先で取得するので、push 後は再読み込みで新しい版になる。

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
- 自己ベストは localStorage（キー `tacdrill-best-v1`）。キーを変えると記録が消える。
- コミットの末尾に付ける行は、そのセッションで指示されたものに従う。
