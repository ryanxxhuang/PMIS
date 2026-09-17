// 現場紀錄總覽:D-026 四主入口「現場紀錄」的入口頁(2026-09-17 瘦身 P1a)。
// 這一頁不新增任何業務規則——件數與待辦都吃既有引擎(useTodayTasks、itpStatus、sampleAlerts,
// 查驗/缺失的狀態字串與 ballInCourt 同一份),入口一律是既有子頁的合法路由與單條參數;
// 依角色只列「你在這裡能辦的事」(can 只是 UX,伺服器仍是安全邊界)。
// P2c 起這一頁承載照片上傳與現場文書清單(field-documents-lifecycle §3.3);現在不預先畫出
// 半套上傳或簽署流程,只給可直接辦理的現場作業入口。
import { useEffect, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Badge, Empty, PageHeader } from '../../components/ui.jsx'
import { MSym } from '../../components/icons.jsx'
import TaskRow from '../../components/TaskRow.jsx'
import { useTodayTasks } from '../../lib/useTodayTasks.js'
import { visibleNavGroups, routeAllowed, BALL_SOURCES_TITLE } from '../../lib/navConfig.js'
import { taipeiToday } from '../../lib/dates.js'
import { itpStatus } from '../../lib/itp.js'
import { sampleAlerts } from '../../lib/qc.js'

const pathOf = (to) => String(to || '').split('?')[0]

// 依角色的一句話:只描述該角色在該頁真的做得到的動作(廠商填報/申請、監造判定/複查、機關查閱)
const DESC = {
  '/site-log': { contractor: '填今天的施作數量與現場照片；存檔後估驗可帶入累計。', supervisor: '查閱廠商每日日誌與照片；需要查驗時到品質查驗。', owner: '查閱每日施工紀錄與照片。' },
  '/quality': { contractor: '申請查驗、改善缺失後提送複查。', supervisor: '判定待查驗項目；不合格開立缺失，改善後複查結案。', owner: '查閱查驗結果與缺失改善情形。' },
  checklist: { contractor: '填寫自主檢查表，合格後可隨查驗申請檢附。', supervisor: '查閱廠商自主檢查紀錄與修訂版。', owner: '查閱廠商自主檢查紀錄。' },
  samples: { contractor: '登錄試體 7 天／28 天試驗值；不合格自動開缺失。', supervisor: '查閱試體試驗結果與逾期未填。', owner: '查閱試體試驗結果。' },
  '/itp': { contractor: '施作到停留點前先申請查驗；H 點未查驗不得續作。', supervisor: '設定停留點並查驗；未申請的 H 點會提醒。', owner: '查閱停留點的查驗狀態。' },
  '/safety': { contractor: '登錄自主檢查、教育訓練與危害告知；處理工安缺失。', supervisor: '登錄監造觀察／查驗／複查；開立與複查工安缺失。', owner: '追蹤工安紀錄與尚未結案的工安缺失。' },
}

export default function Site() {
  const { currentUser, project, siteLogs, inspections, defects, checklistRecords, testSamples, inspectionPoints, can, isPlatformAdmin } = useStore()
  const { mine } = useTodayTasks()
  const { state } = useLocation()
  const org = currentUser?.org_type || 'contractor'
  const today = taipeiToday()

  // 現場待辦=「現在輪到我」裡目的頁落在現場紀錄群組子頁的那些;群組定義只在 navConfig,
  // 這裡不手抄路徑清單(子頁增減會自動跟上)。
  const sitePaths = useMemo(() => {
    const group = visibleNavGroups(org, can?.override, isPlatformAdmin).flatMap((g) => g.items).find((n) => n.to === '/site')
    return new Set((group?.tabs || []).map((t) => t.to).filter((to) => to !== '/site'))
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
    return { hasTodayLog, pendingInsp, openQualityDefects, openSafetyDefects, pendingSamples, overdueSamples, itp, checklists: (checklistRecords || []).length }
  }, [siteLogs, inspections, defects, testSamples, inspectionPoints, checklistRecords, today])

  // 現場作業入口:to 是既有子頁的路由(含單條參數/分段),不是新流程。件數只列非零的,零件數不製造噪音。
  const entries = [
    { to: `/site-log?d=${today}`, icon: 'edit_note', label: '施工日誌', desc: DESC['/site-log'][org],
      chips: [counts.hasTodayLog
        ? { label: '今日已填', tone: 'green' }
        : { label: can.edit ? '今日未填' : '今日尚無日誌', tone: can.edit ? 'amber' : 'slate' }] },
    { to: '/quality?seg=inspections', icon: 'verified_user', label: '品質查驗', desc: DESC['/quality'][org],
      chips: [counts.pendingInsp > 0 && { label: `待查驗 ${counts.pendingInsp}`, tone: 'amber' },
        counts.openQualityDefects > 0 && { label: `未結案缺失 ${counts.openQualityDefects}`, tone: 'red' }] },
    { to: '/quality?seg=checklist', icon: 'checklist', label: '自主檢查表', desc: DESC.checklist[org],
      chips: [counts.checklists > 0 && { label: `${counts.checklists} 份`, tone: 'slate' }] },
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

  return (
    <div className="space-y-5">
      <PageHeader title="現場紀錄" tagline={project?.project_name}
        subtitle="日誌、查驗、自主檢查、試驗、停留點與工安的入口；件數只計本案尚未處理的事項。"
        meta={[{ k: '日期', v: today }]} />

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
