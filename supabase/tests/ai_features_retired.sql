-- 退場 AI 功能的平台總開關(pgTAP):assistant.chat(20260812000300)與 contract.parse
-- (20260911100100)在 db reset 後必須仍是 enabled=false。seed 用 on conflict do nothing,
-- 但若日後有人重寫 seed、或加一支「全部開回」的 migration,伺服器端閘門
-- (ai_feature_allowed)就會放行 parse-contract——它產出的 obligations 繞過
-- sourceVerify / document_ingestion_runs / requirements 權威(D-012)。
-- 執行方式:本地 supabase(colima)+容器內 psql,整份在交易內執行並 rollback。
begin;

select plan(6);

select is((select enabled from public.ai_features where key = 'contract.parse'), false,
  'contract.parse 平台總開關關閉(D-012:requirements 是唯一權威)');
select is((select enabled from public.ai_features where key = 'assistant.chat'), false,
  'assistant.chat 平台總開關關閉(W3-3/D-008:/agent 是唯一對話入口)');
select is((select count(*)::int from public.ai_features where key in ('contract.parse', 'assistant.chat')), 2,
  '退場功能列保留(後台清單與 ai_usage_events 歷史要能對到)');

-- 閘門效果:連 pro 方案的專案也拿不到;取代路徑 requirements.extract 仍開放
alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name, ai_plan)
values ('b5e20000-0000-0000-0000-00000000000a', '退場功能閘門測試案', 'pro');
alter table public.projects enable trigger on_project_created;

select is(public.ai_feature_allowed('b5e20000-0000-0000-0000-00000000000a', 'contract.parse'), false,
  'pro 專案也不可用 contract.parse(平台總開關優先於方案)');
-- 專案覆寫也翻不過平台總開關(否則後台一個誤操作就重開退場功能)
insert into public.project_ai_overrides (project_id, feature_key, enabled)
values ('b5e20000-0000-0000-0000-00000000000a', 'contract.parse', true);
select is(public.ai_feature_allowed('b5e20000-0000-0000-0000-00000000000a', 'contract.parse'), false,
  '專案覆寫 enabled=true 仍翻不過平台總開關');
select is(public.ai_feature_allowed('b5e20000-0000-0000-0000-00000000000a', 'requirements.extract'), true,
  '取代路徑 requirements.extract 仍開放');

select * from finish();
rollback;
