import { useStore } from '../../store.jsx'
import { Card, Badge, Empty } from '../../components/ui.jsx'

export default function Audit() {
  const { audit } = useStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Audit Trail</h1>
        <p className="text-slate-500 text-sm mt-1">所有工程紀錄皆可追溯。已送出紀錄不可覆蓋，修正須建立新版本。</p>
      </div>

      <Card title={`事件紀錄（${audit.length}）`}>
        {audit.length === 0 ? (
          <Empty>尚無事件。操作 demo 流程後會在此記錄。</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-100">
                <th className="py-2 font-medium">時間</th>
                <th className="font-medium">操作</th>
                <th className="font-medium">相關紀錄</th>
                <th className="font-medium">使用者</th>
                <th className="font-medium">角色</th>
                <th className="font-medium">裝置</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((e) => (
                <tr key={e.event_id} className="border-b border-slate-50">
                  <td className="py-2.5 text-slate-400 text-xs whitespace-nowrap">{e.timestamp}</td>
                  <td className="text-slate-700 font-medium">{e.action}</td>
                  <td className="text-slate-500">{e.related_record}</td>
                  <td className="text-slate-600">{e.user}</td>
                  <td><Badge color={e.role === 'AI' ? 'purple' : 'slate'}>{e.role}</Badge></td>
                  <td><Badge color={e.device_type === 'Mobile' ? 'blue' : 'slate'}>{e.device_type}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
