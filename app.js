// 黑客书架（Hacker Books 中文版）— 原生 ES-module 单页应用（hash 路由，无构建步骤）。
// 数据源自 hackerbooks.org（roansh 整理的 Hacker News 评论书目），书籍元数据与封面来自 Open Library。
// 分区：工具 · 数据 · 封面/卡片 · 信息流 · 页面 · 趋势 · 路由 · 界面框架 · 快捷键 · 启动

/* ============================== 工具 ============================== */
const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#main');
const BATCH = 60;   // 无限滚动每批渲染的卡片数
const HN = 'https://news.ycombinator.com';

/** 永不抛错的 localStorage 封装（隐私模式等场景）。 */
const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
/** 小写 + 去变音符号，用于搜索。 */
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/** 显示标题：优先中文译名（tz / sz），未翻译则回退原题。 */
const T = (b) => (b && b.tz) || b.t;
const TSub = (b) => (b && (b.sz || b.st)) || '';
/** 英文原名：仅在已翻译且与原题不同时返回（用于双语展示）。 */
const enName = (b) => (b && b.tz && b.tz !== b.t ? b.t : '');
/** 浏览器标签标题：中文（英文原名）。 */
const pageTitle = (b) => { const en = enName(b); return en ? `${T(b)}（${en}）` : T(b); };
/** 小型种子随机数：保证“今日书架”在同一（UTC）天内稳定。 */
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hashFor = (path, params = {}) => {
  const q = Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== 0).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `#${path}${q ? '?' + q : ''}`;
};

/* ============================== 数据 ============================== */
const URLS = {
  meta: 'data/meta.json',
  topics: 'data/topics.json',
  books: 'data/books.json',
  trends: 'data/trends.json',   // 惰性：仅 #/trends 加载
  buy: 'data/buy.json',         // 惰性：仅书籍详情页加载（{book_id: ISBN-13}）
  top: 'data/books-top.json',   // 首屏数据：全量索引的前 TOP_N 行
};
const TOP_N = 600;
const HOME_CAP = 120; // 今日书架每日限量：每天换一批，看全部去历史总榜
const EAGER = 12; // 首屏卡片用 eager 高优先级加载封面
const DATA_V = 5; // 详情 JSON 缓存版本：数据更新时 +1（绕过浏览器里的旧强缓存）

/*
 * state.books 是当前最优索引：全量索引到达前用 top-TOP_N 切片（state.full），之后是全部。
 * 两者都按 s 降序排列，切片是全量的精确前缀。
 */
const state = {
  meta: null, topics: [], topicByslug: new Map(),
  books: [], byId: new Map(), full: false,
  searchIdx: null, trends: null, buy: null,
  cache: {},
};

/* ------- 购书链接（无返利，直达中文购书平台搜索） ------- */
let buyPromise = null;
const ensureBuy = () => (buyPromise ||= getJSON(URLS.buy).then((m) => (state.buy = m || {}), () => (state.buy = {})));

function buyHTML(book) {
  const q = encodeURIComponent([T(book), (book.a || [])[0]].filter(Boolean).join(' '));
  const qEn = encodeURIComponent([book.t, (book.a || [])[0]].filter(Boolean).join(' ')); // Z-Library 用英文原题命中率更高
  const zlib = `https://z-library.sk/s/${qEn}`; // Z-Library 域名经常轮换，失效时改这里
  const douban = `https://www.douban.com/search?cat=1001&q=${q}`;
  const jd = `https://search.jd.com/Search?keyword=${q}&enc=utf-8`;
  const weread = `https://weread.qq.com/web/search/global?keyword=${q}`;
  const a = (href, label) => `<a class="btn buy" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
  return `<div class="buy-row"><span class="buy-lbl">找书：</span>${a(douban, '豆瓣')}${a(weread, '微信读书')}${a(jd, '京东')}${a(zlib, 'Z-Library')}</div>
  <p class="aff-note">打开对应平台的搜索结果，与本站无利益关联。</p>`;
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function setBooks(books, full) {
  state.books = books;
  state.byId = new Map(books.map((b) => [b.id, b]));
  state.full = full;
}

/** 一次性加载全量索引；已加载则立即返回，失败可重试。 */
let fullPromise = null;
function ensureFull() {
  if (state.full) return Promise.resolve();
  return (fullPromise ??= getJSON(URLS.books).then((books) => {
    for (let i = 1; i < books.length; i++)
      if (books[i - 1].s < books[i].s) { books.sort((a, b) => b.s - a.s); break; }
    setBooks(books, true);
  }).catch((err) => { fullPromise = null; throw err; }));
}

/** 首屏数据：meta + topics + 小号 top 索引。 */
async function loadBoot() {
  const topP = URLS.top ? getJSON(URLS.top).catch(() => null) : Promise.resolve(null);
  const [meta, topics, top] = await Promise.all([getJSON(URLS.meta), getJSON(URLS.topics), topP]);
  state.meta = meta;
  state.topics = topics;
  state.topicByslug = new Map(topics.map((t) => [t.slug, t]));
  if (top) setBooks(top, false);
  else await ensureFull();
}

/** 页面稳定后在后台加载剩余索引：已废弃——全量索引（1MB）改为用到才拉
 *（路由 needsFull / 首页翻页 / 详情相关书），搜索框聚焦时预热，避免首屏路径白耗流量。 */

/* ------- 每本书的详情 JSON：内存缓存 + 悬停/聚焦预取 ------- */
const bookCache = new Map();
function getBook(id) {
  let p = bookCache.get(id);
  if (!p) {
    p = getJSON(`data/book/${encodeURIComponent(id)}.json?v=${DATA_V}`);
    bookCache.set(id, p);
    p.catch(() => { if (bookCache.get(id) === p) bookCache.delete(id); });
    if (bookCache.size > 60) bookCache.delete(bookCache.keys().next().value);
  }
  return p;
}

/* ------- 派生列表（惰性计算 + 缓存） ------- */
const cached = (key, fn) => (state.cache[key] ??= fn());

/** 今日书架：按分数加权的随机顺序，每天（UTC）固定。Efraimidis–Spirakis 加权洗牌。 */
const shuffled = (books, seed) => {
  const rnd = mulberry32(hashStr(seed));
  return books.map((b) => ({ b, k: -Math.log(rnd() || 1e-9) / Math.pow(b.s + 1, 2) }))
    .sort((x, y) => x.k - y.k).map((x) => x.b);
};
const homeOrder = () => {
  const day = new Date().toISOString().slice(0, 10);
  const head = cached('home:head:' + day, () => shuffled(state.books.slice(0, TOP_N), 'hackerbooks:' + day));
  return state.full ? cached('home:all:' + day, () => head.concat(shuffled(state.books.slice(TOP_N), 'hackerbooks:tail:' + day))) : head;
};
/** 「最多推荐」：真心推荐过这本书的不同评论者人数（≥3），并列时按分数。 */
const MIN_REC = 3;
const hasStance = () => state.books.some((b) => b.ru);
const recommendedOrder = () => cached('recommended', () =>
  state.books.filter((b) => (b.ru || 0) >= MIN_REC).sort((x, y) => y.ru - x.ru || y.s - x.s));
/** 「上升最快」：近期提及占比 × log(提及数)，至少 5 次提及。 */
const risingOrder = () => cached('rising', () =>
  state.books.filter((b) => b.n >= 5).map((b) => ({ b, v: (b.r || 0) * Math.log(b.n) }))
    .sort((x, y) => y.v - x.v).map((x) => x.b));

/* ------- 个性化（仅存本地） ------- */
const profile = {
  views: () => store.get('hb.views', []),
  aff: () => store.get('hb.aff', {}),
  record(book) {
    const views = this.views();
    if (views.includes(book.id)) return;
    views.push(book.id);
    store.set('hb.views', views.slice(-400));
    const aff = this.aff();
    for (const t of book.tp || []) aff[t] = (aff[t] || 0) + 1;
    store.set('hb.aff', aff);
  },
  clear() { store.remove('hb.views'); store.remove('hb.aff'); },
};

function forYouList() {
  const viewed = new Set(profile.views());
  const aff = profile.aff();
  const scored = [];
  for (const b of state.books) {
    if (viewed.has(b.id)) continue;
    let a = 0;
    for (const t of b.tp || []) a += aff[t] || 0;
    if (a > 0) scored.push({ b, v: a * (0.6 + b.s / 100) });
  }
  return scored.sort((x, y) => y.v - x.v).map((x) => x.b);
}

/* ------- 搜索 ------- */
function search(query) {
  const q = norm(String(query ?? '').replace(/&/g, ' and ')); // "k&r" -> "k and r"
  if (!q) return [];
  const tokens = q.split(' ');
  state.searchIdx ??= state.books.map((b) => ({
    t: norm(b.t),
    z: norm(b.tz || ''),                    // 中文译名（books.json 的 tz 字段）
    a: norm((b.a || []).join(' ')),
    k: (b.k || []).map((x) => norm(String(x).replace(/&/g, ' and '))), // HN 缩写：sicp、taocp、k&r…
  }));
  const hits = [];
  state.books.forEach((b, i) => {
    const { t, z, a, k } = state.searchIdx[i];
    let rank = -1;
    if (k.includes(q)) rank = -0.5;           // 精确缩写优先于一切
    else if (t === q || (z && z === q)) rank = 0;
    else if (t.startsWith(q) || (z && z.startsWith(q))) rank = 1;
    else if (q.length >= 3 && k.some((x) => x.startsWith(q))) rank = 1.5;
    else if (t.includes(' ' + q)) rank = 2;
    else if (t.includes(q) || (z && z.includes(q))) rank = 3;
    else if (q.length >= 3 && k.some((x) => x.includes(q))) rank = 3.5;
    else {
      const all = t + ' ' + z + ' ' + a;
      if (tokens.every((w) => all.includes(w))) rank = tokens.every((w) => t.includes(w) || (z && z.includes(w))) ? 4 : tokens.every((w) => a.includes(w)) ? 5 : 6;
    }
    if (rank > -1) hits.push({ b, rank, i });
  });
  // 索引已按热度排序，用下标打破平局
  return hits.sort((x, y) => x.rank - y.rank || x.i - y.i).map((h) => h.b);
}

/* ============================== 封面与卡片 ============================== */
// 一级：本站镜像封面；二级：Open Library；兜底：标题排版占位图。
const coverUrl = (c) => `covers/${c}.webp`;
const olCoverUrl = (c, large) => `https://covers.openlibrary.org/b/id/${c}-${large ? 'L' : 'M'}.jpg?default=false`;

/** 生成的排版封面：颜色由标题哈希决定。 */
function placeholderHTML(b) {
  const hue = hashStr(b.t || '') % 360;
  return `<div class="cover ph" style="--h:${hue}"><span class="ph-t">${esc(T(b))}</span><span class="ph-rule"></span><span class="ph-a">${esc((b.a || []).join(', '))}</span></div>`;
}
/** 封面盒：有封面 ID 用图片，否则（或全部失败时）用排版占位图。eager = 首屏高优先级。 */
function coverHTML(b, large = false, badge = '', eager = false) {
  if (b.c == null) return badge ? placeholderHTML(b).replace(/<\/div>$/, badge + '</div>') : placeholderHTML(b);
  const [w, h] = large ? [400, 600] : [200, 300];
  const prio = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  return `<div class="cover"><img src="${coverUrl(b.c)}" alt="《${esc(T(b))}》封面" ${prio} decoding="async" width="${w}" height="${h}" data-id="${esc(b.id)}" data-c="${b.c}">${badge}</div>`;
}
// 图片错误不会冒泡，用捕获阶段在 document 上监听一次。
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.id) return;
  if (!img.dataset.fb && img.dataset.c) { img.dataset.fb = '1'; img.src = olCoverUrl(img.dataset.c); return; } // 二级：Open Library
  const b = state.byId.get(img.dataset.id) || { t: (img.alt || '').replace(/^《|》封面$/g, ''), a: [] };
  const box = img.closest('.cover');
  if (!box) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = placeholderHTML(b);
  box.className = tmp.firstChild.className;
  box.style.cssText = tmp.firstChild.style.cssText;
  box.innerHTML = tmp.firstChild.innerHTML + (box.querySelector('.badge')?.outerHTML || '');
  img.remove();
}, true);

