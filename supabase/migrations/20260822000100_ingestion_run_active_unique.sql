-- W13:extract-requirements 同版本併發啟動的 check-then-insert 競態,由 DB 唯一性收口:
-- 同一 document_version 同時最多一條 pending/processing 的抽取 run。
-- 前端防連點與伺服器 select 防呆都有時間窗——兩個相隔 17ms 的請求(2026-08-21
-- 正式站實測)同穿防呆並行抽取,雙倍燒 token;唯一 index 是唯一擋得住的層,
-- 函式端把 insert 的 23505 轉成 409「這份文件已在解析中」。
--
-- 建 index 前先把現存進行中的 run 全部收斂成 failed:部署窗內沒有合法在跑的
-- 解析值得保護(被砍的殭屍佔多數),而真的在跑的請求之後的完成寫入以 id 定位,
-- 仍會把自己寫成 completed,不受影響;續跑認領則會誠實拿到「請重新啟動」。
update public.document_ingestion_runs
set status = 'failed',
    completed_at = now(),
    error_message = '解析逾時未完成,系統自動標記失敗;可重新啟動解析'
where status in ('pending', 'processing');

create unique index if not exists document_ingestion_runs_one_active_per_version
  on public.document_ingestion_runs (document_version_id)
  where status in ('pending', 'processing');
