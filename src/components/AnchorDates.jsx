// 四個基準日欄位(期限追蹤頁與履約時程頁共用)。值與寫入邏輯由呼叫端提供——
// 兩頁的寫入行為不同(期限追蹤要支援 demo 本地寫、履約時程只在真專案出現),
// 共用的是「哪些欄位、什麼標籤」這份清單:漏欄或標籤漂移會讓兩頁對同一個
// 基準日講出不同名字。回傳 Fragment,排版容器(flex-wrap/grid)由呼叫端決定。
//
// P5c:每次改基準日 DB 都會留一版;下一次變更的「依據」(類別／函文或變更案號／生效日)由呼叫端
// 以 basis／onBasis 帶進來時,這裡一併渲染成第二列——改了日期就套用當時填的依據,不另開對話框
// (規範 §1 第 3、4 條:就地處理、控制項離它影響的東西最近)。沒帶 basis 就只有四個日期欄。
import { Field, Input, Select } from './ui.jsx'
import { ANCHOR_CHANGE_KIND_LABELS } from '../../supabase/functions/_shared/ballInCourtRules.ts'

const ANCHOR_FIELDS = [
  ['award_date', '決標日'],
  ['notice_date', '接獲開工通知日'],
  ['commencement_date', '開工日'],
  ['end_date', '竣工日(完工期限基準)'],
]
// 可由人選的變更類別(initial 只給系統的第一版)
const CHANGE_KINDS = ['edit', 'extension', 'change_order', 'suspension', 'resumption']

export default function AnchorDates({ anchors, onSet, disabled, basis, onBasis }) {
  return (
    <>
      {ANCHOR_FIELDS.map(([key, label]) => (
        <Field key={key} label={label}>
          <Input type="date" value={anchors?.[key] || ''}
            onChange={(e) => onSet(key, e.target.value)} disabled={disabled} />
        </Field>
      ))}
      {basis && onBasis && (
        <div className="basis-full flex flex-wrap gap-4">
          <Field label="變更類別" hint="改日期時一併記入版本">
            <Select value={basis.change_kind || 'edit'} onChange={(e) => onBasis({ ...basis, change_kind: e.target.value })} disabled={disabled}>
              {CHANGE_KINDS.map((k) => <option key={k} value={k}>{ANCHOR_CHANGE_KIND_LABELS[k]}</option>)}
            </Select>
          </Field>
          <Field label="依據(函文字號／變更案號)" hint="選填;會顯示在「依據哪一版、哪份文件」">
            <Input type="text" value={basis.source_ref || ''} placeholder="例:府工字第 1130001234 號"
              onChange={(e) => onBasis({ ...basis, source_ref: e.target.value })} disabled={disabled} />
          </Field>
          <Field label="生效日" hint="停工日／復工日／核准日;留空=今天">
            <Input type="date" value={basis.effective_from || ''}
              onChange={(e) => onBasis({ ...basis, effective_from: e.target.value })} disabled={disabled} />
          </Field>
        </div>
      )}
    </>
  )
}
