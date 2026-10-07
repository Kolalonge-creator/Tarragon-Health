-- S68d: WHO z-scores done properly, and malnutrition routing (Module 16 function 16.10; CMO pack A7).
--
-- WHAT CHANGES
--   1. private.growth_lms_at(): linear INTERPOLATION between neighbouring reference rows (was: nearest row within 1.5 months).
--   2. private.growth_z(): the LMS formula, with the WHO restricted-tail adjustment (SD23) for weight-for-age, BMI-for-age,
--      weight-for-length and weight-for-height only, exactly as the WHO igrowup and 2007 macros do. Height, head and MUAC z-scores are plain LMS.
--   3. private.growth_z_age(): picks the WHO 2006 standard (to day 1856) or the 2007 reference (from month 61) by age.
--   4. private.stamp_growth_measurement(): length versus height (0.7 cm, recumbent to day 730, standing after), weight-for-length/height,
--      MUAC-for-age, plausibility flags, reference_version, who recorded it. Runs on insert and when a measurement value is corrected.
--   5. private.classify_nutrition() and the AFTER INSERT router: severe acute malnutrition is RED and paged, moderate is amber, stunting and
--      underweight are informational. Every number comes from growth.nutrition_routing (PROPOSED, NOT SIGNED). The alert is raised only when
--      the maternal_enabled go-live guard is on, or the child is a test account (S37 test rule); the class is stored either way.
--   6. child.growth_recorded (and child.nutrition_flagged when routed) go through the outbox.
-- Live state read 2026-10-07: child_growth_measurements has 0 rows, growth_reference_lms had 0 rows (loaded by S68c). Nothing to convert.
--
-- INV-01: all deterministic SQL, no model. INV-16: reference_version and nutrition_config_version are written on the row.
-- INV-07: the clinician page uses the existing template and the words "child growth check"; no reading or condition is named.
-- Implausible values (WHO flag ranges, growth.plausibility) are KEPT and STILL ROUTED: a data-entry slip costs a clinician a look, a missed child
-- costs far more. The alert text says to check the measurement.

-- ---------------------------------------------------------------------------
-- Versioned configuration (PROPOSED, not signed). Mirrored in packages/shared/src/proposed-config/registry.ts.
-- ---------------------------------------------------------------------------
-- s68-config-growth.reference_versions-begin
insert into public.maternal_child_config (config_key, version, is_active, status, effective_from, rules, source_note) values
('growth.reference_versions', 1, true, 'proposed', '2026-10-07', $json${"under5_version":"who-2006-v1","over5_version":"who-2007-v1","under5_max_age_days":1856,"wfh_max_age_days":1826,"recumbent_until_age_days":730,"length_height_correction_cm":0.7}$json$::jsonb,
 'WHO 2006 standards to day 1856, WHO 2007 reference from month 61; weight-for-height to 60 months (1826 days); recumbent length to 730 days; 0.7 cm length/height difference (WHO igrowup). CMO pack A7.');
-- s68-config-growth.reference_versions-end
-- s68-config-growth.plausibility-begin
insert into public.maternal_child_config (config_key, version, is_active, status, effective_from, rules, source_note) values
('growth.plausibility', 1, true, 'proposed', '2026-10-07', $json${"weight_for_age_z":[-6,5],"height_for_age_z":[-6,6],"weight_for_height_z":[-5,5],"bmi_for_age_z":[-5,5],"head_circumference_for_age_z":[-5,5],"muac_for_age_z":[-5,5]}$json$::jsonb,
 'WHO biologically implausible z-score ranges. Weight-for-age, height-for-age, weight-for-height and BMI-for-age follow the WHO Anthro documentation; head circumference and MUAC use +-5 as an assumption for the CMO to confirm (OQ-353).');
