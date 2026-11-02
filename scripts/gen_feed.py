#!/usr/bin/env python3
"""生成 RSS 订阅 site/feed.xml：当前「上升最快」的趋势书（每周数据更新时重新生成）。"""
import json, html, os, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..'))
SITE = os.path.join(ROOT, 'site')
ORIGIN = 'https://hackerbooks.qiaomu.ai'
esc = html.escape

books = {b['id']: b for b in json.load(open(os.path.join(SITE, 'data/books.json'), encoding='utf-8'))}
trends = json.load(open(os.path.join(SITE, 'data/trends.json'), encoding='utf-8'))
waves = [w for w in trends.get('waves', []) if w.get('rising')][:10]

items = []
for w in waves:
    b = books.get(w['id'])
    if not b:
        continue
    t = b.get('tz') or b['t']
    en = b['t'] if t != b['t'] else ''
    bid_path = f"b/{w['id']}.html" if os.path.exists(os.path.join(SITE, 'b', w['id'] + '.html')) else '#/book/' + w['id']
    link = f'{ORIGIN}/{bid_path}' if not bid_path.startswith('#') else f'{ORIGIN}/{bid_path}'
    try:
        d = json.load(open(os.path.join(SITE, 'data/book', w['id'] + '.json'), encoding='utf-8'))
        desc_src = d.get('dz') or d.get('desc') or ''
    except FileNotFoundError:
        desc_src = ''
    cap = f"{w['pu']} 位 HN 读者提及，{w['py']} 年快速上升"
    desc = f'{esc(cap)}。{esc(desc_src[:180])}'
    title = f'{t}（{en}）' if en else t
    items.append(f'''<item>
<title>{esc(title)}</title>
<link>{esc(link)}</link>
<guid isPermaLink="false">hackerbooks-rise-{w['id']}</guid>
<pubDate>{datetime.datetime.now(datetime.timezone.utc).strftime('%a, %d %b %Y %H:%M:%S GMT')}</pubDate>
<description>{desc}</description>
</item>''')

xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>黑客书架 · 上升最快</title>
<link>{ORIGIN}/#/rising</link>
<description>Hacker News 评论中被提及的书籍：近期上升最快的中文书架精选（每周随数据更新）</description>
<language>zh-CN</language>
<lastBuildDate>{datetime.datetime.now(datetime.timezone.utc).strftime('%a, %d %b %Y %H:%M:%S GMT')}</lastBuildDate>
{chr(10).join(items)}
</channel>
</rss>
'''
open(os.path.join(SITE, 'feed.xml'), 'w', encoding='utf-8').write(xml)
print(f'feed.xml: {len(items)} items')
