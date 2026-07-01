// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { parsePccesXml } from './parsePcces.js'

// 縮小版 PCCES eTender XML：發包段（壹）＋ 非發包段（貳），
// 含雙語 Description、合計列(subtotal)、物調列(variablePrice)。
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<ETenderSheet xmlns="http://pcces.pcc.gov.tw">
  <TenderInformation contractNo="C123">
    <ProcuringEntity language="zh-TW">某機關</ProcuringEntity>
    <ContractTitle language="zh-TW">測試工程</ContractTitle>
    <ContractTitle language="en">Test Project</ContractTitle>
    <ContractLocation language="zh-TW">臺北市</ContractLocation>
  </TenderInformation>
  <DetailList>
    <PayItem itemKey="k1" itemNo="壹" itemKind="section">
      <Description language="zh-TW">發包工程費</Description>
      <PayItem itemKey="k11" itemNo="壹.一" itemKind="normal">
        <Description language="zh-TW">結構工程</Description>
        <PayItem itemKey="k111" itemNo="1" itemKind="normal" refItemCode="03210">
          <Description language="zh-TW">鋼筋</Description>
          <Description language="en">Rebar</Description>
          <Unit language="zh-TW">T</Unit>
          <Quantity>100</Quantity><Price>20000</Price><Amount>2000000</Amount>
        </PayItem>
        <PayItem itemKey="k112" itemNo="2" itemKind="normal">
          <Description language="zh-TW">混凝土</Description>
          <Unit language="zh-TW">M3</Unit>
          <Quantity>500</Quantity><Price>2000</Price><Amount>1000000</Amount>
        </PayItem>
        <PayItem itemKey="k119" itemKind="subtotal">
          <Description language="zh-TW">小計</Description>
          <Amount>3000000</Amount>
        </PayItem>
      </PayItem>
      <PayItem itemKey="k12" itemNo="壹.二" itemKind="variablePrice">
        <Description language="zh-TW">物價調整費</Description>
        <Quantity>1</Quantity><Price>0</Price><Amount>0</Amount>
      </PayItem>
    </PayItem>
    <PayItem itemKey="k2" itemNo="貳" itemKind="section">
      <Description language="zh-TW">非發包成本</Description>
      <PayItem itemKey="k21" itemNo="貳.一" itemKind="normal">
        <Description language="zh-TW">工程管理費</Description>
        <Quantity>1</Quantity><Price>50000</Price><Amount>50000</Amount>
      </PayItem>
    </PayItem>
  </DetailList>
</ETenderSheet>`

describe('parsePccesXml', () => {
  const { meta, items } = parsePccesXml(XML)
  const byKey = Object.fromEntries(items.map((it) => [it.item_key, it]))

  it('讀出標案 meta（zh-TW 優先）', () => {
    expect(meta.contract_no).toBe('C123')
    expect(meta.owner_name).toBe('某機關')
    expect(meta.project_name).toBe('測試工程')
    expect(meta.location).toBe('臺北市')
  })

  it('樹狀結構：parent_key / depth / sort_order / is_leaf', () => {
    expect(byKey.k111.parent_key).toBe('k11')
    expect(byKey.k11.parent_key).toBe('k1')
    expect(byKey.k1.depth).toBe(1)
    expect(byKey.k111.depth).toBe(3)
    expect(byKey.k1.is_leaf).toBe(false)
    expect(byKey.k111.is_leaf).toBe(true)
    expect(items.map((it) => it.sort_order)).toEqual([...items.keys()].map((i) => i + 1))
  })

  it('「非發包」段之後全部標為非發包', () => {
    expect(byKey.k111.is_billable).toBe(true)
    expect(byKey.k2.is_billable).toBe(false)
    expect(byKey.k21.is_billable).toBe(false)
  })

  it('合計列標 is_rollup、物調列標 is_price_adjustable', () => {
    expect(byKey.k119.is_rollup).toBe(true)
    expect(byKey.k12.is_price_adjustable).toBe(true)
  })

  it('數值欄位轉型；雙語取 zh-TW', () => {
    expect(byKey.k111.quantity).toBe(100)
    expect(byKey.k111.unit_price).toBe(20000)
    expect(byKey.k111.amount).toBe(2000000)
    expect(byKey.k111.description).toBe('鋼筋')
    expect(byKey.k111.ref_item_code).toBe('03210')
  })

  it('發包末端權重 = amount/發包末端總額，合計為 1；非發包無權重', () => {
    // 發包末端非合計：k111(200萬) + k112(100萬) + k12(0)
    expect(meta.billable_total).toBe(3000000)
    expect(byKey.k111.weight).toBeCloseTo(2 / 3)
    expect(byKey.k112.weight).toBeCloseTo(1 / 3)
    expect(byKey.k21.weight).toBeNull()
    const sum = items.filter((it) => it.weight != null).reduce((s, it) => s + it.weight, 0)
    expect(sum).toBeCloseTo(1)
  })

  it('leaf/item 計數', () => {
    expect(meta.item_count).toBe(items.length)
    expect(meta.leaf_count).toBe(items.filter((it) => it.is_leaf && !it.is_rollup).length)
  })
})

describe('parsePccesXml — 錯誤處理', () => {
  it('非 XML → 擲出解析失敗', () => {
    expect(() => parsePccesXml('not xml at all <<<')).toThrow()
  })
  it('不是 ETenderSheet → 明確錯誤訊息', () => {
    expect(() => parsePccesXml('<Other/>')).toThrow(/PCCES/)
  })
  it('沒有 DetailList → 明確錯誤訊息', () => {
    expect(() => parsePccesXml('<ETenderSheet/>')).toThrow(/DetailList/)
  })
  it('BOM 開頭仍可解析', () => {
    expect(() => parsePccesXml('﻿' + XML)).not.toThrow()
  })
})
