// 提醒中心:今日待辦的完整清單(首頁每段只亮 5 筆,溢位往這裡)。
// W8-2B 起與 Dashboard 吃同一支聚合;W9c 起連「聚合呼叫」與「列渲染」也共用
// (useTodayTasks+TaskRow)——這頁以前自己組 buildTodayTasks、自寫列樣式與
// 第二份 tag 色票,三個分岔點全數收斂,本頁只剩「怎麼分組」是自己的事。
import { Link } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Empty, PageHeader } from '../../components/ui.jsx'
import { useTodayTasks } from '../../lib/useTodayTasks.js'
import TaskRow from '../../components/TaskRow.jsx'

function TaskList({ items }) {
  return (
    <ul className="divide-y divide-[var(--border-2)]">
      {items.map((x) => <li key={x.key}><TaskRow task={x} /></li>)}
    </ul>
  )
}

export default function Alerts() {
  const { currentProject, isSupabaseConfigured } = useStore()
  const tasks = useTodayTasks()

  if (isSupabaseConfigured && !currentProject) {
    return <Card title="提醒中心"><Empty>請先登入並選擇專案。</Empty></Card>
  }

  const empty = tasks.mine.length === 0 && tasks.waiting.length === 0

  return (
    <div className="space-y-5">
      <PageHeader title="提醒中心" tagline="今日待辦的完整清單"
        subtitle="與首頁「今日待辦」同一份來源:先看輪到你的，再看在等誰。" />

      {empty ? (
        <Card title="提醒" bodyClass="p-0"><Empty>目前沒有逾期或待處理事項 — 都跟上了。</Empty></Card>
      ) : (
        <>
          {tasks.mine.length > 0 && (
            <Card title={`現在輪到我（${tasks.mine.length}）`} bodyClass="p-0"><TaskList items={tasks.mine} /></Card>
          )}
          {tasks.waiting.length > 0 && (
            <Card title={`等待對方（${tasks.waiting.length}）`} bodyClass="p-0"><TaskList items={tasks.waiting} /></Card>
          )}
        </>
      )}

      {/* 期限「已提送」鈕在契約重點頁且只有廠商可按,所以監造／機關責任的期限
          不會出現在上面兩段——不做誠實說明的話,那些期限會像憑空消失。 */}
      <p className="text-xs text-[var(--text-3)]">
        契約期限的完整時程與責任方在「
        <Link to="/requirements" className="text-[var(--blue-text)] hover:underline">契約重點</Link>
        」；這裡只列你這方現在做得到的事。
      </p>
    </div>
  )
}
