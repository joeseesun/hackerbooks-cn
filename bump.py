#!/usr/bin/env python3
"""把 index.html 里 app.js/app.css 的 ?v= 设为文件内容 sha1 前 8 位，并同步 sw.js 的 STATIC 与版本号。

用法：在 site/ 目录下 python3 bump.py   （每次改完 app.js / app.css 后运行，再 rsync）
"""
import hashlib, re, sys

def sha8(p):
    return hashlib.sha1(open(p, 'rb').read()).hexdigest()[:8]

idx = open('index.html', encoding='utf-8').read()
versions = {}
for name in ('app.js', 'app.css'):
    v = sha8(name)
    versions[name] = v
    idx, n = re.subn(rf'({re.escape(name)})\?v=[a-zA-Z0-9]+', rf'\1?v={v}', idx)
    print(f'{name} -> ?v={v} ({n} refs)')

sw = open('sw.js', encoding='utf-8').read()
for name, v in versions.items():
    sw, n = re.subn(rf"({re.escape(name)}\?v=)[a-zA-Z0-9]+'", rf"\g<1>{v}'", sw)
    print(f'sw STATIC {name} -> {v} ({n})')
m = re.search(r"const VERSION = 'hb-v(\d+)'", sw)
sw = sw.replace(f"const VERSION = 'hb-v{m.group(1)}'", f"const VERSION = 'hb-v{int(m.group(1)) + 1}'")
open('sw.js', 'w', encoding='utf-8').write(sw)
open('index.html', 'w', encoding='utf-8').write(idx)
print('sw ->', re.search(r"const VERSION = '(hb-v\d+)'", sw).group(1))
