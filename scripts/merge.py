#!/usr/bin/env python3
"""校验并合并 translate/ 下的翻译批次，产出 zh_map.json（id -> {t, st?}）。

- 书名批次 batch_001..014 各 1000 条，batch_015 1362 条，按 ids.txt 顺序拼接；
- 副标题 sub_batch_001(860)+sub_batch_002(855)，按 subs_ids.txt 顺序拼接；
- 校验：JSON 合法、长度一致、无空串、无未闭合占位符。
"""
import json, re, sys, unicodedata, os

TD = os.path.dirname(os.path.abspath(__file__))

def load(path):
    return json.load(open(os.path.join(TD, path), encoding='utf-8'))

def check(arr, n, name):
    assert isinstance(arr, list), f'{name}: not a list'
    assert len(arr) == n, f'{name}: len {len(arr)} != {n}'
    for i, x in enumerate(arr):
        assert isinstance(x, str), f'{name}[{i}]: {type(x)}'
        assert x.strip() != '', f'{name}[{i}]: empty'
        assert 'TODO' not in x and '待翻译' not in x and '未翻译' not in x, f'{name}[{i}]: placeholder {x!r}'
        if len(x) > 200:
            print(f'WARN {name}[{i}] long ({len(x)}): {x[:60]}')
    return [unicodedata.normalize('NFC', x).strip() for x in arr]

titles  = [json.loads(l) for l in open(os.path.join(TD, 'titles.txt'), encoding='utf-8')]
ids     = [l.strip() for l in open(os.path.join(TD, 'ids.txt'), encoding='utf-8')]
subs    = [json.loads(l) for l in open(os.path.join(TD, 'subs.txt'), encoding='utf-8')]
sub_ids = [l.strip() for l in open(os.path.join(TD, 'subs_ids.txt'), encoding='utf-8')]
assert len(titles) == len(ids) == 15362
assert len(subs) == len(sub_ids) == 1715

zh = []
for i in range(1, 15):
    zh += check(load(f'batch_{i:03d}.json'), 1000, f'batch_{i:03d}')
zh += check(load('batch_015.json'), 1362, 'batch_015')
zh = [unicodedata.normalize('NFC', x).strip() for x in zh]
assert len(zh) == 15362

zs = check(load('sub_batch_001.json'), 860, 'sub_batch_001') + check(load('sub_batch_002.json'), 855, 'sub_batch_002')
zs = [unicodedata.normalize('NFC', x).strip() for x in zs]
assert len(zs) == 1715

# 对位检查：纯数字/代号类书名译文应保持一致
titles  = [json.loads(l) for l in open(os.path.join(TD, 'titles.txt'), encoding='utf-8')]
digits = [i for i, t in enumerate(titles) if re.fullmatch(r'[\d\s:.\-]+', t.strip()) and t.strip()]
bad = [(i, titles[i].strip(), zh[i]) for i in digits
       if not (zh[i].strip() == titles[i].strip() or zh[i].strip().startswith(titles[i].strip()))]
assert not bad, f'digit-title misalignment: {bad[:5]}'
print(f'digit-title alignment OK ({len(digits)} checked)')

# 未译率统计（纯 ASCII 视为保留原文）
def is_ascii(s): return all(ord(c) < 128 for c in s)
n_ascii = sum(1 for x in zh if is_ascii(x))
n_sub_ascii = sum(1 for x in zs if is_ascii(x))
print(f'book titles untranslated(ascii): {n_ascii}/15362')
print(f'subtitles untranslated(ascii): {n_sub_ascii}/1715')

zh_map = {bid: {'t': t} for bid, t in zip(ids, zh)}
for sid, s in zip(sub_ids, zs):
    if sid in zh_map:
        zh_map[sid]['st'] = s
json.dump(zh_map, open(os.path.join(TD, 'zh_map.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print(f'zh_map.json written: {len(zh_map)} entries, with subtitle: {sum(1 for v in zh_map.values() if "st" in v)}')
print('ALL CHECKS PASSED')
