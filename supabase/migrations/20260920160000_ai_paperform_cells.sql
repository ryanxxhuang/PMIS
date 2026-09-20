-- B2(2026-09-20 廠商驗收):AI 功能註冊 paperform.cells —— 紙本查驗表逐格辨識。
-- ---------------------------------------------------------------------------
-- 為什麼要獨立一列而不是塞進 sitelog.whiteboard:這是一條**會多花錢**的路徑(同一張紙表
-- 切成兩塊、每塊各讀兩次 → 每張紙表照片多 4 次模型呼叫),所以必須能單獨關掉、單獨計量、
-- 依方案與專案控管。關掉之後 draft-field-documents 會退回整張圖讀兩次的舊行為
--(B 包做法),其他照片完全不受影響,不會整批失敗。
--
-- 觸發條件(程式側):只有 photo.classify 判定 record_medium='paper_form' 的照片才會走;
-- 一般施工照、黑白板、量具特寫都不會觸發,不會為了沒有紙表的照片付錢。
-- 用量上限(程式側):每張照片最多 MAX_TILES=4 塊 × 2 次 = 8 次呼叫,單次輸出上限
-- CELL_MAX_TOKENS=900,單塊畫素上限 TILE_MAX_PIXELS;超過就停並標待補,不無上限展開。
--
-- 與雙註冊表(src/lib/aiFeatures.js、functions/_shared/aiFeatures.ts)同步新增;
-- category 為 vision、minPlan trial(與 photo.classify／sitelog.whiteboard 同屬上傳鏈,
-- 逐格辨識不該比它們更高),預設開啟。sort_order 115 排在告示板辨識(110)之後、
-- 缺失照片描述(120)之前,同屬 vision 類。
-- 重放安全:on conflict do nothing,不覆蓋後台調過的 enabled／min_plan。
-- 資料保留:純新增一列,不動任何既有列、不改任何既有資料。
-- 回復:supabase/rollbacks/20260920160000_ai_paperform_cells.down.sql(關閉開關而非刪列)。
insert into public.ai_features
  (key, label, category, edge_function, min_plan, is_llm, enabled, sort_order)
values
  ('paperform.cells', '紙本查驗表逐格辨識', 'vision', 'draft-field-documents', 'trial', true, true, 115)
on conflict (key) do nothing;
