import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Button, Field, ErrorBanner, Input, PageHeader } from '../../components/ui.jsx'

// 正式站一律留空,用 placeholder 當範例提示;不預填任何真實案值,避免使用者只改名就
// 建出錯的契約/機關/廠商(P1-04)。施工廠商也不自動帶登入者公司。
const DEFAULTS = {
  project_name: '', project_code: '', owner_name: '', contractor_name: '',
  supervisor_name: '', location: '', start_date: '', end_date: '',
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
    if (error) { setErr(error.message || '建立失敗，請再試一次'); return }
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
          <div className="grid grid-cols-2 gap-4">
            <Field label="契約編號"><Input value={form.project_code} onChange={set('project_code')} placeholder="如 20250101" /></Field>
            <Field label="工程地點"><Input value={form.location} onChange={set('location')} placeholder="如 ○○市○○區" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="機關（業主）"><Input value={form.owner_name} onChange={set('owner_name')} placeholder="如 ○○市政府" /></Field>
            <Field label="施工廠商"><Input value={form.contractor_name} onChange={set('contractor_name')} placeholder="施作廠商名稱" /></Field>
            <Field label="監造單位"><Input value={form.supervisor_name} onChange={set('supervisor_name')} placeholder="監造單位名稱" /></Field>
          </div>
          {/* 這兩欄寫的是 projects.start_date/end_date(契約預定值),不是期限引擎的開工基準
              ——引擎讀的是另一欄 commencement_date,由「專案文件→基準日」登錄。同標籤兩欄位
              會讓使用者以為在這裡填了開工日,義務時程就會開始倒數,所以標題明寫「預計」。 */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="預計開工日" hint="實際開工日於接獲開工通知後,到「專案文件→基準日」登錄。"><Input type="date" value={form.start_date} onChange={set('start_date')} /></Field>
            <Field label="預計竣工日" hint="完工類義務以此為到期基準;可日後在「專案文件→基準日」修改。"><Input type="date" value={form.end_date} onChange={set('end_date')} /></Field>
          </div>
          <ErrorBanner msg={err} />
          <Button type="submit" disabled={loading}>{loading ? '建立中…' : '建立專案'}</Button>
        </form>
      </Card>
    </div>
  )
}
