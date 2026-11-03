-- Tarragon Health: a test account's case goes to the Chief Medical Officer, never to a working doctor (2026-11-03)
--
-- Founder, 2026-11-03: "A real doctor should not be triaging 'First Patient'. Put the CMO to cover it at all times; it
-- does not need to be monitored every minute, someone just needs to have oversight on it."
--
-- Live before this migration (project koiplnmbgnqnbywhpjlf): six patients are test accounts (profiles.is_test), four are
-- real. One open alert for a test patient ("Overdue care-coordination task", First Patient, raised 2026-10-03) sat on Dr
-- Isaac Longe's queue, a real senior doctor. INV-13 keeps test accounts out of every metric and payout; the staff
-- dashboards (c749647f9) keep them out of worklists and headline numbers. Nothing kept them off a doctor's queue: the
-- owner and backup pickers and the escalation router read tier and load only.
--
-- Rule, three places, one helper:
--   private.test_patient_cover(org)        the active Chief Medical Officer of the organisation (earliest created), else null.
--   private.classify_and_assign_clinician_alert()   a test patient's alert is owned by the cover, with NO backup. Oversight,
--                                           not a page: a backup is a second doctor's work and the whole point is that no
--                                           working doctor carries it.
--   private.assign_unowned_clinician_alerts()  the 15-minute sweep gives a test patient's unowned alert to the cover too.
--   private.auto_assign_escalation()        a test patient's escalation is assigned to the cover's profile.
-- An organisation with no active CMO (the synthetic canary organisation has only a canary senior doctor, itself a test
-- account) falls through to the existing pickers unchanged, so a test patient's case never sits with nobody.
--
-- Data: open or acknowledged alerts of test patients in an organisation that has a cover are moved to the cover now (one
-- expected live, the First Patient task above; the canary patient's alert stays with the canary clinician because that
-- organisation has no CMO). Open escalations of test patients likewise (none expected live). Counts are raised as notices.
--
-- Redefined from the LIVE bodies (pg_get_functiondef, 2026-11-03) of private.classify_and_assign_clinician_alert (after
-- 20261031223154), private.assign_unowned_clinician_alerts (after 20261031002624) and private.auto_assign_escalation
-- (after 20260916005747). Proof: packages/db/tests/test_patient_cases_route_to_cmo.sql.

