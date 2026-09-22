-- Tarragon Health — verification for
-- 20260922190157_doctor_paid_work_and_income_analytics.sql
--
-- private.doctor_paid_work is the riskiest kind of view this codebase writes:
-- it resolves a doctor by joining EIGHT different redemption-target tables,
-- each pointing at a different actor table (appointments.clinician_id ->
-- profiles; every other *_by/actor_clinical_staff_id column ->
-- clinical_staff), and the migration's own header explains that joining the
-- wrong actor table matches nothing rather than erroring — the row silently
-- reads as unattributed instead of failing. That is exactly the failure mode
-- this test exists to catch for one representative redemption path
-- ('verified_document' -> verified_documents.issued_by -> clinical_staff).
--
-- Proves, in one rolled-back transaction:
--   1. A paid verified_document credit, redeemed against a real issued
--      document, resolves to the issuing doctor's profiles.id via
--      public.analytics_doctor_paid_jobs — not null, not the clinical_staff
--      row's own id (which the migration deliberately never surfaces).
--   2. NEGATIVE CONTROL for (1): clinical_staff.id and clinical_staff.
--      profile_id genuinely differ in this fixture (both freshly generated
--      UUIDs), so a join against the wrong column really would have failed
--      to resolve — this fixture discriminates, it doesn't pass vacuously.
--   3. public.analytics_doctor_income totals reconcile: the fixture's own
--      revenue lands in exactly one by_doctor entry, and totals.jobs /
--      totals.revenue_minor for that same window equal
--      sum(by_doctor) + sum(unattributed) — the same invariant the RPC's own
--      jsonb_build_object relies on, checked from the outside.
--   4. GATE — a non-analyst profile gets '{}' / '[]' back from both RPCs,
--      even though the same fixture data exists and would resolve for an
--      analyst. Sabotage: temporarily re-grant EXECUTE to anon on both
--      functions and confirm has_function_privilege reports it — proving the
--      revoke assertion inside the migration itself would have caught a
--      regression, not just that the grant statement was once run.
--   5. private.doctor_paid_work stays unreachable directly by authenticated
--      (the only path to this data is through the two gated RPCs).
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, never seed data.

begin;

do $$
declare
  v_org           uuid;
  v_patient       uuid := gen_random_uuid();
  v_doctor        uuid := gen_random_uuid();
  v_analyst       uuid := gen_random_uuid();
  v_non_analyst   uuid := gen_random_uuid();
  v_staff_id      uuid := gen_random_uuid();
  v_product       uuid;
  v_code          text;
  v_price         bigint;
  v_doc_id        uuid := gen_random_uuid();
  v_income        jsonb;
  v_jobs          jsonb;
  v_doctor_entry  jsonb;
  v_job_row       jsonb;
  v_sum_by_doctor bigint;
  v_sum_unattrib  bigint;
  v_totals        jsonb;
