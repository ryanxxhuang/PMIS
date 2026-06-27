import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { Card, Button, Field } from '../../components/ui.jsx'

// 預設帶入本契約資料（國際原住民文創園區），可改
const DEFAULTS = {
  project_name: '國際原住民族文化創意產業園區新建工程',
  project_code: '20200710',
  owner_name: '桃園市政府',
  contractor_name: '',
  supervisor_name: '',
  location: '桃園市',
  start_date: '2026-01-15',
  end_date: '2027-06-30',
}

export default function ProjectSetup() {
  const { createProject, currentUser } = useStore()
  const navigate = useNavigate()
  const [form, setForm] = useState({ ...DEFAULTS, contractor_name: currentUser?.company || '' })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const input = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-[#f26722] focus:outline-none'

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setLoading(true)
    const { error } = await createProject(form)
    setLoading(false)
    if (error) { setErr(error.message || '建立失敗，請再試一次'); return }
    // 成功 → 切到新專案並前往標單頁（引導匯入該案標單）
    navigate('/boq')
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-800">建立專案</h1>
        <p className="text-sm text-slate-500 mt-1">先建立一個工程專案，之後就能匯入標單、做估驗與進度。已帶入本契約預設值，可修改。</p>
      </div>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <Field label="工程名稱"><input className={input} value={form.project_name} onChange={set('project_name')} required /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="契約編號"><input className={input} value={form.project_code} onChange={set('project_code')} /></Field>
            <Field label="工程地點"><input className={input} value={form.location} onChange={set('location')} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="機關（業主）"><input className={input} value={form.owner_name} onChange={set('owner_name')} /></Field>
            <Field label="施工廠商"><input className={input} value={form.contractor_name} onChange={set('contractor_name')} /></Field>
            <Field label="監造單位"><input className={input} value={form.supervisor_name} onChange={set('supervisor_name')} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="開工日"><input type="date" className={input} value={form.start_date} onChange={set('start_date')} /></Field>
            <Field label="竣工日"><input type="date" className={input} value={form.end_date} onChange={set('end_date')} /></Field>
          </div>
          {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
          <Button type="submit" disabled={loading}>{loading ? '建立中…' : '建立專案'}</Button>
        </form>
      </Card>
    </div>
  )
}
