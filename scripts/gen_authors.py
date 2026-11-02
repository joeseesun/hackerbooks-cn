#!/usr/bin/env python3
"""生成作者聚合静态页 site/author/<slug>.html（热度 Top300 作者）+ data/author-map.json。

gen_pages.py 会读取 author-map.json 在 b 页里把作者名链接到对应聚合页，并把作者页加入 sitemap。
"""
import html, json, os, re
from pypinyin import lazy_pinyin, Style

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..'))
SITE = os.path.join(ROOT, 'site')
ORIGIN = 'https://hackerbooks.qiaomu.ai'
TODAY = __import__('datetime').date.today().isoformat()
TOP_N = 300

books = json.load(open(os.path.join(SITE, 'data/books.json'), encoding='utf-8'))
T = lambda b: b.get('tz') or b['t']
agg = {}
for b in books:
    for a in b.get('a') or []:
        info = agg.setdefault(a, {'n': 0, 'books': []})
        info['n'] += b.get('n') or 0
        info['books'].append(b)
top = sorted(agg.items(), key=lambda kv: -kv[1]['n'])[:TOP_N]

def slugify(name):
    if re.fullmatch(r'[\x20-\x7e]+', name):
        s = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    else:
        s = re.sub(r'[^a-z0-9]+', '-', ''.join(lazy_pinyin(name, style=Style.NORMAL)).lower()).strip('-')
    return s or 'author'

used, author_map = {}, {}
for name, _ in top:
    s = slugify(name)
    while s in used:
        used[s] += 1
        s = f'{s}-{used[s]}'
    used[s] = 0
    author_map[name] = s

json.dump(author_map, open(os.path.join(SITE, 'data/author-map.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
esc = html.escape
fmt = lambda n: f"{n:,}"
outdir = os.path.join(SITE, 'author')
os.makedirs(outdir, exist_ok=True)
for name, info in top.items() if isinstance(top, dict) else top:
    pass
for name, info in top:
    slug = author_map[name]
    bs = sorted(info['books'], key=lambda b: -(b.get('n') or 0))
    cards = ''.join(
        f'<a class="acard" href="/b/{b["id"]}.html"><img src="/covers/{b["c"]}.webp" alt="{esc(T(b))} 封面" loading="lazy">'
        f'<span class="at">{esc(T(b))}</span><span class="an">{fmt(b.get("n",0))} 次提及</span></a>'
        for b in bs if b.get('c') is not None)
    ld = {'@context': 'https://schema.org', '@type': 'Person', 'name': name,
          'url': f'{ORIGIN}/author/{slug}.html'}
    page = f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(name)} — Hacker News 提及的作品 — 黑客书架</title>
<meta name="description" content="{esc(name)} 的 {len(bs)} 部作品在 Hacker News 评论中被提及 {info['n']:,} 次，按提及量排序（中文版书架）。">
<link rel="canonical" href="{ORIGIN}/author/{slug}.html">
<link rel="stylesheet" href="/app.css?v=17">
<style>
.apage {{ max-width: 1080px; margin: 0 auto; padding: 32px 40px 80px; }}
.agrid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 22px 20px; margin-top: 20px; }}
.acard {{ display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: inherit; }}
.acard img {{ width: 100%; aspect-ratio: 2/3; object-fit: cover; outline: 1px solid #e2e2e2; outline-offset: -1px; background: #f5f5f3; }}
.acard .at {{ font: 500 14.5px/1.35 var(--serif); }}
.acard .an {{ color: #767676; font-size: 12.5px; }}
</style>
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
</head>
<body>
<main class="apage">
<p class="crumb"><a href="/">← 黑客书架</a></p>
<h1 style="font:500 clamp(30px,3.6vw,44px)/1.2 var(--serif);margin:0">{esc(name)}</h1>
<p class="sub">{len(bs)} 部作品在 Hacker News 评论中被提及 {info['n']:,} 次，按提及量排序。</p>
<div class="agrid">{cards}</div>
</main>
</body>
</html>'''
    open(os.path.join(outdir, slug + '.html'), 'w', encoding='utf-8').write(page)
print(f'author pages: {len(author_map)}; map saved')
