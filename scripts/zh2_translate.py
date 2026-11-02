#!/usr/bin/env python3
"""批量翻译书籍描述（dz）与高赞评论（cm top-10/书）为中文。

- 输入：site/data/book/*.json（desc、comments[].x）
- 通道：aigocode-team-gemini / gemini-3.8-flash（测速最快且质量合格）
- 分块：按总字符数贪心打包（dz ≤12000 字符，cm ≤12000 字符且 ≤10 本书），热度优先
- 产出：translate/zh2/parts/{dz,cm}_####.json（可断点续跑），结束后合并 translate/zh2/{dz,cm}.json
- 校验：键集合一致、cm 长度一致、非空；失败重试 3 次
"""
import json, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, '..'))
BOOK_DIR = os.path.join(ROOT, 'site/data/book')
OUT = os.path.join(BASE, 'zh2')
PARTS = os.path.join(OUT, 'parts')
CLI = '/Users/joe/.agents/skills/qiaomu-llm/scripts/qiaomu_llm.py'
PROVIDER, MODEL = 'aigocode-team-gemini', 'gemini-3.8-flash'
WORKERS = 8
MAX_RETRY = 3
CHAR_CAP = 12000
CM_BOOKS_CAP = 10

DZ_INSTR = ('把下面 JSON 对象里每本书的英文简介翻译成简体中文：忠实、流畅、保持原意与长度量级，专业术语和书名照常保留英文。'
            '直接输出一个 JSON 对象（键与输入完全相同、值为中文译文，UTF-8 不转义），不要任何解释或代码围栏。\n输入：\n')
CM_INSTR = ('下面 JSON 对象的每本书对应一组 Hacker News 评论（值是字符串数组）。把每条评论翻译成简体中文：'
            '口语化、忠实原意、保留梗和技术术语英文，评论里的省略号截断照译。'
            '直接输出一个 JSON 对象（键与输入完全相同，值为中文译文字符串数组、长度与输入一一对应，UTF-8 不转义），不要任何解释或代码围栏。\n输入：\n')

os.makedirs(PARTS, exist_ok=True)

def load_books():
    """按热度顺序返回 [(id, desc, [top10 comment texts])]。"""
    order = [b['id'] for b in json.load(open(os.path.join(ROOT, 'site/data/books.json'), encoding='utf-8'))]
    out = []
    for bid in order:
        p = os.path.join(BOOK_DIR, bid + '.json')
        if not os.path.exists(p):
            continue
        o = json.load(open(p, encoding='utf-8'))
        desc = (o.get('desc') or '').strip()
        cm = [c.get('x', '') for c in (o.get('comments') or [])[:10]]
        cm = [('' if not isinstance(x, str) else x.strip()) for x in cm]
        out.append((bid, desc, [x for x in cm if x]))
    return out

def build_chunks(books, kind):
    """贪心打包成 [(chunk_id, {bid: text|texts})]。"""
    cap = CHAR_CAP
    chunks, cur, cur_len = [], {}, 0
    for bid, desc, cm in books:
        payload = desc if kind == 'dz' else cm
        if not payload:
            continue
        plen = sum(len(x) for x in payload) if isinstance(payload, list) else len(payload)
        if cur and (cur_len + plen > cap or (kind == 'cm' and len(cur) >= CM_BOOKS_CAP)):
            chunks.append(cur); cur, cur_len = {}, 0
        cur[bid] = payload
        cur_len += plen
    if cur:
        chunks.append(cur)
    return chunks

def call_llm(prompt):
    r = subprocess.run(
        ['python3', CLI, 'test', PROVIDER, '--mode', 'chat', '--model', MODEL,
         '--max-tokens', '30000', '--full', '--timeout', '600', '--prompt', prompt],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'CLI exit {r.returncode}: {r.stderr[-200:]}')
    d = json.loads(r.stdout)
    if d.get('status') != 'ok':
        raise RuntimeError(f"status {d.get('status')}")
    return d.get('content') or ''

def extract_obj(text, src):
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text.strip(), flags=re.S)
    o = json.loads(text[text.find('{'):text.rfind('}') + 1])
    assert isinstance(o, dict) and set(o.keys()) == set(src.keys()), f'keys mismatch: got {len(o or {})} want {len(src)}'
    for k, v in o.items():
        if isinstance(src[k], list):
            assert isinstance(v, list) and len(v) == len(src[k]), f'{k}: len mismatch'
            assert all(isinstance(x, str) and x.strip() for x in v), f'{k}: bad items'
        else:
            assert isinstance(v, str) and v.strip(), f'{k}: bad value'
    return o

def do_chunk(kind, cid, src):
    pf = os.path.join(PARTS, f'{kind}_{cid:04d}.json')
    if os.path.exists(pf):
        try:
            if set(json.load(open(pf))) == set(src.keys()):
                return 'skip'
        except Exception:
            pass
    instr = DZ_INSTR if kind == 'dz' else CM_INSTR
    payload = {k: (v if isinstance(v, str) else [x[:1500] for x in v]) for k, v in src.items()}
    prompt = instr + json.dumps(payload, ensure_ascii=False)
    for attempt in range(1, MAX_RETRY + 1):
        t0 = time.time()
        try:
            out = extract_obj(call_llm(prompt), src)
            json.dump(out, open(pf, 'w', encoding='utf-8'), ensure_ascii=False)
            return f'ok {time.time()-t0:.0f}s'
        except Exception as e:
            print(f'{kind}_{cid:04d} attempt {attempt} FAIL: {str(e)[:150]}', flush=True)
            time.sleep(3 * attempt)
    return 'failed'

def main():
    only = sys.argv[1] if len(sys.argv) > 1 else 'all'
    books = load_books()
    kinds = ['dz', 'cm'] if only == 'all' else [only]
    for kind in kinds:
        chunks = build_chunks(books, kind)
        pending = [c for i, c in enumerate(chunks)
                   if not os.path.exists(os.path.join(PARTS, f'{kind}_{i:04d}.json'))]
        print(f'[{kind}] chunks: {len(chunks)}, pending: {len(pending)}', flush=True)
        done = fails = 0
        t0 = time.time()
        with ThreadPoolExecutor(max_workers=WORKERS) as ex:
            futs = {ex.submit(do_chunk, kind, i, c): (i, c) for i, c in enumerate(chunks)}
            # 已有部分文件的分块 do_chunk 会秒回 skip，无需在此过滤
            for f in as_completed(futs):
                cid, src = futs[f]
                try:
                    r = f.result()
                except Exception as e:
                    r = f'failed {e}'
                if r == 'failed':
                    fails += 1
                else:
                    done += 1
                    if done % 20 == 0:
                        el = time.time() - t0
                        print(f'[{kind}] {done}/{len(chunks)} done ({el:.0f}s, {done/el:.2f}/s), fails={fails}', flush=True)
        print(f'[{kind}] FINISHED done={done} fails={fails}', flush=True)

    # 合并
    for kind in kinds:
        merged = {}
        for fn in sorted(os.listdir(PARTS)):
            if fn.startswith(kind + '_'):
                merged.update(json.load(open(os.path.join(PARTS, fn), encoding='utf-8')))
        json.dump(merged, open(os.path.join(OUT, kind + '.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, separators=(',', ':'))
        print(f'[{kind}] merged: {len(merged)} entries', flush=True)

if __name__ == '__main__':
    main()
