import { Link } from 'react-router-dom'
import { MSym } from '../components/icons.jsx'
import { LegalPage, LegalSection, LEGAL_CONTACT } from './legalShell.jsx'

// 公開隱私權政策(不需登入)。
//
// 依據與對照(逐條在 docs/資安/):
//   - 個人資料保護法 §8 告知義務:蒐集目的、類別、利用期間／地區／對象／方式、當事人權利。
//   - 工程會一覽表(SaaS 套裝型・普級)資料安全欄與 B.11.1.1 境外傳輸:次要處理者、
//     所在地與保護措施要能公開查到 → §5 直接寫出 Supabase(日本)與 Anthropic(美國)。
//   - 附表十「事件日誌與可歸責性」:日誌至少六個月 → §6 與 docs/資安/日誌留存政策.md 同步。
//
// 事實來源(改任何一項要同步改這裡):
//   - 資料庫／檔案儲存:Supabase,專案區域日本(docs/資安/中央大學-個資委外與境外傳輸-對策.md,2026-08-11 確認)。
//   - AI 模型:Anthropic Claude API(美國);送出內容由伺服器端組裝,不含帳號密碼;
//     每個 AI 功能可獨立關閉(D-010 閘門、ai_features)。
//   - 錯誤回報:Sentry,Session Replay 遮罩全部文字與輸入(src/lib/sentry.js)。
//   - 行銷站 Demo 申請表(demo_requests)保存期尚未定案(ROADMAP 待使用者決策)→ §7 寫「至多一年」
//     是草擬值,定案前不得對外承諾更短。
//
// ⚠ 法律文字狀態:2026-09-11 依現行架構草擬,尚未經律師審閱。
const UPDATED = '2026-09-11'
const VERSION = '0.9(草稿,待法律審閱)'

