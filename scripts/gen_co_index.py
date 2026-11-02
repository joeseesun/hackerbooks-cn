#!/usr/bin/env python3
"""把 co.json 压成站内懒加载索引 site/data/co-index.json（为你推荐用）。"""
import json, os
BASE = os.path.dirname(os.path.abspath(__file__))
co = json.load(open(os.path.join(BASE, 'co.json'), encoding='utf-8'))
out = os.path.join(BASE, '..', 'site/data/co-index.json')
json.dump(co, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('co-index.json:', len(co), 'entries')
