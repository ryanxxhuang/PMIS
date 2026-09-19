// 現場紀錄總覽:D-026 四主入口「現場紀錄」的入口頁(2026-09-17 瘦身 P1a;P2c 接上傳與文書)。
// 這一頁不新增任何業務規則——件數與待辦都吃既有引擎(useTodayTasks、itpStatus、sampleAlerts,
// 查驗/缺失的狀態字串與 ballInCourt 同一份),入口一律是既有子頁的合法路由與單條參數;
// 依角色只列「你在這裡能辦的事」(can 只是 UX,伺服器仍是安全邊界)。
// P2c:主動作「拍照／上傳」(IntakeUploader:保存照片→伺服器辨識起稿)、「上傳批次」(離頁／重登入後
// 從伺服器恢復,IntakeList)、「現場文書」清單(field_documents 未終態,與今日工作球權同一份資料;
// 施工日誌開 /site-log?doc=、監造日誌開 /supervisor-log?doc=(P3a)、自主檢查表開 /self-check?doc=(P3b),查驗表單 P3c 前只列狀態、明寫尚未支援;
// 頁面路由由 lib/fieldDocs.docPageLink 決定)。?doc=<id>(P5a 待辦的直達參數)落到這裡後轉到該文件的頁面;?intake=<id> 展開該批。
import { useEffect, useMemo } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Badge, Empty, PageHeader } from '../../components/ui.jsx'
import { MSym } from '../../components/icons.jsx'
import TaskRow from '../../components/TaskRow.jsx'
import IntakeUploader from '../../components/sitelog/IntakeUploader.jsx'
import IntakeList from '../../components/sitelog/IntakeList.jsx'
import { useTodayTasks } from '../../lib/useTodayTasks.js'
import { visibleNavGroups, routeAllowed, BALL_SOURCES_TITLE } from '../../lib/navConfig.js'
import { taipeiToday } from '../../lib/dates.js'
import { itpStatus } from '../../lib/itp.js'
import { sampleAlerts } from '../../lib/qc.js'
import { docStatusMeta, DOC_TYPE_LABEL, docPageLink, docToOrgLabel } from '../../lib/fieldDocs.js'

const pathOf = (to) => String(to || '').split('?')[0]

// 依角色的一句話:只描述該角色在該頁真的做得到的動作(廠商填報/申請、監造判定/複查、機關查閱)
const DESC = {
  '/site-log': { contractor: '審核系統擬好的日誌草稿、補齊待補欄位，簽署後提送監造。', supervisor: '查閱廠商每日日誌與照片；提送後在此收件或退回。', owner: '查閱每日施工紀錄與照片。' },
  '/supervisor-log': { contractor: '查閱監造每日紀錄（到場、監造事項、查驗與通知）。', supervisor: '審核系統擬好的監造日誌草稿、親自確認到場人員，簽署後提送機關。', owner: '查閱監造每日紀錄；監造提送後在此收件或退回。' },
  '/quality': { contractor: '申請查驗、改善缺失後提送複查。', supervisor: '判定待查驗項目；不合格開立缺失，改善後複查結案。', owner: '查閱查驗結果與缺失改善情形。' },
  '/self-check': { contractor: '審核系統擬好的自主檢查表草稿、親自填實測值，簽署後可隨查驗申請檢附。', supervisor: '查閱廠商自主檢查表與修訂版；提送後在此收件或退回。', owner: '查閱廠商自主檢查紀錄。' },
  samples: { contractor: '登錄試體 7 天／28 天試驗值；不合格自動開缺失。', supervisor: '查閱試體試驗結果與逾期未填。', owner: '查閱試體試驗結果。' },
  '/itp': { contractor: '施作到停留點前先申請查驗；H 點未查驗不得續作。', supervisor: '設定停留點並查驗；未申請的 H 點會提醒。', owner: '查閱停留點的查驗狀態。' },
  '/safety': { contractor: '登錄自主檢查、教育訓練與危害告知；處理工安缺失。', supervisor: '登錄監造觀察／查驗／複查；開立與複查工安缺失。', owner: '追蹤工安紀錄與尚未結案的工安缺失。' },
}

