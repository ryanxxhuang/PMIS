// 手動補登表單；資料寫入與審查權限仍由頁面／RLS 負責。
import { Button, Input, Textarea, Select, ErrorBanner } from '../ui.jsx'
import { ModalShell } from '../listDetail.jsx'
import { REQUIREMENT_TYPE_LABELS, RESPONSIBLE_LABELS } from '../../lib/requirementReview.js'

const MANUAL_TRIGGERS = [
  ['award', '決標日'], ['notice', '接獲開工通知日'], ['commencement', '開工日'], ['completion', '竣工日'],
]
const MANUAL_WEEKDAYS = [
  ['1', '週一'], ['2', '週二'], ['3', '週三'], ['4', '週四'],
  ['5', '週五'], ['6', '週六'], ['7', '週日'],
]

export default function ManualRequirementModal({ manualOpen, onClose, manualDraft, setManualDraft, packages, manualMsg, manualBusy, submitManual, onClearMessage }) {
  return (
    <ModalShell open={manualOpen} onClose={() => onClose()} title="手動新增契約重點" size="xl">
      <p className="text-xs text-[var(--text-3)] mb-3">AI 漏抽或文件未涵蓋的契約重點可在此補登;送出後為「待確認」、來源標記人工新增,確認後自動排入履約時程。</p>
      <div className="space-y-2">
        <Input value={manualDraft.title} onChange={(e) => setManualDraft((d) => ({ ...d, title: e.target.value }))}
          placeholder="標題(例:開工前 14 日內提送施工計畫)" />
        <Textarea rows={2} value={manualDraft.description}
          onChange={(e) => setManualDraft((d) => ({ ...d, description: e.target.value }))}
          placeholder="補充描述(可留白)" />
        <div className="flex flex-wrap gap-2">
          <Select value={manualDraft.requirement_type} className="flex-1 min-w-[8rem]"
            onChange={(e) => setManualDraft((d) => ({ ...d, requirement_type: e.target.value }))}>
            {Object.entries(REQUIREMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={manualDraft.lifecycle_phase} className="flex-1 min-w-[8rem]"
            onChange={(e) => setManualDraft((d) => ({ ...d, lifecycle_phase: e.target.value }))}>
            {['開工前', '施工中', '完工', '保固'].map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Select value={manualDraft.responsible_party_type} className="flex-1 min-w-[8rem]"
            onChange={(e) => setManualDraft((d) => ({ ...d, responsible_party_type: e.target.value }))}>
            <option value="">負責方未定</option>
            {Object.entries(RESPONSIBLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={manualDraft.dueMode} className="w-auto"
            onChange={(e) => setManualDraft((d) => ({ ...d, dueMode: e.target.value }))}>
            <option value="relative">相對基準日</option>
            <option value="fixed">指定日期</option>
            <option value="daily">每日</option>
            <option value="weekly">每週固定日</option>
            <option value="monthly">每月固定日</option>
            <option value="quarterly">每季固定日</option>
            <option value="yearly">每年固定日</option>
            <option value="none">無明確時點</option>
          </Select>
          {manualDraft.dueMode === 'relative' && (<>
            <Select value={manualDraft.trigger_event} className="w-auto"
              onChange={(e) => setManualDraft((d) => ({ ...d, trigger_event: e.target.value }))}>
              {MANUAL_TRIGGERS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select value={manualDraft.offset_dir} className="w-auto"
              onChange={(e) => setManualDraft((d) => ({ ...d, offset_dir: e.target.value }))}>
              <option value="after">後</option>
              <option value="before">前</option>
            </Select>
            <Input type="number" min="1" className="w-24" value={manualDraft.offset_days}
              onChange={(e) => setManualDraft((d) => ({ ...d, offset_days: e.target.value }))} placeholder="天數" />
            <span className="text-xs text-[var(--text-3)]">日內</span>
          </>)}
          {manualDraft.dueMode === 'fixed' && (
            <Input type="date" className="w-44" value={manualDraft.fixed_date}
              onChange={(e) => setManualDraft((d) => ({ ...d, fixed_date: e.target.value }))} />
          )}
          {manualDraft.dueMode === 'monthly' && (<>
            <span className="text-xs text-[var(--text-2)]">每月</span>
            <Input type="number" min="1" max="31" className="w-24" value={manualDraft.monthly_day}
              onChange={(e) => setManualDraft((d) => ({ ...d, monthly_day: e.target.value }))} placeholder="幾號" />
            <span className="text-xs text-[var(--text-3)]">號</span>
          </>)}
          {manualDraft.dueMode === 'weekly' && (<>
            <span className="text-xs text-[var(--text-2)]">每</span>
            <Select value={manualDraft.weekly_weekday} className="w-auto"
              onChange={(e) => setManualDraft((d) => ({ ...d, weekly_weekday: e.target.value }))}>
              {MANUAL_WEEKDAYS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </>)}
          {manualDraft.dueMode === 'quarterly' && (<>
            <span className="text-xs text-[var(--text-2)]">每季第</span>
            <Select value={manualDraft.freq_month} className="w-auto"
              onChange={(e) => setManualDraft((d) => ({ ...d, freq_month: e.target.value }))}>
              <option value="">—</option>
              {['1', '2', '3'].map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
            <span className="text-xs text-[var(--text-2)]">個月</span>
            <Input type="number" min="1" max="31" className="w-24" value={manualDraft.freq_day}
              onChange={(e) => setManualDraft((d) => ({ ...d, freq_day: e.target.value }))} placeholder="幾日" />
            <span className="text-xs text-[var(--text-3)]">日</span>
          </>)}
          {manualDraft.dueMode === 'yearly' && (<>
            <span className="text-xs text-[var(--text-2)]">每年</span>
            <Input type="number" min="1" max="12" className="w-24" value={manualDraft.freq_month}
              onChange={(e) => setManualDraft((d) => ({ ...d, freq_month: e.target.value }))} placeholder="幾月" />
            <span className="text-xs text-[var(--text-2)]">月</span>
            <Input type="number" min="1" max="31" className="w-24" value={manualDraft.freq_day}
              onChange={(e) => setManualDraft((d) => ({ ...d, freq_day: e.target.value }))} placeholder="幾日" />
            <span className="text-xs text-[var(--text-3)]">日</span>
          </>)}
        </div>
        {packages.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-2)] shrink-0">所屬契約</span>
            <Select value={manualDraft.contract_package_id || packages.find((cp) => cp.package_type === 'construction')?.id || packages[0]?.id || ''}
              className="flex-1"
              onChange={(e) => setManualDraft((d) => ({ ...d, contract_package_id: e.target.value }))}>
              {packages.map((cp) => <option key={cp.id} value={cp.id}>{cp.title}</option>)}
            </Select>
          </div>
        )}
        <Input value={manualDraft.acceptance_criteria}
          onChange={(e) => setManualDraft((d) => ({ ...d, acceptance_criteria: e.target.value }))}
          placeholder="允收標準(可留白)" />
        <div className="flex flex-wrap gap-2">
          <Input value={manualDraft.source_clause} className="flex-1 min-w-[8rem]"
            onChange={(e) => setManualDraft((d) => ({ ...d, source_clause: e.target.value }))}
            placeholder="出處條款(例 5.3,可留白)" />
          <Input value={manualDraft.source_page} className="flex-1 min-w-[8rem]"
            onChange={(e) => setManualDraft((d) => ({ ...d, source_page: e.target.value }))}
            placeholder="出處頁碼(例 第 12 頁,可留白)" />
        </div>
        <ErrorBanner msg={manualMsg} />
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={manualBusy} onClick={submitManual}>新增(待確認)</Button>
          <Button variant="ghost" size="sm" onClick={() => { onClose(); onClearMessage() }}>取消</Button>
        </div>
      </div>
    </ModalShell>
  )
}
