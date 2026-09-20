// 現場紀錄總覽:D-026 四主入口「現場紀錄」的入口頁(2026-09-17 瘦身 P1a;P2c 接上傳與文書)。
// 這一頁不新增任何業務規則——件數與待辦都吃既有引擎(useTodayTasks、itpStatus、sampleAlerts,
// 查驗/缺失的狀態字串與 ballInCourt 同一份),入口一律是既有子頁的合法路由與單條參數;
// 依角色只列「你在這裡能辦的事」(can 只是 UX,伺服器仍是安全邊界)。
// P2c:主動作「拍照／上傳」(IntakeUploader:保存照片→伺服器辨識起稿)、「上傳批次」(離頁／重登入後
// 從伺服器恢復,IntakeList)、「現場文書」清單(field_documents 未終態,與今日工作球權同一份資料;
// 施工日誌開 /site-log?doc=、監造日誌開 /supervisor-log?doc=(P3a)、自主檢查表開 /self-check?doc=(P3b)、監造查驗表單開
// /inspection-form?doc=(P3c);頁面路由由 lib/fieldDocs.docPageLink 決定)。?doc=<id>(P5a 待辦的直達參數)落到這裡後轉到該文件的頁面;?intake=<id> 展開該批。
// P3f:責任方從未簽署的草稿在清單列上可「捨棄」(DiscardDraftButton,原因必填;規則在伺服器);文件頁捨棄後也回到這裡,
// 以導覽 state.discardedDoc 說明已捨棄與如何重新起稿。
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Badge, Empty, PageHeader } from '../../components/ui.jsx'
import { MSym } from '../../components/icons.jsx'
import TaskRow from '../../components/TaskRow.jsx'
import IntakeUploader from '../../components/sitelog/IntakeUploader.jsx'
import IntakeList from '../../components/sitelog/IntakeList.jsx'
import DiscardDraftButton from '../../components/sitelog/DiscardDraftButton.jsx'
import { useTodayTasks } from '../../lib/useTodayTasks.js'
import { navGroups, visibleNavGroups, routeAllowed, BALL_SOURCES_TITLE } from '../../lib/navConfig.js'
import { taipeiToday } from '../../lib/dates.js'
import { docStatusMeta, DOC_TYPE_LABEL, docPageLink, docPagePath, docToOrgLabel, fieldDocInWorkList } from '../../lib/fieldDocs.js'

const pathOf = (to) => String(to || '').split('?')[0]

// 依角色的一句話:只描述該角色在該頁真的做得到的動作(廠商填報/申請、監造判定/複查、機關查閱)。
// 鍵＝現場紀錄群組的子頁路由;卡片只列該角色在導覽上看得到的子頁(A 包),所以不再有
// 試體／停留點／工安三張與查驗並列的卡——它們是品質查驗與缺失引擎的一部分,從那裡進。
const DESC = {
  '/site-log': { contractor: '審核系統擬好的日誌草稿、補齊待補欄位，簽署後提送監造。', supervisor: '查閱廠商每日日誌與照片；提送後在此收件或退回。', owner: '查閱每日施工紀錄與照片。' },
  '/supervisor-log': { supervisor: '審核系統擬好的監造日誌草稿、親自確認到場人員，簽署後提送機關。', owner: '查閱監造每日紀錄；監造提送後在此收件或退回。' },
  '/quality': { contractor: '申請查驗、改善缺失後提送複查；試體試驗與檢驗停留點也在這裡。', supervisor: '判定待查驗項目；不合格開立缺失，改善後複查結案；試體與停留點同頁。', owner: '查閱查驗結果與缺失改善情形；試體與停留點同頁。' },
  '/self-check': { contractor: '審核系統擬好的自主檢查表草稿、親自填實測值，簽署後可隨查驗申請檢附。', supervisor: '查閱廠商自主檢查表與修訂版；提送後在此收件或退回。', owner: '查閱廠商自主檢查紀錄。' },
  '/inspection-form': { supervisor: '由查驗申請建立表單、親自判定並填本次確認數量；簽署即判定，確認量成為廠商可估驗的依據。', owner: '查閱監造查驗判定與確認數量；提送後在此收件。' },
}