const yearSpan = (b) => (b.f && b.l ? (b.f === b.l ? `${b.f}` : `${b.f}–${b.l}`) : '');

/** 卡片下方的计数行：有推荐标签时显示「推荐 / 提及」双数字，否则只显示提及人数。 */
function recLine(b) {
  if (!b.ru) return `<p class="rec">${fmt(b.u)} 人提及</p>`;
  const tip = `${fmt(b.ru)} 人推荐 · ${fmt(b.u)} 人提及`;
  return `<p class="rec rec-st" title="${tip}"><span class="rl">推荐 <b>${fmt(b.ru)}</b> · 提及 <b>${fmt(b.u)}</b></span><span class="rs"><b>${fmt(b.ru)}</b> 推荐 · ${fmt(b.u)}</span></p>`;
}

/* ------- 书单（只存本机 localStorage） ------- */
const WL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
const wlGet = () => store.get('wl', []);
const wlHas = (id) => wlGet().includes(id);
function wlToggle(id) {
  const list = wlGet();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1); else list.unshift(id);
  store.set('wl', list);
  return i < 0;
}

function cardHTML(b, eager = false) {
  const span = yearSpan(b);
  const badge = span ? `<span class="badge" title="提及年份 ${esc(span)}">${span}</span>` : '';
  const wl = `<button class="wl${wlHas(b.id) ? ' on' : ''}" data-wl="${esc(b.id)}" type="button" aria-label="加入书单">${WL_ICON}</button>`;
  return `<a class="card" href="#/book/${encodeURIComponent(b.id)}">${coverHTML(b, false, badge, eager)}${wl}
  <h3>${esc(T(b))}</h3>${enName(b) ? `<p class="t-en">${esc(enName(b))}</p>` : ''}<p class="au">${esc((b.a || []).join(', '))}</p>
  ${recLine(b)}</a>`;
}

/* ============================== 信息流（增量网格） ============================== */
let current = null; // 当前路由的 { raw, shown(), dispose() }

/** 用哨兵元素 + IntersectionObserver 把 `list` 分批渲染进 `container`。 */
function mountInfinite(container, list, initial = 0, partial = false) {
  let shown = 0, waiting = partial, failed = false;
  const sentinel = document.createElement('div');
  sentinel.className = 'sentinel';
  container.after(sentinel);
  const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); }, { rootMargin: '900px 0px' });

  function more(count = BATCH) {
    if (shown < list.length) {
      const slice = list.slice(shown, shown + count);
      container.insertAdjacentHTML('beforeend', slice.map((b, i) => cardHTML(b, shown + i < EAGER)).join(''));
      shown += slice.length;
    }
    if (shown >= list.length) {
      io.disconnect();
      sentinel.className = 'end';
      sentinel.textContent = failed ? '其余书目加载失败，刷新页面可重试。' :
        waiting ? '正在加载更多书籍…' :
        list.length > BATCH ? `共 ${fmt(list.length)} 本，全部展示完毕。` : '';
    } else {
      requestAnimationFrame(() => { io.unobserve(sentinel); io.observe(sentinel); });
    }
  }
  more(Math.max(BATCH, initial));
  if (shown < list.length || waiting) io.observe(sentinel);
  return {
    shown: () => shown,
    dispose: () => io.disconnect(),
    extend(items) {
      list = list.concat(items);
      waiting = false;
      sentinel.className = 'sentinel';
      sentinel.textContent = '';
      if (!items.length) { more(); return; }
      io.disconnect();
      io.observe(sentinel);
    },
    fail() { waiting = false; failed = true; if (shown >= list.length) more(); },
  };
}

const DECADES = [
  ['pre', '1950 年前'], ['1950', '1950 年代'], ['1960', '1960 年代'], ['1970', '1970 年代'],
  ['1980', '1980 年代'], ['1990', '1990 年代'], ['2000', '2000 年代'], ['2010', '2010 年代'], ['2020', '2020 年代'],
];
const inDecade = (b, d) => b.y != null && (d === 'pre' ? b.y < 1950 : b.y >= +d && b.y < +d + 10);

/** 渲染一个带筛选 chips（出版年代、首次提及年份）的书籍列表页。 */
function renderFeed({ title, sub = '', path, query, items, pre = '', restore, full = true }) {
  const dec = query.get('dec') || '';
  const since = +query.get('since') || 0;
  const filter = (all) => (dec || since ? all.filter((b) => (!dec || inDecade(b, dec)) && (!since || (b.f || 0) >= since)) : all);
  const ly = state.meta.last_year;
  const chip = (label, params, on) => `<a class="chip${on ? ' on' : ''}" href="${hashFor(path, { dec, since, ...params })}"${on ? ' aria-current="true"' : ''}>${esc(label)}</a>`;
  const sinceOpts = [2015, 2020, ly - 1].filter((y, i, a) => a.indexOf(y) === i && y > state.meta.first_year);
  const chipsHTML = (all) => {
    const present = DECADES.filter(([d]) => all.some((b) => inDecade(b, d)));
    return `<div class="chips" aria-label="按出版年代筛选"><span class="lbl">出版年代</span>${chip('全部', { dec: '' }, !dec)}${present.map(([d, l]) => chip(l, { dec: d }, dec === d)).join('')}</div>
    <div class="chips" aria-label="按首次被 HN 提及的年份筛选"><span class="lbl">首次提及</span>${chip('全部', { since: 0 }, !since)}${sinceOpts.map((y) => chip(y + ' 年起', { since: y }, since === y)).join('')}</div>`;
  };

  const all = items();
  const list = filter(all);
  main.innerHTML = `<div class="page-h"><h1>${esc(title)}</h1></div>${sub ? `<p class="sub">${sub}</p>` : ''}${pre}
  <div id="chips">${chipsHTML(all)}</div>
  <div class="grid" id="grid"></div>`;
  if (!list.length) {
    $('#grid').outerHTML = `<p class="empty">没有符合筛选条件的书。<a data-replace href="${hashFor(path)}">清除筛选</a></p>`;
    return;
  }
  // full=false 的feed（今日书架限量）不预载全量索引；带年代筛选的首页路由由 needsFull 在路由层补全量
  const partial = full && !state.full;
  const ctl = current = mountInfinite($('#grid'), list, restore?.shown || 0, partial);
  if (partial) {
    const token = routeToken;
    ensureFull().then(() => {
      if (token !== routeToken || current !== ctl) return;
      const all2 = items();
      $('#chips').innerHTML = chipsHTML(all2);
      ctl.extend(filter(all2).slice(list.length));
    }, () => { if (token === routeToken && current === ctl) ctl.fail(); });
  }
}

/* ============================== 页面 ============================== */
const SITE_DESC = 'Hacker News 评论中被提及的 1.5 万多本书，2007–2026。';
function setPage(title, desc) {
  document.title = title ? `${title} — 黑客书架` : '黑客书架 — Hacker News 评论中被提及最多的书';
  const d = desc || SITE_DESC;
  $('meta[name="description"]').content = d;
  $('meta[property="og:title"]').content = document.title;
  $('meta[property="og:description"]').content = d;
  $('#live').textContent = document.title;
}

function renderHome(q, restore) {
  setPage('');
  const m = state.meta;
  renderFeed({
    title: '今日书架',
    path: '/',
    query: q,
    items: () => homeOrder().slice(0, HOME_CAP),
    restore,
    full: false,
    sub: `每天从 HN 提及的 ${fmt(m.n_books)} 本好书中换一批（今日 ${HOME_CAP} 本）。想看硬排名，去<a href="#/top">历史总榜</a>。`,
  });
}

function renderTop(q, restore) {
  setPage('历史总榜', 'Hacker News 评论中被提及最多的书，按综合分数排名。');
  renderFeed({
    title: '历史总榜',
    sub: '按综合分数排名：一本书被提及的频率，以及有多少位不同的人提到它。',
    path: '/top',
    query: q,
    items: () => state.books,
    restore,
  });
}

