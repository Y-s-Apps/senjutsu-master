(() => {
  'use strict';
  const TM = window.TM; // logic.js（問題の選び方・選択肢の並べ替え・前節の決め方）
  const LV = window.LEVELS;
  const CLUB = window.CLUB;
  const REC = [...LV, CLUB]; // 自己ベストと出題の履歴を残すもの（id は記録の引っこしのコードにも使う）
  LV.forEach(L => { L.short = `Lv.${L.no} ${L.name}`; }); // 問題画面の上の表示
  const mvName = D => D.mv || D.name; // 記録の引っこしでの呼び名（初級・中級・上級・名将）
  const app = document.getElementById('app');
  const PH = { atk: '攻撃', def: '守備', tr: '切り替え', set: 'セットプレー', coach: '指導場面' };
  const LVN = ['', '初級', '中級', '上級'];
  const RES = ['要注意', '悪くない', 'ベスト'];
  const VERDICT = ['要注意', '悪くない', 'ベスト'];
  const BO = [1.35, -1.15]; // ボールは選手の足元に少しずらして置く
  const KEY = 'tacdrill-best-v1';
  const HKEY = 'senjutsu-master-recent-v1'; // 直近に出した問題（同じ問題が続けて出ないように）
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // deck: いま遊んでいるもの（レベル・名将の戦術・前節の一戦）、qs: 今回出す問題（選択肢は並べ替え済み）
  const S = { deck: null, qs: [], qi: 0, ans: [], done: false, timers: [], screen: 'home' };

  // 線のアイコン（16×16、線の幅はすべて CSS の .i で同じにする）
  const IC = {
    back: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
    next: '<path d="M3 8h10M9 4l4 4-4 4"/>',
    replay: '<path d="M13.2 8.6A5.25 5.25 0 1 1 11.6 4.2"/><path d="M12.2 1.9v2.8H9.4"/>',
    hint: '<path d="M6.1 13.9h3.8"/><path d="M8 2a4 4 0 0 0-2.3 7.3c.5.4.8.9.8 1.5v.6h3v-.6c0-.6.3-1.1.8-1.5A4 4 0 0 0 8 2Z"/>',
    move: '<path d="M2.5 5.5h10M10 3l2.5 2.5L10 8"/><path d="M13.5 10.5h-10M6 8l-2.5 2.5L6 13"/>',
    board: '<rect x="1.75" y="3" width="12.5" height="10" rx="1.5"/><path d="M8 3v10"/><circle cx="8" cy="8" r="2"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>'
  };
  const icon = n => `<svg class="i" viewBox="0 0 16 16" aria-hidden="true">${IC[n]}</svg>`;
  const f = n => Math.round(n * 100) / 100;
  const maxOf = D => Math.min(D.q.length, TM.SESSION) * 2;
  const cur = () => S.qs[S.qi];
  // 画面へ差し込む文字はすべて esc() を通す（問題データは自前だが、念のため HTML として解釈させない）。
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // 自己ベストは同じドメイン（y-s-apps.github.io）のほかのページからも書き換えられるので、
  // 読むときに「知っているレベルの id と、0〜満点の整数」だけを残す。壊れた値は捨てる。
  // 「記録の引っこし」で読み込んだ記録も、同じ cleanBest() を通す。
  const cleanBest = raw => {
    const out = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      REC.forEach(D => {
        const v = raw[D.id];
        if (Number.isInteger(v) && v >= 0 && v <= maxOf(D)) out[D.id] = v;
      });
    }
    return out;
  };
  const loadBest = () => {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(KEY)); } catch (e) { raw = null; }
    return cleanBest(raw);
  };
  const saveBest = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* 保存できない環境では無視 */ } };
  // 出題の履歴も、ほかのページから書き換えられる前提で読む: 知っている id の文字列だけを残す。
  const loadHist = () => {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(HKEY)); } catch (e) { raw = null; }
    const out = {};
    REC.forEach(D => {
      const known = new Set(D.q.map(q => q.id));
      const a = raw && typeof raw === 'object' && Array.isArray(raw[D.id]) ? raw[D.id] : [];
      out[D.id] = a.filter(x => typeof x === 'string' && known.has(x)).slice(-D.q.length);
    });
    return out;
  };
  const seen = (D, id) => {
    if (!REC.includes(D)) return;
    const h = loadHist();
    h[D.id] = TM.remember(h[D.id], id, D.q.length);
    try { localStorage.setItem(HKEY, JSON.stringify(h)); } catch (e) { /* 保存できない環境では無視 */ }
  };
  const total = () => S.ans.reduce((a, x) => a + (x ? x.sc : 0), 0);

  /* ---------- ピッチ描画 ---------- */
  function field() {
    let g = '<rect class="grass" x="-8" y="-8" width="84" height="121"/>';
    g += `<g class="goal"><rect x="30.34" y="-2.2" width="7.32" height="2.2"/><rect x="30.34" y="105" width="7.32" height="2.2"/></g>
    <g class="chalk">
      <rect x="0" y="0" width="68" height="105"/>
      <line x1="0" y1="52.5" x2="68" y2="52.5"/>
      <circle cx="34" cy="52.5" r="9.15"/>
      <rect x="13.84" y="0" width="40.32" height="16.5"/>
      <rect x="24.84" y="0" width="18.32" height="5.5"/>
      <path d="M26.69 16.5A9.15 9.15 0 0 0 41.31 16.5"/>
      <rect x="13.84" y="88.5" width="40.32" height="16.5"/>
      <rect x="24.84" y="99.5" width="18.32" height="5.5"/>
      <path d="M26.69 88.5A9.15 9.15 0 0 1 41.31 88.5"/>
      <path d="M0 1A1 1 0 0 0 1 0M67 0A1 1 0 0 0 68 1M68 104A1 1 0 0 0 67 105M1 105A1 1 0 0 0 0 104"/>
    </g>
    <g class="spots"><circle cx="34" cy="52.5" r=".4"/><circle cx="34" cy="11" r=".4"/><circle cx="34" cy="94" r=".4"/></g>`;
    return g;
  }

  function lanes(v) {
    const xs = [13.84, 24.84, 43.16, 54.16];
    const names = [[6.92, 'サイド'], [19.34, 'ハーフ'], [34, '中央'], [48.66, 'ハーフ'], [61.08, 'サイド']];
    const y2 = v[1] + v[3];
    let g = '<g class="lanes">';
    xs.forEach(x => { g += `<line x1="${x}" y1="${v[1]}" x2="${x}" y2="${y2}"/>`; });
    names.forEach(([x, n]) => { g += `<text x="${x}" y="${f(y2 - 1.4)}">${n}</text>`; });
    return g + '</g>';
  }

  function offside(y) {
    return `<g class="offside"><line x1="-1" y1="${y}" x2="69" y2="${y}"/><text x="1" y="${y - 0.9}">オフサイドライン</text></g>`;
  }

  // 矢印: [始点, 終点, 種類, 制御点?]  種類 pass=実線 / run=破線 / drib=波線 / look=点線
  function arrow(a) {
    const [p, q, kind, c] = a;
    const from = c || p;
    let ux = q[0] - from[0], uy = q[1] - from[1];
    const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
    const e = [q[0] - ux * 1.1, q[1] - uy * 1.1];
    let d;
    if (kind === 'drib') {
      const dx = e[0] - p[0], dy = e[1] - p[1], len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len, N = Math.max(10, Math.ceil(len * 5)), pts = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const amp = 0.6 * Math.min(1, (len * (1 - t)) / 1.6, (len * t) / 1.2);
        const w = Math.sin((t * len / 1.8) * Math.PI * 2) * amp;
        pts.push(f(p[0] + dx * t + nx * w) + ' ' + f(p[1] + dy * t + ny * w));
      }
      d = 'M' + pts.join('L');
    } else if (c) {
      d = `M${p[0]} ${p[1]}Q${c[0]} ${c[1]} ${f(e[0])} ${f(e[1])}`;
    } else {
      d = `M${p[0]} ${p[1]}L${f(e[0])} ${f(e[1])}`;
    }
    const bx = q[0] - ux * 1.8, by = q[1] - uy * 1.8, nx = -uy * 0.85, ny = ux * 0.85;
    const head = `${f(q[0])},${f(q[1])} ${f(bx + nx)},${f(by + ny)} ${f(bx - nx)},${f(by - ny)}`;
    return { svg: `<path class="ln k-${kind}" d="${d}"/><polygon class="hd" points="${head}"/>`, tip: [q[0] + ux * 2.6, q[1] + uy * 2.6] };
  }

  function optG(o) {
    let g = '', at = o.at;
    (o.ar || []).forEach((a, i) => { const r = arrow(a); g += r.svg; if (!at && i === 0) at = r.tip; });
    if (o.mk) { g += `<circle class="ring" cx="${o.mk[0]}" cy="${o.mk[1]}" r="2.5"/>`; if (!at) at = o.mk; }
    if (!at) return '';
    g += `<g class="bdg" transform="translate(${f(at[0])} ${f(at[1])})"><circle class="hit" r="3.4"/><circle r="1.75"/><text y=".7">${esc(o.k)}</text></g>`;
    return `<g class="og" data-k="${esc(o.k)}">${g}</g>`;
  }

  function players(s) {
    let g = '';
    const add = (t, [n, x, y]) => {
      const id = t + n, me = s.me === id;
      g += `<g class="pl t-${t}${n === 1 ? ' gk' : ''}${me ? ' me' : ''}" data-id="${id}" style="transform:translate(${x}px,${y}px)">` +
        (me ? '<circle class="me-ring" r="3.2"/>' : '') +
        `<circle class="mag" r="2"/><text class="num" y=".74">${n}</text>` +
        (me ? '<text class="me-lb" y="-3.9">あなた</text>' : '') + '</g>';
    };
    s.a.forEach(p => add('a', p));
    s.h.forEach(p => add('h', p));
    return g;
  }

  const ballXY = p => `translate(${f(p[0] + BO[0])}px,${f(p[1] + BO[1])}px)`;

  function pitchSVG(s) {
    const v = s.view;
    const label = `${PH[s.ph]}の場面。青が味方、赤が相手。味方は上に向かって攻めている。`;
    return `<svg id="pitch" viewBox="${v.join(' ')}" role="img" aria-label="${label}">
      ${field()}${s.lanes ? lanes(v) : ''}${s.line ? offside(s.line) : ''}
      <g class="opts-g">${s.opts.map(optG).join('')}</g>
      <g class="pls">${players(s)}</g>
      <g class="ball" style="transform:${ballXY(s.ball)}"><circle r=".95"/><circle class="bp" r=".38"/></g>
    </svg>`;
  }

  /* ---------- アニメーション ---------- */
  function clearTimers() { S.timers.forEach(clearTimeout); S.timers = []; }
  function placeAll(s) {
    const svg = document.getElementById('pitch'); if (!svg) return;
    svg.classList.add('snap');
    [['a', s.a], ['h', s.h]].forEach(([t, arr]) => arr.forEach(([n, x, y]) => {
      const el = svg.querySelector(`[data-id="${t}${n}"]`); if (el) el.style.transform = `translate(${x}px,${y}px)`;
    }));
    svg.querySelector('.ball').style.transform = ballXY(s.ball);
    void svg.getBoundingClientRect();
    svg.classList.remove('snap');
  }
  function play(s) {
    clearTimers(); placeAll(s);
    const svg = document.getElementById('pitch');
    const gap = reduce ? 700 : 1050;
    s.play.forEach((st, i) => {
      S.timers.push(setTimeout(() => {
        if (!svg.isConnected) return;
        Object.entries(st.m || {}).forEach(([id, [x, y]]) => {
          const el = svg.querySelector(`[data-id="${id}"]`); if (el) el.style.transform = `translate(${x}px,${y}px)`;
        });
        if (st.b) svg.querySelector('.ball').style.transform = ballXY(st.b);
      }, 350 + i * gap));
    });
  }

  /* ---------- 改行位置: 日本語の文を文節の境目でだけ折り返す ----------
     body の word-break: keep-all と組み合わせ、文節の間に <wbr> を入れる（BudouX）。
     innerHTML で文を差し込んだら、その要素に phrase() をかける。SVG の中は対象外。 */
  const JA = /[　-ヿ㐀-鿿＀-￯]/;
  // 行頭に来てはいけない文字（助詞・小さいかな・閉じ括弧・句読点）で始まる文節は前の文節につなげる。
  // BudouX は「（あなた）|は」「」|の」のように括弧の後で切ることがあるため。
  const NO_START = /^[をにがはのへてゃゅょぁぃぅぇぉっァィゥェォッャュョー、。・）」』，．：！？]/;
  // 閉じ括弧の直後はブラウザが keep-all でも折るので、文節の中では WORD JOINER（U+2060）でつなぐ。
  const phrases = text => window.BudouX.parse(text).reduce((a, p) => {
    if (a.length && NO_START.test(p)) a[a.length - 1] += p; else a.push(p);
    return a;
  }, []).map(p => p.replace(/([）」』)])(?=.)/g, '$1⁠'));
  function phrase(root) {
    if (!root || !window.BudouX) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (JA.test(n.nodeValue) && !n.parentElement.closest('svg, script, style')
        && !/^(nowrap|pre)/.test(getComputedStyle(n.parentElement).whiteSpace)) // 1行のラベルには入れない（Chrome は nowrap でも <wbr> で折る）
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const list = [];
    while (w.nextNode()) list.push(w.currentNode);
    list.forEach(n => {
      const parts = phrases(n.nodeValue);
      if (parts.length < 2) return;
      const frag = document.createDocumentFragment();
      parts.forEach((p, i) => {
        if (i) frag.appendChild(document.createElement('wbr'));
        frag.appendChild(document.createTextNode(p));
      });
      n.parentNode.replaceChild(frag, n);
    });
  }

  /* ---------- 画面: ホーム ---------- */
  const TWO_COL = '(min-width: 720px) and (min-aspect-ratio: 5/4)';
  function pips(n) { return [0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join(''); }
  const CLUB_ICON = `<span class="ico">${icon('board')}</span>`;

  // レベルと「名将の戦術」のカード: 名前・題・自己ベスト、2行目に対象・特徴・問題数
  function card(D, mark, label, best) {
    const b = best[D.id];
    return `<button class="lv" data-start="${esc(D.id)}" aria-label="${esc(label)} ${esc(D.title)}">
      <span class="lv-head">${mark}<span class="lv-name">${esc(label)}</span><span class="lv-title">${esc(D.title)}</span><span class="lv-best"><small>最高</small><b>${b == null ? '—' : esc(b)}</b>/${maxOf(D)}</span></span>
      <span class="lv-who"><span class="lv-w">${esc(D.who)}${LV.includes(D) ? '向け' : ''}${D.feat ? `、${esc(D.feat)}` : ''}</span><span class="lv-n">${D.q.length}問</span></span>
    </button>`;
  }

  // 前節の一戦: いまの日時（日本時間）から、終わっている直近の節を選ぶ（logic.js の lastRound）
  const liveInfo = () => {
    const L = (window.LIVE || [])[0];
    return L ? { L, ...TM.lastRound(L, Date.now()) } : null;
  };
  function liveCard() {
    const li = liveInfo(); if (!li) return '';
    const { L, done, ready, next, latest } = li;
    const head = ready ? `${L.name} 第${ready.md.no}節` : L.name;
    const sub = ready
      ? (latest ? `${TM.dateLabel(ready.md.dates)}の試合から` : `第${done.md.no}節は分析の準備中。第${ready.md.no}節（${TM.dateLabel(ready.md.dates)}）から`)
      : done ? `第${done.md.no}節は分析の準備中です`
        : next ? `第${next.md.no}節（${TM.dateLabel(next.md.dates)}）が終わると始まります` : '分析を準備中です';
    return `<button class="lv lv-live" data-start="live"${ready ? '' : ' disabled'} aria-label="前節の一戦 ${esc(head)}">
      <span class="lv-head"><span class="ico live" aria-hidden="true"><i></i></span><span class="lv-name">前節の一戦</span><span class="lv-title">${esc(head)}</span>${ready ? `<span class="lv-best"><b>${Math.min(ready.round.q.length, TM.SESSION)}</b>問</span>` : ''}</span>
      <span class="lv-who"><span class="lv-w">${esc(sub)}、非公式の分析</span></span>
    </button>`;
  }
  // 前節の一戦を遊ぶときのデッキ（自己ベストは残さない）
  function liveDeck() {
    const li = liveInfo(); if (!li || !li.ready) return null;
    const { L, ready } = li;
    return { id: 'live', live: true, short: `${L.name} 第${ready.md.no}節`, name: '前節の一戦', title: `${L.name} 第${ready.md.no}節`, summary: ready.round.summary, q: ready.round.q };
  }

  function home() {
    S.screen = 'home'; clearTimers();
    const best = loadBest();
    app.innerHTML = `
    <div class="screen home">
      <div class="h-side">
        <header class="h-top">
          <h1>戦術マスター</h1>
          <p class="lead">ボードの状況を読んで次のプレーを選ぶ。選手が動いて、その理由を見せてくれます。</p>
        </header>
        <ul class="key" aria-label="ボードの見方">
          <li><svg viewBox="-3 -3 6 6" aria-hidden="true"><circle r="2.4" class="k-home"/></svg>味方</li>
          <li><svg viewBox="-3 -3 6 6" aria-hidden="true"><circle r="2.4" class="k-away"/></svg>相手</li>
          <li><svg viewBox="-3 -3 6 6" aria-hidden="true"><circle r="2.5" class="k-me"/><circle r="1.6" class="k-home"/></svg>あなた</li>
          <li><svg class="wide" viewBox="0 -2 16 4" aria-hidden="true"><path class="k-ln" d="M1 0H13"/><path class="k-hd" d="M15 0L12.6-1.3V1.3Z"/></svg>パス</li>
          <li><svg class="wide" viewBox="0 -2 16 4" aria-hidden="true"><path class="k-ln k-dash" d="M1 0H13"/><path class="k-hd" d="M15 0L12.6-1.3V1.3Z"/></svg>走る</li>
          <li><svg class="wide" viewBox="0 -2 16 4" aria-hidden="true"><path class="k-ln" d="M1 0Q2 -1.2 3 0T5 0T7 0T9 0T11 0T13 0"/><path class="k-hd" d="M15 0L12.6-1.3V1.3Z"/></svg>ドリブル</li>
        </ul>
        <div class="foot-row">
          <p class="foot"><span>味方はいつも上（↑）へ攻めます。</span><span>採点：<span class="nw">ベスト2点</span>・<span class="nw">悪くない1点</span>・<span class="nw">要注意0点</span></span></p>
          <button class="link move-link" id="moveOpen" aria-haspopup="dialog" aria-label="記録の引っこし・バックアップ">${icon('move')}記録の引っこし</button>
        </div>
      </div>
      <nav class="levels" aria-label="遊ぶものを選ぶ">
        <div class="grp">${LV.map(L => card(L, `<span class="pips" aria-hidden="true">${pips(L.no)}</span>`, L.name, best)).join('')}</div>
        <div class="grp">${card(CLUB, CLUB_ICON, CLUB.name, best)}${liveCard()}</div>
      </nav>
    </div>`;
    phrase(app);
  }

  /* ---------- 画面: 問題 ---------- */
  function dots() {
    return S.qs.map((_, i) => {
      const a = S.ans[i];
      return `<li class="${a ? 'r' + a.sc : (i === S.qi ? 'now' : '')}"></li>`;
    }).join('');
  }

  function question() {
    S.screen = 'play'; S.done = false; S.tab = 'why'; clearTimers();
    const D = S.deck, s = cur(), v = s.view;
    seen(D, s.id);
    app.innerHTML = `
    <div class="screen play" data-qid="${esc(s.id)}">
      <nav class="bar">
        <button class="link back" id="back" aria-label="ホームへ戻る">${icon('back')}</button>
        <span class="bar-lv">${esc(D.short)}</span>
        <ol class="dots" aria-hidden="true">${dots()}</ol>
        <span class="bar-q">${S.qi + 1}<small>/${S.qs.length}</small></span>
        <span class="bar-pt"><b id="pt">${total()}</b>点</span>
      </nav>
      <div class="stage">
        <div class="board-area">
          <div class="board" id="board" style="--ar:${f(v[2] / v[3])}">${pitchSVG(s)}
            <span class="dir">攻撃 ↑</span>
            <span class="stamp" id="stamp" hidden></span>
            ${s.hint ? `<p class="hint-cap" id="hint" hidden>ヒント：${esc(s.hint)}</p>` : ''}
          </div>
        </div>
        <section class="panel" id="panel">
          <div class="qhead">
            <span class="phase ph-${s.ph}"><i></i>${PH[s.ph]}</span>
            ${s.lv ? `<span class="diff" role="img" aria-label="難しさ ${LVN[s.lv]}"><span class="pips" aria-hidden="true">${pips(s.lv)}</span></span>` : ''}
            <h2 class="qt">${esc(s.t)}</h2>
            ${s.hint ? `<button class="hint-btn" id="hintBtn" aria-pressed="false">${icon('hint')}ヒント</button>` : ''}
          </div>
          ${s.ctx || s.tag ? `<p class="ctx">${s.tag ? `<span class="ctx-tag">${esc(s.tag)}</span>` : ''}${s.ctx ? `<span>${esc(s.ctx)}</span>` : ''}</p>` : ''}
          <p class="sit">${esc(s.s)}</p>
          <p class="qq">${esc(s.q)}</p>
          <div class="opts" role="group" aria-label="選択肢">
            ${s.opts.map(o => `<button class="opt" data-k="${esc(o.k)}"><span class="k">${esc(o.k)}</span><span class="l">${esc(o.l)}</span></button>`).join('')}
          </div>
        </section>
      </div>
    </div>`;
    phrase(app);
    lockPanel();
  }

  // 縦並びのとき、回答後に出る解説（どの選択肢・どのタブでも）が収まる高さを先に測ってパネルを固定する。
  // 問題と解説でパネルの高さが同じなので、ボードの大きさは変わらない。ボードには最低でも残り高さの 38% を残す。
  function lockPanel() {
    const panel = document.getElementById('panel');
    if (!panel || matchMedia(TWO_COL).matches) return;
    const s = cur(), room = document.querySelector('.stage').clientHeight;
    const probe = document.createElement('section');
    probe.className = 'panel is-fb';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;max-height:none;height:auto;width:${panel.clientWidth}px`;
    panel.parentNode.appendChild(probe);
    let need = 0;
    s.opts.forEach(o => {
      tabList(s, o, bestOf(s)).forEach(([id]) => {
        probe.innerHTML = fbHTML(s, o, id, false);
        phrase(probe);
        need = Math.max(need, probe.scrollHeight);
      });
    });
    probe.remove();
    panel.style.height = Math.round(Math.min(Math.max(panel.offsetHeight, need), room * 0.62)) + 'px';
  }

  const bestOf = s => s.opts.reduce((p, q) => (q.sc > p.sc ? q : p));

  function fbHTML(s, o, tab, last) {
    return `
      <div class="tabs" role="tablist">${tabList(s, o, bestOf(s)).map(([id, n]) => `<button class="tab" role="tab" data-tab="${id}" aria-selected="${id === tab}">${n}</button>`).join('')}</div>
      <div class="tabbody" id="tabbody" role="tabpanel">${tabBody(tab, o.k)}</div>
      <div class="acts">
        <button class="btn ghost" id="replay" aria-label="動きをもう一度再生">${icon('replay')}動き</button>
        <button class="btn" id="next">${last ? '結果を見る' : '次の問題へ'}${icon('next')}</button>
      </div>`;
  }

  function tabList(s, o, best) {
    const T = [['why', '理由'], ['ex', '解説'], ['key', '用語']];
    if (s.coach) T.push(['coach', '指導'], ['drill', '練習']);
    if (s.opts.some(x => x.k !== o.k && x.k !== best.k)) T.push(['rest', 'ほかの選択肢']);
    return T;
  }

  function tabBody(id, k = S.ans[S.qi].k) {
    const s = cur();
    const o = s.opts.find(x => x.k === k);
    const best = bestOf(s);
    const line = (x, tag) => `<p class="oline c${x.sc}"><span class="kc">${esc(x.k)}</span><span>${tag}${esc(x.l)}</span></p><p>${esc(x.why)}</p>`;
    switch (id) {
      case 'why':
        return line(o, 'あなたの選択：') + (o.k !== best.k ? line(best, 'ベスト：') : '');
      case 'ex': return `<p>${esc(s.ex)}</p>`;
      case 'key': return `<p class="term"><b class="hl">${esc(s.key[0])}</b></p><p>${esc(s.key[1])}</p>`;
      case 'coach': return `<p>${esc(s.coach)}</p>`;
      case 'drill': return `<p>${esc(s.drill)}</p>`;
      case 'rest': return s.opts.filter(x => x.k !== o.k && x.k !== best.k).map(x => line(x, `${RES[x.sc]}：`)).join('');
    }
    return '';
  }

  function setTab(id) {
    S.tab = id;
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
    const b = document.getElementById('tabbody');
    b.innerHTML = tabBody(id); b.scrollTop = 0;
    phrase(b);
  }

  function choose(k) {
    if (S.done) return;
    const s = cur();
    const o = s.opts.find(x => x.k === k); if (!o) return;
    S.done = true;
    S.ans[S.qi] = { k, sc: o.sc };
    const best = s.opts.reduce((a, b) => (b.sc > a.sc ? b : a));

    document.querySelectorAll('#pitch .og').forEach(g => {
      const kk = g.dataset.k, x = s.opts.find(y => y.k === kk);
      g.classList.add(kk === best.k ? 'r2' : kk === k ? 'r' + x.sc : 'dim');
    });
    document.getElementById('pitch').classList.add('answered');
    const stamp = document.getElementById('stamp');
    stamp.className = 'stamp v' + o.sc; stamp.innerHTML = `<i></i>${esc(k)} · ${VERDICT[o.sc]}<b>+${o.sc}点</b>`; stamp.hidden = false;
    const hint = document.getElementById('hint'); if (hint) hint.hidden = true;
    document.getElementById('pt').textContent = total();
    document.querySelector('.dots').innerHTML = dots();

    const panel = document.getElementById('panel');
    panel.classList.add('is-fb');
    panel.innerHTML = fbHTML(s, o, 'why', S.qi === S.qs.length - 1);
    phrase(panel);
    play(s);
  }

  function next() {
    if (S.qi < S.qs.length - 1) { S.qi++; question(); } else result();
  }

  /* ---------- 画面: 結果 ---------- */
  // 次へ進むボタン: 初級→中級→上級→名将の戦術
  const nextDeck = D => { const i = LV.indexOf(D); return i < 0 ? null : (LV[i + 1] || CLUB); };
  function result() {
    S.screen = 'result'; clearTimers();
    const D = S.deck, sc = total(), mx = S.qs.length * 2, pct = sc / mx;
    let isNew = false;
    if (REC.includes(D)) {
      const best = loadBest(), prev = best[D.id];
      isNew = prev == null || sc > prev;
      if (isNew) { best[D.id] = sc; saveBest(best); }
    }
    const msg = D.live ? D.summary
      : pct >= 0.85
        ? (D === CLUB ? '名将たちの狙いを読み取れています。' : D === LV[LV.length - 1] ? '構造と言葉の両方で説明できるレベルです。' : '戦術眼あり。次のレベルへ進みましょう。')
        : pct >= 0.6 ? '原則はつかめています。「要注意」の問題を見直すとさらに伸びます。'
          : '原則をひとつずつ。解説を読んで、もう一度挑戦してみましょう。';
    const nx = nextDeck(D);
    app.innerHTML = `
    <div class="screen result">
      <div class="r-head">
        <p class="eyebrow">${esc(D.short)} · ${esc(D.live ? D.name : D.title)}</p>
        <div class="score"><b>${sc}</b><span>/${mx}</span>${isNew ? '<em><i></i>自己ベスト</em>' : ''}</div>
        <p class="msg${D.live ? ' msg-live' : ''}">${esc(msg)}</p>
      </div>
      <ol class="rlist">
        ${S.qs.map((q, i) => {
          const a = S.ans[i] || { sc: 0 };
          return `<li><span class="rt"><b>${esc(q.t)}</b><small>${esc(q.key[0])}</small></span><span class="rv c${a.sc}"><i></i>${RES[a.sc]}</span></li>`;
        }).join('')}
      </ol>
      <div class="acts">
        <button class="btn ghost" id="retry">${D.live ? 'もう一度' : '別の問題で'}</button>
        ${nx ? `<button class="btn" id="nextLv">${esc(nx === CLUB ? nx.title : nx.short)}へ${icon('next')}</button>` : ''}
        <button class="btn ghost" id="toHome">ホームへ</button>
      </div>
    </div>`;
    phrase(app);
  }

  // 遊び始める: 問題を選び（直近に出たものを避け、場面がばらけるように）、選択肢を並べ替える
  function start(D) {
    if (!D || !D.q.length) return home();
    S.deck = D; S.qi = 0; S.ans = [];
    S.qs = TM.pick(D.q, TM.SESSION, REC.includes(D) ? loadHist()[D.id] : []).map(q => TM.prep(q));
    question();
  }
  const deckOf = id => (id === 'live' ? liveDeck() : REC.find(D => D.id === id));

  /* ---------- 記録の引っこし（自己ベストをファイルかコードで持ち出す・読み込む） ----------
     自己ベストは localStorage なので、URL（オリジン）が変わる・ホーム画面のアプリと Safari・別の端末では引き継がれない。
     コード: `SENJUTSU1:basic=10,coach=6:xxxx`（末尾4文字は確認用。欠け・書き換えを見つける）。ファイルはこのコードを入れた .txt。
     読み込んだ記録は信用しない（cleanBest を通す）。今の記録より高いレベルだけを更新するので、読み込みで記録が下がることはない。 */
  const CODE_V = 'SENJUTSU1';
  const MOVE_FILE = 'senjutsu-master-kiroku.txt';
  const MOVE_MAX = 4096; // これより大きいファイル・文字は戦術マスターのものではない
  const check = s => { // FNV-1a（32bit）を 36 進4文字に
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return (h % 1679616).toString(36).padStart(4, '0');
  };
  const makeCode = best => {
    const body = REC.filter(D => best[D.id] != null).map(D => `${D.id}=${best[D.id]}`).join(',');
    return `${CODE_V}:${body}:${check(`${CODE_V}:${body}`)}`;
  };
  function readCode(text) {
    const raw = String(text || '');
    if (raw.length > MOVE_MAX) return { reason: 'big' };
    const t = raw.normalize('NFKC').replace(/[\s\u200B-\u200D\u2060\uFEFF]+/g, '');
    if (!t) return { reason: 'empty' };
    const m = t.match(/SENJUTSU1:([a-z0-9=,]*):([0-9a-z]{4})/i);
    if (!m) return { reason: /SENJUTSU1/i.test(t) ? 'broken' : 'noprefix' };
    const body = m[1].toLowerCase();
    if (check(`${CODE_V}:${body}`) !== m[2].toLowerCase()) return { reason: 'broken' };
    const o = {};
    for (const part of body.split(',').filter(Boolean)) {
      const kv = part.split('=');
      if (kv.length !== 2 || !/^[a-z]+$/.test(kv[0]) || !/^\d{1,3}$/.test(kv[1])) return { reason: 'broken' };
      o[kv[0]] = Number(kv[1]);
    }
    const best = cleanBest(o);
    return Object.keys(best).length ? { best } : { reason: 'nodata' };
  }
  const MOVE_ERR = {
    empty: 'コードが空です。貼り付けてから「読み込む」を押してください。',
    noprefix: '「SENJUTSU1」で始まるコードが見つかりませんでした。戦術マスターで作ったファイルかコードか、確かめてください。',
    broken: 'コードの一部が欠けているか、変わっています。もう一度コピーし直すか、ファイルで移してください。',
    big: '大きすぎて読めませんでした。戦術マスターで保存したファイルを選んでください。',
    nodata: '読み込める記録が入っていませんでした。'
  };
  const bestLine = best => REC.map(D => `${mvName(D)} ${best[D.id] == null ? '—' : best[D.id]}/${maxOf(D)}`).join('・');

  async function saveFile(text) {
    // アーティファクトではホストの保存確認（downloads）、ホーム画面のアプリ・Safari では共有シート（「ファイル」に保存）、どちらもなければ通常のダウンロード
    const cl = window.claude && typeof window.claude.use === 'function' ? window.claude : null;
    if (cl) {
      const dl = await cl.use('downloads').catch(() => null);
      if (dl) {
        try { await dl.save({ filename: MOVE_FILE, data: text }); return 'saved'; }
        catch (e) { return e && e.code === 'declined' ? 'declined' : 'unavailable'; }
      }
    }
    try {
      const file = new File([text], MOVE_FILE, { type: 'text/plain' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: '戦術マスターの記録' }); return 'shared'; }
    } catch (e) { if (e && e.name === 'AbortError') return 'declined'; }
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const a = document.createElement('a'); a.href = url; a.download = MOVE_FILE;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return 'saved';
    } catch (e) { return 'unavailable'; }
  }
  async function copyCode(el) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(el.value); return 'copied'; } } catch (e) { /* 次の方法へ */ }
    try { el.focus(); el.select(); el.setSelectionRange(0, el.value.length); if (document.execCommand && document.execCommand('copy')) return 'copied'; } catch (e) { /* 次の方法へ */ }
    return 'selected';
  }

  let moveReturn = null;
  function openMove() {
    const best = loadBest(), has = Object.keys(best).length > 0, code = makeCode(best);
    moveReturn = document.activeElement;
    app.insertAdjacentHTML('beforeend', `
    <div class="sheet-bg" id="mv">
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="mvT">
        <div class="sheet-head"><h2 id="mvT">記録の引っこし</h2><button class="link sheet-x" id="mvClose" aria-label="閉じる">${icon('close')}</button></div>
        <p class="sheet-sub">自己ベストは、いま開いているアプリの中だけに保存されています（ホーム画面のアプリと Safari も別）。別の端末や新しい URL へは、ファイルかコードで移せます。</p>
        <p class="mv-now" id="mvNow">いまの記録　${esc(bestLine(best))}</p>
        <h3 class="sheet-h">持っていく</h3>
        <div class="mv-row"><button class="btn" id="mvSave"${has ? '' : ' disabled'}>ファイルに保存</button><button class="btn ghost" id="mvCopy"${has ? '' : ' disabled'}>コードをコピー</button></div>
        <textarea class="mv-code mv-out" id="mvOut" rows="2" readonly placeholder="まだ記録がありません" aria-label="記録のコード" autocomplete="off" spellcheck="false">${has ? esc(code) : ''}</textarea>
        <h3 class="sheet-h">受け取る</h3>
        <div class="mv-row"><label class="btn ghost mv-file">ファイルを選ぶ<input type="file" id="mvFile" accept=".txt,text/plain"></label></div>
        <div class="mv-row"><input class="mv-code" id="mvIn" maxlength="${MOVE_MAX}" placeholder="コードを貼り付け" aria-label="受け取るコード" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false"><button class="btn ghost" id="mvTake">読み込む</button></div>
        <p class="mv-msg" id="mvMsg" role="status" aria-live="polite">読み込んだ記録は、いまより高いレベルだけを更新します。</p>
      </section>
    </div>`);
    const sh = document.getElementById('mv');
    phrase(sh);
    const msg = t => { const m = sh.querySelector('#mvMsg'); m.textContent = t; phrase(m); };
    sh.querySelector('#mvClose').addEventListener('click', closeMove);
    sh.addEventListener('click', e => { if (e.target === sh) closeMove(); });
    sh.querySelector('#mvSave').addEventListener('click', async () => {
      const text = `戦術マスターの記録（自己ベスト）\n戦術マスターのホームの「記録の引っこし」→「ファイルを選ぶ」でこのファイルを選ぶと、記録を移せます。\n${makeCode(loadBest())}\n`;
      const r = await saveFile(text);
      msg(r === 'shared' ? `共有メニューで「"ファイル"に保存」を選ぶと、${MOVE_FILE} として残ります。`
        : r === 'saved' ? `${MOVE_FILE} を保存しました。移す先で「ファイルを選ぶ」から選んでください。`
          : r === 'declined' ? '保存をやめました。'
            : 'ここではファイルを保存できませんでした。「コードをコピー」を使ってください。');
    });
    sh.querySelector('#mvCopy').addEventListener('click', async () => {
      const r = await copyCode(sh.querySelector('#mvOut'));
      msg(r === 'copied' ? 'コードをコピーしました。移す先で貼り付けて「読み込む」を押してください。'
        : 'コードを選びました。出てきたメニューの「コピー」を押してください。');
    });
    const take = text => {
      const r = readCode(text);
      if (!r.best) return msg(MOVE_ERR[r.reason]);
      const now = loadBest(), up = [];
      REC.forEach(D => {
        const v = r.best[D.id];
        if (v != null && (now[D.id] == null || v > now[D.id])) { up.push(`${mvName(D)} ${now[D.id] == null ? '—' : now[D.id]}→${v}`); now[D.id] = v; }
      });
      if (!up.length) return msg('読み込んだ記録は、いまの記録と同じか低いので、変わりませんでした。');
      saveBest(now);
      const nb = sh.querySelector('#mvNow'); nb.textContent = `いまの記録　${bestLine(now)}`; phrase(nb);
      msg(`記録を移しました（${up.join('、')}）。`);
    };
    sh.querySelector('#mvTake').addEventListener('click', () => take(sh.querySelector('#mvIn').value));
    sh.querySelector('#mvFile').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0]; e.target.value = '';
      if (!file) return;
      if (file.size > MOVE_MAX) return msg(MOVE_ERR.big);
      try { take(await file.text()); } catch (err) { msg(MOVE_ERR.noprefix); }
    });
    sh.querySelector(has ? '#mvSave' : '#mvFile').focus();
  }
  function closeMove() {
    const sh = document.getElementById('mv'); if (!sh) return;
    sh.remove();
    if (S.screen === 'home') { home(); const b = document.getElementById('moveOpen'); if (b) b.focus(); }
    else if (moveReturn && moveReturn.isConnected) moveReturn.focus();
  }

  /* ---------- イベント ---------- */
  app.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('#moveOpen')) return openMove();
    if (t.closest('#mv')) return; // 引っこしの画面の中のボタンは、それぞれのリスナーで扱う
    const st = t.closest('[data-start]'); if (st) return start(deckOf(st.dataset.start));
    const op = t.closest('.opt'); if (op) return choose(op.dataset.k);
    const og = t.closest('#pitch .og'); if (og && !S.done) return choose(og.dataset.k);
    const tb = t.closest('.tab'); if (tb) return setTab(tb.dataset.tab);
    const btn = t.closest('button'); const id = btn ? btn.id : '';
    if (id === 'back' || id === 'toHome') return home();
    if (id === 'next') return next();
    if (id === 'replay') return play(cur());
    if (id === 'retry') return start(S.deck.live ? liveDeck() || S.deck : S.deck);
    if (id === 'nextLv') return start(nextDeck(S.deck));
    if (id === 'hintBtn') {
      const h = document.getElementById('hint'); h.hidden = !h.hidden;
      btn.setAttribute('aria-pressed', String(!h.hidden));
    }
  });
  document.addEventListener('keydown', e => {
    const sh = document.getElementById('mv');
    if (sh) { // 引っこしの画面: Esc で閉じる、Tab は画面の中だけを回る
      if (e.key === 'Escape') { e.preventDefault(); closeMove(); return; }
      if (e.key === 'Tab') {
        const els = [...sh.querySelectorAll('button:not([disabled]), input')];
        const i = els.indexOf(document.activeElement);
        if (e.shiftKey ? i <= 0 : i === els.length - 1) { e.preventDefault(); els[e.shiftKey ? els.length - 1 : 0].focus(); }
      }
      return;
    }
    if (S.screen !== 'play' || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toUpperCase();
    if (!S.done && ['A', 'B', 'C'].includes(k)) choose(k);
    else if (S.done && (e.key === 'ArrowRight')) next();
  });
  addEventListener('resize', () => {
    const p = document.getElementById('panel');
    if (p && matchMedia(TWO_COL).matches) p.style.height = '';
  });

  home();
})();