export default function Site() {
  const { currentUser, project, siteLogs, inspections, defects, checklistRecords, testSamples, inspectionPoints, can, isPlatformAdmin,
    fieldDocuments, fieldDocsLoading, intakes, isPersistedProject, demoMode, adjustedItems } = useStore()
  const adjustedById = useMemo(() => new Map((adjustedItems || []).filter((it) => it.id).map((it) => [it.id, it])), [adjustedItems])
  const { mine } = useTodayTasks()
  const { state } = useLocation()
  const [params] = useSearchParams()
  const org = currentUser?.org_type || 'contractor'
  const today = taipeiToday()
  const documents = useMemo(() => fieldDocuments?.documents || [], [fieldDocuments])
  const docParam = params.get('doc')
  const intakeParam = params.get('intake')

  // 現場待辦=「現在輪到我」裡目的頁落在現場紀錄群組子頁的那些;群組定義只在 navConfig,
  // 這裡不手抄路徑清單(子頁增減會自動跟上)。現場文書待辦的 to 是 /site?doc=,也算本頁。
  const sitePaths = useMemo(() => {
    const group = visibleNavGroups(org, can?.override, isPlatformAdmin).flatMap((g) => g.items).find((n) => n.to === '/site')
    return new Set((group?.tabs || []).map((t) => t.to))
  }, [org, can?.override, isPlatformAdmin])
  const siteTasks = useMemo(() => mine.filter((t) => sitePaths.has(pathOf(t.to))), [mine, sitePaths])

  // 從單據返回:原項還在就聚焦它(TaskRow 的 id=task-<key>),與今日工作同一個約定
  useEffect(() => {
    if (!state?.returnedTask) return
    const el = document.getElementById(`task-${state.returnedTask}`)
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView?.({ block: 'center' }) }
  }, [state])

  // 件數:狀態字串與各頁／ballInCourt 同一份('待查驗'、'已結案'、domain='safety'),不另造判斷
  const counts = useMemo(() => {
    const hasTodayLog = (siteLogs || []).some((l) => String(l?.log_date || '').slice(0, 10) === today)
    const todayDoc = documents.find((d) => d.doc_type === 'daily_log' && d.doc_date === today) || null
    const todaySupDoc = documents.find((d) => d.doc_type === 'supervisor_log' && d.doc_date === today) || null
    const selfCheckDocs = documents.filter((d) => d.doc_type === 'self_check')
    const pendingInsp = (inspections || []).filter((i) => i.status === '待查驗').length
    const openQualityDefects = (defects || []).filter((d) => (d.domain || 'quality') !== 'safety' && d.status !== '已結案').length
    const openSafetyDefects = (defects || []).filter((d) => d.domain === 'safety' && d.status !== '已結案').length
    const pendingSamples = (testSamples || []).filter((s) => s.status !== '合格' && s.status !== '不合格').length
    const overdueSamples = sampleAlerts(testSamples || [], today).filter((a) => a.level === 'overdue').length
    const itp = { pending: 0, requested: 0 }
    for (const p of inspectionPoints || []) {
      const k = itpStatus(p, inspections || []).key
      if (k === 'pending') itp.pending += 1
      else if (k === 'requested') itp.requested += 1
    }
    return { hasTodayLog, todayDoc, todaySupDoc, selfCheckOpen: selfCheckDocs.filter((d) => ['draft', 'pending_input', 'returned'].includes(d.status)).length, selfCheckSubmitted: selfCheckDocs.filter((d) => d.status === 'submitted').length, pendingInsp, openQualityDefects, openSafetyDefects, pendingSamples, overdueSamples, itp, checklists: (checklistRecords || []).length }
  }, [siteLogs, documents, inspections, defects, testSamples, inspectionPoints, checklistRecords, today])

  // 今日施工日誌的一句話章:已簽署 > 文件狀態(待補／可簽署／已提送…)> 未填
  const todayLogChip = counts.hasTodayLog && (!counts.todayDoc || ['signed', 'submitted', 'received'].includes(counts.todayDoc.status))
    ? { label: '今日已簽署', tone: 'green' }
    : counts.todayDoc ? { label: `今日${docStatusMeta(counts.todayDoc, org).label}`, tone: docStatusMeta(counts.todayDoc, org).tone }
      : counts.hasTodayLog ? { label: '今日有既有紀錄・未簽署', tone: 'amber' }
        : { label: can.edit ? '今日未填' : '今日尚無日誌', tone: can.edit ? 'amber' : 'slate' }

  // 今日監造日誌的一句話章(P3a):文件狀態 > 未填(監造)／尚無(其他角色查閱)
  const todaySupChip = counts.todaySupDoc
    ? { label: `今日${docStatusMeta(counts.todaySupDoc, org).label}`, tone: docStatusMeta(counts.todaySupDoc, org).tone }
    : { label: can.approve ? '今日未填' : '今日尚無監造日誌', tone: can.approve ? 'amber' : 'slate' }

  // 現場作業入口:to 是既有子頁的路由(含單條參數/分段),不是新流程。件數只列非零的,零件數不製造噪音。
  const entries = [
    { to: `/site-log?d=${today}`, icon: 'edit_note', label: '施工日誌', desc: DESC['/site-log'][org], chips: [todayLogChip] },
    { to: `/supervisor-log?d=${today}`, icon: 'fact_check', label: '監造日誌', desc: DESC['/supervisor-log'][org], chips: [todaySupChip] },
    { to: '/quality?seg=inspections', icon: 'verified_user', label: '品質查驗', desc: DESC['/quality'][org],
      chips: [counts.pendingInsp > 0 && { label: `待查驗 ${counts.pendingInsp}`, tone: 'amber' },
        counts.openQualityDefects > 0 && { label: `未結案缺失 ${counts.openQualityDefects}`, tone: 'red' }] },
    // 自主檢查表(P3b):文件頁(照片起稿→實測值人填→簽署→提送);簽署落下的紀錄與直接寫入的紀錄都在 /quality 檢查表分段
    { to: '/self-check', icon: 'checklist', label: '自主檢查表', desc: DESC['/self-check'][org],
      chips: [counts.selfCheckOpen > 0 && { label: `處理中 ${counts.selfCheckOpen}`, tone: 'amber' },
        counts.selfCheckSubmitted > 0 && { label: `待監造收件 ${counts.selfCheckSubmitted}`, tone: 'blue' },
        counts.checklists > 0 && { label: `紀錄 ${counts.checklists} 份`, tone: 'slate' }] },
    { to: '/quality?seg=samples', icon: 'science', label: '試體試驗', desc: DESC.samples[org],
      chips: [counts.pendingSamples > 0 && { label: `待試驗 ${counts.pendingSamples}`, tone: 'slate' },
        counts.overdueSamples > 0 && { label: `逾期未填 ${counts.overdueSamples}`, tone: 'red' }] },
    { to: '/itp', icon: 'report', label: '檢驗停留點', desc: DESC['/itp'][org],
      chips: [counts.itp.pending > 0 && { label: `未申請 ${counts.itp.pending}`, tone: 'slate' },
        counts.itp.requested > 0 && { label: `待監造查驗 ${counts.itp.requested}`, tone: 'blue' }] },
    { to: '/safety', icon: 'shield', label: '工安管理', desc: DESC['/safety'][org],
      chips: [counts.openSafetyDefects > 0 && { label: `未結案工安缺失 ${counts.openSafetyDefects}`, tone: 'red' }] },
  ].map((e) => ({ ...e, chips: e.chips.filter(Boolean) }))

  // 本月文件:月報是現場紀錄的月彙整(設計 §3),入口放這裡;監造月報照 roles(不在這裡放寬)
  const monthly = [
    { to: '/monthly-report', label: '施工月報', desc: '自動彙整本月進度、估驗、品質、工安與變更。' },
    { to: '/supervisor-report', label: '監造月報', desc: '自動彙整本月查驗、缺失、送審與進度的監造報表草稿。' },
  ].filter((m) => routeAllowed(m.to, org, can?.override, isPlatformAdmin))

  // 現場文書清單:依觀看者排序——輪到我的在前(責任方的草稿／待補／退回／待提送;提送對象的待收件,
  // 由 docStatusMeta 依文書類型判),再依更新時間
  const docRows = useMemo(() => {
    const rows = documents.map((d) => {
      const meta = docStatusMeta(d, org)
      return { doc: d, meta, mineTurn: !!meta.action, link: docPageLink(d) }
    })
    return rows.sort((a, b) => (Number(b.mineTurn) - Number(a.mineTurn)) || String(b.doc.updated_at || '').localeCompare(String(a.doc.updated_at || '')))
  }, [documents, org])

  // ?doc=<id>:今日工作／Agent 的現場文書待辦帶的直達參數(P5a);有頁面的類型轉到它的頁面(保留返回來源 state)
  const targetDoc = docParam ? documents.find((d) => d.id === docParam) : null
  const targetLink = targetDoc ? docPageLink(targetDoc) : null
  if (targetLink) {
    return <Navigate to={targetLink} replace state={state} />
  }

  return (
    <div className="space-y-5">
      <PageHeader title="現場紀錄" tagline={project?.project_name}
        subtitle="拍照上傳後由系統擬稿，審核、簽署、提送都在這裡；日誌、查驗、自主檢查、試驗、停留點與工安的入口；件數只計本案尚未處理的事項。"
        meta={[{ k: '日期', v: today }]} />

      {docParam && !targetDoc && !fieldDocsLoading && (
        <p role="status" className="text-footnote text-[var(--text-2)]">找不到編號 {docParam} 的文書（可能已捨棄、不在本案，或連結已失效）；以下為本案現場文書清單。</p>
      )}

      {/* 主動作:拍照／上傳(廠商→施工日誌＋自主檢查表、監造→監造日誌自動起稿;查驗表單 P3c 前標尚未支援;機關查閱) */}
      <Card title="拍照／上傳" action={<Badge color={org === 'owner' ? 'slate' : 'blue'}>{org === 'contractor' ? '施工日誌／自主檢查表自動起稿' : org === 'supervisor' ? '監造日誌自動起稿' : '查閱'}</Badge>}>
        <IntakeUploader />
      </Card>

      {/* 上傳批次:離頁／重新登入後從伺服器恢復;只列我建立的、未捨棄的 */}
      {isPersistedProject && can.write && (
        <Card title="上傳批次" action={<Badge color={intakes.length ? 'amber' : 'green'} className="num">{intakes.length}</Badge>} bodyClass="p-0">
          {fieldDocsLoading && intakes.length === 0 ? <p className="px-4 py-3 text-footnote text-[var(--text-3)]">同步伺服器上的批次…</p> : <IntakeList focusId={intakeParam} />}
        </Card>
      )}

      {/* 現場文書:未終態文件(與今日工作球權同一份資料);施工日誌／監造日誌／自主檢查表開頁,查驗表單 P3c 前只列狀態 */}
      <Card title="現場文書" action={<Badge color={docRows.some((r) => r.mineTurn) ? 'amber' : 'green'} className="num">{docRows.length}</Badge>} bodyClass="p-0">
        {docRows.length === 0 ? (
          <Empty icon="description">{demoMode ? '示範模式沒有現場文書；正式專案上傳照片後，擬好的施工日誌／監造日誌草稿會列在這裡。' : fieldDocsLoading ? '同步中…' : '尚無處理中的現場文書。上傳照片後，擬好的施工日誌／監造日誌草稿會列在這裡；已收件的文件不再列出。'}</Empty>
        ) : (
          <ul aria-label="現場文書清單" className="divide-y divide-[var(--border-2)]">
            {docRows.map(({ doc, meta, mineTurn, link }) => {
              const openable = !!link
              const inner = (
                <>
                  <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${mineTurn ? 'bg-[var(--amber-tint)] text-[var(--amber-text)]' : 'bg-[var(--slate-tint)] text-[var(--slate-text)]'}`}>
                    <MSym name="description" size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-body font-medium text-[var(--text)]">{DOC_TYPE_LABEL[doc.doc_type] || doc.doc_type} {doc.doc_date}{doc.doc_type === 'self_check' && doc.target_key ? ` · ${(adjustedById.get(doc.target_key.split(':')[1]) || {}).item_no || ''}`.trimEnd() : ''}</span>
                      <Badge color={meta.tone}>{meta.label}</Badge>
                      <span className="text-caption text-[var(--text-3)] num">版本 {doc.current_version_no}</span>
                    </span>
                    <span className="block mt-1 text-footnote text-[var(--text-2)] leading-snug">
                      {meta.action ? `下一步：${meta.action}` : doc.status === 'submitted' ? `等待${docToOrgLabel(doc)}收件` : doc.status === 'received' ? `${docToOrgLabel(doc)}已收件` : '—'}
                      {!openable && '・此類文書的頁面尚未支援（P3c）'}
                    </span>
                  </span>
                  {openable && <MSym name="chevron_right" size={16} className="text-[var(--text-3)] shrink-0 mt-1" />}
                </>
              )
              return (
                <li key={doc.id}>
                  {openable
                    ? <Link to={link} className="group flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-2)] transition-colors">{inner}</Link>
                    : <div className="flex items-start gap-3 px-4 py-3">{inner}</div>}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* 現場待辦:與今日工作同一份聚合,只取目的頁在現場紀錄群組的;列的樣式與首頁同一份(TaskRow) */}
      <Card title="現場待辦" action={<Badge color={siteTasks.length ? 'amber' : 'green'} className="num">{siteTasks.length}</Badge>} bodyClass="p-0">
        {siteTasks.length === 0 ? (
          <Empty icon="task_alt">現場沒有等你處理的事項。其他待辦請看<Link to="/dashboard" className="text-[var(--blue-text)] hover:underline mx-1">{BALL_SOURCES_TITLE}</Link>。</Empty>
        ) : (
          <ul aria-label="現場待辦清單" className="divide-y divide-[var(--border-2)]">
            {siteTasks.map((t) => <li key={t.key}><TaskRow task={t} /></li>)}
          </ul>
        )}
      </Card>

      <Card title="現場作業" bodyClass="p-0">
        <ul aria-label="現場作業入口" className="divide-y divide-[var(--border-2)]">
          {entries.map((e) => (
            <li key={e.to}>
              <Link to={e.to} className="group flex items-start gap-3 px-4 py-4 hover:bg-[var(--surface-2)] transition-colors">
                <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 bg-[var(--blue-tint)] text-[var(--blue-text)]">
                  <MSym name={e.icon} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-[var(--text)]">{e.label}</span>
                  <span className="block mt-1 text-footnote text-[var(--text-2)] leading-snug">{e.desc}</span>
                  {e.chips.length > 0 && (
                    <span className="flex flex-wrap gap-1.5 mt-2">
                      {e.chips.map((c) => <Badge key={c.label} color={c.tone} className="num">{c.label}</Badge>)}
                    </span>
                  )}
                </span>
                <MSym name="chevron_right" size={16} className="text-[var(--text-3)] group-hover:text-[var(--text-2)] shrink-0 mt-1" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="本月文件" bodyClass="p-0">
        <ul aria-label="本月文件" className="divide-y divide-[var(--border-2)]">
          {monthly.map((m) => (
            <li key={m.to}>
              <Link to={m.to} className="group flex items-start gap-3 px-4 py-4 hover:bg-[var(--surface-2)] transition-colors">
                <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 bg-[var(--slate-tint)] text-[var(--slate-text)]">
                  <MSym name="description" size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-[var(--text)]">{m.label}</span>
                  <span className="block mt-1 text-footnote text-[var(--text-2)] leading-snug">{m.desc}</span>
                </span>
                <MSym name="chevron_right" size={16} className="text-[var(--text-3)] group-hover:text-[var(--text-2)] shrink-0 mt-1" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
