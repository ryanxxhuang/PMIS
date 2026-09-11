// 施工日誌的唯讀分支(監造/機關),重構波次 7 由 pages/web/SiteLog.jsx 原地搬出。
// W8-0 §6.2 + S-8:唯讀不用整排 disabled input 假裝可編——disabled 欄位會誤導成
// 「暫時鎖住的表單」,唯讀角色要的只是「看」。預設看公定格式紙本(SiteLogOfficialSheet,
// 與列印同版面),可切換摘要檢視。
// 唯讀頁 e2e 契約:頁上唯一的 input 是切歷史用的 type=date,本元件不得長出其他 input。
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MSym } from '../icons.jsx'
import { Button, Field, Empty, Input, THEAD_CLS } from '../ui.jsx'
import SiteLogOfficialSheet from '../SiteLogOfficialSheet.jsx'
import { readOnlyOfficialRows } from '../../lib/siteLogHelpers.js'
import { fmtAmount as fmt } from '../../lib/format.js'

export default function SiteLogReadOnly({ can, date, setDate, currentLog, project, siteLogs, adjustedItems, byKey }) {
  const navigate = useNavigate()
  // S-8 唯讀紙本化:預設公定格式紙本,摘要保留為切換
  const [roSummary, setRoSummary] = useState(false)
  // W8-4B B1 唯讀摘要:公定格式各節壓成「有資料才顯示」的 [節名, 內容] 行(純函式;
  // 不用 useMemo:每節列數只有個位數,重算成本遠低於多養一個 hook)
  const roOfficial = readOnlyOfficialRows(currentLog)
  return (
    <>
    <div className="mb-3 text-xs text-[var(--text-2)] bg-[var(--surface-2)] rounded-lg px-3 py-2">
      {can.oversee ? '機關監督檢視' : '監造檢視'}：施工日誌由施工廠商填報，此頁為<b>唯讀</b>，可切換日期檢視歷史紀錄。
    </div>
    {/* 日期本來就對唯讀開放(切歷史用),是唯讀頁上唯一的 input(type=date,e2e 契約) */}
    <div className="mb-3 flex items-end gap-3 flex-wrap">
      <Field label="日期"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      {/* S-8:預設紙本(公定格式)、可切回摘要——鈕上寫「切過去會看到的那個檢視」;
          自寫鈕殼退場,改共用 Button(outline=次級動作鈕,自帶手機 44px) */}
      {currentLog && (
        <Button variant="outline" onClick={() => setRoSummary((v) => !v)}>
          {roSummary ? '公定格式檢視' : '摘要檢視'}
        </Button>
      )}
    </div>
    {!currentLog ? (
      <Empty>此日期尚無日誌。施工日誌由施工廠商填報。</Empty>
    ) : !roSummary ? (
      // S-8 紙本化:監造/機關調閱的本來就是公定格式正式版面,預設直接內嵌 A4 文件本體。
      // sheet 為純顯示無 input(唯讀頁 e2e 契約);紙本表格在手機縮不進 375px,
      // 用 overflow-x-auto+min-w 讓紙本自己橫向捲,頁面不溢位(a11y 全路由無溢位掃描)。
      // 「紙」的白底由 SiteLogOfficialSheet 自己的 .paper 負責(波次 6:紙面用色集中在 index.css),
      // 外層只是框:深色模式下白紙壓卡片深底才有邊界可讀,並以小字講明白底是公定格式
      <div>
        <div className="overflow-x-auto rounded-xl border border-[var(--border-card)] p-3">
          <SiteLogOfficialSheet project={project} log={currentLog} siteLogs={siteLogs} itemList={adjustedItems} className="min-w-[640px]" />
        </div>
        <p className="mt-1.5 text-caption text-[var(--text-3)]">公定格式(固定白底)</p>
      </div>
    ) : (
      <div className="space-y-4">
        {/* 天氣與摘要:純文字,空值顯示 —／（未填）而不是空輸入框 */}
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div><div className="text-xs text-[var(--text-3)] mb-0.5">天氣(上午)</div><div>{currentLog.weather_am || currentLog.weather || '—'}</div></div>
          <div><div className="text-xs text-[var(--text-3)] mb-0.5">天氣(下午)</div><div>{currentLog.weather_pm || '—'}</div></div>
          <div className="min-w-0 flex-1 basis-full sm:basis-auto"><div className="text-xs text-[var(--text-3)] mb-0.5">工作摘要</div><div>{currentLog.work_summary || '（未填）'}</div></div>
        </div>
        {/* 工項回報:表頭同可編視角,數字改純文字。當日數量不走 fmt(會四捨五入),
            日誌常見 0.x 之類的小數,照原值顯示才對得上列印與估驗累計 */}
        {Object.keys(currentLog.items || {}).length === 0 ? (
          <Empty>本日未回報工項數量。</Empty>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[460px]">
            <thead>
              {/* th 字型層走 THEAD_CLS 單一真相(掛在 tr 由 th 繼承),對齊/內距各表自決 */}
              <tr className={`${THEAD_CLS} border-b border-[var(--border)]`}>
                <th className="text-left py-1.5">工項</th>
                <th className="text-right px-2 whitespace-nowrap">單位</th>
                <th className="text-right px-2 whitespace-nowrap">契約數量</th>
                <th className="text-right px-2 whitespace-nowrap">當日完成數量</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(currentLog.items || {}).map(([key, qty]) => {
                const it = byKey.get(key) || {}
                return (
                  <tr key={key} className="border-b border-[var(--border-2)] hover:bg-[var(--surface-2)]">
                    <td className="py-1.5"><span className="text-[var(--text-3)] text-xs mr-2 num">{it.item_no}</span>{it.description || key}</td>
                    <td className="text-right text-[var(--text-3)] text-xs px-2 whitespace-nowrap">{it.unit}</td>
                    <td className="text-right text-[var(--text-2)] px-2 num whitespace-nowrap">{fmt(it.quantity)}</td>
                    <td className="text-right px-2 num whitespace-nowrap">{qty}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
        {/* 公定格式:只列有資料的節;全部沒填收成一行,唯讀不需要一排空欄位 */}
        <div>
          <div className="text-xs font-medium text-[var(--text-2)] mb-1">公定格式欄位（出工人數・機具・材料・安衛…）</div>
          {roOfficial.length === 0 ? (
            <p className="text-xs text-[var(--text-3)]">本日未填公定格式欄位</p>
          ) : (
            <dl className="text-sm space-y-1">
              {roOfficial.map(([label, text]) => (
                <div key={label} className="flex gap-3">
                  <dt className="w-32 shrink-0 text-xs text-[var(--text-3)] pt-0.5">{label}</dt>
                  <dd className="min-w-0 flex-1">{text}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    )}
    {/* 列印公定格式:對唯讀角色保留(監造/機關本來就要調閱正式格式)。
        自寫鈕殼退場改 Button secondary(白底藍字,字色收斂到 --blue-text) */}
    {currentLog && (
      <div className="mt-4">
        <Button variant="secondary" onClick={() => navigate(`/site-log/print?d=${date}`)}>
          <MSym name="print" size={15} />列印公定格式日誌
        </Button>
      </div>
    )}
    </>
  )
}
