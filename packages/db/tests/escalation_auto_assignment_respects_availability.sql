-- Tarragon Health
-- Proves the availability-awareness added to private.auto_assign_escalation()
-- by 20260916005747_escalation_auto_assignment_respects_availability.sql:
--   1. a doctor on genuine leave (provider_time_off.kind = 'leave' covering
--      now()) is excluded OUTRIGHT, even when they have the lowest caseload
--      of anyone qualifying;
--   2. a doctor with an ad-hoc 'blocked' slot right now, or whose only
--      configured provider_availability_rules window has already expired
--      (deterministic stand-in for "outside declared hours" that doesn't
--      depend on the real wall-clock day/time), is only DEPRIORITISED --
--      still gets the case when nobody better qualifies;
--   3. continuity with an already-owned clinician_alert is dropped, not just
--      re-checked, once that owner has gone on leave.
--
-- Every party is MINTED into a fresh org, per this project's standing fixture
-- discipline (see escalation_auto_assignment_and_reassignment_authority.sql's
-- header). All nine fixture doctors share one org so provider_time_off/
-- provider_availability_rules rows can be attached once up front -- each
-- case below explicitly activates only the clinical_staff rows it needs
-- (everyone else is left/set inactive first) rather than relying on tier
-- alone to scope the candidate pool: a non-emergency escalation qualifies
-- ANY clinical tier, so leaving unrelated fixture doctors active would let
-- them silently win a case's tie-break and falsify the assertion.
--
-- Run: npx supabase db query --linked -f packages/db/tests/escalation_auto_assignment_respects_availability.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temp table test_result (case_num int, label text, outcome text, detail text) on commit drop;
create temp table ids (k text primary key, v uuid) on commit drop;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_id  uuid;
  r     record;
begin
  insert into public.organisations (id, name, type)
  values (v_org, 'Escalation Availability Test Org', 'clinic');
  insert into ids(k, v) values ('org', v_org);

  for r in select * from (values ('patient_1'), ('patient_2'), ('patient_3'), ('patient_4')) as t(key_name)
  loop
    v_id := gen_random_uuid();
    insert into ids(k, v) values (r.key_name, v_id);
    insert into auth.users (id, email) values (v_id, format('escavail-%s@example.invalid', r.key_name));
    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, 'patient'::public.user_role, format('Escalation Availability %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  end loop;

  -- doctor_onleave / doctor_loaded: case 1 (hard exclude beats lower load).
  -- doctor_blocked / doctor_free: case 2a (soft deprioritise, tie-break).
  -- doctor_onlyblocked: case 2b (soft signal still gets the case alone).
  -- doctor_expiredrule / doctor_norules: case 3 (fail-open tie-break).
  -- doctor_smo_owner / doctor_smo_backup: case 4 (continuity dropped on leave).
  -- Every fixture doctor is minted INACTIVE -- each case activates only the
  -- ones it needs.
  for r in select * from (values
      ('doctor_onleave', 'medical_officer'),
      ('doctor_loaded', 'medical_officer'),
      ('doctor_blocked', 'medical_officer'),
      ('doctor_free', 'medical_officer'),
      ('doctor_onlyblocked', 'medical_officer'),
      ('doctor_expiredrule', 'medical_officer'),
      ('doctor_norules', 'medical_officer'),
      ('doctor_smo_owner', 'senior_medical_officer'),
      ('doctor_smo_backup', 'senior_medical_officer')
    ) as t(key_name, tier)
  loop
    v_id := gen_random_uuid();
    insert into ids(k, v) values (r.key_name, v_id);
    insert into auth.users (id, email) values (v_id, format('escavail-%s@example.invalid', r.key_name));
    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, 'clinician'::public.user_role, format('Dr Escalation Availability %s', r.key_name))
    on conflict (id) do update
      set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

    insert into public.clinical_staff (
      organisation_id, profile_id, full_name, active, license_verified_at,
      doctor_tier, employment_type,
      indemnity_insurer, indemnity_policy_number, indemnity_expires_at
    )
    values (
      v_org, v_id, format('Dr Escalation Availability %s', r.key_name), false, now(),
      r.tier::public.doctor_tier, 'employed',
      'Probe Indemnity Ltd', format('PROBE-ESCAVAIL-%s', r.key_name), now() + interval '1 year'
    )
    returning id into v_id;
    insert into ids(k, v) values (r.key_name || '_staff', v_id);
  end loop;

  -- provider_time_off / provider_availability_rules rows are attached now
  -- (independent of the active flag, which each case below toggles).
  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  values (v_org, (select v from ids where k = 'doctor_onleave'), 'leave', now() - interval '1 hour', now() + interval '1 hour', 'Test: annual leave covering now');

  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  values (v_org, (select v from ids where k = 'doctor_blocked'), 'blocked', now() - interval '15 minutes', now() + interval '15 minutes', 'Test: ad-hoc blocked slot covering now');

  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  values (v_org, (select v from ids where k = 'doctor_onlyblocked'), 'blocked', now() - interval '10 minutes', now() + interval '10 minutes', 'Test: blocked, but must still be chosen when nobody else qualifies');

  -- Deterministic "outside declared hours": is_active but effective_until
  -- already expired, so it can never accidentally match whatever wall-clock
  -- day/time the test happens to run at.
  insert into public.provider_availability_rules (
    organisation_id, clinician_id, day_of_week, start_time, end_time,
    consultation_method, appointment_types, effective_from, effective_until, is_active
  )
  values (
    v_org, (select v from ids where k = 'doctor_expiredrule'), 1, '09:00', '17:00',
    'telemedicine', array['gp']::public.appointment_type[],
    current_date - 30, current_date - 1, true
  );
