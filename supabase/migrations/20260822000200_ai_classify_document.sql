-- W14:AI 文件分類(documents.classify → classify-document Edge Function)。
-- 確定性分類器沒把握(needs_review)時的第二意見:信心高自動歸檔、低照舊待確認。
-- 上傳鏈核心功能,依 2026-08-21 裁示開放所有方案(min_plan='trial');
-- 與雙註冊表(src/lib/aiFeatures.js、functions/_shared/aiFeatures.ts)同步新增。
-- sort_order 35:排在契約解析(30)與規範需求抽取(40)之間,同屬 document 類。
insert into public.ai_features
  (key, label, category, edge_function, min_plan, is_llm, enabled, sort_order)
values
  ('documents.classify', '文件自動分類', 'document', 'classify-document', 'trial', true, true, 35)
on conflict (key) do nothing;
