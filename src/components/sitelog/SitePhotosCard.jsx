// 施工日誌「現場照片」卡(重構波次 7 由 pages/web/SiteLog.jsx 原地搬出,JSX 零改動):
// 上傳入口(AI 辨識/補辨識/不辨識)、AI 批次辨識覆核區(staging)、照片格。
// 純顯示元件:staging/photos 的 state 與所有動作留在頁面——「全部上傳」會回填日誌表單
// (工項列骨架/摘要草稿),跟表單 state 綁在一起,搬進來只會多一層 props 轉手。
import { MSym } from '../icons.jsx'
import { Card, Button, Badge, Empty, IconButton, buttonClass, Input } from '../ui.jsx'
import { WorkItemPicker } from '../DefectTracker.jsx'

export default function SitePhotosCard({
  currentLog, can, aiEnabled, leaves, byId,
  photos, photosNeedingAI, photoBusy, existingBusy, existingMsg,
  staging, batchBusy,
  onBatchPhotos, onClassifyExisting, onAddPhotos, onDeletePhoto,
  patchStaging, removeStaging, cancelBatch, confirmBatchUpload,
}) {
  return (
    <Card title="現場照片">
      {/* 照片先行(W8-7 C-6):可編角色不再被「先存檔」擋住——沒日誌也直接給批次辨識入口,
          「全部上傳」時自動建草稿日誌。唯讀角色維持等待文案(W8-4B,也不得長出 input——唯讀 e2e 契約);
          AI 辨識未啟用時沒有「辨識→確認」那步可觸發自動建檔,維持先存檔的原提示 */}
      {!currentLog && !can.edit ? (
        <Empty>該日日誌建立後，廠商上傳的現場照片會顯示在這裡。</Empty>
      ) : !currentLog && !aiEnabled('photo.classify') ? (
        <Empty>先存檔本日日誌，才能附上現場照片。</Empty>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {/* 照片上傳=施工廠商的事:唯讀角色(監造/機關)不顯示死按鈕(U-01) */}
            {can.edit && <>
              {/* 批 B UX:照片分類功能關閉時藏 AI 批次入口,保留「直接加照片」 */}
              {aiEnabled('photo.classify') && (
                <label className={`${buttonClass('primary', 'md')} ${(photoBusy || batchBusy || existingBusy) ? 'opacity-40' : 'cursor-pointer'}`}>
                  {/* 批次=從相簿多選(不加 capture,否則手機會強開相機只能拍一張) */}
                  <input type="file" accept="image/*" multiple disabled={photoBusy || batchBusy || existingBusy} onChange={onBatchPhotos} className="hidden" />
                  <MSym name="auto_awesome" size={15} /> 選照片 AI 辨識後上傳
                </label>
              )}
              {/* P0 #11:已上傳但沒說明的照片,一鍵補 AI 說明+配工項——使用者的直覺是「先上傳,再辨識」 */}
              {aiEnabled('photo.classify') && photosNeedingAI.length > 0 && (
                <Button variant="secondary" onClick={onClassifyExisting} disabled={photoBusy || batchBusy || existingBusy}>
                  <MSym name="auto_awesome" size={14} />{existingBusy ? '辨識中…' : `AI 補辨識/配對 ${photosNeedingAI.length} 張`}
                </Button>
              )}
              {/* 「不辨識」=選檔即上傳、沒有確認步驟——不替使用者自動建檔,仍要先存檔才出現。
                  label 鈕殼一律 buttonClass()(同卡另兩顆已是),全形＋改 MSym add */}
              {currentLog && (
                <label className={`${buttonClass('outline', 'md')} ${(photoBusy || batchBusy || existingBusy) ? 'opacity-40' : 'cursor-pointer'}`}>
                  <input type="file" accept="image/*" capture="environment" multiple disabled={photoBusy || batchBusy || existingBusy} onChange={onAddPhotos} className="hidden" />
                  {photoBusy ? '上傳中…' : <><MSym name="add" size={15} /> 上傳照片(不辨識)</>}
                </label>
              )}
            </>}
            {!currentLog ? (
              // 照片先行的引導:講清楚「確認上傳」會自動建檔+回填表單,人只要覆核數量再存檔
              <span className="text-xs text-[var(--text-3)]">本日尚未存檔日誌:選照片辨識後按「全部上傳」,會自動建立草稿日誌,並把配到的工項與摘要草稿帶進表單</span>
            ) : (
              <span className="text-xs text-[var(--text-3)]">{photos.length} 張{can.edit ? (aiEnabled('photo.classify') ? '　·　AI 辨識＝自動生說明並配對工項' : '　·　AI 批次辨識未啟用') : '（照片由施工廠商上傳）'}</span>
            )}
            {existingMsg && <span className={`text-xs font-medium ${existingMsg.tone === 'error' ? 'text-[var(--red-text)]' : existingMsg.tone === 'success' ? 'text-[var(--green-text)]' : 'text-[var(--text-2)]'}`}>{existingMsg.text}</span>}
          </div>

          {/* 批次辨識覆核區:AI 逐張判讀後,人可改說明/工項再一鍵全上傳 */}
          {staging.length > 0 && (
            /* 覆核區底/框走 token(blue-tint/border-card),不用 /30、/[0.04] alpha 自製色階 */
            <div className="mb-4 border border-[var(--border-card)] bg-[var(--blue-tint)] rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-[var(--text)] inline-flex items-center gap-1.5">
                  <MSym name="auto_awesome" size={14} className="text-[var(--blue-text)]" />
                  AI 辨識覆核（{staging.filter((s) => s.status === 'done').length}/{staging.length}）
                  {batchBusy && <span className="text-xs font-normal text-[var(--text-3)]">判讀中…</span>}
                </div>
                <Button variant="ghost" size="sm" onClick={cancelBatch} disabled={batchBusy}>取消</Button>
              </div>
              <div className="space-y-2 max-h-[28rem] overflow-auto">
                {staging.map((s) => (
                  <div key={s.key} className="flex gap-3 items-start bg-[var(--surface)] border border-[var(--border)] rounded-lg p-2">
                    {/* alt 帶檔名:多張待上傳時報讀器才分得出是哪一張 */}
                    <img src={s.previewUrl} alt={`待上傳照片 ${s.file?.name || ''}`} className="w-16 h-16 rounded object-cover shrink-0 border border-[var(--border)]" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {s.status === 'analyzing' ? (
                        <div className="text-xs text-[var(--text-3)] py-3">AI 判讀中…</div>
                      ) : s.status === 'error' ? (
                        <div className="text-xs text-[var(--red-text)] py-1">辨識失敗：{s.errMsg}。仍可自行填說明後上傳。</div>
                      ) : null}
                      <Input value={s.caption} disabled={s.status === 'analyzing'} placeholder="照片說明（AI 生成，可改）"
                        onChange={(e) => patchStaging(s.key, { caption: e.target.value })} />
                      {s.status !== 'analyzing' && (
                        <>
                          {/* 狀態標記統一 Badge 五語意色票,自寫 pill(rounded 4px/alpha 邊框)退場 */}
                          <div className="flex items-center gap-1.5 flex-wrap text-xs">
                            {s.category && <Badge color="slate">{s.category}</Badge>}
                            {/* 施作區域=AI 自白板照抄的草稿:只給「清除」不給改寫——照抄原則,
                                人工要寫別的區域應該改在說明欄,不冒充板上文字 */}
                            {s.location && (
                              <Badge color="blue">
                                <MSym name="location_on" size={12} />{s.location}
                                <button onClick={() => patchStaging(s.key, { location: '' })} title="清除施作區域"
                                  aria-label={`清除施作區域 ${s.location}`} className="leading-none hover:text-[var(--red-text)]"><MSym name="close" size={12} /></button>
                              </Badge>
                            )}
                            {s.notSite && <Badge color="amber"><MSym name="warning" size={12} />疑似非工地照,請確認</Badge>}
                          </div>
                          {/* 可搜尋改選/清除工項(P1-02:不再只能取消配對)*/}
                          <WorkItemPicker leaves={leaves} value={s.work_item_key} label={s.work_item_label || '（搜尋工項…）'}
                            onPick={(k, l) => patchStaging(s.key, { work_item_key: k || '', work_item_label: k ? l : '' })} />
                        </>
                      )}
                    </div>
                    <IconButton name="close" label="移除此張待上傳照片" title="移除此張" onClick={() => removeStaging(s.key)} disabled={batchBusy}
                      className="-m-2 max-md:-m-3.5 hover:text-[var(--red-text)]" />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Button onClick={confirmBatchUpload} disabled={batchBusy || staging.every((s) => s.status === 'analyzing')}>
                  {batchBusy ? '處理中…' : `全部上傳（${staging.filter((s) => s.status !== 'analyzing').length}）`}
                </Button>
                <Button variant="secondary" onClick={cancelBatch} disabled={batchBusy}>取消</Button>
              </div>
            </div>
          )}

          {photos.length === 0 ? (
            // 唯讀角色沒有上傳入口:不指路「AI 批次辨識」這種按不到的操作
            <Empty>{can.edit ? '尚無照片。用「AI 批次辨識照片」一次丟多張，AI 自動生說明並配工項。' : '該日尚無現場照片。'}</Empty>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {photos.map((p, i) => (
                <div key={p.id} className="group relative rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--surface-2)]">
                  {/* 4:3 而非正方形(handoff 規格):相機原生比例,方形裁切會砍掉告示板兩側的字 */}
                  <div className="aspect-[4/3]">
                    {/* 無說明時用序號當 fallback:同一天多張照片,固定字串會讓報讀器全部同名 */}
                    {p.url && <img src={p.url} alt={p.caption || `現場照片 ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />}
                  </div>
                  {(p.caption || p.work_item_id || p.location) && (
                    <div className="px-1.5 py-1 bg-[var(--surface)] border-t border-[var(--border-2)]">
                      {p.caption && <div className="text-caption leading-tight text-[var(--text-2)] truncate" title={p.caption}>{p.caption}</div>}
                      {/* 施作區域(W8-7):同工項不同區域靠這行分辨;舊照片無 location(null)不渲染,顯示不受影響 */}
                      {p.location && <div className="text-micro leading-tight text-[var(--text-3)] truncate" title={`施作區域 ${p.location}`}><MSym name="location_on" size={10} className="inline -mt-0.5" /> {p.location}</div>}
                      {/* 賣點的可見性:配到的工項一定要看得到,否則配對成功=白做(dry-run #17 教訓) */}
                      {p.work_item_id && byId.get(p.work_item_id) && (
                        <div className="text-micro leading-tight text-[var(--blue-text)] truncate" title={`${byId.get(p.work_item_id).item_no} ${byId.get(p.work_item_id).description}`}>
                          <MSym name="link" size={10} className="inline -mt-0.5" /> {byId.get(p.work_item_id).item_no} {byId.get(p.work_item_id).description}
                        </div>
                      )}
                    </div>
                  )}
                  {/* 手機沒有 hover:opacity-0 等於這顆鈕在手機根本看不見也按不到,所以 max-md 直接常駐並放大到 36px
                      (斷點必須與 BottomNav 的 md:hidden 對齊——寫 max-sm 會讓 744px iPad mini 直式這種無 hover 的觸控裝置整顆鈕消失)
                      (縮圖只有半個 grid 欄寬,44px 會蓋掉照片主體,列為 W8-5 已知例外);鍵盤 focus 也要現形 */}
                  {can.edit && <button onClick={() => onDeletePhoto(p)} title="刪除照片" aria-label={`刪除照片 ${p.caption || `現場照片 ${i + 1}`}`}
                    className="absolute top-1 right-1 w-6 h-6 max-md:w-9 max-md:h-9 grid place-items-center rounded-full bg-black/55 text-white opacity-0 max-md:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"><MSym name="close" size={14} /></button>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
