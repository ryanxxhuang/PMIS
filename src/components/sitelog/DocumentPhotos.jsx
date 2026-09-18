// 文件附件(P2c):版本的 attachments(照片 id＋角色)＋既有日誌照片(舊路徑掛 daily_log_id 的)。
// 施工日誌的施作證據(role=evidence)必須是施工廠商上傳的照片;監造照片只能以「參考」附上;
// 上傳方不明的舊照片不能當證據(P2d PD005)——伺服器 recheck 的附件問題逐張顯示,人可改角色或移除。
// 上傳更多照片走同一個 IntakeUploader(固定當日日期),辨識與起稿由伺服器做,不在這裡另寫一套。
import { Badge, Button, Empty } from '../ui.jsx'
import { MSym } from '../icons.jsx'

const ROLE_LABEL = { evidence: '施作證據', reference: '參考' }
const AI_STATUS_LABEL = { not_site: '非工地照', unreadable: '模糊不可辨', duplicate: '重複', failed: '辨識失敗' }

export default function DocumentPhotos({
  attachments = [], photosById = new Map(), legacyPhotos = [], editable = false, byId = new Map(),
  issues = new Map(), onToggleRole, onRemove, onAddLegacy, uploader = null,
}) {
  const attachedIds = new Set(attachments.map((a) => a.photo_id))
  const legacyUnattached = legacyPhotos.filter((p) => !attachedIds.has(p.id))
  return (
    <section aria-label="現場照片" className="mt-5 pt-4 border-t border-[var(--border-2)] space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-callout font-semibold text-[var(--text)]">現場照片</h3>
        <span className="text-caption text-[var(--text-3)] num">附件 {attachments.length} 張</span>
      </div>
      {uploader}
      {attachments.length === 0 ? (
        <Empty>{editable ? '尚無附件。拍照或選擇照片後，系統會保存並辨識，配到的工項與說明會帶進上方欄位。' : '本版本沒有附件。'}</Empty>
      ) : (
        <ul aria-label="附件照片" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {attachments.map((a, i) => {
            const p = photosById.get(a.photo_id)
            const role = a.role || 'evidence'
            const issue = issues.get(a.photo_id)
            const wi = p?.work_item_id ? byId.get(p.work_item_id) : null
            return (
              <li key={a.photo_id} className={`relative rounded-lg overflow-hidden border ${issue ? 'border-[var(--amber-text)]' : 'border-[var(--border)]'} bg-[var(--surface-2)]`}>
                <div className="aspect-[4/3]">
                  {p?.url ? <img src={p.url} alt={p.caption || `附件照片 ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                    : <div className="w-full h-full grid place-items-center text-caption text-[var(--text-3)]">照片載入中…</div>}
                </div>
                <div className="px-1.5 py-1 bg-[var(--surface)] border-t border-[var(--border-2)] space-y-0.5">
                  <div className="flex items-center gap-1 flex-wrap">
                    <Badge color={role === 'evidence' ? 'blue' : 'slate'}>{ROLE_LABEL[role]}</Badge>
                    {p?.ai_status && AI_STATUS_LABEL[p.ai_status] && <Badge color="amber">{AI_STATUS_LABEL[p.ai_status]}</Badge>}
                    {p?.uploader_org && p.uploader_org !== 'contractor' && <Badge color="amber">{p.uploader_org === 'supervisor' ? '監造提供' : '機關提供'}</Badge>}
                  </div>
                  {p?.caption && <div className="text-caption leading-tight text-[var(--text-2)] truncate" title={p.caption}>{p.caption}</div>}
                  {p?.location && <div className="text-micro leading-tight text-[var(--text-3)] truncate"><MSym name="location_on" size={10} className="inline -mt-0.5" /> {p.location}</div>}
                  {wi && <div className="text-micro leading-tight text-[var(--blue-text)] truncate" title={`${wi.item_no} ${wi.description}`}><MSym name="link" size={10} className="inline -mt-0.5" /> {wi.item_no} {wi.description}</div>}
                  {!wi && p?.work_item_hint && <div className="text-micro leading-tight text-[var(--amber-text)] truncate">待配對：{p.work_item_hint}</div>}
                  {issue && <div className="text-micro leading-tight text-[var(--amber-text)]">{issue}</div>}
                  {editable && (
                    <div className="flex items-center gap-2 pt-0.5">
                      {onToggleRole && <button type="button" onClick={() => onToggleRole(a.photo_id, role === 'evidence' ? 'reference' : 'evidence')} className="text-micro font-medium text-[var(--blue-text)] hover:underline min-h-11 md:min-h-0">改為{role === 'evidence' ? '參考' : '施作證據'}</button>}
                      {onRemove && <button type="button" onClick={() => onRemove(a.photo_id)} className="text-micro font-medium text-[var(--red-text)] hover:underline min-h-11 md:min-h-0">移除附件</button>}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {legacyUnattached.length > 0 && (
        <div>
          <div className="text-footnote text-[var(--text-2)] mb-1">既有日誌照片（未列入本文件附件）{legacyUnattached.length} 張</div>
          <ul aria-label="既有日誌照片" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {legacyUnattached.map((p, i) => (
              <li key={p.id} className="rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--surface-2)]">
                <div className="aspect-[4/3]">{p.url && <img src={p.url} alt={p.caption || `既有照片 ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />}</div>
                <div className="px-1.5 py-1 bg-[var(--surface)] border-t border-[var(--border-2)] flex items-center justify-between gap-1">
                  <span className="text-caption text-[var(--text-2)] truncate">{p.caption || '（無說明）'}</span>
                  {editable && onAddLegacy && <Button variant="ghost" size="sm" onClick={() => onAddLegacy(p)}>加入附件</Button>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