-- s68-config-growth.plausibility-end
-- s68-config-growth.nutrition_routing-begin
insert into public.maternal_child_config (config_key, version, is_active, status, effective_from, rules, source_note) values
('growth.nutrition_routing', 1, true, 'proposed', '2026-10-07', $json${"sam_muac_mm_lt":115,"sam_wfh_z_lt":-3,"sam_oedema":true,"sam_review_within_hours":12,"mam_muac_mm_lt":125,"mam_wfh_z_lt":-2,"mam_review_within_days":3,"muac_min_age_months":6,"muac_max_age_months":60,"stunting_hfa_z_lt":-2,"underweight_wfa_z_lt":-2}$json$::jsonb,
 'CMO pack A7 (selected, NOT signed): severe = MUAC under 115 mm, or weight-for-height z below -3, or bilateral oedema (red, same-day, 12 hours here); moderate = MUAC 115 to under 125 mm or z -3 to under -2 (amber, within 3 days); stunting and underweight informational. The pack names no MUAC age range: 6 to 59 months is the WHO/UNICEF range for these cut-offs and is a proposal (OQ-351).');
-- s68-config-growth.nutrition_routing-end

-- ---------------------------------------------------------------------------
-- 1 and 2. Interpolating lookup and the LMS formula
-- ---------------------------------------------------------------------------
create or replace function private.growth_lms_at(
  p_version text, p_sex public.sex, p_type public.growth_measurement_type, p_unit text, p_x numeric)
returns table (l numeric, m numeric, s numeric)
language sql stable security definer set search_path = '' as $$
  with lo as (
    select index_value, l_value, m_value, s_value from public.growth_reference_lms
     where reference_version = p_version and sex = p_sex and measurement_type = p_type and index_unit = p_unit and index_value <= p_x
     order by index_value desc limit 1),
  hi as (
    select index_value, l_value, m_value, s_value from public.growth_reference_lms
     where reference_version = p_version and sex = p_sex and measurement_type = p_type and index_unit = p_unit and index_value >= p_x
     order by index_value asc limit 1)
  select case when hi.index_value = lo.index_value then lo.l_value else lo.l_value + (hi.l_value - lo.l_value) * (p_x - lo.index_value) / (hi.index_value - lo.index_value) end,
         case when hi.index_value = lo.index_value then lo.m_value else lo.m_value + (hi.m_value - lo.m_value) * (p_x - lo.index_value) / (hi.index_value - lo.index_value) end,
         case when hi.index_value = lo.index_value then lo.s_value else lo.s_value + (hi.s_value - lo.s_value) * (p_x - lo.index_value) / (hi.index_value - lo.index_value) end
    from lo, hi
$$;

create or replace function private.growth_z(p_l numeric, p_m numeric, p_s numeric, p_y numeric, p_sd23 boolean)
returns numeric language plpgsql immutable set search_path = '' as $$
declare
  l double precision := p_l; m double precision := p_m; s double precision := p_s; y double precision := p_y;
  z double precision; sd3 double precision; sd2 double precision;
begin
  if y is null or y <= 0 or m <= 0 or s <= 0 then return null; end if;
  if abs(l) < 1e-10 then z := ln(y / m) / s; else z := (power(y / m, l) - 1) / (l * s); end if;
  if p_sd23 and abs(z) > 3 then
    if z > 3 then
      if abs(l) < 1e-10 then sd3 := m * exp(s * 3); sd2 := m * exp(s * 2); else sd3 := m * power(1 + l * s * 3, 1 / l); sd2 := m * power(1 + l * s * 2, 1 / l); end if;
      z := 3 + (y - sd3) / (sd3 - sd2);
    else
      if abs(l) < 1e-10 then sd3 := m * exp(-s * 3); sd2 := m * exp(-s * 2); else sd3 := m * power(1 - l * s * 3, 1 / l); sd2 := m * power(1 - l * s * 2, 1 / l); end if;
      z := -3 + (y - sd3) / (sd2 - sd3);
    end if;
  end if;
  return z::numeric;
end $$;

-- ---------------------------------------------------------------------------
-- 3. By age: 2006 standard to day 1856, 2007 reference after
-- ---------------------------------------------------------------------------
create or replace function private.growth_z_age(p_sex public.sex, p_type public.growth_measurement_type, p_age_days integer, p_value numeric)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb := private.maternal_child_rules('growth.reference_versions');
  r record;
  v_sd23 boolean := p_type in ('weight_for_age', 'bmi_for_age');
