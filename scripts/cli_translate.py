#!/usr/bin/env python3
"""直连 Magpie deepseek-flash 翻译剩余批次（005/010/015），分块+校验+重试。"""
import json, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed

TD = os.path.dirname(os.path.abspath(__file__))
CLI = '/Users/joe/.agents/skills/qiaomu-llm/scripts/qiaomu_llm.py'
MODEL = 'deepseek/deepseek-flash'
CHUNK = 200
WORKERS = 4
MAX_RETRY = 3

INSTR = (
    '把下面的 JSON 数组里的每个英文书名翻译成简体中文书名。规则：'
    '1) 有通行中文版书名的用通行译名（如 The Mythical Man-Month → 人月神话）；'
    '2) 没有通行译名的忠实意译，简洁自然，不加书名号《》；'
    '3) 技术书中文名普遍直接用英文的（如 On Lisp、Ruby For Rails）可保留英文或中英混排；'
    '4) 纯数字、代码、代号类书名原样保留；'
    '5) 中文内部用全角标点，破折号用「——」；'
    '6) 源条目若有杂质（尾部 =、ISBN、乱码），按可译的标题本体翻译。'
    '直接输出一个 JSON 字符串数组（UTF-8，不要转义中文），不要任何解释或代码围栏，长度必须与输入数组一致、顺序一一对应。\n'
    '输入：\n'
)

def call_llm(prompt: str, timeout: int = 900) -> str:
    r = subprocess.run(
        ['python3', CLI, 'test', 'magpie-openai', '--mode', 'chat', '--model', MODEL,
         '--max-tokens', '24000', '--full', '--prompt', prompt, '--timeout', str(timeout)],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'CLI exit {r.returncode}: {r.stderr[-300:]}')
    data = json.loads(r.stdout)
    if data.get('status') != 'ok':
        raise RuntimeError(f"CLI status {data.get('status')}: {str(data)[:300]}")
    return data.get('content') or ''

def extract_array(text: str, n: int):
    text = text.strip()
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text, flags=re.S)
    m = text.find('[')
    if m == -1:
        raise ValueError('no JSON array found')
    arr = json.loads(text[m:text.rfind(']') + 1])
    if not isinstance(arr, list) or len(arr) != n:
        raise ValueError(f'array len {len(arr) if isinstance(arr, list) else "?"} != {n}')
    out = []
    for i, x in enumerate(arr):
        if not isinstance(x, str) or not x.strip():
            raise ValueError(f'item {i} not non-empty string: {x!r}')
        out.append(x.strip())
    return out

def do_chunk(batch: int, lo: int, chunk: list) -> str:
    part = f'part_{batch}_{lo}.json'
    pf = os.path.join(TD, part)
    if os.path.exists(pf):
        try:
            if len(json.load(open(pf))) == len(chunk):
                return part
        except Exception:
            pass
    src = os.path.join(TD, f'src_{batch:03d}.json')
    sub = os.path.join(TD, f'subin_{batch}_{lo}.json')
    json.dump(chunk, open(sub, 'w', encoding='utf-8'), ensure_ascii=False)
    prompt = INSTR + open(sub, encoding='utf-8').read()
    os.remove(sub)
    for attempt in range(1, MAX_RETRY + 1):
        t0 = time.time()
        try:
            content = call_llm(prompt)
            out = extract_array(content, len(chunk))
            json.dump(out, open(pf, 'w', encoding='utf-8'), ensure_ascii=False)
            print(f'batch {batch} chunk {lo}: OK ({time.time()-t0:.0f}s, attempt {attempt})', flush=True)
            return part
        except Exception as e:
            print(f'batch {batch} chunk {lo}: attempt {attempt} FAILED: {e}', flush=True)
            time.sleep(5 * attempt)
    raise RuntimeError(f'batch {batch} chunk {lo}: exhausted retries')

def main(batches):
    jobs = []
    for batch in batches:
        src = json.load(open(os.path.join(TD, f'src_{batch:03d}.json'), encoding='utf-8'))
        for lo in range(0, len(src), CHUNK):
            jobs.append((batch, lo, src[lo:lo + CHUNK]))
    print(f'{len(jobs)} chunks to translate', flush=True)
    failed = []
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(do_chunk, b, lo, c): (b, lo) for b, lo, c in jobs}
        for f in as_completed(futs):
            b, lo = futs[f]
            try:
                f.result()
            except Exception as e:
                failed.append((b, lo))
                print(f'FINAL FAIL batch {b} chunk {lo}: {e}', flush=True)
    # assemble
    for batch in batches:
        src = json.load(open(os.path.join(TD, f'src_{batch:03d}.json'), encoding='utf-8'))
        parts = sorted((p for p in os.listdir(TD)
                        if re.match(rf'part_{batch}_\d+\.json$', p)),
                       key=lambda p: int(re.search(r'_(\d+)\.json$', p).group(1)))
        if not parts:
            print(f'batch {batch}: no parts, skip assemble', flush=True)
            continue
        merged = []
        for p in parts:
            merged += json.load(open(os.path.join(TD, p), encoding='utf-8'))
        if len(merged) == len(src):
            json.dump(merged, open(os.path.join(TD, f'batch_{batch:03d}.json'), 'w',
                                   encoding='utf-8'), ensure_ascii=False)
            print(f'batch {batch:03d}.json assembled: {len(merged)}', flush=True)
        else:
            print(f'batch {batch}: merged {len(merged)} != {len(src)}, NOT assembled', flush=True)
    print('FAILED CHUNKS:', failed if failed else 'none', flush=True)

if __name__ == '__main__':
    main([int(x) for x in sys.argv[1:]] or [5, 10, 15])
