#!/usr/bin/env python3
"""
PCCES 預算書/標單（eTender XML）→ work_items 匯入器。

讀取政府電子採購 PCCES 預算書 XML 的 <DetailList>（詳細價目表），
攤平成 work_items 結構，輸出 src/data/workItems.json。

用法:
    python3 scripts/import_boq.py [預算書.xml] [-o 輸出.json]

不帶參數時，預設讀取本案附的預算書。輸出含：
  meta  — 專案抬頭（名稱/機關/契約編號）與金額彙總
  items — 扁平工項陣列（含 parent_key，前端自行組樹）
純結構化解析，不依賴 AI，可重現、100% 準確。
"""
import sys, os, json, argparse
import xml.etree.ElementTree as ET

NS = '{http://pcstd.pcc.gov.tw/2003/eTender}'

DEFAULT_XML = os.path.join(
    os.path.dirname(__file__), '..',
    '發包圖說20200715', '預算', '預算書',
    '(預算書)國際原住民文化創意產業園區新建工程20200710_ap_bdgt.xml',
)
DEFAULT_OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'workItems.json')

# 加總時要排除的「合計」列：subtotal 是「合計(xxx)」列，金額重複母項，須排除。
# 注意 formula（營業稅、保險費）是真實且不重複的發包金額，不可排除。
ROLLUP_KINDS = {'subtotal'}


def tag(e):
    return e.tag.replace(NS, '')


def ztext(e, name, lang='zh-TW'):
    """取子元素文字，優先 zh-TW；空白字串視為空。"""
    for c in e:
        if tag(c) == name and (c.get('language') in (None, lang)):
            return (c.text or '').strip()
    return ''


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def parse(xml_path):
    root = ET.parse(xml_path).getroot()
    info = root.find(NS + 'TenderInformation')
    detail = root.find(NS + 'DetailList')

    meta = {
        'contract_no': (info.get('contractNo') or '').strip() if info is not None else '',
        'owner_name': ztext(info, 'ProcuringEntity') if info is not None else '',
        'project_name': ztext(info, 'ContractTitle') if info is not None else '',
        'location': ztext(info, 'ContractLocation') if info is not None else '',
    }

    items = []
    order = [0]

    def walk(node, parent_key, depth, section):
        for c in node:
            if tag(c) != 'PayItem':
                continue
            item_no = (c.get('itemNo') or '').strip()
            kind = c.get('itemKind') or ''
            children = [x for x in c if tag(x) == 'PayItem']
            is_leaf = not children

            # 頂層分段（壹/貳/參/肆…）：depth==1 且 itemNo 為單一字（無「.」）
            sect = section
            if depth == 1 and item_no and '.' not in item_no:
                sect = item_no

            desc = ztext(c, 'Description')
            # 非發包工程費標記出現在「參/肆」分段描述中
            order[0] += 1
            item = {
                'item_key': (c.get('itemKey') or '').strip(),
                'parent_key': parent_key,
                'item_no': item_no,
                'ref_item_code': (c.get('refItemCode') or '').strip(),
                'item_kind': kind,
                'description': desc,
                'unit': ztext(c, 'Unit'),
                'quantity': num(ztext(c, 'Quantity')),
                'unit_price': num(ztext(c, 'Price')),
                'amount': num(ztext(c, 'Amount')),
                'section': sect,
                'depth': depth,
                'sort_order': order[0],
                'is_leaf': is_leaf,
                'is_rollup': kind in ROLLUP_KINDS,
                'is_price_adjustable': kind == 'variablePrice',
                # 發包工程費 = 壹、貳；參、肆 為非發包（間接成本 / 機關收入）
                'is_billable': sect in ('壹', '貳'),
                'remark': ztext(c, 'Remark'),
                'weight': None,  # 下方計算
            }
            items.append(item)
            walk(c, item['item_key'], depth + 1, sect)

    walk(detail, None, 1, None)

    # 進度權重：發包工程費的「末端、非合計」工項，amount / 發包末端總額
    billable_leaf_total = sum(
        (it['amount'] or 0)
        for it in items
        if it['is_billable'] and it['is_leaf'] and not it['is_rollup']
    )
    if billable_leaf_total:
        for it in items:
            if it['is_billable'] and it['is_leaf'] and not it['is_rollup']:
                it['weight'] = round((it['amount'] or 0) / billable_leaf_total, 8)

    # 金額彙總（取頂層 mainItem 與 subtotal）
    top = [it for it in items if it['depth'] == 1]
    meta['top_level'] = [
        {'item_no': it['item_no'], 'description': it['description'],
         'kind': it['item_kind'], 'amount': it['amount']}
        for it in top
    ]
    meta['billable_total'] = round(billable_leaf_total)
    meta['item_count'] = len(items)
    meta['leaf_count'] = sum(1 for it in items if it['is_leaf'] and not it['is_rollup'])

    return meta, items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xml', nargs='?', default=DEFAULT_XML)
    ap.add_argument('-o', '--out', default=DEFAULT_OUT)
    args = ap.parse_args()

    meta, items = parse(args.xml)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump({'meta': meta, 'items': items}, f,
                  ensure_ascii=False, separators=(',', ':'))

    size_kb = os.path.getsize(args.out) / 1024
    print(f"✓ 解析 {meta['item_count']} 個工項 → {args.out} ({size_kb:.0f} KB)")
    print(f"  專案：{meta['project_name']}（{meta['owner_name']}，契約 {meta['contract_no']}）")
    print(f"  發包末端工項：{meta['leaf_count']} 項，發包工程費合計 {meta['billable_total']:,.0f}")
    print("  頂層分段：")
    for t in meta['top_level']:
        amt = f"{t['amount']:,.0f}" if t['amount'] is not None else '-'
        print(f"    {t['item_no'] or '(合計)':6} {t['kind']:9} {amt:>16}  {t['description']}")


if __name__ == '__main__':
    main()
