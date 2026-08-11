-- 稽核日誌 IP 位址欄位:一覽表「事件日誌保存與可歸責性」普級 ● 明文列舉 IP 位址。
-- 這份釘住兩件事:①解析規則(來源順序、髒資料一律留空)②IP 由伺服器端寫入,前端拿不到手。
begin;

select plan(13);

-- -- 結構契約 ----------------------------------------------------------------
select has_column('public', 'audit_events', 'actor_ip',
  '稽核事件保存來源 IP 位址');
select col_type_is('public', 'audit_events', 'actor_ip', 'inet',
  'IP 以 inet 型別儲存(可比對網段,不是自由文字)');
select has_function('public', 'current_request_ip',
  '伺服器端 IP 解析函式存在');
select is(
  has_function_privilege('authenticated', 'public.current_request_ip()', 'EXECUTE'),
  false, 'authenticated 不得直接呼叫 IP 解析函式');

-- -- 解析規則 ----------------------------------------------------------------
select is(public.current_request_ip(), null,
  '非 HTTP 路徑(無 request.headers)留空,不編造 IP');

select set_config('request.headers',
  '{"x-forwarded-for":"203.0.113.9, 70.41.3.18, 150.172.238.178"}', true);
select is(public.current_request_ip(), '203.0.113.9'::inet,
  'X-Forwarded-For 取最左段(最初的 client,非中間 proxy)');

select set_config('request.headers',
  '{"cf-connecting-ip":"198.51.100.7","x-forwarded-for":"203.0.113.9"}', true);
select is(public.current_request_ip(), '198.51.100.7'::inet,
  'cf-connecting-ip 優先於可被偽造疊加的 XFF');

select set_config('request.headers', '{"x-real-ip":"192.0.2.44"}', true);
select is(public.current_request_ip(), '192.0.2.44'::inet,
  '僅有 x-real-ip 時採用之');

select set_config('request.headers',
  '{"x-forwarded-for":"2001:db8::8a2e:370:7334"}', true);
select is(public.current_request_ip(), '2001:db8::8a2e:370:7334'::inet,
  'IPv6 可正確寫入');

select set_config('request.headers', '{"x-forwarded-for":"<script>alert(1)</script>"}', true);
select is(public.current_request_ip(), null,
  '標頭被塞入非 IP 字串時留空,不寫入垃圾資料');

select set_config('request.headers', 'not-json-at-all', true);
select is(public.current_request_ip(), null,
  'request.headers 非合法 JSON 時留空,不得讓稽核寫入失敗');

-- -- 端到端:事件寫入時帶上 IP ------------------------------------------------
alter table public.projects disable trigger on_project_created;
insert into public.projects (id, name)
  values ('c9100000-0000-0000-0000-0000000000a1'::uuid, 'IP 稽核測試案');
alter table public.projects enable trigger on_project_created;

select set_config('request.headers', '{"x-forwarded-for":"203.0.113.55"}', true);
select lives_ok($$
  select public.record_audit_event(
    'c9100000-0000-0000-0000-0000000000a1'::uuid, 'test.event', 'test', null,
    'created', null, null, '{}'::jsonb, null)
$$, '事件寫入成功');

select is(
  (select actor_ip from public.audit_events
    where project_id = 'c9100000-0000-0000-0000-0000000000a1'::uuid
      and event_type = 'test.event'),
  '203.0.113.55'::inet,
  '寫入的稽核事件帶有請求來源 IP');

select * from finish();
rollback;
