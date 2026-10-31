-- Tarragon Health: an alert always gets an owner, and an alert left without one is picked up later (2026-10-31)
--
-- Found 2026-10-30: five open clinician alerts had no responsible clinician, one of them 34 days. Two causes:
--  1. private.classify_and_assign_clinician_alert() picks an owner only when the alert is inserted, and only from the alert type's
--     owner tier. When nobody active holds that tier the alert stays unowned for ever: every overdue_task alert (18 so far, owner tier
--     care_coordinator, none employed) and three symptom alerts raised before the first senior doctor was added.
--  2. Nothing ever looks again. A referral waiting for a specialist is swept when one is activated; an alert is not.
--
-- This migration:
--  * private.pick_alert_owner(org, owner tier, backup tier, senior tier): the least-loaded active member of the first tier that has
--    anyone, in the order owner, backup, senior, then Chief Medical Officer. The Chief Medical Officer is the last resort, so an
--    alert never waits with nobody.
--  * the insert trigger uses it for the owner (the backup choice is unchanged). Redefined from the LIVE body (2026-10-30).
--  * private.assign_unowned_clinician_alerts(): gives every open, unowned alert an owner the same way. Returns how many it assigned.
--    Scheduled every 15 minutes as clinician-alert-owner-sweep. It is not run here, so applying this migration moves no alert.
--  * private.enforce_clinician_alert_reassignment_authority(): a caller with no signed-in user (the database's own scheduled jobs) is
--    the system, not someone reassigning, so it is let through. Every signed-in user is still held to the existing rule: only the
--    Chief Medical Officer may assign to someone else. The proof checks both.
--
-- Not changed: leave and availability are still not consulted when choosing an owner here (the escalation trigger does).

create or replace function private.pick_alert_owner(
  p_org uuid, p_owner_tier public.doctor_tier, p_backup_tier public.doctor_tier, p_senior_tier public.doctor_tier
) returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_tier public.doctor_tier;
  v_id uuid;
begin
  foreach v_tier in array array[p_owner_tier, p_backup_tier, p_senior_tier, 'chief_medical_officer'::public.doctor_tier] loop
    continue when v_tier is null;
    select cs.id into v_id
    from public.clinical_staff cs
    left join public.clinician_alerts ca
      on ca.responsible_clinician_id = cs.id and ca.status in ('open', 'acknowledged')
    where cs.organisation_id = p_org
      and cs.active
      and cs.doctor_tier = v_tier
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

revoke all on function private.pick_alert_owner(uuid, public.doctor_tier, public.doctor_tier, public.doctor_tier) from public, anon, authenticated;

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
      select cs.id into new.backup_clinician_id
      from public.clinical_staff cs
      left join public.clinician_alerts ca
        on ca.backup_clinician_id = cs.id and ca.status in ('open', 'acknowledged')
      where cs.organisation_id = new.organisation_id
        and cs.active
        and cs.doctor_tier = v_backup_tier
        and cs.id is distinct from new.responsible_clinician_id
      group by cs.id, cs.created_at
      order by count(ca.id) asc, cs.created_at asc
      limit 1;
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

create or replace function private.enforce_clinician_alert_reassignment_authority()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  -- No signed-in user: the database's own scheduled work (private.assign_unowned_clinician_alerts), not a person reassigning.
  if (select auth.uid()) is null then
    return new;
  end if;
  if (
       new.responsible_clinician_id is distinct from old.responsible_clinician_id
       and new.responsible_clinician_id is not null
       and new.responsible_clinician_id not in (
         select id from public.clinical_staff where profile_id = (select auth.uid())
       )
     )
     or (
       new.backup_clinician_id is distinct from old.backup_clinician_id
       and new.backup_clinician_id is not null
       and new.backup_clinician_id not in (
         select id from public.clinical_staff where profile_id = (select auth.uid())
       )
     )
  then
    if not exists (
      select 1 from public.clinical_staff
      where profile_id = (select auth.uid())
        and organisation_id = new.organisation_id
        and active
        and doctor_tier = 'chief_medical_officer'
    ) then
      raise exception 'Only the Chief Medical Officer / Clinical Director can assign this alert to someone else. Claim it for yourself instead.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function private.assign_unowned_clinician_alerts()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
  v_rule jsonb;
  v_owner uuid;
  v_n integer := 0;
begin
  for r in
    select ca.id, ca.organisation_id, ca.type_code
    from public.clinician_alerts ca
    where ca.status = 'open'
      and ca.responsible_clinician_id is null
  loop
    v_rule := private.alert_rule_config(r.type_code);
    continue when v_rule is null or nullif(v_rule->>'owner_tier', '') is null;

    v_owner := private.pick_alert_owner(
      r.organisation_id,
      nullif(v_rule->>'owner_tier', '')::public.doctor_tier,
      nullif(v_rule->>'backup_tier', '')::public.doctor_tier,
      nullif(v_rule->>'senior_tier', '')::public.doctor_tier);
    continue when v_owner is null;

    update public.clinician_alerts
       set responsible_clinician_id = v_owner, assigned_at = now()
     where id = r.id and status = 'open' and responsible_clinician_id is null;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$function$;

revoke all on function private.assign_unowned_clinician_alerts() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'clinician-alert-owner-sweep') then
    perform cron.unschedule('clinician-alert-owner-sweep');
  end if;
end $$;

select cron.schedule('clinician-alert-owner-sweep', '*/15 * * * *', $$ select private.assign_unowned_clinician_alerts(); $$);

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'clinician-alert-owner-sweep') then
    raise exception 'clinician-alert-owner-sweep cron job was not scheduled';
  end if;
  if has_function_privilege('anon', 'private.assign_unowned_clinician_alerts()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.assign_unowned_clinician_alerts()', 'EXECUTE')
     or has_function_privilege('anon', 'private.pick_alert_owner(uuid, public.doctor_tier, public.doctor_tier, public.doctor_tier)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.pick_alert_owner(uuid, public.doctor_tier, public.doctor_tier, public.doctor_tier)', 'EXECUTE') then
    raise exception 'the owner sweep or the owner picker is executable by anon or authenticated';
  end if;
end $$;
