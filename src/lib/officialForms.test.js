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
  DAILY_LOG_MAPPING, SELF_CHECK_MAPPING, FORM_TEMPLATES, mappingFor, mappedKeys, isEditableBy, unmappedRows,
  templateCaption, stampFormTemplate, formTemplateOf, dailyLogHeaderFacts, rocDateText,
} from './officialForms.js'
import { emptyDailyLogContent, emptySelfCheckContent } from './fieldDocs.js'

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
  for (const [heading, rows] of [['1. 施工日誌（工程會附表四）', DAILY_LOG_MAPPING], ['2. 自主檢查表（臺北市格式參考範例）', SELF_CHECK_MAPPING]]) {
    it(`${heading}:逐列的原表欄名與儲存欄位一致`, () => {
      const inDoc = docRows(heading)
      expect(inDoc.map((r) => [r.label, r.key])).toEqual(rows.map((r) => [r.label, r.key || null]))
    })
  }

  it('沒有重複的儲存欄位(同一格不會有兩個定義)', () => {
    for (const docType of ['daily_log', 'self_check']) {
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
    const caption = templateCaption('daily_log')
    expect(caption).toContain('參考工程會格式')
    expect(caption).toContain('未經機關核定')
    expect(caption).not.toMatch(/機關核定版|正式表單/)
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