begin
  if c is null or p_value is null or p_age_days is null or p_age_days < 0 then return null; end if;
  if p_age_days <= (c ->> 'under5_max_age_days')::integer then
    select * into r from private.growth_lms_at(c ->> 'under5_version', p_sex, p_type, 'age_days', p_age_days);
  else
    if p_type not in ('weight_for_age', 'height_for_age', 'bmi_for_age') then return null; end if;
    select * into r from private.growth_lms_at(c ->> 'over5_version', p_sex, p_type, 'age_months', p_age_days / 30.4375);
  end if;
  if r.m is null then return null; end if;
  return private.growth_z(r.l, r.m, r.s, p_value, v_sd23);
end $$;

-- The old entry point (nearest row within 1.5 months) keeps its signature and now delegates; nothing else called it.
create or replace function private.growth_z_score(p_sex public.sex, p_measurement_type public.growth_measurement_type, p_age_months numeric, p_value numeric)
returns numeric language sql stable security definer set search_path = '' as $$
  select private.growth_z_age(p_sex, p_measurement_type, round(p_age_months * 30.4375)::integer, p_value)
$$;

-- Weight for length (recumbent, to 730 days) or weight for height (standing, after), 2006 standard only.
create or replace function private.growth_z_weight_for_length(p_sex public.sex, p_age_days integer, p_length_cm numeric, p_weight_kg numeric)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb := private.maternal_child_rules('growth.reference_versions');
  r record;
  v_type public.growth_measurement_type;
  v_unit text;
begin
  if c is null or p_length_cm is null or p_weight_kg is null or p_age_days is null or p_age_days < 0 or p_age_days > (c ->> 'wfh_max_age_days')::integer then return null; end if;
  if p_age_days <= (c ->> 'recumbent_until_age_days')::integer then v_type := 'weight_for_length'; v_unit := 'length_cm'; else v_type := 'weight_for_height'; v_unit := 'height_cm'; end if;
  select * into r from private.growth_lms_at(c ->> 'under5_version', p_sex, v_type, v_unit, p_length_cm);
  if r.m is null then return null; end if;
  return private.growth_z(r.l, r.m, r.s, p_weight_kg, true);
end $$;

