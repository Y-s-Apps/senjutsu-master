/* 戦術マスター LINE版（LINEミニアプリ）だけに入る script。dev/build.js が LINE版の index.html の最後に足す
   （ホーム画面版・アーティファクト版には入らない）。
   - サーバーは使わない。LINE の ID・トークン・プロフィールはどこへも送らず、使わない（Scope は openid だけ）。
     記録はホーム画面版と同じく、この端末の localStorage（オリジンは pages.dev なので、ホーム画面版とは別の保存）。
   - LIFF ID は内部チャネル（本番用・審査用・開発用）ごと。build.js が同じページを /・/review/・/dev/ に置き、
     ひらいた場所でえらぶ（LINE Developers の「ウェブアプリ設定」のエンドポイントURLとそろえる）。空なら LIFF を使わない。
   - SDK はエッジパス（v2 の最新版が自動で入る。v2.20.0〜v2.31.0 には脆弱性があるので、古い版に固定しない）。
   - SDK が読めない・10秒で初期化できない・LINE の外のブラウザ・LIFF ID がない、のどれでも、ふつうの Web 版として遊べる
     （画面は app.js が先に出しているので、白い画面にならない）。
   状態は <html data-line="off|loading|ready|failed" data-line-ch="prod|review|dev" data-line-client="1"> に出す。
   - 結果のシェア（canShare・share）: liff.shareTargetPicker() で、LINEミニアプリの「カスタムシェアメッセージ」（標準タイプ）を送る。
     送るのはコースの名前・点数・ベストの数（app.js が渡す）と、アプリをひらくボタンだけ。画像は build.js が置く固定の絵（/share/）。
   - 記録の引っこし（inLine・canSaveFile）: LINE の中（LIFF ブラウザ）は download 属性が使えないので、ファイルの保存は共有シート
     （Web Share のファイル）が使えるときだけ。使えなければ app.js が「ファイルに保存」を出さず、コードのコピーだけにする。
   画面に出す文は app.js に書く（line.js の文字は、フォントのサブセットに入れていない）。 */
