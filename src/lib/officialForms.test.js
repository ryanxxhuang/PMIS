// 公定／參考格式表單 mapping 的完整性與語意(2026-09-20 C 包)。
// 驗收要求「每份先完成 mapping 清單」,而清單只有寫在文件裡會跟程式分岔——這支測試把
// docs/architecture/official-form-mapping.md 的表格與 src/lib/officialForms.js 逐列釘在一起:
// 程式加欄位而文件沒寫(或反過來)就紅。另外釘住三件不能退讓的事:
//   1) mapping 的儲存欄位都對得上實際文件內容形狀(不能寫出不存在的鍵);
//   2) 工期／進度是確定性計算,算不出來回 pending,不會變成 0 或猜值;
//   3) 範本標示誠實(未經機關核定),簽署版本記得自己的範本版本。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DAILY_LOG_MAPPING, SELF_CHECK_MAPPING, INSPECTION_FORM_MAPPING, SUPERVISOR_LOG_MAPPING,
  FORM_TEMPLATES, mappingFor, mappedKeys, isEditableBy, unmappedRows, canEditForm,
  templateCaption, stampFormTemplate, formTemplateOf, dailyLogHeaderFacts, supervisorReportHeaderFacts, rocDateText,
} from './officialForms.js'
import { emptyDailyLogContent, emptySelfCheckContent, emptySupervisorLogContent, emptyInspectionFormContent } from './fieldDocs.js'

const DOC = readFileSync(new URL('../../docs/architecture/official-form-mapping.md', import.meta.url), 'utf8')