function renderRecommended(q, restore) {
  setPage('最多推荐', '被最多不同 HN 评论者真心推荐（而不只是提及）的书。');
  const sub = '按「推荐过这本书的不同人数」排名（不是随便提一嘴）。推荐/提及标签由大语言模型逐条标注，与人工标注一致率约 85%，难免有噪声。';
  if (!hasStance()) {
    main.innerHTML = `<div class="page-h"><h1>最多推荐</h1></div><p class="sub">${sub}</p><p class="empty">当前数据未包含推荐标签。请看<a href="#/top">历史总榜</a>。</p>`;
    return;
  }
  renderFeed({
    title: '最多推荐',
    sub,
    path: '/recommended',
    query: q,
    items: recommendedOrder,
    restore,
  });
}

function renderRising(q, restore) {
  setPage('上升最快', '在 Hacker News 上热度增长最快的书。');
  renderFeed({
    title: '上升最快',
    sub: '近期提及占该书历史提及的比例更高者排前（至少 5 次提及）。',
    path: '/rising',
    query: q,
    items: risingOrder,
    restore,
  });
}

function renderTopic(slug, q, restore) {
  const topic = state.topicByslug.get(slug);
  if (!topic) return renderNotFound('没有这个话题。');
  setPage(topic.name, `Hacker News 评论中提及的「${topic.name}」类书籍（${topic.en}）。`);
  const items = cached('topic:' + slug, () => state.books.filter((b) => (b.tp || []).includes(slug)));
  renderFeed({
    title: topic.name,
    sub: `共 ${fmt(items.length)} 本，按综合分数排名。`,
    path: '/topic/' + slug,
    query: q,
    items: () => items,
    restore,
  });
}

function renderForYou(q, restore) {
  setPage('为你推荐', '根据你的浏览记录在本地计算的个性化推荐。');
  const views = profile.views();
  if (!views.length) {
    main.innerHTML = `<div class="empty"><h2>「为你推荐」还是空的</h2>
    <p>先去打开几本书，我们就会按同类话题推荐更多。所有记录只存在你的浏览器（localStorage）里，不会上传任何数据。</p>
    <p><a class="btn primary" href="#/top">去逛历史总榜</a></p></div>`;
    return;
  }
  const clear = `<p><button class="btn" id="clear-profile" type="button">清空我的浏览记录</button></p>`;
  const picks = forYouList();
  renderFeed({
    title: '为你推荐',
    path: '/foryou',
    query: q,
    restore,
    items: () => picks,
    sub: `根据你打开过的 ${fmt(views.length)} 本书推荐（已去掉看过的）。只保存在这台设备上。`,
    pre: clear,
  });
  $('#clear-profile').onclick = () => { profile.clear(); route(); };
}

function renderSearch(q) {
  const text = (q.get('q') || '').trim();
  setPage(text ? `搜索：${text}` : '搜索');
  const input = $('#q');
  if (document.activeElement !== input) input.value = text;
  if (!text) {
    main.innerHTML = '<p class="empty">在上方搜索框输入书名或作者。</p>';
    return;
  }
  const results = search(text);
  main.innerHTML = `<div class="page-h"><h1>“${esc(text)}” 的搜索结果</h1></div><p class="sub">找到 ${fmt(results.length)} 本。</p><div class="grid" id="grid"></div>`;
  if (!results.length) {
    $('#grid').outerHTML = '<p class="empty">没有匹配的书。试试更少的字或别的拼写。</p>';
    return;
  }
  current = mountInfinite($('#grid'), results);
}

function renderNotFound(msg = '这个页面不存在。') {
  setPage('未找到');
  main.innerHTML = `<div class="empty"><h2>未找到</h2><p>${esc(msg)}</p><p><a class="btn primary" href="#/">回到首页</a></p></div>`;
}

function renderAbout() {
  setPage('关于本站', '黑客书架是什么，数据是怎么来的。');
  const m = state.meta;
  main.innerHTML = `<article class="prose">
  <h1>关于本站</h1>
  <p>「黑客书架」收录人们在 <a href="https://news.ycombinator.com" rel="noopener" target="_blank">Hacker News</a> 评论中提及的书，从 ${m.first_year} 到 ${m.last_year} 年。被提及不等于被推荐，所以本站还会告诉你每本书有多少人<b>真心推荐</b>。
  目前共收录 <b>${fmt(m.n_books)}</b> 本书、<b>${fmt(m.n_mentions)}</b> 次提及（来自 <b>${fmt(m.n_comments)}</b> 条评论、<b>${fmt(m.n_commenters)}</b> 位不同的评论者）。</p>
  <p>可以去逛<a href="#/top">历史总榜</a>、看看<a href="#/rising">上升最快</a>，或从侧栏挑一个话题；打开任何一本书都能读到提到它的原评论并跳回 HN 原帖。</p>
  <h2>数据是怎么来的</h2>
  <ol>
    <li><b>HN 全量数据。</b>从 Hacker News 公开档案出发，遍历全部条目与评论。</li>
    <li><b>候选抽取。</b>用正则与轻量 NLP 找出像书名引用的片段（带引号的书名、“by 某作者”句式、Amazon / Goodreads / Open Library 链接、ISBN 等）。</li>
    <li><b>Open Library 匹配。</b>把候选匹配到 Open Library 作品，得到稳定 ID、作者、初版年份、封面与主题。</li>
    <li><b>全库提及计数。</b>对每个已匹配的书名在整个语料库中再搜索一遍，所以即使没人贴链接也会被计入。</li>
    <li><b>模型消歧。</b>只用小模型处理歧义书名（如《Dune》《Influence》《Range》），判断评论是否真的在说这本书。</li>
  </ol>
  <p>分数更看重「多少位<i>不同的人</i>提到过」，而不是原始提及次数，所以一个人刷屏不会霸榜。「上升最快」比较的是近期提及与该书历史份额的变化。</p>
  <h2>「推荐」与「提及」的区别</h2>
  <p>只数提及会让一本被讨论（甚至被警告）的书看起来像人气好书。因此每条提及都被模型标注为 <i>推荐</i>、<i>中性</i>、<i>批评</i> 或 <i>与书无关</i>。「推荐人数」统计至少推荐过一次的不同的人；与书无关的提及会被剔除。<a href="#/recommended">最多推荐</a>页按推荐人数排名。标注与更仔细的参考模型一致率约 85%，会有噪声。</p>
  <h2>来源与致谢</h2>
  <p>本站是 <a href="https://hackerbooks.org" rel="noopener" target="_blank">hackerbooks.org</a> 的中文版。原站由 <a href="https://rohitshinde.in" rel="author" target="_blank" rel="noopener">roansh</a> 构建，感谢其公开的数据管道（完整数据集可在原站获取）。书籍元数据与封面来自 <a href="https://openlibrary.org" rel="noopener" target="_blank">Open Library</a>；评论文字版权归原作者所有，页面上只保留摘录并链接回原帖。</p>
  <p>灵感来自 Andrej Karpathy 的 <a href="https://hackertube.org" rel="noopener" target="_blank">HackerTube</a>。中文版由 <a href="https://tuijian.qiaomu.ai/" target="_blank" rel="noopener">乔木</a> 维护，代码在 <a href="https://github.com/joeseesun/hackerbooks-cn" rel="noopener" target="_blank">GitHub</a> 开源。</p>
  <h2>隐私</h2>
  <p>没有账号，没有跨站跟踪。「为你推荐」完全在你的浏览器里根据你打开过的书计算，只存在本机 localStorage。</p>
  </article>`;
}

