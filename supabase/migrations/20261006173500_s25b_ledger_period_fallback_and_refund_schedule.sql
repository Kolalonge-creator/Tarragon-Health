-- S25b: two fixes from the second /code-review of S25 (docs/BUILD-PROGRESS.md).
--   1. A late payment whose paid date falls in a CLOSED accounting period could never post (the entry was dated in the closed month and
--      the hourly retry failed the same way for ever). The entry now falls back to today (Lagos) when the paid month is not open.
--   2. Nothing cancelled an order's revenue recognition schedule when the order was refunded, so deferred revenue would keep being
--      released for money returned. Moving an order to refunded now cancels its active schedule. The reversing journal entry itself is S26.

create or replace function private.post_order_to_ledger(p_order uuid, p_include_test boolean default false) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
  it public.catalog_items%rowtype;
  v_date date;
  v_ref text;
  v_entry uuid;
  v_end date;
begin
  select * into o from public.orders where id = p_order;
  if not found or o.state not in ('paid', 'refunded') then return null; end if;
  if o.is_test and not p_include_test then return null; end if;
  select * into it from public.catalog_items where id = o.catalog_item_id;
  v_date := (coalesce(o.paid_at, now()) at time zone 'Africa/Lagos')::date;
  -- a closed or locked month cannot take an entry: post it today instead of never
  if exists (select 1 from public.finance_periods where period_month = date_trunc('month', v_date)::date and status <> 'open') then
    v_date := (now() at time zone 'Africa/Lagos')::date;
  end if;
  v_ref := 'order:' || o.id;

  if it.duration_days is null then
    v_entry := private.finance_post_journal(v_date, 'NGN', 'payment', v_ref, 'Order payment: ' || it.code,
      jsonb_build_array(
        jsonb_build_object('account_code', '1020', 'debit_minor', o.amount_kobo, 'credit_minor', 0, 'organisation_id', o.organisation_id),
        jsonb_build_object('account_code', '4100', 'debit_minor', 0, 'credit_minor', o.amount_kobo, 'organisation_id', o.organisation_id)), null);
  else
    v_entry := private.finance_post_journal(v_date, 'NGN', 'payment', v_ref, 'Order payment: ' || it.code,
      jsonb_build_array(
        jsonb_build_object('account_code', '1020', 'debit_minor', o.amount_kobo, 'credit_minor', 0, 'organisation_id', o.organisation_id),
        jsonb_build_object('account_code', '2000', 'debit_minor', 0, 'credit_minor', o.amount_kobo, 'organisation_id', o.organisation_id)), null);
    v_end := v_date + it.duration_days;
    if o.state = 'paid' and not exists (select 1 from public.revenue_recognition_schedules where source_kind = 'order' and source_id = o.id) then
      perform private.finance_create_recognition_schedule('order', o.id, null, o.organisation_id, '4020', 'NGN', o.amount_kobo, v_date, v_end);
    end if;
  end if;
  return v_entry;
end $$;
revoke all on function private.post_order_to_ledger(uuid, boolean) from public, anon, authenticated;

create function private.orders_cancel_schedule_on_refund() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.state = 'refunded' and old.state is distinct from 'refunded' then
    update public.revenue_recognition_schedules
       set status = 'cancelled',
           cancelled_reason = 'Order ' || new.id || ' was refunded on ' || to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM-DD') || '; no more revenue is recognised against it.'
     where source_kind = 'order' and source_id = new.id and status = 'active';
  end if;
  return new;
end $$;
revoke all on function private.orders_cancel_schedule_on_refund() from public, anon, authenticated;
create trigger orders_cancel_schedule_on_refund after update of state on public.orders
  for each row execute function private.orders_cancel_schedule_on_refund();

-- the new check constraint must allow 'order' (the replay of the S25 migration drops and re-adds it by name; prove the result)
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.revenue_recognition_schedules'::regclass and contype = 'c'
                    and pg_get_constraintdef(oid) like '%''order''%') then
    raise exception 'S25b: revenue_recognition_schedules does not allow source_kind order';
  end if;
end $$;
