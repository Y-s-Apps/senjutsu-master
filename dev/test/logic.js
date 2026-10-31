#!/usr/bin/env node
// 出題の仕組み（dev/src/logic.js）の確認:  node dev/test/logic.js
// - 選択肢の並べ替え: 記号は A/B/C の順に振り直し、中身は変えない。ベストの位置がかたよらない
// - 問題の選び方: 続けて同じ問題が出ない・全問がひと回りで出る・場面がばらける・壊れた履歴を無視する
// - 前節: 日程から「いま終わっている直近の節」を選ぶ（水曜開催・別日の試合・end・分析がない節・シーズンの切れ目）
'use strict';
const path = require('path');
global.window = {};
for (const f of ['data1.js', 'data2.js', 'data3.js', 'data4.js', 'data5.js', 'logic.js']) require(path.join(__dirname, '..', 'src', f));
const LIVE = require('../livedata').load();
const TM = window.TM;
let bad = 0;
const ok = (name, cond, detail = '') => { if (!cond) bad++; console.log(cond ? 'OK ' : 'NG ', name, cond ? '' : detail); };

// 再現できる乱数（mulberry32）
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

/* ---------- 選択肢の並べ替え ---------- */
{
  const q = window.LEVELS[0].q[0], r = rng(1), pos = { A: 0, B: 0, C: 0 };
  let same = true;
  for (let i = 0; i < 3000; i++) {
    const p = TM.prep(q, r);
    if (p.opts.map(o => o.k).join('') !== 'ABC') same = false;
    if (p.opts.map(o => o.why).sort().join() !== q.opts.map(o => o.why).sort().join()) same = false;
    pos[p.opts.find(o => o.sc === 2).k]++;
  }
  ok('並べ替えても記号は A/B/C の順、中身は同じ', same);
  ok('元のデータは変えない', q.opts.map(o => o.k).join('') === 'ABC' && q.opts[2].sc === 2);
  ok('ベストの位置がかたよらない（各 28〜39%）', Object.values(pos).every(n => n / 3000 > 0.28 && n / 3000 < 0.39), pos);
}

/* ---------- 問題の選び方 ---------- */
const decks = [...window.LEVELS, window.CLUB];
for (const D of decks) {
  const n = TM.SESSION, pool = D.q, need = Math.ceil(pool.length / n);
  let disjoint = true, cover = Infinity, maxGap = 0, phaseOk = true, sizeOk = true;
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed * 7919);
    let hist = [], prev = new Set();
    const seenAt = new Map(), got = new Set();
    for (let k = 0; k < 30; k++) {
      const s = TM.pick(pool, n, hist, r);
      if (new Set(s.map(q => q.id)).size !== n) sizeOk = false;
      if (s.some(q => prev.has(q.id))) disjoint = false;
      if (k === 0) {
        const phs = new Set(pool.map(q => q.ph));
        if (new Set(s.map(q => q.ph)).size < Math.min(n, phs.size)) phaseOk = false;
      }
      s.forEach(q => {
        if (seenAt.has(q.id)) maxGap = Math.max(maxGap, k - seenAt.get(q.id));
        seenAt.set(q.id, k); got.add(q.id);
        hist = TM.remember(hist, q.id, pool.length);
      });
      if (got.size === pool.length) cover = Math.min(cover, k + 1);
      if (got.size === pool.length && k + 1 > need) { /* ひと回りした */ }
      prev = new Set(s.map(q => q.id));
    }
    if (got.size !== pool.length) cover = Infinity;
  }
  ok(`${D.id}: 1回に ${n} 問（重複なし）`, sizeOk);
  ok(`${D.id}: 前回の問題は続けて出ない`, disjoint);
  ok(`${D.id}: ${pool.length} 問が ${need} 回でひと回り`, cover <= need, cover);
  ok(`${D.id}: しばらく出ない問題がない（間隔 ${maxGap} 回以内）`, maxGap <= need + 2, maxGap);
  ok(`${D.id}: 最初の回は場面がばらける`, phaseOk);
}
{
  const pool = window.CLUB.q, r = rng(5);
  const s = TM.pick(pool, 6, ['<img>', 42, null, 'zzz', ...pool.slice(0, 3).map(q => q.id)], r);
  ok('知らない id が混じった履歴でも選べる', s.length === 6 && !s.some(q => pool.slice(0, 3).includes(q)));
  ok('問題が少ないときは全部出す', TM.pick(pool.slice(0, 4), 6, [], r).length === 4);
}

