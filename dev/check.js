#!/usr/bin/env node
// 問題データの確認:  node dev/check.js
// 誤り（ID の不一致・ベストが1つでない・ボードの外の座標・日程の形など）があれば終了コード 1。
// 「close」「badge near」は目安の注意（重なって見えるかもしれない）で、失敗にはしない。
// 対象: レベル（data1〜3.js）・名将の戦術（data4.js）・お気に入りクラブ（data5.js）・前節の一戦（dev/src/live/ の JSON）
'use strict';
const path = require('path');
global.window = {};
for (const f of ['data1.js', 'data2.js', 'data3.js', 'data4.js', 'data5.js', 'logic.js']) require(path.join(__dirname, 'src', f));
const LIVE = require('./livedata').load();
const FAV = window.FAV;
const L = window.LEVELS, CLUB = window.CLUB, TM = window.TM;
let errors = 0;
const err = (...a) => { errors++; console.log('ERROR', ...a); };
const note = (...a) => console.log('  note', ...a);
const PH = ['atk', 'def', 'tr', 'set', 'coach'];

// 型の確認: 文は文字列、座標・点数は数値、記号は A/B/C。
// app.js は文を esc() してから差し込み、座標・点数・記号はそのまま SVG や class に入れるので、ここで型を守る。
const num = v => typeof v === 'number' && Number.isFinite(v);
const pt = v => Array.isArray(v) && v.length === 2 && v.every(num);
const str = v => typeof v === 'string' && v.length > 0;
// 選択肢は毎回並べ替えて記号を振り直すので、文の中に記号（A・B・C の1文字）を書かない（CB・CK などの略語はよい）
const LETTER = /(^|[^A-Za-z])[ABC](?=[^A-Za-z]|$)/;
const TEXTS = ['t', 's', 'q', 'hint', 'ex', 'coach', 'drill', 'ctx', 'tag'];
const qids = new Set();