// 文件裡某一節的 mapping 表格 → [{label, key}]
function docRows(heading) {
  const body = DOC.split(`## ${heading}`)[1].split('\n## ')[0]
  return body.split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| 原表欄名') && !l.startsWith('|---'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((c) => c.length === 6)
    .map((c) => ({ label: c[0], key: c[1] === '（不另存）' ? null : c[1].replace(/`/g, '') }))
}

describe('mapping 清單:程式與文件是同一份', () => {
  for (const [heading, rows] of [
    ['1. 施工日誌（工程會附表四）', DAILY_LOG_MAPPING],
    ['2. 自主檢查表（臺北市格式參考範例）', SELF_CHECK_MAPPING],
    ['3. 監造查驗紀錄表（臺北市「施工抽查紀錄表」格式參考範例）', INSPECTION_FORM_MAPPING],
    ['4. 監造報表（工程會附表五）', SUPERVISOR_LOG_MAPPING],
  ]) {
    it(`${heading}:逐列的原表欄名與儲存欄位一致`, () => {
      const inDoc = docRows(heading)
      expect(inDoc.map((r) => [r.label, r.key])).toEqual(rows.map((r) => [r.label, r.key || null]))
    })
  }

  it('沒有重複的儲存欄位(同一格不會有兩個定義)', () => {
    for (const docType of ['daily_log', 'self_check', 'inspection_form', 'supervisor_log']) {
      const keys = mappedKeys(docType)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('原表有、本系統不存的欄位一律列在 mapping 裡,不是默默不見', () => {
    // 這些是紙上留白／系統算出來的格;它們仍要在清單上,否則「原表做到哪」就沒人說得清
    expect(unmappedRows('daily_log').map((r) => r.label)).toContain('附表:工地職業安全衛生施工前檢查紀錄表')
    expect(unmappedRows('daily_log').map((r) => r.label)).toContain('累計工期(天)')
    expect(unmappedRows('self_check').map((r) => r.label)).toContain('檢查結果(○／╳／／)')
    expect(unmappedRows('self_check').map((r) => r.label)).toContain('檢查項目') // 項目來自本案範本,不是文件自己的欄位
    // 監造查驗:判定符號欄是系統算的、監造主管簽名本輪未實作 → 都要留在清單上
    expect(unmappedRows('inspection_form').map((r) => r.label)).toContain('抽查結果(○／╳／／)')
    expect(unmappedRows('inspection_form').map((r) => r.label)).toContain('監造主管簽名')
    // 附表五:契約工期／變更次數／進度是系統算的,不是人填的
    for (const l of ['契約工期(天)', '契約變更次數(次)', '預定進度(%)', '實際進度(%)']) {
      expect(unmappedRows('supervisor_log').map((r) => r.label)).toContain(l)
    }
  })
})

describe('mapping 的儲存欄位對得上實際內容形狀', () => {
  const topLevel = (keys) => keys.filter((k) => !k.includes('.') && !k.includes('[') && !k.includes('<'))

  it('施工日誌:頂層鍵都在內容形狀或是 C 包新增的原表欄位', () => {
    const content = emptyDailyLogContent('2026-09-18')
    const extra = ['doc_no'] // C 包新增(表報編號;內容是自由 JSONB,不需要 migration)
    for (const k of topLevel(mappedKeys('daily_log'))) {
      expect(Object.keys(content).includes(k) || extra.includes(k)).toBe(true)
    }
  })

  it('自主檢查表:頂層鍵都在內容形狀或是 C 包新增的原表欄位', () => {
    const content = emptySelfCheckContent('2026-09-18', null, null)
    const extra = ['doc_no', 'subproject_name', 'subcontractor_name', 'check_timing', 'recheck_result', 'recheck_date', 'recheck_role']
    for (const k of topLevel(mappedKeys('self_check'))) {
      expect(Object.keys(content).includes(k) || extra.includes(k)).toBe(true)
    }
  })

  it('可編角色:廠商可編自己的日誌欄位;監造不能在廠商的日誌上編', () => {
    expect(isEditableBy('daily_log', 'weather_am', 'contractor')).toBe(true)
    expect(isEditableBy('daily_log', 'weather_am', 'supervisor')).toBe(false)
    expect(isEditableBy('daily_log', 'weather_am', 'owner')).toBe(false)
    // 系統算的格誰都不能編
    expect(isEditableBy('daily_log', 'log_date', 'contractor')).toBe(false)
    // 不在 mapping 的鍵一律不可編(fail-closed)
    expect(isEditableBy('daily_log', 'items.<work_item_id>.qty_cum', 'contractor')).toBe(false)
    expect(isEditableBy('daily_log', '不存在的欄位', 'contractor')).toBe(false)
  })

  it('自主檢查表:實測值可由廠商填,判定不可', () => {
    expect(isEditableBy('self_check', 'results.<no>', 'contractor')).toBe(true)
    expect(mappingFor('self_check').find((r) => r.label.startsWith('檢查結果')).editableBy).toEqual([])
  })

  it('監造查驗紀錄表:頂層鍵都在內容形狀或是 C2 新增的原表欄位', () => {
    const content = emptyInspectionFormContent('2026-09-20', null, null, null)
    const extra = ['doc_no', 'subproject_name', 'check_timing', 'recheck_result', 'recheck_date', 'recheck_role']
    for (const k of topLevel(mappedKeys('inspection_form'))) {
      expect(Object.keys(content).includes(k) || extra.includes(k)).toBe(true)
    }
  })

  it('監造報表(附表五):頂層鍵都在內容形狀或是 C2 新增的原表欄位', () => {
    const content = emptySupervisorLogContent('2026-09-20', null)
    const extra = ['doc_no', 'actual_completion_date', 'extended_days', 'contract_amount_original', 'contract_amount_revised', 'material_quality', 'safety_precheck', 'safety_other']
    for (const k of topLevel(mappedKeys('supervisor_log'))) {
      expect(Object.keys(content).includes(k) || extra.includes(k)).toBe(true)
    }
  })

  it('監造兩份的可編角色是監造:廠商與機關在這兩張紙上都不可編(fail-closed)', () => {
    for (const [docType, key] of [['inspection_form', 'confirmed_qty'], ['inspection_form', 'results.<no>'], ['supervisor_log', 'attendance'], ['supervisor_log', 'contractor_summary']]) {
      expect(isEditableBy(docType, key, 'supervisor')).toBe(true)
      expect(isEditableBy(docType, key, 'contractor')).toBe(false)
      expect(isEditableBy(docType, key, 'owner')).toBe(false)
    }
    expect(canEditForm('inspection_form', 'supervisor')).toBe(true)
    expect(canEditForm('inspection_form', 'contractor')).toBe(false)
    expect(canEditForm('supervisor_log', 'contractor')).toBe(false)
    // 反過來:廠商的兩份,監造不可編
    expect(canEditForm('daily_log', 'supervisor')).toBe(false)
    expect(canEditForm('self_check', 'supervisor')).toBe(false)
  })

  it('監造查驗紀錄表:系統算的格誰都不能編;不在 mapping 的鍵一律不可編', () => {
    // 判定符號、查驗日期、工項、單位:唯讀(伺服器算／帶入)
    for (const k of ['inspection_date', 'work_item_id', 'unit', 'inspection_id', 'self_check_record_id']) {
      expect(isEditableBy('inspection_form', k, 'supervisor')).toBe(false)
    }
    expect(isEditableBy('inspection_form', 'inspection_title', 'supervisor')).toBe(false)
    expect(isEditableBy('supervisor_log', 'log_date', 'supervisor')).toBe(false)
    expect(isEditableBy('supervisor_log', 'daily_log_receipt', 'supervisor')).toBe(false)
  })
})

describe('範本來源誠實', () => {
  it('兩份範本都標未經機關核定,且帶得出來源頁與原檔', () => {
    for (const t of Object.values(FORM_TEMPLATES)) {
      expect(t.accredited).toBe(false)
      expect(t.source_url).toMatch(/^https:\/\//)
      expect(t.source_file).toContain('docs/reviews/assets/2026-09-20-contractor-acceptance/')
      expect(t.disclaimer).toContain('未經主辦機關核定')
    }
  })

  it('畫面與紙本印的標示含「參考」與「未經機關核定」,不出現核定字樣', () => {
    for (const docType of ['daily_log', 'self_check', 'inspection_form', 'supervisor_log']) {
      const caption = templateCaption(docType)
      expect(caption).toMatch(/參考(工程會|臺北市)格式/)
      expect(caption).toContain('未經機關核定')
      expect(caption).not.toMatch(/機關核定版|正式表單/)
    }
  })

  it('附表五是日報不是監造月報:標示與免責聲明都不得出現「月報」', () => {
    expect(FORM_TEMPLATES.supervisor_log.title).toBe('公共工程監造報表')
    expect(FORM_TEMPLATES.supervisor_log.disclaimer).toContain('不是監造月報')
    expect(templateCaption('supervisor_log')).not.toContain('月報')
    expect(FORM_TEMPLATES.supervisor_log.revision).toContain('附表五')
  })
})

describe('簽署版本記得自己的範本版本', () => {
  it('存檔時蓋上範本鍵與版本;已經是同一版就不動內容(不製造假差異)', () => {
    const c = emptyDailyLogContent('2026-09-18')
    const stamped = stampFormTemplate(c, 'daily_log')
    expect(stamped.form_template).toEqual({ key: 'pcc-daily-log-1080430', version: 1 })
    expect(stampFormTemplate(stamped, 'daily_log')).toBe(stamped)
  })

  it('舊版本印的是它自己當時的範本(改版不改寫舊文件的語意)', () => {
    const old = { ...emptyDailyLogContent('2026-05-01'), form_template: { key: 'pcc-daily-log-1080430', version: 0 } }
    expect(formTemplateOf(old, 'daily_log')).toEqual({ key: 'pcc-daily-log-1080430', version: 0, current: false })
    // 沒有戳記的舊文件(C 包以前存的)回退目前範本,但不假裝它當初就是這一版
    expect(formTemplateOf(emptyDailyLogContent('2026-05-01'), 'daily_log')).toEqual({ key: 'pcc-daily-log-1080430', version: 1, current: true })
  })
})

describe('表頭的工期與進度是確定性計算,算不出來就待補', () => {
  const project = { commencement_date: '2026-03-01', end_date: '2026-12-31', project_name: 'A 案' }
  const plan = { start: '2026-03-01', months: [{ plannedPct: 0 }, { plannedPct: 10 }, { plannedPct: 20 }, { plannedPct: 30 }, { plannedPct: 40 }, { plannedPct: 50 }, { plannedPct: 60 }, { plannedPct: 70 }, { plannedPct: 80 }, { plannedPct: 100 }] }

  it('核定／累計／剩餘工期由基準日算出,且互相一致', () => {
    const f = dailyLogHeaderFacts({ project, progressPlan: plan, logDate: '2026-09-18', actualPct: 42.34 })
    expect(f.approved_duration_days.value).toBe(306) // 2026-03-01 → 2026-12-31(含頭尾)
    expect(f.elapsed_duration_days.value).toBe(202)
    expect(f.remaining_duration_days.value).toBe(306 - 202)
    expect(f.approved_duration_days.pending).toBe(false)
    expect(f.actual_progress_pct.value).toBe(42.3) // 小數一位,不四捨五入成整數也不無中生有
  })

  it('缺基準日／缺預定進度表:標待補,不補 0 也不用今天硬算', () => {
    const f = dailyLogHeaderFacts({ project: { project_name: 'A 案' }, progressPlan: null, logDate: '2026-09-18', actualPct: null })
    for (const k of ['approved_duration_days', 'elapsed_duration_days', 'remaining_duration_days', 'planned_progress_pct', 'actual_progress_pct', 'commencement_date']) {
      expect(f[k]).toEqual({ value: null, source: null, pending: true })
    }
  })

  it('沒有開工基準日時回退契約起始日,並在來源說清楚', () => {
    const f = dailyLogHeaderFacts({ project: { start_date: '2026-03-01', end_date: '2026-12-31' }, logDate: '2026-09-18' })
    expect(f.commencement_date.value).toBe('2026-03-01')
    expect(f.commencement_date.source).toContain('無開工基準日')
  })

  it('民國年月日與星期', () => {
    expect(rocDateText('2026-09-18', { weekday: true })).toBe('115 年 9 月 18 日(星期五)')
    expect(rocDateText(null)).toBe('')
  })
})

describe('監造報表(附表五)表頭:契約變更次數算得出來,契約金額不自己編', () => {
  const project = { commencement_date: '2026-03-01', end_date: '2026-12-31', project_name: 'A 案' }
  const co = (status, date) => ({ status, co_date: date, items: [{ amount_delta: 1000 }] })

  it('契約變更次數=截至本日已核准件數;未核准與本日之後的不算;0 件就是 0,不是待補', () => {
    const f = supervisorReportHeaderFacts({
      project, logDate: '2026-09-18',
      changeOrders: [co('核准', '2026-05-01'), co('核准', '2026-09-18'), co('核准', '2026-10-01'), co('審核中', '2026-04-01'), co('駁回', '2026-04-01')],
    })
    expect(f.approved_change_count.value).toBe(2)
    expect(f.approved_change_count.pending).toBe(false)
    expect(supervisorReportHeaderFacts({ project, logDate: '2026-09-18', changeOrders: [] }).approved_change_count)
      .toEqual({ value: 0, source: '已核准變更設計件數(截至本日)', pending: false })
  })

  it('已核准但沒有變更日期的仍計入,且在來源說清楚(不猜日期也不漏計)', () => {
    const f = supervisorReportHeaderFacts({ project, logDate: '2026-09-18', changeOrders: [co('核准', null), co('核准', '2026-05-01')] })
    expect(f.approved_change_count.value).toBe(2)
    expect(f.approved_change_count.source).toContain('未載變更日期')
  })

  it('變更設計尚未載入(null):標待補,不印 0', () => {
    expect(supervisorReportHeaderFacts({ project, logDate: '2026-09-18' }).approved_change_count)
      .toEqual({ value: null, source: null, pending: true })
  })

  it('預定完工日期取契約竣工日;缺值待補。契約金額不是事實、不由這裡產生', () => {
    expect(supervisorReportHeaderFacts({ project, logDate: '2026-09-18' }).planned_completion_date.value).toBe('2026-12-31')
    expect(supervisorReportHeaderFacts({ project: { project_name: 'A 案' }, logDate: '2026-09-18' }).planned_completion_date.pending).toBe(true)
    const keys = Object.keys(supervisorReportHeaderFacts({ project, logDate: '2026-09-18' }))
    expect(keys.some((k) => k.includes('contract_amount'))).toBe(false)
  })

  it('工期與進度沿用施工日誌同一支算式(不另寫一份)', () => {
    const plan = { start: '2026-03-01', months: [{ plannedPct: 0 }, { plannedPct: 10 }, { plannedPct: 20 }, { plannedPct: 30 }, { plannedPct: 40 }, { plannedPct: 50 }, { plannedPct: 60 }, { plannedPct: 70 }, { plannedPct: 80 }, { plannedPct: 100 }] }
    const a = dailyLogHeaderFacts({ project, progressPlan: plan, logDate: '2026-09-18', actualPct: 42.34 })
    const b = supervisorReportHeaderFacts({ project, progressPlan: plan, logDate: '2026-09-18', actualPct: 42.34, changeOrders: [] })
    for (const k of Object.keys(a)) expect(b[k]).toEqual(a[k])
  })
})
