import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store.jsx'
import { concreteInspectionForm } from '../../data/seed.js'

export default function SelfInspection() {
  const { forms, selfInspection, submitSelfInspection } = useStore()
  const navigate = useNavigate()
  const form = forms[0] || concreteInspectionForm
  const [values, setValues] = useState({ work_area: 'A 區 1F' })
  const [photo, setPhoto] = useState(false)
  const [signed, setSigned] = useState(false)

  if (selfInspection) {
    return (
      <Done
        title="自主檢查已送出"
        desc="表單已連結至契約要求，可用於查驗申請。"
        next="提出查驗申請"
        onNext={() => navigate('/m/inspection-request')}
      />
    )
  }

  const checks = form.fields.filter((f) => f.type === 'passfail')
  const allChecked = checks.every((c) => values[c.key])
  const canSubmit = allChecked && photo && signed && values.work_area

  const submit = () => {
    submitSelfInspection({ ...values, photo, signed })
  }

  return (
    <div className="space-y-3">
      <AIHint />

      <div className="bg-white rounded-xl p-3 border border-slate-200">
        <Label text="工區" required />
        <select
          value={values.work_area}
          onChange={(e) => setValues((v) => ({ ...v, work_area: e.target.value }))}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        >
          {['A 區 1F', 'A 區 2F', 'A 區地下室'].map((a) => <option key={a}>{a}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl p-3 border border-slate-200 space-y-3">
        <div className="text-xs font-medium text-slate-400">檢查項目</div>
        {checks.map((c) => (
          <div key={c.key}>
            <Label text={c.label} required />
            <div className="flex gap-2">
              {['合格', '不合格'].map((opt) => {
                const on = values[c.key] === opt
                return (
                  <button
                    key={opt}
                    onClick={() => setValues((v) => ({ ...v, [c.key]: opt }))}
                    className={`flex-1 py-2 rounded-lg text-sm border ${
                      on
                        ? opt === '合格' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-rose-500 text-white border-rose-500'
                        : 'border-slate-300 text-slate-500'
                    }`}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-3 border border-slate-200 space-y-3">
        <div>
          <Label text="現場照片" required />
          <button
            onClick={() => setPhoto(true)}
            className={`w-full border border-dashed rounded-lg py-4 text-sm ${photo ? 'border-emerald-400 text-emerald-600 bg-emerald-50' : 'border-slate-300 text-slate-400'}`}
          >
            {photo ? '✓ 已拍攝 1 張照片' : '📷 拍照 / 上傳'}
          </button>
        </div>
        <div>
          <Label text="簽名" required />
          <button
            onClick={() => setSigned(true)}
            className={`w-full border border-dashed rounded-lg py-4 text-sm ${signed ? 'border-emerald-400 text-emerald-600 bg-emerald-50' : 'border-slate-300 text-slate-400'}`}
          >
            {signed ? '✓ 陳怡君（已簽名）' : '✍️ 點此簽名'}
          </button>
        </div>
      </div>

      {!canSubmit && <p className="text-xs text-amber-600 text-center">⚠️ 必填欄位未完成時不能送出</p>}
      <button
        onClick={submit}
        disabled={!canSubmit}
        className="w-full bg-[#f26722] text-white rounded-xl py-3 font-medium disabled:opacity-40"
      >
        送出自主檢查表
      </button>
    </div>
  )
}

function AIHint() {
  const { itp } = useStore()
  const hold = itp.find((p) => p.work_item === '混凝土工程' && p.point_type === 'H')
  return (
    <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 text-xs text-violet-700">
      <div className="font-medium mb-1">🤖 AI 提醒（依契約 p.42）</div>
      <ul className="space-y-0.5 list-disc list-inside text-violet-600">
        <li>此工項需完成混凝土澆置前自主檢查</li>
        <li>需拍攝鋼筋保護層、模板現場照片</li>
        {hold ? (
          <li className="text-rose-600 font-medium">屬 H 停留點：監造未到場查驗前不得澆置，完成後須送監造查驗</li>
        ) : (
          <li>完成後需送監造查驗（屬停留點）</li>
        )}
      </ul>
    </div>
  )
}

function Label({ text, required }) {
  return <div className="text-xs text-slate-500 mb-1">{text}{required && <span className="text-rose-500"> *</span>}</div>
}

export function Done({ title, desc, next, onNext }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl mb-4">✓</div>
      <div className="text-lg font-bold text-slate-800">{title}</div>
      <p className="text-sm text-slate-500 mt-2">{desc}</p>
      {next && (
        <button onClick={onNext} className="mt-6 w-full bg-[#f26722] text-white rounded-xl py-3 font-medium">
          {next} →
        </button>
      )}
    </div>
  )
}
