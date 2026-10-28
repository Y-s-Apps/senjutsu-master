#!/usr/bin/env node
// 問題データの確認:  node dev/check.js
// 誤り（ID の不一致・ベストが1つでない・ボードの外の座標など）があれば終了コード 1。
// 「close」「badge near」は目安の注意（重なって見えるかもしれない）で、失敗にはしない。
'use strict';
const path = require('path');
global.window = {};
for (const f of ['data1.js', 'data2.js', 'data3.js']) require(path.join(__dirname, 'src', f));
const L = window.LEVELS;
let errors = 0;
const err = (...a) => { errors++; console.log('ERROR', ...a); };
const note = (...a) => console.log('  note', ...a);
const PH = ['atk', 'def', 'tr', 'coach'];

L.forEach((lv, li) => lv.q.forEach((q, qi) => {
  const tag = `L${li + 1}Q${qi + 1}`;
  for (const k of ['t', 'ph', 'view', 'h', 'a', 'ball', 's', 'q', 'opts', 'play', 'ex', 'key']) if (q[k] == null) err(tag, 'missing', k);
  if (!PH.includes(q.ph)) err(tag, 'ph は', PH.join('/'), 'のどれか');
  const ids = new Set([...q.h.map(p => 'h' + p[0]), ...q.a.map(p => 'a' + p[0])]);
  if (ids.size !== q.h.length + q.a.length) err(tag, '背番号の重複');
  const best = q.opts.filter(o => o.sc === 2);
  if (best.length !== 1) err(tag, 'sc:2（ベスト）はちょうど1つ', best.length);
  if (q.me && !ids.has(q.me)) err(tag, 'me の選手がいない', q.me);
  const [vx, vy, vw, vh] = q.view;
  const inV = p => p[0] >= vx && p[0] <= vx + vw && p[1] >= vy && p[1] <= vy + vh;
  [...q.h, ...q.a].forEach(p => { if (!inV([p[1], p[2]])) err(tag, 'ボードの外の選手', p); });
  q.play.forEach(st => {
    Object.keys(st.m || {}).forEach(id => {
      if (!ids.has(id)) err(tag, 'play に存在しない選手', id);
      if (!inV(st.m[id])) err(tag, 'ボードの外へ動く', id, st.m[id]);
    });
    if (st.b && !inV(st.b)) err(tag, 'ボールがボードの外', st.b);
  });
  q.opts.forEach(o => {
    (o.ar || []).forEach(a => {
      if (!inV(a[0]) || !inV(a[1])) err(tag, o.k, '矢印がボードの外', a);
      if (!['pass', 'run', 'drib', 'look'].includes(a[2])) err(tag, o.k, '矢印の種類', a[2]);
    });
    if (o.at && !inV(o.at)) err(tag, o.k, '記号がボードの外');
    if (!o.why || !o.l) err(tag, o.k, '文がない');
  });
  if (li === 2 && (!q.coach || !q.drill)) err(tag, '上級は coach と drill が必要');
  if (li === 0 && !q.hint) err(tag, '初級は hint が必要');

  const ps = [...q.h.map(p => ['h' + p[0], p[1], p[2]]), ...q.a.map(p => ['a' + p[0], p[1], p[2]])];
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const d = Math.hypot(ps[i][1] - ps[j][1], ps[i][2] - ps[j][2]);
    if (d < 3.4) note('close', tag, ps[i][0], ps[j][0], d.toFixed(1));
  }
  q.opts.forEach(o => {
    let at = o.at;
    if (!at && o.ar) {
      const [p, qq, , c] = o.ar[0]; const fr = c || p;
      let ux = qq[0] - fr[0], uy = qq[1] - fr[1]; const l = Math.hypot(ux, uy);
      at = [qq[0] + ux / l * 2.6, qq[1] + uy / l * 2.6];
    }
    if (!at || (!o.at && o.mk)) return;
    ps.forEach(pp => { const d = Math.hypot(pp[1] - at[0], pp[2] - at[1]); if (d < 3.2) note('badge near', tag, o.k, pp[0], d.toFixed(1)); });
  });
}));

console.log(`levels ${L.length} · questions ${L.map(l => l.q.length).join('/')} · errors ${errors}`);
process.exit(errors ? 1 : 0);
