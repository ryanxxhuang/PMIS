-- P2b:field_docs.draft 功能列 seed(20260917210000)與閘門行為。
-- 起稿入口與上傳鏈同屬 trial、預設開啟;平台總開關關閉時任何方案都拿不到(Edge fail-closed 的 DB 側依據)。
-- 執行方式:npm run test:db(一次性資料庫從零套 migrations),整份在交易內執行並 rollback。
begin;

select plan(8);

select is((select count(*)::int from public.ai_features where key = 'field_docs.draft'), 1,
  'field_docs.draft 功能列存在');
select is((select edge_function from public.ai_features where key = 'field_docs.draft'), 'draft-field-documents',
  '對應 Edge 函式 draft-field-documents');
select is((select category from public.ai_features where key = 'field_docs.draft'), 'draft',
  '分類為 draft(產草稿)');
select is((select min_plan from public.ai_features where key = 'field_docs.draft'), 'trial',
  '最低方案 trial(與 photo.classify／sitelog.whiteboard 同屬上傳鏈)');
select is((select enabled from public.ai_features where key = 'field_docs.draft'), true,
  '預設開啟');
select is((select is_llm from public.ai_features where key = 'field_docs.draft'), true,
  '呼叫 LLM(逐張辨識),需計 token');

-- 閘門:trial 專案可用;平台總開關關閉後連 pro 專案也拿不到(專案覆寫翻不過)
alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, ai_plan)
values ('b2e20000-0000-0000-0000-00000000000b', 'P2b 起稿閘門測試案', 'trial');
alter table public.projects enable trigger on_project_created;
select is(public.ai_feature_allowed('b2e20000-0000-0000-0000-00000000000b', 'field_docs.draft'), true,
  'trial 專案可用起稿');
update public.ai_features set enabled = false where key = 'field_docs.draft';
insert into public.project_ai_overrides (project_id, feature_key, enabled)
values ('b2e20000-0000-0000-0000-00000000000b', 'field_docs.draft', true);
select is(public.ai_feature_allowed('b2e20000-0000-0000-0000-00000000000b', 'field_docs.draft'), false,
  '平台總開關關閉後專案覆寫也翻不過(rollback 檔即以此關閉功能)');

select * from finish();
rollback;
