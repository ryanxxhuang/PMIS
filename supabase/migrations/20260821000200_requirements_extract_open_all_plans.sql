-- 契約文件上傳是產品核心動線:上傳 → 確定性分類 → AI 契約重點抽取(requirements.extract)。
-- 抽取原設 min_plan='pro',trial/standard 專案上傳後在最後一步被閘門 403 擋下,
-- 核心動線直接死路(2026-08-21 實測:standard 專案上傳契約即中斷,重試也必敗)。
-- 使用者定案:上傳鏈的 AI 功能不做方案差異化,開放所有方案;
-- 方案差異化留給草稿/審查類功能。src/lib/aiFeatures.js 與 functions/_shared/aiFeatures.ts
-- 的種子預設值同步改為 trial(執行期真相仍是本表)。
update public.ai_features
set min_plan = 'trial', updated_at = now()
where key = 'requirements.extract';
