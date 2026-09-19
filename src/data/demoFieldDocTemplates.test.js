// 示範模式的範本 fixture 必須與 DB 定義逐字一致:這裡直接解析 repo 內「最後一支定義 fn_field_document_template 的
// migration」原文($tpl$…$tpl$ 區塊),逐類型深比對 fixture——DB 是唯一定義,fixture 是它在示範模式的鏡像,
// Edge 起稿於執行期向 DB 取(不再有第三份)。改範本只改 migration,fixture 沒跟上這裡先紅。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { demoFieldDocumentTemplate, DEMO_TEMPLATE_DOC_TYPES } from './demoFieldDocTemplates.js'
import { templateRequiredKeys, templateHumanOnlyKeys, templateConfirmRequiredKeys, checklistItemRules } from '../lib/fieldDocs.js'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const DEF = 'create or replace function public.fn_field_document_template('

// 最後一支定義範本函式的 migration 內的各類型 JSON
function templatesFromMigrations() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  const last = [...files].reverse().find((f) => readFileSync(join(MIGRATIONS, f), 'utf8').includes(DEF))
  expect(last, 'repo 內必須有定義 fn_field_document_template 的 migration').toBeTruthy()
  const sql = readFileSync(join(MIGRATIONS, last), 'utf8')
  const body = sql.slice(sql.indexOf(DEF))
  const out = {}
  for (const m of body.matchAll(/when '([a-z_]+)' then \$tpl\$\n([\s\S]*?)\n\$tpl\$::jsonb/g)) out[m[1]] = JSON.parse(m[2])
  return { file: last, templates: out }
}

describe('示範模式文書範本 fixture', () => {
  const { templates } = templatesFromMigrations()

  it('類型集合與 DB 定義相同;每一類逐字相同(DB 是唯一定義)', () => {
    expect(Object.keys(templates).sort()).toEqual([...DEMO_TEMPLATE_DOC_TYPES].sort())
    for (const [type, tpl] of Object.entries(templates)) expect(demoFieldDocumentTemplate(type)).toEqual(tpl)
  })
  it('監造日誌:必填鍵、人填欄只有到場、標示範範本', () => {
    const tpl = demoFieldDocumentTemplate('supervisor_log')
    expect(templateRequiredKeys(tpl)).toEqual(['attendance', 'contractor_summary', 'log_date', 'supervision_items', 'weather_am', 'weather_pm'])
    expect(templateHumanOnlyKeys(tpl)).toEqual(['attendance'])
    expect(templateConfirmRequiredKeys(tpl)).toEqual(['attendance'])
    expect(tpl.is_demo).toBe(true)
    expect(tpl.demo_label).toBe('示範範本')
    expect(tpl.sections).toHaveLength(8)
  })
  it('自主檢查表框架:必填=檢查日期＋範本;項目規則 num 只能人填、bool 須人確認;標示範範本並說明項目取自本案範本', () => {
    const tpl = demoFieldDocumentTemplate('self_check')
    expect(templateRequiredKeys(tpl)).toEqual(['check_date', 'template_id'])
    expect(templateHumanOnlyKeys(tpl)).toEqual([])
    expect(checklistItemRules(tpl)).toEqual({ num: { human_only: true, confirm_required: true }, bool: { human_only: false, confirm_required: true } })
    expect(tpl.is_demo).toBe(true)
    expect(tpl.demo_label).toBe('示範範本')
    expect(tpl.disclaimer).toContain('非任何機關公定或法定格式')
    expect(tpl.disclaimer).toContain('本案檢查表範本')
  })
  it('其他類型沒有範本(施工日誌是公定格式;查驗表單待 P3c)', () => {
    for (const t of ['daily_log', 'inspection_form', null]) expect(demoFieldDocumentTemplate(t)).toBeNull()
  })
})