-- ---------------------------------------------------------------------------
-- 5a. The deterministic classification (pure; the router and the proof both call it)
-- ---------------------------------------------------------------------------
create or replace function private.classify_nutrition(p_age_days integer, p_muac_mm numeric, p_wfh_z numeric, p_oedema boolean, p_rules jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_months numeric := p_age_days / 30.4375;
  v_muac_ok boolean;
begin
  if p_rules is null or p_age_days is null then return null; end if;
  v_muac_ok := p_muac_mm is not null
    and v_months >= (p_rules ->> 'muac_min_age_months')::numeric and v_months < (p_rules ->> 'muac_max_age_months')::numeric;
  if (coalesce(p_oedema, false) and coalesce((p_rules ->> 'sam_oedema')::boolean, false))
     or (v_muac_ok and p_muac_mm < (p_rules ->> 'sam_muac_mm_lt')::numeric)
     or (p_wfh_z is not null and p_wfh_z < (p_rules ->> 'sam_wfh_z_lt')::numeric) then
    return 'severe_acute';
  end if;
  if (v_muac_ok and p_muac_mm < (p_rules ->> 'mam_muac_mm_lt')::numeric)
     or (p_wfh_z is not null and p_wfh_z < (p_rules ->> 'mam_wfh_z_lt')::numeric) then
    return 'moderate_acute';
  end if;
  return 'none';
end $$;

-- ---------------------------------------------------------------------------
-- 4. The stamping trigger
-- ---------------------------------------------------------------------------
create or replace function private.stamp_growth_measurement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_dob date; v_sex public.sex;
  c jsonb := private.maternal_child_rules('growth.reference_versions');
  pl jsonb := private.maternal_child_rules('growth.plausibility');
  v_uid uuid := (select auth.uid());
  v_age integer; v_len numeric; v_bmi_adj numeric; v_corr numeric; v_flags text[] := '{}';
  k text; rng jsonb; z numeric;
begin
  select date_of_birth, sex into v_dob, v_sex from public.profiles where id = new.patient_id;
  if v_dob is null then
    raise exception 'Cannot record a growth measurement: % has no date of birth on file.', new.patient_id using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' or new.measured_at is distinct from old.measured_at then
    new.age_days_at_measurement := (new.measured_at::date - v_dob);
  else
    new.age_days_at_measurement := old.age_days_at_measurement;
  end if;
  v_age := new.age_days_at_measurement;
  if v_age < 0 then
    raise exception 'Cannot record a growth measurement before the date of birth.' using errcode = 'check_violation';
  end if;

  -- length versus height: the table basis is recumbent up to day 730 and standing after; WHO adds or removes 0.7 cm for the other way round
  v_len := new.height_cm;
  if v_len is not null and new.measure_position is not null and c is not null then
    v_corr := (c ->> 'length_height_correction_cm')::numeric;
    if v_age <= (c ->> 'recumbent_until_age_days')::integer and new.measure_position = 'standing' then v_len := v_len + v_corr;
    elsif v_age > (c ->> 'recumbent_until_age_days')::integer and new.measure_position = 'recumbent' then v_len := v_len - v_corr;
    end if;
  end if;

  if new.height_cm is not null and new.weight_kg is not null then
    new.bmi := round(new.weight_kg / power(new.height_cm / 100, 2), 2);
    v_bmi_adj := new.weight_kg / power(v_len / 100, 2);
  else
    new.bmi := null;
  end if;

  new.weight_for_age_z := null; new.height_for_age_z := null; new.bmi_for_age_z := null;
  new.head_circumference_for_age_z := null; new.weight_for_height_z := null; new.muac_for_age_z := null;
  new.reference_version := null;
  if v_sex is not null and c is not null then
    new.weight_for_age_z := private.growth_z_age(v_sex, 'weight_for_age', v_age, new.weight_kg);
    new.height_for_age_z := private.growth_z_age(v_sex, 'height_for_age', v_age, v_len);
    new.bmi_for_age_z := private.growth_z_age(v_sex, 'bmi_for_age', v_age, v_bmi_adj);
    new.head_circumference_for_age_z := private.growth_z_age(v_sex, 'head_circumference_for_age', v_age, new.head_circumference_cm);
    new.muac_for_age_z := private.growth_z_age(v_sex, 'muac_for_age', v_age, new.muac_mm / 10);
    new.weight_for_height_z := private.growth_z_weight_for_length(v_sex, v_age, v_len, new.weight_kg);
    if new.weight_for_age_z is not null or new.height_for_age_z is not null or new.bmi_for_age_z is not null
       or new.head_circumference_for_age_z is not null or new.muac_for_age_z is not null or new.weight_for_height_z is not null then
      new.reference_version := case when v_age <= (c ->> 'under5_max_age_days')::integer then c ->> 'under5_version' else c ->> 'over5_version' end;
    end if;
  end if;

  -- numeric(5,2) can not hold an absurd z; clamp and flag it rather than fail the insert
  if abs(coalesce(new.weight_for_age_z, 0)) >= 1000 or abs(coalesce(new.height_for_age_z, 0)) >= 1000 or abs(coalesce(new.bmi_for_age_z, 0)) >= 1000
     or abs(coalesce(new.weight_for_height_z, 0)) >= 1000 or abs(coalesce(new.head_circumference_for_age_z, 0)) >= 1000 or abs(coalesce(new.muac_for_age_z, 0)) >= 1000 then
    v_flags := v_flags || 'z_out_of_numeric_range';
    new.weight_for_age_z := least(greatest(new.weight_for_age_z, -999), 999);
    new.height_for_age_z := least(greatest(new.height_for_age_z, -999), 999);
    new.bmi_for_age_z := least(greatest(new.bmi_for_age_z, -999), 999);
    new.weight_for_height_z := least(greatest(new.weight_for_height_z, -999), 999);
    new.head_circumference_for_age_z := least(greatest(new.head_circumference_for_age_z, -999), 999);
    new.muac_for_age_z := least(greatest(new.muac_for_age_z, -999), 999);
  end if;

  if pl is not null then
    foreach k in array array['weight_for_age_z', 'height_for_age_z', 'weight_for_height_z', 'bmi_for_age_z', 'head_circumference_for_age_z', 'muac_for_age_z'] loop
      z := (to_jsonb(new) ->> k)::numeric;
      rng := pl -> k;
      if z is not null and rng is not null and (z < (rng ->> 0)::numeric or z > (rng ->> 1)::numeric) then v_flags := v_flags || (k || '_implausible'); end if;
    end loop;
  end if;
  new.plausibility_flags := v_flags;

  -- who recorded it (forge-proof: derived here, never taken from the client; a service-role insert keeps what the server passed)
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.recorded_by := v_uid;
      if v_uid = new.patient_id then new.source := 'patient_entered'; new.logged_by_profile_id := null;
      elsif private.is_org_staff(new.organisation_id) then new.source := 'clinician_recorded'; new.logged_by_profile_id := v_uid;
      else new.source := 'caregiver_entered'; new.logged_by_profile_id := v_uid;
      end if;
    end if;
  else
    new.source := old.source; new.recorded_by := old.recorded_by; new.logged_by_profile_id := old.logged_by_profile_id;
  end if;
  return new;
end $$;

drop trigger if exists child_growth_measurements_stamp on public.child_growth_measurements;
create trigger child_growth_measurements_stamp
  before insert or update of measured_at, height_cm, weight_kg, head_circumference_cm, muac_mm, measure_position on public.child_growth_measurements
  for each row execute function private.stamp_growth_measurement();

-- ---------------------------------------------------------------------------
-- 5b. The router (AFTER INSERT): classify, store the class, raise the alert, page for severe, emit the events
-- ---------------------------------------------------------------------------
create or replace function private.route_child_nutrition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rules jsonb := private.maternal_child_rules('growth.nutrition_routing');
  v_ver integer := private.maternal_child_config_version('growth.nutrition_routing');
  v_class text;
  v_open boolean;
  v_alert uuid; v_level public.alert_level; v_label text; v_sla interval; v_title text; v_detail text; v_check text := '';
  r public.profiles%rowtype;
  v_test boolean;
begin
  perform private.emit_domain_event('child.growth_recorded', new.organisation_id,
    jsonb_build_object('measurement_id', new.id, 'reference_version', coalesce(new.reference_version, 'none')),
    'child.growth_recorded:' || new.id, new.patient_id, 'child_growth_measurements', new.id);

  v_class := private.classify_nutrition(new.age_days_at_measurement, new.muac_mm, new.weight_for_height_z, new.bilateral_oedema, rules);
  if v_class is null then return new; end if;
  update public.child_growth_measurements set nutrition_class = v_class, nutrition_config_version = v_ver where id = new.id;
  if v_class = 'none' then return new; end if;

  select coalesce(is_test, false) into v_test from public.profiles where id = new.patient_id;
  v_open := private.go_live_open_patient('maternal_enabled', new.patient_id);
  if not v_open then return new; end if;

  if exists (select 1 from public.clinician_alerts a
             where a.patient_id = new.patient_id and a.status = 'open' and a.title like 'Child growth check%'
               and a.created_at > now() - interval '24 hours'
               and (v_class = 'moderate_acute' or a.title like '%same-day%')) then
    return new;
  end if;

  if cardinality(new.plausibility_flags) > 0 then v_check := ' One value looks implausible: please check the measurement first.'; end if;
  if v_class = 'severe_acute' then
    v_level := 'urgent_escalation'; v_label := 'Priority 1';
    v_sla := ((rules ->> 'sam_review_within_hours')::integer) * interval '1 hour';
    v_title := 'Child growth check: same-day review';
  else
    v_level := 'clinician_review'; v_label := 'Review needed';
    v_sla := ((rules ->> 'mam_review_within_days')::integer) * interval '1 day';
    v_title := 'Child growth check: review within days';
  end if;
  v_detail := format('Acute malnutrition rule (config version %s): %s. MUAC %s mm, weight-for-height z %s, bilateral oedema %s.%s Screening rule only, not a diagnosis: a clinician reviews and decides.',
    v_ver, replace(v_class, '_', ' '), coalesce(new.muac_mm::text, 'not measured'), coalesce(new.weight_for_height_z::text, 'not available'), new.bilateral_oedema, v_check);
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, sla_due_at)
  values (new.organisation_id, new.patient_id, v_level, 'open', v_title, v_detail, now() + v_sla) returning id into v_alert;
  update public.child_growth_measurements set nutrition_alert_id = v_alert where id = new.id;

  perform private.emit_domain_event('child.nutrition_flagged', new.organisation_id,
    jsonb_build_object('measurement_id', new.id, 'class', v_class, 'config_version', v_ver),
    'child.nutrition_flagged:' || new.id, new.patient_id, 'child_growth_measurements', new.id,
    case when v_class = 'severe_acute' then 'urgent' else 'normal' end);

  if v_class = 'severe_acute' then
    -- INV-05: a red event is pushed to clinicians, not left to be pulled. A test child pages test clinicians only.
    for r in select * from public.profiles where organisation_id = new.organisation_id and role = 'clinician' and coalesce(is_test, false) = v_test loop
      perform private.enqueue_critical_notification(new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object('patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
                           'vital_label', 'child growth check', 'level_label', v_label),
        'symptom_red_flag', v_level, 'clinician_alerts', v_alert);
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists child_growth_measurements_nutrition_route on public.child_growth_measurements;
create trigger child_growth_measurements_nutrition_route
  after insert on public.child_growth_measurements
  for each row execute function private.route_child_nutrition();