/* ------- 书籍详情页 ------- */
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** 转义文本并把书名（或其主干部分）包上 <mark>。 */
function highlight(text, title) {
  const variants = [title, title.split(/[:(–—]| - /)[0].trim()].filter((v) => v && v.length >= 4);
  if (!variants.length) return esc(text);
  const pat = [...new Set(variants)].sort((a, b) => b.length - a.length)
    .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]")).join('|');
  let out = '', last = 0;
  for (const m of text.matchAll(new RegExp(pat, 'gi'))) {
    out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

/** 每年提及次数的内联 SVG 柱状图。 */
function yearsChart(years, m) {
  const keys = Object.keys(years || {}).map(Number);
  if (!keys.length) return '';
  const y0 = Math.min(m.first_year, ...keys), y1 = Math.max(m.last_year, ...keys);
  const ys = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);
  const vals = ys.map((y) => years[y] || 0);
  const max = Math.max(...vals, 1);
  const W = 640, H = 150, L = 30, B = 22, T = 8, bw = (W - L) / ys.length;
  const bars = ys.map((y, i) => {
    const h = Math.round(((H - B - T) * vals[i]) / max);
    return `<rect class="bar" x="${(L + i * bw + bw * 0.12).toFixed(1)}" y="${H - B - h}" width="${(bw * 0.76).toFixed(1)}" height="${h}" rx="2"><title>${y} 年：${fmt(vals[i])} 次提及</title></rect>`;
  }).join('');
  const label = (i, anchor) => `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${ys[i]}</text>`;
  const mid = Math.floor(ys.length / 2);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${y0} 至 ${y1} 年每年的提及次数，峰值 ${max}">
  <line x1="${L}" x2="${W}" y1="${H - B}" y2="${H - B}"/><line x1="${L}" x2="${W}" y1="${T}" y2="${T}" stroke-dasharray="3 4"/>
  <text x="${L - 4}" y="${T + 4}" text-anchor="end">${max}</text><text x="${L - 4}" y="${H - B}" text-anchor="end">0</text>
  ${bars}${label(0, 'start')}${ys.length > 4 ? label(mid, 'middle') : ''}${label(ys.length - 1, 'end')}</svg>`;
}

/** 推荐/中性/批评三类评论者的占比条。 */
function stanceBarHTML(st) {
  const tot = st ? st.r + st.n + st.c : 0;
  if (!tot) return '';
  const pct = (v) => Math.round((100 * v) / tot);
  const parts = [['r', '推荐', st.r], ['n', '中性', st.n], ['c', '批评', st.c]];
  const txt = parts.map(([, l, v]) => `${pct(v)}% ${l}`).join('，');
  return `<div class="stance" title="按评论者态度的占比（模型标注，仅供参考）">
  <div class="sbar" role="img" aria-label="评论者态度：${txt}">${parts.filter(([, , v]) => v).map(([k, , v]) => `<i class="s-${k}" style="flex:${v}"></i>`).join('')}</div>
  <p class="slg">${parts.filter(([, , v]) => v).map(([k, l, v]) => `<span><i class="dot s-${k}"></i>${pct(v)}% ${l}</span>`).join('')}</p></div>`;
}

const SV_TAG = { r: ['推荐', 'recommends'], n: ['提及', 'mentions'], c: ['批评', 'critical'] };

function bookHTML(b, d) {
  const full = { ...b, ...(d || {}) };
  if (!full.f && d?.years) {
    const ys = Object.keys(d.years).map(Number);
    if (ys.length) { full.f = Math.min(...ys); full.l = Math.max(...ys); }
  }
  const authors = (full.a || []).map((a) => `<a href="${hashFor('/search', { q: a })}">${esc(a)}</a>`).join(', ');
  const topics = (full.tp || []).map((s) => `<a class="chip topic" href="#/topic/${encodeURIComponent(s)}">${esc(state.topicByslug.get(s)?.name || s)}</a>`).join('');
  const span = yearSpan(full);
  const trendLink = (state.trends ? !!state.trends.books[full.id] : full.u >= 60) ? `<a class="btn" href="#/trends?b=${encodeURIComponent(full.id)}">看它的热度走势</a>` : '';
/** 简介：有中文译文的先中文，英文原文折叠收纳。 */
const descHTML = (full) => {
  if (full.dz && full.desc) return `<p class="desc">${esc(full.dz)}</p><details class="orig"><summary>查看英文原文</summary><p class="desc">${esc(full.desc)}</p></details>`;
  return full.desc ? `<p class="desc">${esc(full.desc)}</p>` : '';
};
const isbnLink = d?.isbn ? `<a class="btn" href="https://openlibrary.org/isbn/${esc(d.isbn)}" target="_blank" rel="noopener">ISBN ${esc(d.isbn)}</a>` : '';
  const enLine = enName(full) ? [full.t, full.st].filter(Boolean).join(': ') : '';
  return `<article class="book">
  <div>${coverHTML(full, true, '', true)}</div>
  <div>
    <h1>${esc(T(full))}</h1>
    ${full.st ? `<p class="st">${esc(TSub(full))}</p>` : ''}
    ${enLine ? `<p class="t-en">${esc(enLine)}</p>` : ''}
    <p class="by">${authors ? authors : '<span>作者未知</span>'}${full.y ? ` <span>· 初版 ${full.y} 年</span>` : ''}</p>
    <div class="stats">
      <div class="stat"><b>${fmt(full.n)}</b><span>次提及</span></div>
      ${(full.ru ?? d?.stance?.r) ? `<div class="stat"><b>${fmt(full.ru ?? d.stance.r)}</b><span>人推荐</span></div>` : ''}
      <div class="stat"><b>${fmt(full.u)}</b><span>位 HN 评论者</span></div>
      ${span ? `<div class="stat"><b>${span}</b><span>提及年份跨度</span></div>` : ''}
    </div>
    ${stanceBarHTML(d?.stance)}
    <div class="chips">${topics}</div>
    ${descHTML(full)}
    <div id="buy">${buyHTML({ ...full, isbn: d?.isbn })}</div>
    <div class="links"><a class="btn primary" href="https://openlibrary.org/works/${esc(full.id)}" target="_blank" rel="noopener">在 Open Library 查看</a>${isbnLink}<button class="btn" type="button" data-wl="${esc(full.id)}">${wlHas(full.id) ? '已在书单' : '想读'}</button><button class="btn" type="button" id="share-img-btn">生成分享图</button>${trendLink}</div>
  </div>
  ${d?.years ? `<section class="sec"><h2>历年提及次数</h2>${yearsChart(d.years, state.meta)}</section>` : ''}
  ${d ? `<section class="sec" id="comments-sec"><h2>Hacker News 上怎么说</h2><ul class="comments" id="comments"></ul><p><button class="btn" id="more-comments" type="button" hidden>显示更多评论</button></p></section>` : '<section class="sec"><p class="sub">评论加载中…</p></section>'}
  <div id="related">${relatedHTML(d)}</div>
</article>`;
}

/** 相关书籍需要全量索引来解析 ID（加载完成前为空，renderBook 会补渲染）。 */
function recSection(ids, title) {
  const books = state.full ? (ids || []).map((id) => state.byId.get(id)).filter(Boolean) : [];
  return books.length ? `<section class="sec"><h2>${esc(title)}</h2><div class="row">${books.map((b) => cardHTML(b)).join('')}</div></section>` : '';
}
function relatedHTML(d) {
  return recSection(d?.co, '同一讨论中，HN 读者一起提到') + recSection(d?.related, '相关书籍');
}

function commentHTML(c, title) {
  const link = (url, text, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${url}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
  const body = c.zh
    ? `<p class="c-zh">${esc(c.zh)}</p><p class="c-en">${highlight(c.x || '', title)}</p>`
    : `<p>${highlight(c.x || '', title)}</p>`;
  return `<li class="comment"><div class="comment-h">${link(`${HN}/user?id=${encodeURIComponent(c.by)}`, c.by, 'who')} · ${link(`${HN}/item?id=${c.id}`, fmtDate(c.ts))}${SV_TAG[c.sv] ? ` · <span class="tag tag-${SV_TAG[c.sv][1]}">${SV_TAG[c.sv][0]}</span>` : ''}</div>
  ${body}
  ${c.st ? `<a class="thread" href="${HN}/item?id=${c.sid}" target="_blank" rel="noopener noreferrer">出自讨论「${esc(c.st)}」 ↗</a>` : ''}</li>`;
}

let routeToken = 0;
let shareCtx = null;
const clipText = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
function wrapText(g, text, x, y, maxW, lh) {
  let line = '', yy = y;
  for (const ch of text) {
    if (g.measureText(line + ch).width > maxW) { g.fillText(line, x, yy); line = ch; yy += lh; }
    else line += ch;
  }
  if (line) g.fillText(line, x, yy);
  return yy;
}
/** 分享图：1080×1350，封面 + 中文书名 + 一句高赞推荐，纯本地 canvas 生成。 */
async function showShareImage() {
  if (!shareCtx) return;
  const { book, d } = shareCtx;
  const dlg = document.createElement('dialog');
  dlg.className = 'share-box';
  dlg.innerHTML = `<canvas width="1080" height="1350"></canvas><div class="share-actions"><button class="btn primary" type="button" id="share-dl">下载图片</button><button class="btn" type="button" id="share-close">关闭</button></div>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.querySelector('#share-close').onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  const cv = dlg.querySelector('canvas'), g = cv.getContext('2d');
  await document.fonts.ready;
  g.fillStyle = '#f7f6f2'; g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = '#121212'; g.fillRect(60, 60, 960, 4);
  g.font = '700 42px "HP Serif", serif'; g.fillText('黑客书架', 60, 155);
  g.font = '400 26px Newsreader, serif'; g.fillStyle = '#767676'; g.fillText('Hacker Books 中文版', 248, 150);
  const cy = 200;
  if (book.c != null) {
    const img = new Image();
    img.src = coverUrl(book.c);
    try { await img.decode(); g.drawImage(img, 330, cy, 420, 630); } catch { /* 封面失败留白 */ }
  }
  let y = cy + 630 + 110;
  g.fillStyle = '#121212';
  g.font = '700 68px "HP Serif", serif';
  g.fillText(clipText(T(book), 13), 60, y); y += 76;
  if (enName(book)) {
    g.font = '400 32px Newsreader, serif'; g.fillStyle = '#555553';
    g.fillText(clipText(enName(book), 50), 60, y); y += 58;
  }
  const q = (d?.comments || []).find((c) => c.sv === 'r');
  if (q) {
    g.font = '400 30px "PingFang SC", sans-serif'; g.fillStyle = '#121212';
    y = wrapText(g, `「${clipText((q.zh || q.x || '').replace(/\s+/g, ' '), 80)}」`, 60, y + 30, 960, 44) + 20;
  }
  g.fillStyle = '#767676'; g.font = '400 26px "PingFang SC", sans-serif';
  g.fillText(`${fmt(book.u)} 位 HN 读者提及 · hackerbooks.qiaomu.ai`, 60, 1290);
  dlg.querySelector('#share-dl').onclick = () => cv.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hackerbooks-${book.id}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}
function renderList(restore) {
  const ids = wlGet();
  setPage('我的书单', '存在本机浏览器里，不会上传。');
  if (!ids.length) {
    main.innerHTML = `<div class="page-h"><h1>我的书单</h1></div><p class="sub">在书卡右上角或详情页点「想读」，把书收进这里。只存在本机浏览器。</p><p class="empty">书单还是空的，去<a href="#/">今日书架</a>淘几本。</p>`;
    return;
  }
  main.innerHTML = `<div class="page-h"><h1>我的书单</h1></div><p class="sub">${fmt(ids.length)} 本 · 只存在本机。 <button class="btn" id="wl-copy" type="button">复制书单</button> <button class="btn" id="wl-clear" type="button">清空书单</button></p><div class="grid" id="grid"></div>`;
  const books = ids.map((id) => state.byId.get(id)).filter(Boolean);
  current = mountInfinite($('#grid'), books, restore?.shown || 0);
  $('#wl-copy').onclick = async () => {
    const text = '黑客书架 · 我的书单\n' + books.map((b, i) => `${i + 1}. ${T(b)}（${enName(b) || b.t}）`).join('\n') + '\n' + location.origin;
    try { await navigator.clipboard.writeText(text); $('#wl-copy').textContent = '已复制 ✓'; } catch { $('#wl-copy').textContent = '复制失败，请手动选择'; }
  };
  $('#wl-clear').onclick = () => { store.set('wl', []); route(); };
}
const BOOK_REDIRECTS = { OL999456W: 'OL1975712W', OL28649132W: 'OL82563W', OL27739326W: 'OL21385222W' };
async function renderBook(id) {
  if (BOOK_REDIRECTS[id]) {
    history.replaceState(null, '', `#/book/${BOOK_REDIRECTS[id]}`);
    id = BOOK_REDIRECTS[id];
  }
  const token = ++routeToken;
  const base = state.byId.get(id);
  if (!state.buy) ensureBuy().then(() => {
    const b = state.byId.get(id) || base;
    if (token === routeToken && b && $('#buy')) $('#buy').innerHTML = buyHTML(b);
  });
  if (base) {
    main.innerHTML = bookHTML(base, null);
    setPage(pageTitle(base), `《${T(base)}》（${(base.a || []).join(', ')}）— ${base.u} 位 Hacker News 评论者提及。`);
    profile.record(base);
  } else main.innerHTML = '<div class="skel">加载中…</div>';
  let d;
  try { d = await getBook(id); } catch { d = null; }
  if (token !== routeToken) return;
  if (!d && !base) return renderNotFound('找不到这本书。');
  if (!d) {
    const s = $('.sec .sub');
    if (s) s.textContent = '这本书的评论加载失败。';
    return;
  }
  const book = { ...base, ...d };
  shareCtx = { book, d };
  setPage(pageTitle(book), `《${T(book)}》（${(book.a || []).join(', ')}）— ${fmt(book.u)} 位 Hacker News 评论者提及。${d.desc || ''}`);
  if (!base) profile.record(book);
  main.innerHTML = bookHTML(base || book, d);
  if (!state.full && (d.related?.length || d.co?.length)) {
    ensureFull().then(() => {
      if (token === routeToken && $('#related')) $('#related').innerHTML = relatedHTML(d);
    }, () => { /* 没有相关书 */ });
  }
  // 评论每页 15 条渲染，减轻 DOM 负担
  const list = $('#comments'), btn = $('#more-comments');
  const comments = d.comments || [];
  let shown = 0;
  const more = () => {
    list.insertAdjacentHTML('beforeend', comments.slice(shown, shown + 15).map((c) => commentHTML(c, book.t)).join(''));
    shown = Math.min(comments.length, shown + 15);
    btn.hidden = shown >= comments.length;
    const total = (base || book).n || 0;
    if (btn.hidden && total > comments.length) {
      btn.insertAdjacentHTML('afterend', `<span class="sub">每本书只保留讨论最多的 ${comments.length} 条摘录（共 ${fmt(total)} 次提及）。</span>`);
    }
  };
  if (!comments.length) list.innerHTML = '<li class="sub">暂无评论摘录。</li>';
  else { btn.onclick = more; more(); }
}

/* ============================== 趋势 ============================== */
// #/trends：年度排名图、常青书、浪潮、对比。数据：data/trends.json，仅此页加载。
// 数值是某书占当年全部书籍提及的千分比（UI 里显示为百分比，10‰ = 1%）。
const TR_DEFAULT = ['OL16086010W', 'OL3510570W']; // 《精益创业》vs《人月神话》
const TR_MAX = 5;
let trendsPromise = null;
function getTrends() {
  return (trendsPromise ??= getJSON(URLS.trends).then((t) => (state.trends = t)).catch((err) => { trendsPromise = null; throw err; }));
}

const trTitle = (b) => String(T(b) || '').replace(/\s+/g, ' ').replace(/\s*[:：–-]\s*$/, '').trim();
/** 图表短标签：主标题（冒号前），太长时用 HN 缩写（SICP、TAOCP…）。 */
function trShort(b, max = 24) {
  const full = trTitle(b), mainT = full.split(/\s*[:(–—]\s*|\s+-\s+/)[0] || full;
  if (mainT.length <= max) return mainT;
  const ab = (b.k || []).find((k) => /^[a-z]{3,6}$/.test(k));
  if (ab) return ab.toUpperCase();
  return mainT.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}
const trPct = (p) => (!p ? '0%' : p < 0.1 ? '不足 0.01%' : `${(p / 10).toFixed(p >= 10 ? 1 : 2)}%`);
const trYear = (T, y) => (y === T.years[T.years.length - 1] ? `${y}（进行中）` : String(y));
const trSvg = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
/** 元素宽度变化时重跑 draw(width)（挂载时也跑一次）。 */
function watchWidth(el, draw) {
  let last = 0, raf = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const w = Math.floor(el.clientWidth);
      if (w > 0 && Math.abs(w - last) > 1) { last = w; draw(w); }
    });
  });
  ro.observe(el);
  return ro;
}
/** 把提示框 `tip` 定位到视口点 (cx, cy) 上方。 */
function placeTip(box, tip, cx, cy) {
  const r = box.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  let x = cx - r.left - w / 2;
  x = Math.max(4, Math.min(x, r.width - w - 4));
  let y = cy - r.top - h - 14;
  if (y < 0) y = cy - r.top + 16;
  tip.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
}

