#!/usr/bin/env python3
"""慢速重试轮：4 并发 + 请求间 250ms 间隔，只抓缺失的详情 JSON。"""
import concurrent.futures as cf
import json, os, sys, time, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
BOOKS = os.path.join(BASE, "data", "books.800bab51.json")
DETAIL_DIR = os.path.join(BASE, "site", "data", "book")
UA = {"User-Agent": "Mozilla/5.0 (site-mirror; contact: joe@qiaomu.ai)"}
os.makedirs(DETAIL_DIR, exist_ok=True)
with open(BOOKS) as f:
    books = json.load(f)
missing = [b["id"] for b in books if not (os.path.exists(os.path.join(DETAIL_DIR, b["id"] + ".json")) and os.path.getsize(os.path.join(DETAIL_DIR, b["id"] + ".json")) > 0)]
print(f"missing {len(missing)}", flush=True)
import threading
lock = threading.Semaphore(4)
def fetch(bid):
    with lock:
        dest = os.path.join(DETAIL_DIR, bid + ".json")
        for i in range(5):
            try:
                req = urllib.request.Request(f"https://hackerbooks.org/data/book/{bid}.json", headers=UA)
                with urllib.request.urlopen(req, timeout=30) as r, open(dest + ".part", "wb") as out:
                    out.write(r.read())
                os.replace(dest + ".part", dest)
                return "ok"
            except Exception as e:
                time.sleep(2 * (i + 1) + 1)
        return "FAIL " + bid
ok = fail = 0
t0 = time.time()
with cf.ThreadPoolExecutor(max_workers=4) as ex:
    for i, res in enumerate(ex.map(fetch, missing), 1):
        if res == "ok": ok += 1
        else: fail += 1; print(res, file=sys.stderr, flush=True)
        if i % 200 == 0:
            print(f"{i}/{len(missing)} ok={ok} fail={fail} ({time.time()-t0:.0f}s)", flush=True)
print(f"DONE retry: ok={ok} fail={fail} in {time.time()-t0:.0f}s", flush=True)
