-- Founder decision 2026-08-11: breast_imaging (Ultrasound <40 / Mammography
-- 40+, part of Comprehensive Screen) goes live the same way self-arranged
-- fulfilment already made fit/mammography/colonoscopy orderable
-- (20260803124833_self_arranged_lab_fulfilment.sql) — it never actually
-- needed a contracted imaging partner, the same "zero fulfilling lab_tests
-- rows" reasoning 20260802212103 used to keep it dormant is exactly the gap
-- self-arranged fulfilment closed for every other screen a day later: the
-- patient takes the order to any imaging facility near them, pays them
-- directly, and uploads the result themselves. abdominal_ultrasound /
-- prostate_ultrasound / echo stay dormant — no founder decision to activate
-- those yet.
--
-- clinical_breast_exam goes dormant instead — Tarragon has no physical
-- clinic exam capability right now. It was never added to any Screen-tier
-- panel_bundles.test_codes, so it was never in check_screen_order_
-- completeness's dormant list to begin with; the lever that actually
-- matters for it is screen_types.is_active, which is what gates whether
-- submitRiskAssessment (apps/web/src/app/(dashboard)/patient/actions.ts,
-- via computeScreeningRecommendations) ever creates a screening_schedules
-- row and the daily reminder cron (20260807121855_screening_due_
-- reminders.sql) nudges a patient toward one. Confirmed live: zero
-- screening_schedules rows exist for either code today, so this is a
-- forward-looking flag flip, not a data migration.

update public.screen_types
  set is_active = false
where code = 'clinical_breast_exam';

-- Supersedes 20260802224614's copy of this function — same body, only
-- breast_imaging removed from v_dormant.
create or replace function private.check_screen_order_completeness(p_lab_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test_codes text[];
  v_patient_id uuid;
  v_patient_sex text;
  v_patient_age int;
  v_code text;
  v_sex_applic text;
  v_age_from int;
  v_age_to int;
  v_once_per_lifetime text[] := array['sickle_cell_genotype', 'blood_group'];
  v_dormant text[] := array['abdominal_ultrasound', 'prostate_ultrasound', 'echo'];
  v_satisfied boolean;
begin
  select lo.patient_id, pb.test_codes
    into v_patient_id, v_test_codes
  from public.lab_orders lo
  join public.panel_bundles pb on pb.id = lo.panel_bundle_id
  where lo.id = p_lab_order_id;

  if v_patient_id is null or v_test_codes is null then
    return false;
  end if;

  select p.sex::text, extract(year from age(now(), p.date_of_birth))::int
    into v_patient_sex, v_patient_age
  from public.profiles p where p.id = v_patient_id;

  foreach v_code in array v_test_codes loop
    if v_code = any(v_dormant) then
      continue;
    end if;

    select st.sex_applicability::text, st.age_from, st.age_to
      into v_sex_applic, v_age_from, v_age_to
    from public.screen_types st where st.code = v_code;

    if v_sex_applic is not null and v_sex_applic <> 'all' and v_sex_applic <> coalesce(v_patient_sex, '') then
      continue;
    end if;
    if v_age_from is not null and v_patient_age is not null and v_patient_age < v_age_from then
      continue;
    end if;
    if v_age_to is not null and v_patient_age is not null and v_patient_age > v_age_to then
      continue;
    end if;

    if v_code = any(v_once_per_lifetime) then
      select exists(
        select 1 from public.screening_results
        where patient_id = v_patient_id and screen_type_code = v_code
      ) into v_satisfied;
    else
      select exists(
        select 1 from public.screening_results
        where lab_order_id = p_lab_order_id and screen_type_code = v_code
      ) into v_satisfied;
    end if;

    if not v_satisfied then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function private.check_screen_order_completeness(uuid) from public;

do $$
begin
  if exists (select 1 from public.screen_types where code = 'clinical_breast_exam' and is_active) then
    raise exception 'FAIL: clinical_breast_exam should be is_active = false';
  end if;
  if not exists (select 1 from public.screen_types where code = 'breast_imaging' and is_active) then
    raise exception 'FAIL: breast_imaging should remain is_active = true';
  end if;
  if pg_get_functiondef('private.check_screen_order_completeness(uuid)'::regprocedure) ilike '%breast_imaging%' then
    raise exception 'FAIL: breast_imaging should no longer be in check_screen_order_completeness''s dormant list';
  end if;
  raise notice 'PASS: breast_imaging is orderable, clinical_breast_exam is dormant';
end $$;
