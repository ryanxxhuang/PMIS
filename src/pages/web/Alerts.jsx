// 提醒中心:今日待辦的完整清單(首頁每段只亮 5 筆,溢位往這裡)。
// W8-2B 起與 Dashboard 吃同一支 buildTodayTasks —— 這頁以前自己內嵌一套
// 契約/試體/驗收/停留點/請款規則且完全不看球權,結果三方看到同一份、
// 也和首頁對不起來(W8-2A §2.5 的 C)。現在只剩「怎麼分組顯示」是本頁的事。
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Empty, PageHeader } from '../../components/ui.jsx'
import { buildTodayTasks } from '../../lib/todayTasks.js'

// tag 配色對齊首頁 Dashboard 的 TAG_META:同一筆待辦在兩頁應該是同一個顏色語意。
// 這裡漏鍵不會壞掉、只會靜默退成灰字(看起來像「未分類」),所以 buildTodayTasks
// 新增 tag 時兩邊都要補——W8-6 的「日誌」就是只補了首頁。
const TAG_COLOR = {
  契約: 'var(--purple-text)', 缺失: 'var(--red-text)', 工安缺失: 'var(--amber-text)',
  試驗: 'var(--accent-text)', 驗收: 'var(--green-text)', 停留點: 'var(--red-text)',
  估驗: 'var(--blue-text)', 送審: 'var(--blue-text)', 疑義: 'var(--purple-text)',
  查驗: 'var(--amber-text)', 觀察: 'var(--slate-text)', 變更: 'var(--green-text)',
  日誌: 'var(--blue-text)',
}

function TaskList({ items }) {
  return (
    <div className="space-y-1.5">
      {items.map((x) => (
        <Link key={x.key} to={x.to}
          className="flex items-start gap-3 px-3 py-2 rounded-lg border border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors">
          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded shrink-0 mt-0.5"
            style={{ color: TAG_COLOR[x.tag] || 'var(--text-3)', background: 'var(--surface-2)' }}>{x.tag}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-[var(--text)]">{x.title}</div>
            <div className={`text-xs leading-snug ${x.overdueDays ? 'text-[var(--red-text)] font-medium' : 'text-[var(--text-3)]'}`}>{x.meta}</div>
          </div>
          <span className="text-[var(--text-3)] text-xs shrink-0 mt-0.5">→</span>
        </Link>
      ))}
    </div>
  )
}

export default function Alerts() {
  const {
    project, currentUser, currentProject, isSupabaseConfigured,
    obligations, defects, valuations, testSamples, acceptanceEvents, inspectionPoints,
    inspections, siteLogs, submittals, rfis, observations, changeOrders,
  } = useStore()
  const org = currentUser?.org_type || 'contractor'

  const tasks = useMemo(() => buildTodayTasks({
    org, today: new Date(),
    anchors: {
      award_date: project?.award_date, notice_date: project?.notice_date,
      commencement_date: project?.commencement_date, end_date: project?.end_date,
    },
    rfis, submittals, valuations, defects, inspections, observations, changeOrders,
    obligations, testSamples, acceptanceEvents, inspectionPoints, siteLogs,
  }), [org, project, rfis, submittals, valuations, defects, inspections, observations, changeOrders,
    obligations, testSamples, acceptanceEvents, inspectionPoints, siteLogs])

  if (isSupabaseConfigured && !currentProject) {
    return <Card title="提醒中心"><Empty>請先登入並選擇專案。</Empty></Card>
  }

  const empty = tasks.mine.length === 0 && tasks.waiting.length === 0

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <PageHeader title="提醒中心" tagline="今日待辦的完整清單"
          subtitle="與首頁「今日待辦」同一份來源:先看輪到你的，再看在等誰。" />
      </div>

      {empty ? (
        <Card title="提醒"><Empty>目前沒有逾期或待處理事項 — 都跟上了。</Empty></Card>
      ) : (
        <>
          {tasks.mine.length > 0 && (
            <Card title={`現在輪到我（${tasks.mine.length}）`}><TaskList items={tasks.mine} /></Card>
          )}
          {tasks.waiting.length > 0 && (
            <Card title={`等待對方（${tasks.waiting.length}）`}><TaskList items={tasks.waiting} /></Card>
          )}
        </>
      )}

      {/* 契約義務的完成鈕在專案文件頁且只有廠商可按,所以監造／機關責任的義務
          不會出現在上面兩段——不做誠實說明的話,那些期限會像憑空消失。 */}
      <p className="text-xs text-[var(--text-3)]">
        契約應辦事項的完整時程與責任方在「
        <Link to="/contract" className="text-[var(--blue-text)] hover:underline">專案文件</Link>
        」；這裡只列你這方現在做得到的事。
      </p>
    </div>
  )
}
