import { Link } from 'react-router-dom'
import { MSym } from '../components/icons.jsx'

// 公開漏洞回報頁(不需登入)。
//
// 依據:工程會 112/9/25 工程企字第 1120022701 號函「各類資訊(服務)採購之共通性
// 資通安全基本要求參考一覽表」→「雲端微服務(SaaS)套裝型」→「供應商及產品安全要求」
// 普級 ●:「1.供應商安全:符合以下任一條件。(1)廠商有公開漏洞回報應變機制 ...」
// 這一頁就是那個「公開漏洞回報應變機制」的本體——所以它必須:
//   ① 不需登入即可讀(機關會自己去點,點不進去等於沒有)
//   ② 有真實可收信的窗口
//   ③ 寫出「應變流程」而不只是一個信箱(機制 ≠ 聯絡方式)
//
// 2026-08-11 網域上線:改用網域信箱(Cloudflare Email Routing 轉寄至負責人信箱)。
// 若要換信箱,同時要改 public/.well-known/security.txt。
const CONTACT = import.meta.env.VITE_SECURITY_CONTACT || 'security@gov-agent.ai'
const UPDATED = '2026-08-11'

function Section({ icon, title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-medium text-[var(--text)]">
        <MSym name={icon} size={18} className="text-[var(--blue-text)]" />
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-[var(--text-2)]">{children}</div>
    </section>
  )
}

export default function Security() {
  return (
    <div className="min-h-screen bg-[var(--bg)] px-6 py-12">
      <main className="mx-auto w-full max-w-3xl space-y-10">

        <header className="space-y-3">
          <Link to="/login" className="inline-flex items-baseline gap-2" aria-label="PMIS 公共工程登入頁">
            <span className="text-xl font-bold tracking-tight text-[var(--text)]">PM<span className="text-[var(--accent-text)]">IS</span></span>
            <span className="text-xs text-[var(--text-3)]">公共工程</span>
          </Link>
          <div className="flex items-center gap-2 text-sm text-[var(--text-3)]">
            <MSym name="verified_user" size={16} />
            資通安全
          </div>
          <h1 className="text-2xl font-medium tracking-tight text-[var(--text)]">漏洞回報與應變機制</h1>
          <p className="text-sm leading-relaxed text-[var(--text-2)]">
            我們把資安當成產品的一部分。若你發現本服務的安全性問題，請依本頁的方式通知我們；
            我們會依下列時限確認、修補並回覆你。本頁同時作為
            <strong className="text-[var(--text)]">公開漏洞回報應變機制</strong>之說明，
            供機關於資訊服務採購的資安查核使用。
          </p>
        </header>

        <Section icon="mail" title="回報管道">
          <p>
            請將問題寄至{' '}
            <a href={`mailto:${CONTACT}?subject=${encodeURIComponent('[資安通報] ')}`}
              className="font-medium text-[var(--blue-text)] hover:underline">{CONTACT}</a>
            ，主旨請加上 <code className="rounded bg-[var(--surface-2)] px-1">[資安通報]</code>。
          </p>
          <p>為加速判讀，來信請盡量包含：</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>問題描述與影響範圍（可能被誰、看到或改到什麼）</li>
            <li>重現步驟；如有畫面或請求紀錄請一併附上</li>
            <li>你使用的網址、瀏覽器與發生時間</li>
            <li>你希望我們如何稱呼你（若日後公告致謝）</li>
          </ul>
          <p className="text-[var(--text-3)]">
            機器可讀版本：<code className="rounded bg-[var(--surface-2)] px-1">/.well-known/security.txt</code>（RFC 9116）
          </p>
        </Section>

        <Section icon="schedule" title="我們的回應時限">
          <ul className="list-disc space-y-1 pl-5">
            <li><strong className="text-[var(--text)]">3 個工作日內</strong>確認收到你的回報。</li>
            <li><strong className="text-[var(--text)]">10 個工作日內</strong>完成初步評估，告知你我們的分級與預計處理方式。</li>
            <li>修補目標：<strong className="text-[var(--text)]">高風險 30 日內</strong>、
              中低風險 90 日內；期間如有變動我們會主動告知進度。</li>
            <li>修補完成後通知你，並在你同意的情況下於更新說明中致謝。</li>
          </ul>
        </Section>

        <Section icon="checklist" title="內部應變流程">
          <p>收到回報後，我們依下列流程處理——這是機制，不只是一個信箱：</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li><strong className="text-[var(--text)]">受理與登錄</strong>：建立案號，記錄回報時間、來源與內容。</li>
            <li><strong className="text-[var(--text)]">重現與分級</strong>：依可利用性與資料影響範圍分為高／中／低風險。</li>
            <li><strong className="text-[var(--text)]">緩解</strong>：高風險先採取暫時性措施（如關閉受影響功能模組）再進行修補。</li>
            <li><strong className="text-[var(--text)]">修補與驗證</strong>：修補後補上自動化測試，避免同一問題再次發生。</li>
            <li><strong className="text-[var(--text)]">通知客戶機關</strong>：若研判有實際影響，於<strong className="text-[var(--text)]">知悉後 24 小時內</strong>通知受影響機關之聯絡窗口，
              並於<strong className="text-[var(--text)]">72 小時內</strong>提出初步調查說明（影響範圍、已採取措施、後續計畫）。</li>
            <li><strong className="text-[var(--text)]">結案與回覆</strong>：回覆回報者處理結果，並留存處理紀錄備查。</li>
          </ol>
          <p className="text-[var(--text-3)]">
            涉及個人資料之事故，另依契約與個人資料保護法相關規定辦理通知與協助。
          </p>
        </Section>

        <Section icon="block" title="測試範圍與請你避免的行為">
          <p><strong className="text-[var(--text)]">屬於範圍：</strong>本服務的網站、API 與後端服務。</p>
          <p>
            <strong className="text-[var(--text)]">不屬於範圍：</strong>我們所使用第三方服務本身的漏洞
            （如雲端資料庫、模型服務供應商）——那些請直接向該服務商回報，我們也很樂意協助轉達。
          </p>
          <p>為了不影響正在使用系統的工地與機關人員，請<strong className="text-[var(--text)]">不要</strong>：</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>進行阻斷服務（DoS）、壓力測試或大量自動化掃描</li>
            <li>存取、修改或刪除不屬於你的資料；驗證權限問題時請只使用你自己的測試帳號</li>
            <li>對本服務的使用者或員工進行社交工程、釣魚，或實體入侵</li>
            <li>在我們完成修補前公開揭露問題細節</li>
          </ul>
        </Section>

        <Section icon="balance" title="安全港聲明">
          <p>
            若你遵循本頁原則進行研究、並在第一時間通知我們、且未擴大存取或利用所發現的問題，
            我們<strong className="text-[var(--text)]">不會對你採取法律行動</strong>，
            也會將你的行為視為善意的安全研究。
          </p>
          <p className="text-[var(--text-3)]">
            我們目前<strong className="text-[var(--text)]">不提供漏洞獎金</strong>，但會誠實致謝並盡快修補。
          </p>
        </Section>

        <footer className="border-t border-[var(--border)] pt-6 text-xs text-[var(--text-3)]">
          <div>本頁最後更新：{UPDATED}</div>
          <Link to="/login" className="mt-2 inline-block font-medium text-[var(--blue-text)] hover:underline">← 回到登入頁</Link>
        </footer>

      </main>
    </div>
  )
}
