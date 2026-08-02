-- Fix found live-testing: check_screen_order_completeness required a result
-- for EVERY code in the panel_bundle's test_codes regardless of the
-- patient's sex/age, which would have permanently blocked a female
-- patient's Comprehensive Screen order on 'psa' -- a code she is
-- structurally forbidden from ever having recorded
-- (private.enforce_psa_sdm_gate: "PSA screening_results are male-only").
-- Now skips a code that doesn't apply to the patient's sex/age, mirroring
-- screen_types.sex_applicability/age_from/age_to the same way the rest of
-- the screening-eligibility engine already reads them. A null date_of_birth
-- never excludes a code on age grounds (same "age-gated included when DOB
-- unknown" convention as private.open_annual_review).
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
  v_dormant text[] := array['abdominal_ultrasound', 'breast_imaging', 'prostate_ultrasound', 'echo'];
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