/** 某书历年份额的迷你折线（按自身最大值缩放）。 */
function sparkHTML(T, p, peakI) {
  const W = 150, H = 36, pad = 3, max = Math.max(...p, 0.01), n = p.length;
  const pt = p.map((v, i) => [pad + ((W - 2 * pad) * i) / (n - 1), H - pad - ((H - 2 * pad) * v) / max]);
  const line = pt.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const dot = peakI == null ? '' : `<circle cx="${pt[peakI][0].toFixed(1)}" cy="${pt[peakI][1].toFixed(1)}" r="3" class="pk"/>`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false"><line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}"/><path d="${line}L${W - pad},${H - pad}L${pad},${H - pad}Z" class="ar"/><path d="${line}" class="ln"/>${dot}</svg>
  <div class="spark-x" aria-hidden="true"><span>${T.years[0]}</span><span>${T.years[n - 1]}</span></div>`;
}

/** 从结构化字段生成中文浪潮说明（不用数据集里的英文 d 字段）。 */
function waveCaption(w) {
  if (w.rising) return w.rk === 1 ? `${w.py} 年登上榜首 · 势头正劲` : `${w.py} 年 ${fmt(w.pu)} 人提及 · 近两年快速上升`;
  return `${w.py} 年前后达到高峰 · 此后退潮`;
}

function trendCardHTML(T, b, caption, peakI, sr) {
  return `<a class="card tr-card" href="#/book/${encodeURIComponent(b.id)}">${coverHTML(b)}
  <h3>${esc(trTitle(b))}</h3>${enName(b) ? `<p class="t-en">${esc(enName(b))}</p>` : ''}<p class="au">${esc((b.a || []).join(', '))}</p>
  ${sparkHTML(T, T.books[b.id].p, peakI)}<p class="rec">${esc(caption)}</p><span class="sr-only">${esc(sr)}</span></a>`;
}

function evergreensHTML(T) {
  const cards = T.evergreens.map((e) => state.byId.get(e.id) && trendCardHTML(T, state.byId.get(e.id), `${T.years.length} 年里 ${e.n} 年都在 Top 50`, null,
    `${T.years[0]} 至 ${T.years[T.years.length - 1]} 年书籍提及份额：${T.years.length} 年中有 ${e.n} 年位居当年前 50。`)).filter(Boolean);
  const minY = Math.min(...T.evergreens.map((e) => e.n));
  return `<section class="tr-sec" aria-labelledby="tr-h-ever"><h2 id="tr-h-ever">常青书</h2>
  <p class="sub">${T.years.length} 年里至少 ${minY} 年都进入当年提及前 50 的书。曲线是该书每年占全部书籍提及的份额，各自按自身最大值缩放。</p>
  <div class="grid">${cards.join('')}</div></section>`;
}

function wavesHTML(T) {
  const group = (ws, title, sub) => {
    const cards = ws.map((w) => {
      const b = state.byId.get(w.id);
      return b && trendCardHTML(T, b, waveCaption(w), T.years.indexOf(w.py), `占当年书籍提及份额的峰值出现在 ${w.py} 年，为 ${trPct(w.pk)}。`);
    }).filter(Boolean).join('');
    return cards ? `<h3 class="tr-gh">${title}${sub ? ` <span>${sub}</span>` : ''}</h3><div class="grid">${cards}</div>` : '';
  };
  const rising = T.waves.filter((w) => w.rising);
  const byYear = [...new Set(T.waves.filter((w) => !w.rising).map((w) => w.py))].sort((a, b) => b - a);
  return `<section class="tr-sec" aria-labelledby="tr-h-waves"><h2 id="tr-h-waves">浪潮</h2>
  <p class="sub">火过一两年又归于沉寂的书。圆点标出峰值年份。</p>
  ${group(rising, '正在上升', '近两年才发力，还看不出会不会退潮')}
  ${byYear.map((y) => group(T.waves.filter((w) => !w.rising && w.py === y), `${y} 年见顶`, y === T.years[0] ? '（HN 在本站数据里的第一个完整年份：总量小，噪声更大）' : '')).join('')}</section>`;
}

/* ---- 年度排名（bump）图 ---- */
function mountBump(box, T, ctl) {
  const ys = T.years, n = ys.length, ly = ys[n - 1];
  const pts = new Map();
  ys.forEach((y, i) => T.top10[y].forEach(([id, u], k) => {
    if (!pts.has(id)) pts.set(id, []);
    pts.get(id).push({ i, r: k + 1, u });
  }));
  const ids = [...pts.keys()].filter((id) => state.byId.has(id));
  const bookOf = (id) => state.byId.get(id);
  let pinned = null;
  let geo = null;

  function draw(width) {
    const W = Math.max(780, width), L = 150, R = 150, top = 38, rowH = 33, H = top + 9 * rowH + 50;
    const x = (i) => L + ((W - L - R) * i) / (n - 1), y = (r) => top + (r - 1) * rowH;
    const short = W - L - R < 17 * 36;
    const seg = (a, b) => `M${x(a.i).toFixed(1)},${y(a.r)}C${((x(a.i) + x(b.i)) / 2).toFixed(1)},${y(a.r)} ${((x(a.i) + x(b.i)) / 2).toFixed(1)},${y(b.r)} ${x(b.i).toFixed(1)},${y(b.r)}`;
    const marks = (id, cls) => {
      const p = pts.get(id);
      let d = '';
      for (let k = 1; k < p.length; k++)
        if (p[k].i === p[k - 1].i + 1) d += seg(p[k - 1], p[k]);
      return `<path class="${cls}-l" d="${d}"/>` + p.map((q) => `<circle class="${cls}-d" cx="${x(q.i).toFixed(1)}" cy="${y(q.r)}" r="${cls === 'hl' ? 6 : 4.5}"/>`).join('');
    };
    const lab = (id, ax, px, py) => `<text class="tl" x="${px.toFixed(1)}" y="${py}" text-anchor="${ax}" dy=".32em">${trSvg(trShort(bookOf(id), 22))}</text>`;
    let labels = '';
    for (const id of ids) {
      const p = pts.get(id);
      if (p[0].i === 0) labels += lab(id, 'end', x(0) - 12, y(p[0].r));
      if (p[p.length - 1].i === n - 1) labels += lab(id, 'start', x(n - 1) + 12, y(p[p.length - 1].r));
    }
    let edge = 0;
    ys.forEach((yr, i) => {
      const [id] = T.top10[yr][0];
      if (i === 0 || i === n - 1 || !bookOf(id) || (i && T.top10[ys[i - 1]][0][0] === id)) return;
      const t = trShort(bookOf(id), 20), half = t.length * 3.1 + 2;
      if (x(i) - half < edge || x(i) + half > W - R + 20) return;
      edge = x(i) + half + 6;
      labels += `<text class="tl top" x="${x(i).toFixed(1)}" y="${y(1) - 17}" text-anchor="middle">${trSvg(t)}</text>`;
    });
    const grid = Array.from({ length: 10 }, (_, k) => `<line x1="30" x2="${W - 20}" y1="${y(k + 1)}" y2="${y(k + 1)}"/><text class="ax" x="12" y="${y(k + 1)}" text-anchor="middle" dy=".32em">${k + 1}</text>`).join('');
    const xt = ys.map((yr, i) => `<text class="ax" x="${x(i).toFixed(1)}" y="${y(10) + 26}" text-anchor="middle">${short ? "’" + String(yr).slice(2) : yr}</text>`).join('') +
      `<text class="ax" x="${x(n - 1).toFixed(1)}" y="${y(10) + 40}" text-anchor="middle">进行中</text>`;
    const books = ids.map((id) => {
      const p = pts.get(id), b = bookOf(id);
      const aria = `${trTitle(b)}：${p.map((q) => `${ys[q.i]} 年第 ${q.r} 名`).join('，')}。按回车打开。`;
      return `<g class="bk" data-id="${esc(id)}" tabindex="0" role="link" aria-label="${esc(aria)}">${marks(id, 'bk')}</g>`;
    }).join('');
    geo = {
      W, H, x, y,
      points: ids.flatMap((id) => pts.get(id).map((q, k) => ({ id, k, px: x(q.i), py: y(q.r) }))),
      marks, lab, L, R,
    };
    box.querySelector('.tr-scroll').innerHTML = `<svg class="tr-bump" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-labelledby="bump-t">
    <title id="bump-t">年度排名图：${ys[0]} 至 ${ly} 年每年提及最多的十本书</title>
    <g class="grid">${grid}</g><g class="xax">${xt}</g><g class="books">${books}</g><g class="labels" aria-hidden="true">${labels}</g><g class="over" aria-hidden="true"></g></svg>`;
    if (pinned) show(pinned.id, pinned.k, true);
    else hide();
  }

  const svg = () => box.querySelector('.tr-bump');
  const tip = box.querySelector('.tr-tip');

  function show(id, k, pin = false) {
    const p = pts.get(id)[k], b = bookOf(id), g = geo;
    const s = svg();
    s.classList.add('has-hl');
    const ax = g.x(p.i) < g.L + 40 ? 'start' : g.x(p.i) > g.W - g.R - 40 ? 'end' : 'middle';
    s.querySelector('.over').innerHTML = g.marks(id, 'hl') + `<text class="tl hl-t" x="${g.x(p.i).toFixed(1)}" y="${g.y(p.r) - 14}" text-anchor="${ax}">${trSvg(trShort(b, 30))}</text>` + `<circle class="cur" cx="${g.x(p.i).toFixed(1)}" cy="${g.y(p.r)}" r="9"/>`;
    tip.innerHTML = `<b>${ys[p.i]} 年第 ${p.r} 名${ys[p.i] === ly ? '（进行中）' : ''}</b> · ${fmt(p.u)} 位评论者<br><span>${esc(trTitle(b))}</span>` +
      (pin ? `<br><a href="#/book/${encodeURIComponent(id)}">打开书籍页 →</a>` : '');
    tip.hidden = false;
    tip.dataset.k = k;
    const dot = s.querySelector('.cur').getBoundingClientRect();
    placeTip(box, tip, dot.left + dot.width / 2, dot.top);
    box.dataset.active = id;
  }

  function hide() {
    const s = svg();
    if (!s) return;
    s.classList.remove('has-hl');
    s.querySelector('.over').innerHTML = '';
    tip.hidden = true;
    delete box.dataset.active;
  }
  const nearest = (e) => {
    const r = svg().getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 22 * 22;
    for (const q of geo.points) {
      const d = (q.px - mx) ** 2 + (q.py - my) ** 2;
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  };
  const sc = box.querySelector('.tr-scroll');
  sc.addEventListener('pointermove', (e) => {
    if (pinned || e.pointerType === 'touch') return;
    const q = nearest(e);
    if (q) { if (box.dataset.active !== q.id || tip.dataset.k !== String(q.k)) show(q.id, q.k); }
    else hide();
  });
  sc.addEventListener('pointerleave', () => { if (!pinned && !sc.contains(document.activeElement)) hide(); });
  sc.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const q = nearest(e);
    pinned = q && !(pinned && pinned.id === q.id && pinned.k === q.k) ? { id: q.id, k: q.k } : null;
    if (pinned) show(pinned.id, pinned.k, true);
    else hide();
  });
  sc.addEventListener('focusin', (e) => {
    const id = e.target.closest?.('.bk')?.dataset.id;
    if (!id || pinned) return;
    const p = pts.get(id);
    show(id, p.reduce((m, q, k) => (q.r < p[m].r ? k : m), 0));
  });
  sc.addEventListener('focusout', (e) => { if (!pinned && !sc.contains(e.relatedTarget)) hide(); });
  sc.addEventListener('keydown', (e) => {
    const id = e.target.closest?.('.bk')?.dataset.id;
    if (!id) return;
    if (e.key === 'Enter') { e.preventDefault(); go(`#/book/${encodeURIComponent(id)}`); return; }
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    show(id, Math.max(0, Math.min(pts.get(id).length - 1, +(tip.dataset.k ?? 0) + d)));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pinned) { pinned = null; hide(); }
  }, { signal: ctl.signal });
  document.addEventListener('click', (e) => {
    if (pinned && !box.contains(e.target)) { pinned = null; hide(); }
  }, { signal: ctl.signal });
  ctl.ros.push(watchWidth(sc, draw));
}

