-- Tarragon Health — Hypertension pathway Sprint D
-- H10 secondary-HTN flags, H11 pregnancy red-route, H14 panel fix, H16 KPIs.
-- TH-CP-HTN-001 §7.3, §8.1, §14.5, §18.1, §22.

-- ===========================================================================
-- H14  Fix the Hypertension Panel bundle (§8.1 [LOCALISE])
-- The bundle's description claimed "U&E, eGFR, urine ACR, lipids, HbA1c" but
-- its test_codes were only [lipid_panel, hba1c]. Add the missing tests to the
-- catalogue (per active provider that already offers a lipid panel; placeholder
-- price [LOCALISE]) and correct the bundle contents + description.
-- ===========================================================================
insert into public.lab_tests (provider_id, code, name, price_kobo, is_active)
select lt.provider_id, v.code, v.name, v.price_kobo, true
from (select distinct provider_id from public.lab_tests where code = 'lipid_panel') lt
cross join (values
  ('renal_panel', 'Urea, Electrolytes, Creatinine & eGFR (U&E)', 800000::bigint),
  ('urinalysis',  'Urinalysis (dipstick: protein, blood, glucose)', 300000::bigint),
  ('urine_acr',   'Urine Albumin-to-Creatinine Ratio (ACR)', 500000::bigint)
) as v(code, name, price_kobo)
where not exists (
  select 1 from public.lab_tests x where x.provider_id = lt.provider_id and x.code = v.code
);

update public.panel_bundles
  set test_codes = array['renal_panel','lipid_panel','hba1c','urinalysis','urine_acr'],
      description = 'BP work-up: U&E/eGFR, electrolytes, lipids, HbA1c, urinalysis and urine ACR. Add a 12-lead ECG at baseline (recorded separately).'
where code = 'hypertension_panel';

-- ===========================================================================
-- H11  Pregnancy red-route (§18.1, guarantee 4)
-- ===========================================================================
alter table public.profiles
  add column if not exists is_pregnant boolean not null default false;

comment on column public.profiles.is_pregnant is
  'Pregnancy flag (or up to 6 weeks postpartum). When true, raised BP is always a red route to obstetric care and ARB/ACEi/thiazide are contraindicated (TH-CP-HTN-001 §18.1).';

