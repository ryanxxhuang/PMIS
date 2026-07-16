#!/usr/bin/env python3
"""把 src/data/workItems.json 壓成欄式(columnar)的 workItems.compact.json(P-05)。

範例標單 3,262 項 × 19 個重複 key ≈ 檔案一半是 key 字串;欄式編碼
{ meta, cols, rows } 把 key 只存一次,demo chunk 從 ~1.38MB 降到約一半,
JSON parse 也快。rehydrate 在 src/lib/boqCalc.js;等價性由
src/lib/workItemsCompact.test.js 逐項 deep-compare 保證。

重跑時機:scripts/import_boq.py 重新產出 workItems.json 之後。
    python3 scripts/compact_workitems.py
"""
import json
import os

SRC = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'workItems.json')
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'workItems.compact.json')

def main():
    with open(SRC, encoding='utf-8') as f:
        d = json.load(f)
    items = d['items']
    keysets = {tuple(sorted(it.keys())) for it in items}
    assert len(keysets) == 1, f'items 欄位不整齊({len(keysets)} 種組合),欄式編碼會失真——請改回原格式或補齊欄位'
    cols = sorted(keysets.pop())
    rows = [[it[c] for c in cols] for it in items]
    compact = {'meta': d['meta'], 'cols': list(cols), 'rows': rows}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(compact, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(rows)} items, {len(cols)} cols -> {OUT}')
    print(f'原檔 {os.path.getsize(SRC):,} bytes -> 壓縮 {os.path.getsize(OUT):,} bytes')

if __name__ == '__main__':
    main()
