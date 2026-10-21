// 權證挑選器 手機版：讀電腦版上傳的收盤資料（data/），在手機上依篩選條件挑權證。
// 指標在電腦版算好；這裡只做篩選、排序、檢查清單（規則與電腦版 app/analysis.py 相同）。
'use strict';

// 篩選條件的項目與選項來自 meta.json 的 filter_spec（＝電腦版 analysis.FILTER_SPEC）
let SPEC = [];
let SPEC_BY = {};
const PAGE = 150;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fx = (v, n = 2) => (v == null ? '—' : Number(v).toFixed(n));
const sgn = (v, n = 1) => (v == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(n));
const price = (v) => (v == null ? '—' : v < 50 ? v.toFixed(2) : v < 500 ? v.toFixed(1) : v.toFixed(0));
const ratio = (v) => String(+Number(v).toFixed(4));
const mnyText = (m) => (m == null ? '—' : m >= 0 ? `價內 ${m.toFixed(1)}%` : `價外 ${(-m).toFixed(1)}%`);
const mnyCls = (m) => (m == null ? '' : m >= 0 ? 'itm' : 'otm');

const store = {
  get(k, d) { try { const v = localStorage.getItem('wp.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('wp.' + k, JSON.stringify(v)); } catch (e) { /* 無痕模式 */ } },
};

const S = {
  meta: null, und: null, rows: [], cp: store.get('cp', 'C'), only: store.get('only', true),
  sort: store.get('sort', 'dl'), filters: null, shown: PAGE, peer: null,
};

function defaultFilters() {
  const f = {};
  for (const s of SPEC) f[s.key] = s.kind === 'range' ? s.default.slice() : s.default;
  return f;
}

function loadFilters() {
  // 存的值不在選項裡（例如選項改過）就用預設
  const saved = store.get('filters2', {});
  const f = defaultFilters();
  for (const s of SPEC) {
    const v = saved[s.key];
    const ok = new Set(s.options.map((o) => o[1]));
    if (s.kind === 'range') { if (Array.isArray(v) && v.length === 2 && v.every((x) => ok.has(x))) f[s.key] = v.slice(); }
    else if (s.key === 'issuer') { if (typeof v === 'string') f[s.key] = v; }
    else if (ok.has(v)) f[s.key] = v;
  }
  return f;
}

const optLabel = (key, val) => (SPEC_BY[key].options.find((o) => o[1] === val) || [val])[0];
const inBin = (x, val) => { const [lo, hi] = val.split(','); return x >= +lo && (!hi || x < +hi); };
const inRange = (x, [lo, hi]) => (lo === '' || x >= +lo) && (hi === '' || x <= +hi);
const rangeText = (key, [lo, hi]) => `${lo ? optLabel(key, lo) : '不限'} ～ ${hi ? optLabel(key, hi) : '不限'}`;
const isOff = (v) => (Array.isArray(v) ? v[0] === '' && v[1] === '' : v === '');

// ---------- 判斷（與電腦版相同） ----------
function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function evaluate(r, f, peer) {
  // 與電腦版 analysis.evaluate 相同：缺報價的項目算不通過，隱波相對比較兩項缺資料不擋
  const ch = [];
  const add = (t, ok, txt) => ch.push([t, ok, txt]);
  const cpName = r.cp === 'C' ? '認購' : '認售';
  if (f.issuer) {
    const ok = r.issuer === f.issuer;
    add('發行商', ok, (r.issuer || '未知') + (ok ? '' : `，不是你選的發行商（${f.issuer}）`));
  }
  if (f.dl) {
    const lim = f.dl === 'std' ? (r.cp === 'C' ? 0.3 : 0.5) : +f.dl;
    if (r.dl == null) add('差槓比', false, '缺買價或賣價，算不出來（可能沒有造市報價）');
    else {
      const ok = r.dl <= lim;
      add('差槓比', ok, `${r.dl.toFixed(2)}，${ok ? '低於' : '高於'}${f.dl === 'std' ? cpName + '標準 ' : ''}${lim}`
        + (ok ? '：買賣價差相對槓桿小，進出成本低' : '：一買一賣的價差成本偏高'));
    }
  }
  if (!isOff(f.mny)) {
    if (r.mny == null) add('價內外', false, '沒有標的價');
    else {
      const ok = inRange(r.mny, f.mny);
      const tooOtm = f.mny[0] !== '' && r.mny < +f.mny[0];
      const tail = ok ? '' : (tooOtm ? '，太價外：股價要動很多才有價值' : '，太價內：權證貴、槓桿小');
      add('價內外', ok, `${mnyText(r.mny)}（範圍：${rangeText('mny', f.mny)}）${tail}`);
    }
  }
  if (!isOff(f.days)) {
    const short = f.days[0] !== '' && r.days < +f.days[0];
    add('剩餘天數', inRange(r.days, f.days), `剩 ${r.days} 天（範圍：${rangeText('days', f.days)}）`
      + (short ? '：越接近到期時間價值掉越快' : ''));
  }
  const binCheck = (key, title, x, text) => {
    if (!f[key]) return;
    if (x == null) add(title, false, '缺買價或賣價，算不出來');
    else add(title, inBin(x, f[key]), `${text}（範圍 ${optLabel(key, f[key])}）`);
  };
  binCheck('lev', '實質槓桿', r.lev, r.lev == null ? '' : `${r.lev.toFixed(2)} 倍`);
  binCheck('spread', '買賣價差比', r.spread, r.spread == null ? '' : `${r.spread.toFixed(2)}%`);
  binCheck('ratio', '行使比例', r.ratio, ratio(r.ratio));
  binCheck('vol', '成交量', r.vol, `${r.vol.toLocaleString()} 張`);
  if (!isOff(f.iv)) {
    if (r.iva == null) add('賣價隱波', false, '算不出隱波（可能沒有賣價）');
    else add('賣價隱波', inRange(r.iva, f.iv), `${r.iva.toFixed(1)}%（範圍：${rangeText('iv', f.iv)}）`);
  }
  if (f.ivover) {
    if (r.iva == null || peer == null) add('隱波高低', null, '同標的可比較的權證不夠，或算不出隱波');
    else {
      const diff = r.iva - peer;
      const ok = diff <= +f.ivover;
      add('隱波高低', ok, `賣價隱波 ${r.iva.toFixed(1)}%，同標的中位數 ${peer.toFixed(1)}%`
        + (ok ? '' : `，貴了 ${diff.toFixed(1)} 個百分點`));
    }
  }
  if (f.ivchg) {
    if (r.ivrel == null) add('隱波穩定', null, '收盤紀錄還不夠或同標的可比較的權證太少');
    else {
      const ok = r.ivrel >= -f.ivchg;
      add('隱波穩定', ok, `近期買價隱波 ${sgn(r.ivchg)} 點，比同標的 ${sgn(r.ivrel)} 點`
        + (ok ? '' : '：發行商可能在調降隱波，抱著會吃虧'));
    }
  }
  if (f.ticks) {
    if (r.ticks == null) add('價差檔數', false, '缺買價或賣價');
    else add('價差檔數', r.ticks <= +f.ticks, `買賣差 ${r.ticks} 檔（上限 ${f.ticks} 檔）`);
  }
  r.checks = ch;
  r.nCheck = ch.length;
  r.nPass = ch.filter((c) => c[1]).length;
  r.passed = !ch.some((c) => c[1] === false);
}

function issuerTag(st) {
  if (st.n < 30) return '樣本少';
  if (st.rel <= -1.0 || st.cut >= 0.25) return '常調降';
  if (st.rel >= -0.2 && st.cut <= 0.10) return '穩定';
  return '普通';
}
const fmtPts = (v) => (Math.abs(v) < 0.005 ? '0.00' : (v >= 0 ? '+' : '') + v.toFixed(2));

// ---------- 資料 ----------
async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

async function init() {
  bindUI();
  try {
    S.meta = await getJSON('data/meta.json');
  } catch (e) {
    $('date').textContent = '資料載入失敗';
    $('list').innerHTML = '<div class="empty">還沒有資料，請先在電腦版開啟程式上傳一次。</div>';
    return;
  }
  SPEC = S.meta.filter_spec || [];
  SPEC_BY = Object.fromEntries(SPEC.map((s) => [s.key, s]));
  S.filters = loadFilters();
  const d = S.meta.date.slice(5).replace('-', '/');
  const g = S.meta.generated.replace('T', ' ').slice(5).replace('-', '/');
  $('date').innerHTML = `${esc(d)} 收盤資料<br>更新 ${esc(g)}`;
  setCP(S.cp, false);
  openFromHash(decodeURIComponent(location.hash.slice(1)) || store.get('last', ''));
  // 網址 #2330C（代號＋C/P）可以直接開某檔，加到書籤或分享都行
  window.addEventListener('hashchange', () => openFromHash(decodeURIComponent(location.hash.slice(1))));
}

function openFromHash(text) {
  if (!text) return;
  const m = /^(.+?)([CP])?$/.exec(text);
  if (m && m[2]) setCP(m[2], false);
  const u = findUnd(m ? m[1] : text);
  if (u && !(S.und && S.und.code === u[0])) pick(u[0]);
  else if (S.und) buildRows();
}

function findUnd(text) {
  const t = text.trim();
  if (!t) return null;
  const head = t.split(/\s+/)[0];
  const us = S.meta.unds;
  return us.find((u) => u[0] === head) || us.find((u) => u[1] === t || u[1] === head)
    || (() => { const h = us.filter((u) => u[1].includes(t)); return h.length === 1 ? h[0] : null; })();
}

function suggest(text) {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  return S.meta.unds.filter((u) => u[0].toLowerCase().startsWith(t) || u[1].toLowerCase().includes(t)).slice(0, 8);
}

async function pick(code) {
  const u = S.meta.unds.find((x) => x[0] === code);
  if (!u) return;
  $('q').value = `${u[0]} ${u[1]}`;
  $('sugg').hidden = true;
  $('q').blur();
  $('list').innerHTML = '<div class="empty">載入中…</div>';
  try {
    S.und = await getJSON(`data/u/${encodeURIComponent(code)}.json`);
  } catch (e) {
    $('list').innerHTML = '<div class="empty">這檔的資料載入失敗，請稍後再試。</div>';
    return;
  }
  store.set('last', code + S.cp);
  history.replaceState(null, '', '#' + code + S.cp);
  buildRows();
}

function buildRows() {
  if (!S.und) return;
  const F = S.meta.fields;
  const idx = Object.fromEntries(F.map((f, i) => [f, i]));
  S.rows = S.und.rows.filter((a) => a[idx.cp] === S.cp).map((a) => {
    const r = {};
    for (const f of F) r[f] = a[idx[f]];
    return r;
  });
  const ivs = S.rows.filter((r) => r.iva != null && r.days >= 30).map((r) => r.iva);
  S.peer = ivs.length >= 3 ? median(ivs) : null;
  S.shown = PAGE;
  evaluateAll();
}

function evaluateAll() {
  for (const r of S.rows) evaluate(r, S.filters, S.peer);
  render();
}

// ---------- 畫面 ----------
const SORTS = {
  dl: [(r) => r.dl, 1], lev: [(r) => r.lev, -1], mny: [(r) => r.mny, -1], days: [(r) => r.days, -1],
  iva: [(r) => r.iva, 1], vol: [(r) => r.vol, -1],
};

function render() {
  const u = S.und;
  $('welcome').hidden = !!u;
  $('und').hidden = !u;
  $('bar').hidden = !u;
  if (!u) return;
  $('undName').textContent = `${u.code} ${u.name}`;
  $('undPrice').textContent = price(u.S);
  if (u.S && u.prev) {
    const d = u.S - u.prev;
    const pct = (d / u.prev) * 100;
    $('undChg').className = d > 0 ? 'up' : d < 0 ? 'down' : 'muted';
    $('undChg').textContent = `${d > 0 ? '▲' : d < 0 ? '▼' : ''}${Math.abs(d).toFixed(2)}（${sgn(pct, 2)}%）`;
  } else {
    $('undChg').textContent = '';
  }
  const nPass = S.rows.filter((r) => r.passed).length;
  let cnt = `${S.cp === 'C' ? '認購' : '認售'} ${S.rows.length.toLocaleString()} 檔，符合條件 ${nPass} 檔`;
  $('counts').textContent = cnt;

  const [key, dir] = SORTS[S.sort] || SORTS.dl;
  let list = S.only ? S.rows.filter((r) => r.passed) : S.rows.slice();
  list.sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? -1 : 1;
    const x = key(a), y = key(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir;
  });
  S.list = list;
  if (!list.length) {
    $('list').innerHTML = `<div class="empty">${S.rows.length ? '沒有權證通過全部條件。<br>可以取消「只顯示符合」看全部，或按「篩選條件」放寬。'
      : `${esc(u.name)} 沒有${S.cp === 'C' ? '認購' : '認售'}權證。`}</div>`;
    $('more').innerHTML = '';
    return;
  }
  $('list').innerHTML = list.slice(0, S.shown).map(cardHTML).join('');
  $('more').innerHTML = list.length > S.shown
    ? `<button type="button" id="moreBtn">再顯示 ${Math.min(PAGE, list.length - S.shown)} 檔（共 ${list.length} 檔）</button>` : '';
}

function cardHTML(r, i) {
  const mark = r.passed ? '✔' : `${r.nPass}/${r.nCheck}`;
  return `<div class="card ${r.passed ? 'ok' : 'no'}" data-i="${i}">
  <div class="c1"><span class="mark">${mark}</span><span class="code">${esc(r.code)}</span>
    <span class="nm">${esc(r.name)}</span><span class="iss">${esc(r.issuer)}</span></div>
  <div class="grid">
    <div><i>買／賣</i>${fx(r.bid)}／${fx(r.ask)}</div>
    <div><i>差槓比</i><span class="${r.passed ? 'strong' : ''}">${fx(r.dl)}</span></div>
    <div><i>實質槓桿</i>${fx(r.lev)}</div>
    <div><i>價內外</i><span class="${mnyCls(r.mny)}">${mnyText(r.mny)}</span></div>
    <div><i>剩餘天數</i>${r.days} 天</div>
    <div><i>賣價隱波</i>${r.iva == null ? '—' : fx(r.iva, 1) + '%'}</div>
  </div></div>`;
}

function spark(hist, days) {
  const pts = hist.map((v, i) => [i, v]).filter((p) => p[1] != null);
  if (pts.length < 2) return '<p class="muted">收盤紀錄還不夠。</p>';
  const W = 320, H = 90, L = 34, R = 8, T = 10, B = 20;
  const vs = pts.map((p) => p[1]);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const x = (i) => L + (i / (hist.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const lastP = pts[pts.length - 1];
  const md = (s) => s.slice(5).replace('-', '/');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="買價隱波走勢">
    <line x1="${L}" x2="${W - R}" y1="${y(hi)}" y2="${y(hi)}" stroke="var(--line)"/>
    <line x1="${L}" x2="${W - R}" y1="${y(lo)}" y2="${y(lo)}" stroke="var(--line)"/>
    <text x="0" y="${y(hi) + 4}">${hi.toFixed(1)}</text><text x="0" y="${y(lo) + 4}">${lo.toFixed(1)}</text>
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(lastP[0])}" cy="${y(lastP[1])}" r="3" fill="var(--accent)"/>
    <text x="${L}" y="${H - 4}">${md(days[0])}</text><text x="${W - R}" y="${H - 4}" text-anchor="end">${md(days[days.length - 1])}</text>
  </svg>`;
}

function showDetail(r) {
  const cp = r.cp === 'C' ? '認購' : '認售';
  const tags = [cp, r.issuer, r.style, r.market === 'tse' ? '上市' : '上櫃'].filter(Boolean).join(' · ');
  const kv = [
    ['標的收盤', price(S.und.S)], ['履約價', price(r.strike)], ['行使比例', ratio(r.ratio)],
    ['到期日', `${r.expiry}`], ['買價／賣價', `${fx(r.bid)}／${fx(r.ask)}`], ['剩餘天數', `${r.days} 天`],
    ['買價隱波', r.ivb == null ? '—' : fx(r.ivb, 1) + '%'], ['賣價隱波', r.iva == null ? '—' : fx(r.iva, 1) + '%'],
    ['實質槓桿', fx(r.lev)], ['差槓比', fx(r.dl)], ['價差比', r.spread == null ? '—' : fx(r.spread) + '%'],
    ['價內外', `<span class="${mnyCls(r.mny)}">${mnyText(r.mny)}</span>`], ['Delta', fx(r.delta, 3)],
    ['同標的隱波中位數', S.peer == null ? '—' : fx(S.peer, 1) + '%'], ['收盤成交', `${r.vol} 張`],
  ];
  const kvHTML = kv.map(([k, v]) => `<div><i>${esc(k)}</i>${v}</div>`).join('');
  const checks = r.checks.map(([t, ok, txt]) => {
    const [m, c] = ok ? ['✔', 't'] : ok === false ? ['✘', 'f'] : ['－', 'n'];
    return `<li><span class="m ${c}">${m}</span><span><b>${esc(t)}</b>：${esc(txt)}</span></li>`;
  }).join('');
  const st = S.meta.issuers[r.issuer];
  const iss = st ? `${esc(r.issuer)}：旗下 ${st.n} 檔權證的買價隱波，相對同標的變化中位數 ${fmtPts(st.rel)} 點，`
    + `${Math.round(st.cut * 100)}% 的權證被調降超過 2 點（${issuerTag(st)}）` : '收盤紀錄不足，還無法評估這家發行商。';
  const verdict = r.passed ? '全部條件通過 ✔' : `通過 ${r.nPass}/${r.nCheck} 項`;
  openSheet(`${r.code} ${r.name}`, `
    <div class="tags ${r.cp === 'C' ? 'c-call' : 'c-put'}">${esc(tags)}</div>
    <div class="kv">${kvHTML}</div>
    <h4 class="${r.passed ? 'c-call' : ''}">檢查清單：${verdict}</h4>
    <ul class="checks">${checks || '<li>沒有開啟任何條件</li>'}</ul>
    <h4>發行商</h4><p style="margin:0">${iss}</p>
    <h4>近 ${S.meta.hist_days.length} 個交易日收盤買價隱波（%）</h4>
    ${spark(r.hist || [], S.meta.hist_days)}
    <p class="muted" style="font-size:12px">以上依前一個交易日收盤資料計算，僅供參考，不構成投資建議。</p>`);
}

function showFilters() {
  const f = S.filters;
  const sel = (s, value, part) => {
    const opts = s.options.concat(s.key === 'issuer' ? (S.meta.issuer_list || []).map((n) => [n, n]) : []);
    return `<select data-k="${s.key}" data-p="${part}">${opts.map(([label, v]) =>
      `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
  };
  const rows = SPEC.map((s) => `<div class="frow">
    <div class="t">${esc(s.title)}</div>
    <div class="vals">${s.kind === 'range' ? `${sel(s, f[s.key][0], 0)}<span>～</span>${sel(s, f[s.key][1], 1)}` : sel(s, f[s.key], -1)}</div>
    <div class="hint">${esc(s.hint)}</div></div>`).join('');
  openSheet('篩選條件', `<div class="form">${rows}
    <p class="hint" style="margin:0">選「全部／不選」＝不檢查這一項。分級參考元大權證網；流通在外比例、永續標章沒有公開資料，所以沒有放。</p>
    <div class="btns"><button type="button" id="fReset">恢復預設</button><button type="button" class="primary" id="fApply">套用</button></div>
  </div>`);
  const apply = (nf) => {
    S.filters = nf;
    store.set('filters2', nf);
    closeSheet();
    S.shown = PAGE;
    evaluateAll();
  };
  $('fReset').onclick = () => apply(defaultFilters());
  $('fApply').onclick = () => {
    const nf = defaultFilters();
    for (const el of $('sheetBody').querySelectorAll('select[data-k]')) {
      const k = el.dataset.k, p = +el.dataset.p;
      if (p >= 0) nf[k][p] = el.value; else nf[k] = el.value;
    }
    apply(nf);
  };
}

function showIssuers() {
  const info = S.meta.trend || {};
  const order = { '穩定': 0, '普通': 1, '常調降': 2, '樣本少': 3 };
  const items = Object.entries(S.meta.issuers).sort((a, b) =>
    order[issuerTag(a[1])] - order[issuerTag(b[1])] || a[1].cut - b[1].cut || b[1].rel - a[1].rel);
  const cls = { '穩定': 'tag-good', '常調降': 'tag-warn' };
  const rows = items.map(([n, st]) => {
    const tag = issuerTag(st);
    return `<tr><td>${esc(n)}</td><td>${st.n.toLocaleString()}</td><td>${fmtPts(st.rel)}</td><td>${Math.round(st.cut * 100)}%</td>`
      + `<td class="${cls[tag] || 'tag-mid'}">${tag}</td></tr>`;
  }).join('');
  openSheet('發行商隱波穩定度', `<p class="muted" style="margin-top:0">比較 ${esc(info.from || '')} → ${esc(info.to || '')}（${info.days || 0} 個交易日）的收盤買價隱波，`
    + '先扣掉同標的權證的共同變化，再看各發行商的中位數。負很多＝常調降隱波。</p>'
    + `<table class="iss"><tr><th>發行商</th><th>檔數</th><th>相對變化</th><th>調降>2點</th><th>評語</th></tr>${rows}</table>`
    + '<p class="muted" style="font-size:12px">穩定＝中位數 ≥ −0.2 且調降比例 ≤ 10%；常調降＝中位數 ≤ −1 或比例 ≥ 25%；不到 30 檔標「樣本少」。</p>');
}

function openSheet(title, html) {
  $('sheetTitle').textContent = title;
  $('sheetBody').innerHTML = html;
  $('sheetBody').scrollTop = 0;
  $('sheet').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('sheet').hidden = true;
  document.body.style.overflow = '';
}

function setCP(cp, rebuild = true) {
  S.cp = cp;
  store.set('cp', cp);
  $('bC').classList.toggle('on', cp === 'C');
  $('bP').classList.toggle('on', cp === 'P');
  if (rebuild && S.und) {
    store.set('last', S.und.code + cp);
    history.replaceState(null, '', '#' + S.und.code + cp);
    buildRows();
  }
}

function bindUI() {
  const q = $('q');
  let hl = -1;
  const showSugg = () => {
    if (!S.meta) return;
    const items = suggest(q.value);
    hl = -1;
    $('sugg').innerHTML = items.map((u) => `<button type="button" data-c="${esc(u[0])}"><span>${esc(u[0])} ${esc(u[1])}</span>`
      + `<small>購 ${u[2]}・售 ${u[3]}</small></button>`).join('');
    $('sugg').hidden = !items.length;
  };
  q.addEventListener('input', showSugg);
  q.addEventListener('focus', () => { if (q.value) q.select(); showSugg(); });
  q.addEventListener('keydown', (e) => {
    const btns = [...$('sugg').querySelectorAll('button')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
      btns.forEach((b, i) => b.classList.toggle('hl', i === hl));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = btns[hl] || (findUnd(q.value) ? null : btns[0]);
      const u = target ? target.dataset.c : (findUnd(q.value) || [])[0];
      if (u) pick(u);
    } else if (e.key === 'Escape') $('sugg').hidden = true;
  });
  $('sugg').addEventListener('mousedown', (e) => e.preventDefault());   // 不要讓輸入框先失焦
  $('sugg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(b.dataset.c); });
  q.addEventListener('blur', () => setTimeout(() => { $('sugg').hidden = true; }, 150));
  $('bC').onclick = () => setCP('C');
  $('bP').onclick = () => setCP('P');
  $('only').checked = S.only;
  $('only').onchange = () => { S.only = $('only').checked; store.set('only', S.only); S.shown = PAGE; render(); };
  $('sort').value = S.sort;
  $('sort').onchange = () => { S.sort = $('sort').value; store.set('sort', S.sort); render(); };
  $('btnFilter').onclick = showFilters;
  $('btnIssuer').onclick = showIssuers;
  $('list').addEventListener('click', (e) => {
    const c = e.target.closest('.card');
    if (c) showDetail(S.list[+c.dataset.i]);
  });
  $('more').addEventListener('click', (e) => { if (e.target.id === 'moreBtn') { S.shown += PAGE; render(); } });
  $('sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });
}

init();
