// 示範模式的範本 fixture 必須與 Edge 鏡像同鍵、同版本、同必填鍵——Edge 鏡像又由 pgTAP supervisor_logs.sql
// 釘住 DB 的 fn_field_document_template;三處任一改動沒同步,這裡先紅。
import { describe, it, expect } from 'vitest'
import { demoFieldDocumentTemplate } from './demoFieldDocTemplates.js'
import { SUPERVISOR_LOG_TEMPLATE, SUPERVISOR_LOG_REQUIRED_KEYS } from '../../supabase/functions/_shared/fieldDocDraft.ts'
import { templateRequiredKeys, templateHumanOnlyKeys } from '../lib/fieldDocs.js'

describe('示範模式文書範本 fixture', () => {
  it('監造日誌:鍵／版本／必填鍵與 Edge 鏡像一致;人填欄只有到場;標示示範範本', () => {
    const tpl = demoFieldDocumentTemplate('supervisor_log')
    expect({ key: tpl.key, version: tpl.version }).toEqual({ ...SUPERVISOR_LOG_TEMPLATE })
    expect(templateRequiredKeys(tpl)).toEqual([...SUPERVISOR_LOG_REQUIRED_KEYS].sort())
    expect(templateHumanOnlyKeys(tpl)).toEqual(['attendance'])
    expect(tpl.is_demo).toBe(true)
    expect(tpl.demo_label).toBe('示範範本')
    expect(tpl.sections).toHaveLength(8)
  })
  it('其他類型沒有範本(施工日誌是公定格式;自檢／查驗表單待 P3b／P3c)', () => {
    for (const t of ['daily_log', 'self_check', 'inspection_form', null]) expect(demoFieldDocumentTemplate(t)).toBeNull()
  })
})
