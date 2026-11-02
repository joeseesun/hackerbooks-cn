#!/usr/bin/env python3
"""Scrape all per-book detail JSONs + cover images from hackerbooks.org.

- data/book/<id>.json  (15,362 books)
- covers/<cover_id>.webp
Resumable: skips files that already exist with size > 0.
"""
import concurrent.futures as cf
import json
import os
import sys
import time
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
BOOKS = os.path.join(BASE, "data", "books.800bab51.json")
DETAIL_DIR = os.path.join(BASE, "site", "data", "book")
COVER_DIR = os.path.join(BASE, "site", "covers")
UA = {"User-Agent": "Mozilla/5.0 (site-mirror; contact: joe@qiaomu.ai)"}

os.makedirs(DETAIL_DIR, exist_ok=True)
os.makedirs(COVER_DIR, exist_ok=True)

with open(BOOKS) as f:
    books = json.load(f)
print(f"{len(books)} books in index", flush=True)

book_ids = [b["id"] for b in books]
cover_ids = sorted({b["c"] for b in books if b.get("c") is not None})
print(f"{len(cover_ids)} distinct covers", flush=True)


def fetch(url, dest, tries=4):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return "skip"
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r, open(dest + ".part", "wb") as out:
                out.write(r.read())
            os.replace(dest + ".part", dest)
            return "ok"
        except Exception as e:
            if i == tries - 1:
                return f"FAIL {url}: {e}"
            time.sleep(1.5 * (i + 1))
    return "skip"


def main(kind):
    if kind == "details":
        jobs = [(f"https://hackerbooks.org/data/book/{bid}.json",
                 os.path.join(DETAIL_DIR, f"{bid}.json")) for bid in book_ids]
    else:
        jobs = [(f"https://covers.hackerbooks.org/c/{cid}.webp",
                 os.path.join(COVER_DIR, f"{cid}.webp")) for cid in cover_ids]
    ok = skip = fail = 0
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=12) as ex:
        for i, res in enumerate(ex.map(lambda j: fetch(*j), jobs), 1):
            if res == "ok":
                ok += 1
            elif res == "skip":
                skip += 1
            else:
                fail += 1
                print(res, file=sys.stderr, flush=True)
            if i % 500 == 0:
                print(f"{kind}: {i}/{len(jobs)} ok={ok} skip={skip} fail={fail} "
                      f"({time.time()-t0:.0f}s)", flush=True)
    print(f"DONE {kind}: ok={ok} skip={skip} fail={fail} in {time.time()-t0:.0f}s", flush=True)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "details")
