// 檢查表範本分段(品質查驗頁「檢查表」段;P3g)。補 P3c 留下的缺口:kind='inspection_form' 的監造查驗表單範本
// 原本只能用 API 建立,品質頁唯一的建立路徑固定落 self_check,applies_to 也沒有人填。
//
// 這張卡是本案兩種範本的唯一維護入口:
//   * 用途(kind):自主檢查表(廠商第一級)／監造查驗表單(監造第二級判定);查驗表單只有監造(或專案 admin)能建。
//   * 適用條件(applies_to):指名工項＝只適用這些工項;關鍵字＝比對工項描述。照片起稿與 Agent 起稿的候選推斷
//     先看這兩項,分不出來才退回標題相似度,再分不出來就標 blocked 請人指定(不亂猜)。
//   * 查驗階段(stage_key):沿用 ITP H 點的階段鍵,選自本案檢驗停留點;只有查驗表單範本有階段語意。
//   * 檢查項目:勾選(bool)或實測值(num;要有上下限才判定得了)。
// 規則的權威在 DB(checklist_templates_guard),這裡只在送出前用 lib/checklistTemplates 的同一組規則先講清楚。
// 已被檢查紀錄／查驗引用的範本不可改標題與項目(改了等於改動已簽署紀錄的呈現)——畫面直接說明並改推「建立新版本」。
import { useMemo, useState } from 'react'
import { MSym } from '../icons.jsx'
import { Card, Button, Badge, Empty, Field, Input, Select, IconButton } from '../ui.jsx'
import { WorkItemPicker } from '../DefectTracker.jsx'
import { friendlyError } from '../../lib/errorMessage.js'
import {
  TEMPLATE_KINDS, TEMPLATE_KIND_LABEL, ITEM_KINDS, canAuthorTemplate, emptyTemplateForm, emptyTemplateItem,
  templateFormFromRow, templateFormIssues, templateRowPayload, appliesToText, matchingLeaves,
} from '../../lib/checklistTemplates.js'

const ROW_CLS = 'rounded-lg border border-[var(--border-2)]'

