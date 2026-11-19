/* 戦術マスター LINE版（LINEミニアプリ）だけに入る script。dev/build.js が LINE版の index.html の最後に足す
   （ホーム画面版・アーティファクト版には入らない）。
   - サーバーは使わない。LINE の ID・トークン・プロフィールはどこへも送らず、使わない（Scope は openid だけ）。
     記録はホーム画面版と同じく、この端末の localStorage（オリジンは pages.dev なので、ホーム画面版とは別の保存）。
   - LIFF ID は内部チャネル（本番用・審査用・開発用）ごと。build.js が同じページを /・/review/・/dev/ に置き、
     ひらいた場所でえらぶ（LINE Developers の「ウェブアプリ設定」のエンドポイントURLとそろえる）。空なら LIFF を使わない。
   - SDK はエッジパス（v2 の最新版が自動で入る。v2.20.0〜v2.31.0 には脆弱性があるので、古い版に固定しない）。
   - SDK が読めない・10秒で初期化できない・LINE の外のブラウザ・LIFF ID がない、のどれでも、ふつうの Web 版として遊べる
     （画面は app.js が先に出しているので、白い画面にならない）。
   状態は <html data-line="off|loading|ready|failed" data-line-ch="prod|review|dev" data-line-client="1"> に出す。 */
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

  const mark = () => {
    const d = document.documentElement.dataset;
    d.line = L.state;
    d.lineCh = CH;
    if (L.inClient) d.lineClient = '1';
    // 開発用だけ、右上の「開発用」の後ろに状態を出す（実機で確かめるため。build.js の CSS が attr() で読む。HTML には入れない）
    if (CH === 'dev') document.body.dataset.lineState = L.state + (L.inClient ? ' / LINE' : '') + (L.error ? ' / ' + L.error : '');
  };

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
