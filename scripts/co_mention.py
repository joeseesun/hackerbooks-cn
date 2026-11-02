#!/usr/bin/env python3
"""从 mentions.csv.gz 预计算「同一讨论中被一起提及」推荐。

- 权重：每条 HN 讨论内 k 本书（k>1 且 k<=30，跳过超大脑洞帖）两两共现，各记 1/(k-1)，
  抵消热门大盘帖的爆炸效应；要求共现权重 >= 0.4（约等于至少两场讨论）。
- 输出 translate/co.json：{book_id: [top6 book_id,...]}，并注入 site/data/book/*.json 的 co 字段。
- 用法：python3 co_mention.py [/path/to/mentions.csv.gz]  （默认 /tmp/mentions.csv.gz）
"""
import csv, gzip, json, os, sys
from collections import defaultdict

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..'))
SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/mentions.csv.gz'

# 只保留站内书目
our = set()
for b in json.load(open(os.path.join(ROOT, 'site/data/books.json'), encoding='utf-8')):
    our.add(b['id'])

# 讨论 -> 书集合
disc = defaultdict(set)
with gzip.open(SRC, 'rt', encoding='utf-8') as f:
    for row in csv.DictReader(f):
        w = row['openlibrary_work']
        if w in our:
            disc[row['hn_item_id']].add(w)
print(f'discussions with >=1 our-book: {len(disc)}')

pair_w = defaultdict(lambda: defaultdict(float))
for items in disc.values():
    if not (2 <= len(items) <= 30):
        continue
    items = sorted(items)
    w = 1 / (len(items) - 1)
    for i, a in enumerate(items):
        for b in items[i + 1:]:
            pair_w[a][b] += w
            pair_w[b][a] += w

co = {}
for a, partners in pair_w.items():
    top = sorted(partners.items(), key=lambda kv: -kv[1])
    top = [b for b, w in top if w >= 0.4][:6]
    if top:
        co[a] = top
print(f'books with co-mention recs: {len(co)}')

json.dump(co, open(os.path.join(BASE, 'co.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))

# 注入详情 JSON
n = 0
for bid, ids in co.items():
    p = os.path.join(ROOT, 'site/data/book', bid + '.json')
    if not os.path.exists(p):
        continue
    o = json.load(open(p, encoding='utf-8'))
    if o.get('co') != ids:
        # co 放在 related 之前，保持字段顺序可读
        out = {}
        for k, v in o.items():
            if k == 'related':
                out['co'] = ids
            out[k] = v
        if 'co' not in out:
            out['co'] = ids
        json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        n += 1
print(f'injected co into {n} detail JSONs')
