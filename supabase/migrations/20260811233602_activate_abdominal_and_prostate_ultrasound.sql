-- Founder decision 2026-08-11: abdominal_ultrasound and prostate_ultrasound
-- go live the same way breast_imaging did minutes earlier
-- (20260811222950_activate_breast_imaging_deactivate_clinical_breast_exam.sql)
-- -- self-arranged, same as fit/mammography/colonoscopy: the patient takes
-- the order to any imaging facility near them, pays directly, uploads the
-- result, and a doctor interprets it and suggests next steps. Both already
-- have sensible calendar cadence (age_from/frequency_months) and are
-- already in screen_comprehensive.test_codes, exactly like breast_imaging
-- was.
--
-- echo is deliberately NOT activated here, despite being asked for in the
-- same breath -- it is a structurally different kind of item. Per its own
-- catalogue comment (20260802212103_screening_ladder_core_advanced_
-- comprehensive.sql): "Echo is conditional on ECG/BP/symptom indication,
-- not calendar-scheduled" -- it was never added to any panel_bundles.
-- test_codes, so removing it from check_screen_order_completeness's
-- dormant list would do nothing useful there.
--
-- The real risk with echo runs the other way: it is already screen_types.
-- is_active = true with frequency_months = null, and
-- computeScreeningRecommendations (apps/web/src/lib/rules/screening-
-- recommendations.ts) reads screen_types generically by age/sex/frequency
-- with no per-code branching -- a null frequency_months with no prior
-- completion hits its "one-off, recommend now" branch, so as things stand
-- today EVERY adult patient (18+, any sex) who submits a risk assessment
-- would get "Echocardiogram due" recommended immediately, with no
-- ECG/BP/symptom trigger behind it at all. That has not happened yet
-- (screening_schedules has zero rows for echo, confirmed live) only
-- because zero patients have gone through that flow so far. Flagged back
-- to the founder rather than silently building on top of a
-- mis-recommendation; echo needs a conditional trigger tied to an actual
-- abnormal ECG/BP/symptom finding before it belongs in the generic
-- calendar-screening path, not a blanket is_active flip.

update public.screen_types
  set is_active = true
where code in ('abdominal_ultrasound', 'prostate_ultrasound');

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
  v_dormant text[] := array['echo'];
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
  if not exists (select 1 from public.screen_types where code = 'abdominal_ultrasound' and is_active) then
    raise exception 'FAIL: abdominal_ultrasound should be is_active = true';
  end if;
  if not exists (select 1 from public.screen_types where code = 'prostate_ultrasound' and is_active) then
    raise exception 'FAIL: prostate_ultrasound should be is_active = true';
  end if;
  if pg_get_functiondef('private.check_screen_order_completeness(uuid)'::regprocedure) ilike '%abdominal_ultrasound%'
     or pg_get_functiondef('private.check_screen_order_completeness(uuid)'::regprocedure) ilike '%prostate_ultrasound%' then
    raise exception 'FAIL: abdominal_ultrasound/prostate_ultrasound should no longer be in the dormant list';
  end if;
  raise notice 'PASS: abdominal_ultrasound and prostate_ultrasound are orderable, echo stays dormant';
end $$;
