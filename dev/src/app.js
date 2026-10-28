(() => {
  'use strict';
  const LV = window.LEVELS;
  const app = document.getElementById('app');
  const PH = { atk: '攻撃', def: '守備', tr: '切り替え', coach: '指導場面' };
  const RES = ['要注意', '悪くない', 'ベスト'];
  const VERDICT = ['ここは要注意', '悪くない選択', 'ベスト！'];
  const BO = [1.35, -1.15]; // ボールは選手の足元に少しずらして置く
  const KEY = 'tacdrill-best-v1';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const S = { lv: 0, qi: 0, ans: [], done: false, hint: false, timers: [], screen: 'home' };

  const f = n => Math.round(n * 100) / 100;
  const maxOf = L => L.q.length * 2;
  const cur = () => LV[S.lv].q[S.qi];
  const loadBest = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const saveBest = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* 保存できない環境では無視 */ } };
  const total = () => S.ans.reduce((a, x) => a + (x ? x.sc : 0), 0);

  /* ---------- ピッチ描画 ---------- */
  function field() {
    let g = '<rect class="grass" x="-8" y="-8" width="84" height="121"/>';
    for (let i = 0; i < 14; i++) if (i % 2) g += `<rect class="mow" x="-8" y="${i * 7.5}" width="84" height="7.5"/>`;
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
    g += `<g class="bdg" transform="translate(${f(at[0])} ${f(at[1])})"><circle class="hit" r="3.4"/><circle r="1.75"/><text y=".7">${o.k}</text></g>`;
    return `<g class="og" data-k="${o.k}">${g}</g>`;
  }

  function players(s) {
    let g = '';
    const add = (t, [n, x, y]) => {
      const id = t + n, me = s.me === id;
      g += `<g class="pl t-${t}${n === 1 ? ' gk' : ''}${me ? ' me' : ''}" data-id="${id}" style="transform:translate(${x}px,${y}px)">` +
        (me ? '<circle class="me-ring" r="3.2"/>' : '') +
        `<circle class="mag" r="2"/><circle class="shine" cx="-.55" cy="-.7" r=".75"/><text class="num" y=".74">${n}</text>` +
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

  /* ---------- 画面: ホーム ---------- */
  const TWO_COL = '(min-width: 720px) and (min-aspect-ratio: 5/4)';
  function pips(n) { return [0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join(''); }

  function home() {
    S.screen = 'home'; clearTimers();
    const best = loadBest();
    app.innerHTML = `
    <div class="screen home">
      <div class="h-side">
        <header class="h-top">
          <p class="eyebrow">TACTICS BOARD · 105 × 68 m</p>
          <h1>サッカー戦術ドリル</h1>
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
        <p class="foot">味方はいつも上へ攻めます。採点はベスト2点・悪くない1点・要注意0点。</p>
      </div>
      <nav class="levels" aria-label="レベルを選ぶ">
        ${LV.map((L, i) => {
          const b = best[L.id];
          return `<button class="lv" data-start="${i}">
            <span class="lv-no">Lv.${L.no}<span class="pips" aria-hidden="true">${pips(L.no)}</span></span>
            <span class="lv-main"><b><em>${L.name}</em>${L.title}</b><small>${L.who} · ${L.feat}</small><small class="tp">${L.q.map(q => q.key[0].replace(/（.*?）/, '')).join('・')}</small></span>
            <span class="lv-best"><small>最高</small><b>${b == null ? '—' : b}</b><small>/${maxOf(L)}</small></span>
          </button>`;
        }).join('')}
      </nav>
    </div>`;
  }

  /* ---------- 画面: 問題 ---------- */
  function dots() {
    return LV[S.lv].q.map((_, i) => {
      const a = S.ans[i];
      return `<li class="${a ? 'r' + a.sc : (i === S.qi ? 'now' : '')}"></li>`;
    }).join('');
  }

  function question() {
    S.screen = 'play'; S.done = false; S.tab = 'why'; clearTimers();
    const L = LV[S.lv], s = cur(), v = s.view;
    app.innerHTML = `
    <div class="screen play">
      <nav class="bar">
        <button class="link back" id="back" aria-label="レベル選択へ戻る">←</button>
        <span class="bar-lv">Lv.${L.no} ${L.name}</span>
        <ol class="dots" aria-hidden="true">${dots()}</ol>
        <span class="bar-q">${S.qi + 1}<small>/${L.q.length}</small></span>
        <span class="bar-pt"><b id="pt">${total()}</b>点</span>
      </nav>
      <div class="stage">
        <div class="board-area">
          <div class="board" id="board" style="--ar:${f(v[2] / v[3])}">${pitchSVG(s)}
            <span class="dir">攻撃 ↑</span>
            <span class="stamp" id="stamp" hidden></span>
            ${s.hint ? `<p class="hint-cap" id="hint" hidden>ヒント：${s.hint}</p>` : ''}
          </div>
        </div>
        <section class="panel" id="panel">
          <div class="qhead">
            <span class="phase ph-${s.ph}">${PH[s.ph]}</span>
            <h2 class="qt">${s.t}</h2>
            ${s.hint ? '<button class="hint-btn" id="hintBtn" aria-pressed="false">ヒント</button>' : ''}
          </div>
          <p class="sit">${s.s}</p>
          <p class="qq">${s.q}</p>
          <div class="opts" role="group" aria-label="選択肢">
            ${s.opts.map(o => `<button class="opt" data-k="${o.k}"><span class="k">${o.k}</span><span class="l">${o.l}</span></button>`).join('')}
          </div>
        </section>
      </div>
    </div>`;
  }

  function tabList(s, o, best) {
    const T = [['why', '理由'], ['ex', '解説'], ['key', '用語']];
    if (s.coach) T.push(['coach', '指導'], ['drill', '練習']);
    if (s.opts.some(x => x.k !== o.k && x.k !== best.k)) T.push(['rest', 'ほかの選択肢']);
    return T;
  }

  function tabBody(id) {
    const s = cur(), a = S.ans[S.qi];
    const o = s.opts.find(x => x.k === a.k);
    const best = s.opts.reduce((p, q) => (q.sc > p.sc ? q : p));
    const line = (x, tag) => `<p class="oline c${x.sc}"><span class="k k${x.sc}">${x.k}</span><span>${tag}${x.l}</span></p><p>${x.why}</p>`;
    switch (id) {
      case 'why':
        return line(o, 'あなたの選択：') + (o.k !== best.k ? line(best, 'ベスト：') : '');
      case 'ex': return `<p>${s.ex}</p>`;
      case 'key': return `<p class="term"><b class="hl">${s.key[0]}</b></p><p>${s.key[1]}</p>`;
      case 'coach': return `<p>${s.coach}</p>`;
      case 'drill': return `<p>${s.drill}</p>`;
      case 'rest': return s.opts.filter(x => x.k !== o.k && x.k !== best.k).map(x => line(x, `${RES[x.sc]}：`)).join('');
    }
    return '';
  }

  function setTab(id) {
    S.tab = id;
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
    const b = document.getElementById('tabbody');
    b.innerHTML = tabBody(id); b.scrollTop = 0;
  }

  function choose(k) {
    if (S.done) return;
    const s = cur(), L = LV[S.lv];
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
    stamp.className = 'stamp v' + o.sc; stamp.textContent = `${k} · ${VERDICT[o.sc]} +${o.sc}点`; stamp.hidden = false;
    const hint = document.getElementById('hint'); if (hint) hint.hidden = true;
    document.getElementById('pt').textContent = total();
    document.querySelector('.dots').innerHTML = dots();

    // 縦並びのときは、パネルの高さを固定してボードの大きさが変わらないようにする
    const panel = document.getElementById('panel');
    if (!matchMedia(TWO_COL).matches) {
      const room = document.querySelector('.stage').clientHeight;
      panel.style.height = Math.round(Math.max(panel.offsetHeight, Math.min(350, room * 0.55))) + 'px';
    }
    const last = S.qi === L.q.length - 1;
    panel.classList.add('is-fb');
    panel.innerHTML = `
      <div class="tabs" role="tablist">${tabList(s, o, best).map(([id, n]) => `<button class="tab" role="tab" data-tab="${id}" aria-selected="${id === 'why'}">${n}</button>`).join('')}</div>
      <div class="tabbody" id="tabbody" role="tabpanel">${tabBody('why')}</div>
      <div class="acts">
        <button class="btn ghost" id="replay" aria-label="動きをもう一度再生">↻ 動き</button>
        <button class="btn" id="next">${last ? '結果を見る' : '次の問題へ'} →</button>
      </div>`;
    play(s);
  }

  function next() {
    const L = LV[S.lv];
    if (S.qi < L.q.length - 1) { S.qi++; question(); } else result();
  }

  /* ---------- 画面: 結果 ---------- */
  function result() {
    S.screen = 'result'; clearTimers();
    const L = LV[S.lv], sc = total(), mx = maxOf(L), pct = sc / mx;
    const best = loadBest(); const prev = best[L.id];
    const isNew = prev == null || sc > prev;
    if (isNew) { best[L.id] = sc; saveBest(best); }
    const msg = pct >= 0.85
      ? (S.lv === 2 ? '構造と言葉の両方で説明できるレベルです。' : '戦術眼あり。次のレベルへ進みましょう。')
      : pct >= 0.6 ? '原則はつかめています。「要注意」の問題を見直すとさらに伸びます。'
        : '原則をひとつずつ。解説を読んで、もう一度挑戦してみましょう。';
    app.innerHTML = `
    <div class="screen result">
      <div class="r-head">
        <p class="eyebrow">Lv.${L.no} ${L.name} · ${L.title}</p>
        <div class="score"><b>${sc}</b><span>/ ${mx}</span>${isNew ? '<em>自己ベスト</em>' : ''}</div>
        <p class="msg">${msg}</p>
      </div>
      <ol class="rlist">
        ${L.q.map((q, i) => {
          const a = S.ans[i] || { sc: 0 };
          return `<li><span class="chip c${a.sc}">${RES[a.sc]}</span><span class="rt"><b>${q.t}</b><small>${q.key[0]}</small></span></li>`;
        }).join('')}
      </ol>
      <div class="acts">
        <button class="btn ghost" id="retry">もう一度</button>
        ${S.lv < LV.length - 1 ? `<button class="btn" id="nextLv">Lv.${L.no + 1} ${LV[S.lv + 1].name}へ →</button>` : ''}
        <button class="btn ghost" id="toHome">レベル選択</button>
      </div>
    </div>`;
  }

  function start(i) { S.lv = i; S.qi = 0; S.ans = []; question(); }

  /* ---------- イベント ---------- */
  app.addEventListener('click', e => {
    const t = e.target;
    const st = t.closest('[data-start]'); if (st) return start(+st.dataset.start);
    const op = t.closest('.opt'); if (op) return choose(op.dataset.k);
    const og = t.closest('#pitch .og'); if (og && !S.done) return choose(og.dataset.k);
    const tb = t.closest('.tab'); if (tb) return setTab(tb.dataset.tab);
    const btn = t.closest('button'); const id = btn ? btn.id : '';
    if (id === 'back' || id === 'toHome') return home();
    if (id === 'next') return next();
    if (id === 'replay') return play(cur());
    if (id === 'retry') return start(S.lv);
    if (id === 'nextLv') return start(S.lv + 1);
    if (id === 'hintBtn') {
      const h = document.getElementById('hint'); h.hidden = !h.hidden;
      btn.setAttribute('aria-pressed', String(!h.hidden));
    }
  });
  document.addEventListener('keydown', e => {
    if (S.screen !== 'play' || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toUpperCase();
    if (!S.done && ['A', 'B', 'C'].includes(k)) choose(k);
    else if (S.done && (e.key === 'ArrowRight')) next();
  });
  addEventListener('resize', () => {
    const p = document.querySelector('.panel.is-fb');
    if (p && matchMedia(TWO_COL).matches) p.style.height = '';
  });

  home();
})();