export default function ChecklistTemplatesCard({
  templates = [], records = [], inspections = [], leaves = [], stageKeys = [], can, onSave,
}) {
  const [form, setForm] = useState(null)          // null=收起;物件=編輯中
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const [showIssues, setShowIssues] = useState(false)

  // 已被引用的範本:標題／依據／檢查項目不可再改(DB 也擋;這裡決定顯示什麼入口)
  const usedIds = useMemo(() => {
    const s = new Set()
    for (const r of records) if (r?.template_id) s.add(r.template_id)
    for (const i of inspections) if (i?.template_id) s.add(i.template_id)
    return s
  }, [records, inspections])

  const canSelfCheck = canAuthorTemplate('self_check', can)
  const canInspection = canAuthorTemplate('inspection_form', can)
  const issues = form ? templateFormIssues(form, { canApproveInspection: canInspection }) : []
  const preview = form ? matchingLeaves(form, leaves) : []

  const open = (next) => { setForm(next); setErrMsg(''); setShowIssues(false) }
  const patch = (p) => setForm((f) => ({ ...f, ...(typeof p === 'function' ? p(f) : p) }))
  const patchItem = (idx, p) => setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...p } : it)) }))

  const submit = async () => {
    if (issues.length) { setShowIssues(true); return }
    setBusy(true); setErrMsg('')
    // 已使用的範本:標題與項目送上去也會被 DB 擋,所以「另存新版本」走 id=null 的建立路徑
    const r = await onSave({ id: form.id, ...templateRowPayload(form) })
    setBusy(false)
    if (r?.error) { setErrMsg(friendlyError(r.error, '範本未儲存')); return }
    open(null)
  }

  const kindOptions = TEMPLATE_KINDS.filter((k) => (k.value === 'inspection_form' ? canInspection : canSelfCheck))
  const canCreate = kindOptions.length > 0

  return (
    <Card title={`檢查表範本（${templates.length}）`} action={
      canCreate && (
        <Button variant="secondary" onClick={() => open(form ? null : emptyTemplateForm(kindOptions[0].value))}>
          {form ? '取消' : <><MSym name="add" size={16} />新增範本</>}
        </Button>
      )
    }>
      <p className="text-footnote text-[var(--text-2)] leading-relaxed mb-3">
        範本決定自主檢查表與監造查驗表單要查哪些項目。登錄「適用條件」後，照片起稿與 Agent 起稿才挑得出正確的範本；
        沒登錄就只能用標題相似度猜，挑不出來會標為待人指定。
      </p>

      {form && (
        <div role="group" aria-label="範本編輯" className="mb-4 bg-[var(--surface-2)] rounded-lg p-4 space-y-3">
          {form.id && usedIds.has(form.id) && (
            <div role="status" className="text-footnote rounded-lg px-3 py-2 bg-[var(--amber-tint)] text-[var(--amber-text)] leading-relaxed">
              這張範本已被檢查紀錄或查驗引用。標題、依據與檢查項目不可再更改（既有紀錄的呈現與列印是即時讀範本的）；
              要更正內容請按下方「另存為新版本」，系統會以同標題建立下一版，日後起稿改用新版。
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="用途（必填）">
              <Select value={form.kind} aria-label="範本用途"
                onChange={(e) => patch({ kind: e.target.value, stage_key: e.target.value === 'inspection_form' ? form.stage_key : '' })}>
                {kindOptions.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </Select>
            </Field>
            <Field label="標題（必填）">
              <Input value={form.title} aria-label="標題（必填）" onChange={(e) => patch({ title: e.target.value })} placeholder="如 場鑄結構用混凝土 自主檢查表" />
            </Field>
            <Field label="依據（選填）" hint="規範章節或 ITP 編號">
              <Input value={form.source} aria-label="依據（選填）" onChange={(e) => patch({ source: e.target.value })} placeholder="如 施工綱要規範 第 03310 章" />
            </Field>
            {form.kind === 'inspection_form' && (
              <Field label="查驗階段（選填）" hint={stageKeys.length ? '本案檢驗停留點的 H 點階段；不選＝不限階段' : '本案尚未設定 H 點必要階段'}>
                <Select value={form.stage_key} aria-label="查驗階段" onChange={(e) => patch({ stage_key: e.target.value })}>
                  <option value="">不限階段</option>
                  {stageKeys.map((s) => <option key={s} value={s}>{s}</option>)}
                  {form.stage_key && !stageKeys.includes(form.stage_key) && <option value={form.stage_key}>{form.stage_key}</option>}
                </Select>
              </Field>
            )}
          </div>

          {/* 適用條件:候選推斷的依據。指名工項是硬條件、關鍵字是提示 */}
          <div className={`${ROW_CLS} p-3 space-y-2.5`}>
            <div className="text-footnote font-medium text-[var(--text)]">適用條件（起稿時挑這張範本的依據）</div>
            <Field label="適用工項（選填，可多選）" hint="指名後，這張範本只適用這些工項">
              <WorkItemPicker leaves={leaves.filter((l) => !form.workItemIds.includes(l.id) && !form.workItemIds.includes(l.item_key))}
                value="" label="" placeholder="搜尋並加入適用工項…"
                onPick={(k) => { const wi = leaves.find((l) => l.item_key === k); if (wi) patch((f) => ({ ...f, workItemIds: [...f.workItemIds, wi.id || wi.item_key] })) }} />
            </Field>
            {form.workItemIds.length > 0 && (
              <ul role="list" className="flex flex-wrap gap-2">
                {form.workItemIds.map((id) => {
                  const wi = leaves.find((l) => l.id === id || l.item_key === id)
                  return (
                    <li key={id} className="inline-flex items-center gap-1.5 text-footnote rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-2.5 pr-1 py-1">
                      <span className="truncate max-w-[16rem]">{wi ? `${wi.item_no || ''} ${wi.description || ''}`.trim() : '（已刪除的工項）'}</span>
                      <IconButton name="close" label={`移除適用工項 ${wi?.description || id}`}
                        onClick={() => patch((f) => ({ ...f, workItemIds: f.workItemIds.filter((x) => x !== id) }))}
                        className="-m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" />
                    </li>
                  )
                })}
              </ul>
            )}
            <Field label="關鍵字（選填）" hint="比對工項描述；用頓號或逗號分隔，如 混凝土、澆置">
              <Input value={form.keywords} aria-label="關鍵字（選填）" onChange={(e) => patch({ keywords: e.target.value })} placeholder="混凝土、澆置" />
            </Field>
            <p className="text-caption text-[var(--text-3)] leading-relaxed">
              {preview.length > 0
                ? `目前會配到 ${preview.length} 個工項：${preview.slice(0, 5).map((l) => l.description).join('、')}${preview.length > 5 ? '…' : ''}`
                : '尚未登錄適用條件（或目前沒有工項符合）；起稿時只能用標題相似度挑，挑不出來會請人指定。'}
            </p>
          </div>

          {/* 檢查項目 */}
          <div className={`${ROW_CLS} divide-y divide-[var(--border-2)]`}>
            <div className="px-3 py-2 flex items-center gap-2">
              <span className="text-footnote font-medium text-[var(--text)] flex-1">檢查項目（{form.items.length}）</span>
              <Button variant="outline" size="sm" onClick={() => patch((f) => ({ ...f, items: [...f.items, emptyTemplateItem()] }))}>
                <MSym name="add" size={15} />加一項
              </Button>
            </div>
            {form.items.map((it, idx) => (
              <div key={idx} className="p-3 space-y-2">
                <div className="grid sm:grid-cols-[6rem_1fr_11rem] gap-2">
                  <Input value={it.no} onChange={(e) => patchItem(idx, { no: e.target.value })} placeholder="項次" aria-label={`第 ${idx + 1} 項項次`} />
                  <Input value={it.item} onChange={(e) => patchItem(idx, { item: e.target.value })} placeholder="檢查內容" aria-label={`第 ${idx + 1} 項檢查內容`} />
                  <Select value={it.kind} onChange={(e) => patchItem(idx, { kind: e.target.value })} aria-label={`第 ${idx + 1} 項檢查方式`}>
                    {ITEM_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </Select>
                </div>
                <div className="grid sm:grid-cols-4 gap-2">
                  <Input value={it.group} onChange={(e) => patchItem(idx, { group: e.target.value })} placeholder="分組（選填）" aria-label={`第 ${idx + 1} 項分組`} />
                  {it.kind === 'num' ? (<>
                    <Input type="number" step="any" inputMode="decimal" value={it.min} onChange={(e) => patchItem(idx, { min: e.target.value })} placeholder="下限" aria-label={`第 ${idx + 1} 項下限`} />
                    <Input type="number" step="any" inputMode="decimal" value={it.max} onChange={(e) => patchItem(idx, { max: e.target.value })} placeholder="上限" aria-label={`第 ${idx + 1} 項上限`} />
                    <Input value={it.unit} onChange={(e) => patchItem(idx, { unit: e.target.value })} placeholder="單位" aria-label={`第 ${idx + 1} 項單位`} />
                  </>) : (
                    <Input className="sm:col-span-3" value={it.standard} onChange={(e) => patchItem(idx, { standard: e.target.value })} placeholder="判定標準（選填）" aria-label={`第 ${idx + 1} 項判定標準`} />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {it.kind === 'num' && (
                    <Input className="flex-1" value={it.standard} onChange={(e) => patchItem(idx, { standard: e.target.value })} placeholder="判定標準（選填，如 18 ± 2.5 cm）" aria-label={`第 ${idx + 1} 項判定標準`} />
                  )}
                  <Input className="flex-1" value={it.source} onChange={(e) => patchItem(idx, { source: e.target.value })} placeholder="出處條文（選填）" aria-label={`第 ${idx + 1} 項出處`} />
                  <IconButton name="close" label={`刪除第 ${idx + 1} 項`} disabled={form.items.length === 1}
                    onClick={() => patch((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}
                    className="-m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" />
                </div>
              </div>
            ))}
          </div>

          {showIssues && issues.length > 0 && (
            <ul role="alert" className="text-footnote text-[var(--red-text)] space-y-1">
              {issues.map((m) => <li key={m}>・{m}</li>)}
            </ul>
          )}
          {errMsg && <p role="alert" className="text-footnote text-[var(--red-text)]">{errMsg}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <Button busy={busy} onClick={submit}>{form.id ? '儲存範本' : '建立範本'}</Button>
            {form.id && (
              <Button variant="outline" busy={busy}
                onClick={() => { setForm((f) => ({ ...f, id: null })); setShowIssues(false) }}>另存為新版本</Button>
            )}
            <Button variant="outline" onClick={() => open(null)}>取消</Button>
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <Empty>尚無檢查表範本。先建立範本，自主檢查表與監造查驗表單才有項目可查、起稿也才挑得到。</Empty>
      ) : (
        <ul role="list" className="divide-y divide-[var(--border-2)]">
          {templates.map((t) => {
            const kind = t.kind || 'self_check'
            const used = usedIds.has(t.id)
            const editable = !t.builtin && canAuthorTemplate(kind, can)
            return (
              <li key={t.id} className="py-3 first:pt-0 last:pb-0 flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-callout font-medium text-[var(--text)] [text-wrap:pretty]">{t.title}</span>
                    <Badge color={kind === 'inspection_form' ? 'green' : 'blue'}>{TEMPLATE_KIND_LABEL[kind] || kind}</Badge>
                    {t.builtin ? <Badge color="slate">示範範本</Badge> : <Badge color="slate">第 {t.version || 1} 版</Badge>}
                    {used && <Badge color="amber">已被引用</Badge>}
                  </div>
                  <div className="text-footnote text-[var(--text-2)]">
                    {(Array.isArray(t.items) ? t.items.length : 0)} 個檢查項目{t.source ? `・依據 ${t.source}` : ''}
                  </div>
                  <div className="text-caption text-[var(--text-3)] leading-relaxed">{appliesToText(t, leaves)}</div>
                </div>
                {t.builtin ? (
                  canSelfCheck && (
                    <Button variant="outline" size="sm" className="shrink-0"
                      onClick={() => open({ ...templateFormFromRow({ ...t, kind: 'self_check' }), id: null })}>
                      以此建立本案範本
                    </Button>
                  )
                ) : editable && (
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => open(templateFormFromRow(t))}>編輯</Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
