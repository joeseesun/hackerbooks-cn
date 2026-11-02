#!/usr/bin/env python3
"""生成 SEO 静态详情页（site/b/<id>.html）与新 sitemap。

- 范围：books.json 按热度前 N（默认 2000）+ trends 的 waves/evergreens 涉及的书。
- 页面：完整 head（title/description/canonical/OG/JSON-LD Book）+ 语义化正文
  （封面、中英标题、副题、作者、数据、中文简介、高赞评论 3 条、找书链接、回 SPA 链接）。
- 纯静态、无 JS 也能读；视觉复用站点 app.css。
- 用法：python3 gen_pages.py [N]
"""
import html, json, os, sys, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..'))
SITE = os.path.join(ROOT, 'site')
ORIGIN = 'https://hackerbooks.qiaomu.ai'
TODAY = datetime.date.today().isoformat()
N = int(sys.argv[1]) if len(sys.argv) > 1 else 2000

books = json.load(open(os.path.join(SITE, 'data/books.json'), encoding='utf-8'))
by_id = {b['id']: b for b in books}
T = lambda b: b.get('tz') or b['t']
esc = html.escape

trend_ids = set()
trends_path = os.path.join(SITE, 'data/trends.json')
if os.path.exists(trends_path):
    t = json.load(open(trends_path, encoding='utf-8'))
    trend_ids |= set(t.get('books', {}).keys())
    trend_ids |= {w['id'] for w in t.get('waves', [])}
    trend_ids |= {e['id'] for e in t.get('evergreens', [])}

top = [b['id'] for b in books[:N]]
ids = list(dict.fromkeys(top + sorted(trend_ids)))
print(f'generating {len(ids)} static pages')

def detail_of(bid):
    p = os.path.join(SITE, 'data/book', bid + '.json')
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}

def authors_of(b):
    return ', '.join(b.get('a') or [])

def page(bid):
    b = by_id.get(bid, {})
    d = detail_of(bid)
    t, en = T(b), b.get('t', '')
    tz_full = f'{t}（{en}）' if t != en else t
    desc = d.get('dz') or d.get('desc') or ''
    desc_short = desc[:150].rstrip() + ('…' if len(desc) > 150 else '')
    cover = f'{ORIGIN}/covers/{b["c"]}.webp' if b.get('c') is not None else ''
    stats = ''.join(
        f'<li><b>{x[0]}</b><span>{x[1]}</span></li>' for x in [
            (f"{d.get('n', b.get('n', 0)):,}".replace(',', ','), '次提及'),
            (f"{d.get('ru', b.get('ru', 0)):,}", '人推荐'),
            (f"{d.get('u', b.get('u', 0)):,}", '位 HN 评论者'),
        ] if x[0] != '0')
    subs = ''
    if d.get('sz') or d.get('st'):
        subs = f'<p class="st">{esc(d.get("sz") or d.get("st"))}</p>'
        en_title_line = f'{en}: {d["st"]}' if d.get('st') else en
    else:
        en_title_line = en
    comments = []
    for c in (d.get('comments') or [])[:8]:
        if c.get('sv') != 'r':
            continue
        body = c.get('zh') or c.get('x') or ''
        comments.append(f'<blockquote><p>{esc(body)}</p>'
                        f'<cite><a href="https://news.ycombinator.com/item?id={c["id"]}" rel="nofollow noopener" target="_blank">{esc(c.get("by", ""))} 在 HN 的推荐</a></cite></blockquote>')
        if len(comments) >= 3:
            break
    comments_html = ('<h2>Hacker News 读者推荐</h2>' + '\n'.join(comments)) if comments else ''
    buy_q = esc(f'{t} {(b.get("a") or [""])[0]}'.strip())
    st_ = d.get('isbn')
    isbn_link = f'<a class="btn" href="https://openlibrary.org/isbn/{esc(st_)}" rel="nofollow noopener" target="_blank">ISBN {esc(st_)}</a>' if st_ else ''
    ld = {
        '@context': 'https://schema.org', '@type': 'Book',
        'name': en, 'alternateName': t,
        'url': f'{ORIGIN}/b/{bid}.html',
        **({'author': {'@type': 'Person', 'name': authors_of(b)}} if b.get('a') else {}),
        **({'datePublished': str(b['y'])} if b.get('y') else {}),
        **({'image': cover} if cover else {}),
        **({'description': desc_short} if desc_short else {}),
        **({'isbn': st_} if st_ else {}),
    }
    return f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(tz_full)} — 黑客书架</title>
