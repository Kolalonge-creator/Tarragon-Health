-- Tarragon Health — pricing/entitlement corrections, founder review 2026-08-05.
--
-- 1. EXPEDITED DOCTOR RESPONSE (add_ons 'expedited-response'/'-usd') retired.
--    It sold faster access to the same fixed pool of doctor time a paying
--    patient could already ask for at no extra charge — founder call: this
--    puts real pressure on a scarce clinical resource for a convenience
--    upsell, not a clinical need. Same is_active=false pattern as the
--    Dedicated Care Coordinator withdrawal (20260731_withdraw_dedicated_
--    care_coordinator_addon.sql). Zero-row change: no subscription_add_ons
--    row has ever referenced either code (checked live 2026-08-05), so this
--    is a pure structural change, no subscriber to migrate or refund.
--
-- 2. HEALTH EDUCATION (add_ons 'health-education'/'-usd') retired as a paid
--    add-on. No plan-features change needed here: 'health_education' is
--    already present in every paid plan's features[] (prevent/essential/
--    complete, all currency+interval variants — confirmed live), so there is
--    no paid tier left needing to buy it separately, and Tarragon Free is
--    deliberately excluded rather than offered a pay-your-way-in path. Same
--    zero-subscriber check as above (checked live 2026-08-05).
--
-- 3. ASYNC "ASK A DOCTOR" reply SLA widened from 24 to 72 hours. Still
--    Complete-Care-only via the existing 'async_doctor_visit' feature grant
--    (20260723010040_async_consults.sql) — unchanged, this only touches the
--    per-row default so newly-created consults get the new promise. Existing
--    open consults keep whatever sla_due_at they were created with.

update public.add_ons
  set is_active = false
  where code in ('expedited-response', 'expedited-response_usd', 'health-education', 'health-education_usd')
    and is_active = true;

alter table public.async_consults
  alter column sla_due_at set default (now() + interval '72 hours');

do $$
declare
  v_default text;
begin
  select column_default into v_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'async_consults' and column_name = 'sla_due_at';
  if v_default is null or v_default not ilike '%72%' then
    raise exception 'FAIL: async_consults.sla_due_at default not updated to 72h (got %)', v_default;
  end if;

  if exists (
    select 1 from public.add_ons
    where code in ('expedited-response', 'expedited-response_usd') and is_active
  ) then
    raise exception 'FAIL: expedited-response add_ons row still active';
  end if;

  if exists (
    select 1 from public.add_ons
    where code in ('health-education', 'health-education_usd') and is_active
  ) then
    raise exception 'FAIL: health-education add_ons row still active';
  end if;
end $$;