end $$;

-- ---------------------------------------------------------------------------
-- Case 1: leave hard-excludes even though the on-leave doctor has the
-- lowest load. Only doctor_onleave (load 0, on leave) and doctor_loaded
-- (load 1, free) are active; without the fix the least-loaded doctor
-- (doctor_onleave) would win.
-- ---------------------------------------------------------------------------
update public.clinical_staff set active = true
  where organisation_id = (select v from ids where k = 'org')
    and profile_id in ((select v from ids where k = 'doctor_onleave'), (select v from ids where k = 'doctor_loaded'));

insert into public.escalations (organisation_id, patient_id, reason, assigned_doctor_id, status)
select (select v from ids where k = 'org'), (select v from ids where k = 'patient_1'),
       'Pre-existing load for doctor_loaded', (select v from ids where k = 'doctor_loaded'), 'open';

insert into public.escalations (organisation_id, patient_id, reason)
select (select v from ids where k = 'org'), (select v from ids where k = 'patient_1'),
       'Case 1: must skip the on-leave doctor despite their lower load';

insert into test_result
select 1, 'on-leave doctor is excluded outright even with the lowest load',
  case when e.assigned_doctor_id = (select v from ids where k = 'doctor_loaded') then 'PASS' else 'FAIL' end,
  'assigned_doctor_id=' || coalesce(e.assigned_doctor_id::text, 'null')
from public.escalations e
where e.patient_id = (select v from ids where k = 'patient_1')
  and e.reason = 'Case 1: must skip the on-leave doctor despite their lower load';

update public.clinical_staff set active = false where organisation_id = (select v from ids where k = 'org');

-- ---------------------------------------------------------------------------
-- Case 2a: a currently-blocked doctor loses a tied tie-break against an
-- equally-loaded (0), unblocked doctor.
-- ---------------------------------------------------------------------------
update public.clinical_staff set active = true
  where organisation_id = (select v from ids where k = 'org')
    and profile_id in ((select v from ids where k = 'doctor_blocked'), (select v from ids where k = 'doctor_free'));

insert into public.escalations (organisation_id, patient_id, reason)
select (select v from ids where k = 'org'), (select v from ids where k = 'patient_2'),
       'Case 2a: tied load, must prefer the unblocked doctor';

insert into test_result
select 2, 'blocked-right-now doctor loses a tied-load tie-break to a free doctor',
  case when e.assigned_doctor_id = (select v from ids where k = 'doctor_free') then 'PASS' else 'FAIL' end,
  'assigned_doctor_id=' || coalesce(e.assigned_doctor_id::text, 'null')
from public.escalations e
where e.patient_id = (select v from ids where k = 'patient_2')
  and e.reason = 'Case 2a: tied load, must prefer the unblocked doctor';

update public.clinical_staff set active = false where organisation_id = (select v from ids where k = 'org');

-- ---------------------------------------------------------------------------
-- Case 2b: soft signal, not exclusion -- doctor_onlyblocked is blocked right
-- now and is the ONLY active candidate. Must still receive the case.
-- ---------------------------------------------------------------------------
update public.clinical_staff set active = true
  where organisation_id = (select v from ids where k = 'org')
    and profile_id = (select v from ids where k = 'doctor_onlyblocked');

insert into public.escalations (organisation_id, patient_id, reason)
select (select v from ids where k = 'org'), (select v from ids where k = 'patient_2'),
       'Case 2b: the only active doctor is blocked but must still get the case';

insert into test_result
select 3, 'blocked doctor still receives the case when nobody else qualifies (soft signal, not exclusion)',
  case when e.assigned_doctor_id = (select v from ids where k = 'doctor_onlyblocked') then 'PASS' else 'FAIL' end,
  'assigned_doctor_id=' || coalesce(e.assigned_doctor_id::text, 'null')
from public.escalations e
where e.patient_id = (select v from ids where k = 'patient_2')
  and e.reason = 'Case 2b: the only active doctor is blocked but must still get the case';

update public.clinical_staff set active = false where organisation_id = (select v from ids where k = 'org');