function bumpSectionHTML(T) {
  const ys = T.years, co = Object.values(T.stats.carryover);
  const avg = Math.round(co.reduce((a, b) => a + b, 0) / co.length);
  const rows = ys.map((y) => `<tr><th scope="row">${esc(trYear(T, y))}</th><td>${T.top10[y].map(([id, u]) => esc(trTitle(state.byId.get(id) || { t: id })) + `（${u} 人）`).join('；')}</td></tr>`).join('');
  return `<section class="tr-sec" aria-labelledby="tr-h-rank"><h2 id="tr-h-rank">年度十佳</h2>
  <p class="sub">每年被最多不同评论者提及的十本书。有些名字常年盘踞榜首，有些只出现一次。榜单相当粘：平均每年 top 20 里有 ${avg} 本也出现在前一年的 top 20（最少 ${Math.min(...co)} 本）。
  悬停、点按或用 Tab 跟随某本书。<span class="tr-sm">图表可左右滑动查看全部年份。</span> ${ys[0]} 年总量小、噪声更大；${ys[ys.length - 1]} 年数据到 11 月 1 日。</p>
  <div class="tr-box" id="tr-bump"><div class="tr-scroll" tabindex="-1"></div><div class="tr-tip" role="status" hidden></div></div>
  <div class="sr-only"><table><caption>每年提及最多的十本书（附不同评论者人数）</caption><thead><tr><th scope="col">年份</th><th scope="col">Top 10（按提及人数降序）</th></tr></thead><tbody>${rows}</tbody></table></div>
</section>`;
}