export default function Privacy() {
  return (
    <LegalPage kicker="隱私權政策" kickerIcon="privacy_tip" title="GovAgent 公共工程隱私權政策" updated={UPDATED} version={VERSION}
      intro={<>本政策說明本服務如何蒐集、處理、利用與保護個人資料，以及你依《個人資料保護法》享有的權利。
        與機關另有簽訂個資委外附約者，以該附約為優先。</>}>

      <LegalSection icon="badge" title="1. 我們蒐集哪些個人資料">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong className="text-[var(--text)]">帳號資料</strong>：電子郵件、姓名、所屬單位與三方身分（施工廠商／監造／機關）、專案角色。</li>
          <li><strong className="text-[var(--text)]">業務紀錄中的個人資料</strong>：施工日誌、查驗、送審、變更設計等紀錄中出現的承辦人姓名、職稱與公務聯絡方式；現場照片中可能拍到的人員影像。</li>
          <li><strong className="text-[var(--text)]">使用紀錄</strong>：登入時間與來源 IP 位址、操作稽核事件、AI 功能用量。</li>
          <li><strong className="text-[var(--text)]">Demo 申請</strong>（行銷站表單）：姓名、電子郵件、電話、來源 IP 與瀏覽器資訊。</li>
        </ul>
        <p>本服務採個資最小化：不蒐集身分證字號、生日、金融帳號等與公共工程專案管理無關的資料。</p>
      </LegalSection>

      <LegalSection icon="flag" title="2. 蒐集目的">
        <p>提供公共工程專案管理與履約協作服務（帳號管理、專案存取控制、業務紀錄留痕、期限提醒）、資訊安全與稽核（附表十事件日誌與可歸責性）、AI 協助查詢／彙整／擬稿，以及回覆你的 Demo 或客服請求。</p>
      </LegalSection>

      <LegalSection icon="lock" title="3. 誰看得到你的資料">
        <ul className="list-disc space-y-1 pl-5">
          <li>專案資料只有該專案的成員可讀，且依三方身分分級（例如契約文件依契約方可見範圍）。此限制由伺服器端資料列層級安全性（RLS）強制，不依賴前端。</li>
          <li>平台管理員僅為營運目的查看 AI 用量與功能開關，不以業務身分讀取專案內容。</li>
          <li>本服務不將個人資料出售或提供給第三方作行銷之用，也不用於訓練 AI 模型。</li>
        </ul>
      </LegalSection>

      <LegalSection icon="smart_toy" title="4. AI 功能如何處理你的資料">
        <ul className="list-disc space-y-1 pl-5">
          <li>AI 功能只在你觸發時，把完成該任務所需的專案內容（例如契約段落、日誌摘要、照片）送至模型服務商處理；送出的內容由伺服器端組裝，不包含帳號密碼或登入憑證。</li>
          <li>每個 AI 功能都可獨立關閉；關閉後不會再有任何資料送至模型服務商，其餘功能照常運作。</li>
          <li>所有 AI 草稿與其人工覆核結果留存紀錄；AI 用量事件記錄功能、使用者、專案與 token 數，供機關稽核。</li>
        </ul>
      </LegalSection>

      <LegalSection icon="public" title="5. 次要處理者與境外傳輸">
        <p>本服務使用下列次要處理者；資料傳輸全程加密（TLS 1.2 以上），靜態資料加密儲存：</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong className="text-[var(--text)]">Supabase</strong>（資料庫、身分驗證、檔案儲存、伺服器函式）：專案區域位於<strong className="text-[var(--text)]">日本</strong>。日本為歐盟認定具適足保護水準之國家，並有《個人情報保護法》規範。</li>
          <li><strong className="text-[var(--text)]">Anthropic</strong>（AI 模型 API）：位於<strong className="text-[var(--text)]">美國</strong>。僅於使用 AI 功能時傳輸該任務所需內容；依其 API 條款，輸入不用於訓練模型。</li>
          <li><strong className="text-[var(--text)]">Cloudflare</strong>（網站遞送與安全防護）與 <strong className="text-[var(--text)]">Sentry</strong>（錯誤回報；畫面重播已遮罩所有文字與輸入）。</li>
        </ul>
        <p>以上均屬本國以外地區。機關客戶依《個人資料保護法》與資安一覽表規定，得於採購時審查上述境外傳輸並要求書面協議；本服務不會傳輸資料至大陸地區（含港澳）。次要處理者變更時，本服務事前通知機關客戶。</p>
      </LegalSection>

      <LegalSection icon="history" title="6. 保存期間">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong className="text-[var(--text)]">專案資料</strong>：契約存續期間及約定保存期限；終止後依第 8 條返還並刪除。</li>
          <li><strong className="text-[var(--text)]">稽核事件、登入紀錄（含 IP）、AI 代理行為與用量事件</strong>：保存至少六個月，且系統不設自動清除；機關另有更長保存年限者依契約辦理。詳見<a href="https://github.com/ryanxxhuang/PMIS/blob/main/docs/%E8%B3%87%E5%AE%89/%E6%97%A5%E8%AA%8C%E7%95%99%E5%AD%98%E6%94%BF%E7%AD%96.md" className="font-medium text-[var(--blue-text)] hover:underline" target="_blank" rel="noreferrer">日誌留存政策</a>。</li>
          <li><strong className="text-[var(--text)]">Demo 申請資料</strong>：自申請日起至多一年，或於你要求時提前刪除。</li>
        </ul>
      </LegalSection>

      <LegalSection icon="person" title="7. 你的權利">
        <p>依《個人資料保護法》第 3 條，你得就你的個人資料請求查詢或閱覽、製給複製本、補充或更正、停止蒐集處理利用，以及刪除。請以帳號電子郵件寄信至{' '}
          <a href={`mailto:${LEGAL_CONTACT}?subject=${encodeURIComponent('[個資權利行使] ')}`} className="font-medium text-[var(--blue-text)] hover:underline">{LEGAL_CONTACT}</a>
          ，我們於 15 個工作日內回覆。專案業務紀錄中的個人資料，其蒐集主體為該專案的機關或單位，我們將協助轉交並依其指示辦理。</p>
      </LegalSection>

      <LegalSection icon="logout" title="8. 資料返還與刪除">
        <p>契約終止或機關要求時，本服務提供結構化資料與原始文件的匯出；經確認後刪除專案資料與儲存檔案，並出具刪除／銷毀切結。專案刪除為不可逆操作，須由專案管理者確認，刪除行為本身留有紀錄。</p>
      </LegalSection>

      <LegalSection icon="cookie" title="9. Cookie 與本機儲存">
        <p>本服務只使用維持登入狀態與介面偏好（主題、側欄收合）所需的本機儲存，不使用廣告或追蹤 Cookie。</p>
      </LegalSection>

      <LegalSection icon="report" title="10. 資安事件通知">
        <p>發生涉及個人資料的資安事件時，本服務依<Link to="/security" className="font-medium text-[var(--blue-text)] hover:underline">漏洞回報與應變機制</Link>：知悉後 24 小時內通知受影響機關窗口、72 小時內提出初步調查說明，並依契約與法令協助後續處理。</p>
      </LegalSection>

      <LegalSection icon="edit_note" title="11. 版本與聯絡">
        <p>版本 {VERSION}，更新日期 {UPDATED}。政策修訂時本頁標示新版本與生效日；重大變更另行通知。聯絡窗口：<a href={`mailto:${LEGAL_CONTACT}`} className="font-medium text-[var(--blue-text)] hover:underline">{LEGAL_CONTACT}</a></p>
      </LegalSection>

      <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3 text-xs leading-relaxed text-[var(--text-3)]">
        <MSym name="info" size={14} className="mt-0.5 shrink-0" />
        本頁依現行系統架構撰寫並公開；與機關簽署之個資委外附約為優先適用文件。
      </p>
    </LegalPage>
  )
}
