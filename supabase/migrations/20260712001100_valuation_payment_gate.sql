-- ── 金流狀態閘門(正式版驗收 P0:未核定估驗不得形成請款/收款)─────────────────
-- 不變量:invoice_date / paid_date / paid_amount 任一非空 ⇒ status 必須是核定後
-- 狀態('已核定';'已請款'為 schema 保留值,同屬核定後,一併放行)。
--
-- 這是資料一致性,不是權限——所以沒有 is_project_admin 例外,service role /
-- SQL Editor 也一體適用:任何路徑都不准再產生「退回草稿卻已收款」的矛盾資料。
--
-- 退回核定:若該期已登錄金流欄位,直接退回會被擋下,必須先清空三欄(清空=設
-- null 永遠允許)再退回——金流證據的移除是顯式動作,不能被狀態轉移默默吞掉。
-- 既有矛盾列不在 migration 裡自動清除(保留現場證據):下次任何人更新該列時
-- 會被擋,依錯誤訊息指引清空金流欄位即可修復。

create or replace function public.valuations_payment_gate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.invoice_date is not null or new.paid_date is not null or new.paid_amount is not null)
     and new.status not in ('已核定', '已請款') then
    if tg_op = 'UPDATE' and old.status in ('已核定', '已請款')
       and new.status is distinct from old.status then
      raise exception '此期已登錄請款/收款,不可直接退回核定:請先清空請款日/收款日/實收金額,再退回';
    end if;
    raise exception '估驗尚未核定,不可保有請款/收款資料:請先清空請款日/收款日/實收金額,或由監造核定後再登錄';
  end if;
  return new;
end; $$;

drop trigger if exists valuations_payment_gate on public.valuations;
create trigger valuations_payment_gate before insert or update on public.valuations
  for each row execute function public.valuations_payment_gate();
