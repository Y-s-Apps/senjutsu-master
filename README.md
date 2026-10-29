# 戦術マスター

戦術ボードの状況を読んで次のプレーを選び、選手の動きと解説で理由を学ぶサッカー戦術クイズ（Webアプリ）。初級・中級・上級（指導者向け）の3段階、各6問。

- 遊ぶ: https://y-s-apps.github.io/senjutsu-master/
- iPhone: Safariで開き、共有ボタン →「ホーム画面に追加」
- Android: Chromeで開き、メニュー →「ホーム画面に追加」／「アプリをインストール」

自己ベストはその端末の中に保存されます。一度開けば、オフラインでも遊べます。

記録を別の端末やホーム画面のアプリへ移すときは、ホームの「記録の引っこし」から「ファイルに保存」（または「コードをコピー」）し、移す先の「記録の引っこし」で「ファイルを選ぶ」（またはコードを貼り付けて「読み込む」）を使います。読み込みで記録が下がることはありません。

外部のサービスへは通信しません（フォントも同じサイトから配信しています）。

同梱しているもの: BudouX 0.6.4（Apache License 2.0, Google LLC）— 日本語の改行位置の調整に使用。フォントは Dela Gothic One・Zen Kaku Gothic New・IBM Plex Mono（SIL Open Font License 1.1）のサブセット。ライセンス本文は `licenses/` にあります。

## 中身

- `dev/src/` … アプリのもとになるファイル（問題データは `data1.js`〜`data3.js`）
- `node dev/build.js` … 公開用の `index.html` と `sw.js` を組み立てます（直下のこの2つは手で編集しません）
- `node dev/check.js` … 問題データの確認
- `python3 dev/fonts/make_fonts.py` … アプリで使う文字だけのフォント（`fonts/`）を作り直します
