// 圖示字型守門:subset 字型(src/assets/material-symbols-pmis.woff2)只包
// manifest 裡的字符——程式碼裡出現 manifest 沒有的名字,畫面會渲染成原始
// 英文字(ligature 失敗沒有任何錯誤)。這支測試把「新增圖示忘記重跑
// scripts/build-icon-font.mjs」變成紅燈,而不是上線後的視覺缺字。
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { collectCandidates } from '../../scripts/icon-names.mjs'
import manifest from '../assets/material-symbols-names.json'

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('Material Symbols subset manifest', () => {
  it('src 內所有候選名都在 manifest(included 或 ignored)裡', () => {
    const known = new Set([...manifest.included, ...manifest.ignored])
    const missing = collectCandidates(srcDir).filter((n) => !known.has(n))
    expect(missing, `這些字串不在 subset manifest:${missing.join('、')}\n` +
      '若是新圖示(或新出現的同形字串),跑 node scripts/build-icon-font.mjs 重生字型與 manifest').toEqual([])
  })
  it('manifest 的 included 非空且已排序(css2 icon_names 要求字母序)', () => {
    expect(manifest.included.length).toBeGreaterThan(50)
    expect(manifest.included).toEqual([...manifest.included].sort())
  })
})
