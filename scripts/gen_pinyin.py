#!/usr/bin/env python3
"""生成拼音搜索索引 site/data/py-index.json：{book_id: [全拼, 首字母]}（只收含中文的书名）。"""
import json, os, re
from pypinyin import lazy_pinyin, Style

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..'))
books = json.load(open(os.path.join(ROOT, 'site/data/books.json'), encoding='utf-8'))
out = {}
for b in books:
    t = b.get('tz') or ''
    if not re.search(r'[\u4e00-\u9fff]', t):
        continue
    full = ''.join(lazy_pinyin(t, style=Style.NORMAL)).lower()
    abbr = ''.join(lazy_pinyin(t, style=Style.FIRST_LETTER)).lower()
    if full:
        out[b['id']] = [full, abbr]
json.dump(out, open(os.path.join(ROOT, 'site/data/py-index.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
import os
print('py-index.json:', len(out), 'books,', os.path.getsize(os.path.join(ROOT, 'site/data/py-index.json')) // 1024, 'KB')