<meta name="description" content="{esc(desc_short)}">
<link rel="canonical" href="{ORIGIN}/b/{bid}.html">
<meta property="og:type" content="book">
<meta property="og:title" content="{esc(tz_full)}">
<meta property="og:description" content="{esc(desc_short)}">
{f'<meta property="og:image" content="{cover}">' if cover else ''}
<link rel="stylesheet" href="/app.css?v=16">
<style>
.bpage {{ max-width: 920px; margin: 0 auto; padding: 32px 40px 80px; }}
.bpage .crumb {{ font-size: 14px; margin-bottom: 22px; }}
.bhead {{ display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 36px; }}
.bhead .cover {{ width: 100%; aspect-ratio: 2/3; object-fit: cover; outline: 1px solid #e2e2e2; outline-offset: -1px; background: #f5f5f3; }}
.bhead h1 {{ margin: 0; font: 500 clamp(30px, 3.6vw, 44px)/1.18 var(--serif); }}
.stats {{ list-style: none; display: flex; gap: 40px; padding: 0; margin: 22px 0 0; }}
.stats li {{ display: flex; flex-direction: column; }}
.stats b {{ font: 500 30px var(--latin); }}
.stats span {{ color: #767676; font-size: 13.5px; }}
.bpage p, .bpage blockquote {{ max-width: 40em; }}
blockquote {{ border-left: 2px solid #e2e2e2; margin: 14px 0; padding: 2px 0 2px 16px; color: #444; }}
blockquote cite {{ font-size: 13px; color: #767676; font-style: normal; }}
.openapp {{ margin-top: 34px; }}
@media (max-width: 700px) {{ .bhead {{ grid-template-columns: 130px minmax(0, 1fr); gap: 20px; }} }}
</style>
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body>
<main class="bpage">
<p class="crumb"><a href="/">← 黑客书架</a></p>
<article>
<div class="bhead">
  <div>{f'<img class="cover" src="/covers/{b["c"]}.webp" alt="{esc(t)} 封面" loading="lazy">' if cover else ''}</div>
  <div>
    <h1>{esc(t)}</h1>
    <p class="t-en">{esc(en_title_line)}</p>
    <p class="by">{esc(authors_of(b)) or '作者未知'}{f' · 初版 {b["y"]} 年' if b.get('y') else ''}</p>
    <ul class="stats">{stats}</ul>
  </div>
</div>
{f'<h2>简介</h2><p>{esc(d["dz"])}</p>' if d.get('dz') else (f'<h2>简介</h2><p>{esc(d["desc"])}</p>' if d.get('desc') else '')}
{comments_html}
<h2>找书</h2>
<p class="links"><a class="btn" href="https://www.douban.com/search?cat=1001&q={buy_q.replace(' ', '+')}" rel="nofollow noopener" target="_blank">豆瓣</a>
<a class="btn" href="https://weread.qq.com/web/search/global?keyword={buy_q.replace(' ', '+')}" rel="nofollow noopener" target="_blank">微信读书</a>
<a class="btn" href="https://search.jd.com/Search?keyword={buy_q.replace(' ', '+')}&enc=utf-8" rel="nofollow noopener" target="_blank">京东</a>
<a class="btn" href="https://openlibrary.org/works/{esc(bid)}" rel="nofollow noopener" target="_blank">Open Library</a>
{isbn_link}</p>
<p class="openapp"><a class="btn primary" href="/#/book/{esc(bid)}">在黑客书架打开完整页面 →</a></p>
<p class="sub">数据整理自 Hacker News 公开评论，数据来源 <a href="https://hackerbooks.org" rel="nofollow noopener" target="_blank">hackerbooks.org</a> 与 Open Library。</p>
</article>
</main>
</body>
</html>'''

outdir = os.path.join(SITE, 'b')
os.makedirs(outdir, exist_ok=True)
generated = []
for bid in ids:
    if bid not in by_id:
        continue
    p = os.path.join(outdir, bid + '.html')
    open(p, 'w', encoding='utf-8').write(page(bid))
    generated.append(bid)
print(f'wrote {len(generated)} pages, total {sum(os.path.getsize(os.path.join(outdir, f)) for f in os.listdir(outdir))//1024}KB')

# sitemap：首页 + b 页
urls = [f'{ORIGIN}/'] + [f'{ORIGIN}/b/{bid}.html' for bid in generated]
sitemap = ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           + '\n'.join(f'<url><loc>{u}</loc></url>' for u in urls)
           + '\n</urlset>\n')
open(os.path.join(SITE, 'sitemap.xml'), 'w', encoding='utf-8').write(sitemap)
print(f'sitemap.xml: {len(urls)} urls')