-- Execute rights: these write or read configuration, none is a patient-facing call.
revoke all on function private.route_child_nutrition() from public, anon, authenticated;
revoke all on function private.stamp_growth_measurement() from public, anon, authenticated;
revoke all on function private.growth_lms_at(text, public.sex, public.growth_measurement_type, text, numeric) from public, anon;
revoke all on function private.growth_z(numeric, numeric, numeric, numeric, boolean) from public, anon;
revoke all on function private.growth_z_age(public.sex, public.growth_measurement_type, integer, numeric) from public, anon;
revoke all on function private.growth_z_score(public.sex, public.growth_measurement_type, numeric, numeric) from public, anon;
revoke all on function private.growth_z_weight_for_length(public.sex, integer, numeric, numeric) from public, anon;
revoke all on function private.classify_nutrition(integer, numeric, numeric, boolean, jsonb) from public, anon;

do $$ begin
  if private.classify_nutrition(365, 110, 0, false, private.maternal_child_rules('growth.nutrition_routing')) is distinct from 'severe_acute' then raise exception 'S68d self-check: MUAC 110 mm at 12 months must be severe'; end if;
  if private.classify_nutrition(365, 120, 0, false, private.maternal_child_rules('growth.nutrition_routing')) is distinct from 'moderate_acute' then raise exception 'S68d self-check: MUAC 120 mm must be moderate'; end if;
  if private.classify_nutrition(365, 130, -1, false, private.maternal_child_rules('growth.nutrition_routing')) is distinct from 'none' then raise exception 'S68d self-check: a well child must be none'; end if;
  if private.growth_z_age('male', 'weight_for_age', 0, 3.3464) is null or abs(private.growth_z_age('male', 'weight_for_age', 0, 3.3464)) > 0.001 then
    raise exception 'S68d self-check: the median birth weight of a boy must be z = 0 (is the WHO data loaded?)'; end if;
end $$;
