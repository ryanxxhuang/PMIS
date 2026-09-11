// 契約重點詳情的動作列(原本住在 pages/web/RequirementsReview.jsx,重構波次 8
// 搬來——它是獨立元件「供測試釘權限」,但測試得先把整頁的 store/supabase
// import 圖拉進來才碰得到它,等於為了測一顆按鈕付整頁的代價)。
// 檔案位置沿用波次 7 的慣例:頁面專屬分段放 components/<工作面>/。
//
// 確認/不採用只給契約審查者(監造/機關,鏡像 can_review_requirement,刻意無
// 專案管理者例外);其他人看得到內容但不渲染假操作。
// ⚠️ canReview 由呼叫端注入且只是 UX——真正的授權在 review_requirement RPC。
import { MSym } from '../icons.jsx'
import { Badge, Button } from '../ui.jsx'
import { fmtDateTime } from '../../lib/format.js'
import { REQUIREMENT_STATUS_LABELS, requirementVerification } from '../../lib/requirementReview.js'

const EDITABLE_STATUSES = ['draft_ai', 'needs_review']
const fmtTime = (v) => fmtDateTime(v, { empty: '' })

// 詳情動作列(獨立元件供測試釘權限):確認/不採用只給契約審查者(監造/機關,
// 鏡像 can_review_requirement,刻意無專案管理者例外);其他人看得到內容但
// 不渲染假操作。
export default function ReviewActions({ requirement, canReview, busy, onReview, onEdit, reviewerName }) {
  const st = requirement.status
  // 紀錄格式:`桃園市工務局 林淑芬 確認 · 時間`。審查人名由呼叫端從 profiles
  // 解析(reviewed_by 是伺服器蓋的);reviewed_by 為空的已確認=確定性分流的
  // 系統自動確認(可能仍有核對疑慮),須依實際註記揭露
  const VERB = { approved: '確認', rejected: '不採用', superseded: '廢止取代' }
  const autoConfirmed = st === 'approved' && !requirement.reviewed_by && requirement.reviewed_at
  const record = requirement.reviewed_at
    ? (autoConfirmed
      ? `${requirementVerification(requirement).label} · ${fmtTime(requirement.reviewed_at)}(伺服器記錄)`
      : reviewerName
        ? `${reviewerName} ${VERB[st] || REQUIREMENT_STATUS_LABELS[st] || st} · ${fmtTime(requirement.reviewed_at)}(伺服器記錄)`
        : `${REQUIREMENT_STATUS_LABELS[st] || st}·${fmtTime(requirement.reviewed_at)}(伺服器記錄)`)
    : null
  if (EDITABLE_STATUSES.includes(st)) {
    if (!canReview) {
      return (
        <Badge color="slate">
          <MSym name="info" size={12} className="shrink-0" />轉錄確認由監造／機關辦理
        </Badge>
      )
    }
    return (<>
      <Button size="md" disabled={!!busy} onClick={() => onReview('approve', '確認無誤')}>
        <MSym name="check_circle" size={15} fill /> 確認無誤
      </Button>
      <Button variant="outline" size="md" disabled={!!busy} onClick={onEdit}>修正內容</Button>
      {/* 不採用=紅字 ghost:ui.jsx 沒有 ghost-danger 變體,這裡以 ! 覆蓋 ghost 的藍;
          下次開 ui.jsx 時補一個變體,呼叫端就能拿掉這兩個 ! */}
      <Button variant="ghost" size="md" disabled={!!busy} onClick={() => onReview('reject', '不採用')}
        className="!text-[var(--red-text)] hover:!bg-[var(--red-tint)]">
        不採用
      </Button>
    </>)
  }
  return (<>
    <span className="flex-1 min-w-0 text-caption leading-relaxed text-[var(--text-3)] num">{record}</span>
    {st === 'approved' && canReview && (
      <Button variant="outline" size="sm" disabled={!!busy} onClick={() => onReview('supersede', '廢止取代')}>廢止取代</Button>
    )}
  </>)
}

