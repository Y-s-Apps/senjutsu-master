// 出題の仕組み: 問題の選び方・選択肢の並べ替え・「前節」の決め方。
// 画面には触らない関数だけを置く（app.js が使い、dev/test/logic.js が node で確かめる）。
(() => {
  'use strict';
  const SESSION = 6; // 1回に出す問題の数（自己ベストの満点は 6×2=12 点）

  const shuffle = (a, rnd = Math.random) => {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    return b;
  };

  // 選択肢の並べ替え: 中身はそのままで、表示の記号（A/B/C）だけを並び順に振り直す。元のデータは変えない。
  const prep = (q, rnd = Math.random) => ({ ...q, opts: shuffle(q.opts, rnd).map((o, i) => ({ ...o, k: 'ABC'[i] })) });

  // 出す問題を選ぶ。hist は出した問題の id（古い→新しい）。
  //  1) 直近に出した問題は出さない: 最後の max(n, 全体−n−2) 問。ただし候補が n 問を切らない範囲で
  //  2) 候補のうち古いもの（まだ出ていないものが先）から n+2 問ほどに絞る（同じ古さはすべて残す）
  //  3) まだ出ていない問題 → 場面（攻撃・守備・切り替え…）が少ないもの → 古いもの → ランダム、の順に選ぶ
  //  4) 選んだ問題の出題順もシャッフル
  function pick(pool, n, hist = [], rnd = Math.random) {
    n = Math.min(n, pool.length);
    const known = new Set(pool.map(q => q.id));
    const h = hist.filter(id => known.has(id));
    const age = new Map(h.map((id, i) => [id, i])); // 大きいほど最近
    const ageOf = q => (age.has(q.id) ? age.get(q.id) : -1);
    const nb = Math.min(h.length, Math.max(n, pool.length - n - 2), pool.length - n);
    const block = new Set(h.slice(h.length - nb));
    const cand = shuffle(pool.filter(q => !block.has(q.id)), rnd).sort((a, b) => ageOf(a) - ageOf(b));
    const cut = cand.length > n + 2 ? ageOf(cand[n + 1]) : Infinity;
    const left = cand.filter(q => ageOf(q) <= cut).map(q => ({ q, r: rnd() }));
    const count = {}, out = [];
    while (out.length < n && left.length) {
      left.sort((x, y) => (age.has(x.q.id) - age.has(y.q.id)) || ((count[x.q.ph] || 0) - (count[y.q.ph] || 0)) || (ageOf(x.q) - ageOf(y.q)) || (x.r - y.r));
      const { q } = left.shift();
      out.push(q);
      count[q.ph] = (count[q.ph] || 0) + 1;
    }
    return shuffle(out, rnd);
  }

  // 問題の少ないデッキ（お気に入りクラブ）: 直前に出した block 問だけを避け、残りから場面がかたよらないようにランダムに選ぶ。
  // 12問から6問なら、前回と重なるのは多くても2問で、毎回ちがう組み合わせになる（pick だと2組を交互に出すだけになる）。
  function pickLoose(pool, n, hist = [], rnd = Math.random, block = 4) {
    n = Math.min(n, pool.length);
    const known = new Set(pool.map(q => q.id));
    const h = hist.filter(id => known.has(id));
    const recent = new Set(h.slice(h.length - Math.min(h.length, block, pool.length - n)));
    const left = shuffle(pool.filter(q => !recent.has(q.id)), rnd);
    const count = {}, out = [];
    while (out.length < n && left.length) {
      left.sort((x, y) => (count[x.ph] || 0) - (count[y.ph] || 0)); // 同じ数どうしはシャッフルした順のまま
      const q = left.shift();
      out.push(q);
      count[q.ph] = (count[q.ph] || 0) + 1;
    }
    return shuffle(out, rnd);
  }

  // 出した問題を履歴の最後へ（同じ id は前のものを消す）。長さは max まで。
  const remember = (hist, id, max) => [...(hist || []).filter(x => x !== id), id].slice(-max);

  /* ---------- 前節（現実の試合と連動するモード） ----------
     日付はすべて日本時間。節が「終わった」とみなすのは:
       - end（"2026-10-25T18:30:00+09:00" の形）があれば、その時刻
       - なければ、dates の最後の日の翌日 0 時
     later（別の日に回った一部の試合）は待たない（その節の本来の日程が終われば「終わった節」とする）。
     前節 = いまの時点で終わっている節のうち、いちばん最近に終わったもの。
     その節の問題がまだなければ、問題のある直近の節を使う（画面には「準備中」と出す）。 */
  const DAY = 864e5;
  const jstDay = s => Date.parse(`${s}T00:00:00+09:00`);
  const doneAt = md => (md.end ? Date.parse(md.end) : jstDay(md.dates[md.dates.length - 1]) + DAY);

  // league = { id, name, seasons: [{ id, season, matchdays: [{ no, dates, later?, end? }], rounds: { 12: { summary, q } } }] }
  // 戻り値: done（いちばん最近に終わった節）、ready（問題のある直近の節。round つき）、next（まだ終わっていない最初の節）
  function lastRound(league, now) {
    let done = null, ready = null, next = null;
    const later = (a, b) => !b || a.t > b.t || (a.t === b.t && a.se.id === b.se.id && a.md.no > b.md.no);
    (league.seasons || []).forEach(se => (se.matchdays || []).forEach(md => {
      const x = { se, md, t: doneAt(md) };
      if (x.t <= now) {
        if (later(x, done)) done = x;
        const round = se.rounds && se.rounds[md.no];
        if (round && round.q && round.q.length && later(x, ready)) ready = { ...x, round };
      } else if (!next || x.t < next.t) next = x;
    }));
    return { done, ready, next, latest: !!(done && ready && done.se === ready.se && done.md === ready.md) };
  }

  // 日付の表示: "2026-10-24","2026-10-25" → "10/24〜25"、1日だけなら "10/21(水)"
  const WD = '日月火水木金土';
  function dateLabel(dates) {
    const p = s => s.split('-').map(Number);
    const [y1, m1, d1] = p(dates[0]), [, m2, d2] = p(dates[dates.length - 1]);
    if (dates.length === 1) return `${m1}/${d1}(${WD[new Date(Date.UTC(y1, m1 - 1, d1)).getUTCDay()]})`;
    return m1 === m2 ? `${m1}/${d1}〜${d2}` : `${m1}/${d1}〜${m2}/${d2}`;
  }

  window.TM = { SESSION, shuffle, prep, pick, pickLoose, remember, doneAt, lastRound, dateLabel };
})();