// 1問の確認。opt: { hint, coach, lv, ctx } が true ならその項目が必要
function checkQ(q, tag, opt = {}) {
  if (!/^[a-z0-9-]+$/.test(q.id || '') || qids.has(q.id)) err(tag, 'id は英小文字・数字・ハイフンで重複なし', q.id);
  qids.add(q.id);
  for (const k of ['t', 'ph', 'view', 'h', 'a', 'ball', 's', 'q', 'opts', 'play', 'ex', 'key']) if (q[k] == null) err(tag, 'missing', k);
  for (const k of TEXTS) if (q[k] != null && !str(q[k])) err(tag, k, 'は文字列');
  for (const k of TEXTS) if (str(q[k]) && LETTER.test(q[k])) err(tag, k, 'に選択肢の記号（A/B/C）を書かない', q[k]);
  if (!PH.includes(q.ph)) err(tag, 'ph は', PH.join('/'), 'のどれか');
  if (opt.hint && !q.hint) err(tag, 'hint が必要');
  if (opt.coach && (!q.coach || !q.drill)) err(tag, 'coach と drill が必要');
  if (opt.lv ? ![1, 2, 3].includes(q.lv) : q.lv != null) err(tag, opt.lv ? 'lv（難しさ 1〜3）が必要' : 'lv はレベルの問題には書かない');
  if (opt.ctx && (!str(q.ctx) || !str(q.tag))) err(tag, 'ctx（架空のクラブ名（〇〇監督））と tag（国・年代・大会）が必要');
  // 区切りに「·」を使わない（クラブ名の「・」とまぎれる）。クラブ名と監督名は「クラブ名（〇〇監督）」の形
  for (const k of ['ctx', 'tag']) if (str(q[k]) && /[·•|｜]/.test(q[k])) err(tag, k, 'に区切りの記号（· など）を使わない', q[k]);
  if (!Array.isArray(q.key) || q.key.length !== 2 || !q.key.every(str)) err(tag, 'key は [用語, 説明]');
  if (!Array.isArray(q.view) || q.view.length !== 4 || !q.view.every(num)) return err(tag, 'view は数値4つ');
  if (!pt(q.ball)) err(tag, 'ball は [x, y]');
  if (q.line != null && !num(q.line)) err(tag, 'line は数値');
  if (q.lanes != null && q.lanes !== true) err(tag, 'lanes は true');
  if (q.me != null && !/^[ha]\d+$/.test(q.me)) err(tag, 'me は h6 などの形');
  if (!Array.isArray(q.h) || !Array.isArray(q.a) || !Array.isArray(q.opts) || !Array.isArray(q.play)) return err(tag, 'h・a・opts・play は配列');
  [...q.h, ...q.a].forEach(p => {
    if (!Array.isArray(p) || p.length !== 3 || !p.every(num) || !Number.isInteger(p[0])) err(tag, '選手は [背番号, x, y]', p);
  });
  const ks = q.opts.map(o => o.k);
  if (ks.join('') !== 'ABC'.slice(0, ks.length) || ks.length < 2) err(tag, '記号は A, B, C の順', ks.join(''));
  q.opts.forEach(o => {
    if (![0, 1, 2].includes(o.sc)) err(tag, o.k, 'sc は 0/1/2');
    if (!str(o.l) || !str(o.why)) err(tag, o.k, 'l・why は文字列');
    for (const k of ['l', 'why']) if (str(o[k]) && LETTER.test(o[k])) err(tag, o.k, k, 'に選択肢の記号（A/B/C）を書かない', o[k]);
    if (o.mk != null && !pt(o.mk)) err(tag, o.k, 'mk は [x, y]');
    if (o.at != null && !pt(o.at)) err(tag, o.k, 'at は [x, y]');
    (o.ar || []).forEach(a => {
      if (!pt(a[0]) || !pt(a[1]) || (a[3] != null && !pt(a[3]))) err(tag, o.k, '矢印の座標', a);
      if (!['pass', 'run', 'drib', 'look'].includes(a[2])) err(tag, o.k, '矢印の種類', a[2]);
    });
  });
  q.play.forEach(st => {
    Object.entries(st.m || {}).forEach(([id, p]) => { if (!/^[ha]\d+$/.test(id) || !pt(p)) err(tag, 'play の形', id, p); });
    if (st.b != null && !pt(st.b)) err(tag, 'play のボール', st.b);
  });

  const ids = new Set([...q.h.map(p => 'h' + p[0]), ...q.a.map(p => 'a' + p[0])]);
  if (ids.size !== q.h.length + q.a.length) err(tag, '背番号の重複');
  const best = q.opts.filter(o => o.sc === 2);
  if (best.length !== 1) err(tag, 'sc:2（ベスト）はちょうど1つ', best.length);
  if (q.me && !ids.has(q.me)) err(tag, 'me の選手がいない', q.me);
  if (q.gk != null && (!Array.isArray(q.gk) || !q.gk.every(id => typeof id === 'string' && ids.has(id)))) err(tag, 'gk は選手の id（h31 など）の配列', q.gk);
  const [vx, vy, vw, vh] = q.view;
  const inV = p => p[0] >= vx && p[0] <= vx + vw && p[1] >= vy && p[1] <= vy + vh;
  [...q.h, ...q.a].forEach(p => { if (!inV([p[1], p[2]])) err(tag, 'ボードの外の選手', p); });
  if (!inV(q.ball)) err(tag, 'ボールがボードの外', q.ball);
  q.play.forEach(st => {
    Object.keys(st.m || {}).forEach(id => {
      if (!ids.has(id)) err(tag, 'play に存在しない選手', id);
      if (!inV(st.m[id])) err(tag, 'ボードの外へ動く', id, st.m[id]);
    });
    if (st.b && !inV(st.b)) err(tag, 'ボールがボードの外', st.b);
  });
  q.opts.forEach(o => {
    (o.ar || []).forEach(a => { if (!inV(a[0]) || !inV(a[1])) err(tag, o.k, '矢印がボードの外', a); });
    if (o.at && !inV(o.at)) err(tag, o.k, '記号がボードの外');
    if (o.mk && !inV(o.mk)) err(tag, o.k, '立ち位置の印がボードの外');
  });

  const ps = [...q.h.map(p => ['h' + p[0], p[1], p[2]]), ...q.a.map(p => ['a' + p[0], p[1], p[2]])];
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const d = Math.hypot(ps[i][1] - ps[j][1], ps[i][2] - ps[j][2]);
    if (d < 3.4) note('close', tag, ps[i][0], ps[j][0], d.toFixed(1));
  }
  q.opts.forEach(o => {
    let at = o.at;
    if (!at && o.ar && o.ar.length) {
      const [p, qq, , c] = o.ar[0]; const fr = c || p;
      const ux = qq[0] - fr[0], uy = qq[1] - fr[1]; const l = Math.hypot(ux, uy) || 1;
      at = [qq[0] + ux / l * 2.6, qq[1] + uy / l * 2.6];
    }
    if (!at && o.mk) at = o.mk;
    if (!at) return;
    if (!inV(at)) err(tag, o.k, '記号がボードの外（矢印の先）', at.map(n => n.toFixed(1)));
    if (!o.at && o.mk) return;
    ps.forEach(pp => { const d = Math.hypot(pp[1] - at[0], pp[2] - at[1]); if (d < 3.2) note('badge near', tag, o.k, pp[0], d.toFixed(1)); });
  });
}

