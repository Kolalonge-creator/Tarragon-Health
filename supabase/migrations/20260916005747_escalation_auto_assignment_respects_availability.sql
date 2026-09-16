-- Tarragon Health
--
-- Closes a real gap in the escalation/specialist-referral auto-assignment
-- engine (private.auto_assign_escalation, private.auto_match_internal_
-- specialist, 20260906141500): neither ever consulted provider_time_off or
-- provider_availability_rules -- both built five days earlier, 2026-08-28,
-- for the opposite side of the system (generating patient-facing appointment
-- slots). A doctor on leave right now, with the lightest open caseload,
-- could still be auto-routed a brand-new emergency escalation or specialist
-- referral with nobody any the wiser.
--
-- Founder decision: exclude a doctor who is currently on leave
-- (provider_time_off.kind = 'leave' covering now()) outright -- never route
-- a new case to them, and drop continuity with an already-owned
-- clinician_alert if its owner has since gone on leave. A doctor with an
-- ad-hoc 'blocked' slot right now, or who is simply outside their own
-- declared provider_availability_rules window, is NOT excluded -- an
-- emergency should still be able to reach someone active and on-call -- but
-- is deprioritised behind anyone who is clearly free, via the existing
-- least-loaded-first ordering.
--
-- Two small SQL helpers do the classification so the same rule applies
-- identically to both auto-assignment paths rather than drifting between two
-- copies of the same logic:
--   private.clinician_on_leave(profile_id, at)          -- hard exclude
--   private.clinician_deprioritised_now(profile_id, at) -- soft rank signal
-- Both fail open when a doctor has never configured provider_availability_
-- rules at all (no rows = not penalised for hours -- most staff haven't
-- opted into recurring booking windows yet, and this migration must not turn
-- that into an accidental case-routing penalty).

create or replace function private.clinician_on_leave(p_clinician_id uuid, p_at timestamptz default now())
returns boolean
language sql
stable
set search_path to ''
as $$
  select exists (
    select 1
    from public.provider_time_off t
    where t.clinician_id = p_clinician_id
      and t.kind = 'leave'
      and tstzrange(t.starts_at, t.ends_at, '[)') @> p_at
  );
$$;

comment on function private.clinician_on_leave(uuid, timestamptz) is
  'Hard-exclude signal for case auto-assignment: true only for genuine leave (provider_time_off.kind = ''leave'') covering the given instant, never for an ad-hoc ''blocked'' slot. Null-safe (a nonexistent/null clinician reads false, never errors).';

create or replace function private.clinician_deprioritised_now(p_clinician_id uuid, p_at timestamptz default now())
returns boolean
language sql
stable
set search_path to ''
as $$
  select
    exists (
      select 1
      from public.provider_time_off t
      where t.clinician_id = p_clinician_id
        and t.kind = 'blocked'
        and tstzrange(t.starts_at, t.ends_at, '[)') @> p_at
    )
    or (
      exists (
        select 1 from public.provider_availability_rules r
        where r.clinician_id = p_clinician_id and r.is_active
      )
      and not exists (
        select 1
        from public.provider_availability_rules r
        where r.clinician_id = p_clinician_id
          and r.is_active
          and r.day_of_week = extract(dow from (p_at at time zone 'Africa/Lagos'))::smallint
          and (p_at at time zone 'Africa/Lagos')::time >= r.start_time
          and (p_at at time zone 'Africa/Lagos')::time <  r.end_time
          and (p_at at time zone 'Africa/Lagos')::date  >= r.effective_from
          and (r.effective_until is null or (p_at at time zone 'Africa/Lagos')::date <= r.effective_until)
      )
    );
$$;

comment on function private.clinician_deprioritised_now(uuid, timestamptz) is
  'Soft rank signal only -- never excludes. True when a doctor has an ad-hoc provider_time_off(''blocked'') slot right now, or has configured provider_availability_rules but the given instant falls outside all of them. A doctor with zero rules configured is never deprioritised on hours alone (fail open). Null-safe.';

revoke all on function private.clinician_on_leave(uuid, timestamptz) from public, anon;
revoke all on function private.clinician_deprioritised_now(uuid, timestamptz) from public, anon;

-- ---------------------------------------------------------------------------
-- private.auto_assign_escalation -- now leave-aware
-- ---------------------------------------------------------------------------
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
        and cs.doctor_tier in ('medical_officer', 'senior_medical_officer', 'chief_medical_officer'))
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

-- ---------------------------------------------------------------------------
-- private.auto_match_internal_specialist -- same leave-awareness
-- ---------------------------------------------------------------------------
create or replace function private.auto_match_internal_specialist()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_org uuid;
  v_match_id uuid;
begin
  -- A caller who already named a specific external partner or internal
  -- specialist made that call on purpose -- never silently override it.
  if new.specialist_provider_id is not null or new.assigned_specialist_id is not null then
    return new;
  end if;

  select organisation_id into v_org from public.profiles where id = new.patient_id;
  if v_org is null then
    return new;
  end if;

  select cs.id into v_match_id
  from public.clinical_staff cs
  where cs.organisation_id = v_org
    and cs.active
    and cs.specialist_type = new.specialist_type
    and (cs.profile_id is null or not private.clinician_on_leave(cs.profile_id))
  order by
    (case when cs.profile_id is null then false else private.clinician_deprioritised_now(cs.profile_id) end)::int asc,
    (
      select count(*) from public.specialist_referrals sr
      where sr.assigned_specialist_id = cs.id
        and sr.status not in ('completed', 'closed', 'declined')
    ) asc, cs.created_at asc
  limit 1;

  if v_match_id is not null then
    new.assigned_specialist_id := v_match_id;
    new.fulfilment := 'partner';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('clinician_on_leave', 'clinician_deprioritised_now');
  if v_count <> 2 then
    raise exception 'expected both new availability-classification helpers to exist, found %', v_count;
  end if;

  if has_function_privilege('anon', 'private.clinician_on_leave(uuid, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute clinician_on_leave';
  end if;
  if has_function_privilege('anon', 'private.clinician_deprioritised_now(uuid, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute clinician_deprioritised_now';
  end if;

  -- Null-safe: an unknown clinician must never error, and must read as "not
  -- on leave, not deprioritised" (fail open) rather than raising.
  if private.clinician_on_leave('00000000-0000-0000-0000-000000000000'::uuid) is distinct from false then
    raise exception 'clinician_on_leave should be false for an unknown clinician';
  end if;
  if private.clinician_deprioritised_now('00000000-0000-0000-0000-000000000000'::uuid) is distinct from false then
    raise exception 'clinician_deprioritised_now should be false (fail open) for a clinician with no configured rules';
  end if;

  raise notice 'PASS: escalation and specialist auto-assignment now exclude doctors on leave outright and deprioritise blocked/out-of-hours doctors behind anyone clearly free';
end $$;
