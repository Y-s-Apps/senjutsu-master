#!/usr/bin/env node
// 前節の一戦: いま（または --now の日時）で「前節」になる節と、その節の問題ファイルがあるかを出す。
// 毎節の問題追加（スケジュールされたタスク。CLAUDE.md「毎節の自動追加」）が最初に使う。読むだけで何も書き換えない。
//   node dev/live-status.js                               いまの日時で
//   node dev/live-status.js --now 2026-11-02T09:00:00+09:00
//   node dev/live-status.js --json                        1行の JSON だけ（todo が true なら追加が要る）
'use strict';
const path = require('path');
global.window = {};
require(path.join(__dirname, 'src', 'logic.js'));
const live = require('./livedata');
const TM = window.TM;

const args = process.argv.slice(2);
const at = args.indexOf('--now');
const now = at >= 0 ? Date.parse(args[at + 1]) : Date.now();
if (Number.isNaN(now)) { console.error('--now は 2026-11-02T09:00:00+09:00 の形で'); process.exit(2); }

const md = x => x && { season: x.se.id, no: x.md.no, dates: x.md.dates, later: x.md.later || [], done_at: new Date(x.t).toISOString() };
const out = live.load().map(lg => {
  const r = TM.lastRound(lg, now);
  const has = !!(r.done && r.done.se.rounds[r.done.md.no]);
  return {
    league: lg.id, name: lg.name,
    done: md(r.done),    // いま終わっている直近の節（＝前節）
    file: r.done ? `dev/src/live/${r.done.se.id}/${r.done.md.no}.json` : null,
    has_file: has,
    todo: !!(r.done && !has), // 前節の問題ファイルがない → 追加が要る
    ready: md(r.ready),  // 問題のある直近の節（いまアプリが出している節）
    next: md(r.next),    // まだ終わっていない最初の節
    schedule_source: r.done ? r.done.se.source : null
  };
});

if (args.includes('--json')) { console.log(JSON.stringify(out)); process.exit(0); }
const label = x => (x ? `第${x.no}節（${TM.dateLabel(x.dates)}${x.later.length ? `、別日 ${x.later.join(', ')}` : ''}）` : 'なし');
console.log(`いま: ${new Date(now).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}（日本時間）`);
out.forEach(o => {
  console.log(`${o.name}`);
  console.log(`  前節: ${label(o.done)}`);
  console.log(`  問題ファイル: ${o.file || '—'} … ${o.has_file ? 'ある' : o.done ? 'ない → 追加が要る' : '—'}`);
  console.log(`  アプリが出している節: ${label(o.ready)}`);
  console.log(`  次の節: ${label(o.next)}`);
});
