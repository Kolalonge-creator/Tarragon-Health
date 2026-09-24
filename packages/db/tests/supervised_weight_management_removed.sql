-- ===========================================================================
-- Verification: Supervised Weight Management stays removed.
--
-- 20260924220239_remove_supervised_weight_management.sql dropped the product
-- entirely (tables, RPCs, trigger functions, the dedicated enum, the three
-- service_products/service_delivery_cost_model rows) and reverted the free
-- 'obesity' chronic_condition_programmes row to its pre-product shape. A
-- migration's own DO-block assertions only prove that at the moment it ran;
-- this is the standing regression check that a later migration hasn't
-- silently reintroduced any of it (e.g. a future author copying the old
-- 20260910011851 migration as a "similar feature" template).
--
-- Deliberately does NOT sabotage-and-confirm the way a fix-proof does — there
-- is no code path here to sabotage; this is a pure "still absent" check.
--
-- Run via `supabase db query --linked -f this_file.sql`, `psql $DATABASE_URL -f
-- this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK per this manifest's own convention, even though
-- the only write here (the "a real remaining encounter_type still works"
-- probe) is a single insert with no trigger side-effects to track.
-- ===========================================================================

begin;

do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public'
       and table_name in ('weight_management_enrolments', 'weight_management_dose_steps', 'weight_management_checkins')
  ) then
    raise exception 'FAIL: a weight_management_* table has reappeared';
  end if;

  if exists (select 1 from pg_type where typname = 'weight_management_status') then
    raise exception 'FAIL: public.weight_management_status has reappeared';
  end if;

  if exists (
    select 1 from pg_proc
     where proname in (
       'confirm_weight_management_eligibility', 'enforce_weight_management_eligibility_authority',
       'review_weight_management_checkin', 'enforce_weight_checkin_reviewer_authority',
       'raise_weight_checkin_red_flag', 'enforce_weight_management_supervision_only',
       'create_weight_management_enrolment_on_purchase', 'sync_clinical_encounter_weight_management_checkin'
     )
  ) then
    raise exception 'FAIL: a weight-management function has reappeared';
  end if;

  if exists (
    select 1 from public.service_products
     where code in ('weight_management_3m', 'weight_management_6m', 'weight_management_12m')
  ) then
    raise exception 'FAIL: a weight_management_* service_products row has reappeared';
  end if;

  if exists (
    select 1 from public.service_delivery_cost_model
     where service_product_code in ('weight_management_3m', 'weight_management_6m', 'weight_management_12m')
  ) then
    raise exception 'FAIL: a weight_management_* service_delivery_cost_model row has reappeared';
  end if;

  if exists (select 1 from public.clinical_encounters where source_table = 'weight_management_checkins') then
    raise exception 'FAIL: clinical_encounters carries a weight-management row again';
  end if;

  -- clinical_encounters must still accept every OTHER encounter type -- proves
  -- the CHECK constraint was narrowed correctly, not accidentally broken for
  -- everyone. Real row, rolled back, never seed data.
  begin
    insert into public.clinical_encounters
      (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at)
    select organisation_id, id, 'escalation', 'zz_test_probe', gen_random_uuid(), now()
      from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  exception when others then
    raise exception 'FAIL: clinical_encounters no longer accepts a real remaining encounter_type (escalation): %', sqlerrm;
  end;

  -- And it must still REFUSE the removed type, or the CHECK narrowing itself
  -- silently no-opped.
  begin
    insert into public.clinical_encounters
      (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at)
    select organisation_id, id, 'weight_management_checkin', 'zz_test_probe', gen_random_uuid(), now()
      from public.profiles where role = 'patient' and organisation_id is not null limit 1;
    raise exception 'FAIL: clinical_encounters accepted a weight_management_checkin encounter_type again';
  exception when others then
    if sqlerrm not like '%weight_management_checkin%' and sqlerrm not like '%clinical_encounters_encounter_type_check%' then
      raise;
    end if;
  end;

  -- The free obesity programme must stay reverted, not silently redrift back
  -- toward the paid product's shape by a copy-pasted future migration.
  if (select monitoring_vitals from public.chronic_condition_programmes where code = 'obesity')
       <> array['weight', 'blood_pressure']::public.vital_type[]
     or (select review_cadence_months from public.chronic_condition_programmes where code = 'obesity') <> 6
  then
    raise exception 'FAIL: chronic_condition_programmes.obesity has drifted from its free-programme shape';
  end if;

  -- Therapy approvals (co-located in the same original migration as the
  -- removed weight-checkin review RPC) must remain -- a regression here would
  -- mean a future cleanup took the wrong product with it.
  if not exists (select 1 from pg_proc where proname = 'enforce_therapy_approver_authority')
     or not exists (select 1 from pg_proc where proname = 'approve_therapy_session') then
    raise exception 'FAIL: the unrelated therapy-approval product has gone missing too';
  end if;

  raise notice 'PASS: Supervised Weight Management stays removed; clinical_encounters, the free obesity programme and therapy approvals are intact';
end $$;

rollback;
