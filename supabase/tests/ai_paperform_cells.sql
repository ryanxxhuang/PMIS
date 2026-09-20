-- B2:paperform.cells 功能列 seed(20260920160000)與閘門行為。
-- 紙表逐格辨識是會多花錢的路徑,必須能單獨關閉;關閉後 Edge 退回整張圖讀兩次,不是整批失敗。
-- 執行方式:npm run test:db(一次性資料庫從零套 migrations),整份在交易內執行並 rollback。
begin;

select plan(9);

select is((select count(*)::int from public.ai_features where key = 'paperform.cells'), 1,
  'paperform.cells 功能列存在');
select is((select edge_function from public.ai_features where key = 'paperform.cells'), 'draft-field-documents',
  '對應 Edge 函式 draft-field-documents(只在起稿流程內被呼叫,沒有獨立 HTTP 入口)');
select is((select category from public.ai_features where key = 'paperform.cells'), 'vision',
  '分類為 vision(看照片)');
select is((select min_plan from public.ai_features where key = 'paperform.cells'), 'trial',
  '最低方案 trial(與 photo.classify／sitelog.whiteboard 同屬上傳鏈)');
select is((select enabled from public.ai_features where key = 'paperform.cells'), true,
  '預設開啟');
select is((select is_llm from public.ai_features where key = 'paperform.cells'), true,
  '呼叫 LLM,需計 token');
select is((select sort_order from public.ai_features where key = 'paperform.cells'), 115,
  'sort_order 115:排在告示板辨識(110)之後,同屬 vision 類');

-- 閘門:trial 專案可用;平台總開關關閉後連專案覆寫也翻不過(rollback 檔即以此關閉功能)
alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, ai_plan)
values ('b2ce1100-0000-0000-0000-0000000000b2', 'B2 逐格辨識閘門測試案', 'trial');
alter table public.projects enable trigger on_project_created;
select is(public.ai_feature_allowed('b2ce1100-0000-0000-0000-0000000000b2', 'paperform.cells'), true,
  'trial 專案可用逐格辨識');
update public.ai_features set enabled = false where key = 'paperform.cells';
insert into public.project_ai_overrides (project_id, feature_key, enabled)
values ('b2ce1100-0000-0000-0000-0000000000b2', 'paperform.cells', true);
select is(public.ai_feature_allowed('b2ce1100-0000-0000-0000-0000000000b2', 'paperform.cells'), false,
  '平台總開關關閉後專案覆寫也翻不過(rollback 檔即以此關閉功能)');

select * from finish();
rollback;
