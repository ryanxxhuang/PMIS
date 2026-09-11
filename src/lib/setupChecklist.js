// 專案初始化五步清單的推導規則(原本住在 pages/web/Dashboard.jsx,重構波次 8
// 搬來——測試要釘住「每一步何時算完成」,不該為此把整頁的 store/supabase/
// 圖表 import 圖拉進來)。純函式:所有輸入由呼叫端注入,這裡不查 DB、不讀時鐘。
//
// 初始化五步清單(W2-2 建立、W8-3A 依 D-014 修訂、D-020 後補「設定開工日」):
// 真專案在正式模式開啟前顯示。
// 狀態全部由既有資料推導,不建 onboarding 資料表、不做逐步精靈;每步直達既有工作頁。
//
// W8-3A 的兩個關鍵修正:
//   ① 第 3 步只問「AI 整理完了沒」——`document_ingestion_runs` 有沒有一筆 completed。
//      不再讀 Requirement 的待審／核定數:那 106 筆是 AI 的產出,不是人要清空的初始化
//      門檻,更不該擋住開啟正式模式(D-014)。擷取結果 0 筆也算整理完成,那代表
//      「AI 讀完了但沒找到建議」,不是失敗。
//   ② 第 4 步永遠不因前三步或三方未到齊而卡住;原本「三方到齊後才能開啟」的文案
//      與 W4-4 已定案行為不符(不齊也可開,只是要二次確認)。
const ORG_LABEL = { contractor: '廠商', supervisor: '監造', owner: '機關' }
// 查詢失敗要說失敗,不能靜默當成 0 筆 —— 那會把「查不到」演成「還沒開始」,
// 使用者會去重做一次已經做完的事。
const LOAD_FAIL = '狀態載入失敗，前往專案文件查看'

// 由既有資料推導五步(純函式,便於釘住完成條件)。snap = null 代表仍在載入。
// 每步固定有:責任方、完成與否、唯一目的地;不提供逐筆打勾、略過或批次核定。
// commencement/waitingOnCommencement 來自 store 的 project 與義務列(不進 snap:
// 它們不需要額外查詢);第 4 步與其他步一樣永遠不擋開啟正式模式(D-014)。
export function buildSetupSteps(snap, { imported, commencement, waitingOnCommencement } = {}) {
  const missingOrgs = ['contractor', 'supervisor', 'owner'].filter((o) => !snap?.orgs?.has(o))
  const ingestionDone = !!snap && !snap.ingestionError && snap.ingestionCompleted > 0
  return [
    {
      to: '/contract', label: '上傳專案文件與標單', owner: '施工廠商／專案建立者',
      done: !!snap && !snap.docsError && snap.docs > 0 && !!imported,
      detail: !snap ? '載入中…'
        : snap.docsError ? LOAD_FAIL
          : `文件 ${snap.docs} 件・標單${imported ? '已匯入' : '未匯入'}`,
    },
    {
      to: '/members', label: '確認三方成員', owner: '專案建立者',
      done: !!snap && !snap.membersError && missingOrgs.length === 0,
      detail: !snap ? '載入中…'
        : snap.membersError ? `${snap.membersError},到成員頁重試`
          : missingOrgs.length ? `尚缺:${missingOrgs.map((o) => ORG_LABEL[o]).join('、')}` : '廠商、監造、機關都已加入',
    },
    {
      // 完成後才導去看結果;沒整理完就回專案文件看處理狀態或重試(那裡才有上傳與重跑)
      to: ingestionDone ? '/requirements' : '/contract',
      label: 'AI 整理契約重點', owner: '系統自動', done: ingestionDone,
      detail: !snap ? '載入中…'
        : snap.ingestionError ? LOAD_FAIL
          : ingestionDone
            ? 'AI 已完成整理並自動歸檔，不影響開啟正式模式；內容如有出入，以契約原文為準'
            : '尚未有完成的整理；到專案文件查看處理狀態或重試',
    },
    {
      // D-020 後全型別義務都進履約時程,開工類義務推不出到期日的主因就是
      // 開工日沒設——把設定明確排進初始化,目的地是後果看得到的履約時程頁。
      to: '/requirements', label: '設定開工日', owner: '專案建立者',
      done: !!commencement,
      detail: commencement ? `開工日 ${commencement}・開工類期限已可推算到期日`
        : waitingOnCommencement ? `${waitingOnCommencement} 條契約義務等待開工日才能排入時程;到「契約重點」的履約期程設定`
          : '接獲開工通知後,到「契約重點」的履約期程設定實際開工日(非預定日)',
    },
    {
      to: '/members', label: '開啟正式模式', owner: '專案建立者',
      done: false, // 開啟後整張清單就不再顯示,所以在清單存在期間固定未完成
      detail: '由專案建立者在「專案成員」頁開啟；前面步驟未完成或三方未到齊也可以開啟，系統會再次確認',
    },
  ]
}

