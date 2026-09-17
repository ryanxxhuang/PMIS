// 今日工作「列」的唯一渲染:Dashboard 首頁與提醒中心共用——同一筆待辦在兩頁
// 必須長一樣。W9c 之前 Alerts 自寫一套(逐列外框+inline style 色票+文字箭頭),
// 與首頁分岔;tag 色票也各留一份且值已漂移(工安缺失兩頁不同色)。
// 現在列樣式與 tag→圖示/色票都只有這一份。
import { Link, useLocation } from 'react-router-dom'
import { MSym } from './icons.jsx'
import { Badge } from './ui.jsx'
import { taskReturnState } from '../lib/taskReturn.js'

// tag → 圖示+五語意色調(單一真相;buildTodayTasks 新增 tag 時只補這裡)。
// 裁決:工安缺失=red(對齊缺失,原 Alerts 的 amber 是漂移);試驗=amber
// (原 accent 語意已改為 warn 家族)。
const TAG_META = {
  估驗: { icon: 'payments', tone: 'blue' },
  送審: { icon: 'task', tone: 'blue' },
  疑義: { icon: 'feedback', tone: 'purple' },
  查驗: { icon: 'verified_user', tone: 'amber' },
  缺失: { icon: 'warning', tone: 'red' },
  工安缺失: { icon: 'warning', tone: 'red' },
  觀察: { icon: 'visibility', tone: 'slate' },
  變更: { icon: 'build', tone: 'green' },
  契約: { icon: 'balance', tone: 'purple' },
  契約重點: { icon: 'balance', tone: 'purple' },
  試驗: { icon: 'science', tone: 'amber' },
  驗收: { icon: 'verified', tone: 'green' },
  停留點: { icon: 'report', tone: 'red' },
  日誌: { icon: 'edit_note', tone: 'blue' },
}
// class 對照表而非 inline style:深色模式與 token 調整才會自動跟上
const TILE = {
  blue: 'bg-[var(--blue-tint)] text-[var(--blue-text)]',
  purple: 'bg-[var(--purple-tint)] text-[var(--purple-text)]',
  amber: 'bg-[var(--amber-tint)] text-[var(--amber-text)]',
  red: 'bg-[var(--red-tint)] text-[var(--red-text)]',
  green: 'bg-[var(--green-tint)] text-[var(--green-text)]',
  slate: 'bg-[var(--slate-tint)] text-[var(--slate-text)]',
}

// 逾期列的期限改紅色 Badge:dueText 的句型固定(todayTasks.js),把「逾期 N 天（到期 date）」
// 原地換成色票、前後文字一字不動——e2e 以這段完整字串斷言逾期,不能增刪字或換順序。
// 句型比對不到(理論上不會)就整句退回原本紅字,寧可不美也不丟資訊。
const OVERDUE_RE = /逾期 \d+ 天（到期 \d{4}-\d{2}-\d{2}）/
function TaskMeta({ meta, overdue }) {
  const m = overdue ? String(meta || '').match(OVERDUE_RE) : null
  if (!m) return <span className={overdue ? 'text-[var(--red-text)] font-medium' : ''}>{meta}</span>
  return (
    <>
      {meta.slice(0, m.index)}
      <Badge color="red" className="align-middle">{m[0]}</Badge>
      {meta.slice(m.index + m[0].length)}
    </>
  )
}

export default function TaskRow({ task }) {
  // 返回來源(頁名與可否返回)由 lib/taskReturn 一張表決定,這裡不猜
  const location = useLocation()
  const m = TAG_META[task.tag] || { icon: 'visibility', tone: 'slate' }
  return (
    <Link id={`task-${task.key}`} to={task.to} state={taskReturnState(location, task.key)}
      className="group flex items-start gap-3 px-4 py-4 hover:bg-[var(--surface-2)] transition-colors">
      <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${TILE[m.tone]}`}>
        <MSym name={m.icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-[var(--text)]">{task.title}</span>
        <span className="block mt-1 text-footnote text-[var(--text-2)] leading-snug">
          <TaskMeta meta={task.meta} overdue={!!task.overdueDays} />
        </span>
      </span>
      <MSym name="chevron_right" size={16} className="text-[var(--text-3)] group-hover:text-[var(--text-2)] shrink-0 mt-1" />
    </Link>
  )
}
