-- Tarragon Health — verification for
-- 20260830082927_programme_purchases_sponsor_grant_recheck.sql
--
-- Proves the accepted gap flagged when the sponsor-programme-purchase path
-- was first built is now closed: a sponsor's profile_access grant is
-- re-checked at the moment payment actually confirms, not just at checkout
-- start. A grant revoked in between must cancel the purchase rather than
-- silently activate it — paired with a control proving an intact grant still
-- activates normally, so a change that broke sponsor purchases entirely
-- would not pass this test vacuously.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — always leaves the database exactly as it found
-- it, including the temporary hypertension price this fixture sets.

begin;

update public.chronic_condition_programmes
  set price_kobo = 5000000, default_duration_weeks = coalesce(default_duration_weeks, 12)
where code = 'hypertension';

-- ==========================================================================
-- 1. Sabotage: grant revoked BEFORE payment confirms -> purchase cancelled.
-- ==========================================================================
do $$
declare
  v_org uuid;
  v_beneficiary uuid := gen_random_uuid();
  v_sponsor uuid := gen_random_uuid();
  v_htn uuid;
  v_purchase_id uuid;
  v_status text;
begin
  select organisation_id into v_org from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  if v_org is null then raise exception 'no organisation has patient profiles — cannot run this test'; end if;

  select id into v_htn from public.chronic_condition_programmes where code = 'hypertension';

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_beneficiary, 'pgsgr-sabotage-beneficiary@example.invalid', 'x', now(), '{}', '{}'),
         (v_sponsor, 'pgsgr-sabotage-sponsor@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_beneficiary, v_org, 'patient', 'PGSGR Sabotage Beneficiary'),
         (v_sponsor, v_org, 'patient', 'PGSGR Sabotage Sponsor')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_beneficiary, v_sponsor, 'manage', v_beneficiary);

  insert into public.programme_purchases (patient_id, programme_id)
  values (v_beneficiary, v_htn)
  returning id into v_purchase_id;

  -- Simulates the sponsor checkout path: the row is attributed to the
  -- sponsor (purchased_by), for a beneficiary who is a different person.
  update public.programme_purchases
    set purchased_by = v_sponsor, pending_payment_provider_ref = 'pgsgr-sabotage-ref'
  where id = v_purchase_id;

  -- The grant is revoked in the window between checkout and the webhook.
  delete from public.profile_access where profile_id = v_beneficiary and grantee_user_id = v_sponsor;

  -- The deployed webhook's own payment_transactions insert, which fires the
  -- activation trigger — this test never calls the activation function
  -- directly, so it proves the real trigger wiring, not just the function.
  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values
    (v_org, 'paystack', 'pgsgr-sabotage-evt', 'charge.success', 5000000, 'NGN',
     jsonb_build_object('data', jsonb_build_object(
       'reference', 'pgsgr-sabotage-ref',
       'metadata', jsonb_build_object('kind', 'programme_purchase'))));

  select status into v_status from public.programme_purchases where id = v_purchase_id;
  if v_status <> 'cancelled' then
    raise exception 'FAIL: a purchase whose sponsor grant was revoked before payment confirmed should have been cancelled, got status=%', v_status;
  end if;
  raise notice 'PASS 1: revoked-grant sponsor purchase was cancelled, not activated';
end $$;

-- ==========================================================================
-- 2. Control: an intact grant at payment-confirmation time still activates
--    normally — proves check #1 discriminates rather than always cancelling.
-- ==========================================================================
do $$
declare
  v_org uuid;
  v_beneficiary uuid := gen_random_uuid();
  v_sponsor uuid := gen_random_uuid();
  v_htn uuid;
  v_purchase_id uuid;
  v_status text;
begin
  select organisation_id into v_org from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  select id into v_htn from public.chronic_condition_programmes where code = 'hypertension';

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_beneficiary, 'pgsgr-control-beneficiary@example.invalid', 'x', now(), '{}', '{}'),
         (v_sponsor, 'pgsgr-control-sponsor@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_beneficiary, v_org, 'patient', 'PGSGR Control Beneficiary'),
         (v_sponsor, v_org, 'patient', 'PGSGR Control Sponsor')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_beneficiary, v_sponsor, 'manage', v_beneficiary);

  insert into public.programme_purchases (patient_id, programme_id)
  values (v_beneficiary, v_htn)
  returning id into v_purchase_id;

  update public.programme_purchases
    set purchased_by = v_sponsor, pending_payment_provider_ref = 'pgsgr-control-ref'
  where id = v_purchase_id;

  -- Grant is still held when payment confirms — deliberately not revoked.
  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values
    (v_org, 'paystack', 'pgsgr-control-evt', 'charge.success', 5000000, 'NGN',
     jsonb_build_object('data', jsonb_build_object(
       'reference', 'pgsgr-control-ref',
       'metadata', jsonb_build_object('kind', 'programme_purchase'))));

  select status into v_status from public.programme_purchases where id = v_purchase_id;
  if v_status <> 'active' then
    raise exception 'FAIL (control): a sponsor purchase with an intact grant should have activated, got status=%', v_status;
  end if;
  raise notice 'PASS 2 (control): sponsor purchase with an intact grant activated normally';
  raise notice 'ALL PROGRAMME_PURCHASE_SPONSOR_GRANT_RECHECK CHECKS PASSED';
end $$;

rollback;
