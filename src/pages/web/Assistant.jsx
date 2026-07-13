import { Link } from 'react-router-dom'
import { ShieldCheck, Bot } from 'lucide-react'
import { Card, Empty, PageHeader } from '../../components/ui.jsx'
import { useAssistantData } from '../../lib/assistantData.js'
import CopilotChat from '../../components/CopilotChat.jsx'

// §9-8 去重:主動分析(insights)只在 Dashboard 出現,這裡專心做問答。
// 問答核心與右下角浮動鈕共用 CopilotChat + useAssistantData。
const ROLE_HELLO = {
  contractor: '問我本案的進度、估驗請款、缺失查驗、品管取樣和契約義務——答案附出處。',
  supervisor: '問我本案的查驗、待審、缺失複查與進度——答案附出處。',
  owner: '問我本案的風險、變更、撥款與進度——答案附出處。',
}

export default function Assistant() {
  const { data, facts, askAssistant, imported, org } = useAssistantData()

  if (!imported) {
    return (
      <div className="space-y-5">
        <PageHeader title="AI 助理" tagline="Copilot" subtitle="先幫你看到該注意的，也能隨時問專案問題" />
        <Card><Empty>此專案尚未匯入標單，AI 助理還沒有資料可分析。請先到「標單工項」匯入 PCCES 預算書。</Empty></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title="AI 助理" tagline="Copilot"
        subtitle={ROLE_HELLO[org] || ROLE_HELLO.contractor}
        meta={[{ k: '模式', v: '唯讀' }]} />

      <div className="max-w-3xl">
        <Card title="問我專案的事" bodyClass="p-0"
          action={<span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-3)]"><Bot size={12} aria-hidden />附出處</span>}>
          <CopilotChat data={data} facts={facts} askAssistant={askAssistant} />
        </Card>
      </div>

      <p className="text-[11px] text-[var(--text-3)] flex items-center gap-1.5">
        <ShieldCheck size={13} aria-hidden />
        AI 助理只讀本案資料、附上出處，<b className="text-[var(--text-2)] font-medium">不會替你送出或核定任何東西</b>。
        主動分析在 <Link to="/dashboard" className="text-[var(--blue-text)] hover:underline">專案 Dashboard</Link>、期限提醒在 <Link to="/alerts" className="text-[var(--blue-text)] hover:underline">提醒中心</Link>。
        右下角的浮動按鈕讓你在任何頁面都能問。
      </p>
    </div>
  )
}
