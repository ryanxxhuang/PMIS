-- 每日提醒推播排程(pg_cron + pg_net → send-reminders Edge Function)
-- ---------------------------------------------------------------------------
-- 使用前先把下面兩個占位符換掉再到 SQL Editor 執行:
--   <PROJECT_REF>  — Supabase 專案 ref(Project URL 的子網域)
--   <CRON_SECRET>  — 自訂長亂數,要和 `supabase secrets set CRON_SECRET=...` 相同
-- 重跑安全:cron.schedule 同名會覆蓋(先 unschedule 再 schedule)。

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 已存在同名排程就先移除(cron.unschedule 對不存在的名字會擲錯,包起來)
do $$
begin
  perform cron.unschedule('pmis-daily-reminders');
exception when others then null;
end $$;

-- 每日 00:00 UTC = 台北 08:00
select cron.schedule(
  'pmis-daily-reminders',
  '0 0 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  )
  $$
);

-- 檢查:select * from cron.job;
-- 執行紀錄:select * from cron.job_run_details order by start_time desc limit 10;