/* ---------- お気に入りクラブ（pickLoose: 直前の4問だけ避けてランダム） ---------- */
for (const c of window.FAV.clubs.filter(c => c.q.length > TM.SESSION)) {
  const n = TM.SESSION, pool = c.q;
  let sizeOk = true, overlapMax = 0, combos = new Set(), cover = Infinity, phaseOk = true;
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed * 104729);
    let hist = [], prev = [];
    const got = new Set();
    for (let k = 0; k < 20; k++) {
      const s = TM.pickLoose(pool, n, hist, r);
      const ids = s.map(q => q.id);
      if (new Set(ids).size !== n) sizeOk = false;
      overlapMax = Math.max(overlapMax, ids.filter(id => prev.includes(id)).length);
      if (k === 0 && new Set(s.map(q => q.ph)).size < Math.min(3, new Set(pool.map(q => q.ph)).size)) phaseOk = false;
      combos.add([...ids].sort().join(','));
      ids.forEach(id => { got.add(id); hist = TM.remember(hist, id, pool.length); });
      if (got.size === pool.length) cover = Math.min(cover, k + 1);
      prev = ids;
    }
  }
  ok(`fav ${c.id}: 1回に ${n} 問（重複なし）`, sizeOk);
  ok(`fav ${c.id}: 前回と重なるのは2問まで`, overlapMax <= 2, overlapMax);
  ok(`fav ${c.id}: 組み合わせが毎回変わる（2組の交互にならない）`, combos.size > 10, combos.size);
  ok(`fav ${c.id}: いずれ全問が出る`, cover <= 6, cover);
  ok(`fav ${c.id}: 最初の回は場面が3種類以上`, phaseOk);
}

/* ---------- 前節 ---------- */
const J1 = LIVE.find(l => l.id === 'j1');
const at = s => Date.parse(s);
const no = x => (x ? x.md.no : null);
const cases = [
  ['開幕前', '2026-08-08T12:00:00+09:00', null],
  ['第1節の翌日', '2026-08-10T00:00:00+09:00', 1],
  ['8/19（例の日付。実際の日程では第2節が 8/14〜15）', '2026-08-19T12:00:00+09:00', 2],
  ['水曜開催の第5節の夜（翌日0時までは前の節）', '2026-09-02T21:00:00+09:00', 4],
  ['水曜開催の第5節の翌日', '2026-09-03T00:00:00+09:00', 5],
  ['水曜開催の第11節の翌日', '2026-10-22T08:00:00+09:00', 11],
  ['第12節の途中（土曜の夜）', '2026-10-24T20:00:00+09:00', 11],
  ['今日（10/30）', '2026-10-30T12:00:00+09:00', 12],
  ['第13節の end の直前', '2026-11-01T18:14:00+09:00', 12],
  ['第13節の end', '2026-11-01T18:15:00+09:00', 13],
  ['11/24（例の日付。実際の日程では第15節が 11/20〜22）', '2026-11-24T12:00:00+09:00', 15],
  ['第16節の翌日（12/16 に回った試合は待たない）', '2026-11-26T12:00:00+09:00', 16],
  ['冬の中断中', '2027-01-10T12:00:00+09:00', 20],
  ['シーズン後', '2027-07-01T12:00:00+09:00', 38],
];
for (const [name, t, want] of cases) {
  const r = TM.lastRound(J1, at(t));
  ok(`前節: ${name} → ${want == null ? 'なし' : `第${want}節`}`, no(r.done) === want, no(r.done));
}
{
  const r = TM.lastRound(J1, at('2026-10-30T12:00:00+09:00'));
  ok('今日は第12節の問題（準備中の表示なし）', no(r.ready) === 12 && r.latest && no(r.next) === 13);
  const r2 = TM.lastRound(J1, at('2026-11-02T12:00:00+09:00'));
  ok('第13節の分析がないときは、第12節の問題を使う', no(r2.done) === 13 && no(r2.ready) === 12 && !r2.latest);
  const r3 = TM.lastRound(J1, at('2026-10-20T12:00:00+09:00'));
  ok('問題のある節がまだ終わっていなければ、遊べない', no(r3.done) === 10 && r3.ready === null);
}
{
  // シーズンの切れ目: 新しいシーズンの第1節が終わるまでは、前のシーズンの最終節
  const q = [{ id: 'x' }];
  const lg = { seasons: [
    { id: 's1', matchdays: [{ no: 1, dates: ['2026-05-02'] }, { no: 2, dates: ['2026-05-09'] }], rounds: { 2: { q } } },
    { id: 's2', matchdays: [{ no: 1, dates: ['2026-08-08'] }], rounds: {} }
  ] };
  const r = TM.lastRound(lg, at('2026-07-01T12:00:00+09:00'));
  ok('シーズンの切れ目は前のシーズンの最終節', r.done.se.id === 's1' && no(r.done) === 2 && no(r.ready) === 2 && r.latest);
  const r2 = TM.lastRound(lg, at('2026-08-10T12:00:00+09:00'));
  ok('新しいシーズンの第1節のあと（分析なし）は、前のシーズンの問題', r2.done.se.id === 's2' && r2.ready.se.id === 's1' && !r2.latest);
}
ok('日付の表示', TM.dateLabel(['2026-10-24', '2026-10-25']) === '10/24〜25' && TM.dateLabel(['2026-10-31', '2026-11-01']) === '10/31〜11/1' && TM.dateLabel(['2026-10-21']) === '10/21(水)',
  [TM.dateLabel(['2026-10-24', '2026-10-25']), TM.dateLabel(['2026-10-31', '2026-11-01']), TM.dateLabel(['2026-10-21'])]);

console.log(bad ? `${bad} fail` : 'ok');
process.exit(bad ? 1 : 0);
