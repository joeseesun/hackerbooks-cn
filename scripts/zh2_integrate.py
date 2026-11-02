#!/usr/bin/env python3
"""把 zh2/parts/ 里的翻译进度注入 site/data/book/*.json。

- dz：{bid: 中文简介} → 详情 JSON 的 desc 后插入 dz
- cm：{bid: [中文评论...]} → comments[i] 的 x 后插入 zh（只注入有译文的前 N 条）
支持部分进度：只注入已完成的分块。--dry 只统计不写。
"""
import json, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..'))
BOOK_DIR = os.path.join(ROOT, 'site/data/book')
PARTS = os.path.join(BASE, 'zh2', 'parts')
DRY = '--dry' in sys.argv

def merge(kind):
    merged = {}
    if not os.path.isdir(PARTS):
        return merged
    for fn in sorted(os.listdir(PARTS)):
        if re.match(rf'{kind}_\d+\.json$', fn):
            merged.update(json.load(open(os.path.join(PARTS, fn), encoding='utf-8')))
    return merged

dz = merge('dz')
cm = merge('cm')
print(f'loaded dz={len(dz)} cm={len(cm)}')

n_dz = n_cm = n_files = 0
for bid in dz:
    p = os.path.join(BOOK_DIR, bid + '.json')
    if not os.path.exists(p):
        continue
    o = json.load(open(p, encoding='utf-8'))
    out, changed = {}, False
    for k, v in o.items():
        out[k] = v
        if k == 'desc' and dz.get(bid) and not o.get('dz'):
            out['dz'] = dz[bid]
            changed = True
            n_dz += 1
        if k == 'comments' and cm.get(bid):
            zh = cm[bid]
            out[k] = []
            for i, c in enumerate(v):
                nc = {}
                for ck, cv in c.items():
                    nc[ck] = cv
                    if ck == 'x' and i < len(zh) and not c.get('zh'):
                        nc['zh'] = zh[i]
                        n_cm += 1
                out[k].append(nc)
            changed = True
    if changed and not DRY:
        json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    n_files += changed
print(f'{"[dry] " if DRY else ""}injected: dz={n_dz}, comment zh={n_cm}, files touched={n_files}')
