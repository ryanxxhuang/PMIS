import { expect, it } from 'vitest'
import { localLinks, headingIds } from './check-docs.js'

it('只驗本機連結,支援中文、圖片、空格與同頁標題', () => {
  expect(localLinks('[甲](指南.md#設定) ![圖](<images/a b.png>) [章](#目的) [外部](https://example.com) [信](mailto:a@b.c)'))
    .toEqual(['指南.md#設定', 'images/a b.png', '#目的'])
})
it('忽略程式範例裡的假連結', () => {
  expect(localLinks('```md\n[示例](不存在.md)\n```\n`[內文](假.md)`\n[實際](README.md)')).toEqual(['README.md'])
})
it('依標題產生 Unicode anchor,處理標點、重複標題及明確 HTML anchor', () => {
  expect([...headingIds('# 1. 開始設定\n## **驗證** / RPC\n## **驗證** / RPC\n<a id="custom"></a>')])
    .toEqual(['1-開始設定', '驗證--rpc', '驗證--rpc-1', 'custom'])
})