create or replace function private.test_patient_cover(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select cs.id
  from public.clinical_staff cs
  where cs.organisation_id = p_org
    and cs.active
    and cs.doctor_tier = 'chief_medical_officer'
  order by cs.created_at asc, cs.id asc
  limit 1;
$function$;

revoke all on function private.test_patient_cover(uuid) from public, anon, authenticated;

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
  v_test_cover uuid;
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

  -- A test account's alert is the Chief Medical Officer's oversight, never a working doctor's case (2026-11-03). No
  -- backup: a backup is a second doctor's queue. An organisation without an active CMO falls through to the pickers.
  if coalesce((select pr.is_test from public.profiles pr where pr.id = new.patient_id), false) then
    v_test_cover := private.test_patient_cover(new.organisation_id);
  end if;

  if v_test_cover is not null then
    if new.responsible_clinician_id is null then
      new.responsible_clinician_id := v_test_cover;
      new.assigned_at := now();
    end if;
  elsif v_rule is not null then
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
  perform set_config('tarragon.alert_owner_sweep', 'on', true);
  for r in
    select ca.id, ca.organisation_id, ca.type_code,
           coalesce((select pr.is_test from public.profiles pr where pr.id = ca.patient_id), false) as is_test
    from public.clinician_alerts ca
    where ca.status = 'open'
      and ca.responsible_clinician_id is null
      and not ca.suppressed
  loop
    v_owner := null;
    -- A test account's alert goes to the Chief Medical Officer (2026-11-03); without one, the pickers as before.
    if r.is_test then
      v_owner := private.test_patient_cover(r.organisation_id);
    end if;

    if v_owner is null then
      v_rule := private.alert_rule_config(r.type_code);
      continue when v_rule is null or nullif(v_rule->>'owner_tier', '') is null;

      v_owner := private.pick_alert_owner(
        r.organisation_id,
        nullif(v_rule->>'owner_tier', '')::public.doctor_tier,
        nullif(v_rule->>'backup_tier', '')::public.doctor_tier,
        nullif(v_rule->>'senior_tier', '')::public.doctor_tier);
      continue when v_owner is null;
    end if;

    update public.clinician_alerts
       set responsible_clinician_id = v_owner, assigned_at = now()
     where id = r.id and status = 'open' and responsible_clinician_id is null;
    if found then
      v_n := v_n + 1;
    end if;
  end loop;
  perform set_config('tarragon.alert_owner_sweep', 'off', true);
  return v_n;
end;
$function$;

create or replace function private.auto_assign_escalation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_alert_owner_profile uuid;
  v_alert_owner_tier public.doctor_tier;
  v_needs_emergency_authority boolean;
  v_candidate_profile uuid;
begin
  -- An explicit assignment (e.g. a future admin/API path) is never overridden.
  if new.assigned_doctor_id is not null then
    return new;
  end if;

  -- A test account's escalation is the Chief Medical Officer's oversight, never a working doctor's case (2026-11-03).
  -- Checked before continuity on purpose: the linked alert of a test patient is already the cover's, and if it was
  -- raised before this rule it belongs to a working doctor who must not inherit the escalation either.
  if coalesce((select pr.is_test from public.profiles pr where pr.id = new.patient_id), false) then
    select cs.profile_id into v_candidate_profile
    from public.clinical_staff cs
    where cs.id = private.test_patient_cover(new.organisation_id)
      and cs.profile_id is not null;
    if v_candidate_profile is not null then
      new.assigned_doctor_id := v_candidate_profile;
      return new;
    end if;
  end if;

  -- Continuity first: if this escalation was raised from a clinician_alert
  -- that already has an auto-assigned owner (private.classify_and_assign_
  -- clinician_alert), keep the same doctor on it rather than re-routing --
  -- unless that owner has since gone on leave, or their tier can't clear
  -- this case's emergency bar, in which case fall through to picking a
  -- fresh doctor instead. Dropping continuity for a now-on-leave owner (not
  -- just re-checking tier) is the whole point of this migration: an
  -- already-owned alert must not keep silently routing new escalations to a
  -- doctor who is out.
  if new.clinician_alert_id is not null then
    select (ca.level = 'emergency') or (ca.override_level = 'emergency'),
           cs.profile_id, cs.doctor_tier
      into v_needs_emergency_authority, v_alert_owner_profile, v_alert_owner_tier
    from public.clinician_alerts ca
    left join public.clinical_staff cs
      on cs.id = ca.responsible_clinician_id and cs.active
    where ca.id = new.clinician_alert_id;
  end if;

  if v_alert_owner_profile is not null
     and not private.clinician_on_leave(v_alert_owner_profile)
     and (
       not coalesce(v_needs_emergency_authority, false)
       or v_alert_owner_tier in ('senior_medical_officer', 'chief_medical_officer')
     )
  then
    new.assigned_doctor_id := v_alert_owner_profile;
    return new;
  end if;

  -- Otherwise: the least-loaded active doctor at a tier that can handle
  -- this case (Senior Medical Officer+ if it needs emergency authority, any
  -- clinical tier otherwise) -- excluding anyone on leave outright, and now
  -- ranking anyone currently blocked or outside their declared hours behind
  -- anyone clearly free. Load = currently open/under_review escalations
  -- already assigned to them -- same shape of measure as
  -- lib/staffing/caseload.ts, just scoped to this one signal since that's
  -- all a placement decision needs.
  select cs.profile_id into v_candidate_profile
  from public.clinical_staff cs
  where cs.organisation_id = new.organisation_id
    and cs.active
    and cs.profile_id is not null
    and not private.clinician_on_leave(cs.profile_id)
    and (
      (coalesce(v_needs_emergency_authority, false)
        and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer'))
      or
      (not coalesce(v_needs_emergency_authority, false)
        and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer'))
    )
  order by
    private.clinician_deprioritised_now(cs.profile_id)::int asc,
    (
      select count(*) from public.escalations e
      where e.assigned_doctor_id = cs.profile_id and e.status in ('open', 'under_review')
    ) asc,
    cs.created_at asc
  limit 1;

  -- Stays null if nobody currently qualifies (e.g. a brand-new org with no
  -- staff yet, everyone inactive, or everyone qualifying is on leave) --
  -- fails open to the CMO's manual assignment, or any qualifying doctor's
  -- self-claim once someone qualifies, rather than raising.
  new.assigned_doctor_id := v_candidate_profile;
  return new;
end;
$function$;

-- Move what is already on a working doctor's queue. private.enforce_clinician_alert_reassignment_authority() lets a
-- reassignment through only when there is no signed-in user AND the transaction carries the owner-sweep marker
-- (20261031002624), so this block marks itself the way the sweep does; the counts are raised as notices.
do $$
declare
  v_alerts integer;
  v_escalations integer;
begin
  perform set_config('tarragon.alert_owner_sweep', 'on', true);
  with moved as (
    update public.clinician_alerts ca
       set responsible_clinician_id = private.test_patient_cover(ca.organisation_id),
           backup_clinician_id = null,
           assigned_at = now()
      from public.profiles pr
     where pr.id = ca.patient_id
       and pr.is_test
       and ca.status in ('open', 'acknowledged')
       and private.test_patient_cover(ca.organisation_id) is not null
       and (ca.responsible_clinician_id is distinct from private.test_patient_cover(ca.organisation_id)
            or ca.backup_clinician_id is not null)
    returning ca.id
  )
  select count(*) into v_alerts from moved;

  with moved as (
    update public.escalations e
       set assigned_doctor_id = cs.profile_id
      from public.profiles pr, public.clinical_staff cs
     where pr.id = e.patient_id
       and pr.is_test
       and e.status in ('open', 'under_review')
       and cs.id = private.test_patient_cover(e.organisation_id)
       and cs.profile_id is not null
       and e.assigned_doctor_id is distinct from cs.profile_id
    returning e.id
  )
  select count(*) into v_escalations from moved;
  perform set_config('tarragon.alert_owner_sweep', 'off', true);

  raise notice 'test_patient_cases_route_to_cmo: % open alert(s) and % open escalation(s) of test accounts moved to the Chief Medical Officer', v_alerts, v_escalations;

  if exists (
    select 1
    from public.clinician_alerts ca
    join public.profiles pr on pr.id = ca.patient_id
    where pr.is_test
      and ca.status in ('open', 'acknowledged')
      and private.test_patient_cover(ca.organisation_id) is not null
      and ca.responsible_clinician_id is distinct from private.test_patient_cover(ca.organisation_id)
  ) then
    raise exception 'test_patient_cases_route_to_cmo: a test account''s open alert still sits with someone other than the cover';
  end if;
end $$;
