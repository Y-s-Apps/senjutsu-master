// 出題の仕組み: 問題の選び方・選択肢の並べ替え・「前節」の決め方・回答後のボールの動かし方。
// 画面には触らない関数だけを置く（app.js が使い、dev/test/logic.js・dev/check.js が node で確かめる）。
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

  /* ---------- 回答後の動き（ボールの1回ずつの動き） ----------
     play の各ステップは start + i×gap ms に始まる。選手は CSS の transition（player ms・EASE.player）で動き、
     ボールは1回の動き（leg）ごとに次のように動かす（app.js が Web Animations で再生し、dev/check.js が同じ計算で確かめる）。
       drib  ドリブル: 同じ選手の足元から足元へ。選手と同じ長さ・速さの変化で、足元から離れない
       kick  蹴ったボール（ゴロ・シュート）: 蹴った瞬間がいちばん速く、だんだん遅くなる
       air   浮き球（ステップに hi: true）: 速さの変化が小さく、真ん中で大きく見える（高さの表現）
     bc: [x, y] があれば、その点を制御点にした曲線（2次ベジェ）で飛ぶ。
     bt: 2 なら、ボールは2ステップかけて飛ぶ（長いFK・CKなど。次のステップで走り込む選手と同時に着く）。
     ボールの着いた先に誰もいなくて（near m より遠い）、次のステップでもボールが動くなら、空中で止めずにつなぐ
     （長さを gap にして次の動きの始まりにちょうど着き、速さを残す）。続けて浮き球なら、高さの上がり下がりも1回にする。
     選手に当たってそのまま向きが変わるとき（相手に当たったシュート・頭で触ってコースを変える）は、cont: true で同じようにつなぐ。 */
  const MOTION = { start: 350, gap: 1050, player: 850, kick: 700, air: 850, near: 2.8 };
  const EASE = {
    player: [0.45, 0.05, 0.25, 1],
    drib: [0.45, 0.05, 0.25, 1],
    kick: [0.22, 0.6, 0.36, 1],
    air: [0.3, 0.35, 0.6, 0.95],
    'kick-cont': [0.22, 0.55, 0.55, 0.9],
    'air-cont': [0.3, 0.35, 0.7, 0.85]
  };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const nearest = (p, pos, r) => {
    let id = null, d = r;
    for (const k in pos) { const e = dist(pos[k], p); if (e <= d) { d = e; id = k; } }
    return id;
  };
  // 経路を点に分け、道のりの割合（0〜1）を offset にする（曲線でも、速さの変化は ease のとおりになる）
  function legPath(a, b, c) {
    if (!c) return [[a[0], a[1], 0], [b[0], b[1], 1]];
    const N = 24, pts = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N, u = 1 - t;
      pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
    let sum = 0;
    const len = pts.map((p, k) => (sum += k ? dist(p, pts[k - 1]) : 0));
    return pts.map((p, k) => [p[0], p[1], sum ? len[k] / sum : k / N]);
  }
  // q: 問題（h・a・ball・play）。
  // 戻り値: { start, gap, legs: [{ i, bt, from, to, c, hi, kind, cont, t0, dur, ease, path, lift }] }
  //   lift: 浮き球の高さの上がり下がりのうち、この動きが受け持つ範囲 [始め, 終わり]（0〜1。続けて飛ぶときに分ける）
  function motion(q, reduceMotion = false) {
    const gap = reduceMotion ? 700 : MOTION.gap;
    const pos = {};
    q.h.forEach(([n, x, y]) => { pos['h' + n] = [x, y]; });
    q.a.forEach(([n, x, y]) => { pos['a' + n] = [x, y]; });
    // 各ステップのあとの選手の位置（-1 は動き出す前）
    const after = [{ ...pos }, ...q.play.map(st => { Object.entries(st.m || {}).forEach(([id, p]) => { pos[id] = p; }); return { ...pos }; })];
    const at = i => after[Math.min(i, q.play.length - 1) + 1];
    let ball = q.ball;
    const legs = [];
    q.play.forEach((st, i) => {
      if (!st.b || dist(st.b, ball) < 0.05) return;
      const bt = Math.max(1, st.bt || 1);
      const from = nearest(ball, at(i - 1), MOTION.near);
      const to = nearest(st.b, at(i + bt - 1), MOTION.near);
      const drib = bt === 1 && !st.hi && !st.bc && !!from && from === to && !!(st.m && st.m[from]);
      legs.push({ i, bt, from: ball, to: st.b, c: st.bc || null, hi: !!st.hi, kind: drib ? 'drib' : st.hi ? 'air' : 'kick', free: !to || !!st.cont, t0: MOTION.start + i * gap });
      ball = st.b;
    });
    legs.forEach((L, k) => {
      const nx = legs[k + 1];
      L.cont = !!(nx && nx.i === L.i + L.bt && L.free && L.kind !== 'drib');
      const base = L.kind === 'kick' ? MOTION.kick : L.kind === 'air' ? MOTION.air : MOTION.player;
      L.dur = L.cont ? L.bt * gap : (L.bt - 1) * gap + base;
      L.ease = EASE[L.kind + (L.cont ? '-cont' : '')];
      L.path = legPath(L.from, L.to, L.c);
    });
    // 浮き球が空中でつながるときは、高さの上がり下がりを1回にする（つなぎ目で地面に落ちたように見せない）
    for (let k = 0; k < legs.length; k++) {
      if (!legs[k].hi) continue;
      let m = k;
      while (legs[m].cont && legs[m + 1] && legs[m + 1].hi) m++;
      const T = legs.slice(k, m + 1).reduce((s, L) => s + L.dur, 0);
      let a = 0;
      for (let j = k; j <= m; j++) { legs[j].lift = [a / T, (a + legs[j].dur) / T]; a += legs[j].dur; }
      k = m;
    }
    return { start: MOTION.start, gap, legs };
  }

  window.TM = { SESSION, shuffle, prep, pick, pickLoose, remember, doneAt, lastRound, dateLabel, MOTION, EASE, motion };
})();