// デッキ（レベル・名将の戦術）の確認
const deckIds = new Set();
function checkDeck(D, tag, opt) {
  if (!/^[a-z]+$/.test(D.id) || deckIds.has(D.id)) err(tag, 'id は英小文字で重複なし（記録のコードに使う）', D.id);
  deckIds.add(D.id);
  for (const k of ['name', 'title', 'who']) if (!str(D[k])) err(tag, k, 'は文字列');
  if (D.feat != null && typeof D.feat !== 'string') err(tag, 'feat は文字列（なしなら空）');
  if (!Array.isArray(D.q) || D.q.length < TM.SESSION * 2) err(tag, `問題は ${TM.SESSION * 2} 問以上（直近の問題を避けて選べるように）`, D.q && D.q.length);
  (D.q || []).forEach((q, qi) => checkQ(q, `${tag}Q${qi + 1}(${q.id})`, opt(q, qi)));
  const phs = new Set((D.q || []).map(q => q.ph));
  if (phs.size < 3) err(tag, '場面（攻撃・守備…）が3種類以上あること', [...phs].join(','));
}
L.forEach((lv, li) => {
  if (lv.no !== li + 1) err(`L${li + 1}`, 'no は', li + 1);
  checkDeck(lv, `L${li + 1}`, () => ({ hint: li === 0, coach: li === 2 }));
});
if (!CLUB) err('CLUB', 'data4.js がない');
else {
  if (!str(CLUB.mv) || !str(CLUB.short)) err('CLUB', 'mv（記録の引っこしでの呼び名）と short（問題画面の表示）が必要');
  checkDeck(CLUB, 'CLUB', () => ({ lv: true, ctx: true }));
}

