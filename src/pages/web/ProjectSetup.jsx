import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, ErrorBanner, Input, PageHeader } from '../../components/ui.jsx'
import { friendlyError } from '../../lib/errorMessage.js'

// 正式站一律留空,用 placeholder 當範例提示;不預填任何真實案值,避免使用者只改名就
// 建出錯的契約/機關/廠商(P1-04)。施工廠商也不自動帶登入者公司。
const DEFAULTS = {
  project_name: '', project_code: '', owner_name: '', contractor_name: '',
  supervisor_name: '', location: '', start_date: '', end_date: '', commencement_date: '',
}

export default function ProjectSetup() {
  const { createProject } = useStore()
  const navigate = useNavigate()
  const [form, setForm] = useState({ ...DEFAULTS })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setLoading(true)
    const { error } = await createProject(form)
    setLoading(false)
    if (error) { setErr(friendlyError(error, '專案建立失敗，請再試一次')); return }
    // 成功 → 前往專案文件(D-007 文件優先:標單/契約/規範一次上傳,初始化只有這一條路)
    navigate('/contract')
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* 頁首走 PageHeader:標題字級/副標與站內其他頁同一套,也才有工作面分頁掛載點 */}
      <PageHeader title="建立專案" tagline="New Project"
        subtitle="先建立一個工程專案，接著到「專案文件」把標單、契約等文件一次上傳。請填寫工程基本資料（僅工程名稱必填，其餘可稍後補）。" />
      <Card>
        <form onSubmit={submit} className="space-y-4">
          {/* 必填說明只寫在導言會被跳過(導言是一段長句):表單頂端再標一次,與欄位上的紅＊對應 */}
          <p className="text-xs text-[var(--text-3)]"><span className="text-[var(--red-text)]">＊</span> 為必填</p>
          <Field label="工程名稱" required><Input value={form.project_name} onChange={set('project_name')} placeholder="如 ○○新建工程" required /></Field>
          {/* 手機單欄、sm 起才並排:375px 硬塞三欄每格只剩 ~100px,日期欄連 yyyy/mm/dd 都擠不下,
              三方名稱欄也只看得到兩三個字;沒溢位不代表能用 */}
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="契約編號"><Input value={form.project_code} onChange={set('project_code')} placeholder="如 20250101" /></Field>
            <Field label="工程地點"><Input value={form.location} onChange={set('location')} placeholder="如 ○○市○○區" /></Field>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="機關（業主）"><Input value={form.owner_name} onChange={set('owner_name')} placeholder="如 ○○市政府" /></Field>
            <Field label="施工廠商"><Input value={form.contractor_name} onChange={set('contractor_name')} placeholder="施作廠商名稱" /></Field>
            <Field label="監造單位"><Input value={form.supervisor_name} onChange={set('supervisor_name')} placeholder="監造單位名稱" /></Field>
          </div>
          {/* 前兩欄寫 projects.start_date/end_date(契約預定值);期限引擎的開工基準是
              另一欄 commencement_date——預定與實際刻意分開,引擎照猜的日期跑會發錯提醒。
              第三欄(選填)服務「導入進行中案」:開工日早已知道,不該逼使用者建完案
              再去找設定入口;還沒開工就留空,之後在「契約重點」的履約期程設定。 */}
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="預計開工日" hint="契約預定值,僅供參考;期限引擎不用它起算。"><Input type="date" value={form.start_date} onChange={set('start_date')} /></Field>
            <Field label="預計竣工日" hint="完工類期限以此為到期基準;可日後在「契約重點」的履約期程修改。"><Input type="date" value={form.end_date} onChange={set('end_date')} /></Field>
            <Field label="實際開工日(選填)" hint="已開工的案子才填,開工類期限以此起算;未開工請留空,接獲開工通知後再到「契約重點」的履約期程設定。"><Input type="date" value={form.commencement_date} onChange={set('commencement_date')} /></Field>
          </div>
          <ErrorBanner msg={err} />
          <Button type="submit" disabled={loading}>{loading ? '建立中…' : '建立專案'}</Button>
        </form>
      </Card>
    </div>
  )
}