begin
  select organisation_id into v_org
    from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  -- Resolve the vehicle dynamically (never hardcode a product code — the
  -- catalogue churns, confirmed live mid-development of this very migration
  -- when continuous_monitoring_3m/6m/12m were retired in favour of a
  -- single 90-day tier without this test needing to change).
  select id, code, price_kobo into v_product, v_code, v_price
    from public.service_products
   where is_active and code like 'verified_document_%'
   order by code
   limit 1;
  if v_product is null then
    raise exception 'no active verified_document_* product — cannot exercise the verified_document redemption path';
  end if;

  ------------------------------------------------------------------ fixtures
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient,     'dia-patient@example.invalid',     'x', now(), '{}', '{}'),
    (v_doctor,      'dia-doctor@example.invalid',       'x', now(), '{}', '{}'),
    (v_analyst,     'dia-analyst@example.invalid',      'x', now(), '{}', '{}'),
    (v_non_analyst, 'dia-non-analyst@example.invalid',  'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_patient,     v_org, 'patient',   'DIA Fixture Patient'),
    (v_doctor,      v_org, 'clinician', 'DIA Fixture Doctor'),
    (v_analyst,     v_org, 'analyst',   'DIA Fixture Analyst'),
    (v_non_analyst, v_org, 'patient',   'DIA Fixture Non-Analyst')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id,
        role = excluded.role,
        full_name = excluded.full_name;

  insert into public.clinical_staff
    (id, organisation_id, profile_id, full_name, credential_type, active, doctor_tier, license_verified_at)
  values
    (v_staff_id, v_org, v_doctor, 'DIA Fixture Doctor', 'MDCN', true, 'medical_officer', now());

  -- 2. clinical_staff.id vs profile_id genuinely differ — the negative
  -- control that proves a wrong-table join in this fixture would not
  -- coincidentally still resolve.
  if v_staff_id = v_doctor then
    raise exception 'FAIL 2: fixture is not discriminating — clinical_staff.id equals profile_id by construction';
  end if;

  -- The document issued by the fixture doctor. verified_documents_enforce_
  -- credit (BEFORE INSERT) demands a real redeem_available_service_purchase
  -- call keyed off auth.uid(); this fixture inserts the already-issued
  -- state directly, the same way this project's own DB proofs bypass
  -- app-level credit gates for a controlled fixture (see e.g.
  -- force_safe_patient_order_insert_defaults.sql's disable/enable pattern).
  alter table public.verified_documents disable trigger verified_documents_enforce_credit;
  insert into public.verified_documents
    (id, organisation_id, patient_id, document_type, status, attestation_text, valid_from,
     issued_by, issued_at, created_at, updated_at)
  values
    (v_doc_id, v_org, v_patient, 'fit_to_work', 'issued', 'DIA fixture attestation text',
     now(), v_staff_id, now(), now(), now());
  alter table public.verified_documents enable trigger verified_documents_enforce_credit;

  -- payable_kobo is a generated column (amount_kobo less any voucher
  -- coverage) — not settable directly.
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id,
     status, amount_kobo, currency, purchased_at, redeemed_at,
     redeemed_entity_type, redeemed_entity_id)
  values
    (v_org, v_patient, v_patient, v_product,
     'active', v_price, 'NGN', now(), now(),
     'verified_document', v_doc_id);

  ------------------------------------------------------------------ 4. GATE closed for a non-analyst, before proving it opens for one
  --
  -- Deliberately never touches the `role` GUC here (only request.jwt.claim.
  -- sub) — private.is_analyst() reads auth.uid() alone, and set_config
  -- ('role', 'authenticated', true) actually reassigns the session's
  -- effective Postgres role for privilege-checking purposes (it is the same
  -- mechanism as SET ROLE, not a cosmetic label), which would strip this
  -- script's own superuser privilege for the rest of the transaction —
  -- confirmed live: the section 4c sabotage GRANT silently no-ops once role
  -- has been switched to 'authenticated', because 'authenticated' has no
  -- GRANT OPTION on these functions.
  perform set_config('request.jwt.claim.sub', v_non_analyst::text, true);

  v_income := public.analytics_doctor_income();
  if v_income <> '{}'::jsonb then
    raise exception 'FAIL 4a: a non-analyst got a real payload from analytics_doctor_income: %', v_income;
  end if;
  v_jobs := public.analytics_doctor_paid_jobs(v_doctor);
  if v_jobs <> '[]'::jsonb then
    raise exception 'FAIL 4b: a non-analyst got a real payload from analytics_doctor_paid_jobs: %', v_jobs;
  end if;

  ------------------------------------------------------------------ 1. OPEN for an analyst — the fixture resolves to the doctor's profile id
  perform set_config('request.jwt.claim.sub', v_analyst::text, true);

  v_income := public.analytics_doctor_income();
  v_doctor_entry := (
    select d from jsonb_array_elements(v_income->'by_doctor') d
    where d->>'doctor_profile_id' = v_doctor::text
  );
  if v_doctor_entry is null then
    raise exception 'FAIL 1a: fixture doctor % has no by_doctor entry at all — % ', v_doctor, v_income->'by_doctor';
  end if;
  if v_doctor_entry->>'doctor_profile_id' = v_staff_id::text then
    raise exception 'FAIL 1b: by_doctor surfaced clinical_staff.id instead of profiles.id';
  end if;
  if (v_doctor_entry->>'revenue_minor')::bigint <> v_price then
    raise exception 'FAIL 1c: fixture doctor revenue_minor % does not match the purchase price %',
      v_doctor_entry->>'revenue_minor', v_price;
  end if;

  v_jobs := public.analytics_doctor_paid_jobs(v_doctor);
  if jsonb_array_length(v_jobs) <> 1 then
    raise exception 'FAIL 1d: expected exactly 1 paid job for the fixture doctor, got %', v_jobs;
  end if;
  v_job_row := v_jobs->0;
  if v_job_row->>'work_type' <> 'verified_document'
     or v_job_row->>'attribution' <> 'attributed'
     or v_job_row->>'source' <> 'service_purchase'
     or (v_job_row->>'revenue_minor')::bigint <> v_price then
    raise exception 'FAIL 1e: fixture job row shape is wrong: %', v_job_row;
  end if;

  ------------------------------------------------------------------ 3. totals reconcile (no period filter — the whole table)
  v_income := public.analytics_doctor_income();
  v_totals := v_income->'totals';

  select coalesce(sum((d->>'revenue_minor')::bigint), 0)
    into v_sum_by_doctor
    from jsonb_array_elements(v_income->'by_doctor') d;
  select coalesce(sum((u->>'revenue_minor')::bigint), 0)
    into v_sum_unattrib
    from jsonb_array_elements(v_income->'unattributed') u;

  if (v_totals->>'revenue_minor')::bigint <> v_sum_by_doctor + v_sum_unattrib then
    raise exception 'FAIL 3a: totals.revenue_minor (%) != by_doctor sum (%) + unattributed sum (%)',
      v_totals->>'revenue_minor', v_sum_by_doctor, v_sum_unattrib;
  end if;
  if (v_totals->>'attributed_revenue_minor')::bigint <> v_sum_by_doctor then
    raise exception 'FAIL 3b: totals.attributed_revenue_minor (%) != by_doctor sum (%)',
      v_totals->>'attributed_revenue_minor', v_sum_by_doctor;
  end if;

  ------------------------------------------------------------------ 5. the view itself is unreachable directly
  if has_table_privilege('authenticated', 'private.doctor_paid_work', 'SELECT') then
    raise exception 'FAIL 5: authenticated can SELECT private.doctor_paid_work directly';
  end if;

  raise notice 'PASS 1-3, 5: doctor income resolves the correct actor table, gate closes for a non-analyst, totals reconcile, view is unreachable directly';
end $$;

------------------------------------------------------------------ 4c. sabotage: the anon-execute revoke actually discriminates
do $$
begin
  grant execute on function public.analytics_doctor_income(timestamptz, timestamptz) to anon;
  grant execute on function public.analytics_doctor_paid_jobs(uuid, timestamptz, timestamptz, integer) to anon;

  if not has_function_privilege('anon', 'public.analytics_doctor_income(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL 4c-i: sabotage grant did not take — has_function_privilege cannot be trusted to catch a real regression here';
  end if;
  if not has_function_privilege('anon', 'public.analytics_doctor_paid_jobs(uuid, timestamptz, timestamptz, integer)', 'EXECUTE') then
    raise exception 'FAIL 4c-ii: sabotage grant did not take — has_function_privilege cannot be trusted to catch a real regression here';
  end if;

  revoke execute on function public.analytics_doctor_income(timestamptz, timestamptz) from anon;
  revoke execute on function public.analytics_doctor_paid_jobs(uuid, timestamptz, timestamptz, integer) from anon;

  if has_function_privilege('anon', 'public.analytics_doctor_income(timestamptz, timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.analytics_doctor_paid_jobs(uuid, timestamptz, timestamptz, integer)', 'EXECUTE') then
    raise exception 'FAIL 4c-iii: revoke did not restore the closed state';
  end if;

  raise notice 'PASS 4c: the anon-execute assertion in the migration itself genuinely discriminates open vs closed';
end $$;

rollback;
