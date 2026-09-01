// 四個基準日欄位(期限追蹤頁與履約時程頁共用)。值與寫入邏輯由呼叫端提供——
// 兩頁的寫入行為不同(期限追蹤要支援 demo 本地寫、履約時程只在真專案出現),
// 共用的是「哪些欄位、什麼標籤」這份清單:漏欄或標籤漂移會讓兩頁對同一個
// 基準日講出不同名字。回傳 Fragment,排版容器(flex-wrap/grid)由呼叫端決定。
import { Field, Input } from './ui.jsx'

export const ANCHOR_FIELDS = [
  ['award_date', '決標日'],
  ['notice_date', '接獲開工通知日'],
  ['commencement_date', '開工日'],
  ['end_date', '竣工日(完工期限基準)'],
]

export default function AnchorDates({ anchors, onSet, disabled }) {
  return (
    <>
      {ANCHOR_FIELDS.map(([key, label]) => (
        <Field key={key} label={label}>
          <Input type="date" value={anchors?.[key] || ''}
            onChange={(e) => onSet(key, e.target.value)} disabled={disabled} />
        </Field>
      ))}
    </>
  )
}