// 前節の一戦: 日程と節ごとの問題
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const okDate = s => DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
if (!LIVE.length) err('LIVE', 'dev/src/live/ に日程がない');
LIVE.forEach(lg => {
  if (!/^[a-z0-9]+$/.test(lg.id || '')) err('LIVE', 'league は英小文字・数字', lg.id);
  if (!str(lg.name)) err('LIVE', lg.id, 'name が必要');
  lg.seasons.forEach(se => {
    const tag = `live/${se.id}`;
    if (!str(se.season)) err(tag, 'season が必要');
    if (se.source != null && !str(se.source)) err(tag, 'source は文字列');
    if (!Array.isArray(se.matchdays) || !se.matchdays.length) return err(tag, 'matchdays が必要');
    let prev = '';
    se.matchdays.forEach((md, i) => {
      const t = `${tag} 第${md.no}節`;
      if (md.no !== i + 1) err(t, '節は 1 から順に並べる', md.no);
      if (!Array.isArray(md.dates) || !md.dates.length || !md.dates.every(okDate)) return err(t, 'dates は YYYY-MM-DD の配列', md.dates);
      if (md.dates.some((d, j) => j && d <= md.dates[j - 1])) err(t, 'dates は古い順');
      if (md.dates[0] < prev) err(t, '前の節より前の日付', md.dates[0]);
      prev = md.dates[md.dates.length - 1];
      if (md.later != null && (!Array.isArray(md.later) || !md.later.every(okDate))) err(t, 'later は YYYY-MM-DD の配列');
      if (md.end != null && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(md.end) || Number.isNaN(Date.parse(md.end)))) err(t, 'end は 2026-10-25T18:30:00+09:00 の形', md.end);
      for (const k of Object.keys(md)) if (!['no', 'dates', 'later', 'end'].includes(k)) err(t, '知らない項目', k);
    });
    Object.entries(se.rounds).forEach(([no, r]) => {
      const t = `${tag}/${no}.json`;
      if (!se.matchdays.some(md => md.no === Number(no))) err(t, '日程にない節');
      if (!str(r.summary)) err(t, 'summary（その節の傾向）が必要');
      if (!Array.isArray(r.q) || r.q.length < 3) err(t, '問題は3問以上');
      for (const k of Object.keys(r)) if (!['summary', 'q'].includes(k)) err(t, '知らない項目', k);
      (r.q || []).forEach((q, qi) => checkQ(q, `${t} Q${qi + 1}`, { lv: true }));
    });
  });
});

// お気に入りクラブ（data5.js）: クラブの id は自己ベスト・履歴・記録の引っこしのコード（英小文字だけ）にそのまま使うので、
// 英小文字だけで、ほかのデッキの id と重ならないこと。名前・モチーフ・色（#RRGGBB）、問題は lv・tag（年・節）・ctx（その試合の文脈）が必要
if (!FAV || !Array.isArray(FAV.clubs) || !FAV.clubs.length || !str(FAV.name)) err('FAV', 'data5.js の window.FAV（name と clubs）がない');
else {
  const used = new Set([...L.map(l => l.id), CLUB && CLUB.id, 'live']);
  FAV.clubs.forEach(c => {
    const t = `FAV ${c.id}`;
    if (!/^[a-z]+$/.test(c.id || '') || used.has(c.id)) err(t, 'クラブの id は英小文字だけで、ほかのデッキと重ならない', c.id);
    used.add(c.id);
    if (!str(c.name) || !str(c.motif)) err(t, 'name と motif が必要');
    if (str(c.name) && !/^\p{Script=Han}+\S+$/u.test(c.name)) err(t, 'name は「地名（漢字）＋モチーフ」の形（選ぶ画面で2行に分ける）', c.name);
    if (!c.color || !['home', 'rim', 'away'].every(k => /^#[0-9A-Fa-f]{6}$/.test(c.color[k] || ''))) err(t, 'color の home・rim・away は #RRGGBB');
    for (const k of Object.keys(c)) if (!['id', 'name', 'motif', 'color', 'q'].includes(k)) err(t, '知らない項目', k);
    if (!Array.isArray(c.q) || c.q.length < TM.SESSION) err(t, `問題は ${TM.SESSION} 問以上`, c.q && c.q.length);
    (c.q || []).forEach((q, qi) => checkQ(q, `${t} Q${qi + 1}(${q.id})`, { lv: true, ctx: true }));
    const phs = new Set((c.q || []).map(q => q.ph));
    if (phs.size < 3) err(t, '場面（攻撃・守備…）が3種類以上あること', [...phs].join(','));
  });
}
const liveQ = LIVE.reduce((n, lg) => n + lg.seasons.reduce((m, se) => m + Object.values(se.rounds).reduce((k, r) => k + r.q.length, 0), 0), 0);
console.log(`levels ${L.length} · questions ${L.map(l => l.q.length).join('/')} · club ${CLUB ? CLUB.q.length : 0} · fav ${FAV ? `${FAV.clubs.length}×${FAV.clubs.map(c => c.q.length).join('/')}` : 0} · live ${liveQ} · errors ${errors}`);
process.exit(errors ? 1 : 0);