/* ---- 对比工具 ---- */
function mountCompare(host, T, ids0, ctl) {
  const n = T.years.length, ly = T.years[n - 1];
  let sel = ids0.map((id, i) => ({ id, slot: i + 1 }));
  host.innerHTML = `<div class="tr-search"><label class="sr-only" for="tr-q">添加要对比的书</label>
    <input id="tr-q" type="text" role="combobox" aria-expanded="false" aria-controls="tr-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="添加要对比的书：输入书名或作者…">
    <ul id="tr-list" role="listbox" aria-label="匹配的书籍" hidden></ul></div>
  <ul class="tr-legend" id="tr-legend" aria-label="正在对比的书籍"></ul>
  <div class="tr-box" id="tr-cbox"><div class="tr-scroll"></div><div class="tr-tip" hidden></div></div>
  <p class="sr-only" id="tr-live" aria-live="polite"></p><div id="tr-table"></div>`;
  const input = $('#tr-q', host), list = $('#tr-list', host), legend = $('#tr-legend', host), cbox = $('#tr-cbox', host), tip = $('.tr-tip', cbox);
  const live = (t) => { $('#tr-live', host).textContent = t; };
  let width = 0, hover = null, results = [], active = -1;
  const bk = (id) => state.byId.get(id);

  let touched = false;
  function sync() {
    if (touched) history.replaceState(null, '', '#/trends?b=' + sel.map((s) => s.id).join(','));
    legend.innerHTML = sel.map((s) => `<li style="--c:var(--tr-${s.slot})"><i class="sw"></i><a href="#/book/${encodeURIComponent(s.id)}">${esc(trTitle(bk(s.id)))}</a>
    <button type="button" class="x" data-id="${esc(s.id)}" aria-label="把《${esc(trTitle(bk(s.id)))}》移出对比">×</button></li>`).join('');
    const full = sel.length >= TR_MAX;
    input.disabled = full;
    input.placeholder = full ? `最多对比 ${TR_MAX} 本，先移除一本` : '添加要对比的书：输入书名或作者…';
    const rows = T.years.map((y, i) => `<tr><th scope="row">${esc(trYear(T, y))}</th>${sel.map((s) => `<td>${trPct(T.books[s.id].p[i])}</td>`).join('')}</tr>`).join('');
    $('#tr-table', host).innerHTML = sel.length ? `<div class="sr-only"><table><caption>各年占全部书籍提及的份额</caption><thead><tr><th scope="col">年份</th>${sel.map((s) => `<th scope="col">${esc(trTitle(bk(s.id)))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>` : '';
    drawChart();
  }

  function drawChart() {
    hover = null;
    tip.hidden = true;
    const sc = $('.tr-scroll', cbox);
    if (!sel.length) {
      sc.innerHTML = '<p class="empty tr-empty">在上方挑一本书，看它占 HN 全部书籍提及的份额如何逐年变化。</p>';
      return;
    }
    const W = Math.max(300, width || cbox.clientWidth - 8), H = W < 480 ? 250 : 320, direct = W >= 560;
    const L = 46, T0 = 16, B = 30, R = direct ? 150 : 16, pw = W - L - R, ph = H - T0 - B;
    const vmax = Math.max(...sel.flatMap((s) => T.books[s.id].p), 0.5);
    const step = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50].find((s) => vmax / s <= 5) || 50, top = Math.ceil(vmax / step) * step;
    const x = (i) => L + (pw * i) / (n - 1), y = (v) => T0 + ph - (ph * v) / top;
    const grid = Array.from({ length: top / step + 1 }, (_, k) => `<line x1="${L}" x2="${W - R}" y1="${y(k * step)}" y2="${y(k * step)}"/><text class="ax" x="${L - 8}" y="${y(k * step)}" text-anchor="end" dy=".32em">${trPct(k * step)}</text>`).join('');
    const every = Math.ceil(34 / (pw / (n - 1)));
    const xt = T.years.map((yr, i) => (n - 1 - i) % every === 0 ? `<text class="ax" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${yr}</text>` : '').join('');
    const lines = sel.map((s) => `<path class="cl" style="stroke:var(--tr-${s.slot})" d="${T.books[s.id].p.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}"/>`).join('');
    let labs = '';
    if (direct) {
      const ends = sel.map((s) => ({ s, y: y(T.books[s.id].p[n - 1]) })).sort((a, b) => a.y - b.y);
      ends.forEach((e, k) => { if (k && e.y < ends[k - 1].y + 14) e.y = ends[k - 1].y + 14; });
      labs = ends.map((e) => `<text class="tl" x="${W - R + 8}" y="${e.y.toFixed(1)}" dy=".32em">${trSvg(trShort(bk(e.s.id), 22))}</text>`).join('');
    }
    sc.innerHTML = `<svg class="tr-cmpchart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="折线图：${T.years[0]} 至 ${ly} 年各书占全部书籍提及的份额，依次为 ${esc(sel.map((s) => trTitle(bk(s.id))).join('、'))}。图表后附数据表。可用左右方向键逐年查看。">
    <g class="grid">${grid}</g><g class="xax">${xt}</g><g>${lines}</g><g class="labels" aria-hidden="true">${labs}</g><g class="cross"></g></svg>`;
    const s = $('svg', sc), cross = $('.cross', s);
    const at = (i, cx, cy) => {
      i = Math.max(0, Math.min(n - 1, i));
      hover = i;
      const rows = sel.map((q) => ({ q, v: T.books[q.id].p[i] })).sort((a, b) => b.v - a.v);
      cross.innerHTML = `<line class="vl" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${T0}" y2="${T0 + ph}"/>` + rows.map((r) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r.v).toFixed(1)}" r="5" style="fill:var(--tr-${r.q.slot})"/>`).join('');
      tip.innerHTML = `<span>${esc(trYear(T, T.years[i]))}</span>` + rows.map((r) => `<div class="r"><i class="sw" style="--c:var(--tr-${r.q.slot})"></i><b>${trPct(r.v)}</b> <span>${esc(trShort(bk(r.q.id), 28))}</span></div>`).join('');
      tip.hidden = false;
      const r = s.getBoundingClientRect();
      placeTip(cbox, tip, cx ?? r.left + x(i), cy ?? r.top + T0 + 24);
    };
    s.addEventListener('pointermove', (e) => {
      const r = s.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - L) / pw) * (n - 1))));
      at(i, r.left + x(i), r.top + T0 + 24);
    });
    s.addEventListener('pointerleave', () => { if (document.activeElement !== s) { cross.innerHTML = ''; tip.hidden = true; } });
    s.addEventListener('focus', () => at(hover ?? n - 1));
    s.addEventListener('blur', () => { cross.innerHTML = ''; tip.hidden = true; });
    s.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (d || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        at(e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (hover ?? n - 1) + d);
      }
    });
  }

  function add(id) {
    if (sel.length >= TR_MAX || sel.some((s) => s.id === id)) return;
    const slot = [1, 2, 3, 4, 5].find((k) => !sel.some((s) => s.slot === k));
    sel.push({ id, slot });
    touched = true;
    live(`已添加《${trTitle(bk(id))}》。正在对比 ${sel.length} 本。`);
    sync();
  }
  legend.addEventListener('click', (e) => {
    const b = e.target.closest('button.x');
    if (!b) return;
    const i = sel.findIndex((s) => s.id === b.dataset.id);
    live(`已移除《${trTitle(bk(sel[i].id))}》。`);
    sel.splice(i, 1);
    touched = true;
    sync();
    (legend.querySelector('button.x') || input).focus();
  });

  const closeList = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const mark = () => {
    [...list.children].forEach((li, k) => li.classList.toggle('on', k === active));
    if (active >= 0) input.setAttribute('aria-activedescendant', 'tr-o' + active);
  };
  function find() {
    const q = input.value.trim();
    if (!q) return closeList();
    results = search(q).filter((b) => T.books[b.id] && !sel.some((s) => s.id === b.id)).slice(0, 8);
    list.innerHTML = results.length ?
      results.map((b, k) => `<li id="tr-o${k}" role="option" data-id="${esc(b.id)}"><b>${esc(trTitle(b))}</b> <span>${esc((b.a || []).slice(0, 2).join(', '))}</span></li>`).join('') :
      '<li class="none" role="presentation">有足够历史数据（60+ 评论者·年）的书里没有匹配项。</li>';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = results.length ? 0 : -1;
    mark();
  }
  const pick = (id) => { add(id); input.value = ''; closeList(); if (!input.disabled) input.focus(); };
  input.addEventListener('input', debounce(find, 80));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) find();
      else { active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length; mark(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!list.hidden && results[active]) pick(results[active].id);
    } else if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); closeList(); }
  });
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) { e.preventDefault(); pick(li.dataset.id); }
  });
  input.addEventListener('blur', closeList);
  ctl.ros.push(watchWidth(cbox, (w) => { width = w - 8; drawChart(); }));
  sync();
}

async function renderTrends(q, restore) {
  const token = routeToken;
  setPage('趋势', '书在 Hacker News 评论里如何升起、登顶与退潮（2008–2026）：年度十佳、常青书、一年爆红与对比工具。');
  const ctl = current = {
    raw: '', shown: () => 0, ros: [], signal: null,
    dispose() { this.ros.forEach((r) => r.disconnect()); this.ac.abort(); },
    ac: new AbortController(),
  };
  ctl.signal = ctl.ac.signal;
  main.innerHTML = '<div class="skel">趋势数据加载中…</div>';
  let T;
  try { T = await getTrends(); } catch (err) {
    console.error(err);
    if (token !== routeToken) return;
    main.innerHTML = '<div class="empty"><h2>趋势数据加载失败</h2><p>请检查网络后重试。</p><p><button class="btn primary" id="retry" type="button">重试</button></p></div>';
    $('#retry').onclick = () => route();
    return;
  }
  if (token !== routeToken) return;
  const asked = (q.get('b') || '').split(',').filter(Boolean).slice(0, TR_MAX);
  const valid = [...new Set(asked)].filter((id) => T.books[id] && state.byId.has(id));
  const ids = valid.length ? valid : TR_DEFAULT.filter((id) => T.books[id] && state.byId.has(id));
  const ly = T.years[T.years.length - 1];
  main.innerHTML = `<div class="page-h"><h1>趋势</h1></div>
  <p class="sub">有些书在 HN 常青不倒，有些书爆红一两年就消失。这里的每个数字都是该书占当年全部书籍提及的份额（按不同评论者计），所以 HN 自身的增长不会影响对比。</p>
  ${bumpSectionHTML(T)}${evergreensHTML(T)}${wavesHTML(T)}
  <section class="tr-sec" id="tr-compare" aria-labelledby="tr-h-cmp"><h2 id="tr-h-cmp">对比书籍</h2>
    <p class="sub">${T.years[0]}–${ly} 年各书占全部书籍提及的份额（${ly} 年数据到 11 月 1 日）。最多添加 ${TR_MAX} 本。${asked.length && !valid.length ? '链接里的书没有趋势数据，先给你看一组默认对比。' : ''}</p>
    <div id="tr-cmp"></div></section>`;
  mountBump($('#tr-bump'), T, ctl);
  mountCompare($('#tr-cmp'), T, ids, ctl);
  if (restore) window.scrollTo(0, restore.y);
  else if (asked.length) $('#tr-compare').scrollIntoView({ block: 'start' });
}

/* ============================== 路由 ============================== */
const scrollMem = new Map();
let navCount = 0, freshNav = false;
history.scrollRestoration = 'manual';

function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const i = raw.indexOf('?');
  return { raw, path: i < 0 ? raw : raw.slice(0, i), query: new URLSearchParams(i < 0 ? '' : raw.slice(i + 1)) };
}

function setActiveNav(name, slug) {
  document.querySelectorAll('#sidebar a').forEach((a) => {
    const on = slug ? a.dataset.slug === slug : a.dataset.route === name;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/** 仅靠 top 切片无法正确渲染的路由。 */
function needsFull(name, seg, query) {
  switch (name) {
    case 'home': case 'top':
      return !!(query.get('dec') || +query.get('since'));
    case 'rising': case 'trends': case 'recommended':
      return true;
    case 'search':
      return !!(query.get('q') || '').trim();
    case 'foryou':
      return profile.views().length > 0;
    case 'list':
      return true;
    case 'topic':
      return state.topicByslug.has(seg[1]);
    default:
      return false;
  }
}

function route() {
  if (!state.meta) return;
  const { raw, path, query } = parseHash();
  const isFresh = freshNav;
  freshNav = false;
  if (current) {
    scrollMem.set(current.raw, { y: window.scrollY, shown: current.shown() });
    current.dispose();
  }
  current = null;
  routeToken++;
  navCount++;
  closeDrawer();

  const restore = !isFresh ? scrollMem.get(raw) : null;
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
  const name = seg[0] || 'home';
  setActiveNav(name, name === 'topic' ? seg[1] : null);
  if (name !== 'search' && $('#q').value && document.activeElement !== $('#q')) $('#q').value = '';

  const render = () => {
    switch (name) {
      case 'home': renderHome(query, restore); break;
      case 'top': renderTop(query, restore); break;
      case 'recommended': renderRecommended(query, restore); break;
      case 'rising': renderRising(query, restore); break;
      case 'trends': renderTrends(query, restore); break;
      case 'foryou': renderForYou(query, restore); break;
      case 'list': renderList(restore); break;
      case 'topic': renderTopic(seg[1], query, restore); break;
      case 'book': renderBook(seg[1]); break;
      case 'search': renderSearch(query); break;
      case 'about': renderAbout(); break;
      default: renderNotFound();
    }
    if (current) current.raw = raw;
    window.scrollTo(0, restore ? restore.y : 0);
  };

  if (!state.full && needsFull(name, seg, query)) {
    const token = routeToken;
    main.innerHTML = '<div class="skel">书库加载中…</div>';
    window.scrollTo(0, 0);
    ensureFull().then(() => { if (token === routeToken) render(); }, (err) => {
      console.error(err);
      if (token !== routeToken) return;
      main.innerHTML = '<div class="empty"><h2>书库加载失败</h2><p>请检查网络后重试。</p><p><button class="btn primary" id="retry" type="button">重试</button></p></div>';
      $('#retry').onclick = () => route();
    });
  } else render();
}

const go = (hash) => { freshNav = true; location.hash = hash; };

// 区分「点击链接的前进导航」（回到顶部）与「前进/后退」（恢复位置）。
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#/"]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  if (a.getAttribute('href') === (location.hash || '#/')) {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (a.classList.contains('chip') || a.hasAttribute('data-replace')) {
    e.preventDefault();
    freshNav = true;
    history.replaceState(null, '', a.getAttribute('href'));
    route();
    return;
  }
  freshNav = true;
});
window.addEventListener('hashchange', route);

/* ============================== 界面框架 ============================== */
const isMobile = () => window.matchMedia('(max-width: 899px)').matches;
const menuBtn = $('#menu-btn');

function closeDrawer() {
  document.body.classList.remove('drawer-open');
  if (isMobile()) menuBtn.setAttribute('aria-expanded', 'false');
}
menuBtn.addEventListener('click', () => {
  if (isMobile()) {
    const open = document.body.classList.toggle('drawer-open');
    menuBtn.setAttribute('aria-expanded', String(open));
  } else {
    const collapsed = document.body.classList.toggle('side-collapsed');
    menuBtn.setAttribute('aria-expanded', String(!collapsed));
    store.set('hb.side', collapsed);
  }
});
$('#scrim').addEventListener('click', closeDrawer);

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  store.set('hb.theme', t);
}
$('#theme-btn').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
});

const help = $('#help');
$('#help-btn').addEventListener('click', () => help.showModal());

// 打赏 / 关注弹窗
$('#reward-btn').addEventListener('click', () => $('#reward-modal').showModal());
$('#follow-btn').addEventListener('click', () => $('#follow-modal').showModal());

// 搜索：输入防抖、回车立即搜。输入过程原地改写历史（replace）。
function goSearch(q, replace) {
  q = q.trim();
  if (!q) return;
  const target = hashFor('/search', { q });
  if (location.hash === target) return;
  if (replace && parseHash().path === '/search') {
    freshNav = true;
    location.replace(target);
  } else go(target);
}
const typeSearch = debounce((q) => goSearch(q, true), 200);
$('#q').addEventListener('input', (e) => typeSearch(e.target.value));
// 搜索依赖全量索引：聚焦即预热（后台 1MB，用户输入时大概率已就绪）
$('#q').addEventListener('focus', () => { ensureFull().catch(() => {}); }, { once: true });

/* 书单收藏与分享图：全站事件委托（卡片按钮在 <a> 内，需拦截默认导航） */
main.addEventListener('click', (e) => {
  if (e.target.closest('#share-img-btn')) { showShareImage().catch(() => {}); return; }
  const btn = e.target.closest('[data-wl]');
  if (!btn) return;
  e.preventDefault();
  const id = btn.dataset.wl;
  const on = wlToggle(id);
  document.querySelectorAll(`[data-wl="${CSS.escape(id)}"]`).forEach((b) => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-label', on ? '移出书单' : '加入书单');
    if (b.classList.contains('btn')) b.textContent = on ? '已在书单' : '想读';
  });
  if (!on && location.hash.startsWith('#/list')) btn.closest('.card')?.remove();
});
$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  goSearch($('#q').value, true);
  $('#q').blur();
});

function renderSidebarTopics() {
  $('#nav-topics').innerHTML = state.topics.map((t) =>
    `<li><a href="#/topic/${encodeURIComponent(t.slug)}" data-slug="${esc(t.slug)}"><span>${esc(t.name)}</span><span class="count">${fmt(t.n)}</span></a></li>`).join('');
}

/* ============================== 快捷键 ============================== */
let gAt = 0;
const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

function moveFocus(dir) {
  const cards = [...main.querySelectorAll('a.card')];
  if (!cards.length) return;
  let i = cards.indexOf(document.activeElement);
  if (i < 0) {
    i = cards.findIndex((c) => c.getBoundingClientRect().top >= 56);
    if (i < 0) i = 0;
    else i -= dir;
  }
  const next = cards[Math.min(cards.length - 1, Math.max(0, i + dir))];
  next.focus();
  next.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (help.open) return;
  const el = document.activeElement;
  if (e.key === 'Escape') {
    if (typing(el)) { el.blur(); return; }
    if (document.body.classList.contains('drawer-open')) { closeDrawer(); return; }
    if (parseHash().path.startsWith('/book/')) {
      if (navCount > 1) history.back();
      else go('#/');
    }
    return;
  }
  if (typing(el)) return;
  const k = e.key;
  if (gAt && Date.now() - gAt < 1000) {
    gAt = 0;
    const dest = { h: '#/', t: '#/top', m: '#/recommended', r: '#/rising', f: '#/foryou', a: '#/about' }[k];
    if (dest) { e.preventDefault(); go(dest); return; }
  }
  if (k === '/') { e.preventDefault(); $('#q').focus(); $('#q').select(); }
  else if (k === '?') { e.preventDefault(); help.showModal(); }
  else if (k === 'j') moveFocus(1);
  else if (k === 'k') moveFocus(-1);
  else if (k === 'g') gAt = Date.now();
});

/* ============================== 预取 ============================== */
// 悬停或聚焦卡片时预取 data/book/<id>.json（防抖、每本一次、省流模式不预取）。
if (!navigator.connection?.saveData) {
  let timer = 0;
  const arm = (e) => {
    const a = e.target.closest?.('a.card');
    if (!a) return;
    const id = decodeURIComponent((a.getAttribute('href') || '').slice('#/book/'.length));
    if (!id || bookCache.has(id)) return;
    clearTimeout(timer);
    timer = setTimeout(() => getBook(id).catch(() => {}), 80);
  };
  const disarm = () => clearTimeout(timer);
  document.addEventListener('pointerenter', arm, true);
  document.addEventListener('pointerleave', disarm, true);
  document.addEventListener('focusin', arm);
  document.addEventListener('focusout', disarm);
}

/* ============================== 启动 ============================== */
(async function boot() {
  if (store.get('hb.side', false) && !isMobile()) {
    document.body.classList.add('side-collapsed');
    menuBtn.setAttribute('aria-expanded', 'false');
  } else menuBtn.setAttribute('aria-expanded', String(!isMobile()));
  main.innerHTML = '<div class="skel">书库加载中…</div>';
  try { await loadBoot(); } catch (err) {
    console.error(err);
    main.innerHTML = '<div class="empty"><h2>数据加载失败</h2><p>请刷新页面重试。</p></div>';
    return;
  }
  renderSidebarTopics();
  if (!hasStance()) $('#nav-main [data-route="recommended"]').parentElement.hidden = true;
  const m = state.meta;
  $('#footer-meta').textContent = `收录 ${fmt(m.n_books)} 本书 · ${fmt(m.n_mentions)} 次提及 · ${m.first_year}–${m.last_year} · 数据生成于 ${m.generated} · 中文版持续同步 hackerbooks.org`;
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
