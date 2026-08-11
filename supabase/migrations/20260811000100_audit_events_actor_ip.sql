-- 稽核日誌補「IP 位址」欄位。
--
-- 依據:行政院公共工程委員會 112/9/25 工程企字第 1120022701 號函檢送之
-- 「各類資訊(服務)採購之共通性資通安全基本要求參考一覽表」,
-- 「雲端微服務(SaaS)套裝型」→「事件日誌保存與可歸責性」普級 ●:
--   「應提供日誌保存,包括記錄帳號與權限變更、登入名稱、時間、IP 位址、
--     資料存取及重要安全性事件等,應確保其完整與正確性並符合機關保存年限
--    (建議至少六個月)要求」
-- 原 audit_events 有事件類型/時間/位置/身分,唯獨缺 IP 位址,故補之。
--
-- 純加法:欄位可為 null——既有列無從回填,且非 HTTP 路徑(migration、psql、
-- 排程作業)本來就沒有來源 IP。把它做成 not null 會逼出假資料,反而毀掉佐證力。

alter table public.audit_events add column if not exists actor_ip inet;

comment on column public.audit_events.actor_ip is
  '事件來源 IP,由伺服器端從 PostgREST 轉發之 request.headers 解析。'
  '非 HTTP 路徑(migration/psql/排程)為 null。';

-- IP 一律由伺服器端從請求標頭取得,**不接受前端傳參**。
-- 前端可竄改的欄位不能當佐證——這條和 record_audit_event 不收 actor 參數是同一個道理。
create or replace function public.current_request_ip()
returns inet language plpgsql stable set search_path = public as $$
declare
  headers jsonb;
  candidate text;
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null; -- 非 HTTP 路徑,或標頭不是合法 JSON
  end;
  if headers is null then
    return null;
  end if;

  -- 取用順序依可信度:CDN 端寫入的直連 IP > X-Forwarded-For 最左段(最初的 client)
  -- > X-Real-IP。XFF 會是「client, proxy1, proxy2」,取第一段。
  candidate := coalesce(
    nullif(btrim(coalesce(headers ->> 'cf-connecting-ip', '')), ''),
    nullif(btrim(split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1)), ''),
    nullif(btrim(coalesce(headers ->> 'x-real-ip', '')), '')
  );
  if candidate is null then
    return null;
  end if;

  begin
    return candidate::inet;
  exception when others then
    return null; -- 標頭被塞入非 IP 字串時寧可留空,不要寫入垃圾資料
  end;
end; $$;
revoke all on function public.current_request_ip() from public, anon, authenticated;

-- record_audit_event 簽章不變(12 個 trigger 函式的呼叫端一行都不用改),
-- 僅在插入時多帶 actor_ip。
create or replace function public.record_audit_event(
  p_project uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_before jsonb,
  p_after jsonb,
  p_metadata jsonb,
  p_correlation uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  actor_uid uuid := auth.uid();
  actor_project_party_id uuid;
  actor_party_type text;
  actor_project_role text;
  actor_is_admin boolean;
  event_id uuid;
  event_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  -- During project deletion, child cascades must not create transient audit
  -- rows against a parent that is already disappearing.
  if p_project is null or not exists (
    select 1 from public.projects p where p.id = p_project
  ) then
    return null;
  end if;

  if actor_uid is null then
    event_metadata := event_metadata || jsonb_build_object('actor_kind', 'system');
  else
    select m.project_party_id, pp.party_type, m.project_role,
           m.is_project_admin
      into actor_project_party_id, actor_party_type, actor_project_role,
           actor_is_admin
    from public.project_memberships m
    join public.project_parties pp on pp.id = m.project_party_id
    where m.project_id = p_project
      and m.user_id = actor_uid
      and pp.is_active
    limit 1;

    event_metadata := event_metadata || jsonb_build_object(
      'actor_kind',
      case when actor_project_party_id is null
        then 'authenticated_unresolved' else 'project_member' end
    );
  end if;

  insert into public.audit_events (
    project_id, actor_user_id, actor_project_party_id, actor_party_type,
    actor_project_role, actor_is_project_admin, event_type, entity_type,
    entity_id, action, before_data, after_data, metadata, correlation_id,
    actor_ip
  ) values (
    p_project, actor_uid, actor_project_party_id, actor_party_type,
    actor_project_role, actor_is_admin, p_event_type, p_entity_type,
    p_entity_id, p_action, p_before, p_after, event_metadata, p_correlation,
    public.current_request_ip()
  ) returning id into event_id;

  return event_id;
end; $$;
revoke all on function public.record_audit_event(
  uuid, text, text, uuid, text, jsonb, jsonb, jsonb, uuid
) from public, anon, authenticated;
