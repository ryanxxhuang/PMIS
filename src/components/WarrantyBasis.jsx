// 保固期滿日與依據(P5e;履約時程的履約期程卡)。使用者 2026-09-20 決定:保固期滿日＝正式驗收合格日＋契約載明的
// 保固期間,兩項都有依據才有日期;缺哪一項就說哪一項、給哪個入口(合格日在驗收頁,保固期間在本卡登錄並引用條文)。
// 事實由 DB 算好(RPC get_project_warranty:合格日、保固期間、引用條文是否仍為已確認、期滿日),這裡只呈現——
// 日期規則只在 DB 一處(fn_warranty_expiry),前端不重算。缺口的判定與說法走共用規則(與今日工作／Agent／早報同一句)。
//   WarrantyBasis       純呈現:期滿日、兩項依據各自的來源(驗收事件、契約條文)、缺口與入口
//   WarrantyTermEditor  有權者登錄／更正契約保固期間(數值＋單位＋引用的已確認契約重點);寫入由呼叫端(RPC 留版)
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MSym } from './icons.jsx'
import { Button, Field, Input, Select } from './ui.jsx'
import {
  warrantyTermLabel, warrantyNeeds, warrantyGap, WARRANTY_TERM_UNIT_LABELS,
} from '../../supabase/functions/_shared/ballInCourtRules.ts'

const day = (v) => (v ? String(v).slice(0, 10) : null)
const linkCls = 'text-[var(--blue-text)] hover:underline'

// source:引用條文的出處 { title, clause } ——登入者看得到才有(契約分級 RLS);看不到傳 null,只說「已引用」
export default function WarrantyBasis({ warranty, source = null, onEditTerm = null }) {
  const expiry = day(warranty?.expiry)
  const accepted = day(warranty?.acceptance_date)
  const term = warrantyTermLabel(warranty?.term_value, warranty?.term_unit)
  const needs = warrantyNeeds(warranty)
  const gap = warrantyGap(warranty)
  const sourceLost = !!term && warranty?.source_ok !== true
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] bg-[var(--bg)] px-3.5 py-2.5" aria-label="保固期滿日與依據">
      <MSym name="verified_user" size={16} className={`mt-0.5 shrink-0 ${expiry ? 'text-[var(--green-text)]' : 'text-[var(--amber-text)]'}`} />
      <div className="min-w-0 flex-1 space-y-1 text-footnote leading-relaxed">
        <p className="text-[var(--text)]">
          <span className="font-medium num">{expiry ? `保固期滿 ${expiry}` : '保固期滿日待補'}</span>
          <span className="text-[var(--text-3)]">{expiry ? '（正式驗收合格日＋契約保固期間）' : `（${gap}）`}</span>
        </p>
        <p className="text-[var(--text-2)]">
          正式驗收合格：
          {accepted
            ? <Link to="/acceptance?stage=final" className={`${linkCls} num`}>{accepted}（驗收紀錄）</Link>
            : <>未登錄<Link to="/acceptance?stage=final" className={`${linkCls} ml-1.5`}>到驗收登錄</Link></>}
        </p>
        <p className="text-[var(--text-2)]">
          契約保固期間：
          {term
            ? <span className="num">{term}{source ? `，依${source.clause ? ` ${source.clause} ` : ''}「${source.title}」` : '，已引用契約條文'}</span>
            : '未登錄'}
          {sourceLost && <span className="text-[var(--amber-text)]">（引用的條文已不是已確認狀態，請重新引用）</span>}
          {onEditTerm && (
            <button type="button" onClick={onEditTerm} className={`${linkCls} ml-1.5 inline-flex min-h-11 items-center md:min-h-0`}>
              {term ? '更正' : '登錄'}
            </button>
          )}
        </p>
        {needs.length > 0 && <p className="text-caption text-[var(--text-3)]">兩項都有依據才計算保固期滿日；保固類循環事項只產生到保固期滿日。</p>}
      </div>
    </div>
  )
}

// candidates:可引用的已確認契約重點 [{ id, label }](呼叫端依可見範圍列);onSave(patch) 回 { error, version }
export function WarrantyTermEditor({ warranty, candidates, disabled, onSave, inputId }) {
  const initial = () => ({
    value: warranty?.term_value != null ? String(warranty.term_value) : '',
    unit: warranty?.term_unit || 'year',
    source: warranty?.source_requirement_id || '',
  })
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  // 伺服器事實換了(重載、他人更正)就回到現值,不留過期草稿
  useEffect(() => { setDraft(initial()) }, [warranty?.term_value, warranty?.term_unit, warranty?.source_requirement_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const clearing = draft.value.trim() === ''
  const save = async () => {
    setBusy(true)
    const n = Number(draft.value)
    await onSave(clearing
      ? { warranty_term_value: null, warranty_term_unit: null, warranty_source_requirement_id: null }
      : { warranty_term_value: Number.isInteger(n) ? n : draft.value, warranty_term_unit: draft.unit, warranty_source_requirement_id: draft.source || null })
    setBusy(false)
  }
  return (
    <div className="basis-full flex flex-wrap items-end gap-4">
      <Field label="契約保固期間" hint="依契約條文填寫;留空＝清除">
        <div className="flex gap-2">
          <Input id={inputId} type="number" inputMode="numeric" min={1} step={1} value={draft.value} className="w-24"
            onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))} disabled={disabled} aria-label="保固期間數值" />
          <Select value={draft.unit} onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))} disabled={disabled} aria-label="保固期間單位">
            {Object.entries(WARRANTY_TERM_UNIT_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </Select>
        </div>
      </Field>
      <Field label="引用的契約條文" hint="只能引用已確認的契約重點;找不到請先到擷取審核補登並確認">
        <Select value={draft.source} onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))} disabled={disabled || clearing} aria-label="引用的契約條文">
          <option value="">選擇條文…</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
      </Field>
      <Button size="md" variant="outline" busy={busy} disabled={disabled || (!clearing && !draft.source)} onClick={save}>
        {clearing ? '清除保固期間' : '儲存保固期間'}
      </Button>
    </div>
  )
}
