-- P5a｜責任不明的契約義務不歸任何一方(D-026 §4 契約時程與提醒對齊;設計
-- docs/architecture/slimming-entrypoints-and-retirement.md §4.1、docs/architecture/ball-in-court.md)。
--
-- 為什麼:obligation_party() 原本把三方以外的值(null／空字串／「其他」／自由文字)一律落回「廠商」,
-- contract_obligations 的 update policy 因此讓廠商可以標記「責任方根本沒設定」的義務;首頁、
-- Agent 與早報又各自有一套「不明就歸廠商」或「不歸任何人」的判斷。使用者定案(實作指令 §5):
-- 責任不明或基準日缺失明示待補,不預設丟給廠商。
--
-- 做法:obligation_party() 對三方以外回 null(去頭尾空白後比對,與前端／共用規則的精確白名單同口徑)。
-- update policy(20260825120000)不動——`obligation_party(responsible) = my_party()` 在 null 下為
-- null(不成立),三方都不放行,只剩 admin_override(非正式模式的專案管理者)能動。
-- 前端 obligationParty(src/lib/obligationTimeline.js)與共用規則 ballInCourtRules.obligationSide
-- 同步改為「待補設定」;三方在首頁／Agent／早報都看得到待補設定,處理入口是擷取審核
-- (已確認內容不可改,廢止取代後補登責任方)。
--
-- 資料:不改任何列。既有 responsible 為 null／「其他」的義務自此在期限追蹤頁三方皆唯讀,
-- 由審核者補正;其餘義務行為不變。
-- 回復:supabase/rollbacks/20260917213502_obligation_party_unassigned.down.sql(還原「落回廠商」)。
-- pgTAP:supabase/tests/obligation_party_unassigned.sql;既有 obligation_ownership_completed_at.sql 的
-- 三條「落回廠商」斷言同步改為新語意。

create or replace function public.obligation_party(r text)
returns text language sql immutable as $$
  select case when btrim(r) in ('廠商','監造','機關') then btrim(r) else null end;
$$;

comment on function public.obligation_party(text) is
  '義務歸屬方:三方值(去頭尾空白)原樣通過;其餘(null／空字串／其他／自由文字)回 null=不歸任何一方,update policy 因此對三方都不放行(P5a,20260917213502)。與前端 obligationParty、共用規則 ballInCourtRules.obligationSide 同一條規則。';