-- ---------------------------------------------------------------------------
-- Case 3: fail-open tie-break. doctor_expiredrule has configured
-- provider_availability_rules, but the only row is deterministically
-- outside its effective range (expired) -- deprioritised. doctor_norules has
-- never configured any rule at all -- must NOT be penalised for that, and
-- must win the tie (both active, both load 0).
-- ---------------------------------------------------------------------------
update public.clinical_staff set active = true
  where organisation_id = (select v from ids where k = 'org')
    and profile_id in ((select v from ids where k = 'doctor_expiredrule'), (select v from ids where k = 'doctor_norules'));

insert into public.escalations (organisation_id, patient_id, reason)
select (select v from ids where k = 'org'), (select v from ids where k = 'patient_3'),
       'Case 3: expired-rule doctor deprioritised behind the doctor with no rules configured at all';

insert into test_result
select 4, 'a doctor with an expired/non-matching availability rule loses the tie-break to a doctor with no rules configured (fail-open)',
  case when e.assigned_doctor_id = (select v from ids where k = 'doctor_norules') then 'PASS' else 'FAIL' end,
  'assigned_doctor_id=' || coalesce(e.assigned_doctor_id::text, 'null')
from public.escalations e
where e.patient_id = (select v from ids where k = 'patient_3')
  and e.reason = 'Case 3: expired-rule doctor deprioritised behind the doctor with no rules configured at all';

update public.clinical_staff set active = false where organisation_id = (select v from ids where k = 'org');

-- ---------------------------------------------------------------------------
-- Case 4: continuity is DROPPED, not just re-checked, once the alert's owner
-- has gone on leave. doctor_smo_owner starts as the alert's
-- responsible_clinician_id (set explicitly on insert, so this doesn't
-- depend on classify_and_assign_clinician_alert's own routing); a new
-- escalation linked to that same alert, raised after doctor_smo_owner goes
-- on leave, must land on doctor_smo_backup instead. Both are active
-- senior_medical_officer, tier-qualifying for the emergency bar.
-- ---------------------------------------------------------------------------
update public.clinical_staff set active = true
  where organisation_id = (select v from ids where k = 'org')
    and profile_id in ((select v from ids where k = 'doctor_smo_owner'), (select v from ids where k = 'doctor_smo_backup'));

do $$
declare
  v_alert_id uuid;
begin
  insert into public.clinician_alerts (organisation_id, patient_id, level, category, type_code, title, responsible_clinician_id)
  values (
    (select v from ids where k = 'org'), (select v from ids where k = 'patient_4'),
    'emergency', 'clinical', 'deterioration', 'Escalation availability test: emergency alert with an owner going on leave',
    (select v from ids where k = 'doctor_smo_owner_staff')
  )
  returning id into v_alert_id;

  insert into ids(k, v) values ('avail_alert', v_alert_id);

  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  values (
    (select v from ids where k = 'org'), (select v from ids where k = 'doctor_smo_owner'),
    'leave', now() - interval '1 hour', now() + interval '1 hour', 'Test: alert owner going on leave after being assigned'
  );

  insert into public.escalations (organisation_id, patient_id, reason, clinician_alert_id)
  values (
    (select v from ids where k = 'org'), (select v from ids where k = 'patient_4'),
    'Case 4: alert owner is now on leave, continuity must be dropped', v_alert_id
  );
end $$;

insert into test_result
select 5, 'continuity with an already-owned alert is dropped once the owner has gone on leave',
  case when e.assigned_doctor_id = (select v from ids where k = 'doctor_smo_backup') then 'PASS' else 'FAIL' end,
  'assigned_doctor_id=' || coalesce(e.assigned_doctor_id::text, 'null')
from public.escalations e
where e.reason = 'Case 4: alert owner is now on leave, continuity must be dropped';

-- Control: confirm the on-leave owner was genuinely still the alert's
-- responsible_clinician_id going into case 4 (i.e. case 5 isn't passing
-- vacuously because nothing ever pointed at doctor_smo_owner in the first
-- place).
insert into test_result
select 6, 'control: the alert really was owned by the now-on-leave doctor before this case ran',
  case when a.responsible_clinician_id = (select v from ids where k = 'doctor_smo_owner_staff') then 'PASS' else 'FAIL' end,
  'responsible_clinician_id=' || coalesce(a.responsible_clinician_id::text, 'null')
from public.clinician_alerts a where a.id = (select v from ids where k = 'avail_alert');

-- ---------------------------------------------------------------------------
-- Verdict.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg('case ' || case_num || ' (' || label || '): ' || detail, '; ' order by case_num)
    into v_bad
  from test_result
  where outcome not like 'PASS%';

  if v_bad is not null then
    raise exception 'ESCALATION AUTO-ASSIGNMENT AVAILABILITY-AWARENESS BROKEN: %', v_bad;
  end if;
end $$;

select case_num, label, outcome, detail from test_result order by case_num;

rollback;
