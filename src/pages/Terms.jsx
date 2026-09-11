import { Link } from 'react-router-dom'
import { MSym } from '../components/icons.jsx'
import { LegalPage, LegalSection, LEGAL_CONTACT } from './legalShell.jsx'

// 公開服務條款(不需登入)。
//
// 為什麼要有這一頁:機關採購資安一覽表(SaaS 套裝型・普級)與個資委外附約都要求
// 「服務範圍、責任分工、資料返還與刪除、次要處理者」有書面可查;行銷站與 App 都要能
// 連到同一份。本頁是**產品內的公開版本**,正式契約條款以雙方簽署的採購契約與
// 個資委外附約為準(§9)。
//
// 內容原則(對齊 DEVELOPMENT §4 與 D-003):AI 只產草稿、數字走確定性引擎、人做核定——
// 這不只是產品邊界,也是責任分工的條款依據,所以 §3 直接把它寫成條文。
//
// ⚠ 法律文字狀態:2026-09-11 依現行架構草擬,尚未經律師審閱。改條文時同步改
// UPDATED 與 §10 的版本紀錄;不要在這裡放任何未實作的承諾(例如尚未做的 MFA)。
const UPDATED = '2026-09-11'
const VERSION = '0.9(草稿,待法律審閱)'

export default function Terms() {
  return (
    <LegalPage kicker="服務條款" kickerIcon="gavel" title="GovAgent 公共工程服務條款" updated={UPDATED} version={VERSION}
      intro={<>本條款說明你（機關、監造單位、施工廠商或其授權人員，以下稱「使用者」）使用本服務時，雙方的權利義務。
        建立帳號或使用本服務即表示你已閱讀並同意本條款與<Link to="/privacy" className="font-medium text-[var(--blue-text)] hover:underline">隱私權政策</Link>。</>}>

      <LegalSection icon="info" title="1. 服務內容">
        <p>本服務是公共工程專案的雲端協作平台，提供專案文件管理、契約重點與履約時程、施工日誌、品質查驗、估驗計價、變更設計、驗收等功能，並以 AI 代理協助查詢、彙整與擬稿。</p>
        <p>本服務以「軟體即服務（SaaS）套裝型」方式提供，功能以本服務公告的版本為準；不包含客製開發。</p>
      </LegalSection>

      <LegalSection icon="group" title="2. 帳號與三方角色">
        <ul className="list-disc space-y-1 pl-5">
          <li>每位使用者以個人帳號登入，不得共用帳號；帳號持有人對其帳號下的所有操作負責。</li>
          <li>專案內的業務身分只有三種：施工廠商、監造單位、機關。身分由邀請方指定並由系統核對，錯配將拒絕加入。</li>
          <li>專案管理權限由專案成員名單決定；專案建立者離任時，管理權可由其他管理者接續，不因個人帳號停用而消失。</li>
        </ul>
      </LegalSection>

      <LegalSection icon="smart_toy" title="3. AI 功能的界線與責任分工">
        <p>本服務的 AI 功能只做三件事：<strong className="text-[var(--text)]">查詢、彙整、擬稿</strong>。以下事項一律由人執行，AI 產出不構成本服務的判定或承諾：</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>業務核定、審查判定、結案與驗收。</li>
          <li>金額、期限與合格判定：由確定性程式依你輸入的標單、契約基準日與紀錄計算，不由 AI 推估。</li>
          <li>契約重點的 AI 整理會自動歸檔並標示「以契約原文為準」；系統會揭露逐字核對疑慮。<strong className="text-[var(--text)]">契約原文永遠優先於系統整理</strong>，使用者於作成任何法律或行政決定前應自行核對原文。</li>
        </ul>
        <p>所有 AI 草稿、動作與其人工覆核結果均留存紀錄。使用者可要求關閉個別 AI 功能，關閉後其餘確定性功能照常運作。</p>
      </LegalSection>

      <LegalSection icon="database" title="4. 資料所有權與使用">
        <ul className="list-disc space-y-1 pl-5">
          <li>使用者上傳或輸入的專案資料（文件、標單、紀錄、照片）之權利仍屬使用者或其所屬機關／單位；本服務僅為提供服務之目的處理。</li>
          <li>本服務不將使用者資料用於訓練模型，也不提供給第三方作為行銷用途。</li>
          <li>個人資料的蒐集、處理、利用、保存與境外傳輸依<Link to="/privacy" className="font-medium text-[var(--blue-text)] hover:underline">隱私權政策</Link>及與機關簽訂之個資委外附約辦理。</li>
        </ul>
      </LegalSection>

      <LegalSection icon="block" title="5. 使用限制">
        <p>使用者不得：</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>存取、修改或刪除非其權限範圍內的專案資料，或規避系統的權限控制。</li>
          <li>對本服務進行阻斷服務、大量自動化掃描或未經授權的安全測試（善意安全研究請依<Link to="/security" className="font-medium text-[var(--blue-text)] hover:underline">漏洞回報機制</Link>辦理）。</li>
          <li>上傳違法、侵權或含惡意程式的內容。</li>
        </ul>
      </LegalSection>

      <LegalSection icon="verified_user" title="6. 服務水準、維護與安全">
        <ul className="list-disc space-y-1 pl-5">
          <li>本服務提供伺服器端存取控制（資料列層級安全性）、傳輸加密（TLS）與靜態加密；稽核事件、登入紀錄（含 IP）與 AI 用量事件保存至少六個月且不可竄改。</li>
          <li>計畫性維護將提前公告；緊急安全修補得不另行通知。</li>
          <li>資安事件之通知與應變依<Link to="/security" className="font-medium text-[var(--blue-text)] hover:underline">漏洞回報與應變機制</Link>：研判有實際影響時，於知悉後 24 小時內通知受影響機關窗口，72 小時內提出初步調查說明。</li>
        </ul>
      </LegalSection>

      <LegalSection icon="payments" title="7. 費用與訂閱">
        <p>費用、期間與付款方式依雙方訂閱協議或採購契約載明。訂閱到期未續約時，帳號轉為唯讀，資料依第 8 條辦理。</p>
      </LegalSection>

      <LegalSection icon="logout" title="8. 終止、資料返還與刪除">
        <ul className="list-disc space-y-1 pl-5">
          <li>契約終止或使用者要求時，本服務於約定期限內提供資料匯出（結構化資料與原始文件）。</li>
          <li>匯出完成並經確認後，本服務刪除該專案資料與其儲存檔案，並出具刪除／銷毀切結；稽核紀錄依契約保存責任辦理。</li>
          <li>專案刪除為不可逆操作，須由專案管理者明確確認。</li>
        </ul>
      </LegalSection>

      <LegalSection icon="balance" title="9. 準據法與條款效力">
        <p>本條款以中華民國法律為準據法。與機關另有簽署之採購契約、個資委外附約或服務水準協議者，以該等文件為優先；本條款作為補充。</p>
      </LegalSection>

      <LegalSection icon="history" title="10. 版本與聯絡">
        <p>版本 {VERSION}，更新日期 {UPDATED}。條款修訂時本頁會標示新版本與生效日；重大變更將另行通知使用者。</p>
        <p>聯絡窗口：<a href={`mailto:${LEGAL_CONTACT}`} className="font-medium text-[var(--blue-text)] hover:underline">{LEGAL_CONTACT}</a></p>
      </LegalSection>

      <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3 text-xs leading-relaxed text-[var(--text-3)]">
        <MSym name="info" size={14} className="mt-0.5 shrink-0" />
        本頁為產品內公開版本，依現行系統架構撰寫；正式契約以雙方簽署文件為準。
      </p>
    </LegalPage>
  )
}
