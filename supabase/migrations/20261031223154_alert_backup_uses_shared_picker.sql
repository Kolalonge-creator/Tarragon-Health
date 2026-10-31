-- Tarragon Health: one picker for an alert's owner and its backup (2026-10-31)
--
-- /code-review high on 20261031002624 found the backup-clinician lookup inside private.classify_and_assign_clinician_alert()
-- was a second, hand-copied version of the load-balanced picker private.pick_alert_owner() already holds. Two copies drift: a rule
-- fixed in one (skip on-leave doctors, volatile load counting) would silently not reach the other.
--
-- private.pick_alert_clinician(org, tiers, as_backup, exclude) is the one picker. It walks the tiers in order and returns the
-- least-loaded active clinician at the first tier that has anyone, counting open or acknowledged alerts on responsible_clinician_id
-- (an owner) or backup_clinician_id (a backup), and never returns p_exclude. private.pick_alert_owner() keeps its signature and
-- becomes a wrapper (the sweep and the trigger call it), so no call site changes. The trigger's backup branch now calls the picker
-- with the backup tier only and the owner excluded: the same result as before, from one body.
--
-- Redefined from the LIVE bodies of private.classify_and_assign_clinician_alert() and private.pick_alert_owner() (read with
-- pg_get_functiondef on 2026-10-31, after 20261031210317).

create or replace function private.pick_alert_clinician(
  p_org uuid, p_tiers public.doctor_tier[], p_as_backup boolean, p_exclude uuid
) returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_tier public.doctor_tier;
  v_id uuid;
begin
  foreach v_tier in array p_tiers loop
    continue when v_tier is null;
    select cs.id into v_id
    from public.clinical_staff cs
    left join public.clinician_alerts ca
      on ca.status in ('open', 'acknowledged')
     and ((not p_as_backup and ca.responsible_clinician_id = cs.id)
          or (p_as_backup and ca.backup_clinician_id = cs.id))
    where cs.organisation_id = p_org
      and cs.active
      and cs.doctor_tier = v_tier
      and cs.id is distinct from p_exclude
    group by cs.id, cs.created_at
    order by count(ca.id) asc, cs.created_at asc
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end loop;
  return null;
end;
$function$;

revoke all on function private.pick_alert_clinician(uuid, public.doctor_tier[], boolean, uuid) from public, anon, authenticated;

create or replace function private.pick_alert_owner(
  p_org uuid, p_owner_tier public.doctor_tier, p_backup_tier public.doctor_tier, p_senior_tier public.doctor_tier
) returns uuid
language sql
volatile
security definer
set search_path to ''
as $function$
  select private.pick_alert_clinician(
    p_org,
    array[p_owner_tier, p_backup_tier, p_senior_tier, 'chief_medical_officer'::public.doctor_tier],
    false,
    null
  );
$function$;

create or replace function private.classify_and_assign_clinician_alert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_effective_level public.alert_level;
  v_rule jsonb;
  v_owner_tier public.doctor_tier;
  v_backup_tier public.doctor_tier;
  v_senior_tier public.doctor_tier;
  v_dupe_id uuid;
  v_dupe_created_at timestamptz;
begin
  v_effective_level := coalesce(new.override_level, new.level);

  new.severity := case v_effective_level
    when 'emergency' then 4
    when 'urgent_escalation' then 3
    when 'clinician_review' then 2
    when 'routine' then 1
  end;

  if new.type_code is null then
    new.type_code := case
      when new.screening_result_id is not null then 'abnormal_result'
      when new.vital_reading_id is not null then 'abnormal_monitoring'
      when new.title ilike 'priority%: emergency reported%' then 'symptom_escalation'
      when new.title ilike '%diabetic foot%' then 'symptom_escalation'
      when new.title ilike '%eating-disorder%' or new.title ilike '%mental-health screen%' then 'symptom_escalation'
      when new.title ilike 'lifestyle red flag%' then 'deterioration'
      when new.title ilike '%glucose logs%' or new.title ilike '%blood-pressure readings%' then 'overdue_monitoring'
      else 'abnormal_result'
    end::public.alert_type_code;
  end if;

  if new.category is null then
    new.category := case new.type_code
      when 'missed_appointment' then 'care_management'
      when 'overdue_task' then 'care_management'
      when 'overdue_monitoring' then 'care_management'
      when 'failed_referral' then 'care_management'
      when 'adherence_problem' then 'medication'
      when 'refill_due' then 'medication'
      when 'potential_interaction' then 'medication'
      when 'pharmacy_problem' then 'medication'
      when 'provider_unavailable' then 'operational'
      when 'appointment_failure' then 'operational'
      when 'laboratory_failure' then 'operational'
      else 'clinical'
    end::public.alert_category;
  end if;

  v_rule := private.alert_rule_config(new.type_code);
  if v_rule is not null then
    v_owner_tier := nullif(v_rule->>'owner_tier', '')::public.doctor_tier;
    v_backup_tier := nullif(v_rule->>'backup_tier', '')::public.doctor_tier;
    v_senior_tier := nullif(v_rule->>'senior_tier', '')::public.doctor_tier;

    if new.responsible_clinician_id is null and v_owner_tier is not null then
      new.responsible_clinician_id := private.pick_alert_owner(new.organisation_id, v_owner_tier, v_backup_tier, v_senior_tier);

      if new.responsible_clinician_id is not null then
        new.assigned_at := now();
      end if;
    end if;

    if new.backup_clinician_id is null and v_backup_tier is not null then
      new.backup_clinician_id := private.pick_alert_clinician(new.organisation_id, array[v_backup_tier], true, new.responsible_clinician_id);
    end if;
  end if;

  new.dedup_key := new.type_code::text || ':' || new.patient_id::text;

  select id, created_at into v_dupe_id, v_dupe_created_at
  from public.clinician_alerts
  where dedup_key = new.dedup_key
    and status in ('open', 'acknowledged')
    and created_at > now() - interval '24 hours'
  order by created_at desc
  limit 1;

  if v_dupe_id is not null then
    new.duplicate_of := v_dupe_id;
    if v_rule is not null
       and coalesce((v_rule->>'auto_suppress_duplicates')::boolean, false)
       and v_dupe_created_at > now() - (coalesce(nullif(v_rule->>'suppress_window_minutes', ''), '1440')::integer * interval '1 minute')
    then
      new.suppressed := true;
      new.suppressed_reason := 'Protocol-based duplicate suppression: same type and patient as alert ' || v_dupe_id || ' within the governed suppression window.';
    end if;
  end if;

  return new;
end;
$function$;

do $$
begin
  if pg_get_functiondef('private.classify_and_assign_clinician_alert()'::regprocedure) not like '%pick_alert_clinician%' then
    raise exception 'the trigger does not call the shared picker for the backup';
  end if;
  if has_function_privilege('anon', 'private.pick_alert_clinician(uuid, public.doctor_tier[], boolean, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.pick_alert_clinician(uuid, public.doctor_tier[], boolean, uuid)', 'EXECUTE') then
    raise exception 'the shared picker is executable by anon or authenticated';
  end if;
end $$;