(() => {
  'use strict';
  const CFG = {
    sdk: 'https://static.line-scdn.net/liff/edge/2/sdk.js',
    // LIFF ID は秘密ではない（前の数字がチャネルID）。LINE Developers のチャネル「戦術マスター」（プロバイダー Y's Apps）の内部チャネル
    liffIds: { prod: '2012708778-ZSvDqT22', review: '2012708777-zpGFCoht', dev: '2012708776-B5XREcR5' },
    initTimeout: 10000,
  };
  const CH = (/^\/(dev|review)(?:\/|$)/.exec(location.pathname) || [0, 'prod'])[1];
  const L = { state: 'off', ch: CH, liffId: CFG.liffIds[CH] || '', inClient: false, error: '' };

  // LINE の中（LIFF ブラウザ）か。初期化の前でも分かるように、LINE のアプリの UA（「Line/14.x」）も見る
  const inLine = () => L.inClient || /\bLine\//i.test(navigator.userAgent);
  // 記録の引っこしのファイルを保存できるか。LINE の外はいつも（ふつうの Web と同じ）。LINE の中は共有シートでファイルを渡せるときだけ
  const canSaveFile = () => {
    if (!inLine()) return true;
    try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] })); }
    catch (e) { return false; }
  };
  // 結果を送れるか: 初期化が済み、LINE の中で、チャネルのシェアターゲットピッカーがオン（LINE Developers の「ウェブアプリ設定」）
  const canShare = () => {
    try { return L.state === 'ready' && L.inClient && !!window.liff && typeof liff.isApiAvailable === 'function' && liff.isApiAvailable('shareTargetPicker'); }
    catch (e) { return false; }
  };

  const mark = () => {
    const d = document.documentElement.dataset;
    d.line = L.state;
    d.lineCh = CH;
    if (L.inClient) d.lineClient = '1';
    // 開発用だけ、右上の「開発用」の後ろに状態を出す（実機で確かめるため。build.js の CSS が attr() で読む。HTML には入れない）。
    // LINE の中では、シェアが使えるか（share:on|off）と、ファイルの保存が使えるか（file:share|none）も
    if (CH === 'dev') {
      document.body.dataset.lineState = L.state + (L.inClient ? ' / LINE' : '') + (L.error ? ' / ' + L.error : '')
        + (inLine() ? ` / share:${canShare() ? 'on' : 'off'} / file:${canSaveFile() ? 'share' : 'none'}` : '');
    }
  };

  // ---------- 結果のシェア ----------
  // LINEミニアプリの「カスタムシェアメッセージ」の標準タイプ（https://developers.line.biz/ja/docs/line-mini-app/develop/share-messages/ 、
  // 2026-11-20 に確認）。Flex Message のバブル1つ: 画像（任意）・タイトル（必須、2行まで）・サブタイトル（2行まで）・詳細（ラベルと説明、
  // 1行ずつ）・ボタン（必須。アプリをひらく）・フッター（アイコン・名前・決まった矢印の画像）。ガイドラインに書いていないプロパティは変えない
  const SHARE = {
    hero: '/share/hero.png', icon: '/share/icon.png', // build.js が LINE版のいちばん上の share/ に置く（1000×650 と 192×192 の PNG）
    arrow: 'https://vos.line-scdn.net/service-notifier/footer_go_btn.png', // ガイドラインの決まった画像（変えない）
    button: '#141414', // ボタンの地の色（アプリの黒）。文字は LINE が白で描く
    name: '戦術マスター',
    about: '戦術ボードを読んで、次のプレーを選ぶサッカーのクイズ'
  };
  const cut = (v, n) => [...String(v)].slice(0, n).join('');
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : lo);
  // i: { course: 'Lv.2 中級 チーム戦術' など, sc, mx, isNew, best, total }（app.js の result が作る）
  function message(i) {
    const url = 'https://miniapp.line.me/' + L.liffId; // いまのチャネル（本番用なら本番用）の LIFF URL
    const abs = p => new URL(p, location.origin).href;
    const mx = int(i.mx, 0, 99), sc = int(i.sc, 0, mx), total = int(i.total, 0, 99), best = int(i.best, 0, total);
    const course = cut(i.course, 40);
    const row = (k, v) => ({ type: 'box', layout: 'horizontal', spacing: 'sm', flex: 1, contents: [
      { type: 'text', text: k, size: 'sm', color: '#555555', wrap: false, flex: 20 },
      { type: 'text', text: v, size: 'sm', color: '#111111', wrap: false, flex: 55 }
    ] });
    const rows = [row('ベスト', `${total}問中${best}問`)];
    if (i.isNew === true) rows.push(row('記録', '自己ベストを更新'));
    return {
      type: 'flex', altText: cut(`${SHARE.name} ${course}で ${sc}/${mx}点`, 100),
      contents: {
        type: 'bubble',
        hero: { type: 'image', url: abs(SHARE.hero), size: 'full', aspectMode: 'cover', aspectRatio: '20:13' },
        body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
          { type: 'box', layout: 'vertical', spacing: 'none', contents: [{ type: 'text', text: `${course}で ${sc}/${mx}点`, size: 'lg', color: '#000000', weight: 'bold', wrap: true }] },
          { type: 'box', layout: 'vertical', spacing: 'none', contents: [{ type: 'text', text: SHARE.about, size: 'sm', color: '#999999', wrap: true }] },
          { type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', flex: 1, contents: rows },
          { type: 'box', layout: 'vertical', spacing: 'xs', margin: 'lg', contents: [
            { type: 'button', style: 'primary', height: 'md', color: SHARE.button, action: { type: 'uri', label: `${SHARE.name}で遊ぶ`, uri: url } }
          ] }
        ] },
        footer: { type: 'box', layout: 'vertical', contents: [
          { type: 'separator', color: '#f0f0f0' },
          { type: 'box', layout: 'horizontal', flex: 1, spacing: 'md', margin: 'md', contents: [
            { type: 'image', url: abs(SHARE.icon), flex: 1, gravity: 'center' },
            { type: 'text', text: SHARE.name, flex: 19, size: 'xs', color: '#999999', weight: 'bold', gravity: 'center', wrap: false },
            { type: 'image', url: SHARE.arrow, flex: 1, gravity: 'center', size: 'xxs', action: { type: 'uri', label: 'action', uri: url } }
          ] }
        ] }
      }
    };
  }
  // 'sent'（送った）・'cancel'（送り先を選ばずに閉じた）・'unavailable'（使えない）・'error'
  async function share(i) {
    if (!canShare()) return 'unavailable';
    try {
      const r = await liff.shareTargetPicker([message(i)], { isMultiple: true });
      return r && r.status === 'success' ? 'sent' : 'cancel';
    } catch (e) {
      L.error = String((e && (e.code || e.message)) || e).slice(0, 80); mark();
      return 'error';
    }
  }
  Object.assign(L, { inLine, canSaveFile, canShare, share, message });

  // SDK を読み込んで待つ。読めなければ null（待ち受けを先につけてから読み込むので、失敗を取りこぼさない）
  const sdk = () => new Promise(res => {
    if (window.liff) return res(window.liff);
    let settled = false;
    const done = v => { if (!settled) { settled = true; res(v); } };
    const s = document.createElement('script');
    s.async = true; s.src = CFG.sdk;
    s.addEventListener('load', () => done(window.liff || null));
    s.addEventListener('error', () => done(null));
    setTimeout(() => done(window.liff || null), CFG.initTimeout);
    document.head.appendChild(s);
  });

  async function init() {
    if (!L.liffId) { mark(); return; }
    L.state = 'loading'; mark();
    const liff = await sdk();
    if (!liff) { L.error = 'sdk'; L.state = 'failed'; mark(); return; }
    try {
      await Promise.race([
        liff.init({ liffId: L.liffId }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), CFG.initTimeout)),
      ]);
      L.inClient = !!liff.isInClient();
      L.state = 'ready';
    } catch (e) {
      // 画面には出さない（ゲストとして遊べるので）。しらべるときのために、短い合図だけ残す
      L.error = String((e && (e.code || e.message)) || e).slice(0, 80);
      L.state = 'failed';
    }
    mark();
  }

  window.TMLine = L; // 結果のシェアなど、あとで足す LINE版だけの機能が使う
  mark();
  init();
})();
