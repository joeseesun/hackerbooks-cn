#!/usr/bin/env python3
"""把 zh_map.json 注入站点数据：books.json / books-top.json / data/book/*.json。

- tz：中文书名，仅在与英文原题不同时写入（保留英文的 141 条自然回退）
- sz：中文副题，仅在有副题的书上写入
字段插在 t / st 之后，保持可读性；其余字段原样保留。
"""
import json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site')
DATA = os.path.join(ROOT, 'data')
zh = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'zh_map.json'), encoding='utf-8'))

def patch_book(b):
    z = zh.get(b.get('id'))
    if not z:
        return b, False
    out = {}
    changed = False
    for k, v in b.items():
        out[k] = v
        if k == 't' and z.get('t') and z['t'] != v:
            out['tz'] = z['t']
            changed = True
        if k == 'st' and z.get('st') and z['st'] != v:
            out['sz'] = z['st']
            changed = True
    # books.json / books-top.json 行没有 st，副题单独补（sz 放在行尾）
    if 'st' not in b and z.get('st'):
        out['sz'] = z['st']
        changed = True
    return out, changed

def patch_list_file(name):
    path = os.path.join(DATA, name)
    arr = json.load(open(path, encoding='utf-8'))
    n = 0
    out = []
    for b in arr:
        nb, ch = patch_book(b)
        n += ch
        out.append(nb)
    json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False,
              separators=(',', ':'))
    print(f'{name}: {n}/{len(arr)} rows patched, size {os.path.getsize(path):,}')

def patch_details():
    d = os.path.join(DATA, 'book')
    files = [f for f in os.listdir(d) if f.endswith('.json')]
    n = miss = 0
    for i, f in enumerate(files):
        path = os.path.join(d, f)
        o = json.load(open(path, encoding='utf-8'))
        nb, ch = patch_book(o)
        if ch:
            json.dump(nb, open(path, 'w', encoding='utf-8'), ensure_ascii=False,
                      separators=(',', ':'))
            n += 1
        if not zh.get(o.get('id')):
            miss += 1
        if (i + 1) % 3000 == 0:
            print(f'  ... {i+1}/{len(files)}', file=sys.stderr)
    print(f'details: {n}/{len(files)} patched, {miss} without zh entry')

patch_list_file('books.json')
patch_list_file('books-top.json')
patch_details()

# 自检
books = json.load(open(os.path.join(DATA, 'books.json'), encoding='utf-8'))
tz_n = sum(1 for b in books if 'tz' in b)
sz_n = sum(1 for b in books if 'sz' in b)
print(f'verify books.json: tz={tz_n}, sz={sz_n}, total={len(books)}')
assert tz_n > 15000 and sz_n > 1700
print('OK')
