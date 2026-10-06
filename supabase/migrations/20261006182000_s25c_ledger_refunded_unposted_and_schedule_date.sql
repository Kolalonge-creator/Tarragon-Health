-- S25c: three fixes from the third /code-review of S25.
--   1. An order refunded before it was ever posted is not posted at all: cash in and cash out net to nothing, and posting it would leave
--      a deferred-revenue credit with no schedule and no reversal.
--   2. A recognition schedule starts on the date of the journal entry it belongs to, so a retry after the month closed cannot start it on a
--      different date from the deferral.
--   3. (migration S25b's closing assertion matched too loosely; this one asserts the source_kind check specifically.)
create or replace function private.post_order_to_ledger(p_order uuid, p_include_test boolean default false) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
  it public.catalog_items%rowtype;
  v_date date;
  v_ref text;
  v_entry uuid;
begin
  select * into o from public.orders where id = p_order;
  if not found or o.state not in ('paid', 'refunded') then return null; end if;
  if o.is_test and not p_include_test then return null; end if;
  v_ref := 'order:' || o.id;
  if o.state = 'refunded' and not exists (select 1 from public.finance_journal_entries where source = 'payment' and source_ref = v_ref) then
    return null;
  end if;
  select * into it from public.catalog_items where id = o.catalog_item_id;
  v_date := (coalesce(o.paid_at, now()) at time zone 'Africa/Lagos')::date;
  if exists (select 1 from public.finance_periods where period_month = date_trunc('month', v_date)::date and status <> 'open') then
    v_date := (now() at time zone 'Africa/Lagos')::date;
  end if;

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
    -- the schedule belongs to the entry that exists, whichever date that was posted on
    select entry_date into v_date from public.finance_journal_entries where id = v_entry;
    if o.state = 'paid' and not exists (select 1 from public.revenue_recognition_schedules where source_kind = 'order' and source_id = o.id) then
      perform private.finance_create_recognition_schedule('order', o.id, null, o.organisation_id, '4020', 'NGN', o.amount_kobo, v_date, v_date + it.duration_days);
    end if;
  end if;
  return v_entry;
end $$;
revoke all on function private.post_order_to_ledger(uuid, boolean) from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.revenue_recognition_schedules'::regclass and contype = 'c'
                    and pg_get_constraintdef(oid) like '%source_kind%' and pg_get_constraintdef(oid) like '%''order''%') then
    raise exception 'S25c: the source_kind check does not allow order';
  end if;
end $$;