-- ===========================================================================
-- H10  Secondary-hypertension suspicion flags (§7.3, §14.5) — advisory
-- ===========================================================================
create or replace function private.bp_secondary_htn_flags(p_patient uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_flags text[] := '{}';
  v_age int;
  v_has_htn boolean;
  v_classes int;
  v_has_diuretic boolean;
  v_at_target boolean;
begin
  select date_part('year', age(p.date_of_birth))::int into v_age
  from public.profiles p where p.id = p_patient and p.date_of_birth is not null;

  select exists(select 1 from public.care_plans cp
    where cp.patient_id = p_patient and cp.status='active' and cp.condition='hypertension')
    into v_has_htn;

  if v_has_htn and v_age is not null and v_age < 40 then
    v_flags := array_append(v_flags, 'young_onset_under_40');
  end if;

  select count(distinct private.bp_drug_class(m.drug_name)),
         bool_or(private.bp_drug_class(m.drug_name) in ('thiazide','k_sparing'))
    into v_classes, v_has_diuretic
  from public.medications m
  where m.patient_id = p_patient and m.is_active
    and private.bp_drug_class(m.drug_name) is not null;

  select (a.avg_systolic < t.systolic and a.avg_diastolic < t.diastolic)
    into v_at_target
  from private.hbpm_average(p_patient) a, private.patient_home_bp_target(p_patient) t;

  if v_classes >= 3 and v_has_diuretic and coalesce(v_at_target, false) = false then
    v_flags := array_append(v_flags, 'resistant_htn');
  end if;

  return v_flags;
end;
$$;

create or replace function public.bp_secondary_flags(p_patient uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then return jsonb_build_object('flags', '[]'::jsonb); end if;
  if not (p_patient = (select auth.uid()) or private.is_org_staff(v_org)) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return jsonb_build_object('flags', to_jsonb(private.bp_secondary_htn_flags(p_patient)));
end;
$$;
revoke all on function public.bp_secondary_flags(uuid) from public, anon;
grant execute on function public.bp_secondary_flags(uuid) to authenticated;

-- ===========================================================================
-- H11 + H10  Fold pregnancy red-route into the BP red-flag trigger.
-- ===========================================================================
create or replace function private.handle_bp_reading_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level     text;
  v_alert_lvl public.alert_level;
  v_esc       smallint;
  v_sla       interval;
  v_title     text;
  v_detail    text;
  v_existing  public.clinician_alerts%rowtype;
  v_t_sys     smallint;
  v_t_dia     smallint;
  v_pregnant  boolean;
begin
  if new.vital_type <> 'blood_pressure' then
    return new;
  end if;

  update public.clinician_alerts
    set status = 'resolved', updated_at = now()
  where patient_id = new.patient_id
    and status = 'open'
    and title = 'Missing expected blood-pressure readings';

  v_level := private.classify_bp_level(new.systolic, new.diastolic);

  if v_level = 'green' and new.systolic is not null and new.diastolic is not null then
    select systolic, diastolic into v_t_sys, v_t_dia
    from private.patient_home_bp_target(new.patient_id);
    if new.systolic >= v_t_sys or new.diastolic >= v_t_dia then
      v_level := 'amber';
    end if;
  end if;

  select coalesce(p.is_pregnant, false) into v_pregnant from public.profiles p where p.id = new.patient_id;
  if v_pregnant and new.systolic is not null and new.diastolic is not null then
    if new.systolic >= 160 or new.diastolic >= 110 then
      v_level := 'emergency';
    elsif new.systolic >= 140 or new.diastolic >= 90 then
      if v_level not in ('emergency','red') then v_level := 'red'; end if;
    end if;
  end if;

  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('Home BP reading %s/%s mmHg logged %s.',
                     new.systolic, new.diastolic, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));
  if v_pregnant then
    v_detail := v_detail || ' PREGNANT — obstetric red route (§18.1); do not manage routinely on-platform.';
  end if;

  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id and e.source = 'bp_reading'
        and e.status = 'active' and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (new.organisation_id, new.patient_id, 'bp_reading',
        v_detail || case when v_pregnant then ' Possible pre-eclampsia — urgent obstetric care.' else ' This is in the hypertensive-crisis range.' end,
        'active', new.id);
    end if;
    return new;
  end if;

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3; v_sla := interval '1 hour';
    v_title := case when v_pregnant then 'Priority 1: raised BP in pregnancy' else 'Priority 1: high blood pressure reading' end;
    v_detail := v_detail || ' Please ask the patient to rest 5 minutes and re-check, then review same day.';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2; v_sla := interval '72 hours';
    v_title := 'Blood pressure above target';
    v_detail := v_detail || ' Above target — review adherence, technique, lifestyle and titration.';
  end if;

  select * into v_existing
  from public.clinician_alerts
  where patient_id = new.patient_id and vital_reading_id is not null and status = 'open'
  order by created_at desc limit 1;

  if v_existing.id is not null then
    if v_esc >= coalesce(v_existing.escalation_level, 0) then
      update public.clinician_alerts
        set level = v_alert_lvl, escalation_level = v_esc, title = v_title,
            detail = v_detail, sla_due_at = now() + v_sla, vital_reading_id = new.id, updated_at = now()
      where id = v_existing.id;
    end if;
  else
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level, vital_reading_id)
    values (new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
      now() + v_sla, v_esc, new.id);
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (new.organisation_id, new.patient_id, 'bp_red_flag.raised', 'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'systolic', new.systolic, 'diastolic', new.diastolic, 'pregnant', v_pregnant));

  return new;
end;
$$;

-- ===========================================================================
-- H11  Extend the prescribing block: ARB/ACEi/thiazide contraindicated in
-- pregnancy (§12.5, §18.1) — in addition to the ACEi+ARB rule.
-- ===========================================================================
create or replace function private.enforce_bp_prescribing_safety()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class text;
  v_conflict text;
  v_pregnant boolean;
begin
  if new.is_active is not true or new.source = 'patient' then
    return new;
  end if;
  v_class := private.bp_drug_class(new.drug_name);
  if v_class is null then
    return new;
  end if;

  select coalesce(p.is_pregnant, false) into v_pregnant from public.profiles p where p.id = new.patient_id;
  if v_pregnant and v_class in ('acei','arb','thiazide') then
    raise exception
      'Contraindicated in pregnancy: ACE inhibitors, ARBs and thiazides must not be used (TH-CP-HTN-001 §18.1). Route to obstetric care; use methyldopa/labetalol/nifedipine under an obstetrician.'
      using errcode = '23514';
  end if;

  if v_class in ('acei','arb') then
    v_conflict := case when v_class = 'acei' then 'arb' else 'acei' end;
    if exists (
      select 1 from public.medications m
      where m.patient_id = new.patient_id and m.is_active is true and m.id <> new.id
        and private.bp_drug_class(m.drug_name) = v_conflict
    ) then
      raise exception
        'Unsafe combination: an ACE inhibitor and an ARB must never be prescribed together (TH-CP-HTN-001 §14.4). Stop one before adding the other.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- ===========================================================================
-- H16  Hypertension clinical-audit KPIs (§22) — org-scoped RPC
-- ===========================================================================
create or replace function public.htn_quality_metrics(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total int; v_at_target int; v_with_target int;
  v_open_red int; v_open_amber int; v_emergencies_30d int; v_missing int;
begin
  if not private.is_org_staff(p_org) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  create temp table _htn_pts on commit drop as
    select distinct cp.patient_id
    from public.care_plans cp
    where cp.organisation_id = p_org and cp.status = 'active' and cp.condition = 'hypertension';

  select count(*) into v_total from _htn_pts;

  select
    count(*) filter (where a.avg_systolic is not null),
    count(*) filter (where a.avg_systolic < t.systolic and a.avg_diastolic < t.diastolic)
    into v_with_target, v_at_target
  from _htn_pts p
  left join lateral private.hbpm_average(p.patient_id) a on true
  left join lateral private.patient_home_bp_target(p.patient_id) t on true;

  select
    count(*) filter (where ca.level = 'urgent_escalation'),
    count(*) filter (where ca.level = 'clinician_review' and ca.vital_reading_id is not null)
    into v_open_red, v_open_amber
  from public.clinician_alerts ca
  join _htn_pts p on p.patient_id = ca.patient_id
  where ca.status = 'open';

  select count(*) into v_emergencies_30d
  from public.emergency_events e join _htn_pts p on p.patient_id = e.patient_id
  where e.source = 'bp_reading' and e.created_at > now() - interval '30 days';

  select count(*) into v_missing
  from public.clinician_alerts ca join _htn_pts p on p.patient_id = ca.patient_id
  where ca.status = 'open' and ca.title = 'Missing expected blood-pressure readings';

  return jsonb_build_object(
    'htn_patients', v_total,
    'with_home_average', v_with_target,
    'at_target', v_at_target,
    'control_rate_pct', case when v_with_target > 0 then round(100.0 * v_at_target / v_with_target, 1) else null end,
    'open_red_alerts', v_open_red,
    'open_amber_alerts', v_open_amber,
    'bp_emergencies_30d', v_emergencies_30d,
    'patients_missing_readings', v_missing
  );
end;
$$;
revoke all on function public.htn_quality_metrics(uuid) from public, anon;
grant execute on function public.htn_quality_metrics(uuid) to authenticated;
