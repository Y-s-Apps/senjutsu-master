// 「前節の一戦」のデータを読む（dev/build.js と dev/check.js が使う）。
//   dev/src/live/<リーグ>-<開幕年>/schedule.json … 日程（節ごとの開催日）
//   dev/src/live/<リーグ>-<開幕年>/<節>.json     … その節の分析と問題（例: 12.json）
// 節を足すときは <節>.json を1つ置くだけ。問題の id はファイルの場所から自動で付ける（j1-2026-12-1 など）。
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'src', 'live');

function files() {
  const out = [];
  if (!fs.existsSync(DIR)) return out;
  for (const sid of fs.readdirSync(DIR).sort()) {
    const sdir = path.join(DIR, sid);
    if (!fs.statSync(sdir).isDirectory()) continue;
    for (const f of fs.readdirSync(sdir).sort()) out.push({ sid, f, file: path.join(sdir, f) });
  }
  return out;
}

// 画面に出る文字を数えるための、JSON の中身（フォントのサブセット用）
const texts = () => files().filter(x => x.f.endsWith('.json')).map(x => fs.readFileSync(x.file, 'utf8')).join('');

function load() {
  const leagues = new Map(), seasons = new Map();
  const parse = x => {
    try { return JSON.parse(fs.readFileSync(x.file, 'utf8')); }
    catch (e) { throw new Error(`live/${x.sid}/${x.f} が JSON として読めません: ${e.message}`); }
  };
  const list = files();
  for (const x of list) {
    if (!/^[a-z0-9]+-\d{4}$/.test(x.sid)) throw new Error(`live/${x.sid}: フォルダ名は <リーグ>-<開幕年>（例: j1-2026）`);
    if (x.f !== 'schedule.json') continue;
    const sch = parse(x);
    const se = { id: x.sid, season: sch.season, source: sch.source, matchdays: sch.matchdays, rounds: {} };
    seasons.set(x.sid, se);
    const lg = leagues.get(sch.league) || { id: sch.league, name: sch.name, seasons: [] };
    if (lg.name !== sch.name) throw new Error(`live/${x.sid}: 同じリーグ（${sch.league}）なのに name が違います`);
    lg.seasons.push(se);
    leagues.set(sch.league, lg);
  }
  for (const x of list) {
    if (x.f === 'schedule.json' || x.f.startsWith('.')) continue;
    const m = x.f.match(/^(\d+)\.json$/);
    if (!m) throw new Error(`live/${x.sid}/${x.f}: ファイル名は schedule.json か <節>.json（例: 12.json）`);
    const se = seasons.get(x.sid);
    if (!se) throw new Error(`live/${x.sid}: schedule.json がありません`);
    const no = Number(m[1]), r = parse(x);
    se.rounds[no] = { ...r, q: (Array.isArray(r.q) ? r.q : []).map((q, i) => ({ ...q, id: `${x.sid}-${no}-${i + 1}` })) };
  }
  return [...leagues.values()];
}

module.exports = { load, texts, DIR };