export default function Site() {
  const { currentUser, project, siteLogs, inspections, defects, checklistRecords, can, isPlatformAdmin,
    fieldDocuments, fieldDocsLoading, intakes, isPersistedProject, demoMode, adjustedItems } = useStore()
  const adjustedById = useMemo(() => new Map((adjustedItems || []).filter((it) => it.id).map((it) => [it.id, it])), [adjustedItems])
  const { mine } = useTodayTasks()
  const { state } = useLocation()
  const [params] = useSearchParams()
  const org = currentUser?.org_type || 'contractor'
  const today = taipeiToday()
  const documents = useMemo(() => fieldDocuments?.documents || [], [fieldDocuments])
  const signedDocIds = useMemo(() => new Set(fieldDocuments?.signedDocumentIds || []), [fieldDocuments])
  // 剛捨棄的草稿(清單列上捨棄,或文件頁捨棄後導回):說明結果與重新起稿的入口
  const [discarded, setDiscarded] = useState(() => state?.discardedDoc || null)
  const docParam = params.get('doc')
  const intakeParam = params.get('intake')

  // 現場作業入口=該角色在導覽上看得見的現場紀錄子頁(navConfig 單一來源;A 包起監造日誌與
  // 監造查驗表單對廠商 hiddenFor、停留點與工安 hidden)。這裡不再手抄入口清單,子頁增減自動跟上。
  const siteTabs = useMemo(() => {
    const group = visibleNavGroups(org, can?.override, isPlatformAdmin).flatMap((g) => g.items).find((n) => n.to === '/site')
    return (group?.tabs || []).filter((t) => t.to !== '/site') // 現場總覽就是本頁,不當入口
  }, [org, can?.override, isPlatformAdmin])

  // 現場待辦=「現在輪到我」裡目的頁落在現場紀錄群組子頁的那些。這裡刻意用「群組定義」而不是
  // 「可見入口」:入口收起不等於提醒消失(停留點未叫驗、工安缺失仍是現場的事),照原權限(routeAllowed)
  // 判能不能去。現場文書待辦的 to 是 /site?doc=,也算本頁。
  const sitePaths = useMemo(() => {
    const group = navGroups.flatMap((g) => g.items).find((n) => n.to === '/site')
    return new Set((group?.tabs || []).map((t) => t.to).filter((to) => routeAllowed(to, org, can?.override, isPlatformAdmin)))
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
    const inspectionFormDocs = documents.filter((d) => d.doc_type === 'inspection_form')
    const pendingInsp = (inspections || []).filter((i) => i.status === '待查驗').length
    const openQualityDefects = (defects || []).filter((d) => (d.domain || 'quality') !== 'safety' && d.status !== '已結案').length
    return { hasTodayLog, todayDoc, todaySupDoc, selfCheckOpen: selfCheckDocs.filter((d) => ['draft', 'pending_input', 'returned'].includes(d.status)).length, selfCheckSubmitted: selfCheckDocs.filter((d) => d.status === 'submitted').length,
      inspectionFormOpen: inspectionFormDocs.filter((d) => ['draft', 'pending_input', 'returned'].includes(d.status)).length, inspectionFormSubmitted: inspectionFormDocs.filter((d) => d.status === 'submitted').length,
      pendingInsp, openQualityDefects, checklists: (checklistRecords || []).length }
  }, [siteLogs, documents, inspections, defects, checklistRecords, today])

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

  // 現場作業入口:每個可見子頁一張卡。連結(含單條參數/分段)與圖示、件數章住這裡,
  // 名稱與「哪些子頁該出現」取 navConfig(siteTabs)——入口清單不在這裡手抄第二份。
  // 件數只列非零的,零件數不製造噪音。
  const ENTRY_LINK = {
    '/site-log': { to: `/site-log?d=${today}`, icon: 'edit_note', chips: [todayLogChip] },
    '/supervisor-log': { to: `/supervisor-log?d=${today}`, icon: 'fact_check', chips: [todaySupChip] },
    '/quality': { to: '/quality?seg=inspections', icon: 'verified_user',
      chips: [counts.pendingInsp > 0 && { label: `待查驗 ${counts.pendingInsp}`, tone: 'amber' },
        counts.openQualityDefects > 0 && { label: `未結案缺失 ${counts.openQualityDefects}`, tone: 'red' }] },
    // 自主檢查表(P3b):文件頁(照片起稿→實測值人填→簽署→提送);簽署落下的紀錄與直接寫入的紀錄都在 /quality 檢查表分段
    '/self-check': { to: '/self-check', icon: 'checklist',
      chips: [counts.selfCheckOpen > 0 && { label: `處理中 ${counts.selfCheckOpen}`, tone: 'amber' },
        counts.selfCheckSubmitted > 0 && { label: `待監造收件 ${counts.selfCheckSubmitted}`, tone: 'blue' },
        counts.checklists > 0 && { label: `紀錄 ${counts.checklists} 份`, tone: 'slate' }] },
    // 監造查驗表單(P3c):由待查驗申請建立、簽署即判定並寫入確認量(廠商可估驗的依據)
    '/inspection-form': { to: '/inspection-form', icon: 'task_alt',
      chips: [counts.inspectionFormOpen > 0 && { label: `處理中 ${counts.inspectionFormOpen}`, tone: 'amber' },
        counts.inspectionFormSubmitted > 0 && { label: `待收件 ${counts.inspectionFormSubmitted}`, tone: 'blue' },
        counts.pendingInsp > 0 && can.approve && { label: `待判定 ${counts.pendingInsp}`, tone: 'amber' }] },
  }
  const entries = siteTabs
    .filter((t) => ENTRY_LINK[t.to] && DESC[t.to]?.[org])
    .map((t) => ({ ...ENTRY_LINK[t.to], label: t.label, desc: DESC[t.to][org], chips: ENTRY_LINK[t.to].chips.filter(Boolean) }))

  // 現場文書清單:這是「我的文件」——我負責的文書,加上已提送給我、等我收件或退回的。
  // 他方尚未提送的草稿／待補／待提送不列(A 包:廠商看到監造起稿中的監造日誌與查驗表單,
  // 會誤以為那是自己要填的);規則在 lib/fieldDocs.fieldDocInWorkList,不在頁面寫第二份。
  // 排序:輪到我的在前(由 docStatusMeta 依文書類型判),再依更新時間。
  const docRows = useMemo(() => {
    const rows = documents.filter((d) => fieldDocInWorkList(d, org)).map((d) => {
      const meta = docStatusMeta(d, org)
      return { doc: d, meta, mineTurn: !!meta.action, link: docPageLink(d) }
    })
    return rows.sort((a, b) => (Number(b.mineTurn) - Number(a.mineTurn)) || String(b.doc.updated_at || '').localeCompare(String(a.doc.updated_at || '')))
  }, [documents, org])

  // 空清單文案:只列「你會起稿的」文書類型,不把對方的作業寫成你的(廠商不起稿監造文書)
  const myDocKinds = org === 'contractor' ? '施工日誌／自主檢查表' : org === 'supervisor' ? '監造日誌／監造查驗表單' : '三方現場文書'

  // ?doc=<id>:今日工作／Agent 的現場文書待辦帶的直達參數(P5a);有頁面的類型轉到它的頁面(保留返回來源 state)
  const targetDoc = docParam ? documents.find((d) => d.id === docParam) : null
  const targetLink = targetDoc ? docPageLink(targetDoc) : null
  if (targetLink) {
    return <Navigate to={targetLink} replace state={state} />
  }

  return (
    <div className="space-y-5">
      <PageHeader title="現場紀錄" tagline={project?.project_name}
        subtitle="拍照上傳後由系統擬稿，審核、簽署、提送都在這裡；日誌、自主檢查與查驗的入口；件數只計本案尚未處理的事項。"
        meta={[{ k: '日期', v: today }]} />

      {discarded && (
        <p role="status" className="text-footnote text-[var(--text-2)] rounded-lg bg-[var(--surface-2)] px-3 py-2">
          已捨棄 {discarded.doc_date} {DOC_TYPE_LABEL[discarded.doc_type] || '文件'}草稿{discarded.reason ? `（原因：${discarded.reason}）` : ''}；版本與照片都保留，原因已留在稽核紀錄。
          要重新起稿，可在下方重新拍照上傳，或到{docPagePath(discarded.doc_type) ? <Link to={`${docPagePath(discarded.doc_type)}${['daily_log', 'supervisor_log'].includes(discarded.doc_type) ? `?d=${discarded.doc_date}` : ''}`} className="text-[var(--blue-text)] hover:underline mx-1">{DOC_TYPE_LABEL[discarded.doc_type]}頁</Link> : '文件頁'}重新填寫。
        </p>
      )}

      {docParam && !targetDoc && !fieldDocsLoading && (
        <p role="status" className="text-footnote text-[var(--text-2)]">找不到編號 {docParam} 的文書（可能已捨棄、不在本案，或連結已失效）；以下為本案現場文書清單。</p>
      )}

      {/* 主動作:拍照／上傳(廠商→施工日誌＋自主檢查表、監造→監造日誌＋監造查驗表單自動起稿;機關查閱) */}
      <Card title="拍照／上傳" action={<Badge color={org === 'owner' ? 'slate' : 'blue'}>{org === 'contractor' ? '施工日誌／自主檢查表自動起稿' : org === 'supervisor' ? '監造日誌／查驗表單自動起稿' : '查閱'}</Badge>}>
        <IntakeUploader />
      </Card>

      {/* 上傳批次:離頁／重新登入後從伺服器恢復;只列我建立的、未捨棄的 */}
      {isPersistedProject && can.write && (
        <Card title="上傳批次" action={<Badge color={intakes.length ? 'amber' : 'green'} className="num">{intakes.length}</Badge>} bodyClass="p-0">
          {fieldDocsLoading && intakes.length === 0 ? <p className="px-4 py-3 text-footnote text-[var(--text-3)]">同步伺服器上的批次…</p> : <IntakeList focusId={intakeParam} />}
        </Card>
      )}

      {/* 現場文書:我負責的未終態文件＋已提送給我等收件的(與今日工作球權同一份資料);四類文書皆開各自頁面 */}
      <Card title="現場文書" action={<Badge color={docRows.some((r) => r.mineTurn) ? 'amber' : 'green'} className="num">{docRows.length}</Badge>} bodyClass="p-0">
        {docRows.length === 0 ? (
          <Empty icon="description">{demoMode ? `示範模式沒有現場文書；正式專案上傳照片後，擬好的${myDocKinds}草稿會列在這裡。` : fieldDocsLoading ? '同步中…' : `尚無處理中的現場文書。上傳照片後，擬好的${myDocKinds}草稿會列在這裡；對方提送給你的文件也會列在這裡等收件。`}</Empty>
        ) : (
          <ul aria-label="現場文書清單" className="divide-y divide-[var(--border-2)]">
            {docRows.map(({ doc, meta, mineTurn, link }) => {
              const inspTitle = doc.doc_type === 'inspection_form' && doc.target_key ? (inspections || []).find((i) => i.id === doc.target_key)?.title : null
              const inner = (
                <>
                  <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${mineTurn ? 'bg-[var(--amber-tint)] text-[var(--amber-text)]' : 'bg-[var(--slate-tint)] text-[var(--slate-text)]'}`}>
                    <MSym name="description" size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-body font-medium text-[var(--text)]">{DOC_TYPE_LABEL[doc.doc_type] || doc.doc_type} {doc.doc_date}{doc.doc_type === 'self_check' && doc.target_key ? ` · ${(adjustedById.get(doc.target_key.split(':')[1]) || {}).item_no || ''}`.trimEnd() : ''}{inspTitle ? ` · ${inspTitle}` : ''}</span>
                      <Badge color={meta.tone}>{meta.label}</Badge>
                      <span className="text-caption text-[var(--text-3)] num">版本 {doc.current_version_no}</span>
                    </span>
                    <span className="block mt-1 text-footnote text-[var(--text-2)] leading-snug">
                      {meta.action ? `下一步：${meta.action}` : doc.status === 'submitted' ? `等待${docToOrgLabel(doc)}收件` : doc.status === 'received' ? `${docToOrgLabel(doc)}已收件` : '—'}
                    </span>
                  </span>
                  <MSym name="chevron_right" size={16} className="text-[var(--text-3)] shrink-0 mt-1" />
                </>
              )
              return (
                <li key={doc.id} className="flex items-start">
                  <Link to={link} className="group flex-1 min-w-0 flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-2)] transition-colors">{inner}</Link>
                  {/* 捨棄草稿:在連結之外(不巢狀互動元件);只有責任方、從未簽署的草稿才出現 */}
                  <DiscardDraftButton doc={doc} viewerOrg={org} everSigned={signedDocIds.has(doc.id)} canAct={!!can.write}
                    variant="ghost" label="捨棄" className="shrink-0 max-w-[45%] justify-end pr-3 py-2.5"
                    onDiscarded={(result) => setDiscarded({ doc_type: doc.doc_type, doc_date: doc.doc_date, reason: result?.discard_reason || null })} />
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

      {/* 「本月文件」卡已隨月報入口一起收起(A 包):兩張月報只是已簽署文件的月彙整,不是現場作業;
          提醒信與舊連結照原角色仍可直達 /monthly-report、/supervisor-report。 */}
    </div>
  )
}
